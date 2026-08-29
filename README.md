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
set -a && . ../.env && set +a && .venv/bin/uvicorn app:app --port 8000 &
curl localhost:8000/healthz   # {"ok":true}

# 4. Web
cd ../web
npm install
npm run dev &
curl -o /dev/null -w '%{http_code}\n' localhost:3000   # 200
```

## E2E tests (release gate)

`e2e/` is a Playwright suite that drives the real stack end to end: register
→ pick a challenge → submit a prompt → round 1 completes → start round 2 →
attempt completes with a final score → the leaderboard shows that run's own
entry. It runs against `OPENROUTER_MOCK=1` (generation is instant and
returns each challenge's reference solution — no real tokens spent) but the
judge's sandbox test/bench phases are real, so this is the one suite in the
repo that proves the whole system actually works together, not just its
parts in isolation. Treat a failure here as a release blocker.

```bash
# 1. Postgres, judge, and a PRODUCTION web build must already be running —
# NOT `next dev` (R60: dev-mode RSC instrumentation embeds values in the
# flight payload that a production build does not, which makes a
# leak-freedom check against `next dev` unreliable).
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

# 3. Run the gate. DATABASE_URL must be in the environment (same .env as the
# judge) — the suite deletes exactly the rows it created in an afterAll
# hook, and fails loudly rather than silently skipping cleanup if it can't
# reach Postgres to do so.
set -a && . ../.env && set +a
npx playwright test
```

Expected: 1 passed, in well under a minute (measured full attempt lifecycle
on the reference dev host: ~9-13s; see `.superpowers/sdd/2026-08-27-leetvibecode-mvp/task-23-report.md`
for the raw numbers this suite's timeouts were calibrated from). The suite
is self-cleaning — Postgres is back at its pre-run row counts once it exits,
so running it repeatedly (including back-to-back) does not accumulate state
or make its own leaderboard assertion flakier over time.

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
