/**
 * VAV-1 (HVAC v76) -- T2 REACHABILITY 91 / 91: every VAV item can be reached from the Calculator's own dropdowns. No list of names:
 * the families are the "+ Add item" menu the calculator shows, each family's choices are the options its fields offer, every
 * combination is priced, and the item a combination reaches is the one whose facts it picked AND whose own figure it shows. An item
 * no combination reaches is a GAP (red).
 */
import { describe, expect, it } from "vitest";
import type { RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { BY_ID, ITEMS, LATEST, VAV, VAV_ITEMS, bandFromOf, blk, calc, view } from "./vav1Vav.harness";
import { calc79 } from "./vav2b1.harness";
import { applyShareEdit, type SharesEditState } from "./vavSheetShares";

const up = (x: number) => Math.ceil(x - 1e-9);
const own = (i: RateMasterItem) => [up(Number(i.rates.cost_supply) * (1 + Number(i.rates.supply_markup))), up(Number(i.rates.cost_install) * (1 + Number(i.rates.install_markup)))];

/** every combination of the options the calculator's fields offer for a family (fields re-read after each pick) */
function combos(family: string): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  const walk = (picked: Record<string, string>) => {
    const fields = (view(calc({ items: [blk(family, picked)] }))?.items?.[0]?.fields ?? []).filter((f) => (f.options ?? []).length > 0);
    const next = fields.find((f) => !(f.skuAttr in picked));
    // VAV-2a2 (B3): on a `band_from` config the band is never picked -- it is reached through the typed CFM (the harness types a CFM inside
    // each band, `typedBand`), so the walk offers the config's own bands for it
    const bf = bandFromOf(BY_ID.get(VAV));
    if (!next && bf && bf.families.includes(family) && !(bf.attr in picked)) { for (const b of bf.bands) walk({ ...picked, [bf.attr]: b.value }); return; }
    if (!next) { out.push(picked); return; }
    // the field's "None" choice (an allow_none field left blank) is offered too; a blank fact never prices, so it is not a route
    for (const o of next.options!.filter((x) => x !== "None")) walk({ ...picked, [next.skuAttr]: o });
  };
  walk({});
  return out;
}

describe(`VAV-1 T2 reachability on ${LATEST}: every VAV item from the calculator's dropdowns`, () => {
  const menu = (view(calc({ items: [] }))?.families ?? []).map((f) => f.family);
  // VAV-2b1 K2 (HVAC v79 minted + loaded; mechanical authority): on a config with `withdrawn_families` the BACnet over IP controller is no
  // longer offered per box (owner 2026-11-20 14:18, R2) and the three share buttons are (B5). BEFORE (unconditional): the 7 families below
  const spec = (BY_ID.get(VAV) as unknown as { list_spec: { pricing: { withdrawn_families?: string[]; sheet_shares?: unknown } } }).list_spec.pricing;
  it("the calculator's VAV Box menu offers the 7 VAV families (6 + the three share buttons where the per-box controller is withdrawn)", () => {
    const seven = ["VAV box", "VAV Integrator", "BACnet over IP controller", "Duct connection", "Conical piece", "Integrator cabling", "VAV installation - any size"];
    if (spec.withdrawn_families) {
      expect(menu).toEqual(seven.filter((f) => !spec.withdrawn_families!.includes(f)));
      expect(menu).not.toContain("BACnet over IP controller");
      expect(calc79({ items: [] }, {}, BY_ID.get(VAV)!, ITEMS).itemList!.shares!.adds.map((a) => a.id)).toEqual(["bacnet", "dp", "ddc"]);   // screen 7's order (owner 18:42); the first match stays DDC first
      // VAV-2b1 K2 (v80; PIN 13 / 14, ANSWER 44): where the config carries full-rate entries, the item list offers exactly the two (owner 01:07 / 01:36 "A")
      const whole = (spec as { sheet_shares?: { whole?: Array<{ key: string; label: string }> } }).sheet_shares?.whole;
      if (whole) expect(calc79({ items: [] }, {}, BY_ID.get(VAV)!, ITEMS).itemList!.shares!.wholeAdds).toEqual([
        { id: "bacnet_whole", label: "BACnet over IP controller (full rate)" }, { id: "ddc_whole", label: "DDC Panel/ Controller (full rate)" }]);
    } else {
      expect(menu).toEqual(seven);
    }
  });
  it("91 / 91 reached; no GAP", () => {
    const reached = new Set<string>();
    for (const family of menu) {
      for (const picked of combos(family)) {
        const v = view(calc({ items: [blk(family, picked)] }));
        if (!v?.rowPriced) continue;
        const fig = [v.totals?.supply_rate, v.totals?.install_rate];
        const hit = VAV_ITEMS.filter((i) => i.attributes.vav_item === family
          && Object.entries(picked).every(([k, val]) => String(i.attributes[k]) === val) && JSON.stringify(own(i)) === JSON.stringify(fig));
        expect(hit.length, `${family} ${JSON.stringify(picked)}`).toBe(1);
        reached.add(String(hit[0].item_uid));
      }
    }
    // VAV-2b1 K2 (HVAC v79 minted + loaded; mechanical authority): the BACnet over IP controller (withdrawn per box, R2) and the DDC Panel/
    // Controller (a share only, R9) are reached through the Calculator's share blocks: added, 32 VAVs typed, priced, and the block's sum
    // shows the item's OWN figures. BEFORE: every VAV item through the per-box dropdowns, `reached.size` 91
    if (spec.sheet_shares) {
      const ed = (...ops: Parameters<typeof applyShareEdit>[1][]) => ops.reduce<SharesEditState>((a, op) => applyShareEdit(a, op), {});
      const inr = (n: number) => n.toLocaleString("en-IN");
      for (const [name, id] of [["BACnet over IP controller", "bacnet"], ["DDC Panel/ Controller", "ddc"]] as const) {
        const it = VAV_ITEMS.find((i) => i.attributes.vav_item === name)!;
        expect(menu, name).not.toContain(name);
        const s = calc79({ items: [] }, ed({ op: "add", share: id }, { op: "set", share: id, field: "vavs", value: "32" }), BY_ID.get(VAV)!, ITEMS);
        const b = s.itemList!.shares!.blocks.find((x) => x.id === id)!;
        expect(b.figures, name).not.toBeNull();
        const want = id === "bacnet" ? `(${inr(own(it)[0])} + ${inr(own(it)[1])})` : inr(Number(it.rates.cost_supply));
        expect(b.sumLines.join(" | "), name).toContain(want);
        reached.add(String(it.item_uid));
      }
    }
    const gaps = VAV_ITEMS.filter((i) => !reached.has(String(i.item_uid))).map((i) => `${i.attributes.vav_item} ${JSON.stringify(i.attributes)}`);
    expect(gaps).toEqual([]);
    expect(reached.size).toBe(VAV_ITEMS.length);
    expect(reached.size).toBe(spec.sheet_shares ? 92 : 91);
  });
  it("NEGATIVE: the box family offers exactly the sheet's facts (2 shapes, 3 types, Yes / No, 7 bands) -- 84 combinations, each priced", () => {
    const f = view(calc({ items: [blk("VAV box")] }))?.items?.[0]?.fields ?? [];
    const bf = bandFromOf(BY_ID.get(VAV));
    if (bf) {
      // VAV-2a2 (B3, owner 13:31 / 13:46): the band is shown READ-ONLY (no options) after the two typed boxes; its 7 bands are the config's.
      // B4 (owner 22:16 "2b"): shape not stated -> Rectangular is a ruled default, so "None" is no longer offered on Shape (the 12d-2 rule)
      // VAV-2c3 FIX (PIN FIX-D): type not named -> "Nothing specific mentioned" and integrator not mentioned -> "No" are ruled defaults too
      // (HVAC v85), so "None" is no longer offered on Type or Integrator either (the same 12d-2 rule)
      expect(f.map((x) => [x.skuAttr, x.options ?? null])).toEqual([["shape", ["Rectangular", "Oval"]],
        ["vav_type", ["Nothing specific mentioned", "AHRI Certified", "AHRI Certified Imported"]], ["integrator_included", ["Yes", "No"]],
        ["airflow_cfm", null], ["inlet_size", null], ["cfm_range", null]]);
      expect(bf.bands.map((b) => b.value)).toEqual(["0-450", "450-800", "800-1350", "1350-2100", "2100-3200", "3200-4000", "4000-8000"]);
    } else {
      expect(f.map((x) => [x.skuAttr, x.options])).toEqual([["shape", ["None", "Rectangular", "Oval"]],
        ["vav_type", ["None", "Nothing specific mentioned", "AHRI Certified", "AHRI Certified Imported"]], ["integrator_included", ["None", "Yes", "No"]],
        ["cfm_range", ["None", "0-450", "450-800", "800-1350", "1350-2100", "2100-3200", "3200-4000", "4000-8000"]]]);
    }
    const c = combos("VAV box");
    expect(c.length).toBe(84);
    expect(c.every((p) => view(calc({ items: [blk("VAV box", p)] }))?.rowPriced)).toBe(true);
  });
});
