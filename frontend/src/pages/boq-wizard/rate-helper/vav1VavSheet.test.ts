/**
 * VAV-1 T10 / AC16 (owner 2026-11-19 03:01, verbatim: "we also need to test that pricing from calculator is same as that from sheet except
 * for the modifications we made") -- THE CALCULATOR = THE SHEET, EVERY LINE, on the newest HVAC asset.
 * "Sheet" = the 2 Nov workbook's VAV Box tab (86 lines) and, for the five borrowed items, its Misc and Sensors tabs -- the figures pinned
 * from the workbook at mint time (__fixtures__/vav1VavBoxTab.json), never typed. Each line is driven THE CALCULATOR'S WAY: VAV Box picked,
 * the family taken from the calculator's own "+ Add item" menu, then every field picked from the options that field offers (re-read after
 * each pick, as a person sees it) -- no item lookup; a borrowed item through its section's add button.
 *
 * Equal on every line EXCEPT the DECLARED MODIFICATIONS, each tied to its ruling:
 *  M1 whole-rupee rounding: a tab BoQ cell that is not a whole rupee (Excel float noise of x 1.4, e.g. 31009.999999999996) is the
 *     product's ROUNDUP(BCS x (1 + markup), 0) -- the rule of every HVAC sheet item (VAV-D0 D5: 26 cells); the 7 BCS float-noise cells are
 *     stored clean (15950.000000000002 -> 15950) and price the same.
 *  M2 the tab's "AHRI Certfied" is offered and loaded as "AHRI Certified" (VAV-1 brief B1 b).
 *  M3 the tab's Item text "Rectangular VAV/ CAV" / "Oval VAV/ CAV" is picked as Shape Rectangular / Oval (the item keeps the tab's text as
 *     its item name); the box family is "VAV box".
 *  M4 items NOT on the tab (the owner's new SKUs) compare with his ruled figures instead (vav1VavParity T1).
 * Any other difference is RED -- never an adjusted expectation.
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LATEST, TAB, TYPES, blk, calc, view, type TabLine } from "./vav1Vav.harness";

type Row = { sheet: string; row: number; fields: string; sheet_supply: number; sheet_install: number; calc_supply: number | null;
  calc_install: number | null; equal: "y" | "n"; modification: string };
const SHAPE: Record<string, string> = { "Rectangular VAV/ CAV": "Rectangular", "Oval VAV/ CAV": "Oval" };

/** pick a family from the calculator's menu, then each field from its own options; returns the picks and the priced view */
function drive(family: string, want: Record<string, string>) {
  const menu = (view(calc({ items: [] }))?.families ?? []).map((f) => f.family);
  if (!menu.includes(family)) throw new Error(`family '${family}' is not in the calculator's menu ${JSON.stringify(menu)}`);
  const picked: Record<string, string> = {};
  for (;;) {
    const fields = (view(calc({ items: [blk(family, picked)] }))?.items?.[0]?.fields ?? []).filter((f) => (f.options ?? []).length && !(f.skuAttr in picked));
    if (!fields.length) break;
    const f = fields[0];
    const v = want[f.skuAttr];
    if (v === undefined || !f.options!.includes(v)) throw new Error(`field ${f.skuAttr} offers ${JSON.stringify(f.options)}, not '${v}'`);
    picked[f.skuAttr] = v;
  }
  return { picked, v: view(calc({ items: [blk(family, picked)] })) };
}

export function compareTab(tab: TabLine[]): Row[] {
  return tab.map((r) => {
    const family = r.item === "VAV Integrator" ? "VAV Integrator" : "VAV box";
    const want: Record<string, string> = family === "VAV box" ? { shape: SHAPE[r.item], vav_type: TYPES[r.type], integrator_included: r.integrator, cfm_range: r.cfm }
      : { vav_type: TYPES[r.type] };
    const { picked, v } = drive(family, want);
    const cs = v?.totals?.supply_rate ?? null, ci = v?.totals?.install_rate ?? null;
    const exact = cs === r.boq_supply && ci === r.boq_install;
    const rounding = !exact && cs === Math.round(r.boq_supply) && ci === Math.round(r.boq_install)
      && Math.abs(cs! - r.boq_supply) < 1 && Math.abs(ci! - r.boq_install) < 1;
    const mods = [rounding ? "M1 rounding below one rupee" : "", r.type.includes("Certfied") ? "M2 'AHRI Certfied' -> 'AHRI Certified'" : "",
      family === "VAV box" ? "M3 Item text -> Shape" : "", (!Number.isInteger(r.bcs_supply) || !Number.isInteger(r.bcs_install)) ? "M1 BCS float noise stored clean" : ""]
      .filter(Boolean).join("; ");
    return { sheet: "VAV Box", row: r.row, fields: `${family}: ${JSON.stringify(picked)}`, sheet_supply: r.boq_supply, sheet_install: r.boq_install,
      calc_supply: cs, calc_install: ci, equal: exact || rounding ? "y" : "n", modification: mods || "none" };
  });
}

function compareBorrowed(): Row[] {
  const out: Row[] = [];
  const adds = (view(calc({ items: [] })) as unknown as { sections?: { adds?: Array<{ id: string; families: Array<{ family: string }> }> } })?.sections?.adds ?? [];
  const sheets: Array<[string, string, Record<string, Record<string, number | string>>, string]> = [
    ["misc", "Misc", TAB.misc, "Digital Thermostat"], ["misc", "Misc", TAB.misc, "Temperature Gauge / Thermometer"], ["misc", "Misc", TAB.misc, "Transformation Pieces"],
    ["sensors", "Sensors", TAB.sensors, "CO2 Sensor"], ["sensors", "Sensors", TAB.sensors, "Differential Pressure Switch"]];
  for (const [sec, sheet, src, fam] of sheets) {
    const button = adds.find((a) => a.id === sec);
    if (!button || !button.families.some((f) => f.family === fam)) throw new Error(`no '${fam}' under the ${sec} add button`);
    const v = view(calc({ items: [], sections: { [sec]: [blk(fam)] } }));
    const r = src[fam];
    const cs = v?.totals?.supply_rate ?? null, ci = v?.totals?.install_rate ?? null;
    const exact = cs === r.boq_supply && ci === r.boq_install;
    out.push({ sheet, row: Number(r.row), fields: `${sec} add button: ${fam}`, sheet_supply: Number(r.boq_supply), sheet_install: Number(r.boq_install),
      calc_supply: cs, calc_install: ci, equal: exact ? "y" : "n", modification: "none (borrowed live from its own tab's item)" });
  }
  return out;
}

describe(`VAV-1 T10 calculator = sheet on ${LATEST}`, () => {
  const rows = compareTab(TAB.vav_box_tab);
  const borrowed = compareBorrowed();
  if (process.env.VAV1_T10_OUT) writeFileSync(process.env.VAV1_T10_OUT, JSON.stringify([...rows, ...borrowed], null, 1));
  it("the 86 VAV Box tab lines: equal on every line; the only differences are M1 rounding below one rupee (26 lines)", () => {
    expect(rows.length).toBe(86);
    expect(rows.filter((r) => r.equal === "n").map((r) => `row ${r.row}: calc ${r.calc_supply} + ${r.calc_install} vs sheet ${r.sheet_supply} + ${r.sheet_install}`)).toEqual([]);
    expect(rows.filter((r) => r.modification.includes("M1 rounding")).length).toBe(26);
    expect(rows.filter((r) => r.modification.includes("float noise")).length).toBe(7);
    expect(rows.filter((r) => r.modification.includes("M2")).length).toBe(56);
  });
  it("the five borrowed items through the add buttons = their own Misc / Sensors tab lines, exactly", () => {
    expect(borrowed.map((r) => [r.fields, r.equal, r.calc_supply, r.calc_install])).toEqual([
      ["misc add button: Digital Thermostat", "y", 4200, 500], ["misc add button: Temperature Gauge / Thermometer", "y", 2175, 500],
      ["misc add button: Transformation Pieces", "y", 1280, 250], ["sensors add button: CO2 Sensor", "y", 11130, 900],
      ["sensors add button: Differential Pressure Switch", "y", 2170, 900]]);
  });
  it("NEGATIVE / VACUITY: one tab figure changed in a copy of the fixture -> that line is red", () => {
    const bad = structuredClone(TAB.vav_box_tab);
    bad[0] = { ...bad[0], boq_supply: bad[0].boq_supply + 10 };
    const r = compareTab(bad.slice(0, 2));
    expect(r.map((x) => x.equal)).toEqual(["n", "y"]);
    // and a sheet word the calculator does not offer is refused, never guessed
    expect(() => drive("VAV box", { shape: "Round", vav_type: "AHRI Certified", integrator_included: "Yes", cfm_range: "450-800" })).toThrow(/offers/);
  });
});
