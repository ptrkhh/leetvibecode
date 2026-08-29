import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({ getProviders: vi.fn(), signIn: vi.fn() }));

import { getProviders, signIn } from "next-auth/react";
import { safeCallbackUrl, signInCredentials } from "./sign-in";

const providersMock = getProviders as unknown as Mock;
const signInMock = signIn as unknown as Mock;

beforeEach(() => {
  providersMock.mockReset();
  signInMock.mockReset();
});

// The assertion that matters in every case below is `signIn` NOT being
// called: signIn's own providers fetch failing is what hard-navigates out of
// the app, and once it is entered no app-level code runs again. The guard is
// only worth anything if it stops the call from happening at all.
describe("signInCredentials: the providers leg", () => {
  it("fails the sign-in without calling signIn when providers come back null", async () => {
    providersMock.mockResolvedValueOnce(null);

    expect(await signInCredentials("a@b.test", "pw")).toBeNull();
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("fails the sign-in without calling signIn when getProviders rejects", async () => {
    providersMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    expect(await signInCredentials("a@b.test", "pw")).toBeNull();
    expect(signInMock).not.toHaveBeenCalled();
  });

  // Callers do not wrap this function, so a SYNCHRONOUS throw would surface as
  // an unhandled rejection in a submit handler -- the exact failure two rounds
  // of review have been closing.
  it("never rejects, even when getProviders throws synchronously", async () => {
    providersMock.mockImplementationOnce(() => { throw new Error("sync boom"); });

    await expect(signInCredentials("a@b.test", "pw")).resolves.toBeNull();
  });
});

describe("signInCredentials: the credentials leg", () => {
  it("passes the credentials through untouched with redirect disabled", async () => {
    providersMock.mockResolvedValueOnce({ credentials: { id: "credentials" } });
    const result = { ok: true, error: null };
    signInMock.mockResolvedValueOnce(result);

    expect(await signInCredentials("Foo@Bar.com", "password1")).toBe(result);
    // R47: normalization is the server's job; nothing here may touch the email.
    expect(signInMock).toHaveBeenCalledWith("credentials", {
      email: "Foo@Bar.com", password: "password1", redirect: false,
    });
  });

  it("returns null rather than throwing when the credentials leg rejects", async () => {
    providersMock.mockResolvedValueOnce({ credentials: { id: "credentials" } });
    signInMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    expect(await signInCredentials("a@b.test", "pw")).toBeNull();
  });

  it("passes a refused sign-in straight back to the caller", async () => {
    providersMock.mockResolvedValueOnce({ credentials: { id: "credentials" } });
    signInMock.mockResolvedValueOnce({ ok: false, error: "CredentialsSignin" });

    expect(await signInCredentials("a@b.test", "pw")).toEqual({ ok: false, error: "CredentialsSignin" });
  });
});

const ORIGIN = "https://app.example";
// The function reads window.location; the test decides what it says. Both
// halves come from the same object in the browser, which is why neither is a
// parameter.
const at = (search: string) => {
  vi.stubGlobal("window", { location: { search, origin: ORIGIN } });
  return safeCallbackUrl();
};
const param = (value: string) => at(`?callbackUrl=${encodeURIComponent(value)}`);

afterEach(() => vi.unstubAllGlobals());

describe("safeCallbackUrl", () => {
  it("returns a same-origin path", () => {
    expect(at("?callbackUrl=/c/rate-limiter")).toBe("/c/rate-limiter");
    expect(at("?callbackUrl=/c/a%2Fb&other=1")).toBe("/c/a/b");
    expect(param("/c/x?tab=2#top")).toBe("/c/x?tab=2#top");
  });

  // R68: the parser normalizes, so an absolute URL on our OWN origin is a
  // legitimate destination rather than something to block, and a traversal
  // that cannot leave the origin comes back collapsed instead of refused.
  it("accepts an absolute URL at this origin, reduced to its path", () => {
    expect(param(`${ORIGIN}/c/x?a=1#f`)).toBe("/c/x?a=1#f");
    expect(param("/c/../../evil")).toBe("/evil");
    // No scheme and no leading slashes: a RELATIVE reference, which resolves
    // against our own origin and cannot address another one. The shape check
    // refused it; the parser normalizes it, which is the correct answer.
    expect(param("evil.example")).toBe("/evil.example");
  });

  it("refuses anything that could leave the origin", () => {
    for (const bad of [
      "//evil.example", "/\\evil.example", "\\\\evil.example",
      "https://evil.example", "http://evil.example", "//attacker@evil.example",
      "javascript:alert(1)", "data:text/html,<script>alert(1)</script>",
      "",
    ])
      expect(param(bad)).toBe("/");
  });

  // R68, the live bypass. The WHATWG URL parser strips ASCII TAB, CR and LF
  // WHEREVER they occur, before any other parsing -- so each of these collapses
  // into `//evil.example` while passing any check that reads the second
  // character. Confirmed end to end against a production build: a real login
  // followed by a top-level document navigation to the attacker's origin.
  it("refuses the control characters the URL parser strips out", () => {
    for (const c of ["\t", "\r", "\n", "\r\n"]) {
      expect(param(`/${c}/evil.example`)).toBe("/");
      expect(param(`/${c}/evil.example/path?x=1`)).toBe("/");
      expect(param(`htt${c}ps://evil.example`)).toBe("/");
    }
  });

  it("falls back to the home page when there is no parameter at all", () => {
    expect(at("")).toBe("/");
    expect(at("?x=1")).toBe("/");
    expect(at("?callbackUrl=")).toBe("/");
  });
});
