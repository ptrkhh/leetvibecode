import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("safeCallbackUrl", () => {
  it("returns a same-origin path", () => {
    expect(safeCallbackUrl("?callbackUrl=/c/rate-limiter")).toBe("/c/rate-limiter");
    expect(safeCallbackUrl("?callbackUrl=/c/a%2Fb&other=1")).toBe("/c/a/b");
  });

  it("refuses anything that could leave the origin", () => {
    // Protocol-relative, and the backslash form browsers normalize into it.
    // Both start with a slash, which is why "starts with /" is not the test.
    for (const bad of [
      "//evil.example", "/\\evil.example", "https://evil.example",
      "http://evil.example", "javascript:alert(1)", "evil.example", "",
    ])
      expect(safeCallbackUrl(`?callbackUrl=${encodeURIComponent(bad)}`)).toBe("/");
  });

  it("falls back to the home page when there is no parameter at all", () => {
    expect(safeCallbackUrl("")).toBe("/");
    expect(safeCallbackUrl("?x=1")).toBe("/");
    expect(safeCallbackUrl("?callbackUrl=")).toBe("/");
  });
});
