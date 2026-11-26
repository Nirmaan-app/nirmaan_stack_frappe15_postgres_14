/**
 * VAV-2b1 RULE 4 (owner 2026-11-20 21:05 "a, yes" / "same shold apply to all extras"; 21:47 "a" on the 100 rows) -- an extra's own row with
 * quantity 0 / blank, on a sheet whose VAV rows carry a quantity, does NOT count as charged separately: the per-box extra stays (added)
 * with the quantity-0 note; the integrator cabling is added when EVERY cabling row is 0 / blank metres; the integrator's own row with
 * quantity 0 leaves the box on "Integrator Included = Yes". The other side (VAV rows blank / 0) is unchanged (19 Nov 01:23). Real rows of
 * the 84 sheets as fixtures; scratch configs; KEY ABSENT (`zero_rows` removed) = VAV-2a's result (vacuity).
 */
import { describe, expect, it } from "vitest";
import { box, itemsV79, other, real, sheet79, vav79 } from "./vav2b1.harness";
import { vavSheet, type SheetRow } from "./vav2a.harness";
import type { ItemListSuggestion } from "./pricingSheetHelper";

const notes = (s: ItemListSuggestion) => s.itemList?.sheetHeadingNotes ?? [];
const sec = (s: ItemListSuggestion) => [...(s.itemList?.items ?? []).flatMap((b) => (b.sections ?? []).map((x) => x.view.items.map((i) => i.family))).flat(),
  ...(s.itemList?.sections?.independent ?? []).flatMap((x) => x.view.items.map((i) => i.family))];
const fams = (s: ItemListSuggestion) => (s.itemList?.items ?? []).map((b) => b.family);
const off = { drop: ["zero_rows"] as Array<"zero_rows"> };
const THERMO = (qty: number | null) => ({ qty, items: [{ ...box(qty).items![0] }, { _section: "misc", item: "Digital Thermostat", item_as_written: "thermostat", qty_per_box: "None", scope: "None" }] }) as SheetRow;
const v78like = (rows: Record<number, SheetRow>) => vavSheet(rows, { cfg: vav79(off), items: itemsV79() });

describe("rule 4: a per-box extra whose own row has quantity 0 (real row BOQ-26-00049 'Fitout HVAC' r180 'SITC OF DIGITAL Thermostat connect to shared vav', qty 0)", () => {
  it("POSITIVE the box rows carry quantities -> the Digital thermostat stays on the box row, with the quantity-0 note naming row 180", () => {
    const s = sheet79({ 158: THERMO(4), 180: real("BOQ-26-00049 'Fitout HVAC' r180") })(158);
    expect(sec(s)).toContain("Digital Thermostat");
    expect(notes(s)).toContain("Digital thermostat row 180 has quantity 0, so the digital thermostat is added here. Remove it if the digital thermostat is ordered on that row.");
  });
  it("NEGATIVE (vacuity) `zero_rows` absent -> not added, the rate-only line (VAV-2a 19 Nov 01:23)", () => {
    const s = v78like({ 158: THERMO(4), 180: real("BOQ-26-00049 'Fitout HVAC' r180") })(158);
    expect(sec(s)).not.toContain("Digital Thermostat");
    expect(notes(s).join(" ")).toMatch(/Digital thermostat is priced on its own row of this sheet \(row 180\) - not added to this row \(the quantities are blank or 0/);
  });
  it("UNCHANGED the other side: the box rows blank / 0 -> the separate row decides, not added (with or without the key)", () => {
    for (const run of [sheet79, v78like]) {
      const s = run({ 158: THERMO(null), 180: real("BOQ-26-00049 'Fitout HVAC' r180") })(158);
      expect(sec(s)).not.toContain("Digital Thermostat");
    }
  });
  it("UNCHANGED an own row WITH a quantity keeps VAV-2a's 90% test (4 of 4 boxes covered -> not added)", () => {
    const s = sheet79({ 158: THERMO(4), 180: { ...real("BOQ-26-00049 'Fitout HVAC' r180"), qty: 4 } })(158);
    expect(sec(s)).not.toContain("Digital Thermostat");
    expect(notes(s).join(" ")).not.toMatch(/has quantity 0/);
  });
});

describe("rule 4: the integrator cabling when every cabling row has 0 / blank metres (real row BOQ-26-00007 'HVAC BOQ' r386, qty 0, under 'SECTION B - VAV BOXES')", () => {
  const SHEET = (cab: SheetRow) => ({ 5: { node: "Preamble", text: "SECTION 'B' - VAV BOXES", category: "" } as SheetRow, 339: { ...box(9), parent: 5 } as SheetRow,
    380: { ...other("Supply, installation and testing of VAV integrator for BMS connectivity", 1), parent: 5 } as SheetRow, 386: { ...cab, parent: 5 } as SheetRow });
  it("POSITIVE -> the integrator cabling is added at 2 m per box, with the note naming row 386", () => {
    const s = sheet79(SHEET(real("BOQ-26-00007 'HVAC BOQ' r386")))(339);
    expect(fams(s)).toContain("Integrator cabling");
    expect(notes(s)).toContain("Integrator cabling row 386 has 0 metres, so the integrator cabling is added here (2 m per box). Remove it if the cabling is ordered on that row.");
  });
  it("NEGATIVE (vacuity) `zero_rows` absent -> not added ('priced on its own row'), as VAV-2a built it", () => {
    const s = v78like(SHEET(real("BOQ-26-00007 'HVAC BOQ' r386")))(339);
    expect(fams(s)).not.toContain("Integrator cabling");
  });
  it("UNCHANGED a cabling row WITH metres -> not added (the 19 Nov rule; the 70% line when low)", () => {
    const s = sheet79(SHEET({ ...real("BOQ-26-00007 'HVAC BOQ' r386"), qty: 120 }))(339);
    expect(fams(s)).not.toContain("Integrator cabling");
    expect(notes(s).join(" ")).not.toMatch(/0 metres/);
  });
});

describe("rule 4: the integrator's own row with quantity 0 (real row BOQ-26-00140 r289 'Network controller or Router', qty 0)", () => {
  it("POSITIVE the box that says 'integrator included' STAYS on the Yes line, with the note; NEGATIVE (vacuity) key absent -> the No line", () => {
    const rows = { 237: box(4, {}, { integrator_included: "Yes" }), 289: real("BOQ-26-00140 'HVAC Lowside Works ' r289") };
    expect(real("BOQ-26-00140 'HVAC Lowside Works ' r289").qty).toBe(0);
    const s = sheet79(rows)(237);
    expect(s.itemList!.items[0].fields.find((f) => f.id === "integrator_included")?.value).toBe("Yes");
    expect(notes(s)).toContain("VAV integrator row 289 has quantity 0, so this box is priced with the integrator included, as its own words say. Change it to No if the integrator is ordered on that row.");
    expect(v78like(rows)(237).itemList!.items[0].fields.find((f) => f.id === "integrator_included")?.value).toBe("No");
  });
});
