import Link from "next/link";
import { notFound } from "next/navigation";
import { getLeaderboard } from "../../../lib/queries";

// Public, like GET /api/leaderboard/[slug]: the spec's board is global
// (L144), the home page links it from every card while logged out, and there
// is nothing here that is not already public.
export default async function Leaderboard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // R12: ONE call. getLeaderboard is Task 16's query, written for this page
  // and for the route that renders the same rows, and it returns the title
  // alongside the rows precisely so this page does not issue a second
  // challenge lookup -- which is the lookup R19 caught missing
  // `status: "published"`. There is no second lookup left to forget it on.
  const board = await getLeaderboard(slug);
  // null is "no board to show" for BOTH an unpublished slug and a nonexistent
  // one, collapsed inside the query so the two cannot drift apart. Rendering
  // the requested slug as a heading over an empty table (the plan's version)
  // would answer "this draft exists" for one and "this does not" for the
  // other, reopening the draft-existence oracle Tasks 13 and 16 closed. Same
  // notFound() as /c/[slug].
  if (!board) notFound();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Leaderboard — {board.title}</h1>
      {board.rows.length === 0 ? (
        // A published challenge nobody has finished. Bare headers over no rows
        // read as a broken page rather than an empty one (R59, Task 17).
        <p className="text-gray-600">
          No completed attempts yet.{" "}
          <Link className="underline" href={`/c/${encodeURIComponent(slug)}`}>
            Be the first
          </Link>
          .
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          {/* A caption is the table's accessible name, so screen-reader table
              navigation announces what this grid is instead of "table with 4
              columns". It also states the two rules a player cannot infer from
              the numbers: one row per player, and ties genuinely share a rank
              rather than the second player being pushed down. */}
          <caption className="mb-2 text-left text-gray-600">
            Best completed attempt per player, top 50. Tied players share a rank.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="py-1">
                Rank
              </th>
              <th scope="col">Player</th>
              <th scope="col">Score</th>
              <th scope="col">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {/* key={i} deliberately. A LeaderboardRow carries no identity --
                Task 16 kept a user id out of a public payload, and User.name
                is not unique, so a composite key of the visible fields can
                genuinely collide (two same-named players tied on the same
                score and tokens) and duplicate keys break reconciliation far
                harder than positional ones. This list is server-rendered,
                ordered by position, and holds no per-row client state, which
                is the case where the index IS the row's identity. */}
            {board.rows.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="py-1">{r.rank}</td>
                {/* The player names the row, so it is the row header: cell-by-
                    cell navigation then reads "Alice, Score, 90.00" instead of
                    an unattributed number. */}
                <th scope="row" className="font-normal">
                  {r.name}
                </th>
                {/* Task 16 carried display precision here on purpose: the API
                    returns finalScore unrounded (86.66666666666667) because
                    rounding at the source loses information irreversibly. Two
                    decimals, the same as the attempt page's final score, so a
                    player sees one number in both places. */}
                <td>{r.score.toFixed(2)}</td>
                <td>{r.totalTokens}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
