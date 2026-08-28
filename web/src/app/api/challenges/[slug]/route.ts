import { NextResponse } from "next/server";
import { getPublishedChallenge } from "../../../../lib/queries";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const challenge = await getPublishedChallenge(slug);
  if (!challenge) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(challenge);
}
