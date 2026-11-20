/**
 * VAV-1 (HVAC v76) -- T2 REACHABILITY 91 / 91: every VAV item can be reached from the Calculator's own dropdowns. No list of names:
 * the families are the "+ Add item" menu the calculator shows, each family's choices are the options its fields offer, every
 * combination is priced, and the item a combination reaches is the one whose facts it picked AND whose own figure it shows. An item
 * no combination reaches is a GAP (red).
 */
import { describe, expect, it } from "vitest";
import type { RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { BY_ID, LATEST, VAV, VAV_ITEMS, bandFromOf, blk, calc, view } from "./vav1Vav.harness";

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
  it("the calculator's VAV Box menu offers the 7 VAV families", () => {
    expect(menu).toEqual(["VAV box", "VAV Integrator", "BACnet over IP controller", "Duct connection", "Conical piece", "Integrator cabling",
      "VAV installation - any size"]);
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
    const gaps = VAV_ITEMS.filter((i) => !reached.has(String(i.item_uid))).map((i) => `${i.attributes.vav_item} ${JSON.stringify(i.attributes)}`);
    expect(gaps).toEqual([]);
    expect(reached.size).toBe(91);
  });
  it("NEGATIVE: the box family offers exactly the sheet's facts (2 shapes, 3 types, Yes / No, 7 bands) -- 84 combinations, each priced", () => {
    const f = view(calc({ items: [blk("VAV box")] }))?.items?.[0]?.fields ?? [];
    const bf = bandFromOf(BY_ID.get(VAV));
    if (bf) {
      // VAV-2a2 (B3, owner 13:31 / 13:46): the band is shown READ-ONLY (no options) after the two typed boxes; its 7 bands are the config's.
      // B4 (owner 22:16 "2b"): shape not stated -> Rectangular is a ruled default, so "None" is no longer offered on Shape (the 12d-2 rule)
      expect(f.map((x) => [x.skuAttr, x.options ?? null])).toEqual([["shape", ["Rectangular", "Oval"]],
        ["vav_type", ["None", "Nothing specific mentioned", "AHRI Certified", "AHRI Certified Imported"]], ["integrator_included", ["None", "Yes", "No"]],
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
