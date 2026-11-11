/**
 * VRF-6 K3 (team rule 2026-11-09, U9) -- THE 14 NEW INPUTS ON THE PRICING INPUTS PAGE: each is READ by VRF (the used-by walk counts it,
 * so it cannot be deleted while in use) and none of the 9 retired is; the frame-per-module and gas-per-HP inputs reach every outdoor
 * unit; each MCB + ELCB schedule row reaches the outdoor units of its HP band (the last row every larger unit); the Accessories table
 * shows the frame, the gas per HP and the schedule ONCE (12 rows, the MCB and the ELCB named together); the worked examples price on
 * the panels and an edit moves them. HVAC v62.
 */
import { describe, expect, it } from "vitest";
import { readJsonFixture } from "../calculatorPanelParity.harness";
import type { RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";
import { computePricingInputReach, extrasTablesOf, extrasUses } from "./pricingInputReach";
import { pricingInputUsedBy } from "./rateMasterSpec";
import { computeExampleImpacts, examplesForInput } from "./pricingInputExamples";

type A = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const rd = (n: string) => readJsonFixture<A>(new URL(`../../../../../nirmaan_stack/services/boq_rate_master/data/${n}`, import.meta.url));
const A62 = rd("rate_master_hvac_all_v62.json");
const A61 = rd("rate_master_hvac_all_v61.json");
const E72 = rd("rate_master_electrical_all_v72.json");
const asItems = (a: A) => a.items.map((it, i) => ({ ...it, name: `${a.discipline}-${i}`, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
const ITEMS = [...asItems(A62), ...asItems(E72)];
const CFGS: Record<string, RateCategoryConfig> = Object.fromEntries([...A62.category_configs, ...E72.category_configs].map((c) => [c.category_id, c]));
const VRF = CFGS.hvac_vrf;
const SCHED = ["upto_5hp", "6hp", "8hp", "10hp", "12hp", "14hp", "16hp", "18hp", "20hp", "22hp", "24hp", "26hp"].map((k) => `vrf_acc_mcb_elcb_${k}_amp`);
const NEW = ["vrf_acc_frame_per_outdoor", "vrf_acc_gas_kg_per_hp", ...SCHED];
const RETIRED = ["frame", "gas", "mccb"].flatMap((k) => ["upto_8hp", "8_to_14hp", "above_14hp"].map((b) => `vrf_acc_${k}_outdoor_${b}_${k === "mccb" ? "amp" : "qty"}`));

describe("VRF-6 -- the 14 new Pricing Inputs: read by VRF, their reach, the Accessories table, the worked examples", () => {
  it("each of the 14 is READ by hvac_vrf, none of the 9 retired is; v61's VRF reads none of the 14", () => {
    const used = pricingInputUsedBy(Object.values(CFGS) as never);
    for (const id of NEW) expect({ id, used: used[id]?.categories ?? [] }).toEqual({ id, used: ["hvac_vrf"] });
    for (const id of RETIRED) expect({ id, used: used[id] }).toEqual({ id, used: undefined });
    const used61 = pricingInputUsedBy(A61.category_configs as never);
    for (const id of NEW) expect({ id, used: used61[id] }).toEqual({ id, used: undefined });
  });
  it("the reach: frame / gas -> every outdoor unit; a schedule row -> the outdoor units of its HP band, the rows never overlap", () => {
    const u = new Map(extrasUses(VRF, ITEMS).map((x) => [x.input, x.skus]));
    const all = u.get("vrf_acc_frame_per_outdoor")!;
    expect(all.length).toBeGreaterThan(0);
    expect(u.get("vrf_acc_gas_kg_per_hp")).toEqual(all);
    const rows = SCHED.map((id) => u.get(id) ?? []);
    expect(rows.flat().sort()).toEqual([...all].sort());                                          // every outdoor unit in exactly one row
    expect(new Set(rows.flat()).size).toBe(rows.flat().length);
    expect(rows[rows.length - 1].length).toBeGreaterThan(0);                                        // 26 HP and the larger units
    const reach = computePricingInputReach(CFGS as never, ITEMS);
    for (const id of NEW) expect({ id, read: (reach[id]?.readByCategories ?? []).includes("hvac_vrf") }).toEqual({ id, read: true });
  });
  it("the Accessories table: frame 1 per module, gas 1 Kg per HP, the MCB + ELCB schedule ONCE (12 rows), the per-indoor counts, the uplift", () => {
    const t = extrasTablesOf(VRF, ITEMS)!;
    const rows = t.accessories!;
    const v = (label: string) => rows.find((r) => r.label.startsWith(label));
    expect([v("MS frame / stand for ODU - per outdoor unit")?.value, v("MS frame / stand for ODU - per outdoor unit")?.unit]).toEqual([1, "Nos per unit"]);
    expect([v("Extra gas charge R-410 - per HP")?.value, v("Extra gas charge R-410 - per HP")?.unit]).toEqual([1, "Kg per HP"]);
    const sched = rows.filter((r) => r.label.startsWith("MCB + ELCB rating"));
    expect(sched.map((r) => r.value)).toEqual([16, 20, 20, 25, 32, 40, 40, 40, 63, 63, 63, 63]);
    expect(sched.every((r) => r.unit === "A")).toBe(true);
    expect([v("Drain pump - per indoor")?.value, v("Remote controller - per indoor")?.value, v("Refnet / Y-joint - per indoor")?.value]).toEqual([1, 1, 1]);
    expect(rows).toHaveLength(2 + 12 + 3);
    expect(t.uplift?.value).toBe(0.5);
    // NEGATIVE: v61's table still shows the Kg frame / Kg gas / MCCB band rows and no schedule
    const t61 = extrasTablesOf(A61.category_configs.find((c) => c.category_id === "hvac_vrf"), asItems(A61))!;
    expect(t61.accessories!.some((r) => r.label.startsWith("MCB + ELCB"))).toBe(false);
    expect(t61.accessories!.some((r) => r.label.startsWith("MCCB / isolator"))).toBe(true);
  });
  it("every new input has a worked example on its panel, and an edit moves it (gas kg per HP; the 20 HP rating)", () => {
    const reach = computePricingInputReach(CFGS as never, ITEMS);
    for (const id of NEW) expect({ id, has: examplesForInput(reach[id], CFGS as never, id).length > 0 }).toEqual({ id, has: true });
    const gas = computeExampleImpacts("vrf_acc_gas_kg_per_hp", { factor: 2 }, reach["vrf_acc_gas_kg_per_hp"], CFGS as never, ITEMS);
    expect(gas.length).toBeGreaterThan(0);
    expect(gas.every((g) => g.before.ok && g.after.ok && g.moved)).toBe(true);
    const amp = computeExampleImpacts("vrf_acc_mcb_elcb_20hp_amp", { factor: 25 }, reach["vrf_acc_mcb_elcb_20hp_amp"], CFGS as never, ITEMS);
    expect(amp.length).toBeGreaterThan(0);
    expect(amp.every((g) => g.before.ok && g.after.ok && g.moved)).toBe(true);
  });
});
