/**
 * SLICE 12d-2 -- THE PAID SAMPLE, THROUGH BOTH REAL PATHS (owner S2 / S7 / item 6 / item 7).
 *
 * Every Insulation row of the two sampled BoQs, with the REAL payload the product built (`extraction._ai_item`)
 * and the REAL model answer the active `BoQ Rate Suggestion Run` stored on 2026-10-07 -- no hand-written
 * answer anywhere. The PANEL path is `makePricingSheetHelper` over that stored row; the CALCULATOR path is
 * `PricingCalculator`'s construction fed what the panel shows (`runParity`). Owner S7 / P1: calculator = panel
 * ALWAYS; a divergence is recorded BY NAME in `AWAITING_SAMPLE_DIVERGENCES` and the suite passes only if
 * EXACTLY those differ -- never fixed in this slice.
 *
 * The per-row OUTCOME (priced figures, or the refusal, and which rule fired) is pinned from the product's own
 * pricing on the asset that went live (v29), so a later change to any rule the sample exercises is loud.
 *
 * ⚠️ A big fixture is READ at runtime, never `import`ed.
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import HVAC_V29 from "../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v29.json";
import type { RateCategoryConfig, RateMasterItem } from "./rate-master/rateMasterTypes";
import { isSuggestion } from "../boq-wizard/rate-helper/rateHelperTypes";
import { isEligibleConfig, type ItemListSuggestion } from "../boq-wizard/rate-helper/pricingSheetHelper";
import { readJsonFixture, runParity, type ParityCase, type ParityRun } from "./calculatorPanelParity.harness";

interface FixtureRow {
  id: string; boq: string; sheet: string; excel_row: number; unit: string | null; description: string; headings: string[];
  payload: { id: number; description: string; ancestor_chain: unknown[] };
  answer: { items: Array<{ attributes: Record<string, { value: string | null; confidence?: number }> }> };
  answer_note: string;
  item_flags?: unknown;
}
interface ExpectedRow {
  id: string;
  priced: boolean;
  supply?: number;
  install?: number;
  reason?: string;
  family?: string[];
  defaulted?: string[];
  working0?: string;
}

const ROWS = readJsonFixture<FixtureRow[]>(new URL("./__fixtures__/insulation12d2Sample.json", import.meta.url));
const EXPECTED = process.env.WRITE_12D2_EXPECTED ? [] as ExpectedRow[] : readJsonFixture<ExpectedRow[]>(new URL("./__fixtures__/insulation12d2Expected.json", import.meta.url));
const ASSET = HVAC_V29 as unknown as { items: RateMasterItem[]; category_configs: RateCategoryConfig[] };
const CAT = "hvac_insulation";
const CFG = ASSET.category_configs.find((c) => c.category_id === CAT)!;
const CONFIGS = new Map([[CAT, CFG]]);

/** Divergences the sample found, BY NAME, awaiting the owner (S7: recorded, never fixed here). */
export const AWAITING_SAMPLE_DIVERGENCES: ReadonlyArray<{ id: string; what: string; panel: string; calculator: string; cause: string }> = [
  /**
   * BOQ-26-00169 r290 -- "Acoustic insulation of AHU plant room walls using 50mm thick open cell nitril rubber in GI
   * frame work ... 22 G GSS Powder coated Perforated sheet". The model answered cladding = "GI Framework with
   * perforated Al sheet" (the second opinion flagged it: the row says GSS, not aluminium). BOTH surfaces REFUSE the
   * row; only the SENTENCE differs. The panel prices the model's value and names the unstocked combination; the
   * calculator's cladding dropdown for Acoustic Nitrile is built from that family's SKUs (owner V1), none of which
   * carries a GI framework, so the value cannot be carried across and the calculator refuses for a missing cladding.
   * CAUSE: an input the calculator has no control for (the 12c-P "input-surface difference" class, counted and
   * reported, never quietly supplied). Owner S7: recorded in full, awaiting the owner, NOT fixed in 12d-2.
   */
  {
    id: "BOQ-26-00169#290", what: "item blocks",
    panel: '[{"family":"Acoustic Nitrile Insulation","state":"blank","reason":"no SKU for this combination (Acoustic Nitrile Insulation: cladding GI Framework with perforated Al sheet)","figures":"supply_rate=- install_rate=- combined_rate=-","qty":"1"}]',
    calculator: '[{"family":"Acoustic Nitrile Insulation","state":"blank","reason":"could not tell cladding","figures":"supply_rate=- install_rate=- combined_rate=-","qty":"1"}]',
    cause: "C_option_not_offered: the model-read cladding is not a stocked option of the family, so the calculator cannot carry it",
  },
  {
    id: "BOQ-26-00169#290", what: "item row reason",
    panel: "no SKU for this combination (Acoustic Nitrile Insulation: cladding GI Framework with perforated Al sheet)",
    calculator: "could not tell cladding",
    cause: "C_option_not_offered: the model-read cladding is not a stocked option of the family, so the calculator cannot carry it",
  },
];

function caseOf(r: FixtureRow): ParityCase {
  return {
    cat: CAT, unit: r.unit ?? "", desc: r.description, attrs: {}, headings: r.headings,
    items: r.answer.items.map((it) => Object.fromEntries(Object.entries(it.attributes).map(([k, v]) => [k, v.value]))),
  };
}
const run = (r: FixtureRow): ParityRun => runParity(CONFIGS, ASSET.items, caseOf(r), "full");
function view(r: ParityRun) {
  if (!isSuggestion(r.panel)) throw new Error(`panel declined: ${JSON.stringify(r.panel)}`);
  return (r.panel as ItemListSuggestion).itemList!;
}

describe("the sample is REAL and runs on the asset that went live", () => {
  it("25 rows from two BoQs, every one with a real payload and a stored model answer; v29 is eligible with no admission key", () => {
    expect(ROWS.length).toBe(25);
    expect(new Set(ROWS.map((r) => r.boq))).toEqual(new Set(["BOQ-26-00137", "BOQ-26-00169"]));
    for (const r of ROWS) {
      expect(r.payload.id).toBe(r.excel_row);
      expect(r.payload.description).toBe(r.description);
      expect(r.answer_note).toBe("REAL model answer from the active run");
      expect(r.answer.items.length).toBeGreaterThan(0);
    }
    expect((CFG as { calculator_only?: unknown }).calculator_only).toBeUndefined();
    expect(Object.keys(CFG.pipelines ?? {})).toEqual([]);
    expect(isEligibleConfig(CFG)).toBe(true);
    if (!process.env.WRITE_12D2_EXPECTED) expect(EXPECTED.map((e) => e.id)).toEqual(ROWS.map((r) => r.id));
  });
});

describe("PARITY (owner S7 / P1): every sampled row through BOTH paths", () => {
  const results = ROWS.map((r) => ({ r, run: run(r) }));

  it("EXACTLY the named divergences differ -- no more, and no fewer", () => {
    const seen = results.flatMap(({ r, run: x }) => x.divergences.map((d) => `${r.id} :: ${d.what} :: P[${d.panel}] C[${d.calculator}]`));
    const named = AWAITING_SAMPLE_DIVERGENCES.map((d) => `${d.id} :: ${d.what} :: P[${d.panel}] C[${d.calculator}]`);
    expect(seen.sort()).toEqual(named.sort());
  });

  it("each row's OUTCOME is the one pinned from the product's own pricing on v29 (figures, refusal, rule)", () => {
    const got = results.map(({ r, run: x }) => {
      const v = view(x);
      const o: ExpectedRow = { id: r.id, priced: v.rowPriced };
      if (v.rowPriced) { o.supply = v.totals?.supply_rate; o.install = v.totals?.install_rate; }
      else o.reason = v.reason;
      o.family = v.items.map((b) => b.family ?? "(none)");
      o.defaulted = v.items.flatMap((b, i) => b.fields.filter((f) => f.defaulted).map((f) => `${i}:${f.id}=${f.value}`));
      const w0 = v.items[0]?.working?.[0];
      if (w0 && /^(BoQ says|You typed)/.test(w0)) o.working0 = w0;
      return o;
    });
    if (process.env.WRITE_12D2_EXPECTED) {
      // ONE-OFF MEASUREMENT MODE (the slice's own instrument, never CI): write the product's outcomes as the
      // expected table, so the pins below are the product's figures on v29, stated before the panel was opened.
      writeFileSync(new URL("./__fixtures__/insulation12d2Expected.json", import.meta.url), JSON.stringify(got, null, 1) + "\n");
      return;
    }
    expect(got).toEqual(EXPECTED);
  });

  it("the S3 check: on every row whose OWN text states a thickness, the thickness used is that value", () => {
    // The sampled rows state their thickness in the row text on BOQ-26-00169 (acoustic / thermal / underdeck rows)
    // and in the heading schedule on BOQ-26-00137 (pipe rows); the model's answer carries what it read and the
    // pricing uses the model's answer -- so the check is: a row's own number never loses to a heading's.
    for (const { r, run: x } of results) {
      const own = (r.description.match(/(\d+(?:\.\d+)?)\s*mm\s*(?:thk|thick)/i) || [])[1];
      if (!own) continue;
      const v = view(x);
      const t = v.items[0]?.fields.find((f) => f.id === "thickness_mm");
      if (!t) continue;
      // the field shows the value the pricing USED (the ladder result, or the stated text on a refusal); a hop
      // away from the stated number is reported in the note, never silently -- so either the used value is the
      // row's own number, or the note names that number as the one requested
      const used = Number(String(t.value).replace(/[^0-9.]/g, ""));
      const named = (t.note ?? "").includes(own);
      expect(used === Number(own) || named, `${r.id}: own ${own}, used ${t.value}, note ${t.note ?? ""}`).toBe(true);
    }
  });
});
