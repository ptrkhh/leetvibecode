import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

vi.mock("../../../lib/db", () => ({
  prisma: {
    challenge: { findUnique: vi.fn() },
    run: { aggregate: vi.fn() },
    attempt: { create: vi.fn() },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "../../../lib/db";
import { POST } from "./route";

const getSession = getServerSession as unknown as Mock;
const findChallenge = prisma.challenge.findUnique as unknown as Mock;
const aggregateRun = prisma.run.aggregate as unknown as Mock;
const createAttempt = prisma.attempt.create as unknown as Mock;

// Same fallback vitest itself sees (no .env loading under `vitest run`), kept
// in lockstep with route.ts's own `Number(process.env.DAILY_TOKEN_QUOTA ?? 100000)`
// so the boundary tests below exercise the real configured threshold.
const DAILY = Number(process.env.DAILY_TOKEN_QUOTA ?? 100000);

function req(body: unknown) {
  return new Request("http://localhost/api/attempts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getSession.mockReset();
  findChallenge.mockReset();
  aggregateRun.mockReset();
  createAttempt.mockReset();
  getSession.mockResolvedValue({ user: { id: "u1" } });
  findChallenge.mockResolvedValue({ id: "c1", slug: "adder" });
  aggregateRun.mockResolvedValue({ _sum: { promptTokens: 0, completionTokens: 0 } });
  createAttempt.mockResolvedValue({ id: "a1" });
});

describe("POST /api/attempts", () => {
  it("returns 401 without a session and never touches the db", async () => {
    getSession.mockResolvedValueOnce(null);

    const res = await POST(req({ challengeSlug: "adder" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "login required" });
    expect(findChallenge).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown or unpublished challenge slug", async () => {
    findChallenge.mockResolvedValueOnce(null);

    const res = await POST(req({ challengeSlug: "nope" }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown challenge" });
    expect(findChallenge).toHaveBeenCalledWith({ where: { slug: "nope", status: "published" } });
  });

  it("treats a malformed JSON body as an unknown challenge (400 never leaks as a 500)", async () => {
    findChallenge.mockResolvedValueOnce(null);

    const res = await POST(
      new Request("http://localhost/api/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );

    expect(res.status).toBe(404);
  });

  it("returns 429 when today's summed run tokens meet the daily quota", async () => {
    aggregateRun.mockResolvedValueOnce({ _sum: { promptTokens: DAILY, completionTokens: 0 } });

    const res = await POST(req({ challengeSlug: "adder" }));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "daily token quota reached" });
    expect(createAttempt).not.toHaveBeenCalled();
  });

  it("allows exactly one token under the daily quota", async () => {
    aggregateRun.mockResolvedValueOnce({ _sum: { promptTokens: DAILY - 1, completionTokens: 0 } });

    const res = await POST(req({ challengeSlug: "adder" }));

    expect(res.status).toBe(201);
  });

  it("returns 201 with the new attempt id when under quota", async () => {
    const res = await POST(req({ challengeSlug: "adder" }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "a1" });
    expect(createAttempt).toHaveBeenCalledWith({ data: { userId: "u1", challengeId: "c1" } });
  });

  // R9: Attempt.totalTokens is the survivors-only scoring total written once
  // at completion (zero for every in-flight attempt, and it excludes
  // platform-errored spend forever). The quota must instead sum the actual
  // Run token columns, reached via User -> Attempt -> Round -> Run, with NO
  // attempt-status filter -- a voided attempt's runs still spent real tokens
  // before erroring, and that spend must still count against the quota.
  it("sums Run tokens via round.attempt.userId scoped to today, with no attempt-status filter", async () => {
    await POST(req({ challengeSlug: "adder" }));

    expect(aggregateRun).toHaveBeenCalledTimes(1);
    const call = aggregateRun.mock.calls[0][0];
    expect(call).toEqual({
      _sum: { promptTokens: true, completionTokens: true },
      where: { round: { submittedAt: { gte: expect.any(Date) }, attempt: { userId: "u1" } } },
    });
    const cutoff: Date = call.where.round.submittedAt.gte;
    expect(cutoff.getUTCHours()).toBe(0);
    expect(cutoff.getUTCMinutes()).toBe(0);
    expect(cutoff.getUTCSeconds()).toBe(0);
  });

  it("treats null aggregate sums (no runs yet today) as zero, not NaN", async () => {
    aggregateRun.mockResolvedValueOnce({ _sum: { promptTokens: null, completionTokens: null } });

    const res = await POST(req({ challengeSlug: "adder" }));

    expect(res.status).toBe(201);
  });
});
