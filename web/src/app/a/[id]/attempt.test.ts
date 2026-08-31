import { beforeEach, describe, expect, it, vi } from "vitest";
import { scoreAttempt } from "../../../lib/complete";
import {
  type Attempt,
  type Run,
  finalMath,
  loadAttempt,
  roundMath,
  startRound2,
  statusLine,
  stillPolling,
} from "./attempt";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
beforeEach(() => fetchMock.mockReset());

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const rejects = () => Promise.reject(new TypeError("Failed to fetch"));

function run(over: Partial<Run> = {}): Run {
  return {
    id: "r1", status: "done", errorKind: null, errorMessage: null, generatedCode: "print(1)",
    promptTokens: 100, completionTokens: 100, accuracy: 1, perfScore: 1, runScore: 1,
    excludedFromRanking: false, model: { displayName: "Qwen" },
    tests: [], benchmarks: [], ...over,
  };
}

const attempt = (rounds: { index: number; runs: Run[] }[], over: Partial<Attempt> = {}): Attempt => ({
  id: "a1", status: "active", finalScore: null, totalTokens: 0,
  challenge: { slug: "rate-limiter", title: "Rate Limiter", parTokens: 1000, referenceMs: 100 },
  rounds, ...over,
});

describe("loadAttempt", () => {
  it("returns the attempt on 200", async () => {
    const body = attempt([]);
    fetchMock.mockResolvedValueOnce(reply(200, body));

    expect(await loadAttempt("a1")).toEqual({ ok: true, attempt: body });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/attempts/a1");
  });

  // A dropped connection may come back, so the poller keeps going.
  it("marks a network rejection retryable", async () => {
    fetchMock.mockImplementationOnce(rejects);

    expect(await loadAttempt("a1")).toEqual({
      ok: false, error: "network error, retrying…", retry: true,
    });
  });

  // R67: an expired session returns the same 401 forever, so "retrying" would
  // be a promise the page can never keep. The server's own message reaches the
  // user, and polling stops.
  it("surfaces the server's message on 401 and stops retrying", async () => {
    fetchMock.mockResolvedValueOnce(reply(401, { error: "login required" }));

    expect(await loadAttempt("a1")).toEqual({
      ok: false, error: "login required", retry: false, status: 401,
    });
  });

  it("stops retrying on a 404 for someone else's attempt", async () => {
    fetchMock.mockResolvedValueOnce(reply(404, { error: "not found" }));

    expect(await loadAttempt("a1")).toMatchObject({ error: "not found", retry: false });
  });

  it("falls back to the status code when the failure body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>502</html>", { status: 502 }));

    expect(await loadAttempt("a1")).toMatchObject({
      error: "the server returned 502", retry: false, status: 502,
    });
  });

  it("refuses a 200 whose body is not an attempt rather than crashing the render", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 200 }));

    expect(await loadAttempt("a1")).toEqual({
      ok: false, error: "the server sent an unreadable response", retry: false,
    });
  });
});

// R13: every one of these renders as "nothing happened" if the response is
// discarded, which is what the plan's version did.
describe("startRound2", () => {
  it("reports success as no error", async () => {
    fetchMock.mockResolvedValueOnce(reply(201, { roundId: "r", index: 1 }));

    expect(await startRound2("a1")).toBeNull();
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  // 200, not an error: round 1 left no eligible model, so the route voided the
  // attempt instead of creating round 2. Nothing to report, and nothing to
  // switch to -- which is why the caller must not assume round 1 now exists.
  it("treats a voiding response as success", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { voided: true }));

    expect(await startRound2("a1")).toBeNull();
  });

  it.each([
    [400, "token cap for this attempt reached"],
    [409, "round 2 already started"],
    [409, "round 1 still running"],
    [503, "no active models for this challenge"],
    [401, "login required"],
  ])("surfaces the %i the route actually returns", async (status, error) => {
    fetchMock.mockResolvedValueOnce(reply(status, { error }));

    expect(await startRound2("a1")).toBe(error);
  });

  it("falls back when the body carries no usable message", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>500</html>", { status: 500 }));

    expect(await startRound2("a1")).toBe("could not start round 2");
  });

  it("reports a network rejection instead of rejecting out of the handler", async () => {
    fetchMock.mockImplementationOnce(rejects);

    expect(await startRound2("a1")).toBe("network error, try again");
  });
});

describe("roundMath", () => {
  it("pairs the largest weight with the worst run (spec L34)", () => {
    const m = roundMath([
      run({ id: "a", runScore: 1 }),
      run({ id: "b", runScore: 0.5 }),
      run({ id: "c", runScore: 0.25 }),
      run({ id: "d", runScore: 0 }),
    ]);

    expect(m.rows.map((r) => [r.run.id, r.weight])).toEqual([
      ["d", 8 / 15], ["c", 4 / 15], ["b", 2 / 15], ["a", 1 / 15],
    ]);
    expect(m.subtotal).toBeCloseTo(0.25 * (4 / 15) + 0.5 * (2 / 15) + 1 * (1 / 15), 12);
  });

  // The load-bearing case. This run has errorKind null, so the plan's
  // `errorKind !== "platform"` filter would COUNT it and renormalize the
  // weights over 3 models where the server used 2 -- a math strip that does
  // not match the score the server computed (R53/R55/R56).
  it("honours excludedFromRanking on a run that is not a platform error", () => {
    const m = roundMath([
      run({ id: "a", runScore: 1 }),
      run({ id: "b", runScore: 0.5 }),
      run({ id: "gone", runScore: 0.9, errorKind: null, excludedFromRanking: true }),
    ]);

    expect(m.rows.map((r) => r.run.id)).toEqual(["b", "a"]);
    expect(m.rows.map((r) => r.weight)).toEqual([2 / 3, 1 / 3]);
    expect(m.excluded.map((r) => r.id)).toEqual(["gone"]);
  });

  it("excludes a platform error and renormalizes over the survivors", () => {
    const m = roundMath([
      run({ id: "a", runScore: 1 }),
      run({ id: "b", runScore: 0.5 }),
      run({ id: "p", status: "error", errorKind: "platform", runScore: null, excludedFromRanking: true }),
    ]);

    expect(m.rows.map((r) => r.weight)).toEqual([2 / 3, 1 / 3]);
    expect(m.subtotal).toBeCloseTo(0.5 * (2 / 3) + 1 * (1 / 3), 12);
  });

  it("returns an empty table rather than throwing when every run is excluded", () => {
    const m = roundMath([run({ excludedFromRanking: true })]);

    expect(m).toMatchObject({ rows: [], subtotal: 0 });
  });
});

// Spec L20: the displayed decomposition has to reconstruct the score the
// server actually computed. Both sides are driven from ONE fixture, with the
// flag set exactly as Task 15's route sets it, so a divergence in the ranking
// rule fails here rather than shipping a strip that quietly disagrees.
describe("finalMath reproduces the server's score", () => {
  const toScored = (r: Run) => ({
    errorKind: r.errorKind, score: r.runScore ?? 0,
    promptTokens: r.promptTokens ?? 0, completionTokens: r.completionTokens ?? 0,
  });

  const check = (r0: Run[], r1: Run[], par: number) => {
    const counted = (rs: Run[]) => rs.filter((r) => !r.excludedFromRanking).map(toScored);
    const server = scoreAttempt(counted(r0), counted(r1), par);
    if (server.kind !== "scored") throw new Error("fixture voided");
    const a = attempt([{ index: 0, runs: r0 }, { index: 1, runs: r1 }], {
      status: "completed", finalScore: server.finalScore, totalTokens: server.totalTokens,
      challenge: { slug: "s", title: "T", parTokens: par, referenceMs: 100 },
    });
    return { server, client: finalMath(a)! };
  };

  it("agrees on a plain four-model attempt", () => {
    const scores = [1, 0.8, 0.6, 0.4];
    const { server, client } = check(
      scores.map((s, i) => run({ id: `a${i}`, runScore: s })),
      scores.map((s, i) => run({ id: `b${i}`, runScore: s * 0.9 })),
      100000,
    );

    expect(client.total).toBeCloseTo(server.finalScore, 10);
    expect(client.factor).toBe(1);
  });

  it("agrees when the token factor bites", () => {
    const four = () => [run({ id: "a", runScore: 1 }), run({ id: "b", runScore: 0.5 })];
    // 800 tokens against a par of 400: the factor is a real fraction, not the
    // floor and not 1.
    const mid = check(four(), four(), 400);
    expect(mid.client.total).toBeCloseTo(mid.server.finalScore, 10);
    expect(mid.client.factor).toBeCloseTo(0.5, 12);

    // par 100 would give 0.125; the floor holds it at 0.25 (spec L36).
    const floored = check(four(), four(), 100);
    expect(floored.client.total).toBeCloseTo(floored.server.finalScore, 10);
    expect(floored.client.factor).toBe(0.25);
  });

  // R53: a model deactivated between rounds has a round-0 run and no round-1
  // run, so BOTH of its rounds are excluded -- and its tokens leave the total
  // too. The client reads that off the flag; getting it wrong moves both the
  // weights and the token factor.
  it("agrees when a model was deactivated between rounds", () => {
    const { server, client } = check(
      [
        run({ id: "a", runScore: 1 }),
        run({ id: "b", runScore: 0.5 }),
        run({ id: "gone", runScore: 0.9, excludedFromRanking: true, promptTokens: 5000, completionTokens: 5000 }),
      ],
      [run({ id: "c", runScore: 1 }), run({ id: "d", runScore: 0.5 })],
      1000,
    );

    expect(client.total).toBeCloseTo(server.finalScore, 10);
    expect(client.build).toBeCloseTo(0.5 * (2 / 3) + 1 * (1 / 3), 12);
    // The excluded run's 10000 tokens are not in the scoring total.
    expect(server.totalTokens).toBe(800);
  });

  it("agrees when a platform error takes a model out of one round", () => {
    const { server, client } = check(
      [run({ id: "a", runScore: 1 }), run({ id: "b", runScore: 0.5 })],
      [
        run({ id: "c", runScore: 1 }),
        run({ id: "p", status: "error", errorKind: "platform", runScore: null, excludedFromRanking: true }),
      ],
      100000,
    );

    expect(client.total).toBeCloseTo(server.finalScore, 10);
    expect(client.extend).toBe(1);
  });

  // R69: the strip printed rounded intermediates under a total computed at
  // full precision, so the worked equation did not multiply out -- 0.7723 x
  // 0.333 x 100 = 25.72 under a printed 25.74. The bold number was never
  // wrong; what broke was spec L20 for the one audience that checks it.
  it("prints an equation that multiplies out by hand", () => {
    // 6 runs x 500 tokens = 3000 scored against a par of 1000: a factor of
    // exactly 1/3, the shape whose decimal rounding moved a printed cent. The
    // earlier fixtures all landed on a factor of 1.000, where it cannot.
    const side = (k: number) =>
      [1, 0.8, 0.6].map((v, i) =>
        run({ id: `${k}-${i}`, runScore: v * k, promptTokens: 250, completionTokens: 250 }));
    const { server, client } = check(side(1), side(0.9), 1000);
    const t = client.text;

    expect(server.totalTokens).toBe(3000);
    expect(t.factor).toBe("1000 ÷ 3000");
    // Multiply the printed digits, left to right, exactly as printed.
    const [par, scored] = t.factor.split(" ÷ ").map(Number);
    expect((((Number(t.weighted) * par) / scored) * 100).toFixed(2)).toBe(t.total);
    // The addition above the line reproduces the sum below it.
    expect((0.4 * Number(t.build) + 0.6 * Number(t.extend)).toFixed(6)).toBe(t.weighted);
    // And the bold number is still the server's own, never a product of these
    // strings -- which is why the ratio, not more decimals, is the fix.
    expect(t.total).toBe(server.finalScore.toFixed(2));
    // Discriminating: the rounded decimal this replaced prints a different
    // cent, so reverting to it fails here rather than shipping quietly.
    expect((Number(t.weighted) * Number(client.factor.toFixed(3)) * 100).toFixed(2)).not.toBe(
      t.total,
    );
  });

  it("prints a clamped token factor as itself rather than as a ratio", () => {
    const two = () => [run({ id: "x", runScore: 1 }), run({ id: "y", runScore: 0.5 })];
    // par 100000 over 800 tokens: min() clamps to 1, which is not the ratio.
    expect(check(two(), two(), 100000).client.text.factor).toBe("1");
    // par 100 over 800 would be 0.125; the floor holds it at 0.25 (spec L36).
    expect(check(two(), two(), 100).client.text.factor).toBe("0.25");
  });

  it("shows nothing until the attempt is scored", () => {
    expect(finalMath(attempt([], { status: "active" }))).toBeNull();
    expect(finalMath(attempt([], { status: "voided" }))).toBeNull();
    expect(finalMath(attempt([], { status: "completed", finalScore: null }))).toBeNull();
  });
});

describe("statusLine", () => {
  it("announces progress while runs are still landing", () => {
    expect(
      statusLine(attempt([{ index: 0, runs: [run(), run({ status: "generating" })] }])),
    ).toBe("1 of 2 model runs finished.");
  });

  it("announces the final score once scored", () => {
    expect(statusLine(attempt([], { status: "completed", finalScore: 86.6666 }))).toBe(
      "Attempt complete. Final score 86.7 out of 100.",
    );
  });

  it("has something to say about an attempt with no rounds", () => {
    expect(statusLine(attempt([]))).toBe("This attempt has no rounds.");
  });
});

// R18: the plan's interval never stopped.
describe("stillPolling", () => {
  const pending = attempt([{ index: 0, runs: [run({ status: "pending" })] }]);
  const done = attempt([{ index: 0, runs: [run()] }]);

  it("polls while any run is not terminal", () => {
    expect(stillPolling(pending, null)).toBe(true);
  });

  it("stops once every run is terminal", () => {
    expect(stillPolling(done, null)).toBe(false);
    expect(stillPolling(attempt([], { status: "completed" }), null)).toBe(false);
  });

  // Nothing will ever arrive for an attempt with no rounds.
  it("stops on an attempt with no rounds", () => {
    expect(stillPolling(attempt([]), null)).toBe(false);
  });

  // Keeps the page recoverable: a blip mid-poll, or a failed reload right
  // after starting round 2, heals on the next tick instead of freezing.
  it("keeps polling through a retryable failure, including before the first load", () => {
    expect(stillPolling(null, { poll: true })).toBe(true);
    expect(stillPolling(done, { poll: true })).toBe(true);
  });

  // The one the live run caught: the last good copy of an in-flight attempt
  // still has pending runs in it forever, so keying on the data alone polls a
  // dead session every two seconds until the tab is closed.
  it("stops dead on a fatal failure even while the last copy shows pending runs", () => {
    expect(stillPolling(pending, { poll: false })).toBe(false);
    expect(stillPolling(null, { poll: false })).toBe(false);
  });
});
