import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { getLeaderboard, listChallengesWithBests, listUserAttempts } from "./queries";

// Real Postgres, deliberately not a mock. The leaderboard is hand-written SQL
// (DISTINCT ON + RANK + a total order); a mocked $queryRaw would only assert
// the string we typed, and "best completed attempt per user" is exactly the
// shape that returns the wrong rows while compiling perfectly. It also proves
// the return types survive NextResponse.json -- a Postgres bigint arriving as
// a JS BigInt throws at serialization time and no type-check catches it.
//
// The dev database is shared and already holds fixture rows from earlier
// tasks, so everything here is namespaced under a per-run uuid and deleted in
// afterAll. Nothing asserts a global count.
const NS = `t16-${randomUUID()}`;

const CHALLENGE = {
  description: "d", interfaceText: "i", difficulty: "easy",
  parTokens: 100, followupPrompt: "f", models: [],
};

const mkChallenge = (tag: string, status: string) =>
  prisma.challenge.create({
    data: { ...CHALLENGE, slug: `${NS}-${tag}`, title: `T ${tag}`, status },
    select: { id: true, slug: true },
  });

const mkUser = (tag: string, name: string) =>
  prisma.user.create({
    data: { email: `${NS}-${tag}@example.test`, name, passwordHash: "x" },
    select: { id: true },
  });

type AttemptOver = {
  status?: string;
  finalScore?: number | null;
  totalTokens?: number;
  completedAt?: Date | null;
  startedAt?: Date;
};
// Every attempt here gets round 0, because every real attempt has one: the
// two POSTs that create an attempt and its first round are milliseconds apart
// and R66 makes listUserAttempts skip anything that never got the second. A
// fixture without a round models a FAILED start, not an attempt.
const mkAttempt = (userId: string, challengeId: string, over: AttemptOver = {}) =>
  prisma.attempt.create({
    data: { userId, challengeId, ...over, rounds: { create: { index: 0, promptText: "p" } } },
    select: { id: true },
  });

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

let main: { id: string; slug: string };
let other: { id: string; slug: string };
let cap: { id: string; slug: string };
let draft: { id: string; slug: string };
let empty: { id: string; slug: string };
let alice: { id: string };
let bob: { id: string };
let carol: { id: string };
let dave: { id: string };

beforeAll(async () => {
  [main, other, cap, draft, empty] = await Promise.all([
    mkChallenge("main", "published"),
    mkChallenge("other", "published"),
    mkChallenge("cap", "published"),
    mkChallenge("draft", "draft"),
    mkChallenge("empty", "published"),
  ]);

  carol = await mkUser("carol", "Carol");
  dave = await mkUser("dave", "Dave");
  [alice, bob] = await Promise.all([mkUser("alice", "Alice"), mkUser("bob", "Bob")]);

  // Alice: two completed attempts. The BEST one (90) must be the one that
  // appears, carrying ITS totalTokens (1000) -- not the other row's, and not
  // a sum.
  await mkAttempt(alice.id, main.id,
    { status: "completed", finalScore: 90, totalTokens: 1000, completedAt: day(2), startedAt: day(2) });
  await mkAttempt(alice.id, main.id,
    { status: "completed", finalScore: 70, totalTokens: 500, completedAt: day(1), startedAt: day(1) });
  // Alice on another challenge -- must not bleed into main's board, and gives
  // listUserAttempts a cross-challenge row.
  await mkAttempt(alice.id, other.id,
    { status: "completed", finalScore: 99, totalTokens: 10, completedAt: day(3), startedAt: day(3) });

  // Bob ties Alice on 90 but finished FIRST, so the tiebreak puts him above her.
  await mkAttempt(bob.id, main.id,
    { status: "completed", finalScore: 90, totalTokens: 2000, completedAt: day(1), startedAt: day(1) });

  // Carol: never completed anything, plus a VOIDED attempt carrying a
  // top-of-board score. If either reaches the leaderboard she ranks first.
  await mkAttempt(carol.id, main.id, { status: "active" });
  await mkAttempt(carol.id, main.id,
    { status: "voided", finalScore: 100, totalTokens: 10, completedAt: day(1) });
  // A completed attempt with NO score. ORDER BY ... DESC puts NULLs first in
  // Postgres, so without the IS NOT NULL guard this row tops the board.
  await mkAttempt(carol.id, main.id,
    { status: "completed", finalScore: null, totalTokens: 10, completedAt: day(1) });

  // Dave holds TWO completed attempts on the SAME score with different token
  // counts. Only the inner DISTINCT ON tiebreak decides which one is "his",
  // and therefore which totalTokens the board displays: without it Postgres
  // may return either, and the number flickers between requests.
  // Inserted newest-first on purpose: with no tiebreak Postgres tends to
  // return heap order, so the row that MUST win (the earlier completedAt) is
  // the one written second.
  await mkAttempt(dave.id, main.id,
    { status: "completed", finalScore: 50, totalTokens: 8888, completedAt: day(2) });
  await mkAttempt(dave.id, main.id,
    { status: "completed", finalScore: 50, totalTokens: 300, completedAt: day(1) });

  // startedAt pinned oldest so the history ordering below is deterministic.
  await mkAttempt(alice.id, draft.id,
    { status: "completed", finalScore: 88, totalTokens: 10, completedAt: day(1), startedAt: day(0) });

  // 55 users all on the SAME score: exercises the 50-row cap and makes the
  // tiebreak the only thing deciding which five are cut.
  const capUsers = await prisma.user.createManyAndReturn({
    data: Array.from({ length: 55 }, (_, i) => ({
      email: `${NS}-cap${i}@example.test`, name: `Cap ${i}`, passwordHash: "x",
    })),
    select: { id: true },
  });
  await prisma.attempt.createMany({
    data: capUsers.map((u) => ({
      userId: u.id, challengeId: cap.id, status: "completed",
      finalScore: 42, totalTokens: 7, completedAt: day(1),
    })),
  });
}, 60_000);

afterAll(async () => {
  const challenges = await prisma.challenge.findMany({
    where: { slug: { startsWith: NS } }, select: { id: true },
  });
  const ids = challenges.map((c) => c.id);
  const attempts = await prisma.attempt.findMany({
    where: { challengeId: { in: ids } }, select: { id: true },
  });
  await prisma.round.deleteMany({ where: { attemptId: { in: attempts.map((a) => a.id) } } });
  await prisma.attempt.deleteMany({ where: { challengeId: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: NS } } });
  await prisma.challenge.deleteMany({ where: { id: { in: ids } } });
}, 60_000);

describe("getLeaderboard: which rows qualify", () => {
  it("returns one row per user -- their best completed attempt, with that attempt's tokens", async () => {
    const lb = await getLeaderboard(main.slug);

    expect(lb!.rows).toEqual([
      { rank: 1, name: "Bob", score: 90, totalTokens: 2000 },
      { rank: 1, name: "Alice", score: 90, totalTokens: 1000 },
      { rank: 3, name: "Dave", score: 50, totalTokens: 300 },
    ]);
  });

  // Carol holds a voided attempt scoring 100 and an active one. Both are
  // filtered by status, so neither can reach the board -- the spec's
  // "abandoned attempts are excluded" and Task 14's voided invariant, checked
  // against real rows rather than against the WHERE clause.
  it("never shows a voided or never-completed attempt", async () => {
    const lb = await getLeaderboard(main.slug);

    expect(lb!.rows.map((r) => r.name)).not.toContain("Carol");
    expect(lb!.rows.map((r) => r.score)).not.toContain(100);
  });

  it("scopes to the challenge -- Alice's 99 on another challenge stays there", async () => {
    const [mainBoard, otherBoard] = await Promise.all([
      getLeaderboard(main.slug), getLeaderboard(other.slug),
    ]);

    expect(mainBoard!.rows.map((r) => r.score)).not.toContain(99);
    expect(otherBoard!.rows).toEqual([{ rank: 1, name: "Alice", score: 99, totalTokens: 10 }]);
  });

  it("returns an empty board (not null) for a published challenge nobody has completed", async () => {
    const lb = await getLeaderboard(empty.slug);

    expect(lb).toEqual({ title: "T empty", rows: [] });
  });
});

describe("getLeaderboard: ordering, ranks and the cap", () => {
  it("ranks ties equally and numbers the next row by position", async () => {
    const lb = await getLeaderboard(main.slug);

    expect(lb!.rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  // Same score, so only the tiebreak can order them: Bob completed a day
  // before Alice. Without it Postgres is free to return either order.
  it("breaks a score tie by who finished first", async () => {
    const lb = await getLeaderboard(main.slug);

    expect(lb!.rows.slice(0, 2).map((r) => r.name)).toEqual(["Bob", "Alice"]);
  });

  it("caps at 50 rows", async () => {
    const lb = await getLeaderboard(cap.slug);

    expect(lb!.rows).toHaveLength(50);
  });

  // 55 users on one identical score: the five that get cut are decided purely
  // by the tiebreak. Repeat the identical call and the same 50 names must come
  // back in the same order, or a player watches their row appear and vanish.
  it("returns byte-identical rows across repeated identical calls", async () => {
    const [first, second, third] = await Promise.all([
      getLeaderboard(cap.slug), getLeaderboard(cap.slug), getLeaderboard(cap.slug),
    ]);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("returns plain JSON numbers, never BigInt, so NextResponse.json can serialize it", async () => {
    const lb = await getLeaderboard(main.slug);

    for (const row of lb!.rows) {
      expect(typeof row.rank).toBe("number");
      expect(typeof row.score).toBe("number");
      expect(typeof row.totalTokens).toBe("number");
    }
    expect(() => JSON.stringify(lb!.rows)).not.toThrow();
  });
});

describe("getLeaderboard: draft challenges are invisible", () => {
  // Task 13 made GET /api/challenges/[slug] 404 for an unpublished challenge
  // so a draft's existence cannot be probed. A board that answered 200 [] for
  // a draft slug and 404 for a nonexistent one would reopen exactly that
  // oracle, so both must produce the same null here.
  it("returns null for an unpublished challenge, even though it has a completed attempt", async () => {
    expect(await getLeaderboard(draft.slug)).toBeNull();
  });

  it("returns null for a slug that does not exist", async () => {
    expect(await getLeaderboard(`${NS}-no-such-slug`)).toBeNull();
  });

  it("treats the slug as data, not SQL", async () => {
    expect(await getLeaderboard(`x' OR '1'='1`)).toBeNull();
    // The board is still intact, i.e. nothing was dropped or unfiltered.
    expect((await getLeaderboard(main.slug))!.rows).toHaveLength(3);
  });
});

describe("listUserAttempts", () => {
  it("returns only the given user's attempts, newest first, flattened", async () => {
    const rows = await listUserAttempts(alice.id);

    expect(rows).toEqual([
      { id: expect.any(String), challengeSlug: other.slug, challengeTitle: "T other", status: "completed", finalScore: 99, startedAt: day(3) },
      { id: expect.any(String), challengeSlug: main.slug, challengeTitle: "T main", status: "completed", finalScore: 90, startedAt: day(2) },
      { id: expect.any(String), challengeSlug: main.slug, challengeTitle: "T main", status: "completed", finalScore: 70, startedAt: day(1) },
      { id: expect.any(String), challengeSlug: draft.slug, challengeTitle: "T draft", status: "completed", finalScore: 88, startedAt: day(0) },
    ]);
  });

  it("cannot see another user's attempts", async () => {
    const rows = await listUserAttempts(bob.id);

    expect(rows).toHaveLength(1);
    expect(rows.map((r) => r.finalScore)).toEqual([90]);
  });

  // R66, tested the way the defect was demonstrated rather than by asserting
  // the predicate. POST /api/attempts creates a row unconditionally and costs
  // nothing (no Run rows, so no tokens), and `take: 100` is ordered by
  // startedAt DESC -- so orphans are always NEWER than real history and evict
  // it. 150 of them here against Alice's four genuine attempts, the oldest of
  // which (`draft`, day 0) is the first thing a hundred-row window loses.
  it("cannot be evicted from the window by a flood of failed starts", async () => {
    await prisma.attempt.createMany({
      data: Array.from({ length: 150 }, () => ({
        userId: alice.id, challengeId: main.id, status: "active",
        startedAt: new Date(),   // newest, i.e. at the front of the ordering
      })),
    });

    const rows = await listUserAttempts(alice.id);

    // Not "150 fewer rows": every one of Alice's real attempts is still here,
    // INCLUDING the oldest, and no orphan reached the payload.
    expect(rows.map((r) => r.finalScore)).toEqual([99, 90, 70, 88]);
    expect(rows.every((r) => r.status === "completed")).toBe(true);
    expect(rows).toHaveLength(4);
  });

  // userId is what scopes the query; leaking it into the payload would put a
  // foreign primary key in a response that has no use for one.
  it("never returns userId", async () => {
    const rows = await listUserAttempts(alice.id);

    expect(rows[0]).not.toHaveProperty("userId");
    expect(rows[0]).not.toHaveProperty("challengeId");
  });
});

// The dev database holds published challenges from every earlier task, so
// every assertion here looks up THIS run's slugs inside the result. Nothing
// asserts a global length -- the same rule the file already follows.
const bestOf = (rows: Awaited<ReturnType<typeof listChallengesWithBests>>, slug: string) =>
  rows.find((r) => r.slug === slug);

describe("listChallengesWithBests", () => {
  it("attaches the user's highest completed score to each published challenge", async () => {
    const rows = await listChallengesWithBests(alice.id);

    // Alice completed 90 and 70 on main: the best one, not the latest.
    expect(bestOf(rows, main.slug)).toEqual({
      slug: main.slug, title: "T main", difficulty: "easy", parTokens: 100, best: 90,
    });
    expect(bestOf(rows, other.slug)!.best).toBe(99);
    // Published, nobody has completed anything on it.
    expect(bestOf(rows, empty.slug)!.best).toBeNull();
  });

  // The hard requirement carried from Tasks 14/15/16. Carol holds a VOIDED
  // attempt scoring 100, an ACTIVE one, and a completed one whose finalScore
  // was never written. None of the three is a personal best, and a 100 showing
  // up here would be a score for an attempt the platform explicitly refused to
  // score.
  it("never counts a voided, active, or unscored attempt as a best", async () => {
    const rows = await listChallengesWithBests(carol.id);

    expect(bestOf(rows, main.slug)!.best).toBeNull();
    expect(rows.map((r) => r.best)).not.toContain(100);
  });

  it("scopes bests to the user -- Dave's 50 on main is not Alice's 90", async () => {
    const [aliceRows, daveRows] = await Promise.all([
      listChallengesWithBests(alice.id), listChallengesWithBests(dave.id),
    ]);

    expect(bestOf(aliceRows, main.slug)!.best).toBe(90);
    expect(bestOf(daveRows, main.slug)!.best).toBe(50);
    expect(bestOf(daveRows, other.slug)!.best).toBeNull();
  });

  // The plan's version ran a second findMany with no `where` at all, so an
  // unpublished challenge could reach the home page through the id->slug map.
  it("omits an unpublished challenge even when the user completed it", async () => {
    const rows = await listChallengesWithBests(alice.id);

    expect(bestOf(rows, draft.slug)).toBeUndefined();
    expect(rows.map((r) => r.best)).not.toContain(88);
  });

  it("returns every published challenge with a null best when nobody is logged in", async () => {
    const rows = await listChallengesWithBests();

    expect(bestOf(rows, main.slug)).toEqual({
      slug: main.slug, title: "T main", difficulty: "easy", parTokens: 100, best: null,
    });
    expect(bestOf(rows, draft.slug)).toBeUndefined();
  });

  // The join key is selected but must not survive the return: the home page is
  // a server component today, but a route handler is exactly what R12 expects
  // to call this next.
  it("never returns the challenge id", async () => {
    const rows = await listChallengesWithBests(alice.id);

    expect(Object.keys(bestOf(rows, main.slug)!).sort())
      .toEqual(["best", "difficulty", "parTokens", "slug", "title"]);
  });
});
