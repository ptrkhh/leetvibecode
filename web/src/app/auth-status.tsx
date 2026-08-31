"use client";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";

// R16: this cannot live in layout.tsx's module scope as the plan has it.
// useSession forces "use client" on the whole module, and a client module may
// not export `metadata` -- layout.tsx does, so that version does not build.
export default function AuthStatus() {
  const { data: session, status } = useSession();
  // Render nothing rather than "Log in" while the session is still being
  // fetched: a logged-in user should never see a login link flash on every
  // page load.
  if (status === "loading") return null;
  return session ? (
    <>
      <span className="text-sm">{session.user.name}</span>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/" })}
        className="text-sm underline"
      >
        Log out
      </button>
    </>
  ) : (
    <Link href="/login" className="text-sm underline">
      Log in
    </Link>
  );
}
