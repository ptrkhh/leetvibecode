// Everything the dashboard does that is not JSX: the two requests it makes and
// the math it renders. Extracted so it is testable -- vitest cannot import
// .tsx in this project (no jsx transform, no DOM env), which is the precedent
// Tasks 17 and 18 set rather than adding a DOM environment for one page.
//
// The math half exists because of spec L20: "every score is decomposable into
// its parts". The dashboard is where that promise is kept, so the numbers it
// shows must be the SAME numbers the server scored with -- see the equality
// test in attempt.test.ts, which runs a fixture through scoreAttempt and
// through finalMath and asserts they agree.
import { modelWeights, tokenFactor } from "../../../lib/scoring";

// Exactly the fields GET /api/attempts/[id] returns (Task 15's SELECT plus the
// computed excludedFromRanking), and nothing invented. referenceMs is present
// deliberately (R52/R11): perfScore cannot be explained without the bar it was
// measured against, and the spec forbids black-box numbers. The response also
// carries model.openrouterId -- the join key Task 15's `counted` predicate
// runs on -- which nothing here renders.
export type Run = {
  id: string;
  status: string;
  errorKind: string | null;
  errorMessage: string | null;
  generatedCode: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  accuracy: number | null;
  perfScore: number | null;
  runScore: number | null;
  // R55/R56: the SERVER's answer to "does this run count toward its round's
  // ranking". Two independent rules make it true -- a platform fault, and
  // having no round-1 run at all (deactivated mid-attempt, or platform-errored
  // in round 0 and skipped at fan-out). Re-deriving either here is exactly the
  // duplication R55 added the field to prevent, and re-deriving only the first
  // is the half-right version that shows weights the server did not use.
  excludedFromRanking: boolean;
  model: { displayName: string };
  tests: { name: string; passed: boolean; message: string | null; runtimeMs: number }[];
  benchmarks: { inputSize: number; timeMs: number; memoryMb: number | null; timedOut: boolean }[];
};
export type Round = { index: number; runs: Run[] };
export type Attempt = {
  id: string;
  status: string;
  finalScore: number | null;
  totalTokens: number;
  challenge: { slug: string; title: string; parTokens: number; referenceMs: number };
  rounds: Round[];
};

const TERMINAL = ["done", "error"];
export const isTerminal = (r: Run) => TERMINAL.includes(r.status);
export const tokensOf = (r: Run) => (r.promptTokens ?? 0) + (r.completionTokens ?? 0);

const NETWORK = "network error, retrying…";

export type LoadResult =
  | { ok: true; attempt: Attempt }
  // retry=true means the failure may clear on its own, so the poller keeps
  // going; false means it never will (401, 404, 500) and polling stops. R67:
  // "try again" against a dead session is advice that can never succeed, so
  // the server's own message is surfaced instead, and `status` lets the page
  // offer the one action that does work.
  | { ok: false; error: string; retry: boolean; status?: number };

// A 500, a proxy error page or a truncated body is not JSON. Same extraction
// the sibling submit.ts uses, for the same reason (R67).
async function serverError(res: Response, fallback: string) {
  const data = await res.json().catch(() => null);
  return typeof data?.error === "string" ? data.error : fallback;
}

export async function loadAttempt(id: string): Promise<LoadResult> {
  let res: Response;
  try {
    res = await fetch(`/api/attempts/${id}`, { cache: "no-store" });
  } catch {
    return { ok: false, error: NETWORK, retry: true };
  }
  if (!res.ok)
    return {
      ok: false,
      error: await serverError(res, `the server returned ${res.status}`),
      retry: false,
      status: res.status,
    };
  const data = await res.json().catch(() => null);
  // Without this a truncated or non-JSON 200 renders as a crash inside
  // .rounds.map rather than as a message.
  if (!data || !Array.isArray(data.rounds))
    return { ok: false, error: "the server sent an unreadable response", retry: false };
  return { ok: true, attempt: data as Attempt };
}

// R13: the round POST answers 400 (token cap), 409 (already started / round 1
// still running / attempt finished), 503 (no eligible models) and 401.
// Discarding the response renders every one of them as "nothing happened".
// Returns null on success, otherwise the message to show.
//
// A 200 {voided:true} is a SUCCESS with no round 2 created: round 1 left no
// eligible model, so the route voided the attempt. Nothing to report and
// nothing to switch to -- the reload that follows shows the voided banner,
// which is why the caller must not assume round 1 exists afterwards.
export async function startRound2(id: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`/api/attempts/${id}/rounds`, { method: "POST" });
  } catch {
    return "network error, try again";
  }
  return res.ok ? null : await serverError(res, "could not start round 2");
}

export type WeightedRow = { run: Run; weight: number; contribution: number };
export type RoundMath = { rows: WeightedRow[]; subtotal: number; excluded: Run[] };

// The weight table for one round, in the order the spec ranks it: worst first,
// so rows[0] carries the largest weight (spec L34). Ties cannot change the
// subtotal, since swapping equal scores between two weights sums the same.
//
// `runScore ?? 0` is a formality, not a fallback: the route persists a score
// for every terminal counted run (done -> computed, non-platform error -> 0),
// and platform runs -- the only ones left null -- are excluded here. R18 is
// what keeps it a formality: the caller only renders this once the round is
// terminal, so a pending run never reaches it and there is no all-zero table.
export function roundMath(runs: Run[]): RoundMath {
  const ranked = runs
    .filter((r) => !r.excludedFromRanking)
    .sort((a, b) => (a.runScore ?? 0) - (b.runScore ?? 0));
  const w = ranked.length ? modelWeights(ranked.length) : [];
  const rows = ranked.map((run, i) => ({
    run,
    weight: w[i],
    contribution: (run.runScore ?? 0) * w[i],
  }));
  return {
    rows,
    subtotal: rows.reduce((a, r) => a + r.contribution, 0),
    excluded: runs.filter((r) => r.excludedFromRanking),
  };
}

export type FinalMath = {
  build: number;
  extend: number;
  weighted: number;
  factor: number;
  total: number;
};

// The whole formula, so a player can check the arithmetic: spec L40,
// [0.4 x weighted_round1 + 0.6 x weighted_round2] x token_factor, x100.
// Only for a completed attempt -- a voided one has no score, and an active one
// has no totalTokens (the column is written once, at completion).
export function finalMath(a: Attempt): FinalMath | null {
  if (a.status !== "completed" || a.finalScore === null) return null;
  const subtotal = (i: number) =>
    roundMath(a.rounds.find((r) => r.index === i)?.runs ?? []).subtotal;
  const [build, extend] = [subtotal(0), subtotal(1)];
  const weighted = 0.4 * build + 0.6 * extend;
  // The SCORING total (survivors only, R53's corollary), not the live spend --
  // which is why it is read off the attempt rather than summed from the runs.
  const factor = tokenFactor(a.challenge.parTokens, a.totalTokens);
  return { build, extend, weighted, factor, total: weighted * factor * 100 };
}

// The polite live region's content. Results arrive by polling, so without this
// a screen-reader user is never told anything landed. It changes only on real
// transitions (a run going terminal, the attempt finishing), never on every
// 2-second poll.
export function statusLine(a: Attempt): string {
  if (a.status === "completed")
    return `Attempt complete. Final score ${a.finalScore?.toFixed(1)} out of 100.`;
  if (a.status === "voided") return "Attempt voided. Every model hit a platform error.";
  const runs = a.rounds.flatMap((r) => r.runs);
  if (runs.length === 0) return "This attempt has no rounds.";
  const done = runs.filter(isTerminal).length;
  return done === runs.length
    ? `All ${runs.length} model runs finished.`
    : `${done} of ${runs.length} model runs finished.`;
}

// R18: stop once there is nothing left to wait for. Any non-terminal run means
// the judge is still working; everything else is a resting state -- a finished
// attempt, or a finished round 1 waiting on a human click -- and polling that
// is a request every two seconds for a page that will never change.
// startRound2 reloads inline, and its result puts pending runs back on the
// attempt, which restarts this.
//
// An outstanding failure OVERRIDES the data, in both directions, and getting
// that precedence wrong is not theoretical: keying only on the data polls a
// dead session forever, because the last good copy of an in-flight attempt
// still has pending runs in it and always will. So a failure that repeats
// forever (401, 404, 500) stops the loop dead, while one that may clear
// (a dropped connection) keeps it alive even when the page has no data yet.
export function stillPolling(attempt: Attempt | null, failure: { poll: boolean } | null): boolean {
  if (failure) return failure.poll;
  return !!attempt && attempt.rounds.some((r) => r.runs.some((x) => !isTerminal(x)));
}
