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
  // Used on both failure paths below, so the probe and the ordinary sign-in
  // cannot drift apart.
  const trySignIn = () =>
    signIn("credentials", {
      email: body.email,
      password: body.password,
      redirect: false,
    }).catch(() => null);

  let res: Response;
  try {
    res = await fetch("/api/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // R62: a rejected fetch does NOT mean nothing was created. The server can
    // commit the row and then have the socket die before a byte of the
    // response is relayed -- reproduced against this route with a forwarding
    // proxy, and the account existed. The client cannot distinguish that from
    // a request that never arrived, so it does not guess: it asks. If the
    // account exists the probe signs the user in and they proceed normally,
    // which beats any message; if it does not, the probe fails and "try again"
    // is accurate.
    return (await trySignIn())?.ok ? null : "network error, try again";
  }
  if (!res.ok) {
    // A 500 or a proxy error page has no JSON body; .catch keeps that from
    // throwing out of the submit handler and leaving the form silently dead.
    const data = await res.json().catch(() => null);
    return typeof data?.error === "string" ? data.error : "registration failed";
  }
  // Past this point the account EXISTS, so a network failure here must not
  // produce "try again" -- that walks the user into a permanent 409. A
  // rejection collapses into the same branch as a refused sign-in, whose
  // message ("log in") is the correct advice either way.
  return (await trySignIn())?.ok ? null : "account created — please log in";
}
