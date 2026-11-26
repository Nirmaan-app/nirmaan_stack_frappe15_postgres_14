/**
 * VAV-2b2 K1b -- the owner's "A" (2026-11-21 13:59 "A :price touch screen controlor or master controlor as DDC panel. give appropriate
 * notes"; 14:46 "go with your recommendations for all cases"). From the PANEL'S ENTRY POINT; real rows' words (BOQ-26-00012 r258,
 * BOQ-26-00093 r200, BOQ-26-00098 r70), invented sheets around them.
 *  A-1 a touch screen / master controller row for the VAVs is priced AS A DDC PANEL (the full-rate block, per unit) and counts as the
 *      sheet's controller row AND DDC panel row (a quantity above 0 -> no controller / DDC share on the boxes, the note names the row;
 *      quantity 0 -> the share stays).
 *  A-2 r70 ("VAV Master Controller", qty 0): priced as a DDC panel (the sheet's VAVs pre-filled), its boxes keep the share.
 *  A-3 the note. A-4 the amber block also for a BACnet share + a full-rate BACnet block and a DP share + a Duct Static Pressure Sensor.
 */
import { describe, expect, it } from "vitest";
import { blk } from "./vav1Vav.harness";
import { box81, calc81, sheet81, vav81, type Row81 } from "./vav2b2.harness";
import { applyShareEdit, type SharesEditState } from "./vavSheetShares";

const TOUCH = "Supply, Installation, testing & Commissioning of the VAV Touch Screen Controller is a microprocessor-based device designed for precise control of Variable Air Volume (VAV) terminal units in HVAC systems.";
const MASTER = "Master Controller- to loop VAV's output to IBMS PC The Master Controller shall be able to communicate with VAV boxes and enable the output to IBMS for integration. (BACnet, Modbus & SNMP Card to be provided)";
const claimed = (text: string, qty: number, kind: string, item: string, unit = "Set"): Row81 => ({ text, qty, unit, category: "hvac_misc", claim: { from: "hvac_misc", item, kind } });
const ed = (...ops: Parameters<typeof applyShareEdit>[1][]) => ops.reduce<SharesEditState>((a, op) => applyShareEdit(a, op), {});
const BOX = blk("VAV box", { shape: "Rectangular", vav_type: "Nothing specific mentioned", integrator_included: "No", airflow_cfm: "650" });

describe("A-1 / A-3: a touch screen controller row (BOQ-26-00012 r258 words) on a BACnet sheet of 60 VAVs", () => {
  const rows = { 1: box81(60, { controller: "bacnet" }), 258: claimed(TOUCH, 1, "touch_screen_controller", "touch screen controller") };
  it("priced as the DDC panel's full-rate block: 60 VAVs -> 2 controllers, 2 sensors, 1,48,820 + 8,000 per unit, with the owner's note", () => {
    const v = sheet81(rows)(258).itemList!;
    expect(v.totals).toEqual({ supply_rate: 148820, install_rate: 8000, combined_rate: 156820 });
    expect(v.shares!.blocks.find((b) => b.id === "ddc_whole")?.origin).toBe("helper");
    expect(v.sheetHeadingNotes).toContain("Priced as a DDC panel. The BoQ calls this a touch screen controller. Check before using.");
  });
  it("the sheet's boxes lose the BACnet controller share (r258 is the controller's own row, qty 1) -- the note names row 258", () => {
    const v = sheet81(rows)(1).itemList!;
    expect(v.shares!.blocks.some((b) => b.id === "bacnet")).toBe(false);
    expect((v.sheetHeadingNotes ?? []).some((l) => /row 258/.test(l))).toBe(true);
  });
  it("VACUITY: without the touch / master separate-row test the boxes keep the share (the double count)", () => {
    const v = sheet81(rows, { cfg: vav81({ dropPricing: ["separate_extras_add"] }) })(1).itemList!;
    expect(v.shares!.blocks.some((b) => b.id === "bacnet")).toBe(true);
  });
});

describe("A-1 / A-2: master controller rows", () => {
  it("BOQ-26-00093 r200 (45 VAVs, boxes read no controller): 1,48,820 + 8,000 per unit; no box figure moves", () => {
    const rows = { 1: box81(45), 200: claimed(MASTER, 1, "master_controller", "master controller", "Nos") };
    expect(sheet81(rows)(200).itemList!.totals).toEqual({ supply_rate: 148820, install_rate: 8000, combined_rate: 156820 });
    expect(sheet81(rows)(1).itemList!.shares!.blocks.length).toBe(0);
  });
  it("QUANTITY 0 (r70 kind): priced on the sheet's 10 VAVs = 91,910 + 8,000; the boxes KEEP the BACnet share (20 Nov 21:05)", () => {
    const rows = { 1: box81(10, { controller: "bacnet" }), 70: claimed(MASTER, 0, "master_controller", "master controller") };
    expect(sheet81(rows)(70).itemList!.totals).toEqual({ supply_rate: 91910, install_rate: 8000, combined_rate: 99910 });
    expect(sheet81(rows)(1).itemList!.shares!.blocks.some((b) => b.id === "bacnet")).toBe(true);
  });
});

describe("A-4: the amber block for the same item twice", () => {
  const V80S = (k: string) => ({ op: "set" as const, share: k, field: "vavs", value: "80" });
  it("a BACnet share + a full-rate BACnet block: the block, the small line goes", () => {
    const s = calc81({ items: [BOX] }, ed({ op: "add", share: "bacnet" }, V80S("bacnet"), { op: "add", share: "bacnet_whole" }, V80S("bacnet_whole")));
    expect(s.itemList!.doubleCounting?.lines).toEqual([
      "The BACnet controller share on this row already covers 3 BACnet controllers. A full-rate BACnet controller is also on this row. Remove one of them unless both are needed."]);
    expect(s.itemList!.shares!.blocks.find((b) => b.id === "bacnet_whole")!.notes).not.toContain("A BACnet controller share is also on this row. Check that the controller is not counted twice.");
  });
  it("a DP share + a Duct Static Pressure Sensor item: the block, the item's small line goes", () => {
    const s = calc81({ items: [BOX], sections: { sensors: [blk("Duct Static Pressure Sensor")] } }, ed({ op: "add", share: "dp" }, V80S("dp")));
    expect(s.itemList!.doubleCounting?.lines).toEqual([
      "The DP sensor share on this row already covers 3 DP sensors. A Duct Static Pressure Sensor is also on this row. Remove one of them unless both are needed."]);
  });
  it("NEGATIVE: a BACnet share alone -> no block", () => {
    expect(calc81({ items: [BOX] }, ed({ op: "add", share: "bacnet" }, V80S("bacnet"))).itemList!.doubleCounting).toBeUndefined();
  });
});
