import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finalScore, roundScore, runScore, tokenFactor, weights } from './scoring.ts';

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('run score is gated by accuracy', () => {
  near(runScore(0, 1), 0);
  near(runScore(1, 0), 0.7);
  near(runScore(1, 1), 1);
  near(runScore(0.5, 0.5), 0.425);
});

test('four runs weigh 8/15, 4/15, 2/15, 1/15 and sum to 1', () => {
  const w = weights(4);
  [8, 4, 2, 1].forEach((n, i) => near(w[i], n / 15));
  near(w.reduce((a, b) => a + b, 0), 1);
});

test('round score leans on the worst run', () => {
  const round = roundScore([1, 1, 1, 0]);
  assert.ok(round);
  near(round.score, 7 / 15);
  assert.equal(round.ranked[0].index, 3);
  near(round.ranked[0].weight, 8 / 15);
});

test('platform faults are excluded and weights renormalize', () => {
  const round = roundScore([null, 0.5, 1, null]);
  assert.ok(round);
  near(round.score, 0.5 * (2 / 3) + 1 * (1 / 3));
  assert.equal(roundScore([null, null, null, null]), null);
});

test('token factor is 1 under par and floored at 0.25', () => {
  near(tokenFactor(1000, 800), 1);
  near(tokenFactor(1000, 2000), 0.5);
  near(tokenFactor(1000, 100000), 0.25);
  near(tokenFactor(1000, 0), 1);
});

test('final score weighs extend over build and applies the token factor', () => {
  near(finalScore(1, 1, 1), 100);
  near(finalScore(0.5, 1, 0.5), 40);
  near(finalScore(1, 0, 1), 40);
});
