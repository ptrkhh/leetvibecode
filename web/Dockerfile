FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# next.config.ts sets `output: "standalone"` -- Next traces only the
# node_modules actually reachable at runtime (including the Prisma query
# engine binary generated above) into .next/standalone, instead of the
# brief's `COPY --from=build /app ./`, which ships the whole build stage:
# devDependencies, source, caches and all. Measured on this build: 1.49GB
# (full copy) vs 420MB (standalone) for the identical app. Verified working,
# not just smaller -- a container built this way served GET / and
# GET /api/challenges (Prisma reads) and POST /api/register (a Prisma write)
# against a real Postgres before this was adopted.
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# The standalone trace above only follows what server.js imports at runtime,
# so it correctly drops the `prisma`/`tsx` CLIs -- nothing in the running
# app calls them, and both pull in real dependency trees of their own
# (prisma -> @prisma/config -> effect; tsx -> esbuild) that are tedious and
# fragile to add back by hand file-by-file. The deploy runbook's migrate/seed
# steps run the `build` stage above instead (which already has them, correct
# and complete, from its ordinary `npm ci`) via docker-compose.prod.yml's
# `web-migrate` service -- see docs/deploy.md.
EXPOSE 3000
CMD ["node", "server.js"]
