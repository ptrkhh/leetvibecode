import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/queries", () => ({
  getPublishedChallenge: vi.fn(),
}));

import { getPublishedChallenge } from "../../../../lib/queries";
import { GET } from "./route";

const getMock = getPublishedChallenge as unknown as Mock;

function req(slug: string) {
  return GET(new Request(`http://localhost/api/challenges/${slug}`), {
    params: Promise.resolve({ slug }),
  });
}

beforeEach(() => getMock.mockReset());

describe("GET /api/challenges/[slug]", () => {
  it("returns 200 with the challenge detail for a published slug", async () => {
    const detail = {
      slug: "rate-limiter", title: "T", description: "d", interfaceText: "i",
      difficulty: "medium", parTokens: 2500,
      models: [{ openrouterId: "m1", displayName: "M1" }],
    };
    getMock.mockResolvedValueOnce(detail);

    const res = await req("rate-limiter");

    expect(getMock).toHaveBeenCalledWith("rate-limiter");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(detail);
  });

  it("returns 404 with an error body when the challenge doesn't exist or isn't published", async () => {
    getMock.mockResolvedValueOnce(null);

    const res = await req("nope");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });
});
