/**
 * VAV-2b1 T1 (B1 - B4) -- the shared items of a VAV sheet, on fixtures through the panel's entry point (`compute` on a BoQ row of a
 * SCRATCH config with the `calculator_only` switch removed on the copy; the loaded config keeps it). Owner rulings 2026-11-20 14:18 -
 * 15:40 (R1 / R3 / R5 - R8). Every figure is worked from the SKUs and the Pricing Inputs the harness reads (never typed as a rate).
 */
import { describe, expect, it } from "vitest";
import { box, itemsV79, other, real, sheet79, vav79 } from "./vav2b1.harness";
import { vavSheet } from "./vav2a.harness";
import { decideSheetShares, type SheetSharesSpec } from "./vavSheetShares";
import type { ItemListSuggestion } from "./pricingSheetHelper";

const sh = (s: ItemListSuggestion) => s.itemList?.shares;
const block = (s: ItemListSuggestion, id: string) => sh(s)?.blocks.find((b) => b.id === id);
const fig = (s: ItemListSuggestion, id: string) => { const b = block(s, id); return b?.figures ? [b.figures.supply_rate, b.figures.install_rate] : null; };
const ids = (s: ItemListSuggestion) => (sh(s)?.blocks ?? []).map((b) => b.id);
const notes = (s: ItemListSuggestion) => s.itemList?.sheetHeadingNotes ?? [];
const BAC = { controller: "bacnet" };
const ROUTER = "Supply,installation,testing & commissioning of all necessary Network controller or Router, Interface to connect the proposed floor VAV with the main BMS system";
const CTRL_ROW = "Supply, Installation and Testing of controller for BACNet integration above VAV Boxes with BMS. Controller should be suitable to be integrated with minimum 55Nos. of VAV";
// the BACnet over IP controller SKU 33,000 / 0.4 + 2,000 / 0.6 -> 46,200 + 3,200; the Duct Static Pressure Sensor 7,650 / 0.4 + 500 / 0.8
// -> 10,710 + 900; the DDC Panel/ Controller 25,000 / 0.4 + 5,000 / 0.6 (owner 14:18, 14:35, 15:23)
const share = (n: number, s: number, i: number, v: number) => [Math.round((n * s) / v), Math.round((n * i) / v)];

describe("B1 / R1 THE BACnet CONTROLLER SHARE: VAVs / 32 rounded up, shared over every box, each of supply and install rounded", () => {
  it("POSITIVE (owner 14:21 worked example): 30 + 50 VAVs with BACnet -> 3 controllers; the SAME share on both rows = 1,733 + 120", () => {
    const s = sheet79({ 10: box(30, BAC), 11: box(50, BAC) });
    expect(fig(s(10), "bacnet")).toEqual([1733, 120]);
    expect(fig(s(11), "bacnet")).toEqual([1733, 120]);
    expect(block(s(10), "bacnet")!.sumLines[0]).toBe("3 x (46,200 + 3,200) = 1,48,200 / 80 VAVs = 1,853 per box");
    expect(block(s(10), "bacnet")!.fields.find((f) => f.id === "vavs")).toMatchObject({ value: "80", source: "sheet" });
    expect(block(s(10), "bacnet")!.fields.find((f) => f.id === "controllers_count")).toMatchObject({ value: "3", source: "worked_out" });
    expect(block(s(10), "bacnet")!.tag).toBe("added by the helper");
  });
  it.each([[32, 1], [33, 2], [64, 2], [65, 3]])("EDGE %i VAVs -> %i controllers", (v, n) => {
    const s = sheet79({ 10: box(v, BAC) });
    expect(block(s(10), "bacnet")!.fields.find((f) => f.id === "controllers_count")!.value).toBe(String(n));
    expect(fig(s(10), "bacnet")).toEqual(share(n, 46200, 3200, v));
  });
  it("POSITIVE the share joins the row total as its own line; NEGATIVE the box rate itself is unchanged (never folded in)", () => {
    const withShare = sheet79({ 10: box(80, BAC) })(10).itemList!;
    const without = sheet79({ 10: box(80) })(10).itemList!;
    expect(without.shares?.blocks ?? []).toEqual([]);
    expect(withShare.items.map((b) => b.figures)).toEqual(without.items.map((b) => b.figures));
    expect([withShare.totals!.supply_rate! - without.totals!.supply_rate!, withShare.totals!.install_rate! - without.totals!.install_rate!]).toEqual([1733, 120]);
  });
  it("EDGE one box on the sheet carries the whole controller", () => {
    expect(fig(sheet79({ 10: box(1, BAC) })(10), "bacnet")).toEqual([46200, 3200]);
  });
  it("NEGATIVE no controller word -> nothing; a row that is not a box (installation only) carries nothing and is not counted", () => {
    expect(ids(sheet79({ 10: box(80) })(10))).toEqual([]);
    const s = sheet79({ 10: box(30, BAC), 11: box(50, BAC, { scope: "Installation only" }) });
    expect(block(s(10), "bacnet")!.fields.find((f) => f.id === "vavs")!.value).toBe("30");
    expect(sh(s(11))?.blocks ?? []).toEqual([]);
  });
});

describe("B2 / R7 FIRST MATCH PER SHEET: DDC, else BACnet, else a plain controller (with its note), else nothing", () => {
  it("POSITIVE DDC present -> the DDC panel share and NO BACnet and NO DP share (owner 14:39 'we dont count it twice')", () => {
    const s = sheet79({ 10: box(30, { controller: "ddc_inclusive", dp: true }), 11: box(50, { ...BAC, dp: true }) });
    expect(ids(s(10))).toEqual(["ddc"]);
    expect(ids(s(11))).toEqual(["ddc"]);
  });
  it("POSITIVE DDC 80 VAVs: panels 1, controllers 3, sensors 3 -> 1,46,950 BCS x 1.4 = 2,05,730; 5,000 x 1.6 = 8,000; 2,672 per box", () => {
    const b = block(sheet79({ 10: box(80, { controller: "ddc_inclusive" }) })(10), "ddc")!;
    expect(b.figures).toEqual({ supply_rate: 2572, install_rate: 100 });
    expect(b.sumLines).toEqual([
      "Supply: panels 1 x 25,000 + controllers 3 x 33,000 + sensors 3 x 7,650 = 1,46,950 BCS x 1.4 = 2,05,730",
      "Installation: panels 1 x 5,000 = 5,000 BCS x 1.6 = 8,000",
      "2,13,730 / 80 VAVs = 2,672 per box"]);
    expect(b.replacesLine).toBe("Replaces the BACnet and DP sensor shares on this row.");
    expect(b.notes).toEqual([]);
  });
  it.each([[200, 1, 7, 7], [201, 2, 7, 7]])("EDGE %i VAVs -> panels %i, controllers %i, sensors %i", (v, p, c, n) => {
    const b = block(sheet79({ 10: box(v, { controller: "ddc_inclusive" }) })(10), "ddc")!;
    const f = (id: string) => b.fields.find((x) => x.id === id)!.value;
    expect([f("panels_count"), f("controllers_count"), f("sensors_count")]).toEqual([String(p), String(c), String(n)]);
    const qs = Math.ceil((p * 25000 + c * 33000 + n * 7650) * 1.4 - 1e-9), qi = Math.ceil(p * 5000 * 1.6 - 1e-9);
    expect(b.figures).toEqual({ supply_rate: Math.round(qs / v), install_rate: Math.round(qi / v) });
  });
  it("EDGE one box on a DDC sheet (owner 15:02 'option a', BOQ-26-00087): the whole panel lands on it = 91,910 + 8,000, and the warning flags it", () => {
    const s = sheet79({ 10: box(1, { controller: "ddc_inclusive" }) })(10);
    expect(fig(s, "ddc")).toEqual([91910, 8000]);
    expect(s.itemList!.combinationWarning).toMatch(/combines the box with 1 extra/);
    expect(s.itemList!.reviewHeading).toBe("Review before using");
  });
  it("POSITIVE a DDC mention WITHOUT 'inclusive' still adds it, with the note (14:42 '5', wording 14:45)", () => {
    expect(block(sheet79({ 10: box(80, { controller: "ddc" }) })(10), "ddc")!.notes)
      .toEqual(["DDC panel share added. The BoQ mentions a DDC panel but does not say the price includes it. Remove it if not required."]);
  });
  it("POSITIVE a plain controller -> the BACnet share + the 'check' note; NEGATIVE no 'check' note when another row says BACnet", () => {
    expect(block(sheet79({ 10: box(80, { controller: "controller" }) })(10), "bacnet")!.notes)
      .toEqual(["BACnet controller share added. The BoQ mentions a controller but does not say BACnet. Check, and remove it if not required."]);
    expect(block(sheet79({ 10: box(40, { controller: "controller" }), 11: box(40, BAC) })(10), "bacnet")!.notes).toEqual([]);
  });
  it("NEGATIVE 'by the BMS vendor' -> nothing, with a note (15:19 '2 ok'); 'single OEM' / the AHU's DDC / a VFD controller are read 'bacnet' / 'none' by the reading -> BACnet only / nothing", () => {
    const s = sheet79({ 10: box(80, { controller: "controller", byOthers: true }) })(10);
    expect(ids(s)).toEqual([]);
    expect(notes(s)).toContain("No controller share: the BoQ says the VAV controllers are by the BMS vendor / by others.");
    expect(ids(sheet79({ 10: box(80, { controller: "bacnet" }) })(10))).toEqual(["bacnet"]);
    expect(ids(sheet79({ 10: box(80, { controller: "none" }) })(10))).toEqual([]);
  });
});

describe("B2 / R7 SEPARATE ROWS: presence decides, nothing added, the note names the row", () => {
  it("POSITIVE a separate BACnet controller row WITH a quantity (BOQ-26-00007 r385 wording, quantity 2) -> no share, the note names row 50", () => {
    const s = sheet79({ 10: box(80, BAC), 50: other(CTRL_ROW, 2) })(10);
    expect(ids(s)).toEqual([]);
    expect(notes(s)).toContain("BACnet controller share not added: the sheet prices it on its own row (row 50). Add it here if the boxes should also carry it.");
  });
  it("QUANTITY 0 (owner 21:05 'a, yes'): the same row with quantity 0 or blank does NOT count as charged separately -> the share is added with the note naming it", () => {
    for (const q of [0, null]) {
      const s = sheet79({ 10: box(80, BAC), 50: other(CTRL_ROW, q) })(10);
      expect(fig(s, "bacnet"), String(q)).toEqual([1733, 120]);
      expect(block(s, "bacnet")!.notes, String(q)).toEqual(["Controller row 50 has quantity 0, so the BACnet controller share is added here. Remove it if the controller is ordered on that row."]);
    }
  });
  it("QUANTITY 0 on a RATE-ONLY sheet (every box row blank / 0) -> unchanged: nothing added + the rate-only note", () => {
    const s = sheet79({ 10: box(null, BAC), 50: other(CTRL_ROW, 0) })(10);
    expect(ids(s)).toEqual([]);
    expect(notes(s).join(" ")).toMatch(/BACnet controller share not added: the box quantities on this sheet are blank or 0/);
  });
  it("QR-D2 (owner 19:46 'integrator row does not count for controller'): a router / network-controller row and an integrator row are NOT the controller's row -> the share is added", () => {
    expect(ids(sheet79({ 10: box(80, BAC), 50: other(ROUTER, 2) })(10))).toEqual(["bacnet"]);
    expect(ids(sheet79({ 10: box(80, BAC), 50: other("Supply, Installation and Testing of Integrator for BMS connectivity of all VAV Boxes", 1) })(10))).toEqual(["bacnet"]);
  });
  it("QR-D2 (owner 20:20 'option b'): a 'Router / Supervisory Controller ... to monitor and Control the VAVs' row IS the controller's row -> no share, the note names it (real rows BOQ-26-00188 r20, BOQ-26-00393 r21)", () => {
    for (const ref of ["BOQ-26-00188 'HVAC - VAV BOQ' r20", "BOQ-26-00393 '1.2 HVAC - VAV BOQ' r21"]) {
      expect(real(ref).qty, ref).toBe(1);
      const s = sheet79({ 10: box(31, BAC), 20: real(ref) })(10);
      expect(ids(s), ref).toEqual([]);
      expect(notes(s).join(" "), ref).toMatch(/BACnet controller share not added: the sheet prices it on its own row \(row 20\)/);
    }
  });
  it("QR-D2 (owner 19:50 'a'): a 'Network controller or Router ... Interface to connect the VAV with the BMS' row is an integrator row ONLY -> the share is added (real rows BOQ-26-00033 r90, BOQ-26-00440 r92)", () => {
    for (const ref of ["BOQ-26-00033 'VAV' r90", "BOQ-26-00440 'VAV' r92"]) {
      expect(fig(sheet79({ 10: box(31, BAC), 20: real(ref) })(10), "bacnet"), ref).toEqual([1490, 103]);
    }
  });
  it("QR-D (owner 20:54 'option a' + 20:56 / 21:05): r70 'VAV Master Controller ... monitor and control all VAV status' is the controller's row, but its quantity is 0 -> the share IS added with the note naming row 70 (real row BOQ-26-00098 r70); NEGATIVE its neighbour r59 'Bacnet IP Router for BMS connectivity' is an integrator row only -> the share is added with NO controller note", () => {
    const s70 = sheet79({ 10: box(10, BAC), 70: real("BOQ-26-00098 'VAV' r70") })(10);
    expect(fig(s70, "bacnet")).toEqual([4620, 320]);
    expect(block(s70, "bacnet")!.notes).toEqual(["Controller row 70 has quantity 0, so the BACnet controller share is added here. Remove it if the controller is ordered on that row."]);
    const s59 = sheet79({ 10: box(10, BAC), 59: real("BOQ-26-00098 'VAV' r59") })(10);
    expect(fig(s59, "bacnet")).toEqual([4620, 320]);
    expect(block(s59, "bacnet")!.notes).toEqual([]);
  });
  it("the controls-the-VAVs rule on r70's own words WITH a quantity -> the controller's row, nothing added; NEGATIVE (vacuity, fixture) that test taken out -> the share is added", () => {
    const r70q = { ...real("BOQ-26-00098 'VAV' r70"), qty: 1 };
    expect(ids(sheet79({ 10: box(10, BAC), 70: r70q })(10))).toEqual([]);
    const sep = structuredClone((vav79() as unknown as { list_spec: { pricing: { sheet_shares: { separate: { extras: Array<Record<string, unknown>> } } } } }).list_spec.pricing.sheet_shares.separate);
    sep.extras = sep.extras.filter((e) => e.label !== "Controller for the VAVs row");
    expect(ids(sheet79({ 10: box(10, BAC), 70: r70q }, { separate: sep })(10))).toEqual(["bacnet"]);
  });
  it("NEGATIVE (vacuity, fixture): without `not_integrator_rows` all four are the controller's row (the test as built); without `controls_vav_words` all four are integrator rows", () => {
    const sep = () => structuredClone((vav79() as unknown as { list_spec: { pricing: { sheet_shares: { separate: { extras: Array<Record<string, unknown>> } } } } }).list_spec.pricing.sheet_shares.separate);
    const noSkip = sep(); for (const e of noSkip.extras) if (e.share === "bacnet") delete e.not_integrator_rows, delete e.controls_vav_words;
    const noCtl = sep(); for (const e of noCtl.extras) if (e.share === "bacnet") delete e.controls_vav_words;
    noCtl.extras = noCtl.extras.filter((e) => e.label !== "Controller for the VAVs row");
    for (const ref of ["BOQ-26-00033 'VAV' r90", "BOQ-26-00440 'VAV' r92", "BOQ-26-00188 'HVAC - VAV BOQ' r20", "BOQ-26-00393 '1.2 HVAC - VAV BOQ' r21"]) {
      expect(ids(sheet79({ 10: box(31, BAC), 20: real(ref) }, { separate: noSkip })(10)), ref).toEqual([]);
      expect(ids(sheet79({ 10: box(31, BAC), 20: real(ref) }, { separate: noCtl })(10)), ref).toEqual(["bacnet"]);
    }
  });
  it("POSITIVE a separate DDC panel row -> no DDC share; a separate duct static pressure sensor row -> no DP share (each with a quantity)", () => {
    expect(ids(sheet79({ 10: box(80, { controller: "ddc_inclusive" }), 50: other("Supply and installation of DDC panel for VAV boxes", 1) })(10))).toEqual([]);
    expect(ids(sheet79({ 10: box(80, { dp: true }), 50: other("Supply and installation of Duct static pressure sensor ( Pressure Range -1 - 0 to 500 pa)", 4, "hvac_sensors") })(10))).toEqual([]);
  });
  it("QUANTITY 0 each way for the DDC panel and the DP sensor (fixtures; the corpus has no DDC panel row on a DDC sheet, so N/A on real rows) and the real DP rows BOQ-26-00352 r267 (qty 3) / the same words with qty 0", () => {
    const d0 = sheet79({ 10: box(80, { controller: "ddc_inclusive" }), 50: other("Supply and installation of DDC panel for VAV boxes", 0) })(10);
    expect(ids(d0)).toEqual(["ddc"]);
    expect(block(d0, "ddc")!.notes).toEqual(["DDC panel row 50 has quantity 0, so the DDC panel share is added here. Remove it if the DDC panel is ordered on that row."]);
    expect(ids(sheet79({ 10: box(80, { dp: true }), 50: real("BOQ-26-00352 'HVAC ' r267") })(10))).toEqual([]);
    const p0 = sheet79({ 10: box(80, { dp: true }), 50: { ...real("BOQ-26-00352 'HVAC ' r267"), qty: 0 } })(10);
    expect(ids(p0)).toEqual(["dp"]);
    expect(block(p0, "dp")!.notes).toEqual(["DP sensor row 50 has quantity 0, so the DP sensor share is added here. Remove it if the DP sensor is ordered on that row."]);
  });
  it("QR-D3 (a) NEGATIVES: an Air Flow Monitoring Station row and a 'Differential Pressure gauge' row are NOT the DP sensor's row", () => {
    expect(ids(sheet79({ 10: box(80, { dp: true }), 50: other("Supply, installation, testing, and commissioning of Air Flow Monitoring Station (AFMS) suitable for measuring and monitoring airflow in supply air ducts and differential pressure transmitter", 4) })(10))).toEqual(["dp"]);
    expect(ids(sheet79({ 10: box(80, { dp: true }), 50: other("Differential Pressure gauge", 1, "hvac_valve_package") })(10))).toEqual(["dp"]);
  });
  it("QR-D3 (a) POSITIVE: a duct static pressure sensor row FOR THE AHU / VFD is still the DP sensor's row (whatever it serves)", () => {
    expect(ids(sheet79({ 10: box(80, { dp: true }), 50: other("Supply, Installation, Testing & Commissioning of Duct type Static Pressure Sensor inside AHU Plenum", 4, "hvac_sensors") })(10))).toEqual([]);
    expect(ids(sheet79({ 10: box(80, { dp: true }), 50: other("SITC of duct mounted static pressure sensor with display and connecting to VFD", 1, "hvac_sensors") })(10))).toEqual([]);
    expect(ids(sheet79({ 10: box(80, { dp: true }), 50: other("Supply, Installation, Testing and commissioning of Duct static pressure tarnsducer", 1, "hvac_sensors") })(10))).toEqual([]);
  });
  it("NEGATIVE a controller row of OTHER equipment (AHU) is not the VAVs' controller row -> the share is added", () => {
    expect(ids(sheet79({ 10: box(80, BAC), 50: other("BACnet controller for AHU fan VFD", 1) })(10))).toEqual(["bacnet"]);
  });
});

describe("B1 / R8 THE DP SENSOR SHARE: VAVs / 30 rounded up x the Duct Static Pressure Sensor, every DP mention", () => {
  it.each([[30, 1], [31, 2], [80, 3]])("%i VAVs -> %i sensors", (v, n) => {
    const b = block(sheet79({ 10: box(v, { dp: true }) })(10), "dp")!;
    expect(b.fields.find((f) => f.id === "sensors_count")!.value).toBe(String(n));
    expect(b.figures).toEqual({ supply_rate: Math.round((n * 10710) / v), install_rate: Math.round((n * 900) / v) });
  });
  it("POSITIVE BACnet AND DP -> both shares, each its own block", () => {
    expect(ids(sheet79({ 10: box(80, { ...BAC, dp: true }) })(10))).toEqual(["bacnet", "dp"]);
  });
});

describe("B1 / B3 QUANTITIES: blank or 0", () => {
  it("POSITIVE every box blank / 0 -> nothing added + the note asking the pricer to add it", () => {
    const s = sheet79({ 10: box(null, BAC), 11: box(0, BAC) })(10);
    expect(ids(s)).toEqual([]);
    expect(notes(s)).toContain("BACnet controller share not added: the box quantities on this sheet are blank or 0, so the number of VAVs is not known. Add it with the button and type the number of VAVs.");
  });
  it("MODE 'skip' (QR-N (b)): some blank -> the given quantities count, the share on EVERY box row, the note says how many have none", () => {
    const s = sheet79({ 10: box(80, BAC), 11: box(null, BAC), 12: box(0, BAC) });
    expect(fig(s(11), "bacnet")).toEqual([1733, 120]);
    expect(block(s(10), "bacnet")!.notes).toEqual(["2 box rows on this sheet have no quantity and are not counted in the number of VAVs."]);
  });
  it("MODE 'sheet_off' (QR-N (a)): some blank -> nothing on the sheet", () => {
    expect(ids(sheet79({ 10: box(80, BAC), 11: box(null, BAC) }, { blank: "sheet_off" })(10))).toEqual([]);
  });
});

describe("B4 THE PER-BOX CONTROLLER AND THE DP SWITCH LEAVE VAV (R2, R8)", () => {
  it("POSITIVE a model item of either is dropped with a line; NEGATIVE the v78 config (key absent) still prices them per box", () => {
    const rows = { 10: { qty: 80, items: [box(80).items![0], { vav_item: "BACnet over IP controller", vav_item_as_written: "controller", qty_per_box: "None", scope: "None" },
      { _section: "sensors", sensor: "Differential Pressure Switch", sensor_as_written: "DP switch", qty_per_box: "None" }] } };
    const v79 = sheet79(rows)(10).itemList!;
    expect(v79.items.map((b) => b.family)).toEqual(["VAV box"]);
    expect(v79.sections?.independent ?? []).toEqual([]);
    expect(notes(sheet79(rows)(10))).toEqual(expect.arrayContaining([expect.stringMatching(/^BACnet over IP controller: no longer added to each box/),
      expect.stringMatching(/^Differential Pressure Switch: no longer added to each box/)]));
    const v78 = vavSheet(rows, { cfg: vav79({ drop: ["withdrawn_families", "sheet_shares"] }), items: itemsV79() })(10).itemList!;
    expect(v78.items.map((b) => b.family)).toEqual(["VAV box", "BACnet over IP controller"]);
  });
});

describe("decideSheetShares (pure) -- the first match and the separate rows", () => {
  const spec = (vav79() as unknown as { list_spec: { pricing: { sheet_shares: SheetSharesSpec } } }).list_spec.pricing.sheet_shares;
  const r = (row: number, qty: number | null, controller = "none", dp = false, byOthers = false) => ({ row, counted: true, qty, reading: { controller, byOthers, dp } });
  it("POSITIVE ddc wins over bacnet; dp never with ddc", () => {
    expect(decideSheetShares(spec, [r(1, 10, "ddc_inclusive", true), r(2, 10, "bacnet", true)], {}).add).toEqual(["ddc"]);
    expect(decideSheetShares(spec, [r(1, 10, "bacnet", true)], {}).add).toEqual(["bacnet", "dp"]);
  });
  it("NEGATIVE a by-others controller reading counts for no rule", () => {
    expect(decideSheetShares(spec, [r(1, 10, "bacnet", false, true)], {}).add).toEqual([]);
  });
  it("POSITIVE a DDC separate row stops the DDC share and nothing else is added (the panel on its own row covers its parts)", () => {
    const d = decideSheetShares(spec, [r(1, 10, "ddc_inclusive", true)], { ddc: [44] });
    expect(d.add).toEqual([]);
    expect(d.rowNotes[0]).toMatch(/DDC panel share not added: the sheet prices it on its own row \(row 44\)/);
  });
});
