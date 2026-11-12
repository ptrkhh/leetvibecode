// Scoring math from docs/superpowers/specs/2026-08-22-leetvibecode-mvp-design.md.
// Pure functions only; lib/scoring.test.ts is the check.

export const ROUND_WEIGHTS = [0.4, 0.6] as const; // build, extend
export const TOKEN_FLOOR = 0.25;

/** One model, one round. Accuracy gates everything: fast but wrong scores 0. */
export function runScore(accuracy: number, perf: number): number {
  return accuracy * (0.7 + 0.3 * perf);
}

/** Power-of-two weights, worst run first. Four runs give 8/15, 4/15, 2/15, 1/15. */
export function weights(count: number): number[] {
  const total = 2 ** count - 1;
  return Array.from({ length: count }, (_, i) => 2 ** (count - 1 - i) / total);
}

export type RankedRun = { index: number; score: number; weight: number };

/**
 * scores: one run score per model; null marks a platform fault, which is
 * excluded so the weights renormalize over the runs that did happen.
 * Returns null when every run was excluded (the round is void).
 */
export function roundScore(scores: (number | null)[]): { score: number; ranked: RankedRun[] } | null {
  const valid = scores
    .map((score, index) => ({ index, score }))
    .filter((run): run is { index: number; score: number } => run.score !== null)
    .sort((a, b) => a.score - b.score);
  if (valid.length === 0) return null;
  const w = weights(valid.length);
  const ranked = valid.map((run, i) => ({ ...run, weight: w[i] }));
  return { score: ranked.reduce((sum, run) => sum + run.score * run.weight, 0), ranked };
}

/** A modifier, never dominant: 1 at or under par, floored at 0.25. */
export function tokenFactor(par: number, total: number): number {
  if (total <= 0) return 1;
  return Math.max(TOKEN_FLOOR, Math.min(1, par / total));
}

/** Final score, 0 to 100. */
export function finalScore(build: number, extend: number, factor: number): number {
  return (ROUND_WEIGHTS[0] * build + ROUND_WEIGHTS[1] * extend) * factor * 100;
}
