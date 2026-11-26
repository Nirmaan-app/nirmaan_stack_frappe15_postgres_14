/**
 * VAV-FIX T7 (after the mint): the v88 FILE (by name, sha256 38e80217...) = the v87 FILE + `__fixtures__/vavfixEdits.json` and nothing else --
 * every item byte-identical, every config but VAV Box byte-identical, VAV Box exactly the 5 edits; a planted undeclared change goes red. The model
 * requests are proved byte-identical by the mint itself and by test_vavfix_keys (test_03).
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig } from "../../pricing/rate-master/rateMasterTypes";
import { assetByName } from "./v78ByName.harness";
import { applyConfig } from "./vav2c1Edits.harness";
import { EDITS88, V87, VAV } from "./vavfix.harness";
import { undoVavfix } from "./vavfixEdits.harness";

const V88 = assetByName("rate_master_hvac_all_v88.json", "38e80217");
const canon = (x: unknown) => JSON.stringify(x);
/** every config of a file, each with the v88 edits applied (or not) */
const sameAsV87PlusEdits = (byId: Map<string, RateCategoryConfig>) =>
  [...V87.byId.keys()].filter((id) => canon(byId.get(id)) !== canon(applyConfig(V87.byId.get(id)!, EDITS88.configs.filter((e) => e.c === id))));

describe("T7 - HVAC v88 = v87 + the edits file", () => {
  it("the same categories, every item byte-identical", () => {
    expect([...V88.byId.keys()]).toEqual([...V87.byId.keys()]);
    expect(canon(V88.items)).toBe(canon(V87.items));
  });
  it("every config equals v87's with the declared edits applied; only VAV Box differs from v87", () => {
    expect(sameAsV87PlusEdits(V88.byId)).toEqual([]);
    expect([...V87.byId.keys()].filter((id) => canon(V87.byId.get(id)) !== canon(V88.byId.get(id)))).toEqual([VAV]);
  });
  it("the undo the older tests read through gives v87 back for every config", () => {
    for (const id of V87.byId.keys()) expect(canon(undoVavfix(V88.byId.get(id)!)), id).toBe(canon(V87.byId.get(id)));
  });
  it("NEGATIVE: a planted undeclared change (a VAV Box rule line, or another category's config) goes red", () => {
    const planted = new Map(V88.byId);
    const vav = structuredClone(V88.byId.get(VAV)!) as unknown as { list_spec: { pricing: { derivation_reasons: Array<{ why: string }> } } };
    vav.list_spec.pricing.derivation_reasons[0].why += " planted";
    planted.set(VAV, vav as unknown as RateCategoryConfig);
    expect(sameAsV87PlusEdits(planted)).toEqual([VAV]);
    const other = new Map(V88.byId);
    other.set("hvac_adp", { ...V88.byId.get("hvac_adp")!, notes: "planted" } as RateCategoryConfig);
    expect(sameAsV87PlusEdits(other)).toEqual(["hvac_adp"]);
    expect(() => undoVavfix({ ...(vav as unknown as RateCategoryConfig), category_id: VAV } as RateCategoryConfig)).not.toThrow();
  });
});
