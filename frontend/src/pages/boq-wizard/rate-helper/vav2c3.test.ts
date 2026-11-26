/**
 * VAV-2c3 -- T1 (R6: the amber "written by hand for a test" line removed) and T2 (R5 F1 - F4, the texts exact), each positive AND negative,
 * on scratch copies of the v83 FILE with the v84 edits (vav2c3.harness). T3 (v84 = v83 + the edits file) is vav2c3V84.test.ts, after the mint.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig } from "../../pricing/rate-master/rateMasterTypes";
import { itemListRuleOrder } from "../../pricing/rate-master/itemListRuleOrder";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, SCOPE_OVERRIDE_KEY, makePricingSheetHelper, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { surfaceMap } from "./vav1Vav.harness";
import { box81, sheet81, type Row81 } from "./vav2b2.harness";
import { panelPickLead } from "./helperWording";
import { INSTALL_ROW_TEXT_PATHS, installRowSpec } from "./scopeRule";
import { EDITS84, ITEMS83, V83, byId84, cfg84 } from "./vav2c3.harness";

const VAV = "hvac_vav_box";
const C84 = cfg84(VAV);
const BOX = { base: null, family: "VAV box", attrs: { shape: "Rectangular", vav_type: "Nothing specific mentioned", integrator_included: "No", airflow_cfm: "700" } };
const INSTALL_TEXT = "Installation, configuration and commissioning of VAV Units with thermostat, Including supply & laying control wiring";
type Json = Record<string, unknown>;

/** the Calculator's own construction on the v84 (or v83: `v83`) configs */
function calc(cat: string, scope: string | undefined, v83 = false): ItemListView {
  const h = makePricingSheetHelper({ configsByCategory: surfaceMap([], v83 ? V83.byId : byId84()), items: ITEMS83, extractionByRow: new Map() });
  return (h.compute(calculatorCtx("HVAC", cat), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [BOX] }), [ROW_UNIT_OVERRIDE_KEY]: "Nos",
    ...(scope ? { [SCOPE_OVERRIDE_KEY]: scope } : {}) }) as unknown as ItemListSuggestion).itemList!;
}
/** a sheet: box rows 10 / 11 (quantities 9 / 8), an installation row 20 (17 units), plus `more` */
function sheet(more: Record<number, Row81> = {}): Record<number, Row81> {
  return { 1: { node: "Preamble", text: "VAV SYSTEM" } as never, 10: { ...box81(9), parent: 1 } as never, 11: { ...box81(8), parent: 1 } as never,
    20: { qty: 17, text: INSTALL_TEXT, category: VAV, parent: 1,
      items: [{ vav_item: "VAV box", vav_item_as_written: "VAV Units", shape: "None", vav_type: "Nothing specific mentioned", integrator_included: "No", airflow_cfm: "None",
        inlet_size: "None", qty_per_box: "None", scope: "Installation only", controller_mention: "none", controller_by_others: "No", dp_sensor_mention: "No" }] } as never,
    ...more };
}
const at = (rows: Record<number, Row81>, er: number, cfg: RateCategoryConfig = C84): ItemListView => sheet81(rows, { cfg, items: ITEMS83 })(er).itemList!;
const notesOf = (v: ItemListView) => v.sheetHeadingNotes ?? [];
const INTEG: Row81 = { text: "VAV integrator for BMS", qty: 1, unit: "Nos", category: "hvac_misc", parent: 1 } as never;
const CABLE: Row81 = { text: "Communication cable for VAV integrator", qty: 200, unit: "Rmt", category: "hvac_cables", parent: 1 } as never;

describe("T1 R6 (owner 2026-11-21 15:56 '3b'): the amber 'written by hand for a test' line is gone", () => {
  const rows = { 10: box81(9) };
  it("a real run's row shows no test-run line", () => {
    const v = sheet81(rows, { cfg: C84, items: ITEMS83, runId: "a1b2c3d4e5f6" })(10);
    expect((v.itemList as unknown as Json).testRunLine).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain("written by hand for a test");
  });
  it("NEGATIVE (fixture): even a run whose id is one of VAV-2b2's hand-written test runs shows no line any more", () => {
    const v = sheet81(rows, { cfg: C84, items: ITEMS83, runId: "STUB-VAV-2b2-BOQ-26-00313-06" })(10);
    expect((v.itemList as unknown as Json).testRunLine).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain("written by hand for a test");
  });
  it("the code is removed outright: the module is gone and the panel draws no test-run box", () => {
    expect(existsSync(new URL("./stubRunMark.ts", import.meta.url))).toBe(false);
    const panel = readFileSync(new URL("./RateHelperPanel.tsx", import.meta.url), "utf8");
    expect(panel).not.toContain("item-test-run-line");
    expect(panel).not.toContain("testRunLine");
    expect(readFileSync(new URL("./pricingSheetHelper.ts", import.meta.url), "utf8")).not.toMatch(/stubRunLineOf|STUB-VAV-2b2-/);
  });
});

describe("T2 R5 F1 (owner 2026-11-24 10:36 '1 fix in next slice'): the VAV Box rules page describes the scope rule as built", () => {
  const TITLE = "The BoQ scope: supply + installation unless a case below is found";
  const line = (cfg: unknown) => itemListRuleOrder(cfg, ITEMS83).find((l) => l.title === TITLE || l.title === "The BoQ scope: supply + installation unless the row says otherwise");
  it("the line, in the owner's words with their dates", () => {
    const l = line(C84)!;
    expect(l.title).toBe(TITLE);
    const d = String(l.detail);
    expect(d.startsWith('every row is priced supply + installation unless one of the cases below is positively found (owner, 23 November 2026: "all rows are by default supply + installation"); ')).toBe(true);
    expect(d).toContain("supply and installation of the boxes on separate rows of the sheet: the box rows are priced supply only and the installation row installation only, but only when it is sure that the installation row covers those boxes - its quantity is at least the share of the box rows' quantity set in the Pricing Input");
    expect(d).toMatch(/, 90% today \(owner, 23 November 2026\); /);
    expect(d).toContain("in doubt, the box rows stay supply + installation and the installation row is still priced, installation only, with a note on both rows (owner, 24 November 2026)");
    expect(d).toContain('the installation row carries the installation of every per-unit component of the boxes it covers - the box, its extras and its shares (owner, 24 November 2026: "all components price move together")');
    expect(d).toContain("existing material being installed, removal and refixing, or supply by others -> installation only (owner, 23 November 2026)");
    expect(d).toContain("the words 'supply only' alone do not make a row supply only - it stays supply + installation, with a note (owner, 24 November 2026)");
    expect(d).toContain("an item that does not need installing, as the AI reads it from the row (attic stock mentioned explicitly included) -> supply only, with the AI's reason in the note (owner, 23 and 24 November 2026)");
    expect(d).toContain("the panel's scope pick ('Supply + installation', 'Supply only', 'Installation only') re-prices the row and the note says the user changed it");
    // the reason the rules page appends (derivation_reasons "^The BoQ scope"): a date, no bare time (v84 text)
    expect(d).toContain("why: installation only -> the installation rate only (owner agreed, 18 November 2026); the Pricing Input 'VAV - installation-only uplift' is 0, so no uplift");
    // no option letters, no codes, no bare times
    expect(d).not.toMatch(/\b\d{1,2}:\d{2}\b|\b(?:QR|R|F|AC)-?\d|\(\s*[a-h]\s*\)|\bnote [A-H]\b/);
    // the OLD logic is gone from this page
    expect(d).not.toContain("unless the BoQ says supply only or installation only");
    expect(d).not.toContain("only when the sheet quotes no supply row of the same item");
  });
  it("NEGATIVE / VACUITY: a config whose scope carries no rule keeps the older line (the rule is what selects the new one)", () => {
    const c = structuredClone(C84) as unknown as { list_spec: { pricing: { scope: Json } } };
    delete c.list_spec.pricing.scope.rule;
    const l = line(c)!;
    expect(l.title).toBe("The BoQ scope: supply + installation unless the row says otherwise");
    expect(String(l.detail)).toContain("unless the BoQ says supply only or installation only");
  });
});

describe("T2 R5 F2: the user-pick note on Ducting, Valve Package and VRF reads as VAV Box's", () => {
  const NOTE = "Scope changed by you. The helper had chosen {helper}.";
  const pick = (c: RateCategoryConfig): string => {
    const pr = (c as unknown as { list_spec: { pricing: Json } }).list_spec.pricing as { scope?: { panel_pick?: { note: string } }; extras?: { scope?: { panel_pick?: { note: string } } } };
    return (pr.scope?.panel_pick ?? pr.extras?.scope?.panel_pick)!.note;
  };
  it("all four categories: the same note; filled in, it names the helper's scope with one full stop", () => {
    for (const cat of ["hvac_ducting", "hvac_valve_package", "hvac_vrf", VAV]) expect(pick(cfg84(cat)), cat).toBe(NOTE);
    expect(panelPickLead(pick(cfg84("hvac_ducting")), "Supply + installation", " because: Installation is quoted on its own row.")).toBe("Scope changed by you. The helper had chosen Supply + installation.");
  });
  it("NEGATIVE: v83 still says 'Scope changed by user (the helper chose ...)' on the three", () => {
    for (const cat of ["hvac_ducting", "hvac_valve_package", "hvac_vrf"]) expect(pick(V83.byId.get(cat)!), cat).toBe("Scope changed by user (the helper chose {helper}{because})");
  });
  it("on a VRF BoQ row the user re-scoped, the note on screen leads with the new wording", () => {
    const vrfPick = pick(cfg84("hvac_vrf"));
    expect(panelPickLead(vrfPick, "Installation only", " because: the BoQ says installation only.")).toBe("Scope changed by you. The helper had chosen Installation only.");
  });
});

describe("T2 R5 F3: the VAV Box Calculator under Supply only says it once -- by the Scope box line", () => {
  it("v84: no scope note under the box; the box line says it; the figures are v83's", () => {
    const v = calc(VAV, "Supply only"), w = calc(VAV, "Supply only", true);
    expect(v.rowPriced).toBe(true);
    expect(v.scope?.note ?? "").toBe("");
    expect(v.scope?.picker?.value).toBe("Supply only");
    expect(v.totals).toEqual(w.totals);
    expect(v.totals?.install_rate).toBe(0);
  });
  it("NEGATIVE / VACUITY: v83 (no switch) shows the note line too", () => {
    expect(calc(VAV, "Supply only", true).scope?.note).toBe("Supply only: install 0 on every line of this row.");
    expect(calc(VAV, "Supply only", false).scope?.note ?? "").not.toContain("install 0 on every line");
  });
  it("NEGATIVE: only VAV Box -- Ducting / Valve Package / VRF Calculators keep their Supply-only note (R12)", () => {
    for (const cat of ["hvac_ducting", "hvac_valve_package", "hvac_vrf"]) {
      const pr = (cfg84(cat) as unknown as { list_spec: { pricing: { scope?: Json; extras?: { scope?: Json } } } }).list_spec.pricing;
      expect(pr.scope ?? pr.extras?.scope, cat).toBeTruthy();
      expect(pr.scope ?? pr.extras?.scope, cat).not.toHaveProperty("calculator_scope_box_only");
    }
  });
  it("NEGATIVE: Installation only and Supply + installation in the VAV Box Calculator are as on v83", () => {
    for (const s of ["Installation only", "Supply + installation"]) expect(calc(VAV, s)).toEqual(calc(VAV, s, true));
  });
  it("NEGATIVE: a BoQ row the USER sets to Supply only keeps its note (the switch is the Calculator's only)", () => {
    const n = sheet81({ 10: box81(17, {}, { scope: "Supply + installation" }) }, { cfg: C84, items: ITEMS83 })(10, { [SCOPE_OVERRIDE_KEY]: "Supply only" }).itemList!.scope?.note;
    expect(n).toBe("Scope changed by you. The helper had chosen Supply + installation. Supply only: install 0 on every line of this row.");
  });
});

describe("T2 R5 F4: an INSTALLATION row's notes are worded for an installation row", () => {
  const T = (C84 as unknown as { list_spec: { pricing: { scope: { rule: { install_row_texts: Record<string, string> } } } } }).list_spec.pricing.scope.rule.install_row_texts;
  it("the declared texts: exactly the four paths, each exact", () => {
    expect(Object.keys(T).sort()).toEqual([...INSTALL_ROW_TEXT_PATHS].sort());
    expect(T["sheet_shares.lines.blank_rows"]).toBe("{n} VAV box rows on this sheet have no quantity, so they are not counted in the number of VAVs the shared items are divided by.");
    expect(T["integrator_cabling.lines.priced_separately"]).toBe("Integrator cabling not added: {rows} {prices} it for this sheet's VAVs. Add it here only if {that_row} {does} not cover the VAVs this row installs.");
    expect(T["sheet_shares.labels.per_box"]).toBe(" per VAV installed");
    expect(T["sheet_shares.labels.typed"]).toBe("Or type the amount (per VAV installed)");
  });
  it("the integrator cabling a separate row prices: the installation row says 'the VAVs this row installs'; the box row keeps 'these boxes'", () => {
    const rows = sheet({ 60: INTEG, 70: CABLE });
    const inst = notesOf(at(rows, 20)), box = notesOf(at(rows, 10));
    expect(inst).toContain("Integrator cabling not added: row 70 prices it for this sheet's VAVs. Add it here only if that row does not cover the VAVs this row installs.");
    expect(inst.join(" ")).not.toContain("cover these boxes");
    expect(box).toContain("Integrator cabling not added: row 70 prices it for this sheet's VAVs. Add it here only if that row does not cover these boxes.");
    // VACUITY: on v83 the installation row carried the box row's wording
    expect(notesOf(at(rows, 20, V83.byId.get(VAV)!))).toContain("Integrator cabling not added: row 70 prices it for this sheet's VAVs. Add it here only if that row does not cover these boxes.");
  });
  it("the share block on an installation row: 'per VAV installed'; on a box row 'per box' as before; the figures equal v83's", () => {
    const rows = sheet();
    for (const r of [10, 11]) rows[r] = { ...box81(r === 10 ? 9 : 8, { controller: "bacnet" }), parent: 1 } as never;
    const inst = at(rows, 20), inst83 = at(rows, 20, V83.byId.get(VAV)!), box = at(rows, 10);
    expect(inst.shares?.labels.per_box).toBe(" per VAV installed");
    expect(inst.shares?.labels.typed).toBe("Or type the amount (per VAV installed)");
    expect(JSON.stringify(inst.shares?.blocks.flatMap((b) => b.sumLines))).toContain(" per VAV installed");
    expect(box.shares?.labels.per_box).toBe(" per box");
    expect(inst83.shares?.labels.per_box).toBe(" per box");
    expect(inst.totals).toEqual(inst83.totals);
    expect(inst.shares?.blocks.map((b) => b.figures)).toEqual(inst83.shares?.blocks.map((b) => b.figures));
  });
  it("the sheet's blank box rows: worded for the shares on an installation row (the share block's own notes)", () => {
    const rows = sheet({ 12: { ...box81(null, { controller: "bacnet" }), parent: 1 } as never });
    for (const r of [10, 11]) rows[r] = { ...box81(r === 10 ? 9 : 8, { controller: "bacnet" }), parent: 1 } as never;
    const blockNotes = (v: ItemListView) => (v.shares?.blocks ?? []).flatMap((b) => b.notes ?? []);
    const inst = blockNotes(at(rows, 20)), box = blockNotes(at(rows, 10));
    expect(inst).toContain("1 VAV box rows on this sheet have no quantity, so they are not counted in the number of VAVs the shared items are divided by.");
    expect(box).toContain("1 box rows on this sheet have no quantity and are not counted in the number of VAVs.");
  });
  it("installRowSpec: no texts declared -> the very same spec object; texts only at the four paths", () => {
    const pr = (V83.byId.get(VAV) as unknown as { list_spec: { pricing: Json } }).list_spec.pricing;
    expect(installRowSpec(pr)).toBe(pr);
    const pr84 = (C84 as unknown as { list_spec: { pricing: Json } }).list_spec.pricing;
    const o = installRowSpec(pr84) as Json;
    const strip = (x: Json) => { const c = structuredClone(x) as { sheet_shares: { lines: Json; labels: Json }; integrator_cabling: { lines: Json } };
      delete c.sheet_shares.lines.blank_rows; delete c.sheet_shares.labels.per_box; delete c.sheet_shares.labels.typed; delete c.integrator_cabling.lines.priced_separately; return c; };
    expect(strip(o)).toEqual(strip(pr84));
  });
});

describe("the edits file", () => {
  it("six edits: three notes (F2), the Calculator switch (F3), the installation-row texts (F4), the scope line's reason (F1); nothing else", () => {
    expect(EDITS84.configs.map((e) => `${e.c}:${e.p.slice(-1)[0]}`)).toEqual(["hvac_ducting:note", "hvac_valve_package:note", "hvac_vrf:note",
      "hvac_vav_box:calculator_scope_box_only", "hvac_vav_box:install_row_texts", "hvac_vav_box:why"]);
  });
});
