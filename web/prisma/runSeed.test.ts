import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { runSeed } from "./runSeed";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lvc-runseed-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Writes a valid, locked challenge directory (fields overridable so tests can
// poison exactly one field, e.g. `models`, without hand-rolling YAML text).
function writeChallenge(name: string, fields: Record<string, unknown> = {}) {
  const base = join(dir, name);
  mkdirSync(base);
  writeFileSync(join(base, "challenge.yaml"), stringify({
    slug: name, title: name, difficulty: "easy", brief: "brief",
    interface: "def f(): ...", parTokens: 100,
    models: ["qwen/qwen-2.5-7b-instruct"], followup: { prompt: "followup" },
    ...fields,
  }));
  writeFileSync(join(base, "challenge.lock.json"), JSON.stringify({ referenceMs: 10 }));
}

function writeUnlockedChallenge(name: string) {
  const base = join(dir, name);
  mkdirSync(base);
  writeFileSync(join(base, "challenge.yaml"), stringify({
    slug: name, title: name, difficulty: "easy", brief: "brief",
    interface: "def f(): ...", parTokens: 100,
    models: ["qwen/qwen-2.5-7b-instruct"], followup: { prompt: "followup" },
  }));
  // deliberately no challenge.lock.json
}

// Minimal mock covering only what runSeed actually calls. `challenge.update`
// and `.delete` are deliberately absent -- if runSeed ever called either
// (e.g. an accidental demote), the mock throws "not a function" and the test
// fails, which is the R48 "never touch the row" guarantee made concrete.
function mockPrisma(opts: {
  upsertRejectsFor?: Set<string>;
  existingChallenge?: (slug: string) => { status: string } | null;
  findUniqueThrowsFor?: Set<string>;
} = {}) {
  return {
    model: { upsert: vi.fn().mockResolvedValue({}) },
    challenge: {
      upsert: vi.fn(async ({ where }: { where: { slug: string } }) => {
        if (opts.upsertRejectsFor?.has(where.slug)) {
          throw new Error("Invalid value provided. Expected String, provided Int.");
        }
        return {};
      }),
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => {
        if (opts.findUniqueThrowsFor?.has(where.slug)) {
          throw new Error("Connection terminated unexpectedly");
        }
        return opts.existingChallenge ? opts.existingChallenge(where.slug) : null;
      }),
    },
  } as unknown as PrismaClient;
}

describe("runSeed", () => {
  it("upserts the canonical model roster before touching any challenge", async () => {
    const prisma = mockPrisma();
    await runSeed(prisma, dir); // empty dir, nothing to publish
    expect(prisma.model.upsert).toHaveBeenCalledTimes(4);
  });

  it("warns and returns cleanly (no throw) when the challenges directory doesn't exist", async () => {
    const prisma = mockPrisma();
    await expect(runSeed(prisma, join(dir, "does-not-exist"))).resolves.toBeUndefined();
    expect(prisma.challenge.upsert).not.toHaveBeenCalled();
  });

  // R49: loadChallengeDir's own validation is loose enough to pass a `models`
  // array containing a non-string element (it only checks Array.isArray) --
  // Prisma's real column-level check rejects that at the DB write, which is a
  // failure loadChallengeDir structurally cannot see coming.
  describe("R49 -- a DB-level failure on one challenge must not take down the run", () => {
    it("reports the failing upsert as an ERROR line and still publishes a later valid challenge", async () => {
      writeChallenge("aaa-bad-models", { models: [123, "qwen/qwen-2.5-7b-instruct"] });
      writeChallenge("zzz-valid");
      const prisma = mockPrisma({ upsertRejectsFor: new Set(["aaa-bad-models"]) });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await expect(runSeed(prisma, dir)).rejects.toThrow(/1 challenge director/);

      // the bad challenge was attempted and its failure was caught + reported
      expect(prisma.challenge.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { slug: "aaa-bad-models" } }));
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("ERROR aaa-bad-models"));
      // never a raw multi-line Prisma client-error dump in place of the designed line
      expect(errSpy).not.toHaveBeenCalledWith(expect.stringContaining("PrismaClientValidationError"));

      // the later, valid challenge was still attempted and published -- not
      // silently dropped as collateral damage
      expect(prisma.challenge.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { slug: "zzz-valid" } }));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("published zzz-valid"));

      errSpy.mockRestore();
      logSpy.mockRestore();
    });
  });

  // R48: deleting a lock never demotes an already-published row (deliberate,
  // per R44 -- publish_check unlinks the lock at the START of every
  // re-verification run, so a lock is transiently absent during every
  // legitimate re-check). What must change is only the operator-facing
  // signal: a routine "not yet published" skip must read differently from a
  // "published, and the live row may now be stale" skip.
  describe("R48 -- the unlocked skip must distinguish never-published from possibly-stale", () => {
    it("prints the plain skip message when no published row exists for the slug", async () => {
      writeUnlockedChallenge("never-published");
      const prisma = mockPrisma({ existingChallenge: () => null });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await runSeed(prisma, dir);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("SKIP never-published: no challenge.lock.json -- run publish_check first"));
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("PUBLISHED"));
      warnSpy.mockRestore();
    });

    it("prints an enriched skip message, and never touches the row, when a published row already exists", async () => {
      writeUnlockedChallenge("gone-stale");
      const prisma = mockPrisma({ existingChallenge: (slug) => (slug === "gone-stale" ? { status: "published" } : null) });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await runSeed(prisma, dir);

      const warnings = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(warnings.some((w) => w.includes("gone-stale") && w.includes("PUBLISHED"))).toBe(true);
      // never a plain "run publish_check first" for this slug -- it must read differently
      expect(warnings.some((w) => w.includes("gone-stale") && w === "SKIP gone-stale: no challenge.lock.json -- run publish_check first")).toBe(false);
      expect(prisma.challenge.upsert).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  // R50: the R48 lookup itself is a DB call with no try/catch -- unlike an
  // ordinary "no row" result (findUnique resolves null, doesn't throw), a
  // throw here is infra-shaped (dropped connection, exhausted pool). Left
  // unguarded it reintroduces exactly the failure class R49 fixed, on the
  // *unlocked* branch -- the state hit on every run with any in-progress
  // challenge, not just a specific bad `models` shape.
  describe("R50 -- the R48 lookup itself must not take down the run either", () => {
    it("reports a throwing findUnique as an ERROR line and still publishes a later valid challenge", async () => {
      writeUnlockedChallenge("aaa-lookup-fails");
      writeChallenge("zzz-valid");
      const prisma = mockPrisma({ findUniqueThrowsFor: new Set(["aaa-lookup-fails"]) });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await expect(runSeed(prisma, dir)).rejects.toThrow(/1 challenge director/);

      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("ERROR aaa-lookup-fails: Connection terminated unexpectedly"));
      // the later, valid challenge was still attempted and published -- not
      // silently dropped as collateral damage
      expect(prisma.challenge.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { slug: "zzz-valid" } }));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("published zzz-valid"));

      errSpy.mockRestore();
      logSpy.mockRestore();
    });
  });
});
