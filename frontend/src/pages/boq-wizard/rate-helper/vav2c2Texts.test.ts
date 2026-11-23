/**
 * VAV-2c2 R3 (owner 2026-11-23 13:46 "a. fors cosmetic note changes you can take the decision"; the list chat-Claude accepted, ANSWER 6 with
 * E1 / E2) -- T3 / T7, on scratch copies of the v82 FILE with the v83 edits file applied (vav2c2.harness):
 *   a  "BoQ says" only where the helper read the scope from the BoQ -- not when the user picked it, not in the Calculator;
 *   b  no dangling colon at the end of the Installation-only note when no working line follows (0% uplift);
 *   c / d  no mockup screen number, feature-standard number or option letter on a rendered HVAC rules page; no dateless time in a note;
 *   f  the rules pages call the box "the 'Scope of this rate' box";
 *   g  no working line says its side twice ("supply: supply: ...");
 *   h  the Calculator's "type the number of VAVs" line says no "on the sheet"; a BoQ row keeps it.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig } from "../../pricing/rate-master/rateMasterTypes";
import { itemListRuleOrder } from "../../pricing/rate-master/itemListRuleOrder";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, SCOPE_OVERRIDE_KEY, makePricingSheetHelper, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { SHARES_OVERRIDE_KEY, type SharesEditState } from "./vavSheetShares";
import { surfaceMap } from "./vav1Vav.harness";
import { EDITS83, ITEMS82, V82, byId83, cfg83 } from "./vav2c2.harness";
import { calcOf as calc81, pricedKinds, V81 } from "./vav2c1.harness";
import { box81, sheet81 } from "./vav2b2.harness";

const VAV = "hvac_vav_box";
const CATS = [VAV, "hvac_ducting", "hvac_valve_package", "hvac_vrf"] as const;
const BOX = { base: null, family: "VAV box", attrs: { shape: "Rectangular", vav_type: "Nothing specific mentioned", integrator_included: "No", airflow_cfm: "700" } };

/** the Calculator's own construction on the v83 (or v82: `v82`) configs */
function calc(cat: string, input: { state: unknown; unit: string; scope?: string; shares?: SharesEditState }, v82 = false): ItemListView {
  const byId = v82 ? V82.byId : byId83();
  const h = makePricingSheetHelper({ configsByCategory: surfaceMap([], byId), items: ITEMS82, extractionByRow: new Map() });
  return (h.compute(calculatorCtx("HVAC", cat), {
    [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(input.state), [ROW_UNIT_OVERRIDE_KEY]: input.unit,
    ...(input.scope ? { [SCOPE_OVERRIDE_KEY]: input.scope } : {}), ...(input.shares ? { [SHARES_OVERRIDE_KEY]: JSON.stringify(input.shares) } : {}),
  }) as unknown as ItemListSuggestion).itemList!;
}
/** a priced Calculator entry of each category with a scope */
function entryOf(cat: string): { state: unknown; unit: string } {
  if (cat === VAV) return { state: { items: [BOX] }, unit: "Nos" };
  const k = [...pricedKinds(cat, V81.byId.get(cat)!).values()][0];
  return { state: k.state, unit: k.unit };
}

describe("R3 a: 'BoQ says' only where the helper read the scope from the BoQ", () => {
  for (const cat of CATS) {
    it(`${cat} Calculator: Supply only and Installation only say what the scope does, never 'BoQ says'`, () => {
      const e = entryOf(cat);
      const so = calc(cat, { ...e, scope: "Supply only" });
      expect(so.rowPriced).toBe(true);
      expect(so.scope?.note).toContain("Supply only: install 0 on every line of this row.");
      for (const scope of ["Supply only", "Installation only"]) expect(calc(cat, { ...e, scope }).scope?.note ?? "", `${cat} ${scope}`).not.toMatch(/BoQ says/);
      // VACUITY: on v82 (no chosen_lines) the Calculator still says "BoQ says supply only"
      expect(calc(cat, { ...e, scope: "Supply only" }, true).scope?.note).toContain("BoQ says supply only");
    });
  }
  it("VRF Calculator, Installation only: 'Installation only - no supply. Each line ...' (the working follows after the colon)", () => {
    const n = calc("hvac_vrf", { ...entryOf("hvac_vrf"), scope: "Installation only" }).scope?.note ?? "";
    expect(n).toMatch(/^Installation only - no supply\. Each line is priced at its final install x \(1 \+ 50%\), rounded up to the rupee: \S/);
  });
  const row = (cfg: RateCategoryConfig, scope: string, pick?: string) => sheet81({ 10: box81(17, {}, { scope }) }, { cfg, items: ITEMS82 })(10, pick ? { [SCOPE_OVERRIDE_KEY]: pick } : {}).itemList!;
  it("a BoQ row the USER sets to Supply only: note H names the helper's choice, then what the scope does -- no 'BoQ says'", () => {
    const n = row(cfg83(VAV), "Supply + installation", "Supply only").scope?.note ?? "";
    expect(n).toBe("Scope changed by you. The helper had chosen Supply + installation. Supply only: install 0 on every line of this row.");
    expect(row(V82.byId.get(VAV)!, "Supply + installation", "Supply only").scope?.note).toContain("BoQ says supply only");   // v82: the fault
  });
  it("NEGATIVE: a BoQ row the BoQ reads as Supply only keeps 'BoQ says supply only' (the helper read it from the BoQ; VAV Box with its scope rule left out)", () => {
    // VAV Box's own BoQ rows are decided by the scope rule from v83 on (vav2c2Rule.test.ts); the 'BoQ says' path is the one without it
    expect(row(cfg83(VAV, (e) => e.p.includes("rule")), "Supply only").scope?.note).toBe("BoQ says supply only - no installation: install 0 on every line of this row.");
  });
});

describe("R3 b: no dangling colon", () => {
  // the Valve Package's installation-only uplift is not 0% (its working line follows the colon: the NEGATIVE below)
  for (const cat of [VAV, "hvac_ducting"]) {
    it(`${cat} Calculator, Installation only at 0% uplift: the note ends with a full stop, not a colon`, () => {
      const n = calc(cat, { ...entryOf(cat), scope: "Installation only" }).scope?.note ?? "";
      expect(n).toMatch(/supply not in scope = 0\.$/);
      expect(n).not.toMatch(/:\s*$/);
    });
  }
  it("NEGATIVE: with an uplift the working line follows the colon (VAV at 33%)", () => {
    const items = ITEMS82.map((i) => (i.attributes?.item === "vav_install_only_uplift" ? { ...i, rates: { factor: 0.333 } } as typeof i : i));
    const h = makePricingSheetHelper({ configsByCategory: surfaceMap([], byId83()), items, extractionByRow: new Map() });
    const n = (h.compute(calculatorCtx("HVAC", VAV), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [BOX] }), [ROW_UNIT_OVERRIDE_KEY]: "Nos", [SCOPE_OVERRIDE_KEY]: "Installation only" }) as unknown as ItemListSuggestion).itemList!.scope?.note ?? "";
    expect(n).toMatch(/supply not in scope = 0: VAV box \d+ x \(1 \+ 33\.3%\) = \d+$/);
  });
  it("NEGATIVE: the Valve Package (its uplift set above 0%) keeps the colon, its working line after it", () => {
    const n = calc("hvac_valve_package", { ...entryOf("hvac_valve_package"), scope: "Installation only" }).scope?.note ?? "";
    expect(n).toMatch(/supply not in scope = 0: \S.* x \(1 \+ \d+(\.\d+)?%\) = \d+/);
  });
});

describe("R3 e (owner 2026-11-24 00:18 'ok to remove'): ADP's rules page shows no 'reason not recorded'", () => {
  it("no ADP line's detail says 'reason not recorded'; the lines with a ruling keep their '-- why: ...'; the reason field still says so (the guard)", () => {
    const ls = itemListRuleOrder(cfg83("hvac_adp"), ITEMS82, Object.fromEntries(byId83()) as Record<string, unknown>);
    expect(ls.filter((l) => /reason not recorded/.test(l.detail ?? ""))).toEqual([]);
    // 24 lines carried it: 21 whole (no ruling at all: no clause now) and 3 merged (the recorded facts keep their reason)
    expect(ls.filter((l) => l.reason === "reason not recorded").length).toBe(21);
    const merged = ls.filter((l) => l.reason !== "reason not recorded" && /reason not recorded/.test(l.reason ?? ""));
    expect(merged.length).toBe(3);
    for (const l of merged) expect(l.detail, l.title).toMatch(/ -- why: .*\(owner, 2026-10-\d\d[^)]*\)/);
    expect(ls.filter((l) => / -- why: /.test(l.detail ?? "")).length).toBe(ls.length - 21);
  });
  it("NEGATIVE: the same page under a non-HVAC catalogue kind keeps every clause (the ruling is the HVAC pages')", () => {
    const c = structuredClone(cfg83("hvac_adp")) as unknown as { list_spec: { pricing: { kind?: string } } };
    expect(c.list_spec.pricing.kind).toBe("hvac_adp_item");
    c.list_spec.pricing.kind = "other_adp_item";
    const ls = itemListRuleOrder(c, ITEMS82, Object.fromEntries(byId83()) as Record<string, unknown>);
    expect(ls.length).toBeGreaterThan(20);
    expect(ls.every((l) => / ?why: reason not recorded$/.test(l.detail ?? ""))).toBe(true);
  });
});

describe("R3 g: a working line says its side once", () => {
  for (const cat of ["hvac_insulation", "hvac_adp"]) {
    it(`${cat}: every priced kind's working has no 'supply: supply:' / 'install: install:'; the side is still said`, () => {
      const kinds = pricedKinds(cat, V81.byId.get(cat)!);
      expect(kinds.size).toBeGreaterThan(3);
      let said = 0;
      for (const [fam, input] of kinds) {
        const v = calc81(cat, V81.byId.get(cat)!, input)!;
        const w = v.items.flatMap((b) => b.working);
        expect(w.filter((l) => /\b(supply|install)\s*:\s*\1\s*:/i.test(l)), `${cat} ${fam}`).toEqual([]);
        said += w.filter((l) => /^(supply|install): (BCS )?cost x \(1 \+ the (SKU's )?(supply|install) markup\)/.test(l)).length;
      }
      expect(said, "VACUITY: the lines the fix touches are in the loop").toBeGreaterThan(0);
    });
  }
});

describe("R3 h: the Calculator's VAV count line", () => {
  it("Calculator, a full-rate BACnet controller with no VAVs typed: 'Type the number of VAVs to price this item.'", () => {
    const v = calc(VAV, { state: { items: [] }, unit: "Nos", shares: { bacnet_whole: { added: true } } });
    const b = v.shares!.blocks.find((x) => x.id === "bacnet_whole")!;
    expect(b.reason).toBe("Type the number of VAVs to price this item.");
    expect(calc(VAV, { state: { items: [] }, unit: "Nos", shares: { bacnet_whole: { added: true } } }, true).shares!.blocks.find((x) => x.id === "bacnet_whole")!.reason)
      .toBe("Type the number of VAVs on the sheet to price this item.");   // v82
  });
  it("Calculator, a BACnet share with no VAVs typed: 'Type the number of VAVs to price this share.'", () => {
    const v = calc(VAV, { state: { items: [BOX] }, unit: "Nos", shares: { bacnet: { added: true } } });
    expect(v.shares!.blocks.find((x) => x.id === "bacnet")!.reason).toBe("Type the number of VAVs to price this share.");
  });
});

describe("R3 c / d / f: the rendered HVAC rules pages and the notes", () => {
  const sections = Object.fromEntries(byId83()) as Record<string, unknown>;
  const pages = [...V82.byId.keys()].filter((c) => /^hvac_/.test(c)).map((c) => [c, itemListRuleOrder(cfg83(c), ITEMS82, sections)] as const).filter(([, l]) => l.length);
  const text = (ls: ReturnType<typeof itemListRuleOrder>): string[] => ls.flatMap((l) => [l.title, l.detail ?? "", ...text(l.sub ?? [])]);
  it("no mockup screen number, feature-standard number or option letter quoted as the owner's words, on any HVAC rules page", () => {
    expect(pages.length).toBeGreaterThanOrEqual(7);
    for (const [c, ls] of pages) {
      const t = text(ls).join("\n");
      expect(t.match(/\bscreens?\s+\d+\b/gi), c).toBeNull();
      expect(t.match(/feature standard|standard\s*#\s*\d+/gi), c).toBeNull();
      expect(t.match(/\boptions?\s+[a-h]\b/gi), c).toBeNull();
      expect(t.match(/"\s*\d?\s?[a-hA-H](?:\s+\d\s?[a-h])*\s*"/g), c).toBeNull();
      expect(t.match(/'\d[a-h]'/g), c).toBeNull();
    }
  });
  it("VACUITY: the v82 pages carry them (VAV Box: screen 7, standard #29, '1a 2a 3b')", () => {
    const t = text(itemListRuleOrder(V82.byId.get(VAV)!, ITEMS82, Object.fromEntries(V82.byId) as Record<string, unknown>)).join("\n");
    expect(t).toContain("screen 7");
    expect(t).toContain("feature standard #29");
    expect(t).toContain('"1a 2a 3b"');
  });
  it("the owner's words and dates stay (VAV Box: 'this is ok' with 18:42; 2026-11-15 13:39)", () => {
    const t = text(itemListRuleOrder(cfg83(VAV), ITEMS82, sections)).join("\n");
    expect(t).toContain('the layout approved (18:42 "this is ok")');
    expect(t).toContain("(owner 2026-11-15 13:39)");
  });
  it("f: the scope lines name 'the Scope of this rate box'; never 'the calculator's BoQ scope choice'", () => {
    for (const [c, ls] of pages) expect(text(ls).join("\n"), c).not.toContain("'BoQ scope' choice");
    const vrf = text(pages.find(([c]) => c === "hvac_vrf")![1]).join("\n");
    expect(vrf).toContain("the 'Scope of this rate' box does the same");
  });
  it("d: no row note keeps a time without a date (VRF supply rows: the bracket goes)", () => {
    const sr = (cfg83("hvac_vrf") as unknown as { list_spec: { pricing: { extras: { scope: { supply_row: Record<string, string> } } } } }).list_spec.pricing.extras.scope.supply_row;
    expect(sr.with_row).toBe("Supply row(s) on this sheet: {rows}.");
    expect(sr.no_row).toBe("This sheet has no supply row for this item, so the installation-only uplift applies.");
  });
});

describe("the v83 edits file (part 1, R3)", () => {
  it("every edit's 'from' is what v82 holds (the harness refuses otherwise); 52 R3 edits + 3 of the scope rule, each with its why", () => {
    expect(EDITS83.configs.filter((e) => /^R3 /.test(e.why)).length).toBe(52);
    expect(EDITS83.configs.filter((e) => /^(R1 \/ R2|R2 H|QR-ASK)/.test(e.why)).length).toBe(3);
    expect(EDITS83.configs.length).toBe(55);
    for (const c of new Set(EDITS83.configs.map((e) => e.c))) expect(() => cfg83(c)).not.toThrow();
  });
  it("no rate, markup or item is touched: only config texts and the declared new keys (chosen_lines, the two Calculator labels)", () => {
    const keys = EDITS83.configs.filter((e) => e.from === null).map((e) => `${e.c}:${e.p[e.p.length - 1]}`).sort();
    expect(keys).toEqual(["hvac_ducting:chosen_lines", "hvac_valve_package:chosen_lines", "hvac_vav_box:chosen_lines", "hvac_vav_box:need_vavs_calculator", "hvac_vav_box:need_vavs_whole_calculator", "hvac_vav_box:rule", "hvac_vrf:chosen_lines"]);
    // the one list edit: VAV Box's reading fields, v82's list with the two point-4 fields appended (every other field byte-identical)
    const ad = EDITS83.configs.find((e) => e.p.join("/") === "list_spec/attribute_definitions")!;
    expect((ad.to as unknown[]).slice(0, (ad.from as unknown[]).length)).toEqual(ad.from);
    expect((ad.to as Array<{ id: string }>).slice((ad.from as unknown[]).length).map((d) => d.id)).toEqual(["needs_installing", "no_install_reason"]);
    for (const e of EDITS83.configs.filter((x) => x.from !== null && x !== ad)) {
      expect(typeof e.from, `${e.c} ${e.p.join("/")}`).toBe("string");
      expect(typeof e.to).toBe("string");
    }
    expect(EDITS83.pricing_inputs).toEqual({});
  });
});
