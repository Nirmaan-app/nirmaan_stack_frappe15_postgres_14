/**
 * SLICE 12d-4a -- THE AUDIT FIXES, PROVED ON THE AUDIT'S REAL ROWS THROUGH BOTH REAL PATHS (owner D1-D14, 2026-10-11).
 *
 * Every row below is a REAL Insulation row of the 12d-3 audit (`__fixtures__/insulation12d4aRows.json`): the payload
 * the product built (`extraction._ai_item` -- description, headings, the row's OWN notes), the stored MODEL ANSWER of
 * the audit run (a `BoQ Rate Suggestion Run` document) and the outcome the audit measured on v30 (`before_12d3`). The
 * PANEL path is `makePricingSheetHelper` over that stored row; the CALCULATOR path is `PricingCalculator`'s construction
 * fed what the panel shows (`runParity`). Each fix is pinned on its rows from the product's own pricing on v31, written
 * once in WRITE mode and frozen (`__fixtures__/insulation12d4aExpected.json`), so a later change to any rule a row
 * exercises is loud. NO AI call.
 *
 * ⚠️ A big fixture is READ at runtime, never `import`ed.
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "./rate-master/rateMasterTypes";
import { isSuggestion } from "../boq-wizard/rate-helper/rateHelperTypes";
import { isEligibleConfig, type ItemListSuggestion } from "../boq-wizard/rate-helper/pricingSheetHelper";
import { readJsonFixture, runParity, type ParityCase, type ParityRun } from "./calculatorPanelParity.harness";

interface FixtureRow {
  id: string; boq: string; sheet: string; excel_row: number; unit: string | null; description: string; headings: string[]; ownNotes: string[];
  answer: { items: Array<{ attributes: Record<string, { value: string | null; confidence?: number }> }> } | null;
  answer_note: string;
  fixes: string[];
  before_12d3: { priced: boolean; totals: Record<string, number> | null; reason: string | null };
}
interface ExpectedRow {
  id: string;
  fixes: string[];
  priced: boolean;
  supply?: number;
  install?: number;
  reason?: string;
  layers?: string[];
  defaulted?: string[];
  working0?: string;
  unitNote?: string;
}

const ROWS = readJsonFixture<FixtureRow[]>(new URL("./__fixtures__/insulation12d4aRows.json", import.meta.url));
const WRITE = !!process.env.WRITE_12D4A_EXPECTED;
const EXPECTED = WRITE ? [] as ExpectedRow[] : readJsonFixture<ExpectedRow[]>(new URL("./__fixtures__/insulation12d4aExpected.json", import.meta.url));
// v32 BY NAME (v31 + the 12d-4aF D9b family list -- the frozen record of this slice AND its follow-up), READ at runtime --
// an `import` of a 16,700-line asset makes `tsc` infer a structural type for the whole file and the project type gate
// dies at the default heap (the heap cliff the header names).
const ASSET = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
  new URL("../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v32.json", import.meta.url),
);
const CAT = "hvac_insulation";
const CFG = ASSET.category_configs.find((c) => c.category_id === CAT)!;
const CONFIGS = new Map([[CAT, CFG]]);
const ITEMS: RateMasterItem[] = ASSET.items.map((it) => ({ ...it, discipline: ASSET.discipline } as RateMasterItem));

/**
 * The divergences the fixes introduce, BY CLASS and BY ROW. Owner P1: calculator = panel always; a divergence is a
 * failure unless it is named, with its cause, and the suite passes only if EXACTLY these differ.
 *
 *   F_row_text_not_an_input -- ACCEPTED BY OWNER ("ok", 12d-4aF, 2026-10-11) -- D3 (named_in_row) and D9b-by-word (refuse_on_unit_class.words) read the row's OWN
 *   TEXT, which the calculator does not have: the panel refuses for a person, the calculator (fed the panel's shown
 *   values, cladding "No" by the R1 default) prices. The 12c-P "input-surface" class, counted and reported.
 */
export const EXPECTED_DIVERGENCE_ROWS: ReadonlyArray<{ id: string; cause: string }> = [
  { id: "BOQ-26-00017|Lowside #94", cause: "F_row_text_not_an_input (D3) -- ACCEPTED BY OWNER: ok" },
  { id: "BOQ-26-00020|HVAC_-19TH FLOOR#515", cause: "F_row_text_not_an_input (D9b by word) -- ACCEPTED BY OWNER: ok" },
  { id: "BOQ-26-00108|HVAC#420", cause: "F_row_text_not_an_input (D3) -- ACCEPTED BY OWNER: ok" },
  { id: "BOQ-26-00117|HVAC BOQ #189", cause: "F_row_text_not_an_input (D3) -- ACCEPTED BY OWNER: ok" },
  { id: "BOQ-26-00140|HVAC Lowside Works #59", cause: "F_row_text_not_an_input (D9b by word) -- ACCEPTED BY OWNER: ok" },
  { id: "BOQ-26-00149|HVAC-BOQ#439", cause: "F_row_text_not_an_input (D3) -- ACCEPTED BY OWNER: ok" },
  { id: "BOQ-26-00164|BOQ#136", cause: "F_row_text_not_an_input (D3) -- ACCEPTED BY OWNER: ok" },
  { id: "BOQ-26-00197|HVAC BOQ #199", cause: "F_row_text_not_an_input (D3) -- ACCEPTED BY OWNER: ok" },
  // PRE-EXISTING classes, every one in the 12d-3 audit's own divergence list (sentence / unit-class only, or ruled)
  { id: "BOQ-26-00029|HVAC WORK#263", cause: "C_unit_not_offered (both refuse by name; the calculator was fed a unit the row lacks)" },
  { id: "BOQ-26-00137|LOWSIDE OFFICE WORKS#128", cause: "C_unit_not_offered (both refuse by name; the calculator was fed a unit the row lacks)" },
  { id: "BOQ-26-00165|AC WORKS #14", cause: "B_stale_pick (both refuse; sentence only -- unchanged by this slice)" },
  { id: "BOQ-26-00100|HVAC #111", cause: "C_option_not_offered (the row-290 class, owner F2: the Thermal dropdown cannot carry glass cloth)" },
  { id: "BOQ-26-00234|(CHW BOQ) AHU & Low Side#132", cause: "T6_typed_layers (RULED 12d-1b: the calculator's typed layers stay refused)" },
  { id: "BOQ-26-00234|(CHW BOQ) AHU & Low Side#133", cause: "T6_typed_layers (RULED 12d-1b)" },
  { id: "BOQ-26-00234|(CHW BOQ) AHU & Low Side#134", cause: "T6_typed_layers (RULED 12d-1b)" },
  { id: "BOQ-26-00234|(CHW BOQ) AHU & Low Side#135", cause: "T6_typed_layers (RULED 12d-1b)" },
  { id: "BOQ-26-00234|(CHW BOQ) AHU & Low Side#136", cause: "T6_typed_layers (RULED 12d-1b)" },
];

function caseOf(r: FixtureRow): ParityCase {
  return {
    cat: CAT, unit: r.unit ?? "", desc: r.description, attrs: {}, headings: r.headings, ownNotes: r.ownNotes,
    items: (r.answer?.items ?? []).map((it) => Object.fromEntries(Object.entries(it.attributes).map(([k, v]) => [k, v.value]))),
  };
}
const run = (r: FixtureRow): ParityRun => runParity(CONFIGS, ITEMS, caseOf(r), "full");
function view(x: ParityRun) {
  if (!isSuggestion(x.panel)) throw new Error("panel declined: " + JSON.stringify(x.panel));
  return (x.panel as ItemListSuggestion).itemList!;
}
function outcome(r: FixtureRow, x: ParityRun): ExpectedRow {
  const v = view(x);
  const o: ExpectedRow = { id: r.id, fixes: r.fixes, priced: v.rowPriced };
  if (v.rowPriced) { o.supply = v.totals?.supply_rate; o.install = v.totals?.install_rate; } else o.reason = v.reason;
  o.layers = v.items.map((b) => b.fields.filter((f) => f.id === "thickness_mm").map((f) => f.value).join("") + "/" + (b.fields.find((f) => f.id === "cladding")?.value ?? ""));
  o.defaulted = v.items.flatMap((b, i) => b.fields.filter((f) => f.defaulted).map((f) => i + ":" + f.id + "=" + f.value));
  const w0 = v.items[0]?.working?.find((w) => /^(BoQ says|You typed)/.test(w));
  if (w0) o.working0 = w0;
  if (v.unitNote) o.unitNote = v.unitNote;
  return o;
}

describe("the fixture is REAL and v31 is the asset that carries the fixes", () => {
  it("67 rows from the 12d-3 audit, every one with a stored model answer; v31 declares the four keys and the four SKUs", () => {
    expect(ROWS.length).toBe(67);
    for (const r of ROWS) {
      expect(r.answer_note).toMatch(/^REAL model answer from the 12d-3 audit run/);
      expect(r.answer?.items?.length ?? 0).toBeGreaterThanOrEqual(0);
    }
    const pr = (CFG.list_spec as unknown as { pricing: Record<string, unknown> }).pricing;
    for (const k of ["named_in_row", "unstocked_materials", "refuse_on_unit_class", "read_notes"]) expect(pr[k], k).toBeDefined();
    expect(ITEMS.filter((it) => it.attributes.item === "Acoustic Nitrile Insulation" && it.attributes.cladding === "GI Framework with perforated Al sheet").map((it) => Number(it.attributes.thickness_mm)).sort((a, b) => a - b)).toEqual([9, 13, 15, 19]);
    expect(isEligibleConfig(CFG)).toBe(true);
    if (!WRITE) expect(EXPECTED.map((e) => e.id)).toEqual(ROWS.map((r) => r.id));
  });
});

describe("every audited row through BOTH paths on v31", () => {
  const results = ROWS.map((r) => ({ r, run: run(r), out: null as ExpectedRow | null }));
  for (const x of results) x.out = outcome(x.r, x.run);

  it("the outcomes are the product's own on v31 (frozen once in WRITE mode)", () => {
    const got = results.map((x) => x.out!);
    if (WRITE) {
      writeFileSync(new URL("./__fixtures__/insulation12d4aExpected.json", import.meta.url), JSON.stringify(got, null, 1) + "\n");
      return;
    }
    expect(got).toEqual(EXPECTED);
  });

  it("E2E-1 / item 1 (D1): the 15 Acoustic + GI framework rows PRICE from their stored answers, the framework computed live, panel = calculator", () => {
    const d1 = results.filter((x) => x.r.fixes.includes("D1"));
    expect(d1.length).toBe(15);
    for (const x of d1) {
      expect(x.r.before_12d3.priced, x.r.id).toBe(false);
      expect(x.out!.priced, x.r.id).toBe(true);
      expect(x.run.divergences, x.r.id).toEqual([]);
      const v = view(x.run);
      // the framework line ONCE per LAYER that carries the cladding (the outer one); the inner layers carry "No"
      const outer = v.items[v.items.length - 1];
      expect(outer.working.some((w) => w.includes("gi_sheet_rate (rate) = 450")), x.r.id).toBe(true);
      expect(outer.fields.find((f) => f.id === "cladding")?.value).toBe("GI Framework with perforated Al sheet");
    }
    // one figure per stated thickness, stated in advance (12d-4a ledger)
    const byThickness = new Map<string, [number, number]>();
    for (const x of d1) byThickness.set(String(x.r.answer!.items[0].attributes.thickness_mm.value).replace(/\s/g, ""), [x.out!.supply!, x.out!.install!]);
    expect(Object.fromEntries(byThickness)).toEqual({ "12.5Mm": [2074, 364], "25Mm": [3146, 518], "25mm": [3146, 518], "30mm": [3558, 518], "40mm": [3920, 518], "50Mm": [5110, 672], "50mm": [5110, 672] });
  });

  it("item 2 (D3): a cladding named in the row's OWN text but answered 'None' now refuses for a person -- 9 rows; the 8 NEGATIVE rows (heading-only notes, a 'No' answer, 'GSS' = the duct) keep their outcome", () => {
    const d3 = results.filter((x) => x.r.fixes.includes("D3"));
    expect(d3.map((x) => x.r.id).sort()).toEqual([
      "BOQ-26-00017|Lowside #94", "BOQ-26-00020|HVAC_-19TH FLOOR#515", "BOQ-26-00108|HVAC#420", "BOQ-26-00117|HVAC BOQ #189",
      "BOQ-26-00137|LOWSIDE OFFICE WORKS#128", "BOQ-26-00140|HVAC Lowside Works #59", "BOQ-26-00149|HVAC-BOQ#439", "BOQ-26-00164|BOQ#136", "BOQ-26-00197|HVAC BOQ #199",
    ]);
    for (const x of d3) {
      expect(x.out!.priced, x.r.id).toBe(false);
      const d9b = x.r.fixes.includes("D9b");
      const d11 = x.r.fixes.includes("D11");
      if (d11) expect(x.out!.reason, x.r.id).toMatch(/^No SKU in the catalogue for /);            // the material refusal shows first (D11)
      else if (d9b) expect(x.out!.reason, x.r.id).toBe("glass cloth is not offered on sheet insulation - price this row by hand");
      else expect(x.out!.reason, x.r.id).toBe("cladding named in this row but not read - set the cladding");
    }
    for (const x of results.filter((y) => y.r.fixes.includes("D3-NEGATIVE"))) {
      expect(x.out!.priced, x.r.id).toBe(x.r.before_12d3.priced);
      if (x.r.before_12d3.priced) expect([x.out!.supply, x.out!.install], x.r.id).toEqual([x.r.before_12d3.totals!.supply_rate, x.r.before_12d3.totals!.install_rate]);
      else expect(x.out!.reason, x.r.id).toBe(x.r.before_12d3.reason);
    }
  });

  it("item 3 (D7): the EPDM rows and the listed materials refuse BY NAME whatever family the model picked -- the 6 priced EPDM rows, the 3 XLPE rows and the mineral-wool row among them", () => {
    const d7 = results.filter((x) => x.r.fixes.includes("D7"));
    expect(d7.length).toBe(16);   // the 11 EPDM rows, 3 XLPE, 1 mineral wool, 1 stonewool
    const wasPriced = d7.filter((x) => x.r.before_12d3.priced).map((x) => x.r.id).sort();
    expect(wasPriced).toEqual([
      "BOQ-26-00029|HVAC WORK#269", "BOQ-26-00029|HVAC WORK#270", "BOQ-26-00029|HVAC WORK#271", "BOQ-26-00029|HVAC WORK#275", "BOQ-26-00029|HVAC WORK#276", "BOQ-26-00029|HVAC WORK#277",
      "BOQ-26-00086|Low side#64", "BOQ-26-00086|Low side#65", "BOQ-26-00086|Low side#67", "BOQ-26-00087|HVAC#32",
    ]);
    for (const x of d7) {
      expect(x.out!.priced, x.r.id).toBe(false);
      expect(x.out!.reason, x.r.id).toMatch(/^No SKU in the catalogue for .* - price this row by hand$/);
      // material_as_written is a hidden fact fed in `full` mode, so both paths refuse alike -- except on the
      // no-unit row (#263), where the calculator is fed a unit the row lacks (the named C_unit_not_offered class)
      if (!EXPECTED_DIVERGENCE_ROWS.some((d) => d.id === x.r.id)) expect(x.run.divergences, x.r.id).toEqual([]);
    }
  });

  it("item 4 (D4): '25 mm thick - 2 Layers' prices as TWO 25 mm layers where the pipe is stocked; above 53.98 it still refuses on the pipe (R9); the range-preamble row still refuses on its pipe range", () => {
    const d4 = results.filter((x) => x.r.fixes.includes("D4"));
    expect(d4.length).toBe(6);
    const byId = new Map(d4.map((x) => [x.r.id, x]));
    for (const id of ["BOQ-26-00234|(CHW BOQ) AHU & Low Side#135", "BOQ-26-00234|(CHW BOQ) AHU & Low Side#136"]) {   // 50 / 40 mm dia
      const x = byId.get(id)!;
      expect(x.out!.priced, id).toBe(true);
      expect(x.out!.working0, id).toBe("BoQ says 25 mm thick - 2 Layers -> priced as two layers, 25 + 25 mm (50 mm); cladding on the outer layer only");
      // ONE user block (the composition's layers are priced items under it); the field shows the model's own "None"
      expect(x.out!.layers, id).toEqual(["25/None"]);
    }
    // stated in advance from the product's own run: two 25 mm Nitrile Rubber layers, cladding No, at 53.98 / 41.28
    const f = (id: string) => [byId.get(id)!.out!.supply, byId.get(id)!.out!.install];
    expect(f("BOQ-26-00234|(CHW BOQ) AHU & Low Side#135")).toEqual([746, 28]);
    expect(f("BOQ-26-00234|(CHW BOQ) AHU & Low Side#136")).toEqual([676, 28]);
    for (const id of ["BOQ-26-00234|(CHW BOQ) AHU & Low Side#132", "BOQ-26-00234|(CHW BOQ) AHU & Low Side#133", "BOQ-26-00234|(CHW BOQ) AHU & Low Side#134"]) {   // 100 / 80 / 65
      expect(byId.get(id)!.out!.reason, id).toMatch(/^item 1 \(Nitrile Rubber Insulation\): pipe size \d+ is above the largest size on the sheet \(53\.98\)$/);
    }
    expect(byId.get("BOQ-26-00140|HVAC Lowside Works #471")!.out!.reason).toMatch(/several values stated for pipe size/);
  });

  it("item 5 (D9b, as corrected by 12d-4aF): a SHEET-FAMILY row with glass cloth refuses with the ruled sentence -- by the value read, or by the row's own words -- unless a named material refuses first; a Cladding Only per-sq.m row with glass cloth PRICES at the plain rate again (the 12c F2 figure, 294 / 70)", () => {
    const d9b = results.filter((x) => x.r.fixes.includes("D9b"));
    expect(d9b.length).toBe(10);
    const SHEET = ["Thermal Nitrile Insulation", "Acoustic Nitrile Insulation", " Fiberglass Rigid Board Insulation, Density 48Kg/m3"];
    const famOf = (x: typeof d9b[number]) => x.r.answer?.items?.[0]?.attributes?.item?.value ?? null;
    const sheet = d9b.filter((x) => SHEET.includes(famOf(x) ?? ""));
    const claddingOnly = d9b.filter((x) => famOf(x) === "Cladding Only");
    expect(sheet.map((x) => x.r.id).sort()).toEqual(["BOQ-26-00020|HVAC_-19TH FLOOR#515", "BOQ-26-00100|HVAC #111", "BOQ-26-00140|HVAC Lowside Works #59"]);
    expect(claddingOnly.map((x) => x.r.id).sort()).toEqual([
      "BOQ-26-00086|Low side#68", "BOQ-26-00098|Lowside#173", "BOQ-26-00140|VRF WORKS #95", "BOQ-26-00158|ADS BOQ#67", "BOQ-26-00233|Critical VRF System#41", "BOQ-26-00233|VRF System#65",
    ]);
    for (const x of sheet) {
      expect(x.out!.priced, x.r.id).toBe(false);
      expect(x.out!.reason, x.r.id).toBe("glass cloth is not offered on sheet insulation - price this row by hand");
    }
    for (const x of claddingOnly) {
      expect(x.out!.priced, x.r.id).toBe(true);
      expect(x.out!.reason ?? null, x.r.id).toBeNull();
      // the 12c F2 figures, exactly as the 12d-3 audit recorded them before 12d-4a's over-reach
      expect([x.out!.supply, x.out!.install], x.r.id).toEqual([x.r.before_12d3.totals!.supply_rate, x.r.before_12d3.totals!.install_rate]);
    }
    expect(claddingOnly.filter((x) => x.r.answer?.items?.[0]?.attributes?.cladding?.value === "Glass Cloth with paint").map((x) => [x.out!.supply, x.out!.install]))
      .toEqual([[294, 70], [294, 70], [294, 70], [294, 70], [294, 70]]);
    const d7 = d9b.filter((x) => x.r.fixes.includes("D7"));
    expect(d7.map((x) => x.r.id)).toEqual(["BOQ-26-00086|Low side#74"]);
    expect(d7[0].out!.reason).toMatch(/^No SKU in the catalogue for /);
  });

  it("item 6 (D10): the two 'QRO - Sqm.' rows price per sq.m with the rate-only note", () => {
    const d10 = results.filter((x) => x.r.fixes.includes("D10"));
    expect(d10.length).toBe(2);
    for (const x of d10) {
      expect(x.out!.priced, x.r.id).toBe(true);
      expect(x.out!.unitNote, x.r.id).toBe("BoQ says QRO - Sqm. (rate only) -> priced per sq.m, the catalogue's unit for this item");
    }
    expect(d10.map((x) => [x.out!.supply, x.out!.install])).toEqual([[1258, 154], [594, 154]]);   // 10 -> 13 acoustic; 19 thermal
  });

  it("item 7 (D11): on the two no-unit rows the named-material refusal shows FIRST", () => {
    const d11 = results.filter((x) => x.r.fixes.includes("D11"));
    expect(d11.map((x) => x.out!.reason).sort()).toEqual([
      "No SKU in the catalogue for Eco+ PIR Panels - price this row by hand",
      "No SKU in the catalogue for fibreglass board having density 80kg/cu.m, laminated with aluminium foil on one side and layers of black glass cloth on the other side - price this row by hand",
    ]);
    for (const x of d11) expect(x.r.before_12d3.reason, x.r.id).toBe("no unit on this row (R12)");
  });

  it("CONTROL rows are unchanged (00137 r39 615/224; 00169 r297 500/154; 00003 r158 464/154; 00140 r479 238/14)", () => {
    const c = results.filter((x) => x.r.fixes.includes("CONTROL"));
    expect(c.map((x) => [x.out!.supply, x.out!.install])).toEqual(c.map((x) => [x.r.before_12d3.totals!.supply_rate, x.r.before_12d3.totals!.install_rate]));
  });

  it("PARITY (owner P1): EXACTLY the named rows diverge; on the NEW row-text class the panel refuses while the calculator prices; every other named row is a pre-existing class", () => {
    const seen = results.filter((x) => x.run.divergences.length).map((x) => x.r.id).sort();
    expect(seen).toEqual(EXPECTED_DIVERGENCE_ROWS.map((d) => d.id).sort());
    const cause = new Map(EXPECTED_DIVERGENCE_ROWS.map((d) => [d.id, d.cause]));
    for (const x of results.filter((y) => y.run.divergences.length)) {
      if (cause.get(x.r.id)!.startsWith("F_row_text_not_an_input")) {
        expect(view(x.run).rowPriced, x.r.id).toBe(false);
        expect(isSuggestion(x.run.calculator) && (x.run.calculator as ItemListSuggestion).itemList!.rowPriced, x.r.id).toBe(true);
      }
    }
    expect(EXPECTED_DIVERGENCE_ROWS.filter((d) => d.cause.startsWith("F_")).length).toBe(8);
  });
});
