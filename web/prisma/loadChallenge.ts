import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export type ChallengeRow = {
  slug: string;
  title: string;
  description: string;
  interfaceText: string;
  difficulty: string;
  parTokens: number;
  followupPrompt: string;
  models: string[];
  referenceMs: number;
  status: "published";
};

export type LoadResult =
  | { ok: true; row: ChallengeRow }
  | { ok: false; reason: "unlocked" }
  | { ok: false; reason: "error"; message: string };

/**
 * Reads one challenge directory (challenge.yaml + challenge.lock.json) into
 * the row seed.ts upserts.
 *
 * A missing challenge.lock.json is reported as "unlocked", not an error --
 * publish_check.py only writes it once the reference solution passes both
 * hidden suites and the benchmark, so a challenge still mid-authoring is
 * expected to be missing one, not broken.
 *
 * Anything else wrong -- unreadable/unparseable yaml, a malformed lock file,
 * missing required fields -- is caught here and reported as "error" rather
 * than thrown, so seed.ts's directory loop can report it and move on: one
 * bad challenge directory must not take the whole seed run down.
 */
export function loadChallengeDir(dir: string): LoadResult {
  const lockPath = join(dir, "challenge.lock.json");
  if (!existsSync(lockPath)) return { ok: false, reason: "unlocked" };
  try {
    const y = parse(readFileSync(join(dir, "challenge.yaml"), "utf8")) ?? {};
    const { referenceMs } = JSON.parse(readFileSync(lockPath, "utf8"));
    if (
      typeof y.slug !== "string" || typeof y.title !== "string" ||
      typeof y.brief !== "string" || typeof y.interface !== "string" ||
      typeof y.difficulty !== "string" || typeof y.parTokens !== "number" ||
      typeof y.followup?.prompt !== "string" || !Array.isArray(y.models) ||
      typeof referenceMs !== "number"
    ) {
      return {
        ok: false, reason: "error",
        message: "challenge.yaml or challenge.lock.json is missing a required field",
      };
    }
    return {
      ok: true,
      row: {
        slug: y.slug, title: y.title, description: y.brief, interfaceText: y.interface,
        difficulty: y.difficulty, parTokens: y.parTokens, followupPrompt: y.followup.prompt,
        models: y.models, referenceMs, status: "published",
      },
    };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
