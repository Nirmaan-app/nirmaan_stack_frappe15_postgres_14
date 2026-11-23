/**
 * VAV-2c2 R1 / R2 -- THE SCOPE RULE for VAV Box (owner 2026-11-23 13:52 - 13:57; QR-SURE / QR-WORDS / QR-ASK 2026-11-24 00:18 - 00:55; the
 * DOUBT-sheet notes 00:31 - 00:32), T1 / T3: each case positive AND negative, on a BoQ row WITH its sheet (the panel's own entry,
 * `makePricingSheetHelper(...).compute`), on scratch copies of the v82 FILE with the v83 edits (vav2c2.harness); every note's exact text.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig } from "../../pricing/rate-master/rateMasterTypes";
import { SCOPE_OVERRIDE_KEY, type ItemListView } from "./pricingSheetHelper";
import { isInstallationRow, rowList, rowsWord, scopeRuleOf, type ScopeRuleSpec } from "./scopeRule";
import { lineFigures } from "./scopeLines";
import { ITEMS82, V82, cfg83 } from "./vav2c2.harness";
import { box81, sheet81 } from "./vav2b2.harness";

const VAV = "hvac_vav_box";
const C83 = cfg83(VAV);
const RULE = (C83 as unknown as { list_spec: { pricing: { scope: { rule: ScopeRuleSpec } } } }).list_spec.pricing.scope.rule;
const N = RULE.notes;
type Rows = Parameters<typeof sheet81>[0];
const INSTALL_TEXT = "Installation, configuration and commissioning of VAV Units with thermostat, Including supply & laying control wiring";
/** a sheet: box rows 10 / 11 (quantities qa / qb) and, when given, an installation row 20 (filed `instCat`, quantity qi) */
function sheet(qa: number | null, qb: number | null, inst?: { qi: number | null; text?: string; cat?: string }, more: Rows = {}): Rows {
  const rows: Rows = { 1: { node: "Preamble", text: "VAV SYSTEM" } as never, 10: { ...box81(qa), parent: 1 } as never, 11: { ...box81(qb), parent: 1 } as never, ...more };
  if (inst) rows[20] = { qty: inst.qi, text: inst.text ?? INSTALL_TEXT, category: inst.cat ?? VAV, parent: 1,
    items: [{ vav_item: "VAV box", vav_item_as_written: "VAV Units", shape: "None", vav_type: "Nothing specific mentioned", integrator_included: "No", airflow_cfm: "None",
      inlet_size: "None", qty_per_box: "None", scope: "Installation only", controller_mention: "none", controller_by_others: "No", dp_sensor_mention: "No" }] } as never;
  return rows;
}
const at = (rows: Rows, er: number, cfg: RateCategoryConfig = C83, ov: Record<string, string> = {}): ItemListView =>
  sheet81(rows, { cfg, items: ITEMS82 })(er, ov).itemList!;

describe("T1 point 2 -- the split across rows", () => {
  it("SURE (installation row 17 >= 0.9 x boxes 17): the box rows Supply only with note D; the installation row Installation only with note E", () => {
    const rows = sheet(9, 8, { qi: 17 });
    for (const r of [10, 11]) {
      const v = at(rows, r);
      expect(v.scope?.value).toBe("Supply only");
      expect(v.scope?.note).toBe("Supply only: installation of this item is priced on row 20. Change the scope if that row does not cover it.");
      expect(v.totals?.install_rate).toBe(0);
    }
    const i = at(rows, 20);
    expect(i.scope?.value).toBe("Installation only");
    expect(i.scope?.note).toBe("Installation only: supply of this item is priced on rows 10, 11. Change the scope if those rows do not cover it.");
    // the installation row prices the installation item (QR-SURE (d)): the box needs no airflow
    expect(i.rowPriced).toBe(true);
    expect(i.items[0].family).toBe("VAV installation - any size");
    expect(i.totals).toMatchObject({ supply_rate: 0, install_rate: 2400 });
  });
  it("NEGATIVE / VACUITY: the same sheet on v82 (no rule) -- the box rows Supply + installation, the installation row NOT priced", () => {
    const rows = sheet(9, 8, { qi: 17 });
    expect(at(rows, 10, V82.byId.get(VAV)!).totals?.install_rate).toBeGreaterThan(0);
    expect(at(rows, 20, V82.byId.get(VAV)!).rowPriced).toBe(false);
  });
  it("DOUBT by quantity (33 < 0.9 x 45): box rows Supply + installation with the owner's note; the installation row Installation only with his in-doubt note", () => {
    const rows = sheet(20, 25, { qi: 33 });
    const b = at(rows, 10);
    expect(b.scope?.value).toBe("Supply + installation");
    expect(b.scope?.note).toBe("Priced as Supply + installation. The BoQ lists this row for supply, and installation of the VAV units is priced separately on row 20. But row 20 is for 33 units, while this sheet's VAV box rows add up to 45, so installation is kept on this row. Change the scope to Supply only if required.");
    expect(b.totals?.install_rate).toBeGreaterThan(0);
    const i = at(rows, 20);
    expect(i.scope?.value).toBe("Installation only");
    expect(i.scope?.note).toBe("Installation only: this row prices installation of 33 VAV units. The VAV supply rows (10, 11) have 45 units, more than this row covers, so installation is also included on those rows. Installation may be counted twice. Check, and remove it from one place if required.");
    expect(i.rowPriced).toBe(true);
  });
  it("DOUBT by a blank quantity: note C (no figures in it); the installation row note E", () => {
    const rows = sheet(9, null, { qi: 17 });
    expect(at(rows, 10).scope).toMatchObject({ value: "Supply + installation", note: "Priced as Supply + installation. Row 20 looks like an installation row for this item, but it is not certain that it covers it. Check, and change the scope to Supply only if it does." });
    expect(at(rows, 20).scope?.value).toBe("Installation only");
  });
  it("the installation row filed under Misc counts the same (any category)", () => {
    const rows = sheet(9, 8, { qi: 17, cat: "hvac_misc" });
    expect(at(rows, 10).scope?.value).toBe("Supply only");
  });
  it("NEGATIVE: an installation row of something else (no VAV / CAV word) is no covering row -- the box rows keep Supply + installation, no note", () => {
    // (its own words name no VAV, and it sits under no VAV heading: a heading naming VAV would make it one -- the next test)
    const rows = sheet(9, 8, { qi: 17, text: "Installation, testing and commissioning of fan coil units" });
    (rows[20] as unknown as { parent?: number }).parent = undefined;
    const v = at(rows, 10);
    expect(v.scope?.value ?? "Supply + installation").toBe("Supply + installation");
    expect(v.scope?.note).toBeUndefined();
  });
  it("an installation row whose own words name no VAV, under a heading that does, counts (the heading names the item)", () => {
    expect(at(sheet(9, 8, { qi: 17, text: "Installation, testing and commissioning of the units" }), 10).scope?.value).toBe("Supply only");
  });
  it("NEGATIVE: re-installation of EXISTING boxes is no covering row (owner (g): removal only beside existing / refix)", () => {
    expect(isInstallationRow(RULE, "Re Installation, configuration and commissioning of existing VAV Units", undefined, true)).toBe(false);
    expect(isInstallationRow(RULE, "Supply, installation and commissioning of VAV units", undefined, false)).toBe(false);
    expect(isInstallationRow(RULE, INSTALL_TEXT, undefined, false)).toBe(true);
    expect(isInstallationRow(RULE, "Installation of units", "VAV SYSTEM", false)).toBe(true);
  });
});

describe("T1 point 3 / QR-WORDS -- installation only with no supply row (note F)", () => {
  it("supply by others: 'Installation of 3rd party supplied VAV Box' -> Installation only, F", () => {
    const rows: Rows = { 10: { ...box81(62), text: "Installation of 3rd party supplied VAV Box" } as never };
    expect(at(rows, 10).scope).toMatchObject({ value: "Installation only", note: "Installation only: the BoQ says supply is by others, so supply is not priced. Check before using." });
  });
  it("work on an existing box (the existing-box rule's reading): removal and refixing / existing", () => {
    const refix: Rows = { 10: { ...box81(15), text: "Dismantling and refixing of the VAV box with thermostat" } as never };
    expect(at(refix, 10).scope?.note).toBe("Installation only: the BoQ says the work is removal and refixing, so supply is not priced. Check before using.");
    const dism: Rows = { 10: { ...box81(2), text: "Dismantling of existing VAV with its thermostat" } as never };
    expect(at(dism, 10).scope?.note).toBe("Installation only: the BoQ says the material is existing, so supply is not priced. Check before using.");
  });
  it("the row's own 'installation only' -> Installation only, F (installation only)", () => {
    const rows: Rows = { 10: { ...box81(4), text: "VAV box 700 CFM - installation only" } as never };
    expect(at(rows, 10).scope).toMatchObject({ value: "Installation only", note: "Installation only: the BoQ says installation only, so supply is not priced. Check before using." });
  });
  it("NEGATIVE: 'removal of all internal parts' on a new box is not removal of an existing box (owner (g))", () => {
    const rows: Rows = { 10: { ...box81(4), text: "SITC of VAV units with provision for easy access / removal of all internal parts" } as never };
    expect(at(rows, 10).scope?.value ?? "Supply + installation").toBe("Supply + installation");
  });
});

describe("T1 point 4 -- needs no installing (note G); the default notes A / B; the user's change (H)", () => {
  it("the model says No with a reason (attic stock) -> Supply only, G", () => {
    const rows: Rows = { 10: { ...box81(2, {}, { needs_installing: "No", no_install_reason: "attic stock" }), text: "VAV box - attic stock" } as never };
    expect(at(rows, 10).scope).toMatchObject({ value: "Supply only", note: "Supply only: this item does not need installing (attic stock). Change the scope if installation is required." });
  });
  it("NEGATIVE: No without a reason, or Yes -> the default", () => {
    for (const over of [{ needs_installing: "No", no_install_reason: "None" }, { needs_installing: "Yes", no_install_reason: "None" }]) {
      expect(at({ 10: { ...box81(2, {}, over), text: "VAV box in stock" } as never }, 10).scope?.value ?? "Supply + installation").toBe("Supply + installation");
    }
  });
  it("'Supply of' alone -> Supply + installation with note A; installation words alone -> B; the row's own 'supply only' -> its note", () => {
    expect(at({ 10: { ...box81(3), text: "Supply of VAV box 700 CFM" } as never }, 10).scope).toMatchObject({ value: "Supply + installation", note: N.A });
    expect(at({ 10: { ...box81(3), text: "Installation, testing and commissioning of VAV units" } as never }, 10).scope).toMatchObject({ value: "Supply + installation", note: N.B });
    expect(at({ 10: { ...box81(3), text: "VAV box 700 CFM, supply only" } as never }, 10).scope).toMatchObject({ value: "Supply + installation", note: N.words_supply_only });
  });
  it("a plain row: Supply + installation, no scope note (the model's own narrower answer is not read)", () => {
    const v = at({ 10: { ...box81(3, {}, { scope: "Supply only" }), text: "VAV box 700 CFM" } as never }, 10);
    expect(v.scope?.value ?? "Supply + installation").toBe("Supply + installation");
    expect(v.scope?.note).toBeUndefined();
  });
  it("H: the user changes a ruled row's scope -- 'Scope changed by you. The helper had chosen Supply only.' then what the scope does, no 'BoQ says'", () => {
    const rows = sheet(9, 8, { qi: 17 });
    const v = at(rows, 10, C83, { [SCOPE_OVERRIDE_KEY]: "Supply + installation" });
    expect(v.scope?.note).toBe("Scope changed by you. The helper had chosen Supply only.");
    const w = at(rows, 20, C83, { [SCOPE_OVERRIDE_KEY]: "Supply only" });
    expect(w.scope?.note).toBe("Scope changed by you. The helper had chosen Installation only. Supply only: install 0 on every line of this row.");
    expect(w.scope?.note).not.toMatch(/BoQ says/);
  });
});

describe("T3 the pure pieces", () => {
  it("rowList / rowsWord: four rows, then 'and N more'", () => {
    expect(rowList([169, 166, 167, 168])).toBe("166, 167, 168, 169");
    expect(rowList([166, 167, 168, 169, 170, 171])).toBe("166, 167, 168, 169 and 2 more");
    expect(rowsWord([193])).toBe("row 193");
    expect(rowsWord([175, 176])).toBe("rows 175, 176");
  });
  it("no sheet (the Calculator) -> the rule does not apply", () => {
    expect(scopeRuleOf).toBeTypeOf("function");
    const v = at({ 10: { ...box81(3), text: "Supply of VAV box" } as never }, 10);
    expect(v.scope?.note).toBe(N.A);   // with the sheet; the Calculator side is vav2c2Texts R3 a
  });
});

describe("T2 the ruled rows: every line follows the scope and the lines add up to the row total", () => {
  const sum = (v: ItemListView, k: "supply_rate" | "install_rate") => lineFigures(v).reduce((a, f) => a + (f[k] ?? 0), 0);
  it("a SURE box row with a BACnet share and a thermostat: install 0 on every line (shares too), the lines add up; the supply total is the unscoped one", () => {
    const rows = sheet(9, 8, { qi: 17 });
    rows[10] = { ...box81(9, { controller: "bacnet" }), parent: 1 } as never;
    rows[11] = { ...box81(8, { controller: "bacnet" }), parent: 1 } as never;
    const v = at(rows, 10), u = at(rows, 10, V82.byId.get(VAV)!);
    expect(v.scope?.value).toBe("Supply only");
    expect(v.totals?.install_rate).toBe(0);
    expect(v.totals?.supply_rate).toBe(u.totals?.supply_rate);
    expect([sum(v, "supply_rate"), sum(v, "install_rate")]).toEqual([v.totals?.supply_rate, 0]);
    expect((v.shares?.blocks ?? []).length).toBeGreaterThan(0);
    for (const b of v.shares?.blocks ?? []) if (b.figures) expect(b.figures.install_rate, b.id).toBe(0);
    expect(u.totals?.install_rate).toBeGreaterThan(0);   // VACUITY: without the rule the installation is on this row
  });
  it("the installation row: supply 0 on every line, the lines add up", () => {
    const v = at(sheet(9, 8, { qi: 17 }), 20);
    expect([sum(v, "supply_rate"), sum(v, "install_rate")]).toEqual([0, v.totals?.install_rate]);
  });
});

describe("ANSWER 19 / 20 (owner 2026-11-24 01:22 - 01:25): the installation row carries every component the box rows give up", () => {
  const withShare = (): Rows => {
    const rows = sheet(9, 8, { qi: 17 });
    for (const r of [10, 11]) rows[r] = { ...box81(r === 10 ? 9 : 8, { controller: "bacnet" }), parent: 1 } as never;
    return rows;
  };
  it("SURE: what the box rows lose (install x quantity) is what the installation row gains, to the rupee -- the sheet total does not move", () => {
    const rows = withShare(), v82 = V82.byId.get(VAV)!;
    const lost = [10, 11].reduce((a, r) => a + (at(rows, r, v82).totals!.install_rate ?? 0) * (r === 10 ? 9 : 8), 0);
    expect([10, 11].every((r) => at(rows, r).totals!.install_rate === 0)).toBe(true);
    const inst = at(rows, 20);
    expect(inst.totals!.supply_rate).toBe(0);
    expect((inst.totals!.install_rate ?? 0) * 17).toBe(lost);
    // each component is on the installation row as a line: the installation item and the BACnet share (a thermostat: the 00239 replay, PF1)
    expect(inst.items[0].family).toBe("VAV installation - any size");
    expect((inst.shares?.blocks ?? []).some((b) => (b.figures?.install_rate ?? 0) > 0)).toBe(true);
  });
  it("DOUBT: the installation row is priced with the same per-unit components; the box rows keep theirs", () => {
    const rows = withShare();
    (rows[20] as unknown as { qty: number }).qty = 10;   // 10 < 0.9 x 17
    const box = at(rows, 10), inst = at(rows, 20);
    expect(box.scope?.value).toBe("Supply + installation");
    expect(inst.totals!.install_rate).toBe(box.totals!.install_rate);
  });
});
