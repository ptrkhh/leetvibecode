"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { safeCallbackUrl, signInCredentials } from "../../lib/sign-in";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mx-auto flex max-w-sm flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        // R47: the server lowercases and trims the email on both registration
        // and login, so nothing is normalized here -- a second normalizer
        // could only disagree with the one that owns the lookup.
        setBusy(true);
        // signIn fetches; a dropped connection rejects it. Unwrapped that
        // escapes as an unhandled rejection and the form goes silent.
        // R64: guarded -- a bare signIn() hard-navigates out of the app when
        // its providers fetch fails, taking the typed credentials with it.
        const res = await signInCredentials(email, password);
        // One message for both "no such account" and "wrong password": the
        // login path is not an account-existence oracle (R45 paid for a dummy
        // bcrypt compare to close the timing half of the same hole).
        const message = !res
          ? "network error, try again"
          : res.ok
            ? null
            : "wrong email or password";
        // R63: see register/page.tsx -- only the error branch re-enables.
        if (message) {
          setBusy(false);
          setError(message);
        } else {
          // Read at submit time from window rather than with useSearchParams,
          // which would force a Suspense boundary around a page that is
          // otherwise static. Nothing renders it, so there is nothing to
          // hydrate.
          router.push(safeCallbackUrl(window.location.search));
          // The nav's session comes from SessionProvider, which signIn already
          // refreshed; this refetches the SERVER render so personal bests
          // appear without a full page reload.
          router.refresh();
        }
      }}
    >
      <h1 className="text-2xl font-bold">Log in</h1>
      <input
        className="rounded border p-2"
        type="email"
        placeholder="email"
        aria-label="Email"
        autoComplete="email"
        required
        aria-describedby="login-error"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="rounded border p-2"
        type="password"
        placeholder="password"
        aria-label="Password"
        autoComplete="current-password"
        required
        aria-describedby="login-error"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <p id="login-error" role="alert" className="text-sm text-red-600">
        {error}
      </p>
      <button disabled={busy} className="rounded bg-black p-2 text-white disabled:opacity-50">
        Log in
      </button>
      <Link href="/register" className="text-sm underline">
        No account? Register
      </Link>
    </form>
  );
}
