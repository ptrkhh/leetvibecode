import { NextResponse } from "next/server";
import { getLeaderboard } from "../../../../lib/queries";

// Thin pass-through (R12): the query itself lives in lib/queries.ts because
// Task 20's leaderboard page renders the same rows server-side.
//
// The 404 is byte-identical for a nonexistent slug and for an unpublished
// one, matching GET /api/challenges/[slug]: answering 200 [] for a draft
// would tell an outsider the draft exists. A published challenge nobody has
// completed is a real, public board, so it answers 200 [].
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const board = await getLeaderboard(slug);
  if (!board) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(board.rows);
}
