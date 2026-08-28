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
