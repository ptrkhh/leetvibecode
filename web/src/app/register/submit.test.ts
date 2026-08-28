import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/sign-in", () => ({ signInCredentials: vi.fn() }));

import { signInCredentials } from "../../lib/sign-in";
import { submitRegistration } from "./submit";

const signInMock = signInCredentials as unknown as Mock;
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// Mixed case on purpose: R47 puts normalization on the server, so whatever is
// typed must reach both /api/register and signIn untouched.
const FIELDS = { name: "Player One", email: "Foo@Bar.com", password: "password1" };
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

beforeEach(() => {
  fetchMock.mockReset();
  signInMock.mockReset();
});

describe("submitRegistration: the registration failed", () => {
  // The one that matters: signing in with credentials the register route just
  // refused would show "wrong email or password" for a duplicate email.
  it("surfaces a 409 and never attempts a sign-in", async () => {
    fetchMock.mockResolvedValueOnce(reply(409, { error: "email already registered" }));

    expect(await submitRegistration(FIELDS)).toBe("email already registered");
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("surfaces the server's own 400 message rather than inventing one", async () => {
    const msg = "invalid email, name, or password (min 8 chars)";
    fetchMock.mockResolvedValueOnce(reply(400, { error: msg }));

    expect(await submitRegistration(FIELDS)).toBe(msg);
    expect(signInMock).not.toHaveBeenCalled();
  });

  // A 500 or a proxy error page is not JSON. Without the catch this rejects
  // inside the submit handler and the form dies with no message at all.
  it("falls back to a generic message when the error body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>502</html>", { status: 502 }));

    expect(await submitRegistration(FIELDS)).toBe("registration failed");
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("falls back when the JSON body carries no error string", async () => {
    fetchMock.mockResolvedValueOnce(reply(400, { detail: 42 }));

    expect(await submitRegistration(FIELDS)).toBe("registration failed");
  });
});

// The gap the 9-mutation table left: every mutation there was logical or
// response-shaped, and none of them made a request REJECT. An unwrapped fetch
// escapes the submit handler as an unhandled rejection -- no message, button
// still enabled, nothing for the user to act on.
describe("submitRegistration: the network failed", () => {
  // R62: a rejected fetch does not prove nothing was created -- the server can
  // commit and then lose the socket before the response is relayed. So the
  // catch probes instead of concluding, and "try again" is only reached once
  // the probe has established there is no account to sign in to.
  it("reports a rejected fetch instead of throwing, once the probe finds no account", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    signInMock.mockResolvedValueOnce({ ok: false, error: "CredentialsSignin" });

    await expect(submitRegistration(FIELDS)).resolves.toBe("network error, try again");
    expect(signInMock).toHaveBeenCalledWith(FIELDS.email, FIELDS.password);
  });

  it("signs the user in anyway when the row WAS committed before the socket died", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    signInMock.mockResolvedValueOnce({ ok: true, error: null });

    // Not a message: the account exists and the user is now signed in, which
    // is a better outcome than the most honest possible error text.
    await expect(submitRegistration(FIELDS)).resolves.toBeNull();
  });

  it("still reports a network error when the probe cannot reach the server either", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    signInMock.mockResolvedValueOnce(null);

    await expect(submitRegistration(FIELDS)).resolves.toBe("network error, try again");
  });

  // The account exists by now, so "try again" would walk the user into a
  // permanent 409. Same message as a refused sign-in, because the advice is
  // the same: log in.
  // signInCredentials never rejects -- it returns null for every failure,
  // network included (asserted in lib/sign-in.test.ts). Mocking a rejection
  // here would be testing a contract the helper does not have.
  it("tells a user whose account WAS created to log in when the sign-in fails outright", async () => {
    fetchMock.mockResolvedValueOnce(reply(201, { ok: true }));
    signInMock.mockResolvedValueOnce(null);

    await expect(submitRegistration(FIELDS)).resolves.toBe("account created — please log in");
  });
});

describe("submitRegistration: the registration succeeded", () => {
  it("posts the typed fields verbatim, then signs in with the same credentials", async () => {
    fetchMock.mockResolvedValueOnce(reply(201, { ok: true }));
    signInMock.mockResolvedValueOnce({ ok: true, error: null });

    expect(await submitRegistration(FIELDS)).toBeNull();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/register");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(FIELDS);
    // The literal submitted, not live component state: R62's probe must never
    // be able to sign in as a different account than the one just registered.
    expect(signInMock).toHaveBeenCalledWith(FIELDS.email, FIELDS.password);
  });

  // The account now exists, so "registration failed" would send the user back
  // round the loop into a guaranteed 409.
  it("tells the user to log in when the account was created but sign-in failed", async () => {
    fetchMock.mockResolvedValueOnce(reply(201, { ok: true }));
    signInMock.mockResolvedValueOnce({ ok: false, error: "CredentialsSignin" });

    expect(await submitRegistration(FIELDS)).toBe("account created — please log in");
  });

  it("treats an absent signIn result as a failed sign-in, not a success", async () => {
    fetchMock.mockResolvedValueOnce(reply(201, { ok: true }));
    signInMock.mockResolvedValueOnce(undefined);

    expect(await submitRegistration(FIELDS)).toBe("account created — please log in");
  });
});
