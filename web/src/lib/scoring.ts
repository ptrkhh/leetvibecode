export function perfScore(refMs: number, subMs: number, timedOut: boolean): number {
  if (timedOut || subMs <= 0) return 0;
  return Math.min(1, refMs / subMs);
}

export function runScore(accuracy: number, perf: number): number {
  return accuracy * (0.7 + 0.3 * perf);
}

export function modelWeights(n: number): number[] {
  if (n <= 0) throw new Error("no surviving runs");
  const denom = 2 ** n - 1;
  return Array.from({ length: n }, (_, i) => 2 ** (n - 1 - i) / denom);
}

export function weightedRound(scores: number[]): number {
  const sorted = [...scores].sort((a, b) => a - b); // worst first
  const w = modelWeights(sorted.length);
  return sorted.reduce((acc, s, i) => acc + s * w[i], 0);
}

export function tokenFactor(par: number, total: number): number {
  if (total <= 0) return 1;
  return Math.max(0.25, Math.min(1, par / total));
}

export function finalScore(r1: number, r2: number, tf: number): number {
  return (0.4 * r1 + 0.6 * r2) * tf * 100;
}
