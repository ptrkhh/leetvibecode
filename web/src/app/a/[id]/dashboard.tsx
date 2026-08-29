"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  type Attempt,
  type Run,
  finalMath,
  isTerminal,
  loadAttempt,
  roundMath,
  startRound2,
  statusLine,
  stillPolling,
  tokensOf,
} from "./attempt";

const pct = (w: number) => `${(w * 100).toFixed(1)}%`;

export default function Dashboard({ id }: { id: string }) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  // `poll` is the poller's veto, not a property of the message: it means "this
  // failure does not stop the loop". See stillPolling.
  const [failure, setFailure] = useState<{ message: string; poll: boolean; status?: number } | null>(
    null,
  );
  // null = follow the newest round. The brief switched to round 1 with an
  // unconditional setTab(1) after starting it, which selects a round that does
  // not exist when the POST answers {voided:true} (round 1 left no eligible
  // model) or when the reload that follows fails. Following the newest round
  // that ACTUALLY exists cannot select a missing one, and needs no click after
  // round 2 lands.
  const [pinned, setPinned] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    const res = await loadAttempt(id);
    if (res.ok) {
      setAttempt(res.attempt);
      setFailure(null);
    } else {
      setFailure({ message: res.error, poll: res.retry, status: res.status });
    }
    return res.ok;
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const polling = stillPolling(attempt, failure);
  useEffect(() => {
    if (!polling) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [polling, load]);

  // Always rendered, never `{failure && ...}`: a live region has to be in the
  // accessibility tree BEFORE its content changes to be announced. Task 17
  // pins ids because getByRole("alert") is ambiguous app-wide -- Next injects
  // its own empty <div role="alert" id="__next-route-announcer__">.
  const errorRegion = (
    <p id="dashboard-error" role="alert" className="text-sm text-red-600">
      {failure?.message}
      {/* R67: a 401 never clears by itself, so "retrying" would be a message
          that can never come true. The one action that works is offered
          instead. safeCallbackUrl re-validates this on the way back out. */}
      {failure?.status === 401 && (
        <>
          {" "}
          <Link className="underline" href={`/login?callbackUrl=/a/${encodeURIComponent(id)}`}>
            Log in again
          </Link>
        </>
      )}
    </p>
  );

  if (!attempt)
    return (
      <div className="flex flex-col gap-4">
        {errorRegion}
        <p>{failure ? "Could not load this attempt." : "Loading…"}</p>
      </div>
    );

  const rounds = attempt.rounds;
  const shown =
    rounds.find((r) => r.index === pinned) ?? rounds[rounds.length - 1] ?? null;
  const round0 = rounds.find((r) => r.index === 0);
  const canStartRound2 =
    attempt.status === "active" &&
    !!round0 &&
    round0.runs.length > 0 &&
    round0.runs.every(isTerminal) &&
    !rounds.some((r) => r.index === 1);
  // Live spend across every run, platform-errored ones included -- the number
  // the per-attempt cap and the daily quota are measured against (spec L36,
  // R9). Not attempt.totalTokens, which is the survivors-only SCORING total
  // and stays 0 until completion.
  const spent = rounds.flatMap((r) => r.runs).reduce((a, x) => a + tokensOf(x), 0);
  // R18: a weight table over pending runs is a table of zeroes that means
  // nothing. Terminal-only, so it appears exactly when it becomes true.
  const terminal = shown && shown.runs.length > 0 && shown.runs.every(isTerminal);
  const math = terminal ? roundMath(shown.runs) : null;
  const final = finalMath(attempt);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-2xl font-bold">{attempt.challenge.title}</h1>
        <span className="text-sm text-gray-600">
          {spent} tokens spent · par {attempt.challenge.parTokens}
        </span>
        <span className="grow" />
        {/* aria-pressed, not a bare button: without it the selected round is
            conveyed by background colour alone and assistive technology reads
            two identical unselected buttons. */}
        <div role="group" aria-label="Round" className="flex gap-2">
          {rounds.map((r) => (
            <button
              key={r.index}
              type="button"
              aria-pressed={shown?.index === r.index}
              onClick={() => setPinned(r.index)}
              className={`rounded border px-3 py-1 text-sm ${
                shown?.index === r.index ? "bg-black text-white" : ""
              }`}
            >
              {r.index === 0 ? "Round 1 · build" : "Round 2 · extend"}
            </button>
          ))}
        </div>
      </header>

      {errorRegion}
      {/* Polite, not assertive: results land by polling every 2s and a screen
          reader is otherwise never told anything arrived. The text changes
          only when a run goes terminal or the attempt finishes. */}
      <p id="dashboard-status" role="status" className="text-sm text-gray-600">
        {statusLine(attempt)}
      </p>

      {rounds.length === 0 ? (
        // Reachable: POST /api/attempts creates the row before the round POST
        // runs, so any failure of the second request strands an attempt with
        // no rounds (Task 18). Nothing will ever appear here, and a page with
        // no cards, no tabs and no button reads as broken rather than as
        // empty.
        <p className="rounded border p-4">
          No prompt was ever submitted for this attempt, so there is nothing to show.{" "}
          <Link className="underline" href={`/c/${attempt.challenge.slug}`}>
            Start a new attempt
          </Link>
          .
        </p>
      ) : (
        <>
          {attempt.status === "completed" && attempt.finalScore !== null && (
            <div className="rounded border-2 border-black p-4 text-lg">
              Final score: <b>{attempt.finalScore.toFixed(2)}</b> / 100 ·{" "}
              <Link className="underline" href={`/leaderboard/${attempt.challenge.slug}`}>
                see leaderboard
              </Link>
            </div>
          )}
          {attempt.status === "voided" && (
            <div className="rounded border p-4">
              All models hit platform errors — this attempt is voided and not scored. Retry free of
              charge.
            </div>
          )}
          {canStartRound2 && (
            <button
              type="button"
              onClick={async () => {
                setStarting(true);
                const err = await startRound2(attempt.id);
                // Reloaded whether or not the POST reported success: a lost
                // response does not prove nothing was created (Task 18's R62),
                // and a 409 "round 2 already started" says outright that it
                // was. Refreshing first means the page shows what is really
                // there and the message explains the click, instead of the
                // page insisting round 2 never happened.
                const fresh = await load();
                if (err) {
                  // R63: only the failure path re-enables. On success the
                  // button unmounts (round 1 exists, or the attempt voided),
                  // and re-enabling before the reload lands would open a
                  // window for a second POST that can only earn a 409.
                  setStarting(false);
                  // A failed CLICK must not silence the poller when the server
                  // is answering fine -- the reload may have just revealed a
                  // round 2 whose runs are still pending.
                  setFailure({ message: err, poll: fresh });
                }
              }}
              disabled={starting}
              className="self-start rounded bg-black px-4 py-2 text-white disabled:opacity-50"
            >
              {starting ? "Starting…" : "Start round 2 (extension request)"}
            </button>
          )}

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            {shown?.runs.map((run) => (
              <ModelCard key={run.id} run={run} referenceMs={attempt.challenge.referenceMs} />
            ))}
          </div>

          {/* rows can be empty with runs present -- every run excluded, which is
              the all-platform round that voids an attempt. A table of no rows
              under a "round subtotal 0.000" reads as "this round scored zero",
              which is the opposite of what exclusion means, and each card
              already carries its own reason. */}
          {math && math.rows.length > 0 && (
            <section className="rounded border p-4 text-sm">
              <h2 className="mb-2 font-semibold">
                Weighted math — {shown?.index === 0 ? "round 1" : "round 2"} (worst model counts
                most)
              </h2>
              {math.rows.map((row) => (
                <div key={row.run.id}>
                  {pct(row.weight)} × {row.run.model.displayName} ({(row.run.runScore ?? 0).toFixed(3)}
                  ) = {row.contribution.toFixed(3)}
                </div>
              ))}
              <div className="mt-1 border-t pt-1">
                round subtotal <b>{math.subtotal.toFixed(3)}</b>
              </div>
              {math.excluded.length > 0 && (
                <p className="mt-2 text-gray-600">
                  Excluded from this ranking, with the weights renormalized over the rest: a run
                  that hit a platform error, and a model with no round 2 run at all — one
                  deactivated mid-attempt, or skipped because its round 1 run was a platform error.
                  Their scores still show on the cards above; they just do not count.
                </p>
              )}
            </section>
          )}

          {final && (
            <section className="rounded border p-4 text-sm">
              <h2 className="mb-2 font-semibold">How the final score was built</h2>
              <div>0.4 × round 1 ({final.build.toFixed(3)})</div>
              <div>+ 0.6 × round 2 ({final.extend.toFixed(3)})</div>
              <div className="border-t pt-1">= {final.weighted.toFixed(4)}</div>
              <div className="mt-2">
                token factor {final.factor.toFixed(3)} = min(1, par {attempt.challenge.parTokens} ÷{" "}
                {attempt.totalTokens} scored tokens), floored at 0.25
                {attempt.totalTokens !== spent && (
                  <>
                    {" "}
                    — {spent} tokens were spent in total; runs excluded from the ranking do not
                    count against the factor either
                  </>
                )}
              </div>
              <div className="mt-2 border-t pt-1">
                {final.weighted.toFixed(4)} × {final.factor.toFixed(3)} × 100 ={" "}
                <b>{final.total.toFixed(2)}</b>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function ModelCard({ run, referenceMs }: { run: Run; referenceMs: number }) {
  const [showCode, setShowCode] = useState(false);
  const benchMs = run.benchmarks.reduce((a, b) => a + b.timeMs, 0);
  const timedOut = run.benchmarks.some((b) => b.timedOut);
  return (
    // Named so the four cards are distinguishable to assistive technology --
    // and so a test can scope to one model's card instead of matching four
    // identical "show code" buttons.
    <article aria-labelledby={`run-${run.id}`} className="flex flex-col gap-2 rounded border p-3 text-sm">
      <div className="flex items-center gap-2">
        <h3 id={`run-${run.id}`} className="font-bold">
          {run.model.displayName}
        </h3>
        <span className="grow" />
        <span className="rounded bg-gray-100 px-2 dark:bg-gray-800">{run.status}</span>
      </div>
      {run.errorMessage && <p className="text-red-600">{run.errorMessage}</p>}
      {/* The flag decides WHETHER the run counts; errorKind only explains
          WHICH of the server's two rules made it true, since a platform fault
          is the only one that can be true on its own. */}
      {run.excludedFromRanking && (
        <p className="text-gray-600">
          Not counted in the ranking —{" "}
          {run.errorKind === "platform"
            ? "platform error, so it is excluded rather than scored 0"
            : "this model has no round 2 run, so both of its rounds are excluded"}
          .
        </p>
      )}
      {run.runScore !== null && (
        <p>
          score <b>{run.runScore.toFixed(3)}</b> = accuracy {(run.accuracy ?? 0).toFixed(2)} × (0.7 +
          0.3 × perf {(run.perfScore ?? 0).toFixed(2)}) · {tokensOf(run)} tokens
        </p>
      )}
      {/* R52: referenceMs is in this payload precisely so the perf number is
          not a black box (spec L20). Showing perf without the bar it was
          measured against is exactly the black-box number the spec forbids. */}
      {run.benchmarks.length > 0 && (
        <p className="text-gray-600">
          {timedOut
            ? "perf = 0 — a benchmark timed out"
            : `perf = min(1, reference ${referenceMs.toFixed(1)} ms ÷ ${benchMs.toFixed(1)} ms yours)`}
        </p>
      )}
      <ul>
        {/* Rendered verbatim. The stored name is "{classname}::{name}", and
            R37 established that splitting on "::" is a bug surface: the
            parametrize bracket is built from the parameter VALUE, so
            "test_build::test_echo[a::b]" makes .split("::").pop() yield "b]".
            The prefix is also information the player needs in round 2, where
            BOTH suites run (spec L17) and it is what says whether a failure is
            in the original tests or the new ones. */}
        {run.tests.map((t, i) => (
          <li key={i}>
            {t.passed ? "✅" : "❌"} {t.name}
            {t.message && <span className="text-gray-600"> — {t.message}</span>}
          </li>
        ))}
      </ul>
      {run.benchmarks.length > 0 && (
        <table className="text-xs">
          <tbody>
            {run.benchmarks.map((b) => (
              <tr key={b.inputSize}>
                <td className="pr-2">n={b.inputSize}</td>
                <td>{b.timedOut ? "timed out" : `${b.timeMs.toFixed(1)} ms`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {run.generatedCode && (
        <>
          <button
            type="button"
            aria-expanded={showCode}
            className="self-start underline"
            onClick={() => setShowCode(!showCode)}
          >
            {showCode ? "hide code" : "show code"}
          </button>
          {showCode && (
            <pre className="max-h-64 overflow-auto rounded bg-gray-100 p-2 text-xs dark:bg-gray-800">
              {run.generatedCode}
            </pre>
          )}
        </>
      )}
    </article>
  );
}
