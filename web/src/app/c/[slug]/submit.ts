// Submitting a prompt is TWO requests -- POST /api/attempts creates the
// Attempt row, POST /api/attempts/<id>/rounds creates round 0 and fans the
// jobs out -- and nothing makes them atomic. Extracted from editor.tsx so the
// failure paths are testable without a DOM (vitest cannot import .tsx in this
// project; Task 17 set the precedent of moving the logic to a plain module
// rather than adding a DOM environment).
//
// Everything below exists because of the gap between those two requests.
//
// POST /api/attempts creates an unconditional new row -- read, not assumed:
// it has no "does this user already have an active attempt here" check. So if
// the second request fails for ANY reason (503 no eligible models, a 400, an
// expired session, a dropped connection), the user is holding an attempt with
// no rounds, and Task 15 can never complete it because completion needs both
// rounds terminal. A naive retry would call BOTH endpoints again and mint a
// second orphan per click.
//
// So the caller keeps the attempt id and hands it back, and a retry reuses it
// rather than creating another. That bounds the damage at ONE stranded attempt
// per page load however many times the user retries. Closing the residual gap
// -- a rejection on the FIRST request, where the row can be committed with the
// response lost and the client never learns the id -- needs POST /api/attempts
// to be idempotent per (user, challenge, active), which is that route's
// decision to make, not this page's.

type Result = {
  // The attempt to REUSE on the next click, null when none exists yet.
  attemptId: string | null;
  // null means round 0 is running and the caller should navigate to the
  // attempt; otherwise the message to show, with the prompt left untouched.
  error: string | null;
};

const NETWORK = "network error, try again";

// A 500, a proxy error page or a truncated body is not JSON. Without the catch
// this rejects out of the submit handler and the form goes silently dead --
// the same hole Task 17 closed in register/submit.ts.
async function serverError(res: Response, fallback: string) {
  const data = await res.json().catch(() => null);
  return typeof data?.error === "string" ? data.error : fallback;
}

// true = round 0 exists, false = it does not, string = do not write, show this.
//
// The R62 lesson applied to the second request: a rejected fetch does not
// prove nothing was created. If the round DID land, blindly re-POSTing is not
// merely wasteful -- once its runs have gone terminal the route's round-0
// branch no longer applies and the same call creates ROUND 2 from the
// challenge's followup prompt, sweeping the user past the round-1 results they
// paid tokens for. So a retry asks before it writes, and only writes on a
// definite "no".
//
// R67: a non-2xx answer is not a network failure, and telling a user with an
// expired session to "try again" is advice that can never succeed -- a dead
// session returns the same 401 forever, and that is most likely exactly when
// this path runs, after a long edit of a long prompt. The body goes through
// the same extraction the sibling POSTs use, so "login required" reaches the
// user here as well; the fallback stays the network message because a body
// with no message at all is a proxy page, not the server talking.
async function roundLanded(attemptId: string): Promise<boolean | string> {
  let res: Response;
  try {
    res = await fetch(`/api/attempts/${attemptId}`);
  } catch {
    return NETWORK;
  }
  if (!res.ok) return await serverError(res, NETWORK);
  const data = await res.json().catch(() => null);
  return Array.isArray(data?.rounds) ? data.rounds.length > 0 : NETWORK;
}

export async function submitPrompt(
  challengeSlug: string,
  promptText: string,
  attemptId: string | null,
): Promise<Result> {
  if (attemptId) {
    const landed = await roundLanded(attemptId);
    // Unknown: the attempt may already be running. Reporting the failure and
    // keeping the id is the only safe answer -- the next click asks again.
    if (typeof landed === "string") return { attemptId, error: landed };
    if (landed) return { attemptId, error: null };
  } else {
    let created: Response;
    try {
      created = await fetch("/api/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeSlug }),
      });
    } catch {
      return { attemptId: null, error: NETWORK };
    }
    if (!created.ok)
      return { attemptId: null, error: await serverError(created, "could not start an attempt") };
    const data = await created.json().catch(() => null);
    // Without this the id is `undefined` and the next request posts to
    // /api/attempts/undefined/rounds, whose 404 ("not found") reads as if the
    // challenge were missing.
    if (typeof data?.id !== "string")
      return { attemptId: null, error: "could not start an attempt" };
    attemptId = data.id;
  }

  let round: Response;
  try {
    round = await fetch(`/api/attempts/${attemptId}/rounds`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ promptText }),
    });
  } catch {
    // The attempt id survives in the return value, so the next click resumes
    // this one instead of stranding it and minting another.
    return { attemptId, error: NETWORK };
  }
  if (!round.ok)
    return { attemptId, error: await serverError(round, "could not send the prompt") };
  return { attemptId, error: null };
}
