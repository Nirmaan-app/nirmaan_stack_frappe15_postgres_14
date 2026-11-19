/**
 * VAV-2a SHEET RULES (T1 groups 3-6, T2 artefacts, T3 key absent, T4 never in the calculator) on scratch copies of the newest VAV config
 * with the VAV-2a keys of __fixtures__/vav2aKeys.json (vav2a.harness), VAV's calculator_only switch removed ON THE COPY for the BoQ rows.
 *
 * B3 CHARGED ON ITS OWN ROW (owner 2026-11-18 23:32; QR-3a (a) the same sheet, QR-4 (a) Ducting's way at 90%, 2026-11-19 00:57).
 * B4 RATE-ONLY (owner 2026-11-19 01:23 "agree on all 3"): quantities blank or 0 on either side -> the separate row decides, NOT added.
 * QR-C1 (a) (owner 2026-11-19 13:31): a separate VAV integrator row -> the box on the "Integrator Included = No" line, presence decides.
 * B5 INTEGRATOR CABLING (owner 23:14 / 23:18; 01:29 / 01:34 / 01:39; 12:37-12:55).
 * B6 EXISTING BOXES (owner 23:49; mockup screen 4).
 * Real rows pinned from the VAV-R0 library sheets (VAV-D0 dump): BOQ-26-00049 r171 / r180 / r184-r186 / r192, BOQ-26-00166 r272 / r274,
 * BOQ-26-00020 r64, BOQ-26-00012 r266, BOQ-26-00318 r148, BOQ-26-00003 r273 / r367.
 */
import { describe, expect, it } from "vitest";
import { ITEM_LIST_OVERRIDE_KEY, vavCablingRow, vavIntegratorNamed, vavNearHit, vavRowsNamed, vavSeparateRow } from "./pricingSheetHelper";
import { blk } from "./vav1Vav.harness";
import { KEYS, boxItem, calcWith, tot, vavBare, vavFull, vavSheet, withInputs, type SheetRow } from "./vav2a.harness";

type Oc = Parameters<typeof vavSeparateRow>[0];
type Ic = Parameters<typeof vavCablingRow>[0];
const OC = KEYS.pricing.own_row_check as Oc;
const IC = KEYS.pricing.integrator_cabling as Ic;
const EX = (label: string) => OC.extras.find((e) => e.label === label)!;
const line = (row: number, text: string, unit = "Nos", headings?: string[]) => ({ row, text, unit, ...(headings ? { headings } : {}) });
const BOX = 22400, BOX_I = 2400;               // Rect / Nothing specific / Integrator No / 450-800
const T = [4200, 500];                         // Misc Digital Thermostat
const notes = (v: { sheetHeadingNotes?: string[] } | undefined) => v?.sheetHeadingNotes ?? [];
const thermo = (q: string | null = "None") => ({ _section: "misc", item: "Digital Thermostat", item_as_written: "digital thermostat", qty_per_box: q });

/** a VAV box row (r30, qty `boxQty`) with a thermostat, plus the given other rows */
function sheet(other: Record<number, SheetRow>, boxQty: number | null = 10, cfg = vavFull(), items = withInputs(), boxExtras: Array<Record<string, string | number | null>> = [thermo()]) {
  return vavSheet({ 30: { text: "500 CFM", qty: boxQty, items: [boxItem(), ...boxExtras] }, ...other }, { cfg, items });
}
const v30 = (other: Record<number, SheetRow>, boxQty: number | null = 10, cfg = vavFull(), items = withInputs(), extras?: Array<Record<string, string | number | null>>) =>
  sheet(other, boxQty, cfg, items, extras)(30).itemList!;

describe("VAV-2a B3 - an extra charged on its own row of the same sheet (QR-4 (a), the 90% Pricing Input)", () => {
  it("POSITIVE >= 90%: a separate thermostat row at 10 of 10 boxes -> the thermostat is NOT added; the note names the row", () => {
    const v = v30({ 40: { text: "Digital thermostat for VAV", qty: 10, category: "hvac_sensors" } });
    expect(tot(v)).toEqual([BOX, BOX_I]);
    expect(v.sections?.independent ?? []).toHaveLength(0);
    expect(notes(v)).toEqual(["Digital thermostat is priced on its own row of this sheet (row 40) - not added to this row. Add it here if this row should also include it."]);
  });
  it("EDGE exactly 90% (9 of 10) is covered -> not added; 8 of 10 -> ADDED with 'possible double counting' naming the row", () => {
    expect(tot(v30({ 40: { text: "Digital thermostat", qty: 9, category: "hvac_sensors" } }))).toEqual([BOX, BOX_I]);
    const v = v30({ 40: { text: "Digital thermostat", qty: 8, category: "hvac_sensors" } });
    expect(tot(v)).toEqual([BOX + T[0], BOX_I + T[1]]);
    expect(notes(v)).toEqual(["Digital thermostat added - possible double counting - also priced in row 40."]);
  });
  it("the VAV side counts EVERY VAV row of the sheet that prices the extra (r30 10 + r31 10 = 20): 18 covered, 17 not", () => {
    const two = (q: number) => vavSheet({ 30: { text: "500 CFM", qty: 10, items: [boxItem(), thermo()] }, 31: { text: "700 CFM", qty: 10, items: [boxItem(), thermo()] },
      40: { text: "Thermostat", qty: q, category: "hvac_sensors" } }, { cfg: vavFull() })(30).itemList!;
    expect(tot(two(18))).toEqual([BOX, BOX_I]);
    expect(tot(two(17))).toEqual([BOX + T[0], BOX_I + T[1]]);
  });
  it("the 90% is READ LIVE from the Pricing Input 'VAV - own-row threshold': at 0.5 the 8-of-10 row is covered; missing -> added with the line", () => {
    const r = { 40: { text: "Digital thermostat", qty: 8, category: "hvac_sensors" } };
    expect(tot(v30(r, 10, vavFull(), withInputs(undefined, { vav_own_row_threshold: 0.5 })))).toEqual([BOX, BOX_I]);
    const v = v30(r, 10, vavFull(), withInputs(undefined, { vav_own_row_threshold: null }));
    expect(tot(v)).toEqual([BOX + T[0], BOX_I + T[1]]);
    expect(notes(v)[0]).toBe("Digital thermostat added - possible double counting - also priced in row 40. (The Pricing Input 'VAV - own-row threshold' is not set, so it was added.)");
  });
  it("several separate rows are added up and named; more than 10 -> 'and N more'", () => {
    const many: Record<number, SheetRow> = {};
    for (let r = 40; r < 52; r++) many[r] = { text: "Thermostat", qty: 1, category: "hvac_sensors" };
    const v = v30(many);
    expect(tot(v)).toEqual([BOX, BOX_I]);
    expect(notes(v)[0]).toContain("(rows 40, 41, 42, 43, 44, 45, 46, 47, 48, 49 and 2 more)");
    expect(vavRowsNamed([5])).toBe("row 5");
    expect(vavRowsNamed([7, 5, 6])).toBe("rows 5, 6, 7");
  });
  it("each extra by its own words: CO2 sensor (Sensors section) and the BACnet over IP controller (an own VAV item)", () => {
    const co2 = v30({ 41: { text: "CO2 sensor wall mounted", qty: 10, category: "hvac_sensors" } }, 10, vavFull(), withInputs(),
      [{ _section: "sensors", sensor: "CO2 Sensor", qty_per_box: "None" }]);
    expect(tot(co2)).toEqual([BOX, BOX_I]);
    expect(notes(co2)[0]).toMatch(/^CO2 sensor is priced on its own row/);
    // (a row naming "VAV box(es)" is read as a box row by the agreed test -- see the next assertion -- so the separate row names the controller alone)
    expect(vavSeparateRow(OC, EX("BACnet over IP controller"), line(42, "BACnet over IP controller for the VAV boxes", "Nos"))).toBe(false);
    const bac = v30({ 42: { text: "BACnet over IP controller with integration", qty: 10, category: "hvac_misc" } }, 10, vavFull(), withInputs(),
      [{ vav_item: "BACnet over IP controller", vav_item_as_written: "controller compatible to BACNET OVER IP", qty_per_box: "None" }]);
    expect(tot(bac)).toEqual([BOX, BOX_I]);
    expect(bac.items.map((b) => b.family)).toEqual(["VAV box"]);
  });
  it("NEGATIVE: no separate row -> the extra is added as usual, no line", () => {
    const v = v30({ 40: { text: "Grille 300 x 300", qty: 10, category: "hvac_adp" } });
    expect(tot(v)).toEqual([BOX + T[0], BOX_I + T[1]]);
    expect(notes(v)).toEqual([]);
  });
});

describe("VAV-2a B4 - rate-only BoQs: quantities blank or 0 -> the separate row decides (NOT added)", () => {
  it("the separate row's quantity 0 (BOQ-26-00049 r180: 'SITC OF DIGITAL Thermostat connect to shared vav', qty 0) -> not added, the rate-only line", () => {
    const v = v30({ 180: { text: "SITC OF DIGITAL Thermostat connect to shared vav (including any additional accessories if required)", qty: 0, category: "hvac_sensors" } }, 67);
    expect(tot(v)).toEqual([BOX, BOX_I]);
    expect(notes(v)).toEqual(["Digital thermostat is priced on its own row of this sheet (row 180) - not added to this row (the quantities are blank or 0, so the separate row decides). Add it here if this row should also include it."]);
  });
  it("the VAV rows' quantity 0 / blank, or the separate row's blank -> not added the same way", () => {
    expect(tot(v30({ 40: { text: "Thermostat", qty: 10, category: "hvac_sensors" } }, 0))).toEqual([BOX, BOX_I]);
    expect(tot(v30({ 40: { text: "Thermostat", qty: 10, category: "hvac_sensors" } }, null))).toEqual([BOX, BOX_I]);
    expect(tot(v30({ 40: { text: "Thermostat", qty: null, category: "hvac_sensors" } }))).toEqual([BOX, BOX_I]);
  });
});

describe("VAV-2a QR-C1 (a) - a separate VAV integrator row: presence decides, the box on the 'Integrator Included = No' line", () => {
  const yesBox = boxItem({ integrator_included: "Yes" });
  it("POSITIVE: integrator inside the rate + a VAV integrator row (qty 1 for 40 boxes: no quantity test) -> the No line (22,400, not 24,920)", () => {
    const v = vavSheet({ 30: { text: "500 CFM", qty: 40, items: [yesBox] }, 50: { text: "VAV Integrator with BACnet router for 20 VAVs per loop", qty: 1, category: "hvac_misc" } },
      { cfg: vavFull(["integrator_cabling"]) })(30).itemList!;
    expect(tot(v)).toEqual([BOX, BOX_I]);
    expect(v.items[0].fields.find((f) => f.skuAttr === "integrator_included")?.value).toBe("No");
    expect(notes(v)).toEqual(["The VAV integrator is priced on its own row of this sheet (row 50) - this box is priced on the 'Integrator Included = No' line."]);
  });
  it("NEGATIVE: no integrator row -> Yes stays (24,920); a heat-meter integrator row is not a VAV integrator; nor a per-metre row", () => {
    const yes = (other: Record<number, SheetRow>) => vavSheet({ 30: { text: "500 CFM", qty: 40, items: [yesBox] }, ...other }, { cfg: vavFull(["integrator_cabling"]) })(30).itemList!;
    expect(tot(yes({}))).toEqual([24920, BOX_I]);
    expect(tot(yes({ 50: { text: "BTU meter with integrator and flow sensor", qty: 2, category: "hvac_valve_package" } }))).toEqual([24920, BOX_I]);
    expect(tot(yes({ 50: { text: "Cable from VAV integrator to BMS", unit: "Rmt", qty: 100, category: "hvac_misc" } }))).toEqual([24920, BOX_I]);
  });
});

describe("VAV-2a T2 - ARTEFACTS NEVER COUNT as a separate row", () => {
  it("the AHU thermostat (BOQ-26-00020 r64), the duct static-pressure sensor (BOQ-26-00012 r266), the IAQ monitor (BOQ-26-00318 r148)", () => {
    expect(vavSeparateRow(OC, EX("Digital thermostat"), line(64, "Proportional cooling thermostat AHU.", "No", ["EQUIPMENT", "Supply, installation, testing and commissioning of COOLING THERMOSTAT "]))).toBe(false);
    expect(vavSeparateRow(OC, EX("Differential pressure switch"), line(266, "Supply air duct mounted static pressure sensor and controller (DP sensor for VFD control) with suitable fittings and FRLS armoured cabling from pressure sensor to AHU VFD/DDC panel", "Sets"))).toBe(false);
    expect(vavSeparateRow(OC, EX("CO2 sensor"), line(148, "Supply, installation, testing and commissioning of Real time IAQ monitoring devices for following parameters Particulate Matter: PM 1, PM2.5, PM10 Gases: TVOC and CO2 Thermal: Temperature and Humidity(RH)", "Set"))).toBe(false);
    // and on a row: the AHU thermostat row beside a VAV thermostat -> the thermostat is still added
    expect(tot(v30({ 64: { text: "Proportional cooling thermostat AHU.", unit: "No", qty: 10, category: "hvac_sensors" } }))).toEqual([BOX + T[0], BOX_I + T[1]]);
  });
  it("a per-metre row, a cable named before the extra, a box row, an existing-work row, a mounting box, an artefact heading -> none counts", () => {
    const e = EX("Digital thermostat");
    expect(vavSeparateRow(OC, e, line(1, "Thermostat wiring", "Rmt"))).toBe(false);
    expect(vavSeparateRow(OC, e, line(2, "Cable for thermostat to VAV", "Nos"))).toBe(false);
    expect(vavSeparateRow(OC, e, line(3, "VAV box 500 CFM with thermostat", "Nos"))).toBe(false);
    expect(vavSeparateRow(OC, e, line(4, "Dismantling of existing thermostat", "Nos"))).toBe(false);
    expect(vavSeparateRow(OC, e, line(5, "Thermostat mounting box", "Nos"))).toBe(false);
    expect(vavSeparateRow(OC, e, line(6, "Thermostat", "Nos", ["HVAC", "AHU controls"]))).toBe(false);
    expect(vavSeparateRow(OC, e, line(7, "Thermostat", "Sqm"))).toBe(false);
    // positive controls of the same test
    expect(vavSeparateRow(OC, e, line(8, "Digital thermostat", "Nos"))).toBe(true);
    expect(vavSeparateRow(OC, e, line(9, "Digital thermostat", ""))).toBe(true);
  });
  it("pieces and duct connections must name VAV (in the row or its headings)", () => {
    expect(vavSeparateRow(OC, EX("Conical piece"), line(1, "Conical reducer", "Nos"))).toBe(false);
    expect(vavSeparateRow(OC, EX("Conical piece"), line(2, "Conical piece for VAV", "Nos"))).toBe(true);
    expect(vavSeparateRow(OC, EX("Duct connection"), line(3, "Flexible duct connection", "Nos", ["Duct work", "VAV accessories"]))).toBe(true);
    expect(vavSeparateRow(OC, EX("Duct connection"), line(4, "Canvas connection for AHU", "Nos"))).toBe(false);
  });
  it("cabling: a conduit row, a power cable naming VAV (BOQ-26-00003 r273), a VRF cable under a VAV heading, a row naming VAV nowhere (r367) -> not a cabling row", () => {
    expect(vavCablingRow(IC, line(1, "25 mm PVC conduit for VAV cabling", "Rmt"))).toBe("conduit row, not a cable row");
    expect(vavCablingRow(IC, line(273, "Supply, Installation of Power Cable -3Core * 1.5Sqmm (VAV)", "Rmt", ["Cables & Conduits"]))).toBe("power cable");
    expect(vavCablingRow(IC, line(2, "Control cable for VRF outdoor units", "Rmt", ["HVAC", "VAV cabling"]))).toBe("names other equipment under a VAV heading");
    expect(vavCablingRow(IC, line(3, "Fire damper wiring 2C x 1.5", "Rmt", ["HVAC", "VAV works"]))).toBe("names other equipment under a VAV heading");
    expect(vavCablingRow(IC, line(367, "Control Cable between IDU to ODU -Supply and Laying of 2C X 1 Sq.mm Shielded Communication cable", "Rmt", ["VRF SYSTEM WORKS"]))).toBe("VAV not named in the row or its headings");
    expect(vavCablingRow(IC, line(4, "VAV looping cable", "Nos"))).toBe("not per metre");
  });
  it("found by the 84-sheet reproduction (M4): the four readings v3 makes, pinned on the real rows", () => {
    // BOQ-26-00313 r204: VAV named as 'VARIABLE AIR VOLUME' in the heading above the cable row -> counts
    expect(vavCablingRow(IC, line(204, "Supply, laying & termination of 2C X 1.5 Sqmm, PVC multistrand, unarmoured, Screeened Copper Cable with conduits", "Rmt",
      ["VARIABLE AIR VOLUME SYSTEM", "Direct Digital Controllers (DDC) & Panel"]))).toBe("yes");
    // BOQ-26-00049 r149: 'VAV' only in the row's own note (a sub-heading); the description is fire-damper wiring -> does not count
    expect(vavCablingRow(IC, line(149, "SITC of Wiring from FIRE DAMPER DB to ALL Fire dampers 6C X 1.0 Sqm FRLS copper armoured cable | VAV and ASSOCIATED WORKS", "Rmt",
      ["AIR CONDITIONING WORKS"]))).toBe("names other equipment under a VAV heading");
    // BOQ-26-00210 r86: 'Supply & installation of Router' names no context word around the word itself -> not a VAV integrator
    expect(vavIntegratorNamed(IC, "Supply & installation of Router")).toBe(false);
    expect(vavIntegratorNamed(IC, "VAV Integrator")).toBe(true);
    // BOQ-26-00071 'VAV WORKS' r56: a quantity-bearing heading (Preamble, Rmt 175) is a cabling row on the sheet
    const v = vavSheet({ 30: { text: "500 CFM", qty: 6, items: [boxItem()] }, 49: { text: "Network controller or Router, Interface to connect the proposed floor VAV with the main SCADA system via Modbus RS485", qty: 1, category: "hvac_misc" },
      56: { text: "2core, 1.0 Sqmm, screened ATC/sheathed cable communication cable in PVC Conduit of 19 mm dia for looping between VAV to VAV looping", node: "Preamble", unit: "Rmt", qty: 175, category: "hvac_cables" } },
      { cfg: vavFull() })(30).itemList!;
    expect(tot(v)).toEqual([BOX, BOX_I]);
    expect(notes(v)).toEqual(["Integrator cabling is priced on its own row of this sheet (row 56) - not added to this row."]);
  });
});

describe("VAV-2a B5 - the integrator cabling", () => {
  const integ = { 50: { text: "VAV Integrator", qty: 1, category: "hvac_misc" } };
  it("POSITIVE none found: integrator on the sheet, no VAV cabling row -> the helper ADDS 2 m of the Integrator cabling SKU (392 + 0), marked, removable", () => {
    const v = v30(integ, 10, vavFull(), withInputs(), []);
    expect(tot(v)).toEqual([BOX + 392, BOX_I]);
    const cab = v.items.find((b) => b.family === "Integrator cabling")!;
    expect(cab.qty).toBe("2");
    expect(cab.source).toBe("helper");
    expect(cab.helperAdded).toBe(true);
    expect(cab.helperLine).toBe("2 m of integrator cabling added per box - no separate integrator cabling row naming VAV found on this sheet. Remove it if not needed.");
    expect(cab.working.join("\n")).toContain("2 m of integrator cabling added per box");
    // removable: the pricer's list without it prices the box alone
    const s = sheet(integ, 10, vavFull(), withInputs(), []);
    const removed = s(30, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: 0, family: null, attrs: {} }] }) }).itemList!;
    expect(tot(removed)).toEqual([BOX, BOX_I]);
  });
  it("the metres per box are READ LIVE from 'VAV - integrator cabling metres per box' (3 m -> 588); not set -> nothing added, the line", () => {
    expect(tot(v30(integ, 10, vavFull(), withInputs(undefined, { vav_cabling_m_per_box: 3 }), []))).toEqual([BOX + 588, BOX_I]);
    const v = v30(integ, 10, vavFull(), withInputs(undefined, { vav_cabling_m_per_box: null }), []);
    expect(tot(v)).toEqual([BOX, BOX_I]);
    // a missing input has no item to name it, so the plain-English pass shows its id as words
    expect(notes(v)).toEqual(["Integrator cabling not added: the Pricing Input 'vav cabling m per box' is not set."]);
  });
  it("POSITIVE found (BOQ-26-00049 r184-r186 under 'SITC OF CABLE FOR VAV'; r192 names VAV nowhere): nothing added, the note names the rows", () => {
    const rows: Record<number, SheetRow> = {
      170: { text: "SITC OF CABLE FOR VAV", node: "Preamble" },
      184: { text: "CAT 6 FRLS armoured Cable for Communication (from Integrator to BMS Room)", unit: "Rmt", qty: 180, category: "hvac_misc", parent: 170 },
      185: { text: "VAV Thermostat: 5C x 1 Sq.mm. FRLS Shielded armoured Cable for Field Devices", unit: "Rmt", qty: 550, category: "wiring_cabling", parent: 170 },
      186: { text: "VAV Looping: 2Cr x 1.5 Sq.mm. FRLS Shielded Armoured. Cable for Field DeviceS", unit: "Rmt", qty: 560, category: "wiring_cabling", parent: 170 },
      192: { text: "SITC Occup. Sensor Integration cable of 4X x 1.0 Sqmm FRLS Shielded Armoured. Cable", unit: "Rmt", qty: 0, category: "wiring_cabling" },
      ...integ };
    const v = v30(rows, 67, vavFull(), withInputs(), []);
    expect(tot(v)).toEqual([BOX, BOX_I]);
    expect(v.items.map((b) => b.family)).toEqual(["VAV box"]);
    expect(notes(v)).toEqual(["Integrator cabling is priced on its own row of this sheet (rows 184, 185, 186) - not added to this row."]);
  });
  it("the 70% check only changes the NOTE: 10 m against 2 m x 10 boxes x 70% = 14 -> the longer note; quantities blank -> the plain note", () => {
    const r = (q: number | null) => ({ 60: { text: "Armoured cable for VAV to VAV Looping", unit: "Rmt", qty: q, category: "wiring_cabling" }, ...integ });
    const low = v30(r(10), 10, vavFull(), withInputs(), []);
    expect(tot(low)).toEqual([BOX, BOX_I]);
    expect(notes(low)).toEqual(["Integrator cabling is priced on its own row of this sheet (row 60) - not added to this row. Its quantity looks low (10 m against 20 m = 2 m x 10 VAV boxes, below 70%): check the cabling quantity and add the cabling price to this row if required."]);
    expect(notes(v30(r(14), 10, vavFull(), withInputs(), []))).toEqual(["Integrator cabling is priced on its own row of this sheet (row 60) - not added to this row."]);
    expect(notes(v30(r(null), 10, vavFull(), withInputs(), []))).toEqual(["Integrator cabling is priced on its own row of this sheet (row 60) - not added to this row."]);
    expect(notes(v30(r(0), 10, vavFull(), withInputs(), []))).toEqual(["Integrator cabling is priced on its own row of this sheet (row 60) - not added to this row."]);
  });
  it("a model-read cabling item on a sheet with a cabling row is dropped (priced separately, never included)", () => {
    const v = v30({ 60: { text: "VAV looping cable", unit: "Rmt", qty: 100, category: "wiring_cabling" }, ...integ }, 10, vavFull(), withInputs(),
      [{ vav_item: "Integrator cabling", vav_item_as_written: "cabling to integrator", qty_per_box: "2" }]);
    expect(tot(v)).toEqual([BOX, BOX_I]);
  });
  it("the integrator may sit only in the box row's headings ('VAV integrators to be offered part of VAV supply') -> the rule runs", () => {
    const v = vavSheet({ 30: { text: "0- 520 CFM", qty: 10, items: [boxItem()], headingNotes: ["VAV integrators to be offered part of VAV supply, the integrator shall have Processor"] } },
      { cfg: vavFull() })(30).itemList!;
    expect(tot(v)).toEqual([BOX + 392, BOX_I]);
  });
  it("NEGATIVE: no integrator on the sheet (or only a heat-meter integrator) -> no cabling rule; a row with no VAV box -> none", () => {
    expect(tot(v30({}, 10, vavFull(), withInputs(), []))).toEqual([BOX, BOX_I]);
    expect(tot(v30({ 50: { text: "BTU meter with integrator, flow sensor", qty: 2, category: "hvac_valve_package" } }, 10, vavFull(), withInputs(), []))).toEqual([BOX, BOX_I]);
    expect(vavNearHit("BTU meter with integrator and flow sensor", "\\b(integrators?)\\b", "vav|bms|meter", 120, "heat\\s*meter|btu|flow", 80)).toBeNull();
    const noBox = vavSheet({ 30: { text: "controller", qty: 10, items: [{ vav_item: "BACnet over IP controller", qty_per_box: "None" }] }, ...integ }, { cfg: vavFull() })(30).itemList!;
    expect(noBox.items.map((b) => b.family)).toEqual(["BACnet over IP controller"]);
  });
});

describe("VAV-2a B6 - existing boxes: the installation alone, x the factor, no extras", () => {
  const D272 = "Dismantling of Existing VAV, Thermostat along with control cabling form VAV to thermostat";
  const R274 = "Re Installation, configuration and commissioning of VAV Units with thermostat, Including supply & laying control wiring between thermostat and supply";
  const items = [boxItem({ cfm_range: "None" }), thermo()];
  const row = (rows: Record<number, SheetRow>, er: number, it = withInputs()) => vavSheet(rows, { cfg: vavFull(), items: it })(er).itemList!;
  it("BOQ-26-00166 r272 dismantling only: 2,400 x 1.0 = 2,400, supply 0, ONE item (the thermostat is not priced)", () => {
    const v = row({ 272: { text: D272, unit: "Sets", qty: 15, items } }, 272);
    expect(tot(v)).toEqual([0, 2400]);
    expect(v.items.map((b) => b.family)).toEqual(["VAV installation - any size"]);
    expect(v.sections?.independent ?? []).toHaveLength(0);
    expect(v.items[0].working.join("\n")).toContain("Dismantling of an existing VAV box: installation 2400 x 1 (Pricing Input 'VAV - dismantling only') = 2400");
  });
  it("BOQ-26-00166 r274 refixing with the separate VAV dismantling row r272 on the sheet: x 0.5 = 1,200, the note names row 272", () => {
    const v = row({ 272: { text: D272, unit: "Sets", qty: 15 }, 274: { text: R274, unit: "Sets", qty: 15, items } }, 274);
    expect(tot(v)).toEqual([0, 1200]);
    expect(notes(v)).toEqual(["Dismantling is priced on its own row of this sheet (row 272) - refixing alone at x 0.5."]);
  });
  it("refixing with NO dismantling row: x 1.5 = 3,600; a 'Dismantling of Existing ducts, grilles' row does not count (it names no VAV)", () => {
    expect(tot(row({ 274: { text: R274, unit: "Sets", qty: 15, items } }, 274))).toEqual([0, 3600]);
    const v = row({ 272: { text: "Dismantling of Existing ducts, grilles and diffusers", unit: "Sqm", qty: 100, category: "hvac_ducting" }, 274: { text: R274, unit: "Sets", qty: 15, items } }, 274);
    expect(tot(v)).toEqual([0, 3600]);
    expect(notes(v)).toEqual(["No separate dismantling row naming VAV on this sheet - refixing priced at x 1.5."]);
  });
  it("dismantling AND refixing in one row: x 1.5 = 3,600", () => {
    expect(tot(row({ 300: { text: "Dismantling and refixing of existing VAV boxes", unit: "Nos", qty: 4, items } }, 300))).toEqual([0, 3600]);
  });
  it("the factor is READ LIVE (dismantling 2.0 -> 4,800); not set -> the row is not priced, with the sentence", () => {
    expect(tot(row({ 272: { text: D272, unit: "Sets", qty: 15, items } }, 272, withInputs(undefined, { vav_existing_dismantle: 2 })))).toEqual([0, 4800]);
    const v = row({ 272: { text: D272, unit: "Sets", qty: 15, items } }, 272, withInputs(undefined, { vav_existing_dismantle: null }));
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toContain("Work on an existing box: the Pricing Input 'vav existing dismantle' is not set - price this row by hand.");
  });
  it("NEGATIVE: only the row's OWN words count -- 'Lifting, shifting, placement' in a heading is not refixing (F13); a new box row is untouched", () => {
    const v = vavSheet({ 263: { text: "500 CFM", qty: 2, items: [boxItem()], headings: ["SITC of the following items -Lifting ,shifting , placement ,receiving at site"] } },
      { cfg: vavFull(["integrator_cabling"]) })(263).itemList!;
    expect(tot(v)).toEqual([BOX, BOX_I]);
  });
});

describe("VAV-2a - a quantity-bearing heading (a Preamble WITH a unit) is a separate row in every sheet rule; a plain heading is not", () => {
  it("B3: a Preamble 'Digital thermostat' Nos 10 counts (the thermostat is not added); the same words as a unitless heading do not", () => {
    expect(tot(v30({ 40: { text: "Digital thermostat", node: "Preamble", unit: "Nos", qty: 10, category: "hvac_sensors" } }))).toEqual([BOX, BOX_I]);
    expect(tot(v30({ 40: { text: "Digital thermostat", node: "Preamble", unit: "", qty: null } }))).toEqual([BOX + T[0], BOX_I + T[1]]);
  });
  it("B6: a Preamble 'Dismantling of Existing VAV' Sets 15 is the separate dismantling row (refix x 0.5); a unitless heading is not (x 1.5)", () => {
    const R = "Re Installation, configuration and commissioning of VAV Units with thermostat";
    const rf = (h: SheetRow) => vavSheet({ 272: h, 274: { text: R, unit: "Sets", qty: 15, items: [boxItem({ cfm_range: "None" })] } }, { cfg: vavFull() })(274).itemList!;
    expect(tot(rf({ text: "Dismantling of Existing VAV", node: "Preamble", unit: "Sets", qty: 15 }))).toEqual([0, 1200]);
    expect(tot(rf({ text: "Dismantling of Existing VAV", node: "Preamble", unit: "", qty: null }))).toEqual([0, 3600]);
  });
});

describe("VAV-2a T4 / T3 - never in the calculator; each key absent = the row as v76 priced it", () => {
  it("T4: the calculator runs none of B3 / B5 / B6 (no sheet): the D2-like entry prices its items as typed", () => {
    const v = calcWith(vavFull(), { items: [blk("VAV box", { shape: "Rectangular", vav_type: "Nothing specific mentioned", integrator_included: "Yes", cfm_range: "450-800" })],
      sections: { misc: [blk("Digital Thermostat")] } }).itemList!;
    expect(tot(v)).toEqual([24920 + T[0], BOX_I + T[1]]);
    expect(notes(v)).toEqual([]);
    expect(v.items.map((b) => b.family)).toEqual(["VAV box"]);
  });
  it("T3: each sheet key removed -> the BoQ row equals the v76 config's row (byte for byte)", () => {
    const rows: Record<number, SheetRow> = {
      30: { text: "500 CFM", qty: 10, items: [boxItem({ integrator_included: "Yes" }), thermo()] },
      40: { text: "Digital thermostat", qty: 10, category: "hvac_sensors" },
      50: { text: "VAV Integrator", qty: 1, category: "hvac_misc" },
      272: { text: "Dismantling of Existing VAV", unit: "Sets", qty: 2, items: [boxItem(), thermo()] },
    };
    const off = vavFull(["own_row_check", "integrator_cabling", "existing_boxes", "combination_warning"]);
    for (const er of [30, 272]) {
      const bare = JSON.stringify(vavSheet(rows, { cfg: vavBare() })(er));
      expect(JSON.stringify(vavSheet(rows, { cfg: off })(er)).replace(/"qty_attr"/g, "")).toBe(bare.replace(/"qty_attr"/g, ""));
    }
    // and with the keys on, the same rows DO change (the test is not vacuous)
    expect(JSON.stringify(vavSheet(rows, { cfg: vavFull() })(30))).not.toBe(JSON.stringify(vavSheet(rows, { cfg: vavBare() })(30)));
    expect(JSON.stringify(vavSheet(rows, { cfg: vavFull() })(272))).not.toBe(JSON.stringify(vavSheet(rows, { cfg: vavBare() })(272)));
  });
});
