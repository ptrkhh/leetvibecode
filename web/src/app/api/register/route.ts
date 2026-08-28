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
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return NextResponse.json({ error: "email already registered" }, { status: 409 });
  await prisma.user.create({ data: { email, name, passwordHash: await hash(password, 10) } });
  return NextResponse.json({ ok: true }, { status: 201 });
}
