import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  prisma: {
    challenge: { findMany: vi.fn(), findUnique: vi.fn() },
    model: { findMany: vi.fn() },
  },
}));

import { prisma } from "./db";
import { getPublishedChallenge, listPublishedChallenges } from "./queries";

const findManyChallenge = prisma.challenge.findMany as unknown as Mock;
const findUniqueChallenge = prisma.challenge.findUnique as unknown as Mock;
const findManyModel = prisma.model.findMany as unknown as Mock;

beforeEach(() => {
  findManyChallenge.mockReset();
  findUniqueChallenge.mockReset();
  findManyModel.mockReset();
});

describe("listPublishedChallenges", () => {
  it("selects exactly slug/title/difficulty/parTokens for published challenges, oldest first", async () => {
    const rows = [{ slug: "a", title: "A", difficulty: "easy", parTokens: 100 }];
    findManyChallenge.mockResolvedValueOnce(rows);

    const result = await listPublishedChallenges();

    expect(result).toBe(rows);
    expect(findManyChallenge).toHaveBeenCalledWith({
      where: { status: "published" },
      select: { slug: true, title: true, difficulty: true, parTokens: true },
      orderBy: { createdAt: "asc" },
    });
  });

  // R11/browse-time secrecy: the list view must not even ask Postgres for these
  // columns -- asserting the `select` shape is the only way to prove nothing
  // can leak, since a mocked resolved value can't demonstrate what a real
  // query would or wouldn't fetch.
  it("never selects referenceMs, followupPrompt, description, interfaceText, or models", async () => {
    findManyChallenge.mockResolvedValueOnce([]);
    await listPublishedChallenges();

    const select = findManyChallenge.mock.calls[0][0].select;
    for (const forbidden of [
      "referenceMs", "followupPrompt", "description", "interfaceText", "models", "id", "status", "createdAt",
    ]) {
      expect(select).not.toHaveProperty(forbidden);
    }
  });
});

describe("getPublishedChallenge", () => {
  it("returns null without querying models when the challenge is missing or unpublished", async () => {
    findUniqueChallenge.mockResolvedValueOnce(null);

    const result = await getPublishedChallenge("nope");

    expect(result).toBeNull();
    expect(findManyModel).not.toHaveBeenCalled();
  });

  it("looks up by slug scoped to status=published", async () => {
    findUniqueChallenge.mockResolvedValueOnce(null);

    await getPublishedChallenge("rate-limiter");

    expect(findUniqueChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: "rate-limiter", status: "published" } }),
    );
  });

  // R11: referenceMs and followupPrompt must never leave Postgres for this
  // endpoint -- the followup is a round-2 surprise and referenceMs would leak
  // the perf bar at browse time.
  it("selects exactly the documented detail fields -- never referenceMs or followupPrompt", async () => {
    findUniqueChallenge.mockResolvedValueOnce({
      slug: "a", title: "A", description: "d", interfaceText: "i",
      difficulty: "easy", parTokens: 100, models: ["m1"],
    });
    findManyModel.mockResolvedValueOnce([{ openrouterId: "m1", displayName: "M1" }]);

    await getPublishedChallenge("a");

    expect(findUniqueChallenge.mock.calls[0][0].select).toEqual({
      slug: true, title: true, description: true, interfaceText: true,
      difficulty: true, parTokens: true, models: true,
    });
  });

  it("resolves the model roster to active {openrouterId, displayName} pairs", async () => {
    findUniqueChallenge.mockResolvedValueOnce({
      slug: "a", title: "A", description: "d", interfaceText: "i",
      difficulty: "easy", parTokens: 100, models: ["m1", "m2"],
    });
    findManyModel.mockResolvedValueOnce([{ openrouterId: "m1", displayName: "M1" }]);

    const result = await getPublishedChallenge("a");

    expect(findManyModel).toHaveBeenCalledWith({
      where: { openrouterId: { in: ["m1", "m2"] }, isActive: true },
      select: { openrouterId: true, displayName: true },
    });
    expect(result).toEqual({
      slug: "a", title: "A", description: "d", interfaceText: "i",
      difficulty: "easy", parTokens: 100,
      models: [{ openrouterId: "m1", displayName: "M1" }],
    });
  });

  it("returns exactly the documented keys -- no referenceMs, followupPrompt, id, status, or createdAt", async () => {
    findUniqueChallenge.mockResolvedValueOnce({
      slug: "a", title: "A", description: "d", interfaceText: "i",
      difficulty: "easy", parTokens: 100, models: [],
    });
    findManyModel.mockResolvedValueOnce([]);

    const result = await getPublishedChallenge("a");

    expect(Object.keys(result!).sort()).toEqual(
      ["description", "difficulty", "interfaceText", "models", "parTokens", "slug", "title"].sort(),
    );
  });
});
