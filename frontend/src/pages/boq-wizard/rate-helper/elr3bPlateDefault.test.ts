/**
 * ELR-3b (owner R-8; R-V1 2026-10-27 "2 v1"; R-V1b / R-V1c 2026-10-29) -- THE PLATE-QUANTITY DEFAULT on the panel and the
 * calculator, through ONE function (`computedPlateQtyDefaults`), mirroring the server's
 * `extraction.fill_paired_slot_defaults` case (b): an UNNAMED, computed plate takes plate quantity 1 only when the box
 * holds at least one switch or socket.
 *
 * The stored rows are REAL (`__fixtures__/elr3bPlateRows.json`, from the 2026-10-29 replay dump on Electrical v69): the 39
 * declared rows (37 refusing -> priced, 2 still refusing on another field with "Plate qty" gone from the refusal), the
 * empty box BOQ-26-00185 r198, the 8 point-wiring rows that refuse only on Plate qty (empty boxes, V2 -- not ruled), and the
 * already-priced BOQ-26-00183 r12. `before` = HEAD c8792f669, `after` = this change; measured over all 18,106 replay rows,
 * only the 39 move.
 */
import { describe, expect, it } from "vitest";
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import { compareResults, feedFromPanel, readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { calculatorCtx } from "@/pages/pricing/PricingCalculator";
import { computedPlateQtyDefaults, makePricingSheetHelper } from "./pricingSheetHelper";
import { mergeItemsByName } from "./rateHelperPlumbing";
import { NONE_SENTINEL } from "@/pages/pricing/rate-master/ratePipelineInterpreter";
import type { ExtractionRow, HelperResult } from "./rateHelperTypes";

type Asset = { discipline: string; items: Array<RateMasterItem & { brand?: string }>; category_configs: RateCategoryConfig[] };
const DATA_DIR = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
const readAsset = (file: string): Asset => readJsonFixture<Asset>(pathToFileURL(path.join(DATA_DIR, file)));
const HVAC = readAsset("rate_master_hvac_all_v54.json");
const ELEC = readAsset("rate_master_electrical_all_v69.json");
// the endpoint projects `brand` into attributes at read time (extraction.PROJECTED_ITEM_COLUMNS) -- the adp3a.harness shape
const itemsOf = (a: Asset): RateMasterItem[] =>
  a.items.map((i) => ({ ...i, attributes: { ...i.attributes, ...(i.brand ? { brand: i.brand } : {}) }, discipline: a.discipline } as RateMasterItem));
const ITEMS = mergeItemsByName(itemsOf(HVAC), itemsOf(ELEC));
const CONFIGS = new Map<string, RateCategoryConfig>([...HVAC.category_configs, ...ELEC.category_configs].map((c) => [c.category_id, c]));
const cfg = (id: string) => CONFIGS.get(id)!;

type Seen = { values: Record<string, number>; derivation: string[]; plate_qty: { value: string; defaulted: boolean; confidence: number | null } | null };
type FixRow = { group: "declared" | "empty_box" | "pw_plate_only" | "priced_c6"; key: string; category: string; excel_row: number; description: string;
  unit: string; attributes: Record<string, { value: string | number | null; confidence: number; defaulted?: boolean }>; before: Seen; after: Seen };
const FIX = readJsonFixture<{ rows: FixRow[] }>(new URL("../../pricing/__fixtures__/elr3bPlateRows.json", import.meta.url));
const rowsOf = (g: FixRow["group"]) => FIX.rows.filter((r) => r.group === g);
const byKey = (k: string) => FIX.rows.find((r) => r.key === k)!;

const KINDS = ["supply_rate", "install_rate", "combined_rate"];
function panelOf(r: FixRow, overrides: Record<string, string> = {}): HelperResult {
  const ext = new Map<number, ExtractionRow>([[r.excel_row, { excelRow: r.excel_row, description: r.description, attributes: r.attributes } as unknown as ExtractionRow]]);
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: ext });
  return h.compute({ excelRow: r.excel_row, description: r.description, nodeType: "Line Item", category: r.category, discipline: "Electrical",
    rateKinds: KINDS, headings: [], ownNotes: [], unit: r.unit } as never, overrides);
}
function calcOf(cat: string, picks: Record<string, string>): HelperResult {
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map() });
  return h.compute(calculatorCtx("Electrical", cat), picks);
}
/** What a pricer types on the calculator for a row: the panel's answers (the tracked parity feed) minus the plate quantity
 * the panel defaulted -- so the calculator must apply the default ITSELF. */
function pricerPicks(r: FixRow, p: HelperResult): Record<string, string> {
  const pcase = { cat: r.category, unit: r.unit, desc: r.description, attrs: Object.fromEntries(Object.entries(r.attributes).map(([k, v]) => [k, v?.value ?? null])) };
  const picks = { ...feedFromPanel(p, cfg(r.category), pcase, "full").overrides };
  delete picks.plate_qty;
  return picks;
}
const values = (s: HelperResult) => ((s as { values?: Record<string, number> }).values ?? {});
const attrOf = (s: HelperResult, id: string) => (s as { workings: { attributes: Array<{ id: string; value: string; defaulted?: boolean; confidence?: number }> } })
  .workings.attributes.find((a) => a.id === id);
const derivationOf = (s: HelperResult) => ((s as { workings?: { derivation?: string[] } }).workings?.derivation ?? []);
const seen = (s: HelperResult): Seen => {
  const q = attrOf(s, "plate_qty");
  return { values: values(s), derivation: derivationOf(s), plate_qty: q ? { value: q.value, defaulted: !!q.defaulted, confidence: q.confidence ?? null } : null };
};

// ── the ONE function, on v69's own configs (the rule read from the config, never from a name) ───────────────────────────
describe("ELR-3b -- computedPlateQtyDefaults, the server's case (b)", () => {
  const SW = cfg("switches_sockets");
  const valueOf = (a: Record<string, string | number | null>) => (id: string) => (id in a ? a[id] : null);
  const BOX = { switch_item: "16A 1 WAY SWITCH", switch_qty: 1, socket1_item: "6A/16A 3-Pin Socket", socket1_qty: 4, plate_item: null, plate_qty: null };
  it("POSITIVE: an occupied box with an unnamed computed plate -> plate quantity 1 (the declared default)", () => {
    expect([...computedPlateQtyDefaults(SW, valueOf(BOX))]).toEqual([["plate_qty", 1]]);
    expect([...computedPlateQtyDefaults(SW, valueOf({ ...BOX, switch_item: NONE_SENTINEL, switch_qty: null }))]).toEqual([["plate_qty", 1]]); // a socket alone
    expect([...computedPlateQtyDefaults(cfg("point_wiring"), valueOf({ switch_item: "16A 1 WAY SWITCH", switch_qty: 1 }))]).toEqual([["plate_qty", 1]]);
  });
  it("NEGATIVE: an EMPTY box (every switch / socket None or blank) gets no default -- R-V1, not V2", () => {
    const empty = { switch_item: NONE_SENTINEL, socket1_item: NONE_SENTINEL, socket2_item: NONE_SENTINEL, socket3_item: NONE_SENTINEL, socket4_item: NONE_SENTINEL };
    expect(computedPlateQtyDefaults(SW, valueOf(empty)).size).toBe(0);
    expect(computedPlateQtyDefaults(SW, valueOf({})).size).toBe(0);
    // a quantity beside an item that is NOT filled does not occupy the box (module_fit's own sum skips it)
    expect(computedPlateQtyDefaults(SW, valueOf({ switch_item: NONE_SENTINEL, switch_qty: 2 })).size).toBe(0);
    expect(computedPlateQtyDefaults(SW, valueOf({ switch_item: null, switch_qty: 2 })).size).toBe(0);
    expect(computedPlateQtyDefaults(SW, valueOf({ ...BOX, switch_qty: 0, socket1_qty: 0 })).size).toBe(0);
  });
  it("NEGATIVE: a NAMED plate (U7's, unchanged) or a None plate gets no V1 default; a stated quantity is never replaced", () => {
    expect(computedPlateQtyDefaults(SW, valueOf({ ...BOX, plate_item: "9M" })).size).toBe(0);
    expect(computedPlateQtyDefaults(SW, valueOf({ ...BOX, plate_item: NONE_SENTINEL })).size).toBe(0);
    expect(computedPlateQtyDefaults(SW, valueOf({ ...BOX, plate_qty: 2 })).size).toBe(0);
    expect(computedPlateQtyDefaults(SW, valueOf({ ...BOX, plate_qty: 0 })).size).toBe(0); // a read 0 is a value, not a blank
  });
  it("NEGATIVE: config-driven -- no module_fit ladder over the paired item, no default", () => {
    expect(computedPlateQtyDefaults(cfg("wiring_cabling"), valueOf(BOX)).size).toBe(0);
    const unbound = structuredClone(SW);
    for (const pl of Object.values(unbound.pipelines)) for (const s of pl.steps as Array<{ step?: string; params?: { ladders?: Array<{ bind?: string }> } }>)
      if (s.step === "module_fit") for (const l of s.params?.ladders ?? []) if (l.bind === "plate_item") l.bind = "elr3b_not_a_paired_item";
    expect(computedPlateQtyDefaults(unbound, valueOf(BOX)).size).toBe(0);
  });
});

// ── the panel, on the real stored rows ────────────────────────────────────────────────────────────────────────────────
describe("ELR-3b -- the BoQ pricing page (panel)", () => {
  it("the fixture is the declared 39 + the controls", () => {
    expect([rowsOf("declared").length, rowsOf("empty_box").length, rowsOf("pw_plate_only").length, rowsOf("priced_c6").length]).toEqual([39, 1, 8, 1]);
    expect(rowsOf("declared").filter((r) => Object.keys(r.after.values).length).length).toBe(37);
  });
  it("POSITIVE (AC0 / R-V1): the five BOQ-26-00224 rows price at the ruled figures, the plate quantity shown as a default", () => {
    const want: Array<[number, number, number]> = [[212, 970, 200], [213, 800, 160], [214, 600, 120], [215, 360, 80], [216, 260, 60]];
    for (const [row, s, i] of want) {
      const r = byKey(`BOQ-26-00224|ELECTRICAL|${row}`);
      expect(r.before.derivation).toEqual(["Missing to price: Plate qty -- fill them to compute a rate."]);
      const p = panelOf(r);
      expect(values(p)).toEqual({ supply_rate: s, install_rate: i, combined_rate: s + i });
      expect(attrOf(p, "plate_qty")).toMatchObject({ value: "1", defaulted: true });
      expect(attrOf(p, "plate_qty")!.confidence).toBeUndefined(); // R-V1c: no confidence shown
      expect(derivationOf(p).some((l) => /^\(defaulted -- no positive text identification\): .*Plate qty=1/.test(l))).toBe(true);
      expect(derivationOf(p).some((l) => /never asked/.test(l))).toBe(false); // it WAS asked -- not the never-asked line
    }
  });
  it.each(rowsOf("declared").map((r) => [r.key, r] as const))("POSITIVE (R-V1 / R-V1b): %s reads exactly as declared", (_k, r) => {
    expect(seen(panelOf(r))).toEqual(r.after);
    expect(r.after.plate_qty).toEqual({ value: "1", defaulted: true, confidence: null });
  });
  it("R-V1b: the two still-refusing rows stop naming Plate qty and keep refusing on the field really missing", () => {
    expect(derivationOf(panelOf(byKey("BOQ-26-00232|Internal  office|90")))).toEqual(["Missing to price: Wire 1 - thickness (sqmm) -- fill them to compute a rate."]);
    expect(derivationOf(panelOf(byKey("BOQ-26-00232|Internal  office|135")))).toEqual(["Missing to price: Switch -- fill them to compute a rate."]);
  });
  it.each([...rowsOf("empty_box"), ...rowsOf("pw_plate_only")].map((r) => [r.key, r] as const))(
    "NEGATIVE: %s (an empty box) still refuses on Plate qty", (_k, r) => {
      const p = panelOf(r);
      expect(values(p)).toEqual({});
      expect(derivationOf(p)).toEqual(["Missing to price: Plate qty -- fill them to compute a rate."]);
      expect(seen(p)).toEqual(r.before);
    });
  it("NEGATIVE: an already-priced row (BOQ-26-00183 r12, its plate quantity read by the server) is unchanged", () => {
    const r = rowsOf("priced_c6")[0];
    expect(seen(panelOf(r))).toEqual(r.before);
    expect(values(panelOf(r))).toEqual({ supply_rate: 170, install_rate: 40, combined_rate: 210 });
  });
  it("NEGATIVE: a plate quantity the pricer types always wins -- a number stays theirs, a cleared box is not refilled", () => {
    const r = byKey("BOQ-26-00224|ELECTRICAL|212");
    const two = panelOf(r, { plate_qty: "2" });
    expect(attrOf(two, "plate_qty")).toMatchObject({ value: "2" });
    expect(attrOf(two, "plate_qty")!.defaulted).toBeFalsy();
    expect(values(two)).not.toEqual(values(panelOf(r)));
    const cleared = panelOf(r, { plate_qty: "" });
    expect(values(cleared)).toEqual({});
    expect(derivationOf(cleared)).toEqual(["Missing to price: Plate qty -- fill them to compute a rate."]);
    expect(seen(cleared).plate_qty).toEqual(r.before.plate_qty); // the stored cell, as before ELR-3b -- no default under it
  });
});

// ── the calculator: the same rule through the same compute, and parity with the panel ────────────────────────────────
describe("ELR-3b -- the calculator (R-ONE-RULE)", () => {
  it.each(rowsOf("declared").map((r) => [r.key, r] as const))("PARITY: %s -- the pricer's inputs without a plate quantity give the panel's answer", (_k, r) => {
    const p = panelOf(r);
    const c = calcOf(r.category, pricerPicks(r, p));
    expect(values(c)).toEqual(r.after.values);
    expect(attrOf(c, "plate_qty")).toMatchObject({ value: "1", defaulted: true });
    expect(attrOf(c, "plate_qty")!.confidence).toBeUndefined();
    expect(compareResults(p, c)).toEqual([]);
  });
  it("AC0 C3: r212's inputs on Switches and Sockets -> 970 / 200 and the same default line", () => {
    const r = byKey("BOQ-26-00224|ELECTRICAL|212");
    const c = calcOf("switches_sockets", pricerPicks(r, panelOf(r)));
    expect(values(c)).toEqual({ supply_rate: 970, install_rate: 200, combined_rate: 1170 });
    expect(derivationOf(c).some((l) => /^\(defaulted -- no positive text identification\): .*Plate qty=1/.test(l))).toBe(true);
  });
  it("NEGATIVE: an empty box on the calculator still asks for the plate quantity; a NAMED plate keeps U7", () => {
    const empty = calcOf("switches_sockets", { switch_item: NONE_SENTINEL, socket1_item: NONE_SENTINEL, socket2_item: NONE_SENTINEL,
      socket3_item: NONE_SENTINEL, socket4_item: NONE_SENTINEL, back_box: "Yes", colour: "White" });
    expect(attrOf(empty, "plate_qty")!.value).toBe("");
    const r = byKey("BOQ-26-00224|ELECTRICAL|212");
    const picks = pricerPicks(r, panelOf(r));
    const plate = (attrOf(calcOf("switches_sockets", picks), "plate_item") as { options?: unknown[] } | undefined)?.options?.find((o) => String(o) !== NONE_SENTINEL);
    expect(plate).toBeTruthy();
    const named = calcOf("switches_sockets", { ...picks, plate_item: String(plate) });
    expect(attrOf(named, "plate_qty")).toMatchObject({ value: "1", defaulted: true }); // U7, the never-asked map
    expect(derivationOf(named).some((l) => /never asked/.test(l))).toBe(true);     // U7's own line, unchanged
  });
});
