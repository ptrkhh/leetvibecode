import { Prisma } from "@prisma/client";
import { compare } from "bcryptjs";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/db", () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn() } },
}));

import { prisma } from "../../../lib/db";
import { POST } from "./route";

const findUnique = prisma.user.findUnique as unknown as Mock;
const create = prisma.user.create as unknown as Mock;

function req(body: unknown) {
  return new Request("http://localhost/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  findUnique.mockReset();
  create.mockReset();
});

describe("POST /api/register", () => {
  it("returns 201 and creates the user with a bcrypt-hashed password", async () => {
    findUnique.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({});

    const res = await POST(req({ email: "a@b.io", name: "A", password: "password1" }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(create).toHaveBeenCalledOnce();

    const data = create.mock.calls[0][0].data;
    expect(data.email).toBe("a@b.io");
    expect(data.name).toBe("A");
    // password hashing behaviour: never store the plaintext, store a real bcrypt hash
    expect(data.passwordHash).not.toBe("password1");
    expect(data.passwordHash).toMatch(/^\$2[aby]\$/);
    await expect(compare("password1", data.passwordHash)).resolves.toBe(true);
  });

  it("hashes the same password to a different hash each time (salted)", async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({});

    await POST(req({ email: "a@b.io", name: "A", password: "password1" }));
    await POST(req({ email: "c@b.io", name: "C", password: "password1" }));

    const hash1 = create.mock.calls[0][0].data.passwordHash;
    const hash2 = create.mock.calls[1][0].data.passwordHash;
    expect(hash1).not.toBe(hash2);
  });

  it("returns 409 and does not create a user when the email is already registered", async () => {
    findUnique.mockResolvedValueOnce({ id: "u1", email: "a@b.io" });

    const res = await POST(req({ email: "a@b.io", name: "A", password: "password1" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "email already registered" });
    expect(create).not.toHaveBeenCalled();
  });

  // R46: findUnique-then-create is not atomic. Two concurrent registrations for
  // the same email can both pass the pre-check and both reach create(); the
  // @unique constraint stops the duplicate row but raises P2002 on the loser.
  it("returns 409 (not a 500) when create() loses a registration race", async () => {
    findUnique.mockResolvedValueOnce(null); // pre-check saw no existing row
    create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`email`)", {
        code: "P2002",
        clientVersion: "6.19.3",
      }),
    );

    const res = await POST(req({ email: "a@b.io", name: "A", password: "password1" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "email already registered" });
  });

  it("does not mask a non-unique-constraint create() failure as 409", async () => {
    findUnique.mockResolvedValueOnce(null);
    create.mockRejectedValueOnce(new Error("connection reset"));

    await expect(POST(req({ email: "a@b.io", name: "A", password: "password1" }))).rejects.toThrow(
      "connection reset",
    );
  });

  // R47: case is normalized so Foo@Bar.com and foo@bar.com are one account.
  it("normalizes the email (trim + lowercase) before storing it", async () => {
    findUnique.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({});

    await POST(req({ email: "  Foo@Bar.com  ", name: "A", password: "password1" }));

    const data = create.mock.calls[0][0].data;
    expect(data.email).toBe("foo@bar.com");
    expect(data.name).toBe("A"); // name is left untouched, only email is normalized
  });

  it("checks for an existing account using the normalized email too", async () => {
    findUnique.mockResolvedValueOnce({ id: "u1", email: "foo@bar.com" });

    const res = await POST(req({ email: "FOO@Bar.com", name: "A", password: "password1" }));

    expect(res.status).toBe(409);
    expect(findUnique).toHaveBeenCalledWith({ where: { email: "foo@bar.com" } });
  });

  const invalidCases: [string, Record<string, unknown>][] = [
    ["email missing @", { email: "not-an-email", name: "A", password: "password1" }],
    ["email over 200 chars", { email: `${"a".repeat(196)}@b.io`, name: "A", password: "password1" }],
    ["empty name", { email: "a@b.io", name: "", password: "password1" }],
    ["name over 100 chars", { email: "a@b.io", name: "a".repeat(101), password: "password1" }],
    ["password under 8 chars", { email: "a@b.io", name: "A", password: "short1" }],
    ["password over 200 chars", { email: "a@b.io", name: "A", password: "a".repeat(201) }],
    ["non-string email", { email: 1, name: "A", password: "password1" }],
    ["missing fields entirely", {}],
  ];

  it.each(invalidCases)("returns 400 without touching the db: %s", async (_label, body) => {
    const res = await POST(req(body));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid/i);
    expect(findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 400 (not a 500) on a body that is not valid JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );

    expect(res.status).toBe(400);
  });

  it("never echoes the plaintext password back in the response body", async () => {
    findUnique.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({});

    const res = await POST(req({ email: "a@b.io", name: "A", password: "super-secret-1" }));
    const bodyText = JSON.stringify(await res.json());

    expect(bodyText).not.toContain("super-secret-1");
  });
});
