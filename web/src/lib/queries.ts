// R12: the read queries GET /api/challenges and GET /api/challenges/[slug] run
// live here, so the route handlers below and the server components that will
// render the same data (home page, challenge page) call one function each
// instead of re-issuing the Prisma query inline in four places.
import { prisma } from "./db";

export function listPublishedChallenges() {
  return prisma.challenge.findMany({
    where: { status: "published" },
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
    where: { slug, status: "published" },
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
