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

// Where to go after a successful sign-in: always a same-origin path, and "/"
// whenever it cannot be. Client-only, like the rest of this module.
//
// Lives beside signInCredentials because it is the same story -- every
// credentials sign-in in the app ends in this redirect -- and because it is
// the half that must not be re-typed anywhere: an unvalidated callbackUrl is
// an open redirect.
//
// R68: this is decided by PARSING, not by inspecting characters. The previous
// version tested the shape (`/^\/[^/\\]/`) and was bypassed, because the
// consumer does not treat the string as an opaque path -- Next's client router
// does `new URL(addBasePath(href), location.href)`, and the WHATWG parser
// strips ASCII TAB, CR and LF wherever they appear BEFORE anything else runs.
// So `/<TAB>/evil.example` passed a guard looking at the second character and
// then collapsed into `//evil.example`, a live redirect to another origin
// moments after the victim typed a real password into the real site.
//
// Rejecting those three characters would fix those three characters. A
// blocklist has to model every quirk of a parser it does not own, and the next
// quirk is the next bypass -- which is this run's signature failure, so the
// guard uses the router's OWN parser and compares origins. It cannot disagree
// with the consumer about what a string means, because it is asking the same
// question of the same implementation. `javascript:` and `data:` parse to
// origin "null"; every escape form resolves to a foreign origin; `/c/../../x`
// stays same-origin and harmless; and an absolute URL on our own origin is
// correctly allowed rather than over-blocked. What comes back is normalized by
// the parser, not echoed.
export function safeCallbackUrl(): string {
  const url = new URLSearchParams(window.location.search).get("callbackUrl");
  if (!url) return "/";
  try {
    const u = new URL(url, window.location.origin);
    if (u.origin !== window.location.origin) return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}
