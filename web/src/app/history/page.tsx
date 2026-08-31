import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { authOptions } from "../../lib/auth";
import { listUserAttempts } from "../../lib/queries";

// The nav has linked /history since Task 17; this is the page it was pointing
// at.
export default async function History() {
  const session = await getServerSession(authOptions);
  // Same shape as /c/[slug] and /a/[id]: carry the destination so a logged-out
  // visitor lands back here rather than on the home page. safeCallbackUrl
  // re-validates it on the way out, so nothing trusts the round trip.
  if (!session) redirect("/login?callbackUrl=/history");
  // R66 lives inside this helper's WHERE, and that is the whole reason to call
  // it rather than re-issue the query here: an attempt with no rounds is
  // always a failed start, those rows are free to create and are NEWER than
  // real history, and unfiltered they evict every genuine attempt through
  // `take: 100` before any page sees a row. A hand-written copy would filter
  // an already-truncated window and still show nothing.
  const attempts = await listUserAttempts(session.user.id);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">My attempts</h1>
      {attempts.length === 0 ? (
        <p className="text-gray-600">
          You have not started any attempts yet.{" "}
          <Link className="underline" href="/">
            Browse challenges
          </Link>
          .
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <caption className="mb-2 text-left text-gray-600">
            Your attempts, newest first.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="py-1">
                Challenge
              </th>
              <th scope="col">Status</th>
              <th scope="col">Score</th>
              <th scope="col">Started (UTC)</th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((a) => (
              <tr key={a.id} className="border-t">
                {/* The challenge names the row (row header), and its link is
                    the row's link -- one target per row, with the accessible
                    name a screen reader already has in context. */}
                <th scope="row" className="py-1 font-normal">
                  <Link className="underline" href={`/a/${a.id}`}>
                    {a.challengeTitle}
                  </Link>
                </th>
                <td>{a.status}</td>
                {/* An active attempt has no score yet and a voided one is
                    explicitly never scored (spec L124, L131), so the column is
                    empty for both rather than 0.00 -- a zero here would read as
                    "you scored nothing". Same two decimals as the leaderboard
                    and the attempt page. */}
                <td>{a.finalScore == null ? "—" : a.finalScore.toFixed(2)}</td>
                {/* ISO/UTC rather than toLocaleString: a server component
                    formats with the SERVER's locale and timezone, so a
                    localized string is not the reader's local time anyway --
                    it is the host's, silently. UTC is at least labelled. */}
                <td>
                  <time dateTime={a.startedAt.toISOString()}>
                    {a.startedAt.toISOString().slice(0, 16).replace("T", " ")}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
