/**
 * VAV-2a2 R7 / B7 (ADDED; owner 2026-11-15 11:46 "price as thermowell", the tags "owner chose A"; 2026-11-19 18:16 "a) the next VAV
 * slice"; QR-V (a) 2026-11-20 00:10) -- THE SMALL VALVE FIXES, through the panel's entry point on the newest asset's Valve Package
 * config with the v78 Valve changes applied to a SCRATCH COPY (vav2a2.harness `withV78Valve`).
 *  - "Thermowell with Valve": the four stored rows (BOQ-26-00140 r562, 00234 r222, 00261 r125, 00273 r222) carry the model's items as
 *    stored (pinned here from the replay dump): a sizeless "Valve" + the Misc Test Plug / Thermowell -> today NOT priced ("no valve size
 *    stated"); with E13 -> the thermowell alone, 720 + 100, with its note.
 *  - the "(owner QR-2)" / "(owner VR9)" tags are gone from the scope notes.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig } from "../../pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { CODE_RULES, derivationCoverage } from "../../pricing/rate-master/derivationCoverage";
import { itemListRuleOrder } from "../../pricing/rate-master/itemListRuleOrder";
import { buildExtractionByRow, makePricingSheetHelper, type ItemListSuggestion } from "./pricingSheetHelper";
import { BY_ID, ITEMS, surfaceMap } from "./vav1Vav.harness";
import { withV78Valve } from "./vav2a2.harness";

const VALVE = "hvac_valve_package";
const KINDS = ["supply_rate", "install_rate", "combined_rate"];
const c = (value: unknown, confidence = 0.9) => ({ value, confidence });
/** the model's items of BOQ-26-00234 r222 as stored (00261 r125 and 00273 r222 carry the same; 00140 r562 the same words) */
const STORED = [
  { attributes: { valve_type: c("none of these", 0.6), valve_type_as_written: c("Valve", 0.7), size_mm: c(null, 0), actuation: c("None"), operation: c("None"),
    nrv_type: c("None"), spindle: c("None"), strainer_type: c("None"), flanged: c("None"), operator_as_written: c(null, 0), qty_per_row_unit: c("None"),
    scope: c("Supply + installation") } },
  { section: "misc", attributes: { item: c("Test Plug / Thermowell"), item_as_written: c("Thermowell"), size_mm: c(null, 0) } },
];
function row(desc: string, items: unknown[], cfg: RateCategoryConfig = withV78Valve(BY_ID.get(VALVE)!)): ItemListSuggestion {
  const m = surfaceMap(); m.set(VALVE, cfg);
  const h = makePricingSheetHelper({ configsByCategory: m, items: ITEMS, extractionByRow: buildExtractionByRow([{ excel_row: 222, description: desc, category_id: VALVE, attributes: {}, items }] as never) });
  return h.compute({ excelRow: 222, description: desc, nodeType: "Line Item", category: VALVE, discipline: "HVAC", rateKinds: KINDS, unit: "Nos",
    headings: ["CHILLED WATER PIPING WORKS"], ownNotes: [], headingNotes: [] } as never, {}) as unknown as ItemListSuggestion;
}
const tot = (s: ItemListSuggestion) => [s.itemList?.totals?.supply_rate ?? null, s.itemList?.totals?.install_rate ?? null];
const TW = "Supply & Installation of Thermowell with Valve";

describe("VAV-2a2 R7 - 'Thermowell with Valve' is priced as the thermowell (QR-V (a))", () => {
  it("POSITIVE (the stored items of the four rows): the thermowell alone, 720 + 100, with the note; no valve item", () => {
    const s = row(TW, STORED);
    expect(s.itemList?.rowPriced).toBe(true);
    expect(tot(s)).toEqual([720, 100]);
    const all = JSON.stringify(s.itemList);
    expect(all).toContain("BoQ asks for \\\"Thermowell with Valve\\\" -> priced as the thermowell (Test Plug / Thermowell); no valve item");
    expect(all).not.toContain("no valve size stated");
  });
  it("NEGATIVE (the code net taken out = the stored row today): the same items -> NOT priced, 'no valve size stated'", () => {
    const s = row("Supply & Installation of Thermowell", STORED.slice(0, 1).concat([STORED[1]]));
    // the row's own words no longer say "with valve": the net does not run, the sizeless valve refuses as before
    expect(s.itemList?.rowPriced).toBe(false);
    expect(JSON.stringify(s.itemList)).toContain("no valve size stated");
  });
  it("EDGE: a valve WITH a size of its own beside the words is left as read (only the sizeless valve folds into the thermowell)", () => {
    const sized = structuredClone(STORED) as unknown as Array<{ attributes: Record<string, { value: unknown; confidence: number }> }>;
    sized[0].attributes.valve_type = c("Ball Valve"); sized[0].attributes.size_mm = c("25 mm");
    const s = row(TW, sized);
    expect(s.itemList?.items?.map((b) => b.family)).toContain("Ball Valve");
  });
  it("the net reads the row's OWN words: 'thermometer with thermowell' or a heading alone does not fire it", () => {
    expect(JSON.stringify(row("Supply of thermometer with thermowell", STORED).itemList)).not.toContain("priced as the thermowell (Test Plug");
  });
  it("the Valve Package Derivation tab states the rule (E13) and the coverage guard holds (code rule registered, line declared)", () => {
    const cfg = withV78Valve(BY_ID.get(VALVE)!);
    const lines = itemListRuleOrder(cfg, ITEMS, { hvac_misc: BY_ID.get("hvac_misc")! });
    const e13 = lines.find((l) => /Thermowell with valve. is priced as the thermowell/i.test(l.title));
    expect(e13).toBeTruthy();
    // its reason, on the line (chat-Claude's review 2026-11-20 00:30 point 4)
    expect(e13!.detail).toContain("why: price as thermowell - owner 2026-11-15 11:46; build ruled 2026-11-20 00:10 '1a'");
    const r = derivationCoverage(cfg, ITEMS, { hvac_misc: BY_ID.get("hvac_misc")! });
    expect(r.missing).toEqual([]);
    // the code rule E13 is registered (CODE_RULES) WITH the asset that declares its line (K2, HVAC v78) -- before that, the line is the one
    // declared line naming no registered rule; after, the guard is clean, and a config without the line misses the rule
    if ((CODE_RULES.hvac_valve_item ?? []).includes("E13")) {
      expect(r.orphan).toEqual([]);
      const without = structuredClone(cfg) as unknown as { list_spec: { pricing: { rule_lines: Array<{ rule: string }> } } };
      without.list_spec.pricing.rule_lines = without.list_spec.pricing.rule_lines.filter((x) => x.rule !== "E13");
      expect(derivationCoverage(without as unknown as RateCategoryConfig, ITEMS, { hvac_misc: BY_ID.get("hvac_misc")! }).missing).toEqual(["code rule E13: no declared line"]);
    } else {
      expect(r.orphan).toEqual(["declared line E13: names no code rule of hvac_valve_item"]);
    }
  });
});

describe("VAV-2a2 R7 - the owner tags are gone from the scope notes", () => {
  it("v78 Valve config: the two supply-row notes carry no '(owner VR9)'; every other text of the config unchanged", () => {
    // "before" = the v77 FILE's Valve config (the newest asset is v78 from K2 on)
    const before = readJsonFixture<{ category_configs: RateCategoryConfig[] }>(new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v77.json", import.meta.url))
      .category_configs.find((c) => c.category_id === VALVE)!;
    const after = withV78Valve(before);
    // ... and the newest asset carries exactly that transformation (on v78; idempotent on v77)
    expect(withV78Valve(BY_ID.get(VALVE)!)).toEqual(after);
    const sr = (x: RateCategoryConfig) => (x as unknown as { list_spec: { pricing: { scope: { supply_row: { with_row: string; no_row: string } } } } }).list_spec.pricing.scope.supply_row;
    expect(sr(after).with_row).toBe("Supply row(s) of this valve on this sheet: {rows}.");
    expect(sr(after).no_row).toBe("The sheet does not quote this valve's supply on another row, so the uplift applies. Switch back to Supply + installation if the BoQ supplies it too.");
    expect(JSON.stringify(after)).not.toContain("(owner VR9)");
    // undo the declared changes on a copy: the rest of the config equals v77's
    type V = { list_spec: { pricing: { rule_lines: Array<{ rule: string }>; scope: { supply_row: { with_row: string; no_row: string } } } } };
    const back = structuredClone(after) as unknown as V;
    back.list_spec.pricing.scope.supply_row.with_row = sr(before).with_row;
    back.list_spec.pricing.scope.supply_row.no_row = sr(before).no_row;
    back.list_spec.pricing.rule_lines = back.list_spec.pricing.rule_lines.filter((r) => r.rule !== "E13");
    expect(back).toEqual(before);
  });
  it("the pair rule's code note carries no '(owner QR-2)'", async () => {
    const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("./pricingSheetHelper.ts", import.meta.url), "utf8"));
    expect(src).toContain('pair_note: "Installation is quoted on its own row on this sheet, so priced supply only here",');
    expect(src).not.toContain("so priced supply only here (owner QR-2)");
  });
});
