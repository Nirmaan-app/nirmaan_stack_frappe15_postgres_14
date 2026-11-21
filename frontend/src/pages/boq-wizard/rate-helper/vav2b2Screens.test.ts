/**
 * VAV-2b2 B6 - B9 (owner 2026-11-21 10:25 - 10:54, 12:36 "a"): the warning at 25% naming each extra with its amount (R8 / R9), the
 * "Possible double counting" block (R10), the add lists ("per VAV" R11, "Thermostat with CO2 sensor" R12, ONE "Add other item" R13,
 * headings without the source sheet R14), the two wordings and "for N panels" (R15 / R7). From the PANEL'S ENTRY POINT (the Calculator's own
 * construction = the row panel's helper, calculatorSurface). KEY ABSENT = UNCHANGED for each key; other categories' buttons unchanged.
 */
import { describe, expect, it } from "vitest";
import { blk, tot } from "./vav1Vav.harness";
import { V80, calc81, items81, map81, vav81 } from "./vav2b2.harness";
import { applyShareEdit, type SharesEditState } from "./vavSheetShares";
import { applyItemEdit, makePricingSheetHelper, ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, type ItemListSuggestion } from "./pricingSheetHelper";
import { calculatorCtx } from "../../pricing/PricingCalculator";

const BOX = blk("VAV box", { shape: "Rectangular", vav_type: "Nothing specific mentioned", integrator_included: "No", airflow_cfm: "650" });
const ed = (...ops: Parameters<typeof applyShareEdit>[1][]) => ops.reduce<SharesEditState>((a, op) => applyShareEdit(a, op), {});
const V80S = (k: string) => ({ op: "set" as const, share: k, field: "vavs", value: "80" });
const lines = (s: ItemListSuggestion) => (s.itemList?.combinationWarning ?? "").split("\n");
const blockOf = (s: ItemListSuggestion, id: string) => s.itemList!.shares!.blocks.find((b) => b.id === id)!;

describe("R8 / R9: the warning at 25%, naming each extra with its amount", () => {
  it("box + DDC panel share + DDC full rate (80 VAVs): the block names both extras with their amounts, then the extras total", () => {
    const s = calc81({ items: [BOX] }, ed({ op: "add", share: "ddc" }, V80S("ddc"), { op: "add", share: "ddc_whole" }, V80S("ddc_whole")));
    const [sup, ins] = tot(s) as [number, number];
    expect(s.itemList!.reviewHeading).toBe("Review before using");
    expect(lines(s)).toEqual(["This rate combines the box with 2 extras:", "DDC panel share: Rs 2,672", "DDC Panel/ Controller (full rate): Rs 2,13,730",
      `Extras total Rs 2,16,402 of Rs ${(sup + ins).toLocaleString("en-IN")}. Review each item before using.`]);
  });
  it("R8 POSITIVE: an extra between 25% and 50% of the box now warns (a CO2 sensor, 12,030, on the 650 CFM box)", () => {
    const s = calc81({ items: [BOX], sections: { sensors: [blk("CO2 Sensor")] } });
    const box = s.itemList!.items.find((b) => b.family === "VAV box")!;
    const boxRate = (box.figures?.supply_rate ?? 0) + (box.figures?.install_rate ?? 0);
    expect(12030 / boxRate).toBeGreaterThan(0.25);
    expect(12030 / boxRate).toBeLessThan(0.5);
    expect(lines(s)[0]).toBe("This rate combines the box with 1 extra:");
    expect(lines(s)[1]).toBe("CO2 Sensor: Rs 12,030");
  });
  it("R8 NEGATIVE: with the share at v80's 0.5 the same row does not warn (the input is the only difference)", () => {
    const s = calc81({ items: [BOX], sections: { sensors: [blk("CO2 Sensor")] } }, {}, vav81(), items81({ vav_combination_warning_share: 0.5 }));
    expect(s.itemList!.combinationWarning).toBeUndefined();
  });
  it("KEY ABSENT: combination_warning.names taken out -> the one-line count sentence as before", () => {
    const s = calc81({ items: [BOX], sections: { sensors: [blk("CO2 Sensor")] } }, {}, vav81({ dropPricing: ["combination_warning.names"] }));
    expect(s.itemList!.combinationWarning).toMatch(/^This rate combines the box with 1 extra \(Rs 12,030 of Rs [\d,]+\)\. Review each item before using\.$/);
  });
});

describe("R10: the 'Possible double counting' block", () => {
  it("a full-rate BACnet controller beside a DDC panel share: the block names the 3 controllers inside the panel; the small line goes", () => {
    const s = calc81({ items: [BOX] }, ed({ op: "add", share: "ddc" }, V80S("ddc"), { op: "add", share: "bacnet_whole" }, V80S("bacnet_whole")));
    expect(s.itemList!.doubleCounting).toEqual({ heading: "Possible double counting", lines: [
      "The DDC panel on this row already includes 3 BACnet controllers. A BACnet controller is also on this row. Remove one of them unless both are needed."] });
  });
  it("a Duct Static Pressure Sensor item beside a full-rate DDC panel: the DP version, 3 sensors", () => {
    const s = calc81({ items: [BOX], sections: { sensors: [blk("Duct Static Pressure Sensor")] } }, ed({ op: "add", share: "ddc_whole" }, V80S("ddc_whole")));
    expect(s.itemList!.doubleCounting?.lines).toEqual([
      "The DDC panel on this row already includes 3 DP sensors. A DP sensor is also on this row. Remove one of them unless both are needed."]);
  });
  it("QR-C1 (b), owner 13:59 'B: option B': a DDC share and the DDC full rate (the same item) -> the block too; its small line goes", () => {
    const s = calc81({ items: [BOX] }, ed({ op: "add", share: "ddc" }, V80S("ddc"), { op: "add", share: "ddc_whole" }, V80S("ddc_whole")));
    expect(s.itemList!.doubleCounting?.lines).toEqual([
      "The DDC panel share on this row already covers the DDC panel. A full-rate DDC panel is also on this row. Remove one of them unless both are needed."]);
    expect(blockOf(s, "ddc_whole").notes).not.toContain("A DDC panel share is also on this row. Check that the panel is not counted twice.");
  });
  it("NEGATIVE: a full-rate DDC panel alone (no share, no BACnet / DP) -> no block", () => {
    expect(calc81({ items: [BOX] }, ed({ op: "add", share: "ddc_whole" }, V80S("ddc_whole"))).itemList!.doubleCounting).toBeUndefined();
  });
  it("A-4 (owner 14:46 'go with your recommendations'; BEFORE this case said 'keeps its small line, no block' - ANSWER 4, not widened then): a BACnet share + a full-rate BACnet block -> the block; the small line goes", () => {
    const s = calc81({ items: [BOX] }, ed({ op: "add", share: "bacnet" }, V80S("bacnet"), { op: "add", share: "bacnet_whole" }, V80S("bacnet_whole")));
    expect(s.itemList!.doubleCounting?.heading).toBe("Possible double counting");
    expect(blockOf(s, "bacnet_whole").notes).not.toContain("A BACnet controller share is also on this row. Check that the controller is not counted twice.");
  });
  it("KEY ABSENT: sheet_shares.double_count taken out -> no block", () => {
    const s = calc81({ items: [BOX] }, ed({ op: "add", share: "ddc" }, V80S("ddc"), { op: "add", share: "bacnet_whole" }, V80S("bacnet_whole")),
      vav81({ dropPricing: ["sheet_shares.double_count"] }));
    expect(s.itemList!.doubleCounting).toBeUndefined();
  });
});

describe("R11 - R14: the add lists on VAV screens", () => {
  it("ONE 'Add other item' button holding the Misc and Sensors entries (each knows its section) + 'Thermostat with CO2 sensor'", () => {
    const adds = calc81({ items: [BOX] }).itemList!.sections!.adds;
    expect(adds.map((a) => a.addLabel)).toEqual(["Add other item"]);
    expect(adds[0].families.map((f) => `${f.section}:${f.family}`)).toEqual(["misc:Temperature Gauge / Thermometer", "misc:Digital Thermostat",
      "misc:Transformation Pieces", "sensors:CO2 Sensor", "sensors:Duct Static Pressure Sensor"]);
    expect(adds[0].combos).toEqual([{ label: "Thermostat with CO2 sensor", adds: [{ section: "misc", family: "Digital Thermostat" }, { section: "sensors", family: "CO2 Sensor" }] }]);
  });
  it("'Thermostat with CO2 sensor' adds BOTH items in one click, each its own line, headed 'Other item' (not '... priced by <sheet>'s rules')", () => {
    const st = applyItemEdit({ items: [{ base: null, family: "VAV box", attrs: BOX.attrs }] } as never, { op: "add_sections", adds: [{ section: "misc", family: "Digital Thermostat" }, { section: "sensors", family: "CO2 Sensor" }] });
    const h = makePricingSheetHelper({ configsByCategory: map81(), items: items81(), extractionByRow: new Map(), calculatorSurface: true });
    const s = h.compute(calculatorCtx("HVAC", "hvac_vav_box"), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(st), [ROW_UNIT_OVERRIDE_KEY]: "Nos" }) as unknown as ItemListSuggestion;
    const secs = [...s.itemList!.items.flatMap((b) => b.sections ?? []), ...(s.itemList!.sections?.independent ?? [])];
    expect(secs.map((x) => [x.heading, x.view.items.map((b) => b.family)])).toEqual([["Other item", ["Digital Thermostat"]], ["Other item", ["CO2 Sensor"]]]);
  });
  it("R11: 'Integrator cabling' is listed 'per VAV' in 'Add VAV item'", () => {
    expect(calc81({ items: [] }).itemList!.families.find((f) => f.family === "Integrator cabling")?.units).toBe("per VAV");
  });
  it("KEY ABSENT: add_group / family_units_label taken out -> 'Add misc item' + 'Add sensor', 'per Nos', the source-sheet heading", () => {
    const s = calc81({ items: [BOX], sections: { misc: [blk("Digital Thermostat")] } }, {}, vav81({ dropPricing: ["add_group", "family_units_label"] }));
    expect(s.itemList!.sections!.adds.map((a) => a.addLabel)).toEqual(["Add misc item", "Add sensor"]);
    expect(s.itemList!.families.find((f) => f.family === "Integrator cabling")?.units).toBe("per Nos");
    const secs = [...s.itemList!.items.flatMap((b) => b.sections ?? []), ...(s.itemList!.sections?.independent ?? [])];
    expect(secs[0].heading).toMatch(/ - priced by .*'s rules$/);
  });
  it("OTHER CATEGORIES UNCHANGED: Ducting and Valve Package still show 'Add misc item' (v80 file configs, no add_group)", () => {
    for (const cat of ["hvac_ducting", "hvac_valve_package"]) {
      const cfg = V80.byId.get(cat) as unknown as { list_spec: { sections: Array<{ add_label: string }>; pricing: Record<string, unknown> } };
      expect(cfg.list_spec.sections.map((x) => x.add_label)).toContain("Add misc item");
      expect(cfg.list_spec.pricing.add_group).toBeUndefined();
    }
  });
});

describe("R15 / R7: the wordings", () => {
  it("the Calculator's box reads 'Number of VAVs'; the DDC share's lines say 'cost', not 'BCS'", () => {
    const s = calc81({ items: [BOX] }, ed({ op: "add", share: "ddc" }, V80S("ddc")));
    expect(blockOf(s, "ddc").fields.find((f) => f.id === "vavs")?.label).toBe("Number of VAVs");
    expect(blockOf(s, "ddc").sumLines.join(" | ")).not.toMatch(/BCS/);
    expect(blockOf(s, "ddc").sumLines[0]).toMatch(/= 1,46,950 cost x 1\.4 = 2,05,730$/);
  });
  it("R7: 'Panels needed' typed 2 -> the last line says 'for 2 panels'; 1 -> 'per panel'", () => {
    const two = calc81({ items: [] }, ed({ op: "add", share: "ddc_whole" }, V80S("ddc_whole"), { op: "set", share: "ddc_whole", field: "panels_count", value: "2" }));
    expect(blockOf(two, "ddc_whole").sumLines.at(-1)).toMatch(/ for 2 panels$/);
    const one = calc81({ items: [] }, ed({ op: "add", share: "ddc_whole" }, V80S("ddc_whole")));
    expect(blockOf(one, "ddc_whole").sumLines.at(-1)).toMatch(/ per panel$/);
  });
  it("KEY ABSENT: labels / for_count taken out -> 'Number of VAVs on the sheet', 'BCS', 'per panel'", () => {
    const cfg = vav81({ dropPricing: ["sheet_shares.labels.cost_word", "sheet_shares.labels.vavs_calculator", "whole_set.ddc_whole"] });
    const s = calc81({ items: [BOX] }, ed({ op: "add", share: "ddc" }, V80S("ddc"), { op: "add", share: "ddc_whole" }, V80S("ddc_whole"),
      { op: "set", share: "ddc_whole", field: "panels_count", value: "2" }), cfg);
    expect(blockOf(s, "ddc").fields.find((f) => f.id === "vavs")?.label).toBe("Number of VAVs on the sheet");
    expect(blockOf(s, "ddc").sumLines[0]).toMatch(/ BCS x 1\.4 /);
    expect(blockOf(s, "ddc_whole").sumLines.at(-1)).toMatch(/ per panel$/);
  });
});
