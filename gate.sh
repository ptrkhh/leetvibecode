#!/usr/bin/env bash
# R79: ONE root-level command for the release gate. Not a CI platform -- a
# make target or a shell script was the ruling, and this repo has no CI
# anywhere (Task 24 owns deployment; adding a workflow file here would be
# infrastructure nobody asked for). Run this, not `cd e2e && npx playwright
# test` alone: R78's review applied five real regressions to real source
# (a swapped round split, an auth ownership bypass, round-2 prompts sourced
# from the request body, an inverted judge pass/fail, a leaderboard showing
# non-completed attempts) and got a clean "1 passed" from the E2E suite by
# itself for all five. For all five, a SIBLING suite already catches it
# immediately -- web's vitest for four, judge's pytest for the fifth.
# Nothing in this codebase was untested; no single command proved the three
# suites together. This script is that command.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
set -a
. ./.env
set +a

docker compose up -d postgres >/dev/null

# R80: judge/runner.py hard-depends on this image for every sandboxed test
# and bench phase -- judge's own `docker`-marked pytest tests AND the E2E's
# real judge runs both need it. Missing from the README's cold-start recipe
# until now: `git log --follow` on README.md never contains the string
# "docker build". Invisible on a box that already has the image, because
# /healthz never touches Docker -- a fresh machine passes both health
# checks in the old recipe and then fails its first real judge job.
#
# Built only if missing, not on every gate run: an unconditional rebuild
# here hits a real, unrelated snag in this dev sandbox specifically (its
# HTTPS egress goes through an agent proxy that a `docker build` container
# cannot reach on its own network, and a same-session dockerd restart
# empties BuildKit's layer cache independently of the already-built image
# persisting) -- see task-23-report.md. That is a proxy-plumbing problem
# out of this task's scope, not a reason to make this script slower or
# network-dependent on every run for an image whose Dockerfile has not
# changed. `docker build`'s own layer cache would make a same-content
# rebuild a no-op anyway on a normal machine; this just also skips it
# cleanly when the cache is cold.
docker image inspect lvc-sandbox >/dev/null 2>&1 || docker build -t lvc-sandbox judge/sandbox/

# judge's pytest calls worker.work_one(...) directly and synchronously
# against the shared "generate"/"test" Job queue (tests/test_worker.py).
# A LIVE judge server's own background worker threads poll that exact same
# queue via `FOR UPDATE SKIP LOCKED` -- found by running this gate for
# real: with a live judge already up (this script's own steady-state after
# a first run, since it never tears one down), the two race for the same
# rows, and test_generate_then_test_chain_produces_facts intermittently
# fails asserting a run reached "done" (the live server's thread claimed
# and processed it instead of pytest's own synchronous call, which then
# read the row before that finished). Isolated: killed the live server,
# reran the single test alone -- passes in 1.18s, every time. So pytest
# needs the queue to itself, which means no live judge server across this
# entire step, not "idempotent reuse" -- unlike judge's source (untouched
# by this script and safe to reuse for the E2E phase below), the judge
# QUEUE is shared mutable state pytest also owns for the duration of its
# own run.
fuser -k 8000/tcp >/dev/null 2>&1 || true
for _ in $(seq 1 10); do curl -sf localhost:8000/healthz >/dev/null 2>&1 || break; sleep 1; done

echo "===== judge: pytest ====="
(cd judge && .venv/bin/pytest -q)

echo "===== web: vitest ====="
(cd web && npm test)

echo "===== e2e: production build (R60 -- not next dev) ====="
(cd web && npm run build)

# Judge: start fresh for the E2E phase -- the port is guaranteed free
# (killed above, and nothing between there and here starts anything on
# it), so there is no "already running" case left to reuse.
(cd judge && nohup .venv/bin/uvicorn app:app --port 8000 >/tmp/lvc-gate-judge.log 2>&1 & disown)
for _ in $(seq 1 30); do curl -sf localhost:8000/healthz >/dev/null 2>&1 && break; sleep 1; done

# Web: same reasoning as judge above, for the same reason as the comment
# it had before -- the build just rewrote .next (chunk filenames can
# change between builds), so a `next start` already running from an
# older build would serve a mismatched bundle. Always kill whatever holds
# :3000 and start fresh against the build that just happened.
fuser -k 3000/tcp >/dev/null 2>&1 || true
(cd web && nohup npm run start >/tmp/lvc-gate-web.log 2>&1 & disown)
for _ in $(seq 1 60); do curl -sf localhost:3000/ >/dev/null 2>&1 && break; sleep 1; done

echo "===== e2e: playwright ====="
(cd e2e && npx playwright test)

echo
echo "ALL THREE SUITES PASSED: judge pytest, web vitest, e2e playwright."
