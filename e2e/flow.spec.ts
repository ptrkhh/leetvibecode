import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

// Release gate: register -> pick a challenge -> submit a prompt -> round 1
// completes -> start round 2 -> attempt completes with a final score -> the
// leaderboard shows this run's own entry. Runs against a real Postgres, the
// real judge worker (OPENROUTER_MOCK=1: generation is instant and returns
// each challenge's reference solution, so accuracy/perf are near-ceiling and
// deterministic-ish) and a production (`next start`) web build -- R60: a dev
// server's RSC instrumentation embeds values in the flight payload that a
// production build does not, so a leak check against `next dev` is not
// trustworthy.
//
// Selectors are pinned against the ACTUAL source (web/src/app/**), not
// against the brief's guesses -- several of which do not match what Tasks
// 17-20 shipped (ledger: register/login placeholders and button names,
// the prompt textarea's accessible name, the idle-vs-busy submit label, the
// exact round-2 button text, and getByRole("alert") being ambiguous
// app-wide because of Next's own #__next-route-announcer__). The brief's own
// `getByText(/final score/i)` is additionally a live Playwright strict-mode
// violation on this page: both the status line (role="status", no colon)
// and the results box (has a colon) contain that substring once the attempt
// completes, so a bare text-regex match resolves to two elements. Scoped to
// #dashboard-status below instead.
//
// Timeout provenance: a full attempt is 4 models x 2 rounds, each with a
// REAL sandboxed test phase + bench phase (mock generation is instant; the
// sandbox work is not), gated at TEST_THREADS=2 concurrent sandbox runs, so
// each round's 4 test-phase jobs run in two waves. Measured directly on this
// host across four consecutive full lifecycles (register through
// leaderboard assertion, task-23-report.md has the raw numbers): round 1
// (prompt submit -> "Start round 2" visible) 4.9s-6.9s; round 2 (click ->
// final score visible) 4.9s-4.9s; full lifecycle 10.7s-13.3s -- an order of
// magnitude under the brief's copied 150_000ms guess. Set at roughly 13x the
// slowest observed single-round wave: comfortably absorbs host jitter
// (Task 21/22's own bench measurements put that at single-digit percent)
// without hiding a genuine hang behind a multi-minute wait, which is the
// failure mode a release gate most needs to avoid.
const ROUND_TIMEOUT = 90_000;

// R20: a shared "Player One" identity registered on every run makes the
// leaderboard assertion flaky once more than 50 runs accumulate on a
// challenge's top-50-capped board -- this run's row may not even be in the
// top 50. Both the email AND the display name must be unique: the
// leaderboard renders the player's NAME (queries.ts's LeaderboardRow), not
// the email, so a fixed name is exactly the same hazard as a fixed email.
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const NAME = `E2E ${RUN_ID}`;
const EMAIL = `e2e-${RUN_ID}@test.invalid`;
const PASSWORD = "correct horse battery staple 1";

// One of the 8 real seeded challenges (ledger: rate-limiter's title is
// "Token Bucket Rate Limiter"). The dev Postgres carries ~400 published rows
// left over from earlier tasks' test runs (Task 21/22 ledger note), most
// with UUID slugs, and the home page renders all of them -- clicking a link
// out of that list would be slow and brittle for no benefit, since the 8
// real challenges' slugs are stable, well-known content. Going straight to
// the URL sidesteps the pollution entirely rather than working around it in
// the selector.
const SLUG = "rate-limiter";
const TITLE = "Token Bucket Rate Limiter";

// A distinctive substring of the round-2 followup prompt
// (challenges/rate-limiter/challenge.yaml). R11 is the product's one
// content-secrecy rule: this text must never reach the client at all, at any
// point -- it is read by the judge directly from Postgres when it builds a
// model's round-2 conversation (judge/worker.py's handle_generate), and no
// web route selects Challenge.followupPrompt into any response (verified by
// reading every SELECT in web/src/lib/queries.ts and
// web/src/app/api/attempts/[id]/route.ts). Checked both as a content
// substring and as the literal JSON key name, which no query ever selects.
const FOLLOWUP_SENTINEL = "per-key buckets";
const FOLLOWUP_KEY = "followupPrompt";
const REFERENCE_KEY = "referenceMs";

// R78: what round 1 actually sends. Named so it can be compared against
// what Postgres actually stored, not just typed into the textarea.
const PROMPT_TEXT =
  "Implement the RateLimiter interface exactly as specified. Python only, no extra dependencies.";

// R78: a floor for the completed attempt's finalScore, MEASURED from real
// runs on this host, not guessed. 5 consecutive runs (task-23-report.md has
// the raw numbers) each scored EXACTLY 100, zero variance: mock mode submits
// the same reference solution for every model in both rounds, on the same
// sandbox image and host that recorded referenceMs, so accuracy clamps to
// 1.0 and perf clamps to min(1, ref/sub) >= 1.0 essentially always. The
// reviewer's inverted-judge regression (parse_junit's pass flag flipped)
// scored exactly 0 on identical input. 80 sits with 20 points of real margin
// below every observed healthy score and nowhere near 0, so it cannot be
// crossed by ordinary host jitter (perf timing noise -- Task 21/22's own
// measurements put that at single-digit percent) but is crossed immediately
// by a broken judge or a broken scoring formula.
const FINAL_SCORE_FLOOR = 80;

function requireDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // R2's convention, extended to this task by name ("every judge
    // invocation is prefixed set -a && . ../.env && set +a ... used by
    // T10/T23/T24"): fail loudly rather than silently misbehave. A
    // contributor who forgot to source the env gets a clear error, not a
    // gate that quietly stops checking what it claims to check.
    throw new Error(
      "DATABASE_URL is not set -- run the gate with the root .env sourced " +
        "(set -a && . ../.env && set +a).",
    );
  }
  return url;
}

// Single-scalar query, used both for R78's structural assertions (what did
// Postgres actually persist, as opposed to what the page happened to
// render) and for cleanup. `-t -A` (tuples-only, unaligned) gives exactly
// the value plus one trailing newline, stripped below -- not `.trim()`,
// which would also eat meaningful leading/trailing whitespace that is
// legitimately part of a multi-line prompt (the followup prompt is a
// several-line YAML block scalar).
function psqlOne(sql: string): string {
  return execFileSync("psql", [requireDbUrl(), "-t", "-A", "-c", sql], {
    encoding: "utf8",
  }).replace(/\n$/, "");
}

// Deletes exactly what this run created (Job/TestResult/BenchmarkResult ->
// Run -> Round -> Attempt -> User, in FK order -- Round_attemptId_fkey etc.
// are ON DELETE RESTRICT per Task 18's ledger measurement, so children must
// go first), scoped by this run's unique email. Runs unconditionally in
// afterAll, whatever the test's outcome, so a failed run does not leave a
// half-finished attempt behind either. Keeps the leaderboard's top-50 window
// from ever accumulating rows from repeated runs of this same gate, which is
// the same class of long-run flakiness R20 exists to prevent -- solved here
// by leaving no state rather than by hoping fewer than 50 gate runs happen
// before someone notices.
function cleanup() {
  const url = requireDbUrl();
  const sql = `
    DELETE FROM "Job" WHERE "runId" IN (
      SELECT r.id FROM "Run" r JOIN "Round" rnd ON rnd.id = r."roundId"
      JOIN "Attempt" a ON a.id = rnd."attemptId" JOIN "User" u ON u.id = a."userId"
      WHERE u.email = '${EMAIL}');
    DELETE FROM "TestResult" WHERE "runId" IN (
      SELECT r.id FROM "Run" r JOIN "Round" rnd ON rnd.id = r."roundId"
      JOIN "Attempt" a ON a.id = rnd."attemptId" JOIN "User" u ON u.id = a."userId"
      WHERE u.email = '${EMAIL}');
    DELETE FROM "BenchmarkResult" WHERE "runId" IN (
      SELECT r.id FROM "Run" r JOIN "Round" rnd ON rnd.id = r."roundId"
      JOIN "Attempt" a ON a.id = rnd."attemptId" JOIN "User" u ON u.id = a."userId"
      WHERE u.email = '${EMAIL}');
    DELETE FROM "Run" WHERE "roundId" IN (
      SELECT rnd.id FROM "Round" rnd JOIN "Attempt" a ON a.id = rnd."attemptId"
      JOIN "User" u ON u.id = a."userId" WHERE u.email = '${EMAIL}');
    DELETE FROM "Round" WHERE "attemptId" IN (
      SELECT a.id FROM "Attempt" a JOIN "User" u ON u.id = a."userId" WHERE u.email = '${EMAIL}');
    DELETE FROM "Attempt" WHERE "userId" IN (SELECT id FROM "User" WHERE email = '${EMAIL}');
    DELETE FROM "User" WHERE email = '${EMAIL}';
  `;
  // EMAIL/RUN_ID are generated by this file from Date.now()/Math.random(),
  // never from external input, so inline interpolation carries no injection
  // risk -- same trust level as the judge's own test fixtures, which write
  // comparable ad hoc SQL.
  execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-c", sql], { stdio: "inherit" });
}

test.afterAll(cleanup);

test("full attempt lifecycle on mock judge", async ({ page }) => {
  const t0 = Date.now();

  // ---- register (and, per register/submit.ts, auto sign-in) -------------
  await page.goto("/register");
  await page.getByPlaceholder("name").fill(NAME);
  await page.getByPlaceholder("email").fill(EMAIL);
  await page.getByPlaceholder("password").fill(PASSWORD);
  await page.getByRole("button", { name: "Register" }).click();
  await page.waitForURL("/");

  // ---- R11 pre-attempt: the challenge browse endpoint must carry neither
  // referenceMs nor the followup prompt. Checked against the live API (the
  // exact endpoint R11 is about), with a positive control (the title) so a
  // vacuous check -- one that would pass even if the endpoint 404'd -- is
  // ruled out.
  const preAttempt = await page.request.get(`/api/challenges/${SLUG}`);
  expect(preAttempt.ok()).toBeTruthy();
  const preAttemptBody = await preAttempt.text();
  expect(preAttemptBody).toContain(TITLE);
  expect(preAttemptBody).not.toContain(REFERENCE_KEY);
  expect(preAttemptBody).not.toContain(FOLLOWUP_KEY);
  expect(preAttemptBody).not.toContain(FOLLOWUP_SENTINEL);

  await page.goto(`/c/${SLUG}`);
  await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
  expect(await page.content()).not.toContain(FOLLOWUP_SENTINEL);

  // ---- round 1: submit prompt --------------------------------------------
  await page.getByRole("textbox", { name: "Prompt" }).fill(PROMPT_TEXT);
  await page.getByRole("button", { name: "Send to all models" }).click();
  await page.waitForURL(/\/a\//);
  const attemptId = page.url().split("/a/")[1];
  console.log(`[timing] prompt submitted -> attempt dashboard at +${Date.now() - t0}ms`);

  // ---- round 1 finishes (mock generation + REAL sandbox test/bench) -----
  const round2Button = page.getByRole("button", { name: "Start round 2 (extension request)" });
  const t1 = Date.now();
  await expect(round2Button).toBeVisible({ timeout: ROUND_TIMEOUT });
  console.log(`[timing] round 1 (test+bench x4, TEST_THREADS=2) took ${Date.now() - t1}ms`);

  // ---- R78: round 0's stored prompt is genuinely what the player typed,
  // not silently swapped -- checked against Postgres (the same authority
  // the judge itself reads from to build model conversations), not just
  // against what the page happens to render.
  expect(
    psqlOne(`SELECT "promptText" FROM "Round" WHERE "attemptId"='${attemptId}' AND index=0`),
  ).toBe(PROMPT_TEXT);

  // ---- R11 mid-attempt: referenceMs is now expected present (R52 -- the
  // player already committed to this attempt, and the dashboard cannot
  // explain a perf number without the bar it was measured against), which
  // doubles as proof this probe is not vacuous. The followup prompt must
  // still never appear -- it stays a round-2 surprise even while round 1's
  // results are on screen.
  const midAttempt = await page.request.get(`/api/attempts/${attemptId}`);
  const midAttemptBody = await midAttempt.text();
  expect(midAttemptBody).toContain(REFERENCE_KEY);
  expect(midAttemptBody).not.toContain(FOLLOWUP_KEY);
  expect(midAttemptBody).not.toContain(FOLLOWUP_SENTINEL);
  expect(await page.content()).not.toContain(FOLLOWUP_SENTINEL);

  // ---- round 2 ------------------------------------------------------------
  const t2 = Date.now();
  await round2Button.click();
  await expect(page.locator("#dashboard-status")).toContainText(/final score/i, {
    timeout: ROUND_TIMEOUT,
  });
  console.log(`[timing] round 2 (test+bench x4) took ${Date.now() - t2}ms`);
  console.log(`[timing] full lifecycle end-to-end: ${Date.now() - t0}ms`);

  // ---- R78: round 1 (index 1)'s stored prompt is genuinely the
  // challenge's followup, not sourced from the round-2 POST's request body
  // (which the dashboard sends with no body at all -- a regression pulling
  // promptText from there instead of attempt.challenge.followupPrompt
  // silently persists an empty string, invisible to every page-level
  // assertion above). Compared as two Postgres reads against each other --
  // not a hardcoded copy of the yaml's multi-line text, which the route
  // never touches directly either.
  const round1Prompt = psqlOne(
    `SELECT "promptText" FROM "Round" WHERE "attemptId"='${attemptId}' AND index=1`,
  );
  const followupPrompt = psqlOne(`SELECT "followupPrompt" FROM "Challenge" WHERE slug='${SLUG}'`);
  expect(round1Prompt.length).toBeGreaterThan(0);
  expect(round1Prompt).toBe(followupPrompt);

  // ---- R78: a known-correct submission must score near the ceiling, not
  // merely "some number rendered somewhere". See FINAL_SCORE_FLOOR's
  // definition for the measurement this threshold is set from.
  const finalScore = Number(psqlOne(`SELECT "finalScore" FROM "Attempt" WHERE id='${attemptId}'`));
  console.log(`[measured] finalScore = ${finalScore}`);
  expect(finalScore).toBeGreaterThan(FINAL_SCORE_FLOOR);

  // Still never leaked, now that the attempt (and the followup prompt it
  // used) is fully complete.
  expect(await page.content()).not.toContain(FOLLOWUP_SENTINEL);

  // ---- leaderboard: this run's own row, not a position -------------------
  await page.getByRole("link", { name: "see leaderboard" }).click();
  await page.waitForURL(new RegExp(`/leaderboard/${SLUG}$`));
  // NOT getByText(NAME): the nav bar (auth-status.tsx) also renders the
  // logged-in player's own name on every page, so a bare text match resolves
  // to two elements (the nav span AND the leaderboard row) and Playwright's
  // strict mode throws -- caught by actually running this, not by reasoning
  // about the JSX. The leaderboard's own row header
  // (leaderboard/[slug]/page.tsx's `<th scope="row">`) has ARIA role
  // "rowheader" and the nav span does not, so this is unambiguous.
  await expect(page.getByRole("rowheader", { name: NAME })).toBeVisible();
  expect(await page.content()).not.toContain(FOLLOWUP_SENTINEL);
});
