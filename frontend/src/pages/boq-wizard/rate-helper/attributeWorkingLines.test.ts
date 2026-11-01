// ELR-2 AC1 / AC2 / AC7 (owner R-SCOPE "7- ok", R-WORD "6 ok", R-MISC; the Phase A answer 2026-10-28: D1-D8, C1-C3,
// today's item text, Q3 (a), Q4 (a)): the attribute path's working lines read in plain English, on the panel AND the
// calculator, and THE PERMANENT SWEEP -- no internal name on any Electrical-engine working line.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import {
  calculatorHelper,
  disciplineOf,
  feedFromPanel,
  readJsonFixture,
  skuCasesForCategory,
  emptyCaseFor,
  type ParityCase,
} from "@/pages/pricing/calculatorPanelParity.harness";
import { calculatorCtx } from "@/pages/pricing/PricingCalculator";
import type { RateCategoryConfig, RateMasterItem, StepTrace } from "@/pages/pricing/rate-master/rateMasterTypes";
import { attributeWorkingLine, componentLabel, pricingInputLine, UNNAMED_INPUT } from "./attributeWorkingLines";
import { makePricingSheetHelper } from "./pricingSheetHelper";
import { mergeItemsByName } from "./rateHelperPlumbing";
import { isSuggestion, type HelperResult } from "./rateHelperTypes";

type AssetFile = { discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] };
const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
// the assets this slice ships against, NAMED: Electrical v68 (the notes + display labels) and HVAC v54 (the two aliases)
const elec = readJsonFixture<AssetFile>(pathToFileURL(path.join(DATA, "rate_master_electrical_all_v68.json")));
const hvac = readJsonFixture<AssetFile>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v54.json")));
const items: RateMasterItem[] = mergeItemsByName(
  elec.items.map((i) => ({ ...i, discipline: "Electrical" }) as RateMasterItem),
  hvac.items.map((i) => ({ ...i, discipline: "HVAC" }) as RateMasterItem),
);
const configs = new Map<string, RateCategoryConfig>([
  ...elec.category_configs.map((c) => [c.category_id, { ...c, discipline: "Electrical" }] as [string, RateCategoryConfig]),
  ...hvac.category_configs.map((c) => [c.category_id, { ...c, discipline: "HVAC" }] as [string, RateCategoryConfig]),
]);
const piRow = (item: string) => items.find((i) => i.kind === "electrical_pricing_input" && i.attributes?.item === item)!;
const SNAKE = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/;

/**
 * THE APPROVED TEMPLATES (ELR-R0 "InternalNames" + the Phase A answer), one entry per line shape. A working line is
 * classified by the FIRST template it matches; a line matching none is "other", and "other" must be 0.
 */
const PCT = String.raw`\d+(\.\d+)?%`;
const AMT = String.raw`\d[\d,]*(\.\d+)?`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PI_SUBJECTS = [
  "Cable tray supply markup", "Cable tray floor-cutting installation markup", "Cable tray discount", "Cable tray installation markup",
  "Conduit discount", "Conduit supply markup", "Conduit installation share",
  "Switchgear discount", "Switchgear supply markup", "DB installation share",
  "Earthing supply markup", "Earthing installation markup",
  "Industrial socket discount", "Industrial socket supply markup", "Industrial socket installation share",
  "Junction box supply markup", "Junction box installation share", "Junction box discount",
  "Lighting management system supply markup", "Miscellaneous supply BCS ratio",
  "Unarmoured cable discount", "Unarmoured cable supply markup", "Cable installation markup",
  "Switch & socket discount", "Switch & socket supply markup", "Switch & socket installation share",
  "Point wiring switch installation share", "Point wiring accessory installation share", "Pop-up box module installation share",
];
const PI_AMOUNTS = ["Cable tray ceiling accessories", "Cable tray floor refilling", "Cable tray floor cutting"];
const COMPONENT_LABELS = [
  "DB (shell)", "MCB 1", "MCB 2", "MCB 3", "MCB 4", "MCB 5", "Enclosure", "Paired MCB", "Socket", "Switch",
  "Socket 1", "Socket 2", "Socket 3", "Socket 4", "Frame/Face plate", "Back box", "Blank plate", "Conduit",
  "Wire 1", "Wire 2", "Circuit wire 1", "Circuit wire 2",
];
const TEMPLATES: Array<{ id: string; re: RegExp }> = [
  ...PI_SUBJECTS.map((s) => ({ id: `PI ${s}`, re: new RegExp(`^${esc(s)} = ${PCT}$`) })),
  ...PI_AMOUNTS.map((s) => ({ id: `PI ${s}`, re: new RegExp(`^${esc(s)} \\(Rs per metre\\) = Rs ${AMT} per metre$`) })),
  ...COMPONENT_LABELS.map((l) => ({ id: `component ${l}`, re: new RegExp(`^${esc(l)}: .+ x \\d+(\\.\\d+)? = ${AMT}$`) })),
  // ELR-4b (owner (g), 2026-10-29) INVERTED: WAS only "Bus bar = <amount>" ("Bus bar = 0" when Without); NOW Without
  // reads "Bus bar: not included" and With keeps "Bus bar = <amount>" (elr4bBusBar.test.ts pins both ways)
  { id: "formula Bus bar", re: new RegExp(`^Bus bar( = ${AMT}|: not included)$`) },
  // wiring & cabling / HVAC Cables: the pair sentence computeWiring has always written (plain English, unchanged)
  { id: "wiring matched row", re: /^Matched (cable|termination) rate row for .+\.$/ },
];
const classify = (line: string) => TEMPLATES.find((t) => t.re.test(line))?.id ?? "other";

/** Every working line the panel SHOWS on the attribute path: each section's matched rows (the lines this slice words). */
function matchedLines(r: HelperResult): string[] {
  if (!isSuggestion(r)) return [];
  return (r.workings.sections ?? []).flatMap((g) => g.matchedRows ?? []);
}
/** Every line the section blocks show (matched rows AND derivation) -- the no-internal-name sweep reads all of them. */
function shownLines(r: HelperResult): string[] {
  if (!isSuggestion(r)) return [];
  const w = r.workings;
  return w.sections && w.sections.length ? w.sections.flatMap((g) => [...(g.matchedRows ?? []), ...g.derivation]) : [...w.matchedRows, ...w.derivation];
}
type Cells = Record<string, { value: string | number | null; defaulted?: boolean }>;
function panelOf(cat: string, unit: string, cells: Cells): HelperResult {
  const attributes = Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, { confidence: 1, ...c }]));
  return makePricingSheetHelper({ configsByCategory: configs, items, extractionByRow: new Map([[7, { excelRow: 7, description: "", attributes }]]) } as never)
    .compute({ excelRow: 7, description: "", nodeType: "Line Item", category: cat, discipline: disciplineOf(cat), rateKinds: [], unit } as never);
}
function calculatorOf(cat: string, panel: HelperResult, attrs: ParityCase["attrs"]): HelperResult {
  // an alias (HVAC Raceway) feeds the definitions of the config it prices through -- else its panel-hidden facts are
  // not fed (ELR-R0's alias-feed artifact, a harness gap and not the product's)
  const alias = (configs.get(cat) as { alias_of?: { category_id?: string } } | undefined)?.alias_of?.category_id;
  const feed = feedFromPanel(panel, configs.get(alias ?? cat) ?? null, { cat, unit: "", desc: "", attrs }, "full");
  return calculatorHelper(configs, items).compute(calculatorCtx(disciplineOf(cat) ?? "", cat), feed.overrides);
}

describe("ELR-2 AC1: a Pricing Input line reads the input's OWN name (R-WORD)", () => {
  it("the approved examples, from the items' own names", () => {
    expect(pricingInputLine(piRow("switchgear"), "discount", 0.7)).toBe("Switchgear discount = 70%");
    expect(pricingInputLine(piRow("switchgear"), "supply_markup", 0.65)).toBe("Switchgear supply markup = 65%");
    expect(pricingInputLine(piRow("cable_unarm"), "discount", 0.57)).toBe("Unarmoured cable discount = 57%");
    expect(pricingInputLine(piRow("conduit_share"), "share", 0.2)).toBe("Conduit installation share = 20%");
    expect(pricingInputLine(piRow("cable_install"), "installation_markup", 1)).toBe("Cable installation markup = 100%");
    // R-MISC (owner "it will be used in the BCS leg..let it be"): the line stays, worded so
    expect(pricingInputLine(piRow("misc_supply"), "ratio", 0.8)).toBe("Miscellaneous supply BCS ratio = 80%");
    expect(pricingInputLine(piRow("tray_accessories"), "amount", 106)).toBe("Cable tray ceiling accessories (Rs per metre) = Rs 106 per metre");
    // C2: the input's own name keeps its hyphen
    expect(pricingInputLine(piRow("tray_cutting"), "installation_markup", 0.45)).toBe("Cable tray floor-cutting installation markup = 45%");
  });

  it("a rename on a SCRATCH copy of an input shows on its line with no code change", () => {
    const scratch = structuredClone(piRow("switchgear"));
    scratch.attributes.name = "Panel breaker discount & supply markup";
    expect(pricingInputLine(scratch, "discount", 0.7)).toBe("Panel breaker discount = 70%");
    scratch.attributes.name = "Breaker terms";
    expect(pricingInputLine(scratch, "supply_markup", 0.65)).toBe("Breaker terms supply markup = 65%");
    // and through the product: the pipeline reads the renamed row, the line follows it
    const renamed = items.map((i) => (i === piRow("switchgear") ? { ...i, attributes: { ...i.attributes, name: "Panel breaker discount & supply markup" } } : i));
    const r = makePricingSheetHelper({ configsByCategory: configs, items: renamed, extractionByRow: new Map() } as never)
      .compute(calculatorCtx("Electrical", "db_switchgear"), { db_shell_item: "SPN DB 8WAY", db_shell_qty: "1", mcb1_item: "None", mcb2_item: "None", mcb3_item: "None", mcb4_item: "None", mcb5_item: "None", enclosure_item: "None" });
    expect(matchedLines(r)).toContain("Panel breaker discount = 70%");
    expect(matchedLines(r)).not.toContain("Switchgear discount = 70%");
  });

  it("NEGATIVE: an input with no row, or no name, is a plain '(unnamed input)' line -- never a raw id", () => {
    expect(pricingInputLine(undefined, "discount", 0.7)).toBe(`${UNNAMED_INPUT} = 70%`);
    const blank = structuredClone(piRow("switchgear"));
    blank.attributes.name = "  ";
    expect(pricingInputLine(blank, "discount", 0.7)).toBe(`${UNNAMED_INPUT} = 70%`);
    // a step the config does not declare (an unknown key) falls back the same way, and the sweep below would name it "other"
    const st: StepTrace = { step: "rate_ref", label: "x", runningValues: {}, refItem: "switchgear", produced: { key: "pi_no_such_step", value: 0.7 } };
    const line = attributeWorkingLine(st, { steps: [] } as never, configs.get("db_switchgear")!, items, () => undefined);
    expect(line).toBe(`${UNNAMED_INPUT} = 0.7`);
    expect(line).not.toMatch(SNAKE);
    expect(classify(line)).toBe("other");
  });
});

describe("ELR-2 AC1: a component line takes the bound field's label (R-WORD, D1-D8)", () => {
  const cfg = (id: string) => configs.get(id)!;
  const step = (cid: string, name: string) =>
    Object.values(cfg(cid).pipelines ?? {}).flatMap((p) => (p as { steps: unknown[] }).steps).find((s) => (s as { name?: string }).name === name) as never;

  it("the field the catalogue item is bound to names it (D1, D2, C1)", () => {
    expect(componentLabel(step("db_switchgear", "db_shell"), cfg("db_switchgear"))).toBe("DB (shell)");
    expect(componentLabel(step("db_switchgear", "mcb3"), cfg("db_switchgear"))).toBe("MCB 3");
    expect(componentLabel(step("switches_sockets", "socket2"), cfg("switches_sockets"))).toBe("Socket 2");
    expect(componentLabel(step("switches_sockets", "plate"), cfg("switches_sockets"))).toBe("Frame/Face plate");
  });

  it("a component with no single bound field carries its label on the step in the asset (D3-D7, Q3 (a))", () => {
    for (const [cid, name, label] of [
      ["point_wiring", "wire1", "Wire 1"], ["point_wiring", "circuit_wire2", "Circuit wire 2"], ["point_wiring", "conduit", "Conduit"],
      ["point_wiring", "back_box", "Back box"], ["switches_sockets", "back_box", "Back box"], ["popup_boxes", "blank", "Blank plate"],
      ["industrial_sockets", "socket", "Socket"],
    ]) expect(componentLabel(step(cid, name), cfg(cid)), `${cid}.${name}`).toBe(label);
  });

  it("the quantity is the trace's own number (Q4 (a)); a formula component shows its item alone (D8); no label -> unnamed", () => {
    const pl = { steps: [{ step: "component_ref", name: "mcb2", ref: { kind: "db_switchgear_item", item: "@mcb2_item" }, qty: { from_attr: "mcb2_qty" } }] };
    const st: StepTrace = { step: "component_ref", label: "x", runningValues: {}, refItem: "10A SP MCB D CURVE Switchgear", qty: 6, produced: { key: "mcb2", value: 3696 } };
    expect(attributeWorkingLine(st, pl as never, cfg("db_switchgear"), items, () => undefined)).toBe("MCB 2: 10A SP MCB D CURVE Switchgear x 6 = 3,696");
    const bus = { steps: [{ step: "component_ref", name: "busbar", ref: { kind: "earthing_item", attributes: { type: "Bus bar" } }, formula: "base*factor" }] };
    expect(attributeWorkingLine({ step: "component_ref", label: "x", runningValues: {}, refItem: "Bus bar", produced: { key: "busbar", value: 0 } }, bus as never, cfg("earthing"), items, () => undefined)).toBe("Bus bar = 0");
    const nolabel = { steps: [{ step: "component_ref", name: "thing", ref: { kind: "x", size: "@size" }, qty: 1 }] };
    expect(attributeWorkingLine({ step: "component_ref", label: "x", runningValues: {}, refItem: "PVC 25", qty: 1, produced: { key: "thing", value: 10 } }, nolabel as never, cfg("earthing"), items, () => undefined)).toBe(`${UNNAMED_INPUT} = 10`);
    // amounts in Indian grouping (C3)
    expect(attributeWorkingLine({ ...st, produced: { key: "mcb2", value: 123456.5 } }, pl as never, cfg("db_switchgear"), items, () => undefined)).toBe("MCB 2: 10A SP MCB D CURVE Switchgear x 6 = 1,23,456.5");
  });
});

describe("ELR-2 AC2: THE PERMANENT SWEEP -- no internal name on any Electrical-engine working line", () => {
  const fx = readJsonFixture<{ rows: Array<{ case: number; category: string; unit: string; attributes: Cells }> }>(
    new URL("../../pricing/__fixtures__/elr2WorkingLines.json", import.meta.url));

  it("real stored rows (14, chosen to reach every one of the 80 line kinds): every line on the panel AND the calculator is an approved template", () => {
    const reached = new Map<string, number>();
    const other: string[] = [];
    const perCategory: Record<string, number> = {};
    for (const row of fx.rows) {
      const panel = panelOf(row.category, row.unit, row.attributes);
      const attrs = Object.fromEntries(Object.entries(row.attributes).map(([k, c]) => [k, c.value]));
      for (const [mode, r] of [["panel", panel], ["calculator", calculatorOf(row.category, panel, attrs)]] as const) {
        for (const line of matchedLines(r)) {
          const t = classify(line);
          if (t === "other") other.push(`case ${row.case} ${row.category} ${mode}: ${line}`);
          reached.set(`${row.category}|${t}`, (reached.get(`${row.category}|${t}`) ?? 0) + 1);
          perCategory[`${row.category}|${mode}`] = (perCategory[`${row.category}|${mode}`] ?? 0) + 1;
        }
        for (const line of shownLines(r)) expect(line, `case ${row.case} ${mode}`).not.toMatch(SNAKE);
      }
    }
    expect(other).toEqual([]);
    // NAMED coverage: the categories and modes the sweep read, and how many lines each showed
    expect(Object.keys(perCategory).sort()).toEqual([
      "cabletray_raceway", "conduit_piping", "db_switchgear", "earthing", "hvac_raceway", "industrial_sockets",
      "junction_box_raceway", "lighting_mgmt_system", "miscellaneous", "point_wiring", "popup_boxes", "switches_sockets",
    ].flatMap((c) => [`${c}|calculator`, `${c}|panel`]));
    // every template a category can show is reached (the 80 internal-name lines of the 2026-10-28 replay, by template)
    expect(reached.size).toBe(80); // = the 80 (category, key) lines P2 measured on the replay, one template each
    for (const k of ["db_switchgear|component MCB 5", "point_wiring|component Circuit wire 2", "switches_sockets|component Socket 3",
      "earthing|formula Bus bar", "miscellaneous|PI Miscellaneous supply BCS ratio", "hvac_raceway|PI Cable tray ceiling accessories"]) {
      expect(reached.has(k), k).toBe(true);
    }
  });

  it("every catalogue SKU of every Electrical category (and HVAC Raceway / Cables), panel AND calculator: 0 internal names, 0 'other'", () => {
    const counts: Record<string, number> = {};
    const other: string[] = [];
    for (const cfg of [...elec.category_configs, configs.get("hvac_raceway")!, configs.get("hvac_cables")!]) {
      const cid = cfg.category_id;
      for (const c of [...skuCasesForCategory(configs.get(cid)!, items), emptyCaseFor(cfg)]) {
        const cells = Object.fromEntries(Object.entries(c.attrs).map(([k, v]) => [k, { value: v }]));
        const panel = panelOf(cid, "", cells);
        for (const r of [panel, calculatorOf(cid, panel, c.attrs)]) {
          for (const line of shownLines(r)) expect(line, cid).not.toMatch(SNAKE);
          for (const line of matchedLines(r)) {
            counts[cid] = (counts[cid] ?? 0) + 1;
            if (classify(line) === "other") other.push(`${cid}: ${line}`);
          }
        }
      }
    }
    expect(other).toEqual([]);
    expect(Object.keys(counts).length).toBeGreaterThanOrEqual(8);
  }, 120_000);
});

describe("ELR-2: one mechanism, one call site; the item-list path untouched (AC6)", () => {
  it("pricingSheetHelper builds the attribute path's lines ONLY through attributeWorkingLine", () => {
    const src = fs.readFileSync(path.join(__dirname, "pricingSheetHelper.ts"), "utf-8");
    expect(src).toContain("matchedRows.push(attributeWorkingLine(st, pl as Pipeline, category, items, (a) => selected[a]));");
    expect(src).not.toContain("`${st.produced.key}: ${st.refItem} = ${st.produced.value}`");
  });
  it("the labels module does not use plainPricerText (ELR-R0: it garbles these lines) and names no category", () => {
    const src = fs.readFileSync(path.join(__dirname, "attributeWorkingLines.ts"), "utf-8");
    const code = src.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    expect(code).not.toContain("plainPricerText");
    for (const banned of ["switchgear", "point_wiring", "Electrical", "hvac_", "Wire 1"]) expect(code, banned).not.toContain(banned);
  });
});
