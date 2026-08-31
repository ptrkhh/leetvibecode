import { finalScore, perfScore, runScore, tokenFactor, weightedRound } from "./scoring";

export type RunFacts = {
  errorKind: string | null;
  tests: { passed: boolean }[];
  bench: { timeMs: number; timedOut: boolean }[];
};

export function computeRunScore(f: RunFacts, referenceMs: number) {
  const total = f.tests.length;
  const accuracy = total === 0 ? 0 : f.tests.filter((t) => t.passed).length / total;
  if (f.errorKind === "submission" || accuracy === 0) return { accuracy, perf: 0, score: 0 };
  const timedOut = f.bench.length === 0 || f.bench.some((b) => b.timedOut);
  const subMs = f.bench.reduce((a, b) => a + b.timeMs, 0);
  const perf = perfScore(referenceMs, subMs, timedOut);
  return { accuracy, perf, score: runScore(accuracy, perf) };
}

export type ScoredRun = {
  errorKind: string | null;
  score: number;
  promptTokens: number;
  completionTokens: number;
};

export type Outcome =
  | { kind: "voided" }
  | { kind: "scored"; finalScore: number; totalTokens: number };

export function scoreAttempt(round0: ScoredRun[], round1: ScoredRun[], parTokens: number): Outcome {
  const survivors = (runs: ScoredRun[]) => runs.filter((r) => r.errorKind !== "platform");
  const [s0, s1] = [survivors(round0), survivors(round1)];
  if (s0.length === 0 || s1.length === 0) return { kind: "voided" };
  const totalTokens = [...s0, ...s1].reduce(
    (a, r) => a + r.promptTokens + r.completionTokens, 0);
  const score = finalScore(
    weightedRound(s0.map((r) => r.score)),
    weightedRound(s1.map((r) => r.score)),
    tokenFactor(parTokens, totalTokens));
  return { kind: "scored", finalScore: score, totalTokens };
}
