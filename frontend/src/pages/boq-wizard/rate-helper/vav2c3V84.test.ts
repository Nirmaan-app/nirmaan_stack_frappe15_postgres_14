/**
 * VAV-2c3 T3 -- MINT PARITY on the v84 FILE (read by name, sha-checked; never written): v84 = v83 + EXACTLY the edits file (the twin
 * `vav2c3.harness.ts` builds), no item changed; and a planted undeclared change -- a rate, a markup, an item added / removed, a key outside
 * the edits, a text not in the edits -- each goes RED through the same comparison. (Every model request byte-identical v83 -> v84: the
 * server half, test_vav2c3_keys test_03 / test_03b, and the mint's own proof.)
 */
import { describe, expect, it } from "vitest";
import { assetByName } from "./v78ByName.harness";
import { EDITS84, V83, byId84 } from "./vav2c3.harness";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";

const V84 = assetByName("rate_master_hvac_all_v84.json", "9c6b87f9");
type Asset = { items: RateMasterItem[]; byId: Map<string, RateCategoryConfig> };
const text = (x: unknown) => JSON.stringify(x);

/** PURE. Everything on which an asset differs from "v83 + the edits file": empty = nothing but the declared edits. */
function undeclared(a: Asset): string[] {
  const out: string[] = [];
  const want = byId84();
  for (const id of new Set([...want.keys(), ...a.byId.keys()])) if (text(a.byId.get(id)) !== text(want.get(id))) out.push(`config ${id}`);
  if (a.items.length !== V83.items.length) out.push(`items ${V83.items.length} -> ${a.items.length}`);
  const ids = new Set(V83.items.map((i) => i.item_uid));
  for (const i of a.items) if (!ids.has(i.item_uid)) out.push(`item added ${i.item_uid}`);
  const byUid = new Map(a.items.map((i) => [i.item_uid, i]));
  for (const i of V83.items) {
    const j = byUid.get(i.item_uid);
    if (!j) { out.push(`item removed ${i.item_uid}`); continue; }
    if (text(j) !== text(i)) out.push(`item changed ${i.item_uid}`);
  }
  return out;
}
const copyOf = (): Asset => ({ items: structuredClone(V84.items), byId: new Map([...V84.byId.entries()].map(([k, v]) => [k, structuredClone(v)])) });

describe("T3 MINT PARITY: the v84 file = v83 + the edits file", () => {
  it("nothing but the declared edits: 16 configs, 853 items, every item byte-identical to v83", () => {
    expect(undeclared(V84)).toEqual([]);
    expect(V84.byId.size).toBe(16);
    expect(V84.items.length).toBe(853);
    expect(EDITS84.configs.length).toBe(6);
  });
  it("only Ducting, Valve Package, VAV Box and VRF configs differ from v83", () => {
    const moved = [...V84.byId.keys()].filter((k) => text(V84.byId.get(k)) !== text(V83.byId.get(k))).sort();
    expect(moved).toEqual(["hvac_ducting", "hvac_valve_package", "hvac_vav_box", "hvac_vrf"]);
  });
  it("RED: a planted rate, a markup, an item added, an item removed, a key outside the edits, a text not in the edits", () => {
    const rate = copyOf(); (rate.items[0].rates as Record<string, number>).cost_supply = Number((rate.items[0].rates as Record<string, number>).cost_supply ?? 0) + 1;
    expect(undeclared(rate)).toEqual([`item changed ${rate.items[0].item_uid}`]);
    const mk = copyOf(); const it = mk.items.find((i) => typeof (i.rates as Record<string, unknown>)?.supply_markup === "number")!;
    (it.rates as Record<string, number>).supply_markup += 0.01;
    expect(undeclared(mk)).toEqual([`item changed ${it.item_uid}`]);
    const add = copyOf(); add.items.push({ ...structuredClone(add.items[0]), item_uid: "rmi-planted" });
    expect(undeclared(add)).toContain("item added rmi-planted");
    const rem = copyOf(); const gone = rem.items.pop()!;
    expect(undeclared(rem)).toContain(`item removed ${gone.item_uid}`);
    const key = copyOf(); (key.byId.get("hvac_adp") as unknown as Record<string, unknown>).planted = true;
    expect(undeclared(key)).toEqual(["config hvac_adp"]);
    const txt = copyOf(); (txt.byId.get("hvac_vav_box") as unknown as { category_display: string }).category_display += " (changed)";
    expect(undeclared(txt)).toEqual(["config hvac_vav_box"]);
  });
});
