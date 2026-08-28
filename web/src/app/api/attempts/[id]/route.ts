import type { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../../../lib/auth";
import { computeRunScore, scoreAttempt } from "../../../../lib/complete";
import { prisma } from "../../../../lib/db";

const TERMINAL = ["done", "error"];

// Every level is an explicit `select`, never an `include`. An include returns
// whatever columns the schema happens to carry -- now, and after any future
// migration -- so a payload the spec defines as judge-sanitized facts only
// ("no stdout anywhere") would silently widen the day someone adds a column
// holding raw sandbox output. Listing the fields makes that structurally
// impossible rather than a review responsibility.
//
// R11: followupPrompt is absent -- round 2's request is a surprise until the
// round exists. R52: referenceMs IS present and deliberate -- the dashboard
// cannot explain a perf number without the bar it was measured against, and
// the spec forbids black-box numbers. Neither is an oversight; changing
// either is a spec decision, not a refactor.
//
// The orderBys are not cosmetic: this endpoint is polled every 2s, and
// Postgres returns rows in whatever order it likes without one, so the model
// cards, test rows and benchmark rows would reshuffle on every poll.
const SELECT = {
  id: true,
  status: true,
  finalScore: true,
  totalTokens: true,
  challenge: { select: { slug: true, title: true, parTokens: true, referenceMs: true } },
  rounds: {
    orderBy: { index: "asc" },
    select: {
      index: true,
      runs: {
        // displayName keeps the grid in the same order across both rounds
        // (run ids differ per round); id breaks ties, since displayName
        // carries no unique constraint.
        orderBy: [{ model: { displayName: "asc" } }, { id: "asc" }],
        select: {
          id: true,
          status: true,
          errorKind: true,
          errorMessage: true,
          generatedCode: true,
          promptTokens: true,
          completionTokens: true,
          accuracy: true,
          perfScore: true,
          runScore: true,
          model: { select: { displayName: true, openrouterId: true } },
          tests: {
            orderBy: { name: "asc" },
            select: { name: true, passed: true, message: true, runtimeMs: true },
          },
          benchmarks: {
            orderBy: { inputSize: "asc" },
            select: { inputSize: true, timeMs: true, memoryMb: true, timedOut: true },
          },
        },
      },
    },
  },
} satisfies Prisma.AttemptSelect;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "login required" }, { status: 401 });

  // Same 404-for-everything authorization boundary as the sibling POST route,
  // expressed in the WHERE rather than as a post-load compare so that userId
  // never enters the response object at all. A foreign attempt and a
  // nonexistent one are byte-identical from outside -- no existence oracle.
  const load = () => prisma.attempt.findFirst({ where: { id, userId: session.user.id }, select: SELECT });

  let attempt = await load();
  if (!attempt) return NextResponse.json({ error: "not found" }, { status: 404 });

  // referenceMs is nullable in the schema (drafts have none until
  // publish_check writes the lock). The seed only ever publishes a challenge
  // together with a numeric referenceMs, and an attempt can only be created
  // against a published challenge -- so null here is a broken platform
  // invariant, not a player-reachable state. Defaulting it to 0 would make
  // perfScore(0, sub) return 0 for every run, so every player on that
  // challenge would silently score accuracy x 0.7 forever with no error
  // anywhere. Refuse loudly instead: no score is better than a wrong one,
  // and nothing is written.
  const refMs = attempt.challenge.referenceMs;
  if (refMs === null) {
    console.error(`attempt ${id}: challenge ${attempt.challenge.slug} is published with no referenceMs`);
    return NextResponse.json({ error: "challenge is missing its reference timing" }, { status: 500 });
  }

  // Lazily persist per-run scores for freshly terminal runs (facts ->
  // interpretation). Idempotent: the same facts always compute the same
  // score, and an already-scored run is skipped outright.
  let persisted = false;
  for (const round of attempt.rounds) {
    for (const run of round.runs) {
      if (run.runScore !== null) continue;
      if (run.status === "done") {
        const { accuracy, perf, score } = computeRunScore(
          { errorKind: run.errorKind, tests: run.tests, bench: run.benchmarks }, refMs);
        await prisma.run.update({
          where: { id: run.id },
          data: { accuracy, perfScore: perf, runScore: score } });
        persisted = true;
      } else if (run.status === "error" && run.errorKind !== "platform") {
        // Not `=== "submission"`: a run that fails inside the test phase can
        // land terminal with errorKind still NULL, and scoreAttempt counts
        // any surviving run as `runScore ?? 0` regardless. Keying on "not a
        // platform fault" -- the same predicate fanout.ts uses for round-2
        // survival -- keeps the stored row and the score actually used in
        // agreement. Platform faults are deliberately left null: they are
        // excluded from ranking, not scored 0, and a stored 0 would render
        // in the dashboard as "this model scored 0".
        await prisma.run.update({
          where: { id: run.id }, data: { accuracy: 0, perfScore: 0, runScore: 0 } });
        persisted = true;
      }
    }
  }
  if (persisted) attempt = (await load())!;

  // Complete the attempt when both rounds exist and every run is terminal.
  const rounds = attempt.rounds;
  const [r0, r1] = [0, 1].map((i) => rounds.find((r) => r.index === i));
  const allTerminal = (r: typeof r0) =>
    !!r && r.runs.length > 0 && r.runs.every((x) => TERMINAL.includes(x.status));
  if (attempt.status === "active" && allTerminal(r0) && allTerminal(r1)) {
    const toScored = (runs: NonNullable<typeof r0>["runs"]) => runs.map((x) => ({
      errorKind: x.errorKind, score: x.runScore ?? 0,
      promptTokens: x.promptTokens ?? 0, completionTokens: x.completionTokens ?? 0 }));
    // R10/R53: spec L126 -- a model with no round-1 run at all (deactivated
    // mid-attempt by the isActive kill-switch, or platform-errored in round 0
    // and therefore skipped at round-1 fan-out) is excluded from BOTH rounds'
    // rankings, not just from round 1's. Filtered here rather than inside
    // scoreAttempt because which runs are ELIGIBLE is a different concern
    // from how eligible runs are WEIGHTED, and eligibility already lives at
    // this boundary (fanout.ts owns the round-2 roster).
    //
    // Keyed on a round-1 run EXISTING, never on it surviving: a model that
    // platform-errored in round 1 did run, and its round-0 score was
    // legitimately earned -- dropping that would let infra luck cap a score,
    // which is exactly what the platform/submission split exists to prevent.
    // openrouterId is Model's unique column, so it is the same identity the
    // modelId FK carries, and it is already selected -- no wider payload.
    //
    // A dropped run's tokens leave totalTokens too, for free, since it never
    // reaches scoreAttempt: a mid-attempt deactivation is a platform-side
    // decision the player did not cause, so charging them its tokens would
    // lower their token_factor for someone else's action.
    const ranR1 = new Set(r1!.runs.map((x) => x.model.openrouterId));
    const out = scoreAttempt(
      toScored(r0!.runs.filter((x) => ranR1.has(x.model.openrouterId))),
      toScored(r1!.runs), attempt.challenge.parTokens);
    // updateMany, not update: reading status above and writing it here are
    // not atomic, and the dashboard polls this endpoint every 2s, so two
    // overlapping polls both reach this line. Scoping the write to the
    // status it expects makes the loser a no-op (count 0) instead of a
    // second completion stamping a different completedAt. Also the reason a
    // voided or completed attempt can never be resurrected from here.
    await prisma.attempt.updateMany({
      where: { id, status: "active" },
      data: out.kind === "voided"
        ? { status: "voided", completedAt: new Date() }
        : { status: "completed", completedAt: new Date(),
            finalScore: out.finalScore, totalTokens: out.totalTokens } });
    attempt = (await load())!; // unconditional: on a lost race the in-hand copy is stale too
  }
  return NextResponse.json(attempt);
}
