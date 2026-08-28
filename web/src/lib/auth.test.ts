import { compare, hashSync } from "bcryptjs";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

// Wrap the real compare in a vi.fn so we can assert it was *called* (R45: the
// no-user path must still pay the bcrypt cost) without faking its result —
// every other test in this file still needs real hash/compare behaviour.
vi.mock("bcryptjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bcryptjs")>();
  return { ...actual, compare: vi.fn(actual.compare) };
});

import { prisma } from "./db";
import { authOptions } from "./auth";

const compareSpy = vi.mocked(compare);

// next-auth's Credentials() factory hardcodes `authorize: () => null` on the object
// it returns and stashes the real function we pass in under `.options.authorize`;
// NextAuth's internal request pipeline merges the two at request time, but direct
// access (as here, in a test) has to go through `.options` to reach our real code.
const authorize = (
  authOptions.providers[0] as unknown as {
    options: { authorize: (creds: Record<string, string> | undefined) => Promise<unknown> };
  }
).options.authorize;

const findUnique = prisma.user.findUnique as unknown as Mock;

beforeEach(() => {
  findUnique.mockReset();
  compareSpy.mockClear();
});

describe("authorize", () => {
  it("returns null when creds is undefined", async () => {
    expect(await authorize(undefined)).toBeNull();
  });

  it("returns null when email is missing", async () => {
    expect(await authorize({ password: "secret123" })).toBeNull();
  });

  it("returns null when password is missing", async () => {
    expect(await authorize({ email: "a@b.io" })).toBeNull();
  });

  it("returns null when no user exists for the email (without distinguishing why)", async () => {
    findUnique.mockResolvedValueOnce(null);
    const result = await authorize({ email: "nobody@b.io", password: "whatever1" });
    expect(result).toBeNull();
  });

  it("still runs a bcrypt compare when no user exists, so the miss isn't cheaper (no timing oracle)", async () => {
    findUnique.mockResolvedValueOnce(null);
    const result = await authorize({ email: "nobody@b.io", password: "whatever1" });
    expect(result).toBeNull();
    expect(compareSpy).toHaveBeenCalledTimes(1);
  });

  it("returns null when the password does not match the stored hash", async () => {
    const passwordHash = hashSync("correct-password", 10);
    findUnique.mockResolvedValueOnce({ id: "u1", email: "a@b.io", name: "A", passwordHash });
    const result = await authorize({ email: "a@b.io", password: "wrong-password" });
    expect(result).toBeNull();
  });

  it("returns the user, without the password hash, when credentials are valid", async () => {
    const passwordHash = hashSync("correct-password", 10);
    findUnique.mockResolvedValueOnce({ id: "u1", email: "a@b.io", name: "A", passwordHash });
    const result = await authorize({ email: "a@b.io", password: "correct-password" });
    expect(result).toEqual({ id: "u1", email: "a@b.io", name: "A" });
    expect(result).not.toHaveProperty("passwordHash");
  });

  // R47: a user who registered as Foo@Bar.com (stored lowercase by route.ts)
  // must still be able to log in typing a different case.
  it("normalizes the email (trim + lowercase) before the lookup, so login works regardless of case", async () => {
    const passwordHash = hashSync("correct-password", 10);
    findUnique.mockResolvedValueOnce({ id: "u1", email: "foo@bar.com", name: "Foo", passwordHash });

    const result = await authorize({ email: "  Foo@Bar.com  ", password: "correct-password" });

    expect(findUnique).toHaveBeenCalledWith({ where: { email: "foo@bar.com" } });
    expect(result).toEqual({ id: "u1", email: "foo@bar.com", name: "Foo" });
  });
});

// The jwt/session callbacks are typed by next-auth against a much larger params
// object (account, profile, trigger, database-strategy fields, ...) that only
// matters for OAuth/database strategies. We cast to the narrow shape our
// jwt-strategy callbacks actually read, so the tests call the exact functions
// auth.ts exports without fabricating unrelated fields.
type JwtCallback = (params: {
  token: Record<string, unknown>;
  user?: { id: string; email: string; name: string };
}) => Record<string, unknown>;
type SessionCallback = (params: {
  session: { user: { name?: string | null; email?: string | null }; expires: string };
  token: Record<string, unknown>;
}) => { user: { id: string; email: string; name: string } };

const jwtCallback = authOptions.callbacks!.jwt as unknown as JwtCallback;
const sessionCallback = authOptions.callbacks!.session as unknown as SessionCallback;

describe("jwt callback", () => {
  it("copies user.id onto the token on sign-in", () => {
    const token = jwtCallback({ token: { sub: "x" }, user: { id: "u1", email: "a@b.io", name: "A" } });
    expect(token.id).toBe("u1");
  });

  it("passes the token through unchanged on subsequent requests (no user)", () => {
    const token = jwtCallback({ token: { id: "u1" } });
    expect(token).toEqual({ id: "u1" });
  });
});

describe("session callback", () => {
  it("populates session.user.id from token.id", () => {
    const session = sessionCallback({
      session: { user: { name: "A", email: "a@b.io" }, expires: "2099-01-01" },
      token: { id: "u1" },
    });
    expect(session.user.id).toBe("u1");
    expect(session.user.email).toBe("a@b.io");
  });
});
