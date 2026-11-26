/**
 * VAV-2b1 T2 (B5 / B6) and B7 -- the shared-item block in the Calculator (owner 18:39 / 18:41 "a" / 18:42 screen 7 / 18:44), the
 * Calculator = the row's entry point for the same inputs (parity, count asserted), the "Review before using" block (R11), the lower
 * airflow limit (R12) and the six integrator rows filed Misc (R13). Scratch configs only; the loaded config is never read for VAV-2b1 keys.
 */
import { describe, expect, it } from "vitest";
import { blk } from "./vav1Vav.harness";
import { REAL, box, calc79, itemsV79, real, sheet79, vav79 } from "./vav2b1.harness";
import { boxItem, vavSheet } from "./vav2a.harness";
import { applyShareEdit, type SharesEditState } from "./vavSheetShares";
import type { ItemListSuggestion } from "./pricingSheetHelper";

const BOX = blk("VAV box", { shape: "Rectangular", vav_type: "Nothing specific mentioned", integrator_included: "No", airflow_cfm: "650" });
const ST = { items: [BOX] };
const C4 = { items: [BOX], sections: { misc: [blk("Digital Thermostat")], sensors: [blk("CO2 Sensor")] } };
const blockOf = (s: ItemListSuggestion, id: string) => s.itemList!.shares!.blocks.find((b) => b.id === id)!;
const f = (s: ItemListSuggestion, id: string, field: string) => blockOf(s, id).fields.find((x) => x.id === field)!;
const tot = (s: ItemListSuggestion) => [s.itemList!.totals?.supply_rate ?? null, s.itemList!.totals?.install_rate ?? null];
const ed = (...ops: Parameters<typeof applyShareEdit>[1][]) => ops.reduce<SharesEditState>((a, op) => applyShareEdit(a, op), {});

describe("AC0 / T2 the Calculator: Add BACnet controller share, type 80 VAVs", () => {
  it("POSITIVE before any share: the three add buttons and no block; the per-box BACnet controller and the DP switch are offered by NO list", () => {
    const v = calc79(ST).itemList!;
    expect(v.shares!.blocks).toEqual([]);
    // PIN 18 (ANSWER 26 / 28; screen 7, owner 18:42): BEFORE ["Add DDC panel share", "Add BACnet controller share", "Add DP sensor share"] (the config order)
    expect(v.shares!.adds.map((a) => a.label)).toEqual(["Add BACnet controller share", "Add DP sensor share", "Add DDC panel share"]);
    expect((v.families ?? []).map((x) => x.family)).not.toContain("BACnet over IP controller");
    expect(v.sections!.adds.flatMap((a) => a.families.map((x) => x.family))).not.toContain("Differential Pressure Switch");
  });
  it("NEGATIVE (chat-Claude 19:40 (ii)): the same Calculator on the v78 config still offers both", () => {
    const v = calc79(ST, {}, vav79({ drop: ["withdrawn_families", "sheet_shares", "heading", "lower_limit", "serves_also", "zero_rows"] })).itemList!;
    expect((v.families ?? []).map((x) => x.family)).toContain("BACnet over IP controller");
    expect(v.sections!.adds.flatMap((a) => a.families.map((x) => x.family))).toContain("Differential Pressure Switch");
    expect(v.shares).toBeUndefined();
  });
  it("POSITIVE added, number of VAVs EMPTY -> the block prices nothing and the row total is the box alone", () => {
    const base = calc79(ST);
    const s = calc79(ST, ed({ op: "add", share: "bacnet" }));
    expect(f(s, "bacnet", "vavs")).toMatchObject({ value: "", source: "none" });
    expect(f(s, "bacnet", "controllers_per")).toMatchObject({ value: "32", source: "input" });
    expect(blockOf(s, "bacnet").figures).toBeNull();
    expect(blockOf(s, "bacnet").reason).toBe("Type the number of VAVs on the sheet to price this share.");
    expect(blockOf(s, "bacnet").tag).toBe("added by you");
    expect(tot(s)).toEqual(tot(base));
  });
  it("POSITIVE type 80 -> 32 and 3 pre-entered, '3 x (46,200 + 3,200) = 1,48,200 / 80 VAVs = 1,853 per box', the share in the row total", () => {
    const base = calc79(ST);
    const s = calc79(ST, ed({ op: "add", share: "bacnet" }, { op: "set", share: "bacnet", field: "vavs", value: "80" }));
    expect(f(s, "bacnet", "vavs")).toMatchObject({ value: "80", source: "typed", sourceLabel: "typed by you", edited: true });
    expect(f(s, "bacnet", "controllers_count")).toMatchObject({ value: "3", source: "worked_out" });
    expect(blockOf(s, "bacnet").sumLines).toEqual(["3 x (46,200 + 3,200) = 1,48,200 / 80 VAVs = 1,853 per box"]);
    expect(tot(s)).toEqual([tot(base)[0]! + 1733, tot(base)[1]! + 120]);
  });
  it("POSITIVE 80 -> 100: 4 controllers and the new share; a count changed by hand is KEPT and marked; revert puts each back", () => {
    let e = ed({ op: "add", share: "bacnet" }, { op: "set", share: "bacnet", field: "vavs", value: "100" });
    let s = calc79(ST, e);
    expect(f(s, "bacnet", "controllers_count").value).toBe("4");
    expect(blockOf(s, "bacnet").figures).toEqual({ supply_rate: 1848, install_rate: 128 });
    e = applyShareEdit(e, { op: "set", share: "bacnet", field: "controllers_count", value: "5" });
    s = calc79(ST, e);
    expect(f(s, "bacnet", "controllers_count")).toMatchObject({ value: "5", source: "changed", sourceLabel: "changed by you", edited: true });
    e = applyShareEdit(e, { op: "set", share: "bacnet", field: "vavs", value: "120" });
    expect(f(calc79(ST, e), "bacnet", "controllers_count").value).toBe("5");
    e = applyShareEdit(e, { op: "revert", share: "bacnet", field: "controllers_count" });
    expect(f(calc79(ST, e), "bacnet", "controllers_count")).toMatchObject({ value: "4", source: "worked_out", edited: false });
    e = applyShareEdit(e, { op: "set", share: "bacnet", field: "controllers_per", value: "40" });
    expect(f(calc79(ST, e), "bacnet", "controllers_per")).toMatchObject({ value: "40", source: "changed" });
    expect(f(calc79(ST, e), "bacnet", "controllers_count").value).toBe("3");
    e = applyShareEdit(e, { op: "revert", share: "bacnet", field: "controllers_per" });
    e = applyShareEdit(e, { op: "revert", share: "bacnet", field: "vavs" });
    expect(f(calc79(ST, e), "bacnet", "vavs")).toMatchObject({ value: "", edited: false });
  });
  it("POSITIVE 'Or type the amount' replaces the sum line with 'Amount typed by you'; a side left blank keeps the worked figure; revert", () => {
    let e = ed({ op: "add", share: "bacnet" }, { op: "set", share: "bacnet", field: "vavs", value: "80" }, { op: "amount", share: "bacnet", kind: "supply", value: "2000" });
    let b = blockOf(calc79(ST, e), "bacnet");
    expect(b.sumLines).toEqual(["Amount typed by you"]);
    expect(b.figures).toEqual({ supply_rate: 2000, install_rate: 120 });
    e = applyShareEdit(e, { op: "revert_amount", share: "bacnet" });
    b = blockOf(calc79(ST, e), "bacnet");
    expect(b.amountTyped).toBe(false);
    expect(b.figures).toEqual({ supply_rate: 1733, install_rate: 120 });
  });
  it("POSITIVE C7 'Add DP sensor share' with 80 -> 30 and 3, its sum; C8 'Add DDC panel share' -> panels 1, controllers 3, sensors 3, and the BACnet and DP shares LEAVE", () => {
    let e = ed({ op: "add", share: "bacnet" }, { op: "set", share: "bacnet", field: "vavs", value: "80" }, { op: "add", share: "dp" }, { op: "set", share: "dp", field: "vavs", value: "80" });
    let s = calc79(ST, e);
    expect([f(s, "dp", "sensors_per").value, f(s, "dp", "sensors_count").value]).toEqual(["30", "3"]);
    expect(blockOf(s, "dp").sumLines).toEqual(["3 x (10,710 + 900) = 34,830 / 80 VAVs = 436 per box"]);
    // each of supply and install rounded (P1 f, accepted 19:40): 32,130 / 80 = 401.6 -> 402; 2,700 / 80 = 33.75 -> 34 (chat-Claude's 14:35 example rounded the sum: 435)
    expect(blockOf(s, "dp").figures).toEqual({ supply_rate: 402, install_rate: 34 });
    e = applyShareEdit(e, { op: "add", share: "ddc" });
    e = applyShareEdit(e, { op: "set", share: "ddc", field: "vavs", value: "80" });
    s = calc79(ST, e);
    expect(s.itemList!.shares!.blocks.map((b) => b.id)).toEqual(["ddc"]);
    expect(["panels_count", "controllers_count", "sensors_count"].map((x) => f(s, "ddc", x).value)).toEqual(["1", "3", "3"]);
    expect(blockOf(s, "ddc").sumLines).toHaveLength(3);
    expect(s.itemList!.shares!.adds).toEqual([]);
    // remove the DDC share -> the BACnet and DP shares (still in the edits) come back
    s = calc79(ST, applyShareEdit(e, { op: "remove", share: "ddc" }));
    expect(s.itemList!.shares!.blocks.map((b) => b.id)).toEqual(["bacnet", "dp"]);
  });
});

describe("T2 PARITY: the Calculator and the BoQ row's entry point price a share through the SAME sums (count asserted)", () => {
  it.each([[1, "bacnet"], [33, "bacnet"], [80, "bacnet"], [31, "dp"], [80, "ddc_inclusive"], [201, "ddc_inclusive"]])("%i VAVs, %s", (v, reading) => {
    const id = reading === "ddc_inclusive" ? "ddc" : reading;
    const row = sheet79({ 10: box(v, reading === "dp" ? { dp: true } : { controller: reading }) })(10);
    const calc = calc79(ST, ed({ op: "add", share: id }, { op: "set", share: id, field: "vavs", value: String(v) }));
    const a = blockOf(row, id), b = blockOf(calc, id);
    expect(row.itemList!.shares!.blocks).toHaveLength(1);
    expect(calc.itemList!.shares!.blocks).toHaveLength(1);
    expect(b.figures).toEqual(a.figures);
    expect(b.sumLines).toEqual(a.sumLines);
    expect(b.fields.map((x) => [x.id, x.value])).toEqual(a.fields.map((x) => [x.id, x.value]));
  });
  it("on a BoQ row the number of VAVs is pre-filled from the sheet and a change affects that row only (18:41 'a', 18:44)", () => {
    const s = sheet79({ 10: box(30, { controller: "bacnet" }), 11: box(50, { controller: "bacnet" }) });
    const r10 = s(10, { __shares__: JSON.stringify(ed({ op: "set", share: "bacnet", field: "vavs", value: "100" })) });
    expect(f(r10, "bacnet", "vavs")).toMatchObject({ value: "100", source: "changed" });
    expect(f(s(11), "bacnet", "vavs")).toMatchObject({ value: "80", source: "sheet" });
  });
});

describe("T2 the v79 form of the three C4 cases (chat-Claude 19:51 (b)): box + thermostat + CO2 + the BACnet controller SHARE", () => {
  it("NEW figures: the box + thermostat + CO2 + share for 80 typed VAVs; the warning worked on them, shown as the 'Review before using' block", () => {
    const base = calc79(C4);
    const s = calc79(C4, ed({ op: "add", share: "bacnet" }, { op: "set", share: "bacnet", field: "vavs", value: "80" }));
    expect(tot(s)).toEqual([tot(base)[0]! + 1733, tot(base)[1]! + 120]);
    const box1 = s.itemList!.items[0].figures;
    const boxRate = (box1.supply_rate ?? 0) + (box1.install_rate ?? 0);
    const extras = tot(s)[0]! + tot(s)[1]! - boxRate;
    const over = extras > 0.5 * boxRate;
    expect(!!s.itemList!.combinationWarning).toBe(over);
    if (over) {
      expect(s.itemList!.reviewHeading).toBe("Review before using");
      expect(s.itemList!.combinationWarning).toMatch(/combines the box with 3 extras/);
    }
  });
  it("B6 the heading key absent -> the plain note as VAV-2a built it (no reviewHeading)", () => {
    const s = calc79({ items: [BOX], sections: { misc: [blk("Digital Thermostat"), blk("Digital Thermostat"), blk("Digital Thermostat")] } }, {},
      vav79({ drop: ["heading"] }));
    expect(s.itemList!.reviewHeading).toBeUndefined();
  });
});

describe("B7 / R12 A LOWER LIMIT ONLY: 'Above 3200 CFM' / '3700 CFM above' -> the band above, with its note and tag", () => {
  const bandOfRow = (airflow: string, over = {}) => {
    const v = sheet79({ 10: box(5, {}, { airflow_cfm: airflow, cfm_range: null as never, ...over }) })(10).itemList!;
    const fld = v.items[0].fields.find((x) => x.id === "cfm_range") as { value?: string; sourceTag?: string; note?: string } | undefined;
    return { band: fld?.value, tag: fld?.sourceTag, lines: fld?.note ?? "" };
  };
  it("POSITIVE 'Above 3200 CFM' -> 3200-4000; '3700 CFM above' -> the band above 3200-4000", () => {
    const a = bandOfRow("Above 3200 CFM");
    expect(a.band).toBe("3200-4000");
    expect(a.lines).toMatch(/The BoQ gives only a lower limit \("Above 3200 CFM"\): priced one band up, 3200-4000 \(the stated figure's band is 2100-3200\)/);
    expect(a.tag).toBe("BoQ gives only a lower limit");
    expect(bandOfRow("3700 CFM above").band).toBe("4000-8000");
  });
  it("NEGATIVE a plain figure and a range are never read as a lower limit; KEY ABSENT -> the stated figure's band (as v78)", () => {
    expect(bandOfRow("3200 CFM").band).toBe("2100-3200");
    expect(bandOfRow("Up to 650 CFM").band).toBe("450-800");
    const v = vavSheet({ 10: box(5, {}, { airflow_cfm: "Above 3200 CFM", cfm_range: null as never }) }, { cfg: vav79({ drop: ["lower_limit"] }), items: itemsV79() })(10).itemList!;
    expect(v.items[0].fields.find((x) => x.id === "cfm_range")?.value).toBe("2100-3200");
  });
});

describe("B7 / R13 THE SIX INTEGRATOR ROWS FILED MISC: the box prices on the 'Integrator No' line, the note names the row", () => {
  const SIX = REAL.filter((r) => r.kind.startsWith("integrator_r13")).map((r) => r.ref);
  it("the fixture holds exactly the six rows the owner ruled (14:10 '2 yes')", () => {
    expect(SIX.sort()).toEqual(["BOQ-26-00012 'HVAC - Low side' r256", "BOQ-26-00033 'VAV' r90", "BOQ-26-00071 'VAV WORKS' r49", "BOQ-26-00080 'HVAC ' r28",
      "BOQ-26-00140 'HVAC Lowside Works ' r289", "BOQ-26-00440 'VAV' r92"]);
  });
  it.each(SIX)("POSITIVE (the real row) %s: with a quantity -> the box on the 'No' line naming the row; with quantity 0 (00140 r289) -> rule 4 (owner 21:05 / ANSWER 16 rule 3): the box stays on 'Yes', with the quantity-0 note", (ref) => {
    const v = sheet79({ 10: box(5, {}, { integrator_included: "Yes" }), 50: real(ref) })(10).itemList!;
    const zero = !((real(ref).qty ?? 0) > 0);
    expect(v.items[0].fields.find((x) => x.id === "integrator_included")?.value).toBe(zero ? "Yes" : "No");
    expect((v.sheetHeadingNotes ?? []).join(" ")).toMatch(zero ? /VAV integrator row 50 has quantity 0, so this box is priced with the integrator included/
      : /The VAV integrator is priced on its own row of this sheet \(row 50\)/);
  });
  it("the quantities of the six real rows as the BoQs have them: 00140 r289 alone is 0", () => {
    expect(SIX.filter((ref) => !((real(ref).qty ?? 0) > 0))).toEqual(["BOQ-26-00140 'HVAC Lowside Works ' r289"]);
  });
  it.each(SIX)("NEGATIVE (vacuity, the real row) %s with `serves.also` absent -> the box stays on 'Integrator Yes' (what VAV-2a missed)", (ref) => {
    const v = vavSheet({ 10: box(5, {}, { integrator_included: "Yes" }), 50: real(ref) }, { cfg: vav79({ drop: ["serves_also"] }), items: itemsV79() })(10).itemList!;
    expect(v.items[0].fields.find((x) => x.id === "integrator_included")?.value).toBe("Yes");
  });
  it("NEGATIVE an integrator row on the sheet does NOT switch off the BACnet share (QR-D2, owner 19:46)", () => {
    for (const ref of ["BOQ-26-00080 'HVAC ' r28", "BOQ-26-00218 'HVAC-2F' r164", "BOQ-26-00012 'HVAC - Low side' r256"]) {
      const s = sheet79({ 10: box(80, { controller: "bacnet" }, { integrator_included: "Yes" }), 50: real(ref) })(10);
      expect(s.itemList!.shares!.blocks.map((b) => b.id), ref).toEqual(["bacnet"]);
    }
  });
  it("the controller rows the owner ruled (00:10 / 00:36) stay the controller's row: BOQ-26-00355 'VAV BOX' r47 (qty 1) -> nothing added; BOQ-26-00007 r385 has quantity 0 -> the share is added with the note (21:05 'a, yes')", () => {
    expect(sheet79({ 10: box(80, { controller: "bacnet" }), 50: real("BOQ-26-00355 'VAV BOX' r47") })(10).itemList!.shares!.blocks).toEqual([]);
    const s = sheet79({ 10: box(80, { controller: "bacnet" }), 50: real("BOQ-26-00007 'HVAC BOQ' r385") })(10);
    expect(s.itemList!.shares!.blocks.map((b) => [b.id, b.notes])).toEqual([["bacnet", ["Controller row 50 has quantity 0, so the BACnet controller share is added here. Remove it if the controller is ordered on that row."]]]);
  });
  // ANSWER 27 C (2) / (3) (chat-Claude 2026-11-21 00:37): what vav2a2Rules' re-pointed per-box-controller tests no longer prove on the
  // newest file, carried on v79 (the per-box controller is withdrawn; the SHARE is what the controller row decides now)
  it("C (2) BOQ-26-00355 r47 on v79: 'VAV BOX' (quantity 1) -> no share, the note names the row; 'HVAC -1 Flr' (the same words, quantity 0) -> the share + the quantity-0 note", () => {
    const r47 = real("BOQ-26-00355 'VAV BOX' r47");
    const one = sheet79({ 10: box(5, { controller: "bacnet" }), 50: { ...r47, qty: 1 } })(10);
    expect(one.itemList!.shares!.blocks).toEqual([]);
    expect(JSON.stringify(one.itemList)).toContain("BACnet controller share not added: the sheet prices it on its own row (row 50).");
    const zero = sheet79({ 10: box(5, { controller: "bacnet" }), 50: { ...r47, qty: 0 } })(10);
    expect(zero.itemList!.shares!.blocks.map((b) => [b.id, b.notes])).toEqual([["bacnet", ["Controller row 50 has quantity 0, so the BACnet controller share is added here. Remove it if the controller is ordered on that row."]]]);
    // VACUITY: no controller row on the sheet -> the share is added with NO row note (so the two results above come from row 47)
    const none = sheet79({ 10: box(5, { controller: "bacnet" }) })(10);
    expect(none.itemList!.shares!.blocks.map((b) => [b.id, b.notes])).toEqual([["bacnet", []]]);
  });
  it("C (3) a BOX row never counts as the controller's row on v79: 'Installation of VAV Units with BACnet controller' leaves the share on; the controller's own wording takes it off", () => {
    const boxLike = sheet79({ 10: box(10, { controller: "bacnet" }), 31: { ...box(10), text: "Installation of VAV Units with BACnet controller" } })(10);
    expect(boxLike.itemList!.shares!.blocks.map((b) => b.id)).toEqual(["bacnet"]);
    expect(JSON.stringify(boxLike.itemList)).not.toContain("prices it on its own row");
    // VACUITY: the same sheet with a controller row in its own words (filed Misc) -> no share, the note names it
    const ctl = sheet79({ 10: box(10, { controller: "bacnet" }), 31: { text: "BACnet over IP controller for the VAV boxes", qty: 1, category: "hvac_misc", unit: "Nos" } })(10);
    expect(ctl.itemList!.shares!.blocks).toEqual([]);
    expect(JSON.stringify(ctl.itemList)).toContain("(row 31)");
  });
  it("SCREEN 7 (owner 2026-11-20 18:42 'this is ok'; ANSWER 28): the Calculator's add buttons are EXACTLY the mockup's three, in its order", () => {
    // the mockup spec's line (input/VAV_Mockup_Screens_2026-11-19.md line 59), verbatim
    const SCREEN7 = `ADD buttons: "+ Add BACnet controller share", "+ Add DP sensor share", "+ Add DDC panel share".`;
    const want = [...SCREEN7.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(want).toHaveLength(3);
    const shown = calc79(ST).itemList!.shares!.adds.map((a) => `+ ${a.label}`);
    expect(shown).toEqual(want);
    // VACUITY: the config's list order used directly (the first-match order) is NOT the screen's -> a build that showed it would go red
    const spec = (vav79() as unknown as { list_spec: { pricing: { sheet_shares: { shares: Array<{ add_label: string }> } } } }).list_spec.pricing.sheet_shares;
    expect(spec.shares.map((s) => `+ ${s.add_label}`)).not.toEqual(want);
  });
  it("box item helper default reads as a counted box (sanity for the fixtures)", () => {
    expect(boxItem().vav_item).toBe("VAV box");
  });
});
