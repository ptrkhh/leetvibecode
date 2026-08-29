# Stock caddy:2 has no rate limiter. Task 18's review (R66) measured
# POST /api/attempts creating 200 orphan Attempt rows in ~3s with nothing to
# stop it, degrading that user's own history query from <1ms to ~800ms at
# 30,000 orphans -- the ledger's ruling was to fix this in front of the app
# (Caddy already sits there in prod) rather than in a Prisma query. Stock
# Caddy can't do it; this is the standard way to add a module -- compile it
# in with xcaddy, documented at https://caddyserver.com/docs/build#docker.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/mholt/caddy-ratelimit

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
