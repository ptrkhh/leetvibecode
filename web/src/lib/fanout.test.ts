import { describe, expect, it } from "vitest";
import { eligibleModelIds } from "./fanout";

const active = [
  { id: "m1", openrouterId: "a" }, { id: "m2", openrouterId: "b" }, { id: "m3", openrouterId: "c" },
];

describe("eligibleModelIds", () => {
  it("round 0: active models in the roster", () =>
    expect(eligibleModelIds(["a", "b", "z"], active, null)).toEqual(["m1", "m2"]));
  it("round 1: drops platform-errored round-0 models", () =>
    expect(eligibleModelIds(["a", "b", "c"], active,
      [{ modelId: "m1", errorKind: "platform" }, { modelId: "m2", errorKind: null },
       { modelId: "m3", errorKind: "submission" }])).toEqual(["m2", "m3"]));
  it("round 1: drops models deactivated mid-attempt", () =>
    expect(eligibleModelIds(["a", "b"], [active[0]],
      [{ modelId: "m1", errorKind: null }, { modelId: "m2", errorKind: null }])).toEqual(["m1"]));
});
