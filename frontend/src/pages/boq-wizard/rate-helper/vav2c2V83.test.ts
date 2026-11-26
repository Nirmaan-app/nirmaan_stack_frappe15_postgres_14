/**
 * VAV-2c2 T5 -- MINT PARITY on the v83 FILE (read by name, sha-checked; never written): v83 = v82 + EXACTLY the edits file (the twin
 * `vav2c2.harness.ts` builds), no item changed; and a planted undeclared change -- a rate, a markup, an item added / removed, a key outside
 * the edits, a text not in the edits -- each goes RED through the same comparison.
 */
import { describe, expect, it } from "vitest";
import { assetByName } from "./v78ByName.harness";
import { EDITS83, V82, byId83 } from "./vav2c2.harness";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";

const V83 = assetByName("rate_master_hvac_all_v83.json", "bafd6d26");
type Asset = { items: RateMasterItem[]; byId: Map<string, RateCategoryConfig> };
const text = (x: unknown) => JSON.stringify(x);

/** PURE. Everything on which an asset differs from "v82 + the edits file": empty = nothing but the declared edits. */
function undeclared(a: Asset): string[] {
  const out: string[] = [];
  const want = byId83();
  for (const id of new Set([...want.keys(), ...a.byId.keys()])) if (text(a.byId.get(id)) !== text(want.get(id))) out.push(`config ${id}`);
  if (a.items.length !== V82.items.length) out.push(`items ${V82.items.length} -> ${a.items.length}`);
  const ids = new Set(V82.items.map((i) => i.item_uid));
  for (const i of a.items) if (!ids.has(i.item_uid)) out.push(`item added ${i.item_uid}`);
  const byUid = new Map(a.items.map((i) => [i.item_uid, i]));
  for (const i of V82.items) {
    const j = byUid.get(i.item_uid);
    if (!j) { out.push(`item removed ${i.item_uid}`); continue; }
    if (text(j) !== text(i)) out.push(`item changed ${i.item_uid}`);
  }
  return out;
}
const copyOf = (): Asset => ({ items: structuredClone(V83.items), byId: new Map([...V83.byId.entries()].map(([k, v]) => [k, structuredClone(v)])) });

describe("T5 MINT PARITY: the v83 file = v82 + the edits file", () => {
  it("nothing but the declared edits: 16 configs, 853 items, every item byte-identical to v82", () => {
    expect(undeclared(V83)).toEqual([]);
    expect(V83.byId.size).toBe(16);
    expect(V83.items.length).toBe(853);
    expect(EDITS83.configs.length).toBe(55);
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
