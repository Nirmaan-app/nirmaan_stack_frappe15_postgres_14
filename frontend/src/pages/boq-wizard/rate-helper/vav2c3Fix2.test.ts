/**
 * VAV-2c3 FIX-2 (ANSWER 19; the owner 2026-11-24 19:53 "A1 and A2 fix / E ... fix anyway / B1 our standard treatment ... / D1 fix", 20:00 "1. map it to
 * thermostat..and mention in note properly / 2. ok, but the AI should also read it correctly / [no unit] price it by number and mention it clearly in
 * notes. the notes should be a stronger warning", 20:06 "lets proceed"): each fix positive AND negative on a BoQ sheet priced through the panel's
 * own helper with the PAGE's context (the row's chain included), on scratch copies of the v85 FILE with the v86 edits (vav2c3c.harness); the v85
 * side of each is the vacuity check (the same row without the edits).
 */
import { describe, expect, it } from "vitest";
import type { ItemListView } from "./pricingSheetHelper";
import { EDITS86, EDITS87, V85, VAV, box86, cfg87, sheet86, type Row86 } from "./vav2c3c.harness";

// the final state: v85 + v86 + v87 (ANSWER 22: the A2 correction is v87)
const C86 = cfg87(VAV), C85 = V85.byId.get(VAV)!;
type Field = { id: string; value: string; defaulted?: boolean; note?: string };
const view = (rows: Record<number, Row86>, er: number, cfg = C86): ItemListView => sheet86(rows, cfg)(er).itemList!;
const field = (v: ItemListView, id: string, i = 0) => (v.items[i].fields as Field[]).find((f) => f.id === id)!;
const sec = (v: ItemListView) => ((v as unknown as { sections?: { independent?: Array<{ sectionId: string; view: { items: Array<{ family: string | null; state: string; working: string[] }> } }> } })
  .sections?.independent ?? []);
const all = (v: ItemListView) => JSON.stringify(v);
const HEAD = { node: "Preamble", text: "VAV System", qty: null, category: "hvac_vav_box" } as Row86;

describe("the edits file: 14 edits, VAV Box only, no item", () => {
  it("every edit is on hvac_vav_box; no Pricing Input changes", () => {
    expect(new Set(EDITS86.configs.map((e) => e.c))).toEqual(new Set(["hvac_vav_box"]));
    expect(EDITS86.configs).toHaveLength(14);
    expect(EDITS86.pricing_inputs).toEqual({});
  });
  it("v87 (ANSWER 22): 3 edits, VAV Box only - the A2 words, the shape guidance, the A2 reason", () => {
    expect(EDITS87.configs.map((e) => `${e.c}:${e.p.slice(-2).join(".")}`)).toEqual(["hvac_vav_box:1.words", "hvac_vav_box:2.note", "hvac_vav_box:50.why"]);
    expect(EDITS87.pricing_inputs).toEqual({});
  });
});

describe("A1 - a router / integrator named in the box row, its headings or their notes = mentioned -> Integrator Included = Yes", () => {
  const sheet = (extra: Record<number, Row86> = {}): Record<number, Row86> => ({
    5: HEAD, 6: { note: true, parent: 5, text: "Quoted VAVs to be compatible with BMS. To support all VAVs, Router to be placed floor wise." },
    10: { parent: 5, text: "801-1050 CFM", items: [box86({ integrator_included: "None" })] }, ...extra });
  it("a heading's NOTE row naming a router -> Yes, with the line naming the words and where they sit (00149 r462-470)", () => {
    const v = view(sheet(), 10);
    const f = field(v, "integrator_included");
    expect(f.value).toBe("Yes");
    expect(f.note).toBe("The BoQ mentions 'Router' (note row 6), so the integrator is included (Integrator Included = Yes). Change it if no integrator is needed.");
    expect(v.totals!.supply_rate).toBeGreaterThan(view(sheet(), 10, C85).totals!.supply_rate ?? 0);
  });
  it("VACUITY: v85 prices the same row on the No default", () => {
    expect(field(view(sheet(), 10, C85), "integrator_included").value).toBe("No");
  });
  it("NEGATIVE: a separate integrator row on the sheet -> No (the own-row check, unchanged), and the A1 line goes with the Yes", () => {
    const v = view(sheet({ 60: { text: "VAV integrator / router for BMS", qty: 2, unit: "Nos", category: "hvac_misc" } }), 10);
    const f = field(v, "integrator_included");
    expect(f.value).toBe("No");
    expect(f.note ?? "").not.toContain("so the integrator is included");
    expect(v.sheetHeadingNotes ?? []).toContain("Priced without the integrator ('Integrator Included = No'): row 60 prices the VAV integrator for this sheet.");
  });
  it("NEGATIVE: a router named only in a SHEET-WIDE note (no heading) is not read (D-4)", () => {
    const rows: Record<number, Row86> = { 2: { note: true, text: "Router to be placed floor wise." }, 10: { text: "801-1050 CFM", items: [box86({ integrator_included: "None" })] } };
    expect(field(view(rows, 10), "integrator_included").value).toBe("No");
  });
  it("NEGATIVE: a STATED 'No' stays 'No' (only a not-answered integrator is replaced)", () => {
    expect(field(view(sheet({ 10: { parent: 5, text: "801-1050 CFM", items: [box86({ integrator_included: "No" })] } }), 10), "integrator_included").value).toBe("No");
  });
});

describe("A2 - ROUND / OVAL / CIRCULAR naming the box in the row or heading -> the round box (Oval line); the shape word wins (ANSWER 21 / 22, v87)", () => {
  it("'ROUND Boxes' in the heading with the shape not stated (00016 r117-120, the heading row) -> Oval, the line names the word and where it sits", () => {
    const rows: Record<number, Row86> = { 5: { ...HEAD, text: "SITC of POWDER COATED Pressure Independent Variable Air Volume terminals ROUND Boxes with Damper Actuator" },
      10: { parent: 5, text: "VAV 0- 500 CFM DIA NEED MATCH WITH DUCT SIZE", items: [box86({ shape: "None" })] } };
    const v = view(rows, 10);
    expect(field(v, "shape").value).toBe("Oval");
    expect(field(v, "shape").note).toBe("The BoQ says 'ROUND' (heading row 5), so this is priced as a round box (the Oval line). Change the shape if it is rectangular.");
    expect(field(view(rows, 10, C85), "shape").value).toBe("Rectangular");
  });
  it("'circular' over a STATED Rectangular -> Oval", () => {
    expect(field(view({ 10: { text: "Circular VAV box 501-1000 CFM", items: [box86({ shape: "Rectangular" })] } }, 10), "shape").value).toBe("Oval");
  });
  it("NEGATIVE (ANSWER 21): 'DIA' / diameter / the diameter sign give an inlet or sensor size, not the shape -> the Rectangular default", () => {
    for (const t of ["VAV 0- 500 CFM DIA NEED MATCH WITH DUCT SIZE", "4001-6000 CFM - 19\" dia", "300-500 CFM ( 6 Ø inch box)", "25 mm diameter sensor"]) {
      const v = view({ 10: { text: t, items: [box86({ shape: "None" })] } }, 10);
      expect(field(v, "shape").value, t).toBe("Rectangular");
      expect(field(v, "shape").note, t).toBe("Shape not stated - priced as Rectangular (assumed).");
    }
  });
  it("NEGATIVE (D-1): where the chain also says rectangular, the box stays as read", () => {
    const rows: Record<number, Row86> = { 5: { ...HEAD, text: "ROUND VAV boxes with rectangular outlet" }, 10: { parent: 5, text: "4001-6000 CFM", items: [box86({ shape: "Rectangular" })] } };
    expect(field(view(rows, 10), "shape").value).toBe("Rectangular");
  });
  it("NEGATIVE: no round word -> the Rectangular default with the D1 note", () => {
    const v = view({ 10: { text: "VAV 700 CFM", items: [box86({ shape: "None" })] } }, 10);
    expect(field(v, "shape").value).toBe("Rectangular");
    expect(field(v, "shape").note).toBe("Shape not stated - priced as Rectangular (assumed).");
  });
});

describe("D1 - every ruled default shows an '(assumed)' note on the field (chat-Claude's wording)", () => {
  it("integrator, type and shape not stated -> the three notes; the values as before", () => {
    const v = view({ 10: { text: "VAV 700 CFM", items: [box86({ integrator_included: "None", vav_type: "None", shape: "None" })] } }, 10);
    expect([field(v, "integrator_included").note, field(v, "vav_type").note, field(v, "shape").note]).toEqual([
      "Integrator not mentioned in the BoQ - priced without it (assumed).", "Type not named - priced as Nothing specific mentioned (assumed).",
      "Shape not stated - priced as Rectangular (assumed)."]);
    expect(v.totals).toEqual(view({ 10: { text: "VAV 700 CFM", items: [box86({ integrator_included: "None", vav_type: "None", shape: "None" })] } }, 10, C85).totals);
  });
  it("NEGATIVE: a STATED value carries no default note; VACUITY: v85 shows none", () => {
    const v = view({ 10: { text: "VAV 700 CFM", items: [box86()] } }, 10);
    expect(field(v, "integrator_included").note ?? "").toBe("");
    expect(field(view({ 10: { text: "VAV 700 CFM", items: [box86({ integrator_included: "None" })] } }, 10, C85), "integrator_included").note ?? "").toBe("");
  });
});

describe("E - installation words in the nearest heading, no supply word -> Supply + installation WITH note B", () => {
  const NOTE_B = "Priced as Supply + installation. The BoQ says installation, but no supply row for this item was found, and it does not say the material is existing or supplied by others. Change the scope if supply is not required.";
  // (no round word on the row: 00117's own rows carry "19\" dia" but their chain also says rectangular, so A2 holds them - D-1)
  const rows = (head: string): Record<number, Row86> => ({ 5: { ...HEAD, text: head }, 10: { parent: 5, text: "4001-6000 CFM", items: [box86()] } });
  it("'ITC of VAVs ...' and 'Installation of ... CAV Boxes' headings (00117 r315-323, r333-334): S+I with note B, figures unchanged", () => {
    for (const h of ["ITC of VAVs with digital thermostat,suitable wiring", "Installation of pressure independent CAV Boxes . Quote also includes necessary supports"]) {
      const v = view(rows(h), 10);
      const sc = (v as unknown as { scope?: { value?: string; note?: string } }).scope;
      expect(sc?.value).toBe("Supply + installation");
      expect(sc?.note).toBe(NOTE_B);
      expect(v.totals).toEqual(view(rows(h), 10, C85).totals);
    }
  });
  it("NEGATIVE: a heading that also names supply ('Supply & ITC of VAVs') -> no note B; VACUITY: v85 -> no note", () => {
    const sc = (v: ItemListView) => (v as unknown as { scope?: { note?: string } }).scope?.note ?? "";
    expect(sc(view(rows("Supply & ITC of VAVs with digital thermostat"), 10))).not.toBe(NOTE_B);
    expect(sc(view(rows("ITC of VAVs with digital thermostat,suitable wiring"), 10, C85))).not.toBe(NOTE_B);
  });
});

describe("B1 - one extra with no SKU: the row refuses, the note names the component, the other components still price (CHECK: unchanged)", () => {
  it("00020 r507 shape: the box prices, the 'none of these' item names what to add, the row has no total", () => {
    const rows: Record<number, Row86> = { 10: { text: "VAV capacity - 2000 CFM", items: [box86({ integrator_included: "None" }),
      { vav_item: "none of these", vav_item_as_written: "Sensor cabling between CO2 and VAV controller", scope: "None" }] } };
    const v = view(rows, 10);
    expect(v.rowPriced).toBe(false);
    expect(v.items[0].state).toBe("priced");
    expect(all(v)).toContain("No SKU in the catalogue for Sensor cabling between CO2 and VAV controller");
  });
});

describe("B2-1 - a direct-output temperature sensor named with the VAV boxes -> the Digital Thermostat, with its note", () => {
  const LINE = "The BoQ names a direct-output temperature sensor. It is priced as the Digital Thermostat. Change it if a different sensor is needed.";
  const misc = (item: string | null, words: string) => ({ _section: "misc", item, item_as_written: words, size_mm: null, scope: "None" });
  it("an item the model could not name (00137 r148-153): priced as the Digital Thermostat, the row now prices", () => {
    const rows: Record<number, Row86> = { 10: { text: "300-500 CFM ( 6 Ø inch box)", items: [box86(), misc(null, "Direct Output temperature sensor")] } };
    const v = view(rows, 10);
    const s = sec(v)[0].view.items[0];
    expect([s.family, s.state]).toEqual(["Digital Thermostat", "priced"]);
    expect(s.working[0]).toBe(LINE);
    expect(v.rowPriced).toBe(true);
    expect(view(rows, 10, C85).rowPriced).toBe(false);
  });
  it("read as the Thermometer (00164 / 00383) -> the Digital Thermostat", () => {
    const v = view({ 10: { text: "VAV 700 CFM", items: [box86(), misc("Temperature Gauge / Thermometer", "Direct output temperature sensor")] } }, 10);
    expect(sec(v)[0].view.items[0].family).toBe("Digital Thermostat");
  });
  it("NEGATIVE (D-2): the row already prices a Digital Thermostat -> the sensor stays as read (no second thermostat)", () => {
    const v = view({ 10: { text: "VAV 700 CFM", items: [box86(), misc("Digital Thermostat", "digital thermostat"),
      misc("Temperature Gauge / Thermometer", "Direct output temperature sensor")] } }, 10);
    expect(sec(v).map((x) => x.view.items[0].family)).toEqual(["Digital Thermostat", "Temperature Gauge / Thermometer"]);
  });
  it("NEGATIVE: a room temperature sensor (other words) stays the Thermometer", () => {
    const v = view({ 10: { text: "VAV 700 CFM", items: [box86(), misc("Temperature Gauge / Thermometer", "Room temperature sensor")] } }, 10);
    expect(sec(v)[0].view.items[0].family).toBe("Temperature Gauge / Thermometer");
  });
});

describe("B2-2 - a 'controller for BACnet integration above VAV Boxes' row: one controller per unit where no VAV count is known", () => {
  const ROW: Row86 = { text: "Supply, Installation and Testing of controller for BACNet integration above VAV Boxes with BMS. Controller should be suitable to be integrated with minimum 18Nos. of VAV Boxes.",
    qty: 0, unit: "No.", category: "hvac_misc", claim: { from: "hvac_misc", item: "BACnet controller", kind: "bacnet" },
    items: [{ vav_item: "VAV Integrator", vav_item_as_written: "controller for BACNet integration above VAV Boxes with BMS", scope: "Supply + installation" }] };
  const bac = (v: ItemListView) => ((v as unknown as { shares?: { blocks?: Array<{ id: string; figures: { supply_rate: number; install_rate: number } | null; notes?: string[] }> } }).shares?.blocks ?? [])
    .find((b) => b.id === "bacnet_whole")!;
  it("no box quantities on the sheet (00352 r314, 00408 r458): one controller, priced; the line says why", () => {
    const v = view({ 10: { text: "VAV 700 CFM", qty: null, items: [box86()] }, 314: ROW }, 314);
    expect(bac(v).figures).toEqual({ supply_rate: 46200, install_rate: 3200 });
    expect(bac(v).notes ?? []).toContain("No VAV quantities on this sheet, so this controller for BACnet integration is priced as one controller per unit of the row. Change the number of VAVs if known.");
    expect(bac(view({ 10: { text: "VAV 700 CFM", qty: null, items: [box86()] }, 314: ROW }, 314, C85)).figures).toBeNull();
  });
  it("NEGATIVE: with a VAV count on the sheet the controller formula decides, as before (00007 r385 shape)", () => {
    const rows: Record<number, Row86> = { 10: { text: "VAV 700 CFM", qty: 70, items: [box86()] }, 314: { ...ROW, qty: 1 } };
    expect(bac(view(rows, 314)).figures).toEqual(bac(view(rows, 314, C85)).figures);
    expect(bac(view(rows, 314)).notes ?? []).not.toContain("No VAV quantities on this sheet, so this controller for BACnet integration is priced as one controller per unit of the row. Change the number of VAVs if known.");
  });
});

describe("B2-3 - a VAV row with NO unit -> priced per number with the strong warning", () => {
  const BAR = { tone: "orange", title: "Warning: no unit on this row", lines: ["WARNING: The BoQ gives no unit for this row. Priced per number (Nos). Check the unit before using this rate."] };
  it("a box row with a blank unit prices per Nos and shows the orange bar (00029 r29-33); v85 refused 'no unit on this row'", () => {
    const rows: Record<number, Row86> = { 10: { text: "Upto 500 As shown on Drg.", unit: "", qty: null, items: [box86()] } };
    const v = view(rows, 10);
    expect(v.rowPriced).toBe(true);
    expect(v.unitBar).toEqual(BAR);
    expect(view(rows, 10, C85).rowPriced).toBe(false);
    expect(all(view(rows, 10, C85))).toContain("no unit on this row");
  });
  it("its Misc item prices in the same unit (the section no longer refuses 'no unit on this row')", () => {
    const v = view({ 10: { text: "Upto 500", unit: "", items: [box86(), { _section: "misc", item: "Digital Thermostat", item_as_written: "digital thermostat", size_mm: null, scope: "None" }] } }, 10);
    expect(sec(v)[0].view.items[0].state).toBe("priced");
    expect(v.rowPriced).toBe(true);
  });
  it("NEGATIVE: a row WITH a unit shows no bar", () => {
    expect(view({ 10: { text: "VAV 700 CFM", items: [box86()] } }, 10).unitBar).toBeUndefined();
  });
});
