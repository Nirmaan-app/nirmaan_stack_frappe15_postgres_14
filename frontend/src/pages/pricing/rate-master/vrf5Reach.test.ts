/**
 * VRF-5 K3 (owner ANSWER 4 / 5 / 6: the accessory defaults and the installation-only uplift are HVAC Pricing Inputs rows -- "they
 * should also be part of the pricing input sheet for HVAC"; U6) -- THE 13 NEW INPUTS ON THE PRICING INPUTS PAGE: each is READ by VRF
 * (the used-by walk counts it, so it cannot be deleted while in use), its badge reaches the VRF units it sizes (a band cell -> the
 * units of its role in that band; a per-indoor input -> every indoor unit; the uplift -> every unit), the Accessories table shows
 * every default and the uplift, and the worked examples price on its panel (an edit moves them). HVAC v61.
 */
import { describe, expect, it } from "vitest";
import { readJsonFixture } from "../calculatorPanelParity.harness";
import type { RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";
import { computePricingInputReach, extrasTablesOf, extrasUses } from "./pricingInputReach";
import { pricingInputUsedBy } from "./rateMasterSpec";
import { computeExampleImpacts, examplesForInput } from "./pricingInputExamples";

type A = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const rd = (n: string) => readJsonFixture<A>(new URL(`../../../../../nirmaan_stack/services/boq_rate_master/data/${n}`, import.meta.url));
const A61 = rd("rate_master_hvac_all_v61.json");
const A60 = rd("rate_master_hvac_all_v60.json");
const E72 = rd("rate_master_electrical_all_v72.json");
const asItems = (a: A) => a.items.map((it, i) => ({ ...it, name: `${a.discipline}-${i}`, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
const ITEMS = [...asItems(A61), ...asItems(E72)];
const CFGS: Record<string, RateCategoryConfig> = Object.fromEntries([...A61.category_configs, ...E72.category_configs].map((c) => [c.category_id, c]));
const VRF = CFGS.hvac_vrf;
const NEW = ["vrf_install_only_uplift",
  ...["mccb", "frame", "gas"].flatMap((k) => ["upto_8hp", "8_to_14hp", "above_14hp"].map((b) => `vrf_acc_${k}_outdoor_${b}_${k === "mccb" ? "amp" : "qty"}`)),
  ...["drain_pump", "remote", "refnet"].map((k) => `vrf_acc_${k}_per_indoor`)];

describe("VRF-5 -- the 13 new Pricing Inputs: read by VRF, their reach, the Accessories table, the worked examples", () => {
  it("each of the 13 is READ by hvac_vrf (used-by counts it); v60's VRF reads none of them", () => {
    const used = pricingInputUsedBy(Object.values(CFGS) as never);
    for (const id of NEW) expect({ id, used: used[id]?.categories ?? [] }).toEqual({ id, used: ["hvac_vrf"] });
    const used60 = pricingInputUsedBy(A60.category_configs as never);
    for (const id of NEW) expect({ id, used: used60[id] }).toEqual({ id, used: undefined });
  });
  it("the reach: a band cell -> the outdoor units of that band only; a per-indoor input -> every indoor unit; the uplift -> every unit", () => {
    const u = new Map(extrasUses(VRF, ITEMS).map((x) => [x.input, x.skus]));
    const low = u.get("vrf_acc_frame_outdoor_upto_8hp_qty")!, mid = u.get("vrf_acc_frame_outdoor_8_to_14hp_qty")!, high = u.get("vrf_acc_frame_outdoor_above_14hp_qty")!;
    expect(low.length && mid.length && high.length).toBeTruthy();
    expect(low.filter((s) => mid.includes(s) || high.includes(s))).toEqual([]);              // the bands do not overlap
    expect(u.get("vrf_acc_mccb_outdoor_upto_8hp_amp")).toEqual(low);                           // the MCCB rides the same bands
    const indoor = u.get("vrf_acc_drain_pump_per_indoor")!;
    expect(indoor.filter((s) => low.includes(s))).toEqual([]);                                   // indoor only
    expect(u.get("vrf_install_only_uplift")!.length).toBe(indoor.length + low.length + mid.length + high.length);
    const reach = computePricingInputReach(CFGS as never, ITEMS);
    for (const id of NEW) expect({ id, read: (reach[id]?.readByCategories ?? []).includes("hvac_vrf") }).toEqual({ id, read: true });
  });
  it("the Accessories table shows every default (ANSWER 4 / 6) and the uplift 50%", () => {
    const t = extrasTablesOf(VRF, ITEMS)!;
    const v = (label: string) => t.accessories!.find((r) => r.label.startsWith(label))?.value;
    expect([v("MCCB / isolator - Outdoor up to 8 HP"), v("MCCB / isolator - Outdoor above 8 up to 14 HP"), v("MCCB / isolator - Outdoor above 14 HP")]).toEqual([40, 40, 63]);
    expect([v("MS frame (base / stand) - Outdoor up to 8 HP"), v("MS frame (base / stand) - Outdoor above 8 up to 14 HP"), v("MS frame (base / stand) - Outdoor above 14 HP")]).toEqual([30, 45, 60]);
    expect([v("Extra gas charge R-410 - Outdoor up to 8 HP"), v("Extra gas charge R-410 - Outdoor above 8 up to 14 HP"), v("Extra gas charge R-410 - Outdoor above 14 HP")]).toEqual([3, 5, 8]);
    expect([v("Drain pump - per indoor"), v("Remote controller - per indoor"), v("Refnet / Y-joint - per indoor")]).toEqual([1, 1, 1]);
    expect(t.uplift?.value).toBe(0.5);
    expect(t.accessories).toHaveLength(12);
    // QR-2 (cert C6): the unit after the value reads "A FP MCCB" (the cert saw "A A FP MCCB"); the qty rows read "<unit> per unit"
    const u = (label: string) => t.accessories!.find((r) => r.label.startsWith(label))?.unit;
    expect([u("MCCB / isolator - Outdoor up to 8 HP"), u("MCCB / isolator - Outdoor above 14 HP")]).toEqual(["A FP MCCB", "A FP MCCB"]);
    expect([u("MS frame (base / stand) - Outdoor up to 8 HP"), u("Drain pump - per indoor")]).toEqual(["Kg per unit", "Nos per unit"]);
    // NEGATIVE: v60 has no accessories table
    expect(extrasTablesOf(A60.category_configs.find((c) => c.category_id === "hvac_vrf"), asItems(A60))?.accessories).toBeUndefined();
  });
  it("every new input has two worked examples on its panel, and an edit moves them (the 8-14 HP gas Kg; the uplift)", () => {
    const reach = computePricingInputReach(CFGS as never, ITEMS);
    for (const id of NEW) expect({ id, n: examplesForInput(reach[id], CFGS as never, id).length }).toEqual({ id, n: 2 });
    const gas = computeExampleImpacts("vrf_acc_gas_outdoor_8_to_14hp_qty", { factor: 10 }, reach["vrf_acc_gas_outdoor_8_to_14hp_qty"], CFGS as never, ITEMS);
    expect(gas.every((g) => g.before.ok && g.after.ok && g.moved)).toBe(true);
    const up = computeExampleImpacts("vrf_install_only_uplift", { factor: 0.6 }, reach["vrf_install_only_uplift"], CFGS as never, ITEMS);
    expect(up.every((g) => g.before.ok && g.after.ok && g.moved)).toBe(true);
    expect(up.every((g) => g.before.ok && g.before.values.supply_rate === 0)).toBe(true);      // installation only: no supply
  });
});
