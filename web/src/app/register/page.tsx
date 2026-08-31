"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { submitRegistration } from "./submit";

export default function Register() {
  const router = useRouter();
  const [name, setName] = useState("");
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
        // A second click while the first request is in flight registers the
        // same email twice: R46 makes the DB safe, but the loser's 409 would
        // tell a user whose account was just created that the email is taken.
        setBusy(true);
        const message = await submitRegistration({ name, email, password });
        // R63: only the error branch re-enables. Clearing it before the
        // client-side navigation lands leaves a window in which a re-submit
        // races the first request -- reproduced at 1.3ms with a
        // MutationObserver, two real POSTs, the second answering "email
        // already registered" to the user whose account the first had just
        // created. On success this component is about to be unmounted.
        if (message) {
          setBusy(false);
          setError(message);
        } else {
          router.push("/");
          router.refresh();
        }
      }}
    >
      <h1 className="text-2xl font-bold">Register</h1>
      <input
        className="rounded border p-2"
        placeholder="name"
        aria-label="Name"
        autoComplete="name"
        required
        aria-describedby="register-error"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="rounded border p-2"
        type="email"
        placeholder="email"
        aria-label="Email"
        autoComplete="email"
        required
        aria-describedby="register-error"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="rounded border p-2"
        type="password"
        placeholder="password"
        aria-label="Password"
        autoComplete="new-password"
        required
        aria-describedby="register-error"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <p id="register-error" role="alert" className="text-sm text-red-600">
        {error}
      </p>
      <button disabled={busy} className="rounded bg-black p-2 text-white disabled:opacity-50">
        Register
      </button>
      <Link href="/login" className="text-sm underline">
        Have an account? Log in
      </Link>
    </form>
  );
}
