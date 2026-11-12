import { readFileSync } from 'node:fs';
import path from 'node:path';

// Server-only module (reads the filesystem). Client components import types only.

export type Challenge = {
  slug: string;
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  summary: string;
  /** Shown to the player. */
  brief: string[];
  /** Shown to the player and sent to every model. */
  interface: string;
  /** Round 2: sent to every model as a follow-up in its own conversation. */
  followup: string;
  /** Token budget across all eight runs. Estimates; recalibrate from real runs. */
  parTokens: number;
};

export const CHALLENGES: Challenge[] = [
  {
    slug: 'merge-intervals',
    title: 'Merge intervals',
    difficulty: 'Easy',
    summary: 'Collapse overlapping ranges into a clean, sorted list.',
    brief: [
      'Get every model to write merge_intervals. It takes a list of closed integer intervals as (start, end) tuples, in any order, and returns the merged intervals as a list of tuples sorted by start.',
      'Intervals that overlap or touch merge: (1, 3) and (3, 5) become (1, 5). (1, 3) and (4, 6) stay separate.',
      'The input list must not be modified. An empty list returns an empty list.',
    ],
    interface: `def merge_intervals(intervals: list[tuple[int, int]]) -> list[tuple[int, int]]:
    ...`,
    followup:
      'New requirement: add an optional parameter `gap` (int, default 0) to `merge_intervals`. Two intervals also merge when the distance between them is at most `gap`, so with gap=1, (1, 3) and (4, 6) become (1, 6). Calls without `gap` must behave exactly as before. Reply with the complete updated code.',
    parTokens: 5000,
  },
  {
    slug: 'rate-limiter',
    title: 'Token bucket rate limiter',
    difficulty: 'Medium',
    summary: 'A rate limiter that takes its time from the caller, not the clock.',
    brief: [
      'Get every model to write a token bucket RateLimiter. The bucket starts full with `capacity` tokens and refills continuously at `rate` tokens per second, never beyond `capacity`.',
      'allow(now) receives the current time in seconds as an argument. If at least one token is available it consumes one and returns True; otherwise it returns False and consumes nothing.',
      'Fractions of a token accumulate between calls. The code must never read the real clock: time only comes from `now`, and the first call can use any timestamp.',
    ],
    interface: `class RateLimiter:
    def __init__(self, rate: float, capacity: int): ...
    def allow(self, now: float) -> bool: ...`,
    followup:
      'New requirement: `allow` takes an optional `cost` (int, default 1). The request passes only if at least `cost` tokens are available, and then consumes exactly `cost` tokens; a denied request consumes nothing. Also add `available(now) -> float`, which returns the tokens in the bucket at time `now` without consuming any. Existing calls must behave exactly as before. Reply with the complete updated code.',
    parTokens: 7000,
  },
  {
    slug: 'lru-cache',
    title: 'LRU cache',
    difficulty: 'Hard',
    summary: 'A fixed-size cache that forgets whatever was used longest ago.',
    brief: [
      'Get every model to write an LRUCache with a fixed `capacity`. get(key) returns the stored value, or None when the key is missing. put(key, value) inserts or updates.',
      'Both a successful get and any put count as a use of that key. When a put pushes the cache over capacity, the least recently used key is evicted. Updating an existing key never evicts.',
      'Stored values can be falsy (0, empty string) and must still be returned. Keys can be any hashable value. Both operations should run in constant time.',
    ],
    interface: `class LRUCache:
    def __init__(self, capacity: int): ...
    def get(self, key): ...
    def put(self, key, value) -> None: ...`,
    followup:
      'New requirement: entries can expire. `put(key, value, ttl=None, now=0.0)` stores the entry; when `ttl` is given, the entry expires at `now + ttl`. `get(key, now=0.0)` returns None for an entry whose expiry time is less than or equal to `now`. A later `put` on the same key replaces the old ttl, and a `put` without `ttl` means the entry no longer expires. Calls that pass neither `ttl` nor `now` must behave exactly as before. Reply with the complete updated code.',
    parTokens: 8000,
  },
];

export type ChallengeFiles = {
  harness: string;
  reference: string;
  bench: string;
  testBuild: string;
  testExtend: string;
};

const ROOT = path.join(process.cwd(), 'challenges');
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), 'utf8');

export function getChallenge(slug: string): Challenge | undefined {
  return CHALLENGES.find((challenge) => challenge.slug === slug);
}

/** slug must come from CHALLENGES (it is used as a directory name). */
export function loadFiles(slug: string): ChallengeFiles {
  return {
    harness: read('harness.py'),
    reference: read(slug, 'reference.py'),
    bench: read(slug, 'bench.py'),
    testBuild: read(slug, 'test_build.py'),
    testExtend: read(slug, 'test_extend.py'),
  };
}
