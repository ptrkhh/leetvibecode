import { describe, expect, it } from "vitest";
import { finalScore, modelWeights, perfScore, runScore, tokenFactor, weightedRound } from "./scoring";

describe("perfScore", () => {
  it("caps at 1 when faster than reference", () => expect(perfScore(100, 50, false)).toBe(1));
  it("is ref/sub when slower", () => expect(perfScore(100, 200, false)).toBeCloseTo(0.5));
  it("is 0 on timeout regardless of times", () => expect(perfScore(100, 50, true)).toBe(0));
  it("is 0 on non-positive submission time", () => expect(perfScore(100, 0, false)).toBe(0));
  it("is 0 on negative submission time", () => expect(perfScore(100, -50, false)).toBe(0));
});

describe("runScore", () => {
  it("gates multiplicatively: fast-but-wrong = 0", () => expect(runScore(0, 1)).toBe(0));
  it("correct-and-slow keeps 70%", () => expect(runScore(1, 0)).toBeCloseTo(0.7));
  it("correct-and-fast = 1", () => expect(runScore(1, 1)).toBeCloseTo(1));
});

describe("modelWeights", () => {
  it("is [1] for a single surviving model", () => {
    const w = modelWeights(1);
    expect(w).toEqual([1]);
  });
  it("is [2/3, 1/3] for two models", () => {
    const w = modelWeights(2);
    expect(w[0]).toBeCloseTo(2 / 3);
    expect(w[1]).toBeCloseTo(1 / 3);
  });
  it("matches spec ≈53/27/13/7 for 4 models", () => {
    const w = modelWeights(4);
    expect(w[0]).toBeCloseTo(8 / 15);
    expect(w[1]).toBeCloseTo(4 / 15);
    expect(w[2]).toBeCloseTo(2 / 15);
    expect(w[3]).toBeCloseTo(1 / 15);
  });
  it("renormalizes for 3 survivors", () => {
    const w = modelWeights(3);
    expect(w).toHaveLength(3);
    expect(w[0]).toBeCloseTo(4 / 7);
    expect(w.reduce((a, b) => a + b)).toBeCloseTo(1);
  });
  it("sums to 1 and is strictly descending (worst-first) for n = 1..4", () => {
    for (let n = 1; n <= 4; n++) {
      const w = modelWeights(n);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
      for (let i = 0; i < w.length - 1; i++) {
        expect(w[i]).toBeGreaterThan(w[i + 1]);
      }
    }
  });
  it("throws on zero survivors", () => expect(() => modelWeights(0)).toThrow());
});

describe("weightedRound", () => {
  it("weights the worst most", () =>
    expect(weightedRound([1.0, 0.85, 0.7, 0.0])).toBeCloseTo(5.5 / 15));
  it("is order-insensitive", () =>
    expect(weightedRound([0.0, 1.0, 0.7, 0.85])).toBeCloseTo(5.5 / 15));
  it("handles a single survivor", () => expect(weightedRound([0.6])).toBeCloseTo(0.6));
});

describe("tokenFactor", () => {
  it("gives no bonus below par", () => expect(tokenFactor(2500, 1000)).toBe(1));
  it("decays above par", () => expect(tokenFactor(2500, 5000)).toBeCloseTo(0.5));
  it("floors at 0.25", () => expect(tokenFactor(2500, 1_000_000)).toBe(0.25));
  it("treats non-positive totals as 1", () => expect(tokenFactor(2500, 0)).toBe(1));
});

describe("finalScore", () => {
  it("pins the top of the scale: all-perfect rounds and full token factor = 100", () =>
    expect(finalScore(1, 1, 1)).toBe(100));
  it("pins the bottom of the scale: zero-scoring rounds = 0 regardless of token factor", () =>
    expect(finalScore(0, 0, 1)).toBe(0));
});

describe("golden snapshot (hand-computed end-to-end)", () => {
  it("matches the worked example", () => {
    const r1 = weightedRound([1.0, 0.85, 0.7, 0.0]); // 5.5/15
    const r2 = weightedRound([0.3, 0.6, 0.9]);       // 3.3/7 (one platform error excluded upstream)
    const tf = tokenFactor(2500, 3000);              // 0.8333…
    expect(finalScore(r1, r2, tf)).toBeCloseTo(35.79365, 4);
  });
});
