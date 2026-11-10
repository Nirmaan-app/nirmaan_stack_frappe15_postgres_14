/**
 * VRF-8 K2 (owner rulings 2026-11-10 13:56 "we need to fix 2 to 4", 14:15 W6) -- THE CALCULATOR, through its own entry point
 * (`makePricingSheetHelper(...).compute(calculatorCtx(...), overrides)`), positive AND negative:
 *   R-F2  K2c (owner 18:21 "option a", ANSWER 3, correcting K2's refusal): installation only + the MS frame (catalogue install a
 *         stored 0) PRICES -- the frame charges its full 5,600 with the owner's note; a line with no install figure is never charged
 *   R-F3  an extra removed with its x on every unit is no longer ticked in "This row's price includes"; "Put it back" ticks it again (U5)
 *   R-F4  Derivation line 42 states its condition on a config with VRF-7's own-row check (U6)
 *   R-W6  a capacity typed with two values ("2.6 TR / 1.3 TR", the panel's case) refuses with the panel's sentence (U3)
 *   U5 / U8 on the screen: the include list keeps a removed include; the row total shows the row's reason (source pins)
 * FIXTURE: HVAC v63 + Electrical v72 with the v64 keys (`applyVrf8`, the file the v64 mint reads).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { EXTRAS_INCLUDES_KEY, ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, SCOPE_OVERRIDE_KEY, makePricingSheetHelper, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { applyVrf8, readJsonFixture, type Vrf8Fixture } from "../../pricing/calculatorPanelParity.harness";
import { itemListRuleOrder } from "../../pricing/rate-master/itemListRuleOrder";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const h63 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v63.json`, import.meta.url));
const h62 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v62.json`, import.meta.url));
const e72 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_electrical_all_v72.json`, import.meta.url));
const FX8 = readJsonFixture<Vrf8Fixture>(new URL("../../pricing/__fixtures__/vrf8Model.json", import.meta.url));
const VRF = "hvac_vrf";
const toItems = (a: Asset) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
const ITEMS: RateMasterItem[] = [...toItems(h63), ...toItems(e72)];
const v64 = applyVrf8(h63.category_configs.find((c) => c.category_id === VRF)!, FX8);
const CFG = new Map<string, RateCategoryConfig>([...h63.category_configs.map((c) => (c.category_id === VRF ? v64 : c)), ...e72.category_configs].map((c) => [c.category_id, c]));
const CALC = makePricingSheetHelper({ configsByCategory: CFG, items: ITEMS, extractionByRow: new Map() });
const run = (blocks: Array<Record<string, unknown>>, inc = "", scope?: string): ItemListView =>
  (CALC.compute(calculatorCtx("HVAC", VRF), {
    [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: blocks }), [ROW_UNIT_OVERRIDE_KEY]: "Nos", [EXTRAS_INCLUDES_KEY]: inc, ...(scope ? { [SCOPE_OVERRIDE_KEY]: scope } : {}),
  }) as unknown as ItemListSuggestion).itemList!;
const ODU = (capacity: string, more: Record<string, unknown> = {}) => ({ base: null, family: "Outdoor Unit", attrs: { brand: "Blue Star", capacity }, ...more });
const tick = (v: ItemListView, id: string) => v.extrasIncludes?.options.find((o) => o.id === id);

describe("VRF-8 K2c (R-F2 corrected, owner 18:21 'option a', ANSWER 3) -- installation only + the MS frame PRICES", () => {
  // BEFORE (K2 e131c8f91, R-F2 as first specified): the frame line went blank "BoQ says installation only, but MS frame / stand for
  // ODU has no installation rate - price this row by hand" and the row refused. The owner corrected it: the stand is made and fixed
  // on site by us, so it charges its full 5,600 and the row prices.
  it("an outdoor unit with the MS frame, installation only: the frame charges 5,600 (install column, no uplift), the row prices, the note says why", () => {
    const v = run([ODU("10")], "frame", "Installation only");
    expect(v.rowPriced).toBe(true);
    const frame = v.items[0].extras?.lines.find((l) => l.id === "acc_frame");
    expect(frame?.state).toBe("priced");
    expect(frame?.figures).toEqual({ supply_rate: 0, install_rate: 5600, combined_rate: 5600 });
    expect(v.scope?.note).toContain("Installation-only row: MS frame charged at 5,600 - the stand is made and fixed on site by us (owner R-F2)");
    expect(v.totals?.supply_rate).toBe(0);
    // the unit itself keeps install x 1.5 (rounded up once): the row = the unit's uplifted install + 5,600
    const unitOnly = run([ODU("10")], "", "Installation only");
    expect(v.totals?.install_rate).toBe((unitOnly.totals?.install_rate ?? 0) + 5600);
    expect(v.reason ?? "").not.toMatch(/has no installation rate/);
  });
  it("NEGATIVE: supply + installation keeps the frame at supply 5,600 / install 0 and says nothing about R-F2; supply only = 5,600 / 0", () => {
    const full = run([ODU("10")], "frame");
    expect(full.rowPriced).toBe(true);
    expect(full.items[0].extras?.lines.find((l) => l.id === "acc_frame")?.figures).toMatchObject({ supply_rate: 5600, install_rate: 0 });
    expect(full.scope?.note ?? "").not.toMatch(/owner R-F2/);
    const so = run([ODU("10")], "frame", "Supply only");
    expect(so.items[0].extras?.lines.find((l) => l.id === "acc_frame")?.figures).toMatchObject({ supply_rate: 5600, install_rate: 0 });
    expect(so.scope?.note ?? "").not.toMatch(/owner R-F2/);
  });
  it("NEGATIVE: a frame item with NO install figure (not a stored 0) is never charged -- the line stays blank with its own reason, no R-F2 note, 5,600 not in the row", () => {
    const items2 = ITEMS.map((it) => (it.attributes?.item === "MS frame / stand for ODU"
      ? { ...it, rates: Object.fromEntries(Object.entries(it.rates ?? {}).filter(([k]) => !/install/.test(k))) } as RateMasterItem : it));
    const C2 = makePricingSheetHelper({ configsByCategory: CFG, items: items2, extractionByRow: new Map() });
    const v = (C2.compute(calculatorCtx("HVAC", VRF), {
      [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [ODU("10")] }), [ROW_UNIT_OVERRIDE_KEY]: "Nos", [EXTRAS_INCLUDES_KEY]: "frame", [SCOPE_OVERRIDE_KEY]: "Installation only",
    }) as unknown as ItemListSuggestion).itemList!;
    const frame = v.items[0].extras?.lines.find((l) => l.id === "acc_frame");
    expect(frame?.state).toBe("blank");
    expect(frame?.reason).toMatch(/cost_install not on the matched row/);
    expect(v.scope?.note ?? "").not.toMatch(/owner R-F2/);
    expect(v.totals?.install_rate).toBe(run([ODU("10")], "", "Installation only").totals?.install_rate);
  });
});

describe("VRF-8 R-F3 -- the tick follows the x", () => {
  it("the communication cable removed with its x -> unticked (kept in the list as removed); put back -> ticked", () => {
    const gone = run([ODU("10", { extras: { removed: ["comm"] } })], "comm");
    expect(tick(gone, "comm")?.checked).toBe(false);
    expect((tick(gone, "comm") as { removed?: boolean } | undefined)?.removed).toBe(true);
    expect(gone.items[0].extras?.removed.map((r) => r.id)).toEqual(["comm"]);
    const back = run([ODU("10")], "comm");
    expect(tick(back, "comm")?.checked).toBe(true);
    expect((tick(back, "comm") as { removed?: boolean } | undefined)?.removed).toBeUndefined();
  });
  it("an accessory (MS frame) removed on the outdoor unit -> unticked", () => {
    expect(tick(run([ODU("10", { extras: { removed: ["acc_frame"] } })], "frame"), "frame")?.checked).toBe(false);
  });
  it("NEGATIVE: removed on ONE of two units -> still ticked (the other unit still carries it)", () => {
    const v = run([ODU("10", { extras: { removed: ["comm"] } }), ODU("12")], "comm");
    expect(tick(v, "comm")?.checked).toBe(true);
  });
});

describe("VRF-8 R-W6 -- the two-capacities refusal in the calculator", () => {
  const CAS = (capacity: string) => ({ base: null, family: "Cassette", attrs: { brand: "Blue Star", way: "FOUR-WAY", capacity } });
  it("a capacity typed '2.6 TR / 1.3 TR' refuses with the panel's sentence", () => {
    const v = run([CAS("2.6 TR / 1.3 TR")]);
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toBe("two capacities stated (2.6 TR / 1.3 TR) - pick one");
    expect(v.items[0].reason).toBe(v.reason);
  });
  it("NEGATIVE: one capacity typed prices", () => {
    expect(run([CAS("2.6 TR")]).rowPriced).toBe(true);
  });
  it("NEGATIVE (K3): a unit refused for ANOTHER reason keeps it -- a Lot unit with two capacities typed still says it is a Lot", () => {
    const v = (CALC.compute(calculatorCtx("HVAC", VRF), {
      [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family: "Outdoor Unit", attrs: { brand: "Blue Star", capacity: "22.5 TR / 18 HP" } }] }), [ROW_UNIT_OVERRIDE_KEY]: "Lot",
    }) as unknown as ItemListSuggestion).itemList!;
    expect(v.rowPriced).toBe(false);
    expect(v.reason ?? "").not.toMatch(/two capacities stated/);
  });
});

describe("VRF-8 R-F4 -- Derivation line 42 states its condition", () => {
  it("v63 / v64 (VRF-7's own-row check): the pump is added only without the sheet's own pump row; v62 keeps its wording", () => {
    const t = (c: RateCategoryConfig) => itemListRuleOrder(c).map((l) => l.title);
    const v63t = t(h63.category_configs.find((c) => c.category_id === VRF)!);
    expect(v63t[41]).toBe("A built-in drain pump is added only when the sheet has no pump row of its own, with a review point");
    expect(t(v64)[41]).toBe(v63t[41]);
    expect(t(h62.category_configs.find((c) => c.category_id === VRF)!)[41]).toBe("A built-in drain pump is still added, with a review point");
    const d = itemListRuleOrder(v64)[41].detail ?? "";
    expect(d).toMatch(/only when the same sheet does not quote the pump on a row of its own/);
  });
});

describe("VRF-8 U5 / U8 -- the screen (source pins)", () => {
  const src = readFileSync(new URL("./RateHelperPanel.tsx", import.meta.url), "utf-8");
  it("the include list keeps an include removed with its x (so 'Put it back' works)", () => {
    expect(src).toContain("view.extrasIncludes!.options.filter((x) => x.checked || x.removed)");
  });
  it("the row total shows the row's reason when the row is refused", () => {
    expect(src).toContain('data-testid="item-row-total-reason"');
    expect(src).toMatch(/view\.reason && <div className="mt-0\.5" data-testid="item-row-total-reason">\{view\.reason\}<\/div>/);
  });
});
