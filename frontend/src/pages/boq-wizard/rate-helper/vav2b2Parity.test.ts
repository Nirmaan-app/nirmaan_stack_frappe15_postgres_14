/**
 * VAV-2b2 T2 (R2; blocks 18 / 24 / 69 "one pricing path"): THE ROW PANEL = THE CALCULATOR for the same inputs on v81 -- every VAV box line of
 * the workbook's VAV Box tab (86 lines, the VAV-1 fixture), every extra, every share and every full-rate block, priced by the Calculator's
 * own construction (calculatorSurface) and by a BoQ row of a sheet (the BoQ page's construction), the SAME item / block figures. Each
 * surface loads its configs its own way (map81 with / without calculatorSurface; the BoQ row through buildExtractionByRow). COUNT ASSERTED;
 * kept permanently. Coverage map at the end (rule / branch -> case).
 */
import { describe, expect, it } from "vitest";
import { TAB, blk, bandFromOf, tabEntry } from "./vav1Vav.harness";
import { box81, calc81, sheet81, vav81, type Row81 } from "./vav2b2.harness";
import { applyShareEdit, type SharesEditState } from "./vavSheetShares";
import type { ItemListSuggestion } from "./pricingSheetHelper";

const bf = bandFromOf(vav81())!;
/** the band as the BoQ (or the user) would state it: an airflow inside the band (the band is never picked on v81) */
const cfmOf = (band: string) => `${bf.bands.find((b) => b.value === band)!.max - 1}`;
const famFig = (s: ItemListSuggestion, fam: string) => {
  const all = [...(s.itemList?.items ?? []), ...(s.itemList?.items ?? []).flatMap((b) => b.sections ?? []).flatMap((sv) => sv.view.items),
    ...(s.itemList?.sections?.independent ?? []).flatMap((sv) => sv.view.items)];
  const b = all.find((x) => x.family === fam);
  return b ? [b.state, b.figures?.supply_rate ?? null, b.figures?.install_rate ?? null] : null;
};
const ed = (...ops: Parameters<typeof applyShareEdit>[1][]) => ops.reduce<SharesEditState>((a, op) => applyShareEdit(a, op), {});
let cases = 0;

describe("T2 box lines: the 86 lines of the VAV Box tab, Calculator = BoQ row (the box item's own figures)", () => {
  for (const r of TAB.vav_box_tab) {
    it(`tab row ${r.row}: ${r.item} / ${r.type} / ${r.integrator} / ${r.cfm}`, () => {
      const e = tabEntry(r);
      const attrs: Record<string, string> = { ...e.attrs };
      if (attrs.cfm_range) { attrs.airflow_cfm = cfmOf(attrs.cfm_range); delete attrs.cfm_range; }
      const c = calc81({ items: [blk(e.family!, attrs)] });
      const item = { vav_item: e.family!, vav_item_as_written: e.family!, qty_per_box: "None", scope: "None", ...attrs };
      const s = sheet81({ 1: { qty: 1, items: [item] } as Row81 })(1);
      expect(famFig(s, e.family!)).toEqual(famFig(c, e.family!));
      expect(famFig(c, e.family!)![0]).toBe("priced");
      cases++;
    });
  }
});

describe("T2 extras: each extra priced the same on both surfaces (own families and the borrowed Misc / Sensors items)", () => {
  const own = ["Duct connection", "Conical piece", "Integrator cabling", "VAV installation - any size"];
  const borrowed: Array<[string, string, string]> = [["misc", "item", "Digital Thermostat"], ["misc", "item", "Temperature Gauge / Thermometer"],
    ["misc", "item", "Transformation Pieces"], ["sensors", "sensor", "CO2 Sensor"]];
  for (const fam of own) {
    it(`own: ${fam}`, () => {
      const c = calc81({ items: [blk(fam)] });
      const s = sheet81({ 1: { qty: 1, items: [{ vav_item: fam, vav_item_as_written: fam, qty_per_box: "None", scope: "None" }] } as Row81 })(1);
      expect(famFig(s, fam)).toEqual(famFig(c, fam));
      cases++;
    });
  }
  for (const [sec, attr, fam] of borrowed) {
    it(`borrowed: ${sec} / ${fam} (beside a box)`, () => {
      const c = calc81({ items: [blk("VAV box", { shape: "Rectangular", vav_type: "Nothing specific mentioned", integrator_included: "No", airflow_cfm: "650" })], sections: { [sec]: [blk(fam)] } });
      const s = sheet81({ 1: { qty: 1, items: [{ vav_item: "VAV box", vav_item_as_written: "VAV box", shape: "Rectangular", vav_type: "Nothing specific mentioned",
        integrator_included: "No", airflow_cfm: "650", qty_per_box: "None", scope: "None" }, { _section: sec, [attr]: fam, qty_per_box: "None", scope: "None" }] } as Row81 })(1);
      expect(famFig(s, fam)).toEqual(famFig(c, fam));
      expect(famFig(c, fam)![0]).toBe("priced");
      cases++;
    });
  }
});

describe("T2 the Duct Static Pressure Sensor (user-only on a box row; the helper's item on a claimed DP row)", () => {
  it("the Calculator's user-added sensor = the BoQ row of a DP sensor filed under Sensors and claimed (R16 / R17)", () => {
    const c = calc81({ items: [], sections: { sensors: [blk("Duct Static Pressure Sensor")] } });
    const s = sheet81({ 1: box81(10), 2: { text: "Supply and installation of Duct static pressure sensor", qty: 1, unit: "Nos", category: "hvac_sensors",
      claim: { from: "hvac_sensors", item: "DP sensor", kind: "dp" } } as Row81 })(2);
    expect(famFig(s, "Duct Static Pressure Sensor")).toEqual(famFig(c, "Duct Static Pressure Sensor"));
    expect(famFig(c, "Duct Static Pressure Sensor")).toEqual(["priced", 10710, 900]);
    cases++;
  });
});

describe("T2 shares and full-rate blocks: the Calculator with the VAVs typed = a BoQ sheet with that many VAVs", () => {
  // 80 VAVs on the sheet; the row asked about is a box row of quantity 1 (so a full-rate block's pre-fill = 80 / 1 = 80)
  const sheet = (reading: { controller?: string; dp?: boolean }, ov: SharesEditState = {}) =>
    sheet81({ 1: box81(79, reading), 2: box81(1, reading) })(2, Object.keys(ov).length ? { __shares__: JSON.stringify(ov) } : {});
  const calcWith = (ops: Parameters<typeof applyShareEdit>[1][]) =>
    calc81({ items: [blk("VAV box", { shape: "Rectangular", vav_type: "Nothing specific mentioned", integrator_included: "No", airflow_cfm: "700" })] }, ed(...ops));
  const shareFig = (s: ItemListSuggestion, id: string) => s.itemList!.shares!.blocks.find((b) => b.id === id)?.figures ?? null;
  for (const [id, reading] of [["bacnet", { controller: "bacnet" }], ["ddc", { controller: "ddc_inclusive" }], ["dp", { dp: true }]] as const) {
    it(`share ${id}: the helper's share on the BoQ row = the user's share in the Calculator, 80 VAVs`, () => {
      const s = sheet(reading);
      const c = calcWith([{ op: "add", share: id }, { op: "set", share: id, field: "vavs", value: "80" }]);
      expect(shareFig(s, id)).not.toBeNull();
      expect(shareFig(s, id)).toEqual(shareFig(c, id));
      cases++;
    });
  }
  for (const w of ["bacnet_whole", "ddc_whole"]) {
    it(`full-rate ${w}: pre-filled 80 on the BoQ row (quantity 1) = 80 typed in the Calculator`, () => {
      const s = sheet({}, ed({ op: "add", share: w }));
      const c = calcWith([{ op: "add", share: w }, { op: "set", share: w, field: "vavs", value: "80" }]);
      expect(shareFig(s, w)).not.toBeNull();
      expect(shareFig(s, w)).toEqual(shareFig(c, w));
      cases++;
    });
  }
});

describe("T2 count and coverage map", () => {
  it("cases run = 86 box lines + 4 own extras + 5 borrowed + 3 shares + 2 full-rate blocks = 100", () => {
    expect(cases).toBe(100);
  });
  it("COVERAGE MAP (rule / branch -> case): band from CFM (all 86 box lines), each own extra, each borrowed item, each share, each full-rate block", () => {
    const map: Record<string, string> = {
      "band from the CFM": "T2 box lines (86)", "VAV Integrator lines": "tab rows 44 / 45", "own extras": "T2 extras own (4)",
      "borrowed Misc / Sensors items": "T2 extras borrowed (5)", "BACnet / DDC / DP share": "T2 shares (3)", "BACnet / DDC full rate": "T2 full-rate (2)",
      "band from the inlet / both typed / refusals": "vav2a2Band (the band reader is surface-free: one function, bandOf)",
    };
    expect(Object.keys(map).length).toBe(7);
  });
});
