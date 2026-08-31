import { NextResponse } from "next/server";
import { listPublishedChallenges } from "../../../lib/queries";

export async function GET() {
  return NextResponse.json(await listPublishedChallenges());
}
