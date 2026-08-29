# LeetVibeCode

Next.js web app + Python FastAPI judge service sharing one Postgres.

## Quickstart

```bash
# 1. Postgres
docker compose up -d postgres

# 2. Env — .env is the one source of truth; web/ reads it via a symlink
# (Prisma CLI and Next only ever read web/.env*, never the repo root)
cp .env.example .env
ln -s ../.env web/.env

# 3. Judge (needs Python >= 3.12) — sources the root .env directly, no
# python-dotenv dependency
cd judge
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
# judge/runner.py hard-depends on this image for every sandboxed test/bench
# phase. Build it before starting the judge — /healthz never touches
# Docker, so a fresh machine that skips this passes the health check below
# and only fails later, on its first real job.
docker build -t lvc-sandbox judge/sandbox/
set -a && . ../.env && set +a && .venv/bin/uvicorn app:app --port 8000 &
curl localhost:8000/healthz   # {"ok":true}

# 4. Web
cd ../web
npm install
npm run dev &
curl -o /dev/null -w '%{http_code}\n' localhost:3000   # 200
```

## Release gate

```bash
./gate.sh
```

One root-level command, not a CI platform (this repo has none, and Task 24
owns deployment — a workflow file here would be infrastructure nobody
asked for). Runs, in order: `judge`'s pytest, `web`'s vitest, a production
`web` build, then the Playwright E2E suite (`e2e/`) against the real stack.
Starts Postgres, the judge and a `next start` web server itself if they
are not already up (idempotent — reuses them if they are, and never tears
them down).

This is the actual release gate, not the E2E suite alone — that distinction
is load-bearing, established by review: five deliberately reintroduced
regressions (a swapped round split, an auth ownership bypass on
`GET /api/attempts/[id]`, round-2 prompts sourced from the request body
instead of the challenge's followup, an inverted judge pass/fail flag, a
leaderboard showing non-completed attempts) each produced a clean
`1 passed` from `e2e/flow.spec.ts` run by itself. For all five, a sibling
suite catches the identical regression immediately — `web`'s vitest for
four, `judge`'s pytest for the fifth. Nothing in the codebase was
untested; no single command proved the three suites agreed. `./gate.sh` is
that command — treat a failure under it, not under any one suite alone, as
a release blocker.

## E2E suite (Playwright)

`e2e/` drives the real stack end to end: register → pick a challenge →
submit a prompt → round 1 completes → start round 2 → attempt completes
with a final score → the leaderboard shows that run's own entry, plus
structural checks (R78) that what actually landed in Postgres — round
prompts, the final score — matches what should have, not just what the
page renders. It runs against `OPENROUTER_MOCK=1` (generation is instant
and returns each challenge's reference solution — no real tokens spent)
but the judge's sandbox test/bench phases are real. `./gate.sh` runs this
suite as its last step; the recipe below is for iterating on it alone.

```bash
# 1. Postgres, judge, and a PRODUCTION web build must already be running —
# NOT `next dev` (R60: dev-mode RSC instrumentation embeds values in the
# flight payload that a production build does not, which makes a
# leak-freedom check against `next dev` unreliable). judge/sandbox must be
# built first (see Quickstart step 3) — the E2E's round 1/2 both run real
# sandboxed test/bench phases.
docker compose up -d postgres
( cd judge && set -a && . ../.env && set +a && \
  .venv/bin/uvicorn app:app --port 8000 & )
( cd web && npm run build && npm run start & )
curl localhost:8000/healthz            # {"ok":true}
curl -o /dev/null -w '%{http_code}\n' localhost:3000   # 200

# 2. Install the E2E deps (once). Chromium is pinned to the revision Playwright
# ships in @playwright/test 1.56.1. On a normal machine, follow with
# `npx playwright install chromium` to fetch it. Do NOT run that here or on
# any box that already has Chromium pre-provisioned at
# $PLAYWRIGHT_BROWSERS_PATH (this repo's dev container does) — it is
# unnecessary there and this project's version is pinned to match what is
# already on disk.
cd e2e && npm install

# 3. Run it. DATABASE_URL must be in the environment (same .env as the
# judge) — the suite reads back what Postgres actually stored (R78) and
# deletes exactly the rows it created in an afterAll hook, failing loudly
# rather than silently skipping either if it can't reach Postgres.
set -a && . ../.env && set +a
npx playwright test
```

Expected: 1 passed, in well under a minute (measured full attempt lifecycle
on the reference dev host: ~9-13s; see `.superpowers/sdd/2026-08-27-leetvibecode-mvp/task-23-report.md`
for the raw numbers this suite's timeouts and score floor were calibrated
from). The suite is self-cleaning — Postgres is back at its pre-run row
counts once it exits, so running it repeatedly (including back-to-back)
does not accumulate state or make its own leaderboard assertion flakier
over time.

## Notes

- `web`'s `prisma` and `@prisma/client` are pinned to `6.19.3` (matching the
  plan's "Prisma 6" constraint) — installing them unpinned currently resolves
  `prisma`'s `latest` tag to an `8.0.0-rc` release candidate mismatched
  against `@prisma/client`'s `7.x` `latest`, so pin both together.
- `web` is scaffolded on Next 15 (`create-next-app@15`, not `@latest`, which
  is Next 16 today) to match the plan's Global Constraint — App Router route
  handlers and pages in later tasks are written against Next 15 conventions.
- `next-auth@4` installs clean against Next 15 / React 19 with no
  `--legacy-peer-deps` needed (its latest 4.x patch declares peer support for
  both).
- `npx vitest run` (`web`'s `npm test`) needs Postgres up and `DATABASE_URL`
  set — the leaderboard tests (Task 16) are the first that hit the real
  database instead of mocking `./db`, and there is no skip-if-no-DB guard
  (a silent skip is how a suite quietly stops testing anything). `./gate.sh`
  and the Quickstart above both already start Postgres first; a bare
  `npm test` in `web/` does not.
- The dev database accumulates `Attempt` rows across repeated `./gate.sh` /
  test runs (harmless — they carry no score and R66 already filters
  zero-round attempts out of history and the leaderboard) but never shrinks
  on its own. Reset it with `docker compose down -v && docker compose up -d
  postgres` (drops the volume) if it grows large enough to matter, followed
  by `npx prisma migrate deploy` and `npx prisma db seed` in `web/`.

## Production deployment

`docs/deploy.md` — the single-VPS Docker deployment (`docker-compose.prod.yml`,
`web/Dockerfile`, `judge/Dockerfile`, `caddy/Dockerfile` + `Caddyfile`). This
README and `./gate.sh` cover local development only.
