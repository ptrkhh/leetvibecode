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
  return (
    <form
      className="mx-auto flex max-w-sm flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        const message = await submitRegistration({ name, email, password });
        if (message) setError(message);
        else {
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
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="rounded bg-black p-2 text-white">Register</button>
      <Link href="/login" className="text-sm underline">
        Have an account? Log in
      </Link>
    </form>
  );
}
