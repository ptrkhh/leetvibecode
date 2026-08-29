import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("../../../../lib/queries", () => ({ listUserAttempts: vi.fn() }));

import { getServerSession } from "next-auth";
import { listUserAttempts } from "../../../../lib/queries";
import { GET } from "./route";

const getSession = getServerSession as unknown as Mock;
const listAttempts = listUserAttempts as unknown as Mock;

beforeEach(() => {
  getSession.mockReset();
  listAttempts.mockReset();
  listAttempts.mockResolvedValue([]);
});

describe("GET /api/me/attempts", () => {
  it("returns 401 without a session and never touches the database", async () => {
    getSession.mockResolvedValueOnce(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "login required" });
    expect(listAttempts).not.toHaveBeenCalled();
  });

  // The scoping argument comes from the session and nowhere else: GET takes no
  // request, so there is no user id a caller could supply.
  it("scopes strictly to the session user's id", async () => {
    getSession.mockResolvedValueOnce({ user: { id: "u1" } });
    const rows = [{
      id: "a1", challengeSlug: "rate-limiter", challengeTitle: "Rate Limiter",
      status: "completed", finalScore: 90, startedAt: new Date(0),
    }];
    listAttempts.mockResolvedValueOnce(rows);

    const res = await GET();

    expect(listAttempts).toHaveBeenCalledExactlyOnceWith("u1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ ...rows[0], startedAt: new Date(0).toISOString() }]);
  });
});
