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
              <th scope="col" id="lb-rank" className="py-1">
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
                {/* R71: `headers`, not the automatic algorithm. The player is
                    the row header, but the WHATWG header/data-cell algorithm
                    scans LEFT and UP only, so a th to the right of a cell is
                    never found -- scope="row" reaches Score and Tokens and
                    misses Rank, the one number this page exists to state. An
                    explicit `headers` fixes it without moving the column.
                    BOTH ids are required: `headers` REPLACES the automatic
                    assignment rather than adding to it, so listing only the
                    player would trade the missing row header for a missing
                    column header ("T20 Grace, 1" instead of "Rank, 1").
                    Row header first, matching the order the automatic scan
                    produces for the cells that do not need this. */}
                <td headers={`lb-p${i} lb-rank`} className="py-1">
                  {r.rank}
                </td>
                {/* Score and Tokens follow this cell, so the scan finds it and
                    they need nothing: "T20 Grace, Score, 87.50". */}
                <th scope="row" id={`lb-p${i}`} className="font-normal">
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
