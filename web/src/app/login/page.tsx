"use client";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className="mx-auto flex max-w-sm flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        // R47: the server lowercases and trims the email on both registration
        // and login, so nothing is normalized here -- a second normalizer
        // could only disagree with the one that owns the lookup.
        const res = await signIn("credentials", { email, password, redirect: false });
        // One message for both "no such account" and "wrong password": the
        // login path is not an account-existence oracle (R45 paid for a dummy
        // bcrypt compare to close the timing half of the same hole).
        if (!res?.ok) setError("wrong email or password");
        else {
          router.push("/");
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
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="rounded bg-black p-2 text-white">Log in</button>
      <Link href="/register" className="text-sm underline">
        No account? Register
      </Link>
    </form>
  );
}
