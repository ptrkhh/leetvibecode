// R12: the read queries GET /api/challenges and GET /api/challenges/[slug] run
// live here, so the route handlers below and the server components that will
// render the same data (home page, challenge page) call one function each
// instead of re-issuing the Prisma query inline in four places.
import { prisma } from "./db";

// R59: the ONE definition of what counts as a publicly visible challenge.
// listPublishedChallenges (the API list) and listChallengesWithBests (the home
// page) are different queries with different consumers, so nothing here is
// duplicated -- but they must never disagree about which challenges exist. If
// this predicate ever narrows (an archived status, a visibility flag), it
// narrows for the detail and leaderboard lookups too, rather than leaving a
// challenge that is unlistable but still reachable by direct URL.
const PUBLISHED = { status: "published" };

export function listPublishedChallenges() {
  return prisma.challenge.findMany({
    where: PUBLISHED,
    select: { slug: true, title: true, difficulty: true, parTokens: true },
    orderBy: { createdAt: "asc" },
  });
}

export type ChallengeDetail = {
  slug: string;
  title: string;
  description: string;
  interfaceText: string;
  difficulty: string;
  parTokens: number;
  models: { openrouterId: string; displayName: string }[];
};

// R11: referenceMs and followupPrompt are deliberately absent from this
// select -- referenceMs would leak the perf bar at browse time (it belongs in
// the post-run attempt payload instead), and the followup prompt is a round-2
// surprise. Hidden tests never enter the database at all (they live only as
// files under the challenge directory), so there's no field here that could
// leak them either.
export async function getPublishedChallenge(slug: string): Promise<ChallengeDetail | null> {
  const c = await prisma.challenge.findUnique({
    where: { slug, ...PUBLISHED },
    select: {
      slug: true, title: true, description: true, interfaceText: true,
      difficulty: true, parTokens: true, models: true,
    },
  });
  if (!c) return null;
  const models = await prisma.model.findMany({
    where: { openrouterId: { in: c.models }, isActive: true },
    select: { openrouterId: true, displayName: true },
  });
  return { ...c, models };
}

export type LeaderboardRow = { rank: number; name: string; score: number; totalTokens: number };

// R12 again: Task 20's leaderboard page renders exactly this, so the query
// lives here and both the page and the route call it. The page also needs the
// challenge title, which is why this returns it alongside the rows rather than
// making the page issue its own second lookup (the plan's version did, and
// R19 caught that its lookup was missing the `status: "published"` filter).
//
// null means "no board to show", collapsing "no such slug" with "exists but
// unpublished" -- the same 404-for-both that Task 13 gives
// GET /api/challenges/[slug], and for the same reason: a 200 with an empty
// array for a draft slug versus a 404 for a nonexistent one is a
// draft-existence oracle. An empty `rows` for a PUBLISHED challenge leaks
// nothing, since published challenges are already publicly enumerable.
//
// This is also why the raw query filters on challengeId rather than joining
// Challenge on slug: the publication check is then structurally impossible to
// skip, and it hits Attempt's ([challengeId, status, finalScore]) index.
export async function getLeaderboard(
  slug: string,
): Promise<{ title: string; rows: LeaderboardRow[] } | null> {
  const c = await prisma.challenge.findUnique({
    where: { slug, ...PUBLISHED },
    select: { id: true, title: true },
  });
  if (!c) return null;

  // Both ORDER BYs carry the SAME total order, and both need one.
  //
  // Outer: score alone is not a total order, so two players on the same score
  // swap places between identical requests, and at the 50-row boundary one
  // appears while the other vanishes. Inner: DISTINCT ON keeps the first row
  // per user, so a user with two attempts on the same score gets an arbitrary
  // one of them and their displayed totalTokens flickers.
  //
  // completedAt ASC is the tiebreak: first to reach the score ranks higher,
  // the ordinary competitive convention, and it is monotone -- a later
  // finisher can never displace an earlier one. Deliberately NOT totalTokens:
  // token_factor is already folded into finalScore, so ordering by tokens
  // would penalise the same spend twice and contradict a formula that has
  // already declared the two players equal. completedAt is nullable in the
  // schema (Task 15 always writes it with the status flip, but nothing in the
  // database enforces that), and DESC/ASC null placement is a footgun, so
  // Attempt.id -- the primary key -- is the final key that makes the order
  // genuinely total for every possible row.
  //
  // finalScore IS NOT NULL is not decoration: ORDER BY ... DESC puts NULLs
  // FIRST in Postgres, so a completed attempt with no score would sit at
  // rank 1 with a blank score.
  //
  // RANK() (spec L79) rather than the array index, so tied players show the
  // same rank instead of being told one of them is fourth and the other third
  // with identical scores. Cast to int because rank() returns bigint, which
  // Prisma hands back as a JS BigInt and NextResponse.json refuses to
  // serialize.
  //
  // Tagged-template $queryRaw parameterizes ${c.id}; it is a bind parameter,
  // not interpolated text.
  const rows = await prisma.$queryRaw<LeaderboardRow[]>`
    SELECT rank() OVER (ORDER BY best."finalScore" DESC)::int AS rank,
           u.name, best."finalScore" AS score, best."totalTokens"
    FROM (
      SELECT DISTINCT ON (a."userId")
             a."userId", a."finalScore", a."totalTokens", a."completedAt", a.id
      FROM "Attempt" a
      WHERE a."challengeId" = ${c.id}
        AND a.status = 'completed'
        AND a."finalScore" IS NOT NULL
      ORDER BY a."userId", a."finalScore" DESC, a."completedAt" ASC, a.id ASC
    ) best
    JOIN "User" u ON u.id = best."userId"
    ORDER BY best."finalScore" DESC, best."completedAt" ASC, best.id ASC
    LIMIT 50`;
  return { title: c.title, rows };
}

// Explicit select, never an include: an include returns every Attempt column
// including userId, and this response has no use for a foreign primary key.
// Same convention as GET /api/attempts/[id]. Flattened here rather than in the
// route so the history page and the API see one shape.
//
// id breaks the startedAt tie for the same reason the leaderboard needs one:
// without it two attempts started in the same instant reorder between calls,
// and at the take:100 boundary one of them drops out at random.
export async function listUserAttempts(userId: string) {
  const rows = await prisma.attempt.findMany({
    where: { userId },
    select: {
      id: true, status: true, finalScore: true, startedAt: true,
      challenge: { select: { slug: true, title: true } },
    },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  return rows.map((a) => ({
    id: a.id, challengeSlug: a.challenge.slug, challengeTitle: a.challenge.title,
    status: a.status, finalScore: a.finalScore, startedAt: a.startedAt,
  }));
}

export type ChallengeListing = {
  slug: string;
  title: string;
  difficulty: string;
  parTokens: number;
  best: number | null;
};

// R12 again, for Task 17's home page. Deliberately NOT listPublishedChallenges
// plus a second pass: that helper's select is asserted (queries.test.ts) to
// exclude `id`, because GET /api/challenges has no use for one, and a
// personal-best groupBy can only key on challengeId. So the join key is
// selected here and stripped before returning -- the declared return type is
// what makes that structural rather than a promise, so no caller can render an
// id it never receives.
//
// The plan's version ran the challenge query a SECOND time with no `where` at
// all (every draft included) purely to map id -> slug, then called
// bests.find() inside .map(), which is O(challenges x attempts) on every
// render. One query, one Map, one pass.
//
// status: "completed" is the entire point of the where clause: an active
// attempt has no score yet and a voided one is explicitly not scored
// (spec L124, L127), so neither may ever surface as a personal best. SQL MAX
// ignores NULLs, so a completed attempt whose finalScore was never written
// contributes nothing rather than a 0 -- the same NULL trap Task 16 hit from
// the other side.
export async function listChallengesWithBests(userId?: string): Promise<ChallengeListing[]> {
  const challenges = await prisma.challenge.findMany({
    where: PUBLISHED,
    select: { id: true, slug: true, title: true, difficulty: true, parTokens: true },
    orderBy: { createdAt: "asc" },
  });
  const bests = userId
    ? await prisma.attempt.groupBy({
        by: ["challengeId"],
        _max: { finalScore: true },
        where: { userId, status: "completed" },
      })
    : [];
  const bestBy = new Map(bests.map((b) => [b.challengeId, b._max.finalScore]));
  return challenges.map(({ id, ...c }) => ({ ...c, best: bestBy.get(id) ?? null }));
}
