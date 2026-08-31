import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../../../../lib/auth";
import { listUserAttempts } from "../../../../lib/queries";

// The session's own user id is the ONLY thing that scopes this query -- it
// never comes from the request -- so there is no parameter a caller could
// change to read someone else's history.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "login required" }, { status: 401 });
  return NextResponse.json(await listUserAttempts(session.user.id));
}
