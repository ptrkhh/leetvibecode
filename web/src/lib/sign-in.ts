import { getProviders, signIn } from "next-auth/react";

// Client-only. The single credentials sign-in for the whole app: the register
// form's probe, its post-201 sign-in, and the login form all route through
// here, so the guard below cannot be present in one of them and missing from
// the next.
//
// R64: signIn() is TWO HTTP calls, and it handles a failure on the FIRST one
// by leaving the application. Its own code is
//
//     providers = await getProviders();
//     if (!providers) { window.location.href = `${baseUrl}/error`; return; }
//
// unconditionally -- `redirect: false` does not suppress it -- and fetchData
// resolves null instead of rejecting, so no .catch() in this codebase can see
// it. Under a total outage that navigation fails too and the browser shows its
// own interstitial: no nav, no way back, and every field the user just typed
// is gone. R61's pages.error only helps while enough connectivity survives to
// complete a redirect, because it IS a redirect.
//
// So the fetch next-auth is about to make anyway is made here first, where a
// null answer is an ordinary failed sign-in: the form stays mounted, the
// message renders, and the typed name/email/password are still there to retry
// with. That is what the extra same-origin GET on the happy path buys.
//
// ponytail: signIn re-fetches providers internally, so a network death landing
// between this check and that one still hard-navigates. Unavoidable without
// forking next-auth -- the window is microseconds inside an outage measured in
// seconds. Reconsider if next-auth ever honours redirect:false on that branch.
// Never rejects -- one try/catch over the whole body rather than a .catch() on
// each call, so the contract is structural rather than a reading of two
// separate guards. null means "not signed in", for every reason.
export async function signInCredentials(email: string, password: string) {
  try {
    const providers = await getProviders();
    if (!providers) return null;
    return await signIn("credentials", { email, password, redirect: false });
  } catch {
    return null;
  }
}

// Where to go after a successful sign-in. `search` is window.location.search;
// the answer is always a same-origin path, and "/" whenever it cannot be.
//
// Lives beside signInCredentials because it is the same story -- every
// credentials sign-in in the app ends in a redirect -- and because it is the
// half of it that must not be re-typed anywhere: an unvalidated callbackUrl is
// an open redirect, so "starts with a slash" alone is not enough. `//evil.com`
// is protocol-relative and `/\evil.com` is treated the same way by browsers
// that normalize the backslash, so the second character must be neither. What
// survives can only be a path, and router.push treats it as one.
export function safeCallbackUrl(search: string): string {
  const url = new URLSearchParams(search).get("callbackUrl");
  return url && /^\/[^/\\]/.test(url) ? url : "/";
}
