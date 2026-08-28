import { beforeEach, describe, expect, it, vi } from "vitest";
import { submitPrompt } from "./submit";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const SLUG = "rate-limiter";
const PROMPT = "Implement a token bucket.";
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const rejects = () => Promise.reject(new TypeError("Failed to fetch"));

beforeEach(() => fetchMock.mockReset());

const calls = () => fetchMock.mock.calls.map((c) => `${c[1]?.method ?? "GET"} ${c[0]}`);

describe("submitPrompt: first submit", () => {
  it("creates the attempt, posts the prompt, and reports where to go", async () => {
    fetchMock.mockResolvedValueOnce(reply(201, { id: "att1" }));
    fetchMock.mockResolvedValueOnce(reply(201, { roundId: "r1", index: 0 }));

    expect(await submitPrompt(SLUG, PROMPT, null)).toEqual({ attemptId: "att1", error: null });
    expect(calls()).toEqual(["POST /api/attempts", "POST /api/attempts/att1/rounds"]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ challengeSlug: SLUG });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ promptText: PROMPT });
  });

  it("surfaces the attempt route's own message and creates nothing to resume", async () => {
    fetchMock.mockResolvedValueOnce(reply(429, { error: "daily token quota reached" }));

    expect(await submitPrompt(SLUG, PROMPT, null)).toEqual({
      attemptId: null,
      error: "daily token quota reached",
    });
    expect(calls()).toEqual(["POST /api/attempts"]);
  });

  it("falls back to a generic message when the failure body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>502</html>", { status: 502 }));

    expect(await submitPrompt(SLUG, PROMPT, null)).toEqual({
      attemptId: null,
      error: "could not start an attempt",
    });
  });

  // Without the typeof guard the id is `undefined` and the round POST goes to
  // /api/attempts/undefined/rounds, whose 404 reads as a missing challenge.
  it("refuses to continue when the 201 carries no id", async () => {
    fetchMock.mockResolvedValueOnce(reply(201, { ok: true }));

    expect(await submitPrompt(SLUG, PROMPT, null)).toEqual({
      attemptId: null,
      error: "could not start an attempt",
    });
    expect(calls()).toEqual(["POST /api/attempts"]);
  });

  it("reports a rejected create instead of throwing out of the handler", async () => {
    fetchMock.mockImplementationOnce(rejects);

    expect(await submitPrompt(SLUG, PROMPT, null)).toEqual({ attemptId: null, error: "network error, try again" });
  });
});

// The whole reason this module exists: POST /api/attempts creates a row
// unconditionally, so a failure in the SECOND request leaves an attempt with
// no rounds that Task 15 can never complete.
describe("submitPrompt: the round failed, so the attempt is stranded", () => {
  it("hands the attempt id back on a 503 so a retry cannot mint a second one", async () => {
    fetchMock.mockResolvedValueOnce(reply(201, { id: "att1" }));
    fetchMock.mockResolvedValueOnce(reply(503, { error: "no active models for this challenge" }));

    expect(await submitPrompt(SLUG, PROMPT, null)).toEqual({
      attemptId: "att1",
      error: "no active models for this challenge",
    });
  });

  it("hands the attempt id back on a rejected round POST too", async () => {
    fetchMock.mockResolvedValueOnce(reply(201, { id: "att1" }));
    fetchMock.mockImplementationOnce(rejects);

    expect(await submitPrompt(SLUG, PROMPT, null)).toEqual({ attemptId: "att1", error: "network error, try again" });
  });

  it("resumes that attempt instead of creating another", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { id: "att1", rounds: [] }));
    fetchMock.mockResolvedValueOnce(reply(201, { roundId: "r1", index: 0 }));

    expect(await submitPrompt(SLUG, PROMPT, "att1")).toEqual({ attemptId: "att1", error: null });
    expect(calls()).toEqual(["GET /api/attempts/att1", "POST /api/attempts/att1/rounds"]);
  });

  it("still resumes the same attempt after repeated failures", async () => {
    for (let i = 0; i < 3; i++) {
      fetchMock.mockResolvedValueOnce(reply(200, { id: "att1", rounds: [] }));
      fetchMock.mockResolvedValueOnce(reply(503, { error: "no active models for this challenge" }));
    }
    let state: string | null = "att1";
    for (let i = 0; i < 3; i++) state = (await submitPrompt(SLUG, PROMPT, state)).attemptId;

    expect(state).toBe("att1");
    expect(calls().filter((c) => c === "POST /api/attempts")).toEqual([]);
  });
});

// A rejected round POST does not prove the round was not created (R62). If it
// WAS, and its runs have since gone terminal, re-POSTing no longer hits the
// route's round-0 branch -- it creates ROUND 2 from the challenge's followup
// prompt and skips the user past the round-1 results. So a retry asks first.
describe("submitPrompt: the round landed but the answer was lost", () => {
  it("navigates to the running attempt instead of posting a second round", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { id: "att1", rounds: [{ index: 0 }] }));

    expect(await submitPrompt(SLUG, PROMPT, "att1")).toEqual({ attemptId: "att1", error: null });
    expect(calls()).toEqual(["GET /api/attempts/att1"]);
  });

  it("writes nothing when it cannot find out whether the round exists", async () => {
    fetchMock.mockImplementationOnce(rejects);

    expect(await submitPrompt(SLUG, PROMPT, "att1")).toEqual({ attemptId: "att1", error: "network error, try again" });
    expect(calls()).toEqual(["GET /api/attempts/att1"]);
  });

  it("writes nothing when the lookup answers with an error", async () => {
    fetchMock.mockResolvedValueOnce(reply(500, { error: "challenge is missing its reference timing" }));

    expect(await submitPrompt(SLUG, PROMPT, "att1")).toEqual({ attemptId: "att1", error: "network error, try again" });
    expect(calls()).toEqual(["GET /api/attempts/att1"]);
  });

  it("writes nothing when the lookup body is not the expected shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>200</html>", { status: 200 }));

    expect(await submitPrompt(SLUG, PROMPT, "att1")).toEqual({ attemptId: "att1", error: "network error, try again" });
    expect(calls()).toEqual(["GET /api/attempts/att1"]);
  });
});
