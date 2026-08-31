import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/db";

const DAILY = Number(process.env.DAILY_TOKEN_QUOTA ?? 100000);

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "login required" }, { status: 401 });
  const { challengeSlug } = await req.json().catch(() => ({}));
  const challenge = await prisma.challenge.findUnique({
    where: { slug: String(challengeSlug ?? ""), status: "published" } });
  if (!challenge) return NextResponse.json({ error: "unknown challenge" }, { status: 404 });

  // R9: Attempt.totalTokens is the survivors-only SCORING total, written once
  // by the completion route when an attempt finishes -- it reads 0 for every
  // in-flight attempt and permanently excludes platform-errored spend, so a
  // quota check against it would let real, already-billed OpenRouter spend
  // escape the daily cap. Sum the actual per-run token columns instead
  // (User -> Attempt -> Round -> Run is the join path below), which the
  // judge writes as soon as a generate call returns a response. No
  // attempt-status filter: a voided attempt's runs still spent real tokens
  // before erroring out, and that spend must count too -- excluding it would
  // reopen the same hole totalTokens has, just through a different column.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const used = await prisma.run.aggregate({
    _sum: { promptTokens: true, completionTokens: true },
    where: { round: { submittedAt: { gte: today }, attempt: { userId: session.user.id } } },
  });
  const usedTokens = (used._sum.promptTokens ?? 0) + (used._sum.completionTokens ?? 0);
  if (usedTokens >= DAILY)
    return NextResponse.json({ error: "daily token quota reached" }, { status: 429 });

  const attempt = await prisma.attempt.create({
    data: { userId: session.user.id, challengeId: challenge.id } });
  return NextResponse.json({ id: attempt.id }, { status: 201 });
}
