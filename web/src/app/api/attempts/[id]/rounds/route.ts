import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/db";
import { eligibleModelIds } from "../../../../../lib/fanout";

const CAP = Number(process.env.TOKEN_CAP_PER_ATTEMPT ?? 20000);
const TERMINAL = ["done", "error"];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "login required" }, { status: 401 });
  const attempt = await prisma.attempt.findUnique({
    where: { id },
    include: { challenge: true, rounds: { include: { runs: true }, orderBy: { index: "asc" } } },
  });
  if (!attempt || attempt.userId !== session.user.id)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  if (attempt.status !== "active")
    return NextResponse.json({ error: "attempt is finished" }, { status: 409 });

  const round0 = attempt.rounds.find((r) => r.index === 0);
  let index: number, promptText: string, round0Runs = null;
  if (!round0) {
    const body = await req.json().catch(() => ({}));
    const p = body.promptText;
    if (typeof p !== "string" || p.length < 1 || p.length > 20000)
      return NextResponse.json({ error: "promptText required (1-20000 chars)" }, { status: 400 });
    [index, promptText] = [0, p];
  } else {
    if (attempt.rounds.some((r) => r.index === 1))
      return NextResponse.json({ error: "round 2 already started" }, { status: 409 });
    if (!round0.runs.every((r) => TERMINAL.includes(r.status)))
      return NextResponse.json({ error: "round 1 still running" }, { status: 409 });
    // R9: this attempt's own Run rows are already in hand (loaded above via
    // Attempt -> Round -> Run, scoped to this one attempt by the `where: {id}`
    // above), so the cap is just a reduce over them -- no query needed, and
    // no read of Attempt.totalTokens (the survivors-only scoring total).
    const spent = round0.runs.reduce(
      (sum, r) => sum + (r.promptTokens ?? 0) + (r.completionTokens ?? 0), 0);
    if (spent >= CAP)
      return NextResponse.json({ error: "token cap for this attempt reached" }, { status: 400 });
    [index, promptText] = [1, attempt.challenge.followupPrompt];
    round0Runs = round0.runs.map((r) => ({ modelId: r.modelId, errorKind: r.errorKind }));
  }

  const active = await prisma.model.findMany({ where: { isActive: true } });
  const modelIds = eligibleModelIds(attempt.challenge.models, active, round0Runs);
  if (modelIds.length === 0) {
    if (index === 1) {
      await prisma.attempt.update({ where: { id }, data: { status: "voided" } });
      return NextResponse.json({ voided: true });
    }
    return NextResponse.json({ error: "no active models for this challenge" }, { status: 503 });
  }

  try {
    const round = await prisma.$transaction(async (tx) => {
      const round = await tx.round.create({ data: { attemptId: id, index, promptText } });
      for (const modelId of modelIds) {
        const run = await tx.run.create({ data: { roundId: round.id, modelId } });
        await tx.job.create({ data: { runId: run.id, type: "generate" } });
      }
      return round;
    });
    return NextResponse.json({ roundId: round.id, index }, { status: 201 });
  } catch (e) {
    // R51: attempt.rounds (read above) and this create are not atomic, so two
    // requests that both pass the checks above -- a double-click on submit,
    // or a retried request after a flaky connection, ordinary behaviour, not
    // an edge case -- can both reach here for the same (attemptId, index).
    // Round's @@unique([attemptId, index]) still stops the duplicate row;
    // this only turns the loser's P2002 into the same 409 the sequential
    // check above already returns, instead of letting it escape as an
    // uncontrolled 500. Same fix as R46 (register/route.ts).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const error = index === 1 ? "round 2 already started" : "round already exists";
      return NextResponse.json({ error }, { status: 409 });
    }
    throw e;
  }
}
