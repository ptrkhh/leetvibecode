import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadChallengeDir } from "./loadChallenge";

const VALID_YAML = `
slug: adder
title: Adder
difficulty: easy
brief: |
  Add two numbers.
interface: |
  def add(a, b): ...
parTokens: 100
models: [qwen/qwen-2.5-7b-instruct]
followup:
  prompt: |
    Now support three numbers.
`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lvc-seed-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, contents: string) {
  writeFileSync(join(dir, name), contents);
}

describe("loadChallengeDir", () => {
  it("loads a valid, locked challenge into a publishable row", () => {
    write("challenge.yaml", VALID_YAML);
    write("challenge.lock.json", JSON.stringify({ referenceMs: 12.5 }));

    const result = loadChallengeDir(dir);

    expect(result).toEqual({
      ok: true,
      row: {
        slug: "adder",
        title: "Adder",
        description: "Add two numbers.\n",
        interfaceText: "def add(a, b): ...\n",
        difficulty: "easy",
        parTokens: 100,
        followupPrompt: "Now support three numbers.\n",
        models: ["qwen/qwen-2.5-7b-instruct"],
        referenceMs: 12.5,
        status: "published",
      },
    });
  });

  // Publication gate: no lock file means publish_check.py never verified the
  // reference solution, so this is expected mid-authoring, not a bug -- it
  // must be reported and skipped, never crash the run or publish anyway.
  it("reports 'unlocked' (not an error) when challenge.lock.json is missing", () => {
    write("challenge.yaml", VALID_YAML);

    expect(loadChallengeDir(dir)).toEqual({ ok: false, reason: "unlocked" });
  });

  it("reports an error (not a throw) when challenge.yaml is missing", () => {
    write("challenge.lock.json", JSON.stringify({ referenceMs: 1 }));

    expect(() => loadChallengeDir(dir)).not.toThrow();
    expect(loadChallengeDir(dir)).toMatchObject({ ok: false, reason: "error" });
  });

  it("reports an error (not a throw) when challenge.yaml is malformed YAML", () => {
    write("challenge.yaml", "foo: [1, 2\nbar: 3");
    write("challenge.lock.json", JSON.stringify({ referenceMs: 1 }));

    expect(() => loadChallengeDir(dir)).not.toThrow();
    expect(loadChallengeDir(dir)).toMatchObject({ ok: false, reason: "error" });
  });

  it("reports an error when challenge.yaml is missing required fields", () => {
    write("challenge.yaml", "slug: adder\ntitle: Adder\n"); // no difficulty/brief/interface/parTokens/models/followup
    write("challenge.lock.json", JSON.stringify({ referenceMs: 1 }));

    expect(loadChallengeDir(dir)).toMatchObject({ ok: false, reason: "error" });
  });

  it("reports an error when challenge.lock.json is malformed JSON", () => {
    write("challenge.yaml", VALID_YAML);
    write("challenge.lock.json", "{not json");

    expect(() => loadChallengeDir(dir)).not.toThrow();
    expect(loadChallengeDir(dir)).toMatchObject({ ok: false, reason: "error" });
  });

  it("reports an error when challenge.lock.json has no numeric referenceMs", () => {
    write("challenge.yaml", VALID_YAML);
    write("challenge.lock.json", JSON.stringify({}));

    expect(loadChallengeDir(dir)).toMatchObject({ ok: false, reason: "error" });
  });
});
