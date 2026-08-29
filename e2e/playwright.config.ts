import { defineConfig } from "@playwright/test";

// This is the release gate (Task 23): it must fail loudly, not paper over
// flakiness. Two deliberate departures from Playwright's defaults:
//
// - retries: 0, always -- not just "unset". Playwright's own default is 2
//   under CI (process.env.CI truthy), which would silently re-run a failing
//   attempt and could turn a genuine regression into a passing gate. A flaky
//   gate that retries until green is worse than no gate: it trains people to
//   ignore it.
// - timeout: calibrated against a REAL measured run (task-23-report.md has
//   the numbers), not copied from the brief's 180_000. A full attempt is
//   4 models x 2 rounds x (a real sandboxed test phase + a real bench
//   phase), gated at TEST_THREADS=2 concurrent sandbox runs -- materially
//   slower than the mock generation step alone, though still on the order
//   of seconds per round rather than minutes. 240s covers two rounds at
//   flow.spec.ts's own 90s-per-round budget plus register/nav overhead with
//   slack to spare.
export default defineConfig({
  timeout: 240_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
});
