# Deploy runbook

Production sibling of `gate.sh`/`README.md`: those cover the dev loop on
one machine with `next dev`/a bare `uvicorn`; this covers the single-VPS
Docker deployment. Same repo, same `.env` shape, different compose file
(`docker-compose.prod.yml`) and two extra pieces at the edge (a
`web`/`judge` Dockerfile each, and Caddy as the TLS-terminating reverse
proxy).

Deployment target: a single VPS with Docker. The judge needs the host
Docker socket to launch per-run sandbox containers (see Security posture
below) — Railway/Fly.io don't hand one out, so the spec's single-host
options collapse to a plain VPS.

1. Ubuntu 24.04 VPS, 4 vCPU / 8 GB. `apt install docker.io
   docker-compose-v2`.

2. Clone to a fixed, known path — `/opt/leetvibecode` below; the rest of
   this runbook and `docker-compose.prod.yml`'s `judge` service assume it:

   ```bash
   git clone <repo> /opt/leetvibecode && cd /opt/leetvibecode
   cp .env.example .env
   ```

   Edit `.env` and set real values for:
   - `NEXTAUTH_SECRET` — `openssl rand -hex 32`
   - `NEXTAUTH_URL=https://<domain>`
   - `OPENROUTER_API_KEY` and `OPENROUTER_MOCK=0`
   - `POSTGRES_PASSWORD` — and update `DATABASE_URL` to match:
     `DATABASE_URL=postgresql://postgres:<same password>@postgres:5432/leetvibecode`
     (host `postgres`, the compose service name — not `localhost`, which is
     only correct for the dev compose file where Postgres publishes onto
     the host directly)
   - `SITE_ADDRESS=<domain>` — Caddy's site address. A real domain
     auto-provisions TLS via Let's Encrypt; the domain's DNS A/AAAA record
     must already point at this VPS before `caddy` starts, or certificate
     issuance fails. (`:8080`-style bare-port addresses skip TLS entirely —
     useful for a plain-HTTP smoke test on a machine with no domain, not
     for the real deploy.)
   - `SANDBOX_HOST_DIR=/opt/leetvibecode/sandbox-tmp` — this must be the
     absolute path, **as seen by the Docker daemon on this host**, not
     inside any container, that `./sandbox-tmp` resolves to. It only
     matches the value above if you cloned to `/opt/leetvibecode` in step
     2; if you cloned somewhere else, use that path instead. Get this
     wrong and every sandboxed run reports `platform_error` — `runner.py`'s
     mount canary checks it once at judge startup and fails loudly rather
     than silently mis-scoring a player (see Disk provisioning below for
     *why* this is a separate variable from `SANDBOX_DIR`).

   Leave `TOKEN_CAP_PER_ATTEMPT`, `DAILY_TOKEN_QUOTA`, `GEN_THREADS`,
   `TEST_THREADS` at their defaults unless you have a specific reason to
   change them.

3. `docker build -t lvc-sandbox judge/sandbox/` — the per-run sandbox
   image. `judge/runner.py` hard-depends on it for every test/bench phase;
   nothing else in this runbook builds it, and `/healthz` never touches
   Docker, so a skipped step here passes every health check and only fails
   on the first real judge job.

4. Create the sandbox scratch directory, then bring the stack up:

   ```bash
   mkdir -p sandbox-tmp
   docker compose -f docker-compose.prod.yml up -d --build
   ```

   `web` and `judge` both wait for Postgres's own healthcheck
   (`pg_isready`) before starting, not just for its container to exist, so
   this is safe to run as one command — the next step does not need a
   manual pause first.

5. ```bash
   docker compose -f docker-compose.prod.yml --profile tools run --rm --build \
     web-migrate npx prisma migrate deploy
   ```

   Not `exec web` — the running `web` container is Next's `output: "standalone"`
   build, which ships only what `server.js` imports at runtime and correctly
   excludes the `prisma` CLI along with the rest of `devDependencies`
   (that's most of the size difference in Image sizes below). `web-migrate`
   is a separate one-off service in `docker-compose.prod.yml`, built from
   `web/Dockerfile`'s own `build` stage (`npm ci`, no pruning) instead of a
   second Dockerfile — same source, different target, and it never runs
   continuously or gets exposed to the internet. `--profile tools` is what
   keeps it from starting alongside the other four on a plain `up -d`;
   `--build` costs nothing extra once the `build` stage's layers are already
   cached from step 4.

6. ```bash
   docker compose -f docker-compose.prod.yml --profile tools run --rm \
     web-migrate npx prisma db seed
   ```

   Publishes the challenges under `./challenges` (mounted read-only into
   `web-migrate` and `judge`) and the four models into Postgres. Safe to
   re-run; it upserts on each challenge's slug.

   (A step re-running `publish_check.py` against the live containers was
   dropped from here rather than given a `--verify` mode: `publish_check`
   writes a lock file next to the challenge it checks, and `./challenges`
   is mounted `:ro` in both containers — it cannot succeed. The checked-in
   lock files already reflect the last `gate.sh`/CI run on the authoring
   machine; the spec accepts residual container-class drift in
   `referenceMs` between that machine and this VPS as a known scoring-noise
   risk, affecting all players equally.)

7. Smoke test: register an account, run one real attempt on the
   `rate-limiter` challenge end to end (both rounds), check it appears on
   that challenge's leaderboard. This is the one step that needs
   `OPENROUTER_MOCK=0` and a funded `OPENROUTER_API_KEY` to mean anything —
   with `OPENROUTER_MOCK=1` it would only prove the plumbing, not that real
   model calls work. If you fire this more than ten times in a minute from
   one IP while testing, Caddy's rate limiter (below) will start answering
   with 429 — that's it working, not a bug; wait a minute or test from
   another IP.

## Image sizes

| Image | Size | Notes |
|---|---|---|
| `web` (deployed) | 420 MB | `output: "standalone"` in `next.config.ts` |
| `web-migrate` (tooling only, not deployed) | 2.4 GB | full `build` stage — `npm ci`, not pruned |
| `judge` | 291 MB | |
| `caddy` (with the rate-limit plugin) | 154 MB | same as stock `caddy:2` — only the compiled binary ships |
| `lvc-sandbox` | 197 MB | Task 7, unchanged by this task |

For comparison, copying the web build stage verbatim (`COPY --from=build
/app ./`, the simpler alternative) measured 1.49 GB for the same app —
`devDependencies`, source, and build caches all ship with it.

## Disk provisioning

A determined player can transiently fill host disk through
`SANDBOX_HOST_DIR`: `runner.py`'s per-run container has `mem_limit` and
`pids_limit` caps, but the bind mount at `/work` has no size option in
Docker, so nothing in the sandbox stops a payload from writing until the
disk is full (measured: 100 MiB written in 1.27s). Each run's workdir is
removed after the run completes, so this is a denial-of-service window on
a shared VPS, not permanent data loss — but it can degrade every other
tenant while it lasts. Not something app code can fix: provision
`SANDBOX_HOST_DIR` on its own filesystem (a separate disk/partition, or an
XFS project quota / LVM volume with a size cap) rather than pointing it at
a directory on the VPS's root filesystem, so a full sandbox disk can't take
Postgres or the rest of the OS down with it.

## Rate limiting

Stock `caddy:2` ships no rate limiter, so `caddy/Dockerfile` builds a
custom image with [caddy-ratelimit](https://github.com/mholt/caddy-ratelimit)
compiled in via `xcaddy` (the standard way to extend Caddy — see
[caddyserver.com/docs/build#docker](https://caddyserver.com/docs/build#docker)).
`POST /api/attempts` has no idempotency guard by app-code design (Ruling
R65/R66 in this project's decision record: an active-attempt unique index
would lock a player out of a stuck attempt with no "abandon" UI in the
MVP) and no throttle either — a review during development measured 200
orphaned `Attempt` rows created in ~3 seconds with nothing to stop it, and
that at 30,000 accumulated orphans a user's own history query slowed from
under 1ms to ~800ms. The `Caddyfile` bounds exactly that one route+method
to 10 requests per source IP per minute — generous for a human clicking
"start challenge," and enough to cut a tight retry loop from the measured
~67 req/s down to near nothing. Verified locally: 10 requests through, the
11th on gets `429` from Caddy without reaching the app, and every other
route (including the dashboard's status polling) is unaffected.

This was worth building rather than just documenting: the plugin is a
single well-maintained module, the custom image is the same size as stock
Caddy (~150 MB either way — Go's toolchain and module cache never ship,
only the compiled binary), and it closes a measured, not hypothetical,
degradation path. If a future path needs the same protection, add another
`zone` block to the Caddyfile rather than a second plugin.

## Re-deploying against a database with existing users

If you are redeploying this app against a database that already has
`User` rows from before email normalization was added (lowercase + trim on
both register and login), run this first:

```sql
UPDATE "User" SET email = lower(trim(email));
```

...and pre-check for collisions first (two previously-distinct rows —
`Foo@x.com` and `foo@x.com` — normalizing to the same email is a unique
constraint violation, not something the `UPDATE` resolves on its own):

```sql
SELECT lower(trim(email)), count(*) FROM "User" GROUP BY 1 HAVING count(*) > 1;
```

Not needed for a first deploy against an empty database (steps 5-6 above
create the schema and seed content, not users), and not needed for this
project's own dev database as of this writing (zero of its rows differed
from their normalized form) — but a real environment that has been live
for a while might have exactly this collision, and it fails the migration
rather than silently merging two accounts.

## Security posture

The judge container holds the host Docker socket
(`/var/run/docker.sock`), which is root-equivalent access to this machine
— anything that can reach it can run arbitrary containers with arbitrary
mounts. Sandbox containment for a player's own submitted code relies
entirely on the flags already in `judge/runner.py`: network disabled,
read-only root filesystem outside `/work`, CPU/memory/pids caps, a
non-root user inside the sandbox container. Acceptable for a single-host
MVP where the judge process itself is trusted code this project controls;
revisit (e.g. a rootless Docker daemon, or moving sandbox execution behind
a narrower API than the raw socket) before any multi-tenant or
untrusted-operator deployment.

## What this runbook has and hasn't been run through

Actually executed, on the machine this was written on, under an isolated
compose project name and non-default ports so it never touched a running
dev stack:

- `docker compose -f docker-compose.prod.yml config` — parses clean,
  `${POSTGRES_PASSWORD}` and every other interpolation resolves.
- All four images (`web`, `judge`, `caddy`, plus the `web-migrate` tooling
  target) built from their real, unmodified Dockerfiles — the sizes above
  are from those builds, not estimates.
- The full stack brought up together via this exact compose file
  (`postgres` → healthy → `web`/`judge` start, matching step 4's ordering
  claim) plus `web-migrate` for steps 5 and 6 exactly as written above,
  both against the real Postgres this brought up.
- Steps 5-6 having run, a full core-loop smoke test through the live
  containers with `OPENROUTER_MOCK=1` (curled directly, not through a
  browser): register, log in, create an attempt on `rate-limiter`, submit
  round 1, poll to completion, submit round 2 (the judge's real sandbox
  test/bench phases ran — mock mode only fakes the OpenRouter call, not
  what happens after), poll to a completed attempt with `finalScore: 100`,
  and confirm it on `GET /api/leaderboard/rate-limiter`.
- The rate limiter specifically: 10 `POST /api/attempts` through, the 11th
  getting `429`, with `GET /api/challenges` and `GET /` unaffected by the
  same burst.
- `caddy validate` against the real `Caddyfile` inside the built image, and
  `caddy fmt` reporting it already canonically formatted.

Not run: anything on an actual VPS, real DNS, a real domain's TLS
certificate issuance, or a funded `OPENROUTER_API_KEY` — step 7 as written
needs the last of those to mean anything, and that step is unverified here.
`SANDBOX_HOST_DIR` pointing at a *different* absolute path than the repo's
own location (the disk-provisioning case this doc recommends) was reasoned
through, not exercised — the local run above set it to this repo's own
`sandbox-tmp`, which is the same-path case.
