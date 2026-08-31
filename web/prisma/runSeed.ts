import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { loadChallengeDir } from "./loadChallenge";

export const MODELS = [
  { openrouterId: "qwen/qwen-2.5-7b-instruct", displayName: "Qwen 2.5 7B", sizeTier: "small" },
  { openrouterId: "meta-llama/llama-3.1-8b-instruct", displayName: "Llama 3.1 8B", sizeTier: "small" },
  { openrouterId: "mistralai/mistral-7b-instruct", displayName: "Mistral 7B", sizeTier: "small" },
  { openrouterId: "google/gemma-2-9b-it", displayName: "Gemma 2 9B", sizeTier: "small" },
];

// `prisma` is injected (rather than constructed here) so tests can supply a
// mock client without a real database, and without seed.ts's module import
// itself triggering a live run as a side effect.
export async function runSeed(prisma: PrismaClient, challengesDir: string) {
  for (const m of MODELS) {
    await prisma.model.upsert({ where: { openrouterId: m.openrouterId }, update: m, create: m });
  }

  if (!existsSync(challengesDir)) {
    console.warn(`No challenges directory at ${challengesDir} -- nothing to publish`);
    return;
  }

  let errors = 0;
  // Sorted for deterministic, reproducible run order -- readdir order is
  // otherwise filesystem-dependent, which would make both the operator's
  // output and "does a later challenge still get processed" non-deterministic.
  const entries = readdirSync(challengesDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const dir of entries) {
    if (!dir.isDirectory()) continue;
    const base = join(challengesDir, dir.name);
    const result = loadChallengeDir(base);
    if (!result.ok) {
      if (result.reason === "unlocked") {
        // R48: deleting a lock never demotes an already-published row (kept
        // deliberately -- R44 unlinks the lock at the START of every
        // publish_check run, so it's transiently absent during every
        // legitimate re-verification too). What must not stay silent is the
        // possibility that live content has since diverged from source, so
        // an operator can tell "never published" from "published, maybe
        // stale" at a glance instead of both reading as the same routine skip.
        try {
          const existing = await prisma.challenge.findUnique({
            where: { slug: dir.name }, select: { status: true },
          });
          if (existing?.status === "published") {
            console.warn(
              `SKIP ${dir.name}: no challenge.lock.json, but a PUBLISHED row for this slug already exists -- ` +
              "live content may no longer match source; run publish_check and re-seed to refresh it",
            );
          } else {
            console.warn(`SKIP ${dir.name}: no challenge.lock.json -- run publish_check first`);
          }
        } catch (e) {
          // R50: this lookup is itself a DB call. findUnique resolves null
          // for "no row" -- it does not throw on the ordinary path -- so a
          // throw here is infra-shaped (dropped connection, exhausted pool),
          // not a content problem. Unguarded, it would reintroduce exactly
          // R49's failure class, on the branch every in-progress challenge
          // hits on every run.
          errors++;
          console.error(`ERROR ${dir.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else {
        errors++;
        console.error(`ERROR ${dir.name}: ${result.message}`);
      }
      continue;
    }
    const { row } = result;
    try {
      // upsert (not create) keyed on the @unique slug -- re-running the seed
      // (dev reset, CI, re-authoring) updates the same row instead of hitting
      // a P2002 duplicate, which is what makes this idempotent.
      await prisma.challenge.upsert({ where: { slug: row.slug }, update: row, create: row });
      console.log(`published ${row.slug} (referenceMs=${row.referenceMs.toFixed(1)})`);
    } catch (e) {
      // R49: loadChallengeDir's validation is necessarily looser than
      // Prisma's own column-level check (e.g. it only confirms `models` IS
      // an array, not that every element is a string) -- a failure here is
      // just as much "one bad challenge" as a loadChallengeDir error, and
      // must not crash the run or drop every challenge that sorts after it.
      errors++;
      console.error(`ERROR ${dir.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (errors > 0) {
    throw new Error(`${errors} challenge director${errors === 1 ? "y" : "ies"} failed to load -- see ERROR lines above`);
  }
}
