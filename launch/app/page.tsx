import Link from 'next/link';
import { WaitlistForm } from '@/components/WaitlistForm';
import { CHALLENGES } from '@/lib/challenges';
import { MODELS } from '@/lib/models';
import { roundScore } from '@/lib/scoring';

// Illustrative numbers for the hero figure, run through the real scoring code.
const EXAMPLE_SCORES = [0.4, 0.78, 0.92, 1];
const example = roundScore(EXAMPLE_SCORES)!;

const STEPS = [
  {
    title: 'Write one prompt',
    text: 'You get a task and the interface the code must expose. Describe what to build in your own words.',
  },
  {
    title: 'Four models build it',
    text: 'Each model writes code from your prompt. The code is tested and timed against a reference solution, and you see every result.',
  },
  {
    title: 'The same models extend it',
    text: 'A follow-up request lands in each conversation. The first tests still have to pass, so code that was hard to change loses points.',
  },
];

const SCORING = [
  {
    term: 'Run score',
    formula: 'tests passed × (0.7 + 0.3 × speed)',
    text: 'One model, one round. Fast but wrong scores zero. Correct and fast beats correct and slow by at most 30%.',
  },
  {
    term: 'Round score',
    formula: '53% worst + 27% + 13% + 7% best',
    text: 'Runs are ranked worst first. A prompt that only works on one model does not get far.',
  },
  {
    term: 'Final score',
    formula: '(40% build + 60% extend) × token factor',
    text: 'The extend round counts more. Spending far more tokens than par trims the total, down to a quarter at worst.',
  },
];

const HEADING = 'font-display text-4xl font-bold tracking-tight text-white lg:text-5xl';

export default function Home() {
  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:py-28">
        <div className="space-y-8">
          <h1 className="font-display text-5xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl">
            One prompt. Four models. <span className="text-brand-primary">Scored on the weakest.</span>
          </h1>
          <p className="max-w-xl text-xl leading-relaxed text-gray-300">
            LeetVibeCode measures how well you direct AI to write code. Write a single prompt, watch four small models
            build from it, and see exactly where each one passed or broke.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link href="#challenges" className="btn-primary">
              Play a challenge
            </Link>
            <Link href="#waitlist" className="btn-secondary">
              Join the waitlist
            </Link>
          </div>
          <p className="text-sm text-gray-400">Free to play. No account needed.</p>
        </div>

        <figure className="surface p-6">
          <figcaption className="mb-4 flex items-center justify-between gap-4">
            <span className="font-display text-lg font-bold text-white">How a round is scored</span>
            <span className="rounded-md border border-white/15 px-2 py-0.5 text-xs text-gray-400">Example</span>
          </figcaption>
          <p className="rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-sm leading-relaxed text-emerald-100">
            Write a token bucket rate limiter. Time comes from the caller, never from the clock…
          </p>
          <ol className="mt-5 space-y-3">
            {example.ranked.map((run) => (
              <li key={run.index} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate text-gray-200">{MODELS[run.index].name}</span>
                <span className="h-2 overflow-hidden rounded-full bg-white/10">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-brand-primary to-brand-primary-hover"
                    style={{ width: `${run.score * 100}%` }}
                  />
                </span>
                <span className="w-28 text-right font-mono text-gray-300">
                  {Math.round(run.score * 100)} × {Math.round(run.weight * 100)}%
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-5 flex items-baseline justify-between border-t border-white/10 pt-4">
            <span className="text-gray-400">Round score</span>
            <span className="font-display text-4xl font-bold text-white">{Math.round(example.score * 100)}</span>
          </p>
        </figure>
      </section>

      <section id="challenges" className="mx-auto max-w-6xl px-4 py-20">
        <h2 className={HEADING}>Pick a challenge</h2>
        <p className="mt-4 max-w-2xl text-lg text-gray-300">
          Each one takes a few minutes. The code is Python; your prompt can be in any style you like.
        </p>
        <ul className="mt-10 grid gap-6 md:grid-cols-3">
          {CHALLENGES.map((challenge) => (
            <li key={challenge.slug}>
              <Link
                href={`/play/${challenge.slug}`}
                className="surface flex h-full flex-col gap-3 p-6 transition-colors duration-300 hover:border-brand-primary/50"
              >
                <span className="text-sm text-brand-primary">{challenge.difficulty}</span>
                <span className="font-display text-2xl font-bold text-white">{challenge.title}</span>
                <span className="flex-1 leading-relaxed text-gray-300">{challenge.summary}</span>
                <span className="font-semibold text-white">Play this challenge</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-20">
        <h2 className={`${HEADING} text-center`}>How a challenge works</h2>
        <div className="mt-12 rounded-2xl border border-white/10 bg-white/5 px-8 py-10 backdrop-blur-xl md:px-12 md:py-12">
          <ol className="space-y-10">
            {STEPS.map((step, index) => (
              <li key={step.title} className="relative flex gap-6">
                {index < STEPS.length - 1 && (
                  <div className="absolute -bottom-10 left-6 top-14 w-px bg-white/10" aria-hidden="true" />
                )}
                <div className="relative z-10 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-primary to-brand-primary-hover text-xl font-bold text-white shadow-[0_0_30px_var(--brand-primary-glow)]">
                  {index + 1}
                </div>
                <div className="pt-1">
                  <h3 className="mb-2 text-2xl font-semibold text-white">{step.title}</h3>
                  <p className="leading-relaxed text-gray-300">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="scoring" className="mx-auto max-w-6xl px-4 py-20">
        <h2 className={HEADING}>Every score comes apart</h2>
        <p className="mt-4 max-w-2xl text-lg text-gray-300">
          No black-box numbers. You see the code each model wrote, which tests passed, how fast it ran, and the sum
          behind your score.
        </p>
        <dl className="mt-10 grid gap-6 md:grid-cols-3">
          {SCORING.map((item) => (
            <div key={item.term} className="surface space-y-3 p-6">
              <dt className="font-display text-xl font-bold text-white">{item.term}</dt>
              <dd className="font-mono text-sm text-brand-primary">{item.formula}</dd>
              <dd className="leading-relaxed text-gray-300">{item.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="waitlist" className="mx-auto max-w-3xl px-4 py-20">
        <div className="surface space-y-6 p-8 md:p-12">
          <h2 className={HEADING}>Get told when accounts open</h2>
          <p className="text-lg leading-relaxed text-gray-300">
            Today you can play without signing in, and nothing is saved. Accounts, leaderboards and more challenges
            are on the way.
          </p>
          <WaitlistForm />
        </div>
        <p className="mt-10 text-center leading-relaxed text-gray-400">
          LeetVibeCode is built by{' '}
          <a href="https://authentyc.ai" className="text-brand-primary hover:underline">
            Authentyc
          </a>
          , the authenticity layer between people and AI. This is its test of one skill: getting AI to write good
          code.
        </p>
      </section>
    </>
  );
}
