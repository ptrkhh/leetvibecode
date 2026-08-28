import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/queries", () => ({
  listPublishedChallenges: vi.fn(),
}));

import { listPublishedChallenges } from "../../../lib/queries";
import { GET } from "./route";

const listMock = listPublishedChallenges as unknown as Mock;

beforeEach(() => listMock.mockReset());

describe("GET /api/challenges", () => {
  it("returns 200 with exactly what the query layer produces", async () => {
    const rows = [{ slug: "a", title: "A", difficulty: "easy", parTokens: 100 }];
    listMock.mockResolvedValueOnce(rows);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
  });

  it("returns an empty list (not an error) when nothing is published", async () => {
    listMock.mockResolvedValueOnce([]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
