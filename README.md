# LeetVibeCode

Next.js web app + Python FastAPI judge service sharing one Postgres.

## Quickstart

```bash
# 1. Postgres
docker compose up -d postgres

# 2. Env
cp .env.example .env

# 3. Judge (needs Python >= 3.12)
cd judge
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --port 8000 &
curl localhost:8000/healthz   # {"ok":true}

# 4. Web
cd ../web
npm install
npm run dev &
curl -o /dev/null -w '%{http_code}\n' localhost:3000   # 200
```

## Notes

- `web/` and `judge/` each read env vars from their own working directory, not
  the repo root — `web/.env*` and a sourced `../.env` respectively. The root
  `.env` created above is not automatically visible to either process yet;
  this is an open cross-task item, not resolved by this scaffold.
- `web`'s `prisma` and `@prisma/client` are pinned to `6.19.3` (matching the
  plan's "Prisma 6" constraint) — installing them unpinned currently resolves
  `prisma`'s `latest` tag to an `8.0.0-rc` release candidate mismatched
  against `@prisma/client`'s `7.x` `latest`, so pin both together.
- `create-next-app@latest` currently scaffolds Next 16.3.3 (React 19.2.8,
  Tailwind v4 CSS-first config), not Next 15 as named elsewhere in the plan.
- `next-auth@4` installs clean against Next 16 / React 19 with no
  `--legacy-peer-deps` needed (its latest 4.x patch declares peer support for
  both).
