import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { loadChallengeDir } from "./loadChallenge";

const prisma = new PrismaClient();
const CHALLENGES = process.env.CHALLENGES_DIR ?? join(__dirname, "../../challenges");

const MODELS = [
  { openrouterId: "qwen/qwen-2.5-7b-instruct", displayName: "Qwen 2.5 7B", sizeTier: "small" },
  { openrouterId: "meta-llama/llama-3.1-8b-instruct", displayName: "Llama 3.1 8B", sizeTier: "small" },
  { openrouterId: "mistralai/mistral-7b-instruct", displayName: "Mistral 7B", sizeTier: "small" },
  { openrouterId: "google/gemma-2-9b-it", displayName: "Gemma 2 9B", sizeTier: "small" },
];

async function main() {
  for (const m of MODELS) {
    await prisma.model.upsert({ where: { openrouterId: m.openrouterId }, update: m, create: m });
  }

  // The seed runs repeatedly (dev resets, re-seeding after authoring a
  // challenge, the E2E suite) and challenges/ is empty until content is
  // authored -- a missing directory is a normal state, not a crash.
  if (!existsSync(CHALLENGES)) {
    console.warn(`No challenges directory at ${CHALLENGES} -- nothing to publish`);
    return;
  }

  let errors = 0;
  for (const dir of readdirSync(CHALLENGES, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const base = join(CHALLENGES, dir.name);
    const result = loadChallengeDir(base);
    if (!result.ok) {
      if (result.reason === "unlocked") {
        console.warn(`SKIP ${dir.name}: no challenge.lock.json -- run publish_check first`);
      } else {
        errors++;
        console.error(`ERROR ${dir.name}: ${result.message}`);
      }
      continue;
    }
    const { row } = result;
    // upsert (not create) keyed on the @unique slug -- re-running the seed
    // (dev reset, CI, re-authoring) updates the same row instead of hitting
    // a P2002 duplicate, which is what makes this idempotent.
    await prisma.challenge.upsert({ where: { slug: row.slug }, update: row, create: row });
    console.log(`published ${row.slug} (referenceMs=${row.referenceMs.toFixed(1)})`);
  }
  // A malformed challenge directory doesn't stop its siblings from
  // publishing (the loop above already continued past it), but it must not
  // be silently swallowed either -- surface it as a failed run so an
  // operator notices, after every valid challenge has had its turn.
  if (errors > 0) {
    throw new Error(`${errors} challenge director${errors === 1 ? "y" : "ies"} failed to load -- see ERROR lines above`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
