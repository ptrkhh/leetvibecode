import { signIn } from "next-auth/react";

// Returns null when the user is registered AND signed in, otherwise the
// message to show. Extracted from the page so the failure paths are testable
// without a DOM: they are the only real logic on either auth page.
//
// The three outcomes are deliberately distinct.
//
// 1. Registration rejected (400 invalid / 409 duplicate): return the SERVER'S
//    message and, critically, do not fall through into signIn. Signing in with
//    credentials for an account that was just refused would report "wrong
//    email or password" for what is really "email already registered", which
//    is the one thing the user needs to know.
// 2. Registered but sign-in failed: the account EXISTS, so telling the user
//    registration failed would send them round the loop to a guaranteed 409.
// 3. Both succeeded: null.
//
// R47: no client-side email normalization. The register route lowercases and
// trims, and authorize() normalizes the same way, so both ends already agree;
// a third normalizer here could only introduce a disagreement.
export async function submitRegistration(body: {
  name: string;
  email: string;
  password: string;
}): Promise<string | null> {
  const res = await fetch("/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // A 500 or a proxy error page has no JSON body; .catch keeps that from
    // throwing out of the submit handler and leaving the form silently dead.
    const data = await res.json().catch(() => null);
    return typeof data?.error === "string" ? data.error : "registration failed";
  }
  const signedIn = await signIn("credentials", {
    email: body.email,
    password: body.password,
    redirect: false,
  });
  return signedIn?.ok ? null : "account created — please log in";
}
