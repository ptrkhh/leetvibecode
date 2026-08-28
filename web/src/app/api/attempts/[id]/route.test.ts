import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

vi.mock("../../../../lib/db", () => {
  const prisma = {
    attempt: { findFirst: vi.fn(), updateMany: vi.fn() },
    run: { update: vi.fn() },
  };
  return { prisma };
});

import { getServerSession } from "next-auth";
import { prisma } from "../../../../lib/db";
import { GET } from "./route";

const getSession = getServerSession as unknown as Mock;
const findAttempt = prisma.attempt.findFirst as unknown as Mock;
const updateAttempt = prisma.attempt.updateMany as unknown as Mock;
const updateRun = prisma.run.update as unknown as Mock;

const challenge = { slug: "rate-limiter", title: "Rate Limiter", parTokens: 2500, referenceMs: 100 };

function run(over: Record<string, unknown> = {}) {
  return {
    id: "run-1", status: "done", errorKind: null, errorMessage: null,
    generatedCode: "print(1)", promptTokens: 250, completionTokens: 250,
    accuracy: null, perfScore: null, runScore: null,
    model: { displayName: "Qwen", openrouterId: "or-a" },
    tests: [{ name: "t::a", passed: true, message: null, runtimeMs: 1 }],
    benchmarks: [{ inputSize: 10, timeMs: 100, memoryMb: 1, timedOut: false }],
    ...over,
  };
}

function attempt(rounds: unknown[], over: Record<string, unknown> = {}) {
  return { id: "a1", status: "active", finalScore: null, totalTokens: 0, challenge, rounds, ...over };
}

// Two full rounds of terminal, already-scored runs: the shape that completes.
function completable(over: Record<string, unknown> = {}) {
  const scored = (i: number, o: Record<string, unknown> = {}) =>
    run({ id: `r${i}`, runScore: 1, accuracy: 1, perfScore: 1, ...o });
  return attempt(
    [
      { index: 0, runs: [scored(1), scored(2)] },
      { index: 1, runs: [scored(3), scored(4)] },
    ],
    over,
  );
}

const req = (id: string) =>
  GET(new Request(`http://localhost/api/attempts/${id}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  getSession.mockReset();
  findAttempt.mockReset();
  updateAttempt.mockReset();
  updateRun.mockReset();
  getSession.mockResolvedValue({ user: { id: "u1" } });
  updateAttempt.mockResolvedValue({ count: 1 });
  updateRun.mockResolvedValue({});
});

describe("GET /api/attempts/[id]: auth and lookup", () => {
  it("returns 401 without a session and never touches the db", async () => {
    getSession.mockResolvedValueOnce(null);

    const res = await req("a1");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "login required" });
    expect(findAttempt).not.toHaveBeenCalled();
  });

  // Same authorization boundary as the sibling POST route: someone else's
  // attempt must read identically to a nonexistent one. Here ownership lives
  // in the WHERE, so a foreign attempt simply resolves to null -- and userId
  // never enters the response object.
  it("scopes the lookup to the session user and 404s when nothing matches", async () => {
    findAttempt.mockResolvedValue(null);

    const res = await req("someone-elses");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(findAttempt.mock.calls[0][0].where).toEqual({ id: "someone-elses", userId: "u1" });
    expect(updateRun).not.toHaveBeenCalled();
    expect(updateAttempt).not.toHaveBeenCalled();
  });
});

describe("GET /api/attempts/[id]: response shape", () => {
  // Defect 1 + R11 + R52 + defect 4, pinned structurally. Prisma cannot
  // return a column that is not selected, so asserting the exact query is a
  // guarantee about the response, not a sample of it. An `include` (or a
  // `benchmarks: true`) would make this assertion fail, which is the point:
  // the next schema migration must not be able to widen this payload.
  it("selects exactly the sanitized fields, at every level, with stable ordering", async () => {
    findAttempt.mockResolvedValue(attempt([]));

    await req("a1");

    expect(findAttempt.mock.calls[0][0].select).toEqual({
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
    });
  });

  // R11: the followup prompt is a round-2 surprise and must never be
  // reachable from this payload, at any attempt status.
  it("never names followupPrompt anywhere in the query", async () => {
    findAttempt.mockResolvedValue(attempt([]));

    const res = await req("a1");

    expect(JSON.stringify(findAttempt.mock.calls[0][0])).not.toContain("followupPrompt");
    expect(await res.text()).not.toContain("followupPrompt");
  });
});

describe("GET /api/attempts/[id]: missing reference timing", () => {
  // Defect 3: referenceMs is Float? in the schema. `referenceMs ?? 0` would
  // make perfScore(0, sub) = 0 for every run, so every player on that
  // challenge silently scores accuracy x 0.7 with no error anywhere. A
  // published challenge without a reference timing is a platform-side
  // invariant break (the seed only ever publishes with a numeric
  // referenceMs) and must fail loudly instead of being absorbed into scores.
  it("refuses to score and returns 500 rather than degrading every run's perf", async () => {
    findAttempt.mockResolvedValue(
      attempt([{ index: 0, runs: [run()] }], { challenge: { ...challenge, referenceMs: null } }),
    );

    const res = await req("a1");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "challenge is missing its reference timing" });
    expect(updateRun).not.toHaveBeenCalled();
    expect(updateAttempt).not.toHaveBeenCalled();
  });
});

describe("GET /api/attempts/[id]: lazy per-run persistence", () => {
  it("computes and stores accuracy, perf and score for a freshly done run", async () => {
    findAttempt.mockResolvedValue(
      attempt([{
        index: 0,
        runs: [run({
          tests: [
            { name: "a", passed: true, message: null, runtimeMs: 1 },
            { name: "b", passed: false, message: null, runtimeMs: 1 },
          ],
          benchmarks: [
            { inputSize: 10, timeMs: 60, memoryMb: null, timedOut: false },
            { inputSize: 20, timeMs: 60, memoryMb: null, timedOut: false },
          ],
        })],
      }]),
    );

    await req("a1");

    expect(updateRun).toHaveBeenCalledTimes(1);
    const { where, data } = updateRun.mock.calls[0][0];
    expect(where).toEqual({ id: "run-1" });
    expect(data.accuracy).toBeCloseTo(0.5);
    expect(data.perfScore).toBeCloseTo(100 / 120); // ref 100ms vs summed 120ms
    expect(data.runScore).toBeCloseTo(0.5 * (0.7 + 0.3 * (100 / 120)));
  });

  it("does not rewrite a run that already carries a score", async () => {
    findAttempt.mockResolvedValue(
      attempt([{ index: 0, runs: [run({ runScore: 0.42, accuracy: 1, perfScore: 1 })] }]),
    );

    await req("a1");

    expect(updateRun).not.toHaveBeenCalled();
  });

  it.each(["pending", "generating", "testing"])(
    "leaves a non-terminal run (%s) unscored",
    async (status) => {
      findAttempt.mockResolvedValue(attempt([{ index: 0, runs: [run({ status })] }]));

      await req("a1");

      expect(updateRun).not.toHaveBeenCalled();
    },
  );

  it("zeroes a submission-fault run", async () => {
    findAttempt.mockResolvedValue(
      attempt([{
        index: 0,
        runs: [run({ status: "error", errorKind: "submission", tests: [], benchmarks: [] })],
      }]),
    );

    await req("a1");

    expect(updateRun).toHaveBeenCalledWith({
      where: { id: "run-1" }, data: { accuracy: 0, perfScore: 0, runScore: 0 },
    });
  });

  // A platform-errored run is EXCLUDED from ranking, not scored 0 -- writing
  // a 0 here would make the dashboard show "this model scored 0" for a run
  // that infra luck removed from the attempt entirely.
  it("leaves a platform-fault run's score null rather than writing a 0", async () => {
    findAttempt.mockResolvedValue(
      attempt([{
        index: 0,
        runs: [run({ status: "error", errorKind: "platform", tests: [], benchmarks: [] })],
      }]),
    );

    await req("a1");

    expect(updateRun).not.toHaveBeenCalled();
  });

  // The R10 divergence: `status="error"` with `errorKind=null` is unreachable
  // from today's judge (_fail is its only status="error" writer and always
  // passes a kind), but the persist branch keying on errorKind !== "platform"
  // rather than === "submission" means the persisted row and the score
  // scoreAttempt actually uses (`runScore ?? 0`) agree even if it ever became
  // reachable -- no run is scored as a 0 it does not carry in the database.
  it("zeroes a terminal error run whose errorKind was never set", async () => {
    findAttempt.mockResolvedValue(
      attempt([{
        index: 0,
        runs: [run({ status: "error", errorKind: null, tests: [], benchmarks: [] })],
      }]),
    );

    await req("a1");

    expect(updateRun).toHaveBeenCalledWith({
      where: { id: "run-1" }, data: { accuracy: 0, perfScore: 0, runScore: 0 },
    });
  });

  // R10 / Task 10: the four test-phase failure shapes all land status="done"
  // with errorKind NULL, so they must zero through accuracy===0, not through
  // the errorKind path. Anything else silently pays 70% for a run that never
  // produced a passing test.
  it.each([
    ["test phase timed out", [], []],
    ["collection crash", [], []],
    ["every test failed", [{ name: "a", passed: false, message: null, runtimeMs: 1 }], []],
  ])("scores %s as 0 with errorKind still null", async (_label, tests, benchmarks) => {
    findAttempt.mockResolvedValue(
      attempt([{ index: 0, runs: [run({ status: "done", errorKind: null, tests, benchmarks })] }]),
    );

    await req("a1");

    expect(updateRun).toHaveBeenCalledWith({
      where: { id: "run-1" }, data: { accuracy: 0, perfScore: 0, runScore: 0 },
    });
  });

  it("scores a bench timeout as accuracy x 0.7 with errorKind still null", async () => {
    findAttempt.mockResolvedValue(
      attempt([{
        index: 0,
        runs: [run({
          status: "done", errorKind: null,
          tests: [{ name: "a", passed: true, message: null, runtimeMs: 1 }],
          benchmarks: [{ inputSize: 0, timeMs: 0, memoryMb: null, timedOut: true }],
        })],
      }]),
    );

    await req("a1");

    expect(updateRun).toHaveBeenCalledWith({
      where: { id: "run-1" }, data: { accuracy: 1, perfScore: 0, runScore: 0.7 },
    });
  });
});

describe("GET /api/attempts/[id]: completion", () => {
  it("completes with a final score once both rounds are fully terminal", async () => {
    findAttempt.mockResolvedValue(completable());

    const res = await req("a1");

    expect(res.status).toBe(200);
    expect(updateAttempt).toHaveBeenCalledTimes(1);
    const { data } = updateAttempt.mock.calls[0][0];
    expect(data.status).toBe("completed");
    expect(data.finalScore).toBeCloseTo(100); // all runs 1.0, 2000 tokens under par 2500
    expect(data.totalTokens).toBe(2000);
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  // Defect 2: the read of attempt.status and the completion write are not
  // atomic, and the dashboard polls this endpoint every 2s -- two overlapping
  // polls both pass the status check. Scoping the write to the status it
  // expects makes the loser a no-op (count 0) instead of a second completion
  // with a different completedAt.
  it("guards the completion write on the status it read", async () => {
    findAttempt.mockResolvedValue(completable());

    await req("a1");

    expect(updateAttempt.mock.calls[0][0].where).toEqual({ id: "a1", status: "active" });
  });

  it("returns fresh state when a concurrent poll won the completion race", async () => {
    updateAttempt.mockResolvedValueOnce({ count: 0 }); // someone else got there first
    findAttempt
      .mockResolvedValueOnce(completable())
      .mockResolvedValueOnce(completable({ status: "completed", finalScore: 99, totalTokens: 2000 }));

    const res = await req("a1");

    expect(updateAttempt).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ status: "completed", finalScore: 99 });
  });

  it("voids instead of scoring when a round has no surviving run", async () => {
    const dead = (i: number) =>
      run({ id: `p${i}`, status: "error", errorKind: "platform", runScore: null, tests: [], benchmarks: [] });
    findAttempt.mockResolvedValue(
      attempt([
        { index: 0, runs: [dead(1), dead(2)] },
        { index: 1, runs: [run({ id: "ok", runScore: 1 })] },
      ]),
    );

    await req("a1");

    expect(updateAttempt.mock.calls[0][0].data).toEqual({
      status: "voided", completedAt: expect.any(Date),
    });
  });

  it.each([
    ["a run is still non-terminal", [
      { index: 0, runs: [run({ runScore: 1 })] },
      { index: 1, runs: [run({ status: "generating" })] },
    ]],
    ["round 1 has not started", [{ index: 0, runs: [run({ runScore: 1 })] }]],
    ["a round exists but has no runs", [
      { index: 0, runs: [run({ runScore: 1 })] },
      { index: 1, runs: [] },
    ]],
  ])("does not complete while %s", async (_label, rounds) => {
    findAttempt.mockResolvedValue(attempt(rounds));

    await req("a1");

    expect(updateAttempt).not.toHaveBeenCalled();
  });

  // Carried from Task 14 (hard requirement): an attempt voided at round-1
  // fan-out because no model survived must STAY voided. Nothing here may
  // score it, complete it, or otherwise resurrect it.
  it.each(["voided", "completed"])(
    "never rescores an attempt that is already %s",
    async (status) => {
      findAttempt.mockResolvedValue(completable({ status, finalScore: null }));

      const res = await req("a1");

      expect(updateAttempt).not.toHaveBeenCalled();
      expect(await res.json()).toMatchObject({ status, finalScore: null });
    },
  );
});
