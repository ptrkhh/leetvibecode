import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/queries", () => ({ getLeaderboard: vi.fn() }));

import { getLeaderboard } from "../../../../lib/queries";
import { GET } from "./route";

const board = getLeaderboard as unknown as Mock;

const req = (slug: string) =>
  GET(new Request(`http://localhost/api/leaderboard/${slug}`), { params: Promise.resolve({ slug }) });

beforeEach(() => board.mockReset());

describe("GET /api/leaderboard/[slug]", () => {
  it("returns just the rows for a published challenge", async () => {
    const rows = [{ rank: 1, name: "Alice", score: 90, totalTokens: 1000 }];
    board.mockResolvedValueOnce({ title: "Rate Limiter", rows });

    const res = await req("rate-limiter");

    expect(board).toHaveBeenCalledWith("rate-limiter");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
  });

  it("returns 200 with an empty array when nobody has completed the challenge", async () => {
    board.mockResolvedValueOnce({ title: "Rate Limiter", rows: [] });

    const res = await req("rate-limiter");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  // Task 13's rule: an unpublished challenge and a nonexistent one must be
  // indistinguishable from outside, or the endpoint becomes a draft-existence
  // oracle. getLeaderboard collapses both to null, so there is one branch here
  // and it cannot drift apart.
  it("returns an identical 404 whether the slug is a draft or absent", async () => {
    board.mockResolvedValue(null);

    const [draft, missing] = await Promise.all([req("secret-draft"), req("no-such-thing")]);

    const [draftBody, missingBody] = await Promise.all([draft.json(), missing.json()]);
    expect([draft.status, missing.status]).toEqual([404, 404]);
    expect(draftBody).toEqual(missingBody);
    expect(missingBody).toEqual({ error: "not found" });
  });

  it("never leaks the challenge title into the response", async () => {
    board.mockResolvedValueOnce({ title: "Unreleased Challenge", rows: [] });

    const res = await req("rate-limiter");

    expect(JSON.stringify(await res.json())).not.toContain("Unreleased");
  });
});
