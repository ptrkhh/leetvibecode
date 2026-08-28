import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "../lib/auth";
import { listChallengesWithBests } from "../lib/queries";

export default async function Home() {
  const session = await getServerSession(authOptions);
  // One query pair, in queries.ts (R12). The personal best is already joined
  // to each row, so nothing here is O(n^2) and no challenge id reaches the
  // markup.
  const challenges = await listChallengesWithBests(session?.user.id);
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {challenges.map((c) => (
        <li key={c.slug} className="rounded border p-4">
          <Link href={`/c/${c.slug}`} className="font-semibold underline">
            {c.title}
          </Link>
          <p className="text-sm text-gray-600">
            {c.difficulty} · par {c.parTokens} tokens
            {/* Task 16 carried the display-precision call to the UI: the API
                returns finalScore unrounded (86.66666666666667). */}
            {c.best != null && ` · personal best ${c.best.toFixed(1)}`}
          </p>
          <Link href={`/leaderboard/${c.slug}`} className="text-sm underline">
            Leaderboard
          </Link>
        </li>
      ))}
    </ul>
  );
}
