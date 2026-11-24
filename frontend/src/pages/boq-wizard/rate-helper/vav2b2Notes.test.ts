/**
 * VAV-2b2 K1b -- the owner's "1a 2a 3b" (2026-11-21 15:56, ANSWER 16) and ANSWER 17 3a / 3d. From the PANEL'S ENTRY POINT; real rows'
 * words (BOQ-26-00313 r202 / BOQ-26-00442 r202, BOQ-26-00012 r258), invented sheets around them.
 *  1a ("2a" as measured): a separate DDC panel row with a quantity above 0, WHATEVER it is filed under, counts as the sheet's controller
 *     row -- the BACnet controller share comes off the boxes; quantity 0 -> the share stays (20 Nov 21:05).
 *  2a the note says WHY: priced as a DDC panel / a DDC panel row this helper does not price / a plain BACnet controller row; the DDC-share
 *     sentence is unchanged.
 *  3b the TEMPORARY test-run line: on every VAV row of a run whose id starts STUB-VAV-2b2-, never on an ordinary run, never in the
 *     Calculator.
 *  3a #133's wording; 3d the DP sensor's small line gives way to the amber block.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blk } from "./vav1Vav.harness";
import { box81, calc81, sheet81, vav81, type Row81 } from "./vav2b2.harness";
import { applyShareEdit, type SharesEditState } from "./vavSheetShares";

const DDC = "Supply, Installation, Testing & Commissioning of DDC Controller with I/O module etc. as per the technical specification in the tender with all the mounting accessories complete as required.";
const TOUCH = "Supply, Installation, testing & Commissioning of the VAV Touch Screen Controller is a microprocessor-based device designed for precise control of Variable Air Volume (VAV) terminal units in HVAC systems.";
// the real sheets carry VAV in a heading row (the DDC row's own words do not say VAV): a Preamble parent, as vav2b1Zero does
const HEAD: Row81 = { node: "Preamble", text: "VAV SYSTEM", category: "" } as Row81;
const ddcRow = (qty: number, filed: "hvac_misc" | "hvac_panels"): Row81 => ({ text: DDC, qty, unit: "Set", category: filed, parent: 5,
  ...(filed === "hvac_misc" ? { claim: { from: "hvac_misc", item: "DDC panel", kind: "ddc" } } : {}) });
const notes = (s: ReturnType<ReturnType<typeof sheet81>>) => s.itemList!.sheetHeadingNotes ?? [];
const hasBacnet = (s: ReturnType<ReturnType<typeof sheet81>>) => s.itemList!.shares!.blocks.some((b) => b.id === "bacnet");
const ed = (...ops: Parameters<typeof applyShareEdit>[1][]) => ops.reduce<SharesEditState>((a, op) => applyShareEdit(a, op), {});
const BOX = blk("VAV box", { shape: "Rectangular", vav_type: "Nothing specific mentioned", integrator_included: "No", airflow_cfm: "650" });

const PRICED_202 = "BACnet controller share not added: row 202 is priced as a DDC panel, and that price already includes the BACnet controllers for this sheet's VAVs. Add the share only if the controllers are not part of that panel.";
const NOT_PRICED_202 = "BACnet controller share not added: row 202 is a DDC panel row, and a DDC panel includes the BACnet controllers for this sheet's VAVs. This helper does not price that row. Add the share only if the controllers are not part of that panel.";

describe("1a / 2a: a separate DDC panel row with a quantity on a BACnet sheet of 45 VAVs", () => {
  it("filed Misc (BOQ-26-00313 r202, priced here as a DDC panel): no BACnet share on the boxes, the note says the panel price includes them", () => {
    const s = sheet81({ 5: HEAD, 1: { ...box81(45, { controller: "bacnet" }), parent: 5 }, 202: ddcRow(2, "hvac_misc") })(1);
    expect(hasBacnet(s)).toBe(false);
    expect(notes(s)).toContain(PRICED_202);
  });
  it("filed Panels (BOQ-26-00442 r202, NOT priced here) -- ANY filing (owner 15:56 '1a'): no share either; the note says this helper does not price it", () => {
    const s = sheet81({ 5: HEAD, 1: { ...box81(45, { controller: "bacnet" }), parent: 5 }, 202: ddcRow(2, "hvac_panels") })(1);
    expect(hasBacnet(s)).toBe(false);
    expect(notes(s)).toContain(NOT_PRICED_202);
  });
  it("QUANTITY 0: the row does not count (20 Nov 21:05) -- the BACnet share stays", () => {
    expect(hasBacnet(sheet81({ 5: HEAD, 1: { ...box81(45, { controller: "bacnet" }), parent: 5 }, 202: ddcRow(0, "hvac_panels") })(1))).toBe(true);
  });
  it("VACUITY: without the DDC panel row's test on the BACnet share (the K1 state) the boxes keep the share", () => {
    const cfg = vav81();
    const sep = (cfg.list_spec as unknown as { pricing: { sheet_shares: { separate: { extras: Array<{ share: string; label: string }> } } } }).pricing.sheet_shares.separate;
    sep.extras = sep.extras.filter((e) => !(e.share === "bacnet" && e.label === "DDC panel row"));
    expect(hasBacnet(sheet81({ 5: HEAD, 1: { ...box81(45, { controller: "bacnet" }), parent: 5 }, 202: ddcRow(2, "hvac_panels") }, { cfg })(1))).toBe(true);
  });
  it("REWORDED (ANSWER 18 3b, owner 15:59 'a'; BEFORE 'DDC panel share not added: the sheet prices it on its own row (row 202). ...'): the DDC-share sentence", () => {
    const s = sheet81({ 5: HEAD, 1: { ...box81(45, { controller: "ddc" }), parent: 5 }, 202: ddcRow(2, "hvac_panels") })(1);
    expect(notes(s)).toContain("DDC panel share not added: row 202 prices it for this sheet's VAVs. Add it here only if that row does not cover these boxes.");
  });
  it("REWORDED 3b, several rows: the grammar follows the count ('rows 202, 203 price it ... those rows do not')", () => {
    const s = sheet81({ 5: HEAD, 1: { ...box81(45, { controller: "ddc" }), parent: 5 }, 202: ddcRow(2, "hvac_panels"), 203: ddcRow(1, "hvac_panels") })(1);
    expect(notes(s)).toContain("DDC panel share not added: rows 202, 203 price it for this sheet's VAVs. Add it here only if those rows do not cover these boxes.");
  });
});

describe("2a: the other two sentences", () => {
  it("a touch screen controller row (BOQ-26-00012 r258): '(a touch screen controller)' after the row number", () => {
    const s = sheet81({ 1: box81(60, { controller: "bacnet" }), 258: { text: TOUCH, qty: 1, unit: "Set", category: "hvac_misc",
      claim: { from: "hvac_misc", item: "touch screen controller", kind: "touch_screen_controller" } } })(1);
    expect(notes(s)).toContain("BACnet controller share not added: row 258 (a touch screen controller) is priced as a DDC panel, and that price already includes the BACnet controllers for this sheet's VAVs. Add the share only if the controllers are not part of that panel.");
  });
  it("a plain BACnet controller row: 'row 50 prices the BACnet controller for this sheet's VAVs' (replaces the VAV-2b1 sentence)", () => {
    const s = sheet81({ 1: box81(45, { controller: "bacnet" }), 50: { text: "BACnet controller for the VAV boxes", qty: 2, unit: "Nos", category: "hvac_misc",
      claim: { from: "hvac_misc", item: "BACnet controller", kind: "bacnet" } } })(1);
    expect(notes(s)).toContain("BACnet controller share not added: row 50 prices the BACnet controller for this sheet's VAVs. Add it here only if that row does not cover these boxes.");
    expect(notes(s).join(" ")).not.toMatch(/prices it on its own row/);
  });
  it("VACUITY: without not_added_by the VAV-2b1 sentence comes back", () => {
    const s = sheet81({ 1: box81(45, { controller: "bacnet" }), 50: { text: "BACnet controller for the VAV boxes", qty: 2, unit: "Nos", category: "hvac_misc" } },
      { cfg: vav81({ dropPricing: ["sheet_shares.not_added_by"] }) })(1);
    // K2 (ANSWER 21 point 3; PIN F10): without not_added_by the GENERAL sentence comes back, now in the owner's 15:59 pattern. BEFORE: 'BACnet
    // controller share not added: the sheet prices it on its own row (row 50). Add it here if the boxes should also carry it.'
    expect(notes(s)).toContain("BACnet controller share not added: row 50 prices it for this sheet's VAVs. Add it here only if that row does not cover these boxes.");
  });
});

describe("ANSWER 18 3b / 3c: the other reworded lines (wording only; WHEN unchanged)", () => {
  it("#94 the DP sensor share: 'DP sensor share not added: row 41 prices it for this sheet's VAVs. ...'", () => {
    const s = sheet81({ 5: HEAD, 1: { ...box81(45, { dp: true }), parent: 5 },
      41: { text: "Supply and installation of duct static pressure sensor for VAV system", qty: 2, unit: "Nos", category: "hvac_sensors", parent: 5 } })(1);
    expect(notes(s)).toContain("DP sensor share not added: row 41 prices it for this sheet's VAVs. Add it here only if that row does not cover these boxes.");
  });
  it("#11 / #12 / #17 / #18: the v81 config's own sentences (the screens fill {rows} / {prices} / {that_row} / {does} by the count)", () => {
    const pr = (vav81().list_spec as unknown as { pricing: { integrator_cabling: { lines: Record<string, string> }; existing_boxes: { lines: Record<string, string> } } }).pricing;
    expect(pr.integrator_cabling.lines.priced_separately).toBe("Integrator cabling not added: {rows} {prices} it for this sheet's VAVs. Add it here only if {that_row} {does} not cover these boxes.");
    expect(pr.integrator_cabling.lines.low_length).toMatch(/^Integrator cabling not added: \{rows\} \{prices\} it for this sheet's VAVs\. Its quantity looks low \(\{metres\} m against \{need\} m/);
    expect(pr.integrator_cabling.lines.low_length).toMatch(/check the cabling quantity and add the cabling price to this row if required\.$/);
    expect(pr.existing_boxes.lines.with_row).toBe("Dismantling is priced on {rows}, so refixing alone is priced at x {factor}.");
    expect(pr.existing_boxes.lines.priced).toMatch(/, supply 0\. No extras are added to work on an existing box\.$/);
  });
});

describe("3b: the TEMPORARY test-run line (UI CHANGE CONTROL item 13) -- REMOVED by VAV-2c3 R6 (PIN K1-A)", () => {
  const rows = { 5: HEAD, 1: { ...box81(45, { controller: "bacnet" }), parent: 5 }, 202: ddcRow(2, "hvac_misc") };
  it("a stub run: NO line any more, on a VAV box row nor on the item-less DDC panel row priced here", () => {
    expect((sheet81(rows, { runId: "STUB-VAV-2b2-BOQ-26-00313-HVAC" })(1).itemList as unknown as Record<string, unknown>).testRunLine).toBeUndefined();
    expect((sheet81(rows, { runId: "STUB-VAV-2b2-BOQ-26-00313-HVAC" })(202).itemList as unknown as Record<string, unknown>).testRunLine).toBeUndefined();
    expect(JSON.stringify(sheet81(rows, { runId: "STUB-VAV-2b2-BOQ-26-00313-HVAC" })(1))).not.toContain("written by hand for a test");
  });
  it("NEVER on an ordinary run, nor with no run, nor in the Calculator", () => {
    const line = (v: unknown) => (v as Record<string, unknown>).testRunLine;
    expect(line(sheet81(rows, { runId: "a1b2c3d4e5" })(1).itemList)).toBeUndefined();
    expect(line(sheet81(rows, { runId: "STUB-VAV-2b1-x" })(1).itemList)).toBeUndefined();
    expect(line(sheet81(rows)(1).itemList)).toBeUndefined();
    expect(line(calc81({ items: [BOX] }).itemList)).toBeUndefined();
  });
  it("neither category shows a line on a stub run: the module that drew it is gone", () => {
    expect(existsSync(new URL("./stubRunMark.ts", import.meta.url))).toBe(false);
  });
});

describe("3a / 3d", () => {
  it("#133: a withdrawn family's line names no owner tag", () => {
    const s = sheet81({ 1: box81(45, {}, {}), 2: { qty: 1, items: [{ vav_item: "VAV box", vav_item_as_written: "VAV box", shape: "Rectangular",
      vav_type: "Nothing specific mentioned", integrator_included: "No", cfm_range: "450-800", airflow_cfm: "700 CFM", qty_per_box: "None", scope: "None",
      controller_mention: "none", controller_by_others: "No", dp_sensor_mention: "No" }, { vav_item: "BACnet over IP controller", vav_item_as_written: "BACnet controller" }] } })(2);
    const text = JSON.stringify(s.itemList);
    expect(text).toContain("BACnet over IP controller is not added to each box. It is shared across the sheet's VAV boxes: use the share button to add it.");
    expect(text).not.toMatch(/\(owner 20/);
  });
  it("3d: a DP share + a Duct Static Pressure Sensor item -> the amber block; the item's small line no longer shows", () => {
    const s = calc81({ items: [BOX], sections: { sensors: [blk("Duct Static Pressure Sensor")] } },
      ed({ op: "add", share: "dp" }, { op: "set", share: "dp", field: "vavs", value: "80" }));
    expect(s.itemList!.doubleCounting).toBeDefined();
    expect(JSON.stringify(s.itemList)).not.toContain("A DP sensor share is also on this row. Check that the sensor is not counted twice.");
  });
});
