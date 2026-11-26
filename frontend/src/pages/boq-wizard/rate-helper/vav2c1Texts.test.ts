/**
 * VAV-2c1 T1: the owner's wordings on the screens -- R1 (the six sentences, 2026-11-22 13:01 "a"), R2 (a full-rate block with no VAVs prices
 * nothing and is an "item", 10:48), R4 (the two headings, 10:51 "all a"), R7 (three small wordings, 10:55). From the panel's entry point (a
 * BoQ row) and the Calculator's, positive AND negative, on the v81 file with v82's edits (vav2c1.harness).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCOPE_OVERRIDE_KEY, type ItemListView } from "./pricingSheetHelper";
import { rateShareWords, panelPickLead, pricingInputReading } from "./helperWording";
import { V81, VAV, calcOf, cfg82, items82 } from "./vav2c1.harness";
import { box81, sheet81, type Row81 } from "./vav2b2.harness";

const CFG = cfg82(VAV), ITEMS = items82();
const price = (rows: Record<number, Row81>, er: number, ov: Record<string, string> = {}, items = ITEMS, cfg = CFG): ItemListView =>
  sheet81(rows, { cfg, items })(er, ov).itemList!;
const notes = (v: ItemListView) => v.sheetHeadingNotes ?? [];
const thermostatRow = (qty: number | null, text = "Supply and installation of digital thermostat"): Row81 => ({ text, qty, unit: "Nos", category: "hvac_sensors" });
const boxWith = (qty: number | null, item: Record<string, unknown> = { _section: "misc", item: "Digital Thermostat" }, over: Record<string, string | number | null> = {}): Row81 => {
  const b = box81(qty, {}, over);
  return { ...b, items: [...b.items!, item as never] };
};
const MISC_FA = (V81.byId.get("hvac_misc") as unknown as { list_spec: { family_attribute_id: string } }).list_spec.family_attribute_id;
const THERMO = { _section: "misc", [MISC_FA]: "Digital Thermostat" };

describe("R1 the reworded sentences, as ruled, singular and plural", () => {
  it("1 not added: a separate thermostat row covering the boxes", () => {
    expect(notes(price({ 10: boxWith(10, THERMO), 40: thermostatRow(10) }, 10))).toContain(
      "Digital thermostat not added: row 40 prices it for this sheet's VAVs. Add it here only if that row does not cover these boxes.");
    expect(notes(price({ 10: boxWith(10, THERMO), 40: thermostatRow(5), 41: thermostatRow(5) }, 10))).toContain(
      "Digital thermostat not added: rows 40, 41 price it for this sheet's VAVs. Add it here only if those rows do not cover these boxes.");
  });
  it("2 rate only: the sheet's quantities are blank or 0", () => {
    expect(notes(price({ 10: boxWith(0, THERMO), 40: thermostatRow(0) }, 10)).join(" ")).toContain(
      "Digital thermostat not added: row 40 prices it. Quantities are blank or 0 on this sheet, so the separate row decides. Add it here only if that row does not cover these boxes.");
  });
  it("3 the integrator on its own row: priced without it", () => {
    const rows: Record<number, Row81> = { 10: box81(10, {}, { integrator_included: "Yes" }), 60: { text: "VAV integrator / router for BMS", qty: 2, unit: "Nos", category: "hvac_misc" } };
    expect(notes(price(rows, 10))).toContain("Priced without the integrator ('Integrator Included = No'): row 60 prices the VAV integrator for this sheet.");
    expect(notes(price({ ...rows, 61: { ...rows[60] } }, 10))).toContain("Priced without the integrator ('Integrator Included = No'): rows 60, 61 price the VAV integrator for this sheet.");
  });
  it("4 double counting: the separate row covers fewer units than the boxes need", () => {
    expect(notes(price({ 10: boxWith(10, THERMO), 40: thermostatRow(8) }, 10))).toContain(
      "Digital thermostat added. Row 40 also prices it, but for fewer units than this sheet's boxes need. Check for double counting and remove one if not needed.");
    expect(notes(price({ 10: boxWith(10, THERMO), 40: thermostatRow(4), 41: thermostatRow(4) }, 10)).join(" ")).toContain("Rows 40, 41 also price it, but");
  });
  it("6 the red bar of a row whose unit is a Lot", () => {
    const v = price({ 10: { ...box81(1), unit: "Lot" } }, 10);
    expect(v.unitBar?.title).toBe((CFG as unknown as { list_spec: { pricing: { lot_units: { bar: string } } } }).list_spec.pricing.lot_units.bar.replace("{UNIT}", "LOT"));
    expect(v.unitBar?.lines).toEqual(['Unit "Lot" is not a VAV unit: VAV items are priced per Nos. A Lot or a job is priced by hand.']);   // KEPT (7)
  });
  it("8 the pick's note, with ONE full stop after the helper's reason", () => {
    const v = price({ 10: box81(10) }, 10, { [SCOPE_OVERRIDE_KEY]: "Supply only" });
    expect(v.scope?.note).toBe("Scope changed by you. The helper had chosen Supply + installation. BoQ says supply only - no installation: install 0 on every line of this row.");
    const w = price({ 10: box81(10, {}, { scope: "Supply only" }) }, 10, { [SCOPE_OVERRIDE_KEY]: "Supply + installation" });
    expect(w.scope?.note).toBe("Scope changed by you. The helper had chosen Supply only because: BoQ says supply only - no installation: install 0 on every line of this row.");
    expect(panelPickLead("Scope changed by user (the helper chose {helper}{because})", "Supply only", " because: x.")).toBe("Scope changed by user (the helper chose Supply only because: x.)");
  });
  it("N1 the red bar names the row's own unit (Lot, Job, LS, Lumpsum)", () => {
    for (const [unit, shown] of [["Lot", "LOT"], ["Job", "JOB"], ["LS", "LS"], ["Lumpsum", "LUMPSUM"]]) {
      expect(price({ 10: { ...box81(1), unit } }, 10).unitBar?.title).toBe(`NOT PRICED: THE BoQ UNIT IS ${shown}. PRICE THIS ROW BY HAND.`);
    }
    expect(price({ 10: box81(1) }, 10).unitBar).toBeUndefined();   // NEGATIVE: a Nos row has no bar
  });
  it("N2 the threshold input not set -> the sentence without 'fewer units', and only then", () => {
    const rows = { 10: boxWith(10, THERMO), 40: thermostatRow(8) };
    expect(notes(price(rows, 10, {}, items82({ vav_own_row_threshold: null })))).toContain(
      "Digital thermostat added. Row 40 also prices it. Check for double counting and remove one if not needed. (The Pricing Input 'VAV - own-row threshold' is not set, so it was added.)");
    expect(notes(price(rows, 10)).join(" ")).toContain("but for fewer units than this sheet's boxes need");
  });
  it("N3 only SOME of the quantities compared are blank or 0 -> its own sentence; ALL of them -> the ruled one", () => {
    const some = "Digital thermostat not added: row 40 prices it. A quantity needed to compare is blank or 0, so the separate row decides. Add it here only if that row does not cover these boxes.";
    const all = "Digital thermostat not added: row 40 prices it. Quantities are blank or 0 on this sheet, so the separate row decides. Add it here only if that row does not cover these boxes.";
    expect(notes(price({ 10: boxWith(0, THERMO), 40: thermostatRow(10) }, 10))).toContain(some);       // the separate row's is filled
    expect(notes(price({ 10: boxWith(null, THERMO), 11: boxWith(5, THERMO), 40: thermostatRow(10) }, 10))).toContain(some);
    expect(notes(price({ 10: boxWith(null, THERMO), 40: thermostatRow(0) }, 10))).toContain(all);
    expect(notes(price({ 10: boxWith(0, THERMO), 11: boxWith(null, THERMO), 40: thermostatRow(null) }, 10))).toContain(all);
  });
  it("KEPT as they are: threshold missing, the cabling input missing, the box line under the bar", () => {
    const L = (CFG as unknown as { list_spec: { pricing: Record<string, { lines: Record<string, string> }> } }).list_spec.pricing;
    const O = (V81.byId.get(VAV) as unknown as { list_spec: { pricing: Record<string, { lines: Record<string, string> }> } }).list_spec.pricing;
    expect(L.own_row_check.lines.threshold_missing).toBe(O.own_row_check.lines.threshold_missing);
    expect(L.integrator_cabling.lines).toEqual(O.integrator_cabling.lines);
    expect(L.existing_boxes.lines.input_missing).toBe(O.existing_boxes.lines.input_missing);
  });
});

describe("R2 a full-rate block with 'Number of VAVs' empty", () => {
  const empty = (key: string) => calcOf(VAV, CFG, { state: { items: [] }, unit: "Nos", shares: { [key]: { added: true } } }, ITEMS)!;
  it("Calculator: BACnet and DDC price NOTHING until the number is typed, and say 'item'", () => {
    for (const key of ["bacnet_whole", "ddc_whole"]) {
      const v = empty(key), b = v.shares!.blocks.find((x) => x.id === key)!;
      expect([key, v.rowPriced, b.figures]).toEqual([key, false, null]);
      expect(b.reason).toBe("Type the number of VAVs on the sheet to price this item.");
    }
  });
  it("Calculator: typed -> priced; a typed count alone prices too", () => {
    const b = calcOf(VAV, CFG, { state: { items: [] }, unit: "Nos", shares: { bacnet_whole: { added: true, set: { vavs: "96" } } } }, ITEMS)!;
    expect(b.totals).toMatchObject({ supply_rate: 138600, install_rate: 9600 });
    const c = calcOf(VAV, CFG, { state: { items: [] }, unit: "Nos", shares: { bacnet_whole: { added: true, set: { controllers_count: "1" } } } }, ITEMS)!;
    expect(c.totals).toMatchObject({ supply_rate: 46200, install_rate: 3200 });
  });
  it("panel: a claimed controller row on a sheet whose VAVs have no quantity prices nothing; with quantities it is pre-filled", () => {
    const claim: Row81 = { text: "BACnet controller for VAV", qty: 1, unit: "Nos", category: "hvac_misc", claim: { from: "hvac_misc", item: "BACnet controller", kind: "bacnet" } };
    const none = price({ 10: box81(null), 40: claim }, 40);
    expect(none.shares!.blocks[0]).toMatchObject({ id: "bacnet_whole", figures: null, reason: "Type the number of VAVs on the sheet to price this item." });
    expect(none.rowPriced).toBe(false);
    const some = price({ 10: box81(40), 40: claim }, 40);
    expect(some.shares!.blocks[0].figures).toEqual({ supply_rate: 92400, install_rate: 6400 });
  });
  it("NEGATIVE: a real SHARE keeps the word", () => {
    const v = calcOf(VAV, CFG, { state: { items: [] }, unit: "Nos", shares: { bacnet: { added: true } } }, ITEMS)!;
    expect(v.shares!.blocks[0].reason).toBe("Type the number of VAVs on the sheet to price this share.");
  });
});

describe("R4 the headings", () => {
  const rows = (kind: string, item: string): Record<number, Row81> => ({ 10: box81(45), 40: { text: "x", qty: 2, unit: "Set", category: "hvac_misc", claim: { from: "hvac_misc", item, kind } } });
  it("4.1 a claimed row's item says 'matched by the helper' (own and borrowed); a VAV-filed row's stays 'identified by model'", () => {
    const own = price(rows("integrator", "VAV integrator"), 40);
    expect(own.items.map((b) => [b.source, b.matchedByHelper])).toEqual([["model", true]]);
    const borrowed = price(rows("dp", "DP sensor"), 40);
    expect(borrowed.sections!.independent.flatMap((s) => s.view.items).map((b) => b.matchedByHelper)).toEqual([true]);
    expect(price({ 10: box81(45) }, 10).items.map((b) => b.matchedByHelper)).toEqual([undefined]);
    const src = readFileSync(new URL("./RateHelperPanel.tsx", import.meta.url), "utf8");
    expect(src).toContain('{b.matchedByHelper ? <span data-testid="item-matched-heading">matched by the helper</span> : b.source === "model" ? "identified by model" :');
  });
  it("4.3 a separate controller / DDC panel row: 'VAVs served by one unit', its working line kept; the Calculator and a box row keep theirs", () => {
    const v = price(rows("ddc", "DDC panel"), 40);
    expect(v.shares!.blocks[0].fields[0]).toMatchObject({ id: "vavs", label: "VAVs served by one unit", value: "23" });
    expect(v.shares!.blocks[0].sumLines[0]).toBe("45 VAVs on the sheet / 2 panels on this row = 23 per panel");
    expect(calcOf(VAV, CFG, { state: { items: [] }, unit: "Nos", shares: { ddc_whole: { added: true } } }, ITEMS)!.shares!.blocks[0].fields[0].label).toBe("Number of VAVs");
    expect(price({ 10: box81(45, { controller: "bacnet" }) }, 10).shares!.blocks[0].fields[0].label).toBe("Number of VAVs on the sheet");
  });
});

describe("R7 the three small wordings", () => {
  const integ: Row81 = { text: "VAV integrator for BMS", qty: 1, unit: "Nos", category: "hvac_misc" };
  const cable = (qty: number | null): Row81 => ({ text: "Communication cable for VAV integrator", qty, unit: "Rmt", category: "hvac_cables" });
  it("6.2 cabling added because its row has 0 metres: the ITEM says what the note says", () => {
    const v = price({ 10: box81(10), 60: integ, 70: cable(0) }, 10);
    const item = v.items.find((b) => b.family === "Integrator cabling")!;
    expect(item.helperLine).toBe("Integrator cabling row 70 has 0 metres, so the integrator cabling is added here (2 m per box). Remove it if the cabling is ordered on that row.");
    expect(notes(v)).toContain(item.helperLine);
    // NEGATIVE: no cabling row at all -> the old line
    expect(price({ 10: box81(10), 60: integ }, 10).items.find((b) => b.family === "Integrator cabling")!.helperLine).toMatch(/no separate integrator cabling row naming VAV found on this sheet/);
  });
  it("6.3 the Pricing Input's name, in the working line that names it", () => {
    const rows: Record<number, Row81> = { 10: { ...box81(4), text: "Dismantling of existing VAV boxes" }, 11: { ...box81(4), text: "Refixing of existing VAV boxes" } };
    const v = price(rows, 11);
    expect(JSON.stringify(v.items)).toContain("VAV - refixing when dismantling is priced separately");
    expect(notes(v)).toContain("Dismantling is priced on row 10, so refixing alone is priced at half the installation rate (x 0.5).");
    // 6.4 the words follow the LIVE value
    const w = price(rows, 11, {}, items82({ vav_existing_refix_with_dismantling: 0.4 }));
    expect(notes(w)).toContain("Dismantling is priced on row 10, so refixing alone is priced at 40% of the installation rate (x 0.4).");
  });
  it("the words of every value", () => {
    expect([0.5, 1, 0.4, 1.5, null].map((f) => rateShareWords(f))).toEqual(["half the installation rate", "the installation rate", "40% of the installation rate", "1.5 times the installation rate", "-"]);
  });
});

describe("R6 b / T3 the plain reading of a Pricing Input follows its value", () => {
  it("a share -> a percentage; a multiple of the installation rate -> words; a plain unit -> nothing", () => {
    expect([0.25, 0.3, 0, 1 / 3].map((v) => pricingInputReading("share of the box's own rate", v))).toEqual(["25%", "30%", "0%", "33.333333%"]);
    expect([0.5, 1.5, 1].map((v) => pricingInputReading("x the installation rate", v))).toEqual(["x 0.5 = half the installation rate", "x 1.5 = 1.5 times the installation rate", "x 1 = the installation rate"]);
    expect(["mm", "Rs per sq.m", "factor", "VAV boxes per DDC panel", null].map((u) => pricingInputReading(u, 2))).toEqual([null, null, null, null, null]);
    expect(pricingInputReading("share of x", "abc")).toBeNull();
  });
  it("GUARD: no HVAC Pricing Input text carries a figure tied to a value; RED on the 8 old unit texts", () => {
    const example = /\(0(\.\d+)? = \d+%\)/;
    const pis = (its: typeof ITEMS) => its.filter((i) => /_pricing_input$/.test(String(i.kind)));
    expect(pis(ITEMS).length).toBe(78);
    expect(pis(ITEMS).filter((i) => example.test(String(i.unit)) || /\b(today|lowered to|owner|\d{4}-\d\d-\d\d)\b/i.test(String(i.attributes?.remarks))).map((i) => i.attributes?.item)).toEqual([]);
    expect(pis(V81.items).filter((i) => example.test(String(i.unit))).length).toBe(8);   // the vacuity half: v81 is red
  });
  it("no remark repeats its own value (a figure beside its unit word)", () => {
    const bad = ITEMS.filter((i) => /_pricing_input$/.test(String(i.kind))).filter((i) => {
      const v = Number(Object.values(i.rates as Record<string, number>)[0]);
      return v !== 1 && new RegExp(`(?<![\\d.^])${String(v).replace(".", "\\.")}(?![\\d.])(?!G )`).test(String(i.attributes?.remarks));
    });
    expect(bad.map((i) => [i.attributes?.item, i.attributes?.remarks])).toEqual([]);
  });
  it("the readings on screen: the grid and the impact panel, HVAC's category only", () => {
    const grid = readFileSync(new URL("../../pricing/rate-master/RateMasterDataViewer.tsx", import.meta.url), "utf8");
    expect(grid).toContain("const liveReading = piMode && config?.live_reading === true;");
    expect(grid).toContain("const reading = liveReading ? pricingInputReading(unitOf(r.it), shown) : null;");
    expect(readFileSync(new URL("../../pricing/rate-master/RateMasterPage.tsx", import.meta.url), "utf8")).toContain("liveReading={config?.live_reading === true}");
    expect((cfg82("hvac_pricing_inputs") as { live_reading?: boolean }).live_reading).toBe(true);
    expect((V81.byId.get("hvac_pricing_inputs") as { live_reading?: boolean }).live_reading).toBeUndefined();
  });
});
