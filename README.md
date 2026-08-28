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
