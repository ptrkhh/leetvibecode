# Stock caddy:2 has no rate limiter. Task 18's review (R66) measured
# POST /api/attempts creating 200 orphan Attempt rows in ~3s with nothing to
# stop it, degrading that user's own history query from <1ms to ~800ms at
# 30,000 orphans -- the ledger's ruling was to fix this in front of the app
# (Caddy already sits there in prod) rather than in a Prisma query. Stock
# Caddy can't do it; this is the standard way to add a module -- compile it
# in with xcaddy, documented at https://caddyserver.com/docs/build#docker.
#
# R81: all three pinned. Both base image tags previously floated the whole
# v2 line, and the plugin had no @version at all, so a plain `up -d --build`
# -- run for the first deploy AND every documented redeploy -- re-resolved
# "latest" on every build. Versions below are exactly what was built and
# verified against (caddy 2.11.4; module version confirmed from the
# compiled binary's own embedded build info, `go version -m`, not guessed).
# Bump deliberately, re-verify (rate limit burst test + `caddy validate`),
# not by a routine redeploy silently picking up whatever's newest.
FROM caddy:2.11.4-builder AS builder
RUN xcaddy build --with github.com/mholt/caddy-ratelimit@v0.1.0

FROM caddy:2.11.4
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
