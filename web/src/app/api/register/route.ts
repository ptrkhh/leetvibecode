import { Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "../../../lib/db";

export async function POST(req: Request) {
  const { email, name, password } = await req.json().catch(() => ({}));
  if (typeof email !== "string" || !email.includes("@") || email.length > 200 ||
      typeof name !== "string" || name.length < 1 || name.length > 100 ||
      typeof password !== "string" || password.length < 8 || password.length > 200) {
    return NextResponse.json({ error: "invalid email, name, or password (min 8 chars)" }, { status: 400 });
  }
  // R47: normalize so Foo@Bar.com and foo@bar.com are one account; only email
  // is normalized, the display name is stored as given.
  const normalizedEmail = email.trim().toLowerCase();
  const exists = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (exists) return NextResponse.json({ error: "email already registered" }, { status: 409 });
  try {
    await prisma.user.create({ data: { email: normalizedEmail, name, passwordHash: await hash(password, 10) } });
  } catch (e) {
    // R46: the findUnique check above and this create() are not atomic, so a
    // concurrent registration for the same email can win the race between
    // them. The @unique constraint still stops the duplicate row, but its
    // P2002 must be turned into the same 409 the pre-check gives, not left
    // to escape as an uncontrolled 500.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "email already registered" }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
