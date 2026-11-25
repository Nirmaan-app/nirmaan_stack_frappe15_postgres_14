/**
 * VAV-2b2 B5 / T3 (R16, owner 2026-11-21 12:33 / 12:34 "agree on all 3" / 12:36 "a"; R17; R3 01:15 / 01:21 / 01:31 / 01:36 "A"): a row filed
 * under Misc / Sensors that the run says the VAV helper claimed is priced by the VAV helper under the existing rule for its item, stays
 * filed where it is and carries the note. Every case from the PANEL'S ENTRY POINT (makePricingSheetHelper(...).compute). Real rows' words
 * (BOQ-26-00007 r385 / r368, 00313 r202 / r203, 00080 r28, 00239 r276, 00424 r52); invented sheets around them.
 */
import { describe, expect, it } from "vitest";
import { box81, sheet81, vav81, type Row81 } from "./vav2b2.harness";

const BACNET_385 = "Supply, Installation and Testing of controller for BACNet integration above VAV Boxes with BMS. Controller should be suitable to be integrated with minimum 55Nos. of VAV Boxes. Integrator shall be capable of soft integration with BMS system.";
const DDC_202 = "Supply, Installation, Testing & Commissioning of DDC Controller with I/O module etc. as per the technical specification in the tender with all the mounting accessories complete as required.";
const ENCL_203 = "Supply, Installation, Testing & Commissioning of Enclosure for DDC Controller & other accessories as per the technical specification in the tender with all the mounting accessories complete as required.";
const DP_368 = "Supply, Installation and Testing of pressure sensors to be installed in supply air ducts. Quoted price shall be inclusive of necessary conduting, copper control cabling from the sensors to the respective VFDs as per \"Approved Shop Drawings\".";
const INTEG_28 = "Supply, Installation and Testing of Integrator for BMS connectivity of all VAV Boxes with neccessary sensors copper control cabling as required.";
const DISM_276 = "Dismantling of Existing VAV, Thermostat along with control cabling form VAV to thermostat";
const NOTE = (cat: string, item: string) => `This row is filed under ${cat}. It is priced here because it matches a VAV item (${item}). The classification may be wrong.`;
const misc = (text: string, qty: number | null, kind: string, item: string, unit = "No", category = "hvac_misc"): Row81 =>
  ({ text, qty, unit, category, claim: { from: category, item, kind } });
const notes = (v: { sheetHeadingNotes?: string[] } | undefined) => v?.sheetHeadingNotes ?? [];

describe("VAV-2b2 R16 / R3: a separate BACnet controller row filed under Misc", () => {
  // 70 VAVs on the sheet; the controller row (quantity 0) as BOQ-26-00007 r385
  const rows = { 10: box81(40, { controller: "bacnet" }), 11: box81(30, { controller: "bacnet" }), 385: misc(BACNET_385, 0, "bacnet", "BACnet controller") };
  it("POSITIVE: priced per unit by the full-rate BACnet block the HELPER adds (70 VAVs / 32 = 3 controllers x (46,200 + 3,200)), with the Misc note", () => {
    const v = sheet81(rows)(385).itemList!;
    expect(v.rowPriced).toBe(true);
    expect(v.totals).toEqual({ supply_rate: 138600, install_rate: 9600, combined_rate: 148200 });
    const b = v.shares!.blocks.find((x) => x.id === "bacnet_whole")!;
    expect(b.origin).toBe("helper");
    expect(b.fields.find((f) => f.id === "vavs")?.value).toBe("70");
    expect(notes(v)).toContain(NOTE("Misc", "BACnet controller"));
    // no share by the helper on a non-box row (R4)
    expect(v.shares!.blocks.some((x) => x.id === "bacnet")).toBe(false);
  });
  it("R4: the share buttons stay offered; a share the USER adds there carries the 'not a VAV box row' warning", () => {
    const v = sheet81(rows)(385, { __shares__: JSON.stringify({ bacnet: { added: true } }) }).itemList!;
    const s = v.shares!.blocks.find((x) => x.id === "bacnet")!;
    expect(s.notes).toContain("This row is not priced as a VAV box. A share is meant for VAV box rows. Check before using.");
  });
  it("the user can remove the helper's block (the row then has nothing priced)", () => {
    const v = sheet81(rows)(385, { __shares__: JSON.stringify({ bacnet_whole: { removed: true } }) }).itemList!;
    expect(v.rowPriced).toBe(false);
  });
  it("BOQ-26-00424 r52 'VAV BACnet controller/ Modbus card', quantity 12 on a 173-VAV sheet: 173 / 12 = 15 per controller -> 1 controller per unit", () => {
    const s = { 1: box81(173, { controller: "bacnet" }), 52: misc("Supply & installation of VAV BACnet controller/ Modbus card with wall mountable metallic enclosure for BMS integration.", 12, "bacnet", "BACnet controller", "Nos") };
    const v = sheet81(s)(52).itemList!;
    expect(v.totals).toEqual({ supply_rate: 46200, install_rate: 3200, combined_rate: 49400 });
    expect(v.shares!.blocks.find((x) => x.id === "bacnet_whole")!.fields.find((f) => f.id === "vavs")?.value).toBe("15");
  });
  it("the box rows of the sheet: the quantity-0 controller row still does NOT count as charged separately (their share stays, as before)", () => {
    const v = sheet81(rows)(10).itemList!;
    expect(v.shares!.blocks.some((x) => x.id === "bacnet")).toBe(true);
  });
  it("a priced separate controller row (quantity 1) still switches the boxes' share off (the own-row effect unchanged)", () => {
    const s = { ...rows, 385: misc(BACNET_385, 1, "bacnet", "BACnet controller") };
    expect(sheet81(s)(10).itemList!.shares!.blocks.some((x) => x.id === "bacnet")).toBe(false);
  });
});

describe("VAV-2b2 R16 / R3: a separate DDC panel row filed under Misc (BOQ-26-00313 r202, quantity 2, 45 VAVs)", () => {
  const rows = { 1: box81(45, { controller: "ddc" }), 202: misc(DDC_202, 2, "ddc", "DDC panel", "Set"), 203: { text: ENCL_203, qty: 2, unit: "Set", category: "hvac_misc" } as Row81 };
  it("POSITIVE: per unit, VAVs pre-filled 45 / 2 = 23 per panel: (25,000 + 1 x 33,000 + 1 x 7,650) x 1.4 + 5,000 x 1.6", () => {
    const v = sheet81(rows)(202).itemList!;
    expect(v.totals).toEqual({ supply_rate: 91910, install_rate: 8000, combined_rate: 99910 });
    const b = v.shares!.blocks.find((x) => x.id === "ddc_whole")!;
    expect(b.fields.find((f) => f.id === "vavs")?.value).toBe("23");
    expect(notes(v)).toContain(NOTE("Misc", "DDC panel"));
  });
  it("NEGATIVE: its enclosure row r203 is not claimed (the server does not claim it) -> 'coming soon' as before (01:31)", () => {
    const r = sheet81(rows)(203) as unknown as { kind: string; reason?: string };
    expect(r.kind).toBe("none");
  });
});

describe("VAV-2b2 R16 / R17: a DP sensor row filed under Sensors (BOQ-26-00007 r368)", () => {
  it("priced as the Duct Static Pressure Sensor, a plain item per unit (10,710 + 900), with the Sensors note", () => {
    const rows = { 1: box81(70, { controller: "bacnet", dp: true }), 368: misc(DP_368, 2, "dp", "DP sensor", "No", "hvac_sensors") };
    const v = sheet81(rows)(368).itemList!;
    expect(v.totals).toEqual({ supply_rate: 10710, install_rate: 900, combined_rate: 11610 });
    expect(notes(v)).toContain(NOTE("Sensors & Controls", "DP sensor"));
  });
});

describe("VAV-2b2 R16 / R17: an integrator row and an existing-box row filed under Misc", () => {
  it("BOQ-26-00080 r28: the 'VAV Integrator' line (the model's own integrator item kept)", () => {
    const rows = { 1: box81(20), 28: { ...misc(INTEG_28, 1, "integrator", "VAV integrator"),
      items: [{ vav_item: "VAV Integrator", vav_item_as_written: "Integrator", vav_type: "Nothing specific mentioned", qty_per_box: "None", scope: "None" }] } };
    const v = sheet81(rows)(28).itemList!;
    expect(v.rowPriced).toBe(true);
    expect(v.items.map((b) => b.family)).toEqual(["VAV Integrator"]);
    expect(notes(v)).toContain(NOTE("Misc", "VAV integrator"));
  });
  it("BOQ-26-00239 r276 'Dismantling of Existing VAV ...': VAV installation 2,400 x the dismantling factor 1.0, supply 0", () => {
    const rows = { 1: box81(20), 276: misc(DISM_276, 15, "existing", "VAV installation", "Sets") };
    const v = sheet81(rows)(276).itemList!;
    expect(v.totals).toEqual({ supply_rate: 0, install_rate: 2400, combined_rate: 2400 });
  });
});

describe("VAV-2b2 R16: untouched rows and KEY ABSENT = UNCHANGED", () => {
  it("a Misc row the run did NOT claim is 'coming soon', exactly as before", () => {
    const r = sheet81({ 1: box81(20), 7: { text: "Supply of MS supports", qty: 10, unit: "Kg", category: "hvac_misc" } })(7) as unknown as { kind: string };
    expect(r.kind).toBe("none");
  });
  it("NEGATIVE (vacuity of the key): with claims_filed taken out of v81, the same claimed run row is 'coming soon' -- the claim is ignored", () => {
    const rows = { 10: box81(40, { controller: "bacnet" }), 385: misc(BACNET_385, 0, "bacnet", "BACnet controller") };
    const r = sheet81(rows, { cfg: vav81({ dropPricing: ["claims_filed"] }) })(385) as unknown as { kind: string };
    expect(r.kind).toBe("none");
  });
  it("a claim naming a category the config does not claim from is ignored (the row keeps its own config)", () => {
    const rows = { 10: box81(40), 9: { text: BACNET_385, qty: 1, unit: "No", category: "hvac_panels", claim: { from: "hvac_panels", item: "BACnet controller", kind: "bacnet" } } as Row81 };
    expect((sheet81(rows)(9) as unknown as { kind: string }).kind).toBe("none");
  });
});
