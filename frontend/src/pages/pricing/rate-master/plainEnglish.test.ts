/**
 * SLICE 12d-5 (owner P1 / P2, findings F-C5a / F-C5b) -- the ONE plain-English function, and the proof that
 * nothing a pricer reads on an item-list category carries an internal code or name.
 */
import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { plainPricerText, plainSentence, pricingInputLabel } from "./plainEnglish";
import { plainSentence as reExported } from "./itemListRuleOrder";
import { readJsonFixture } from "../calculatorPanelParity.harness";
import { emptyCaseFor, itemListCasesForCategory, runParity, skuCasesForCategory, type ParityCase } from "../calculatorPanelParity.harness";
import { mergeItemsByName } from "@/pages/boq-wizard/rate-helper/rateHelperPlumbing";
import { itemListPricingSpec } from "@/pages/boq-wizard/rate-helper/itemListPricing";
import { isSuggestion } from "@/pages/boq-wizard/rate-helper/rateHelperTypes";
import type { RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";

const ITEMS = [
  { kind: "hvac_pricing_input", attributes: { item: "alu_sheet_24g", name: "Aluminium sheet 24G" } },
  { kind: "hvac_pricing_input", attributes: { item: "gi_sheet_rate", name: "GI framework sheet" } },
  { kind: "hvac_pricing_input", attributes: { item: "gi_framework_factor", name: "GI framework sheet factor" } },
  { kind: "hvac_insulation_item", attributes: { item: "Cladding Only" } },   // not a pricing input: never a label source
];

describe("12d-5: plainPricerText -- one function, every class of line the owner saw (before -> after)", () => {
  it("F-C5b (00169 r291): the default rule loses its code and its owner tag", () => {
    expect(plainPricerText("R1 cladding not mentioned -> without cladding (owner 2026-10-07)")).toBe("cladding not mentioned -> without cladding");
  });
  it("F-C5b (00117 r82): a code RUN with 'slice 11' is dropped from the front", () => {
    expect(plainPricerText("R1 / slice 11 damper not mentioned (or not answered) = without")).toBe("damper not mentioned (or not answered) = without");
    expect(plainPricerText("R5 / R14 / slice 11 insulation not mentioned (or not answered) = insulated")).toBe("insulation not mentioned (or not answered) = insulated");
    expect(plainPricerText("R14 / S6 UL not mentioned (or not answered) = non-UL")).toBe("UL not mentioned (or not answered) = non-UL");
  });
  it("a working line's default clause keeps the rule, loses the codes", () => {
    expect(plainPricerText("variant not mentioned -> GI rectangular (R14 / slice 11 VCD = GI rectangular; fire damper = without sleeve)"))
      .toBe("variant not mentioned -> GI rectangular (VCD = GI rectangular; fire damper = without sleeve)");
  });
  it("F-C5b (calculator working): a Pricing Input is named by its LABEL, read off the Pricing Inputs row", () => {
    expect(plainPricerText("supply: pricing input: alu_sheet_24g (rate) = 450", ITEMS)).toBe("supply: pricing input: Aluminium sheet 24G (rate) = 450");
    expect(plainPricerText("supply: pricing input: gi_framework_factor (factor) = 0.9", ITEMS)).toBe("supply: pricing input: GI framework sheet factor (factor) = 0.9");
    // with no items the id is written as plain words -- still no internal name
    expect(plainPricerText("supply: pricing input: alu_sheet_24g (rate) = 450")).toBe("supply: pricing input: alu sheet 24g (rate) = 450");
  });
  it("a pipeline id prefix is written as words; a trailing code and a code after a comma go", () => {
    expect(plainPricerText("item_supply: supply: cost x (1 + the SKU's supply markup) (R15) = 10005")).toBe("item supply: supply: cost x (1 + the SKU's supply markup) = 10005");
    expect(plainPricerText("thickness 18.5 is not on the sheet -> 25 (next size up, R6)")).toBe("thickness 18.5 is not on the sheet -> 25 (next size up)");
    expect(plainPricerText("foil on an acoustic row - the catalogue has no foil-faced acoustic insulation; set the cladding (R4)"))
      .toBe("foil on an acoustic row - the catalogue has no foil-faced acoustic insulation; set the cladding");
  });
  it("NEGATIVE: a line already in plain English is byte-identical, and the function is idempotent", () => {
    for (const s of ["   supply: the insulation material's own cost = 255", "      install: ROUNDUP(install, 0) = 154", "BoQ says 50 mm -> priced as 53.98 mm (next size up)", "Row total per 1 Sqm: supply 1371 + install 154", "no torque stated",
                     "Layer 1 of 3 -- supply 1371, install 154", "Rate master: Insulation · 1 item", "cladding per sq.m: the sheet rate as it stands -- no overlap factor", ""]) {
      expect(plainPricerText(s, ITEMS)).toBe(s);
    }
    // a layer's indented step keeps its indentation while losing its code
    expect(plainPricerText("   supply: pricing input: gi_sheet_rate (rate) = 450 (R15)", ITEMS)).toBe("   supply: pricing input: GI framework sheet (rate) = 450");
    const once = plainPricerText("R1 / slice 11 damper not mentioned -> without (R15)", ITEMS);
    expect(plainPricerText(once, ITEMS)).toBe(once);
  });
  it("NEGATIVE: a value that merely LOOKS like a code is kept -- a size, a gauge, a model word", () => {
    expect(plainPricerText("BoQ says 2 slot -> 2 (the sheet's own spelling of this value)")).toBe("BoQ says 2 slot -> 2 (the sheet's own spelling of this value)");
    expect(plainPricerText("26G Aluminium with Glass Cloth")).toBe("26G Aluminium with Glass Cloth");
    expect(plainPricerText("Fiberglass Rigid Board Insulation, Density 48Kg/m3")).toBe("Fiberglass Rigid Board Insulation, Density 48Kg/m3");
    expect(plainPricerText("UL 555 fire damper")).toBe("UL 555 fire damper");
    // a family's LEADING SPACE is part of its name in the catalogue and is kept inside a bracket
    expect(plainPricerText("no SKU for this combination ( Fiberglass Rigid Board Insulation, Density 48Kg/m3: cladding 26G Aluminium)"))
      .toBe("no SKU for this combination ( Fiberglass Rigid Board Insulation, Density 48Kg/m3: cladding 26G Aluminium)");
  });
  it("the 12d-4c pieces are REUSED, not copied: itemListRuleOrder re-exports the same plainSentence; the label resolver is the one function", () => {
    expect(reExported).toBe(plainSentence);
    expect(pricingInputLabel("gi_sheet_rate", ITEMS)).toBe("GI framework sheet");
    expect(pricingInputLabel("gi_sheet_rate")).toBe("gi sheet rate");
    expect(pricingInputLabel("Cladding Only", ITEMS)).toBe("Cladding Only");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// THE NEGATIVE PIN (acceptance 3): every Insulation and ADP SKU case of the 12c-S sweep, through BOTH real
// paths, shows NO internal code and NO snake_case name on any pricer-facing string. The fixture and the
// LATEST HVAC asset are READ at runtime (the heap cliff). Vacuity: switch the pass off in
// `pricingSheetHelper` (plainItemListView) and this goes red on both categories.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════
const DATA_DIR = new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/", import.meta.url);
const latestHvac = () => {
  const files = readdirSync(DATA_DIR).filter((f) => /^rate_master_hvac_all_v\d+\.json$/.test(f));
  files.sort((x, y) => Number(x.match(/_v(\d+)/)![1]) - Number(y.match(/_v(\d+)/)![1]));
  return readJsonFixture<{ category_configs: RateCategoryConfig[] }>(new URL(files[files.length - 1], DATA_DIR));
};
const FIX = readJsonFixture<{ configs: Record<string, RateCategoryConfig | null>; items: Record<string, RateMasterItem[]> }>(new URL("../__fixtures__/parityMaster.json", import.meta.url));
const configs = new Map<string, RateCategoryConfig>(Object.entries(FIX.configs).filter(([, v]) => !!v) as Array<[string, RateCategoryConfig]>);
for (const c of latestHvac().category_configs) configs.set(c.category_id, c);
const items = mergeItemsByName(FIX.items.Electrical ?? [], FIX.items.HVAC ?? []);

const CODE = /\b[RDTS]-?\d{1,2}[a-z]?\b/;
const SLICE = /\bslice \d+/i;
const OWNER = /\(owner/i;
const SNAKE = /\b[a-z0-9]+_[a-z0-9_]+\b/i;

/** Every string the panel or the calculator shows a pricer, with its site. */
function displayStrings(res: unknown): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (!isSuggestion(res as any)) { const rsn = (res as any)?.reason; if (rsn) out.push(["none.reason", String(rsn)]); return out; }
  const r = res as any;
  const lineText = (l: any) => (typeof l === "string" ? l : (l?.label ?? l?.text ?? JSON.stringify(l)));
  out.push(["basis", String(r.basis ?? "")]);
  for (const l of r.workings?.derivation ?? []) out.push(["workings.derivation", lineText(l)]);
  const il = r.itemList;
  if (il) {
    if (il.reason) out.push(["itemList.reason", il.reason]);
    if (il.unitNote) out.push(["itemList.unitNote", il.unitNote]);
    for (const b of il.items ?? []) {
      if (b.reason) out.push(["block.reason", b.reason]);
      if (b.skuLine) out.push(["block.skuLine", b.skuLine]);
      if (b.familyDefaulted?.rule) out.push(["block.familyDefaulted.rule", b.familyDefaulted.rule]);
      for (const l of b.working ?? []) out.push(["block.working", lineText(l)]);
      for (const f of b.fields ?? []) {
        if (f.rule) out.push(["field.rule", f.rule]);
        if (f.note) out.push(["field.note", f.note]);
        if (f.label) out.push(["field.label", f.label]);
        for (const h of f.matchHelp ?? []) out.push(["field.matchHelp", String(h)]);
      }
    }
  }
  return out;
}
const offenders = (t: string) => [CODE.test(t) && "code", SLICE.test(t) && "slice", OWNER.test(t) && "owner", SNAKE.test(t) && "snake"].filter(Boolean) as string[];

describe("12d-5 NEGATIVE PIN: no internal code or name on the panel or the calculator for every Insulation and ADP SKU of the 12c-S sweep (12e-2: and Piping)", () => {
  for (const cid of ["hvac_insulation", "hvac_adp", "hvac_piping"]) {
    it(`${cid}: every display string of every case, both paths`, () => {
      const cfg = configs.get(cid)!;
      expect(itemListPricingSpec(cfg), cid).toBeTruthy();
      const cases: ParityCase[] = itemListCasesForCategory(cfg, items);
      expect(cases.length).toBeGreaterThan(5);
      const bad: string[] = [];
      let seen = 0;
      for (const c of cases) {
        const run = runParity(configs, items, c, "full");
        for (const [side, res] of [["panel", run.panel], ["calculator", run.calculator]] as const) {
          for (const [site, text] of displayStrings(res)) {
            seen++;
            const why = offenders(text);
            if (why.length) bad.push(`${side}.${site} [${why.join(",")}]: ${text}`);
          }
        }
      }
      expect(seen).toBeGreaterThan(50);
      expect(bad).toEqual([]);
    });
  }
  it("the sweep's own vocabulary still prices (the pass changes text, never a figure): a Cladding Only per-sq.m row is 294 / 70 on both paths", () => {
    // the 12d-4c E2E-1 row shape (00233 #41 / #65): a model answer of Cladding Only + Glass Cloth with paint, per sq.m
    const c = { cat: "hvac_insulation", unit: "Sqm", desc: "Fiber glass cloth and two layers of shield coating on insulation of VRF piping", attrs: {}, headings: [],
                items: [{ item: "Cladding Only", cladding: "Glass Cloth with paint", thickness_mm: "None", pipe_size_mm: "None" }] } as unknown as ParityCase;
    const run = runParity(configs, items, c, "full");
    expect((run.panel as any).values).toEqual({ supply_rate: 294, install_rate: 70, combined_rate: 364 });
    expect((run.calculator as any).values).toEqual({ supply_rate: 294, install_rate: 70, combined_rate: 364 });
    const working = (run.panel as any).itemList.items[0].working.join("\n");
    expect(working).toMatch(/pricing input: Glass cloth \(rate\) = 200/);
    expect(working).not.toMatch(/glass_cloth|alu_sheet/);
  });
  it("NEGATIVE: an Electrical case still carries nothing of the item-list view -- the pass has no site on that path", () => {
    const cfg = configs.get("db_switchgear")!;
    const c = [...skuCasesForCategory(cfg, items), emptyCaseFor(cfg)][0];
    const run = runParity(configs, items, c, "full");
    expect((run.panel as any).itemList).toBeUndefined();
    expect((run.calculator as any).itemList).toBeUndefined();
  });
});
