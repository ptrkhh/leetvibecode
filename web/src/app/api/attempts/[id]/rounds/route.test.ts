import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

// $transaction's mock invokes the callback with `prisma` itself standing in
// for `tx` -- round/run/job creates issued inside the callback land on the
// same mocked object we assert against below.
vi.mock("../../../../../lib/db", () => {
  const prisma = {
    attempt: { findUnique: vi.fn(), update: vi.fn() },
    model: { findMany: vi.fn() },
    round: { create: vi.fn() },
    run: { create: vi.fn() },
    job: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma };
});

import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { prisma } from "../../../../../lib/db";
import { POST } from "./route";

const getSession = getServerSession as unknown as Mock;
const findAttempt = prisma.attempt.findUnique as unknown as Mock;
const updateAttempt = prisma.attempt.update as unknown as Mock;
const findModels = prisma.model.findMany as unknown as Mock;
const createRound = prisma.round.create as unknown as Mock;
const createRun = prisma.run.create as unknown as Mock;
const createJob = prisma.job.create as unknown as Mock;
const transact = prisma.$transaction as unknown as Mock;

// Same fallback vitest itself sees, kept in lockstep with route.ts's own
// `Number(process.env.TOKEN_CAP_PER_ATTEMPT ?? 20000)` so the boundary tests
// below exercise the real configured threshold.
const CAP = Number(process.env.TOKEN_CAP_PER_ATTEMPT ?? 20000);

const challenge = { models: ["or-a", "or-b"], followupPrompt: "now add burst mode" };

function freshAttempt(overrides: Record<string, unknown> = {}) {
  return { id: "a1", userId: "u1", status: "active", challenge, rounds: [], ...overrides };
}

function round0Run(over: Record<string, unknown> = {}) {
  return {
    modelId: "m1", status: "done", errorKind: null,
    promptTokens: 100, completionTokens: 200, ...over,
  };
}

function attemptWithRounds(rounds: unknown[], overrides: Record<string, unknown> = {}) {
  return { id: "a1", userId: "u1", status: "active", challenge, rounds, ...overrides };
}

function attemptWithRound0(runs = [round0Run(), round0Run({ modelId: "m2" })]) {
  return attemptWithRounds([{ id: "r0", index: 0, runs }]);
}

function req(id: string, body?: unknown) {
  return POST(
    new Request(`http://localhost/api/attempts/${id}/rounds`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  getSession.mockReset();
  findAttempt.mockReset();
  updateAttempt.mockReset();
  findModels.mockReset();
  createRound.mockReset();
  createRun.mockReset();
  createJob.mockReset();
  transact.mockReset();
  transact.mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));

  getSession.mockResolvedValue({ user: { id: "u1" } });
  // or-a/or-b are both the challenge's roster and active -> 2 eligible models by default
  findModels.mockResolvedValue([
    { id: "m1", openrouterId: "or-a" },
    { id: "m2", openrouterId: "or-b" },
  ]);
  createRound.mockResolvedValue({ id: "round-new" });
  createRun.mockResolvedValue({ id: "run-new" });
  createJob.mockResolvedValue({ id: "job-new" });
  updateAttempt.mockResolvedValue({});
});

describe("POST /api/attempts/[id]/rounds: auth and lookup", () => {
  it("returns 401 without a session and never touches the db", async () => {
    getSession.mockResolvedValueOnce(null);

    const res = await req("a1", { promptText: "build it" });

    expect(res.status).toBe(401);
    expect(findAttempt).not.toHaveBeenCalled();
  });

  it("returns 404 when the attempt id does not exist", async () => {
    findAttempt.mockResolvedValueOnce(null);

    const res = await req("nope", { promptText: "build it" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  // Authorization boundary: a real attempt belonging to someone else must
  // read identically to a nonexistent one -- no signal that lets a player
  // distinguish "not yours" from "doesn't exist" by guessing ids.
  it("returns 404 (not 403) when the attempt belongs to a different user", async () => {
    findAttempt.mockResolvedValueOnce(freshAttempt({ userId: "someone-else" }));

    const res = await req("a1", { promptText: "build it" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("looks the attempt up by exactly the id from the URL, no extra scoping", async () => {
    findAttempt.mockResolvedValueOnce(null);

    await req("a1", { promptText: "build it" });

    expect(findAttempt.mock.calls[0][0].where).toEqual({ id: "a1" });
  });

  it.each(["completed", "voided"])("returns 409 when the attempt is already finished (%s)", async (status) => {
    findAttempt.mockResolvedValueOnce(freshAttempt({ status }));

    const res = await req("a1", { promptText: "build it" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "attempt is finished" });
  });
});

describe("POST /api/attempts/[id]/rounds: round 0 (build)", () => {
  it.each([
    ["missing", undefined],
    ["empty string", ""],
    ["non-string", 12345],
    ["over 20000 chars", "x".repeat(20001)],
  ])("returns 400 when promptText is invalid: %s", async (_label, promptText) => {
    findAttempt.mockResolvedValueOnce(freshAttempt());

    const res = await req("a1", { promptText });

    expect(res.status).toBe(400);
    expect(createRound).not.toHaveBeenCalled();
  });

  it("returns 400 on a malformed JSON body, not a 500", async () => {
    findAttempt.mockResolvedValueOnce(freshAttempt());

    const res = await POST(
      new Request("http://localhost/api/attempts/a1/rounds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
      { params: Promise.resolve({ id: "a1" }) },
    );

    expect(res.status).toBe(400);
  });

  it.each([1, 20000])("accepts the boundary promptText length %i", async (len) => {
    findAttempt.mockResolvedValueOnce(freshAttempt());

    const res = await req("a1", { promptText: "x".repeat(len) });

    expect(res.status).toBe(201);
  });

  it("returns 503 (not voided) when zero models are eligible for round 0", async () => {
    findModels.mockResolvedValueOnce([]); // nothing active
    findAttempt.mockResolvedValueOnce(freshAttempt());

    const res = await req("a1", { promptText: "build it" });

    expect(res.status).toBe(503);
    expect(updateAttempt).not.toHaveBeenCalled();
    expect(transact).not.toHaveBeenCalled();
  });

  it("201s, uses the player's own promptText verbatim, and fans out one run+job per eligible model", async () => {
    findAttempt.mockResolvedValueOnce(freshAttempt());
    createRound.mockResolvedValueOnce({ id: "round-0-id" });

    const res = await req("a1", { promptText: "write a rate limiter" });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ roundId: "round-0-id", index: 0 });
    expect(createRound).toHaveBeenCalledWith({
      data: { attemptId: "a1", index: 0, promptText: "write a rate limiter" },
    });
    expect(transact).toHaveBeenCalledTimes(1);
    expect(createRun).toHaveBeenCalledTimes(2); // or-a and or-b are both active and in the roster
    expect(createJob).toHaveBeenCalledTimes(2);
    expect(createJob).toHaveBeenCalledWith({ data: { runId: "run-new", type: "generate" } });
  });
});

describe("POST /api/attempts/[id]/rounds: round 1 (extend)", () => {
  it("returns 409 when round 1 already exists", async () => {
    findAttempt.mockResolvedValueOnce(
      attemptWithRounds([{ id: "r0", index: 0, runs: [round0Run()] }, { id: "r1", index: 1, runs: [] }]),
    );

    const res = await req("a1");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "round 2 already started" });
  });

  it.each(["pending", "generating", "testing"])(
    "returns 409 when a round-0 run is still non-terminal (%s)",
    async (status) => {
      findAttempt.mockResolvedValueOnce(attemptWithRound0([round0Run({ status })]));

      const res = await req("a1");

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "round 1 still running" });
    },
  );

  it("returns 400 when this attempt's round-0 runs meet or exceed the per-attempt token cap", async () => {
    findAttempt.mockResolvedValueOnce(
      attemptWithRound0([round0Run({ promptTokens: CAP, completionTokens: 0 })]),
    );

    const res = await req("a1");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "token cap for this attempt reached" });
  });

  it("allows exactly one token under the per-attempt cap", async () => {
    findAttempt.mockResolvedValueOnce(
      attemptWithRound0([round0Run({ promptTokens: CAP - 1, completionTokens: 0 })]),
    );

    const res = await req("a1");

    expect(res.status).toBe(201);
  });

  it("treats a null token column (e.g. a generate call that failed outright) as zero spend", async () => {
    findAttempt.mockResolvedValueOnce(
      attemptWithRound0([
        round0Run({ status: "error", errorKind: "platform", promptTokens: null, completionTokens: null }),
        round0Run({ modelId: "m2" }),
      ]),
    );

    const res = await req("a1");

    expect(res.status).toBe(201); // 300 spend total, well under any realistic cap
  });

  // The core product rule: round 2's prompt is the platform's, never the
  // player's -- the body must be completely ignored, even when it tries to
  // smuggle a promptText override in.
  it("ignores promptText in the body and snapshots challenge.followupPrompt instead", async () => {
    findAttempt.mockResolvedValueOnce(attemptWithRound0());

    await req("a1", { promptText: "a prompt the player tried to sneak in for round 2" });

    expect(createRound).toHaveBeenCalledWith({
      data: { attemptId: "a1", index: 1, promptText: "now add burst mode" },
    });
  });

  it("still snapshots followupPrompt when no body is sent at all", async () => {
    findAttempt.mockResolvedValueOnce(attemptWithRound0());

    await req("a1"); // no body

    expect(createRound).toHaveBeenCalledWith({
      data: { attemptId: "a1", index: 1, promptText: "now add burst mode" },
    });
  });

  it("passes round-0 survival (modelId, errorKind) into eligibility, dropping platform-errored models", async () => {
    findAttempt.mockResolvedValueOnce(
      attemptWithRound0([
        round0Run({ modelId: "m1", errorKind: "platform", status: "error" }),
        round0Run({ modelId: "m2", errorKind: null, status: "done" }),
      ]),
    );

    await req("a1");

    // m1 platform-errored in round 0 -- excluded from round 1 even though it's still active
    expect(createRun).toHaveBeenCalledTimes(1);
    expect(createRun).toHaveBeenCalledWith({ data: { roundId: "round-new", modelId: "m2" } });
  });

  it("voids the attempt and returns {voided:true} (200) when no model survives to round 1", async () => {
    findAttempt.mockResolvedValueOnce(
      attemptWithRound0([round0Run({ errorKind: "platform", status: "error" })]),
    );

    const res = await req("a1");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ voided: true });
    expect(updateAttempt).toHaveBeenCalledWith({ where: { id: "a1" }, data: { status: "voided" } });
    expect(transact).not.toHaveBeenCalled();
  });

  it("201s with {roundId, index:1} on a normal round-1 fan-out", async () => {
    findAttempt.mockResolvedValueOnce(attemptWithRound0());
    createRound.mockResolvedValueOnce({ id: "round-1-id" });

    const res = await req("a1");

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ roundId: "round-1-id", index: 1 });
  });
});

describe("POST /api/attempts/[id]/rounds: fan-out atomicity", () => {
  it("propagates the error instead of returning 201 when the transaction fails partway through fan-out", async () => {
    findAttempt.mockResolvedValueOnce(freshAttempt());
    transact.mockRejectedValueOnce(new Error("db connection lost"));

    await expect(req("a1", { promptText: "build it" })).rejects.toThrow("db connection lost");
  });

  it("creates the round, then every run, then every run's job, all inside the one transaction", async () => {
    findAttempt.mockResolvedValueOnce(freshAttempt());

    await req("a1", { promptText: "build it" });

    expect(transact).toHaveBeenCalledTimes(1);
    expect(createRound.mock.invocationCallOrder[0]).toBeLessThan(createRun.mock.invocationCallOrder[0]);
    expect(createRun.mock.invocationCallOrder[0]).toBeLessThan(createJob.mock.invocationCallOrder[0]);
  });
});

describe("POST /api/attempts/[id]/rounds: duplicate-round race (R51)", () => {
  // attempt.findUnique (read above) and this route's round.create are not
  // atomic, so two requests that both pass the in-JS "does this round
  // already exist" checks before either commits can both reach the create --
  // a double-click on submit, or a client retrying after a flaky connection,
  // is ordinary behaviour here, not an edge case. This mocked suite has no
  // real unique constraint to race against -- only Postgres does -- so the
  // honest way to model it is two sequential calls fed the identical
  // pre-race attempt state, with the second call's transaction rejecting
  // with the P2002 Postgres would actually raise for the loser.
  it("returns 409 (not 500) when a second call for the same attempt+round loses the unique-constraint race", async () => {
    findAttempt.mockResolvedValue(freshAttempt());
    createRound.mockResolvedValueOnce({ id: "round-0-id" });
    transact.mockImplementationOnce((cb: (tx: typeof prisma) => unknown) => cb(prisma));
    transact.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed on the fields: (`attemptId`,`index`)",
        { code: "P2002", clientVersion: "6.19.3" },
      ),
    );

    const first = await req("a1", { promptText: "build it" });
    const second = await req("a1", { promptText: "build it" });

    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ roundId: "round-0-id", index: 0 });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "round already exists" });
  });
});
