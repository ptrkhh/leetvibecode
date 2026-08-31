import { describe, expect, it } from "vitest";
import { computeRunScore, scoreAttempt } from "./complete";

const facts = (over = {}) => ({
  errorKind: null as string | null,
  tests: [{ passed: true }, { passed: true }, { passed: false }, { passed: true }],
  bench: [{ timeMs: 60, timedOut: false }, { timeMs: 60, timedOut: false }],
  ...over,
});

describe("computeRunScore", () => {
  it("combines accuracy and perf per spec", () => {
    // accuracy 0.75; subMs 120 vs ref 100 → perf 5/6; R = 0.75 × (0.7 + 0.3×5/6)
    const r = computeRunScore(facts(), 100);
    expect(r.accuracy).toBeCloseTo(0.75);
    expect(r.perf).toBeCloseTo(100 / 120);
    expect(r.score).toBeCloseTo(0.75 * (0.7 + 0.3 * (100 / 120)));
  });
  it("submission fault scores 0", () =>
    expect(computeRunScore(facts({ errorKind: "submission", tests: [], bench: [] }), 100).score).toBe(0));
  it("zero accuracy scores 0 without bench", () =>
    expect(computeRunScore(facts({ tests: [{ passed: false }], bench: [] }), 100).score).toBe(0));
  it("bench timeout zeroes perf but keeps 70% of accuracy", () => {
    const r = computeRunScore(facts({ bench: [{ timeMs: 0, timedOut: true }] }), 100);
    expect(r.score).toBeCloseTo(0.75 * 0.7);
  });

  // referenceMs and the summed bench times are the same quantity in the same
  // units on both sides of min(1, ref/sub) — a plain sum of per-size medians
  // in ms (Task 9/11). These two pin that: no unit conversion, and beating
  // the reference caps perf at 1 rather than paying a bonus.
  it("sums bench times across input sizes, in the same ms units as referenceMs", () => {
    const r = computeRunScore(facts({ bench: [{ timeMs: 30, timedOut: false }, { timeMs: 70, timedOut: false }] }), 50);
    expect(r.perf).toBeCloseTo(50 / 100);
  });
  it("caps perf at 1 when the submission beats the reference", () => {
    const r = computeRunScore(facts({ bench: [{ timeMs: 10, timedOut: false }] }), 100);
    expect(r.perf).toBe(1);
    expect(r.score).toBeCloseTo(0.75);
  });

  // R10 / Task 10 deferred minor: a run that fails INSIDE the test phase
  // leaves errorKind NULL (the judge's only status="error" writer, _fail,
  // always sets a kind; handle_test's terminal write is status="done" with
  // errorKind untouched). Accepting that rests entirely on these four shapes
  // zeroing through the accuracy===0 path instead of the errorKind path — so
  // each one is pinned here with errorKind explicitly null.
  it.each([
    ["test phase sandbox timeout (no test rows written)", { tests: [], bench: [] }, 0],
    ["sandbox crash / collection error (no test rows written)", { tests: [], bench: [] }, 0],
    ["every test failed", { tests: [{ passed: false }, { passed: false }], bench: [] }, 0],
  ])("zeroes %s through accuracy, with errorKind still null", (_label, over, expected) => {
    const f = facts({ errorKind: null, ...over });
    expect(f.errorKind).toBeNull();
    expect(computeRunScore(f, 100).score).toBe(expected);
  });
  it("bench timeout with errorKind still null keeps accuracy but zeroes perf", () => {
    // the 4th shape: the bench phase timed out, so run_bench emits a single
    // sentinel row with timedOut=true and the run still lands status="done".
    const f = facts({ errorKind: null, bench: [{ timeMs: 0, timedOut: true }] });
    const r = computeRunScore(f, 100);
    expect(r.perf).toBe(0);
    expect(r.score).toBeCloseTo(0.75 * 0.7);
  });
});

const run = (score: number, errorKind: string | null = null, tokens = 500) =>
  ({ errorKind, score, promptTokens: tokens / 2, completionTokens: tokens / 2 });

describe("scoreAttempt", () => {
  it("golden path matches the scoring-engine snapshot", () => {
    const r0 = [run(1.0), run(0.85), run(0.7), run(0.0)];             // 2000 tokens
    const r1 = [run(0.3), run(0.6), run(0.9), run(0, "platform", 500)]; // survivors 1500, plat 500
    const out = scoreAttempt(r0, r1, 2500); // total counted = 3500 → tf = 2500/3500
    expect(out.kind).toBe("scored");
    if (out.kind === "scored") {
      expect(out.totalTokens).toBe(3500);
      expect(out.finalScore).toBeCloseTo(
        (0.4 * (5.5 / 15) + 0.6 * (3.3 / 7)) * (2500 / 3500) * 100, 4);
    }
  });
  // R7: parTokens is sized for the WHOLE attempt (all counted runs in both
  // rounds), not for one generation. The golden case above spends 3500 across
  // 7 counted runs against par 2500 → tf = 5/7, comfortably off the floor.
  // A par sized for a single generation instead pins tf on its 0.25 floor and
  // caps every score at 25/100 — that is what this asserts is NOT happening.
  it("token factor is par vs the total across all counted runs in both rounds", () => {
    const r0 = [run(1.0), run(1.0), run(1.0), run(1.0)];
    const r1 = [run(1.0), run(1.0), run(1.0), run(1.0)];
    const perGeneration = scoreAttempt(r0, r1, 500);   // par sized for ONE run
    const wholeAttempt = scoreAttempt(r0, r1, 4000);   // par sized for the attempt
    expect(perGeneration.kind).toBe("scored");
    if (perGeneration.kind === "scored" && wholeAttempt.kind === "scored") {
      expect(perGeneration.totalTokens).toBe(4000);
      expect(wholeAttempt.totalTokens).toBe(4000);
      expect(perGeneration.finalScore).toBeCloseTo(25); // floored — the R7 failure mode
      expect(wholeAttempt.finalScore).toBeCloseTo(100);
    }
  });
  it("platform-errored tokens are excluded from the total (infra-luck invariant)", () => {
    const out = scoreAttempt([run(1.0), run(0.5, "platform", 9999)], [run(1.0)], 2500);
    if (out.kind === "scored") expect(out.totalTokens).toBe(1000);
    expect(out.kind).toBe("scored");
  });
  it("voids when a round has no surviving runs", () =>
    expect(scoreAttempt([run(0, "platform"), run(0, "platform")], [], 2500).kind).toBe("voided"));
  // A submission-fault run is NOT a platform fault: it stays in the ranking
  // with its 0, which is the whole point of the platform/submission split.
  it("keeps submission-fault runs in the ranking and their tokens in the total", () => {
    const out = scoreAttempt([run(1.0), run(0, "submission")], [run(1.0), run(1.0)], 2500);
    expect(out.kind).toBe("scored");
    if (out.kind === "scored") {
      expect(out.totalTokens).toBe(2000);
      // worst-weighted: the 0 takes 2/3 of round 1's weight
      expect(out.finalScore).toBeCloseTo((0.4 * (1 / 3) + 0.6 * 1) * (2500 / 2000 > 1 ? 1 : 2500 / 2000) * 100, 4);
    }
  });
});
