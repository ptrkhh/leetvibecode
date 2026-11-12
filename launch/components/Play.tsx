'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { WaitlistForm } from '@/components/WaitlistForm';
import type { Challenge, ChallengeFiles } from '@/lib/challenges';
import { judge, warmUp, type TestResult } from '@/lib/judge';
import { MODELS } from '@/lib/models';
import { finalScore, roundScore, runScore, tokenFactor, type RankedRun } from '@/lib/scoring';

type Run = {
  /** excluded = platform fault (model or network), left out of the round's weights. */
  status: 'idle' | 'generating' | 'testing' | 'done' | 'excluded';
  note: string;
  content: string;
  code: string | null;
  tokens: number;
  tests: TestResult[];
  /** Reference time divided by this code's time, capped at 1. null = not measured. */
  speed: number | null;
  score: number;
};

type Reply = { content: string; code: string | null; promptTokens: number; completionTokens: number; mock: boolean };

const blankRun = (): Run => ({
  status: 'idle',
  note: '',
  content: '',
  code: null,
  tokens: 0,
  tests: [],
  speed: null,
  score: 0,
});
const blankRound = () => MODELS.map(blankRun);

const ROUNDS = ['Build', 'Extend'] as const;
const MAX_PROMPT = 4000;
const NO_ANSWER = 'The model did not answer. This run is left out of your score.';

const pct = (value: number) => Math.round(value * 100);
const readable = (testName: string) => testName.replace(/^test_/, '').replaceAll('_', ' ');
const settled = (runs: Run[]) => runs.every((run) => run.status === 'done' || run.status === 'excluded');

export function Play({ challenge, files }: { challenge: Challenge; files: ChallengeFiles }) {
  const [prompt, setPrompt] = useState('');
  const [rounds, setRounds] = useState<Run[][]>([blankRound(), blankRound()]);
  const [started, setStarted] = useState([false, false]);
  const [view, setView] = useState(0);
  const [busy, setBusy] = useState(false);
  const [mock, setMock] = useState(false);
  const [runtime, setRuntime] = useState<'loading' | 'ready' | 'failed'>('loading');

  // Start the Python download while the visitor is still writing.
  useEffect(() => {
    warmUp().then(
      () => setRuntime('ready'),
      () => setRuntime('failed'),
    );
  }, []);

  const patch = (round: number, model: number, change: Partial<Run>) =>
    setRounds((all) =>
      all.map((runs, r) => (r !== round ? runs : runs.map((run, m) => (m === model ? { ...run, ...change } : run)))),
    );

  async function runModel(round: number, model: number, history: string | undefined) {
    if (round === 1 && !history) {
      patch(round, model, { status: 'excluded', note: 'No round 1 reply to extend. Left out of this round.' });
      return;
    }
    patch(round, model, { status: 'generating' });

    let reply: Reply | null = null;
    let failure = NO_ANSWER;
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: challenge.slug, model, prompt, round1: history }),
      });
      const data = await response.json();
      if (response.ok) reply = data;
      else if (typeof data.error === 'string') failure = data.error;
    } catch {
      // network error or a non-JSON platform error: keep the default message
    }
    if (!reply) {
      patch(round, model, { status: 'excluded', note: failure });
      return;
    }

    if (reply.mock) setMock(true);
    const tokens = reply.promptTokens + reply.completionTokens;
    if (!reply.code) {
      patch(round, model, {
        status: 'done',
        content: reply.content,
        tokens,
        note: 'The reply had no code block. Ask for the answer as one Python code block.',
      });
      return;
    }

    patch(round, model, { status: 'testing', content: reply.content, code: reply.code, tokens });
    const suites = [{ name: 'build', src: files.testBuild }];
    if (round === 1) suites.push({ name: 'extend', src: files.testExtend });
    const result = await judge({
      harness: files.harness,
      code: reply.code,
      suites,
      bench: files.bench,
      reference: files.reference,
    });

    const passed = result.tests.filter((test) => test.passed).length;
    const accuracy = result.tests.length ? passed / result.tests.length : 0;
    const speed = result.sub_ms && result.ref_ms ? Math.min(1, result.ref_ms / result.sub_ms) : null;
    patch(round, model, {
      status: 'done',
      tests: result.tests,
      speed,
      score: runScore(accuracy, speed ?? 0),
      note: result.load_error
        ? `The code did not run. ${result.load_error}`
        : result.bench_error
          ? `The speed test failed. ${result.bench_error}`
          : '',
    });
  }

  async function runRound(round: 0 | 1) {
    const build = rounds[0];
    setBusy(true);
    setView(round);
    setStarted((flags) => flags.map((flag, r) => flag || r === round));
    setRounds((all) => all.map((runs, r) => (r === round ? blankRound() : runs)));
    await Promise.all(
      MODELS.map((_, model) => runModel(round, model, round === 1 ? build[model].content : undefined)),
    );
    setBusy(false);
  }

  function startOver() {
    setRounds([blankRound(), blankRound()]);
    setStarted([false, false]);
    setView(0);
  }

  // undefined = round not finished, null = void (every run excluded)
  const summaries = rounds.map((runs, r) =>
    started[r] && settled(runs) ? roundScore(runs.map((run) => (run.status === 'done' ? run.score : null))) : undefined,
  );
  const tokens = rounds.flat().reduce((sum, run) => sum + run.tokens, 0);
  const factor = tokenFactor(challenge.parTokens, tokens);
  const [build, extend] = summaries;
  const final = build && extend ? finalScore(build.score, extend.score, factor) : null;
  const viewed = summaries[view];

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-12">
      <header className="space-y-3">
        <p className="text-sm text-gray-400">
          <Link href="/#challenges" className="hover:text-white">
            Challenges
          </Link>{' '}
          / {challenge.difficulty}
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight text-white lg:text-5xl">{challenge.title}</h1>
      </header>

      {mock && (
        <p role="status" className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-amber-100">
          Demo mode: no model key is configured on this server, so the replies below are canned, not written by the
          models.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="task" className="surface space-y-4 p-6">
          <h2 id="task" className="font-display text-xl font-bold text-white">
            The task
          </h2>
          {challenge.brief.map((paragraph) => (
            <p key={paragraph} className="leading-relaxed text-gray-300">
              {paragraph}
            </p>
          ))}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-200">Required interface</h3>
            <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-4 text-sm text-emerald-100">
              <code>{challenge.interface}</code>
            </pre>
          </div>
          <p className="text-sm text-gray-400">
            Every model gets your prompt, this interface, and an instruction to answer with one Python code block.
            After round 1, each model gets one follow-up request in its own conversation.
          </p>
        </section>

        <section aria-labelledby="prompt-heading" className="surface flex flex-col gap-4 p-6">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="prompt-heading" className="font-display text-xl font-bold text-white">
              <label htmlFor="prompt">Your prompt</label>
            </h2>
            <span className="text-sm text-gray-400">
              {prompt.length} / {MAX_PROMPT}
            </span>
          </div>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            readOnly={started[0]}
            maxLength={MAX_PROMPT}
            rows={11}
            spellCheck={false}
            placeholder="Describe what to build. All four models read the same words."
            className="field flex-1 resize-y font-mono text-sm leading-relaxed read-only:opacity-70"
          />
          <ul aria-label="Models" className="flex flex-wrap gap-2 text-sm">
            {MODELS.map((model) => (
              <li key={model.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-gray-300">
                {model.name}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-4">
            {started[0] ? (
              <button type="button" onClick={startOver} disabled={busy} className="btn-secondary">
                Start over with a new prompt
              </button>
            ) : (
              <button
                type="button"
                onClick={() => runRound(0)}
                disabled={busy || !prompt.trim()}
                className="btn-primary"
              >
                Run on 4 models
              </button>
            )}
            <p role="status" className="text-sm text-gray-400">
              {runtime === 'loading' && 'Loading the Python test runner (about 10 MB, first visit only).'}
              {runtime === 'failed' && 'The Python test runner did not load. Reload the page to try again.'}
            </p>
          </div>
          <p className="text-sm text-gray-500">
            Your prompt is sent to third-party AI models through OpenRouter. Leave out personal or confidential
            details.
          </p>
        </section>
      </div>

      {started[0] && (
        <section aria-labelledby="results" className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 id="results" className="font-display text-3xl font-bold text-white">
              Results
            </h2>
            <div className="flex gap-2">
              {ROUNDS.map((name, r) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setView(r)}
                  disabled={!started[r]}
                  aria-pressed={view === r}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    view === r
                      ? 'border-brand-primary bg-brand-primary/15 text-white'
                      : 'border-white/15 text-gray-300 hover:border-white/30'
                  }`}
                >
                  Round {r + 1}: {name}
                </button>
              ))}
            </div>
          </div>

          <p role="status" className="sr-only">
            {busy ? `Running round ${view + 1}.` : viewed ? `Round ${view + 1} finished with ${pct(viewed.score)}.` : ''}
          </p>

          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
            {MODELS.map((model, m) => (
              <ModelCard
                key={model.id}
                name={model.name}
                maker={model.maker}
                run={rounds[view][m]}
                weight={viewed?.ranked.find((entry) => entry.index === m)?.weight ?? null}
              />
            ))}
          </div>

          {viewed && <RoundMath score={viewed.score} ranked={viewed.ranked} />}
          {viewed === null && (
            <div className="surface flex flex-wrap items-center justify-between gap-4 p-6">
              <p className="text-gray-200">No model answered, so this round does not count.</p>
              <button type="button" onClick={() => runRound(view as 0 | 1)} disabled={busy} className="btn-secondary">
                Run round {view + 1} again
              </button>
            </div>
          )}

          {build && !started[1] && (
            <div className="surface space-y-4 p-6">
              <h3 className="font-display text-xl font-bold text-white">Round 2: the follow-up request</h3>
              <p className="leading-relaxed text-gray-300">{challenge.followup}</p>
              <p className="text-sm text-gray-400">
                Each model extends its own round 1 code. The round 1 tests run again alongside the new ones, and this
                round counts for 60% of your score.
              </p>
              <button type="button" onClick={() => runRound(1)} disabled={busy} className="btn-primary">
                Run the follow-up
              </button>
            </div>
          )}

          {final !== null && build && extend && (
            <div className="surface space-y-6 p-8">
              <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                <p className="font-display text-7xl font-bold leading-none text-brand-primary">{Math.round(final)}</p>
                <p className="pb-2 text-lg text-gray-300">out of 100 on {challenge.title}</p>
              </div>
              <dl className="grid gap-4 text-sm sm:grid-cols-3">
                <Fact term="Build round, 40%" value={`${pct(build.score)}`} />
                <Fact term="Extend round, 60%" value={`${pct(extend.score)}`} />
                <Fact
                  term={`Token factor (${tokens.toLocaleString('en-US')} used, par ${challenge.parTokens.toLocaleString('en-US')})`}
                  value={`× ${factor.toFixed(2)}`}
                />
              </dl>
              <div className="flex flex-wrap gap-4">
                <button type="button" onClick={startOver} className="btn-primary">
                  Try a better prompt
                </button>
                <Link href="/#challenges" className="btn-secondary">
                  Pick another challenge
                </Link>
              </div>
              <div className="border-t border-white/10 pt-6">
                <h3 className="mb-1 font-display text-xl font-bold text-white">Want this score to count?</h3>
                <p className="mb-4 text-gray-300">
                  Accounts, leaderboards and more challenges are on the way. Leave your email and we will tell you when
                  they open.
                </p>
                <WaitlistForm />
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <dt className="text-gray-400">{term}</dt>
      <dd className="mt-1 font-display text-2xl font-bold text-white">{value}</dd>
    </div>
  );
}

function ModelCard({ name, maker, run, weight }: { name: string; maker: string; run: Run; weight: number | null }) {
  const passed = run.tests.filter((test) => test.passed).length;
  const working = run.status === 'generating' || run.status === 'testing';

  return (
    <article className="surface flex flex-col gap-4 p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold text-white">{name}</h3>
          <p className="text-sm text-gray-400">{maker}</p>
        </div>
        {run.status === 'done' ? (
          <p className="text-right">
            <span className="font-display text-4xl font-bold leading-none text-white">{pct(run.score)}</span>
            <span className="block text-xs text-gray-400">run score</span>
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-gray-300">
            {working && <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-brand-primary" />}
            {run.status === 'idle' && 'Waiting'}
            {run.status === 'generating' && 'Writing code'}
            {run.status === 'testing' && 'Running tests'}
            {run.status === 'excluded' && 'Left out'}
          </p>
        )}
      </header>

      {run.note && <p className="rounded-lg bg-white/5 px-3 py-2 text-sm text-amber-100">{run.note}</p>}

      {run.status === 'done' && (
        <dl className="space-y-2 text-sm">
          <Row term="Tests" value={run.tests.length ? `${passed} of ${run.tests.length} passed` : 'Not run'} />
          <Row
            term="Speed"
            value={
              run.speed === null
                ? 'Not measured'
                : run.speed >= 0.995
                  ? 'Matches the reference'
                  : `${pct(run.speed)}% of reference speed`
            }
          />
          <Row term="Tokens" value={run.tokens.toLocaleString('en-US')} />
          {weight !== null && <Row term="Weight in this round" value={`${pct(weight)}%`} />}
        </dl>
      )}

      {run.tests.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-200 hover:text-white">Test results</summary>
          <ul className="mt-3 space-y-2">
            {run.tests.map((test) => (
              <li key={`${test.suite}.${test.name}`} className="flex gap-2">
                <span aria-hidden="true" className={test.passed ? 'text-brand-primary' : 'text-red-400'}>
                  {test.passed ? '✓' : '✗'}
                </span>
                <span>
                  <span className="sr-only">{test.passed ? 'Passed: ' : 'Failed: '}</span>
                  <span className={test.passed ? 'text-gray-300' : 'text-white'}>{readable(test.name)}</span>
                  <span className="text-gray-500"> ({test.suite})</span>
                  {test.message && <span className="block break-words text-xs text-red-300">{test.message}</span>}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {run.content && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-200 hover:text-white">
            {run.code ? 'Generated code' : 'Model reply'}
          </summary>
          <pre className="mt-3 max-h-96 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 text-xs leading-relaxed text-gray-200">
            <code>{run.code ?? run.content}</code>
          </pre>
        </details>
      )}
    </article>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-400">{term}</dt>
      <dd className="text-right text-gray-100">{value}</dd>
    </div>
  );
}

/** Every score comes apart: the round score as the visible sum of its weighted runs. */
function RoundMath({ score, ranked }: { score: number; ranked: RankedRun[] }) {
  return (
    <div className="surface p-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <p>
          <span className="block text-sm text-gray-400">Round score</span>
          <span className="font-display text-5xl font-bold leading-none text-white">{pct(score)}</span>
        </p>
        <span aria-hidden="true" className="text-2xl text-gray-500">
          =
        </span>
        <ol className="flex flex-wrap items-center gap-x-3 gap-y-3" aria-label="Weighted runs, worst first">
          {ranked.map((entry, position) => (
            <li key={entry.index} className="flex items-center gap-3">
              {position > 0 && (
                <span aria-hidden="true" className="text-gray-500">
                  +
                </span>
              )}
              <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                <span className="block font-mono text-sm text-white">
                  {pct(entry.weight)}% × {pct(entry.score)}
                </span>
                <span className="block text-xs text-gray-400">{MODELS[entry.index].name}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <p className="mt-4 text-sm text-gray-400">
        Runs are ranked worst first. The worst run carries the most weight, so one weak model drags the round down.
      </p>
    </div>
  );
}
