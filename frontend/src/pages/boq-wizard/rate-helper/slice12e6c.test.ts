/**
 * SLICE 12e-6c (owner rulings 2026-10-18 22:17, from the 12e-6R consistency check) -- THE FIVE INSULATION FIXES.
 *
 *   U1  a TYPED pipe size on Insulation is one size, as Piping's: "40-50" / "50 mm O.D." refuse "Type one pipe size, in mm
 *       or inches". `typed_entry` controls only that rule -- never the 12e-2 wording (owner: "Pin with a test that a stored
 *       row's wording is unchanged on both Piping and Insulation").
 *   U2  F-3 on every axis reading inches: a bare size below the smallest stocked size that could be inches refuses
 *       "size N has no unit - price this row by hand" (x25.4 / x25, as ruled); no key, no wording change, no conversion.
 *   O3  a fixing ("GI strip at 1 m grid") is never a cladding: masked before R2's GI map reads the words.
 *   O4  a copied glass / fibre cloth facing with the cladding unanswered prices as the glass-cloth cladding.
 *   R   RPUF with no material answered prices as Tubular PUF, at the next stocked thickness up.
 *
 * Every rule runs on the THREE paths 12e-6R named, from their entry points: P1 the panel's Insulation row, P2 the panel's
 * Piping row insulation section, P3 Calculator -> Insulation (and P3b Calculator -> Piping with its section). A path that
 * cannot take the input says so by name ("not expressible"), never as a pass.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { calculatorCtx } from "@/pages/pricing/PricingCalculator";
import { itemListRuleOrder } from "@/pages/pricing/rate-master/itemListRuleOrder";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, makePricingSheetHelper, type ItemListSuggestion } from "./pricingSheetHelper";
import {
  ONE_SIZE_MESSAGE, choiceTextFor, clothFacingCladding, f3InchAlt, itemListPricingSpec, noUnitMessage, rpufFamily,
  type ExtractedListItem,
} from "./itemListPricing";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const V45 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v45.json`, import.meta.url));
const E66 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_electrical_all_v66.json`, import.meta.url));
const INS = "hvac_insulation", PIP = "hvac_piping";
const ITEMS: RateMasterItem[] = V45.items.map((it) => ({ ...it, discipline: V45.discipline } as RateMasterItem));
const cfgOf = (a: Asset) => Object.fromEntries(a.category_configs.map((c) => [c.category_id, c])) as Record<string, RateCategoryConfig>;
const CFG45 = cfgOf(V45);
const V46 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v46.json`, import.meta.url));
/** U1's config: v45 with exactly the one key HVAC v46 adds (`typed_entry` on Insulation's pipe size). */
const withTypedEntry = (cfg: Record<string, RateCategoryConfig>): Record<string, RateCategoryConfig> => {
  const c = structuredClone(cfg) as Record<string, any>;
  c[INS].list_spec.pricing.numbers.pipe_size_mm.typed_entry = "one_size";
  return c as Record<string, RateCategoryConfig>;
};
// 12e-6c AC7: the LIVE asset, v46. BEFORE (commit 1, no v46 yet): `const CFG = withTypedEntry(CFG45)` -- pinned equal below.
const CFG = cfgOf(V46);
const NR = "Nitrile Rubber Insulation", PUF = "Tubular Puf Insulation";
const NIT = { item: NR, cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50" };

// ── the four entry points ──────────────────────────────────────────────────────────────────────────
const cells = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
type Edit = { base: number | null; family: string | null; attrs: Record<string, string>; other?: string[]; qty?: string; sections?: Record<string, Edit> };
interface Out { priced: boolean; family: string | null; reason: string | null; figures: [number, number] | null; lines: string[] }
const blockOut = (b: any): Out => b
  ? { priced: b.state === "priced", family: b.family ?? null, reason: b.reason ?? null,
      figures: b.state === "priced" ? [b.figures.supply_rate, b.figures.install_rate] : null,
      lines: [...(b.familyLine ? [b.familyLine] : []), ...(b.reason ? [b.reason] : []), ...b.working, ...b.fields.flatMap((f: any) => (f.note ? [`${f.id}:${f.note}`] : []))] }
  : { priced: false, family: null, reason: null, figures: null, lines: [] };
const ctx = (cat: string, unit: string | undefined, description = ""): RateHelperRowContext & { unit?: string } => ({
  excelRow: 1, description, nodeType: "Line Item", category: cat, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"],
  headings: [], ownNotes: [], ...(unit !== undefined ? { unit } : {}),
});
const helperFor = (cfg: Record<string, RateCategoryConfig>, ext: Map<number, ExtractionRow>) =>
  makePricingSheetHelper({ configsByCategory: new Map(Object.entries(cfg)), items: ITEMS, extractionByRow: ext });
const listOf = (r: unknown) => (r as ItemListSuggestion).itemList!;
/** P1: the panel's Insulation-category row; `typed` re-types those fields in the block's own boxes (the panel's typed path) */
function p1(model: Record<string, string>, unit = "RMT", typed?: Record<string, string>, description = "", cfg = CFG): Out {
  const ext = new Map<number, ExtractionRow>([[1, { excelRow: 1, description, attributes: {}, items: [{ attributes: cells(model) }] } as unknown as ExtractionRow]]);
  const ov: Record<string, string> = typed ? { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: 0, family: null, attrs: typed, other: Object.keys(typed) }] }) } : {};
  return blockOut(listOf(helperFor(cfg, ext).compute(ctx(INS, unit, description), ov)).items[0]);
}
/** P2: the panel's Piping row (an MS pipe, Insulated Yes) whose insulation section carries the same facts; the section's size is its pipe's */
function p2(pipe: Record<string, string>, section: Record<string, string>, unit = "RMT", cfg = CFG): Out & { pipe: Out } {
  const items = [{ attributes: cells({ pipe_type: "MS", insulated: "Yes", ...pipe }) }, { attributes: cells(section), section: "insulation" }];
  const ext = new Map<number, ExtractionRow>([[1, { excelRow: 1, description: "", attributes: {}, items } as unknown as ExtractionRow]]);
  const v = listOf(helperFor(cfg, ext).compute(ctx(PIP, unit), {}));
  return { ...blockOut(v.items[0]?.sections?.[0]?.view.items[0]), pipe: blockOut(v.items[0]) };
}
/** P3: Calculator -> Insulation, the pricer's picks and typed boxes */
function p3(family: string, attrs: Record<string, string>, other: string[], unit = "mts", cfg = CFG): Out {
  const ov = { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family, attrs, other }] }), [ROW_UNIT_OVERRIDE_KEY]: unit };
  return blockOut(listOf(helperFor(cfg, new Map()).compute(calculatorCtx("HVAC", INS) as RateHelperRowContext, ov)).items[0]);
}
/** P3b: Calculator -> Piping, an MS pipe typed with its size, Insulated Yes, and the section picked */
function p3b(size: string, section: Edit, cfg = CFG): Out & { pipe: Out } {
  const edit: Edit = { base: null, family: "MS", attrs: { size_mm: size, insulated: "Yes" }, other: ["size_mm"], sections: { insulation: section } };
  const ov = { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [edit] }), [ROW_UNIT_OVERRIDE_KEY]: "mts" };
  const v = listOf(helperFor(cfg, new Map()).compute(calculatorCtx("HVAC", PIP) as RateHelperRowContext, ov));
  return { ...blockOut(v.items[0]?.sections?.[0]?.view.items[0]), pipe: blockOut(v.items[0]) };
}
const secEdit = (attrs: Record<string, string>, other: string[] = []): Edit => ({ base: null, family: NR, attrs, other });
const item = (a: Record<string, string>): ExtractedListItem => ({ attributes: cells(a) } as unknown as ExtractedListItem);
const SPEC = itemListPricingSpec(CFG45[INS])!;

// =====================================================================================================
describe("12e-6c U1 -- a TYPED Insulation pipe size is one size, as Piping's; the model's reading and every wording unchanged", () => {
  it("the key: v46 adds exactly `typed_entry: \"one_size\"` to Insulation's pipe size (Piping's own key, already read by the one-size reader)", () => {
    expect(CFG).toEqual(withTypedEntry(CFG45));
    expect(V46.items).toEqual(V45.items);
    expect((CFG45[INS] as any).list_spec.pricing.numbers.pipe_size_mm.typed_entry).toBeUndefined();
    expect((CFG45[PIP] as any).list_spec.pricing.numbers.size_mm.typed_entry).toBe("one_size");
    expect(itemListPricingSpec(CFG[INS])!.numbers.pipe_size_mm.typed_entry).toBe("one_size");
  });
  it("P3 Calculator -> Insulation: a typed '40-50' and '50 mm O.D.' refuse with Piping's sentence; a typed '50' prices 615 / 224 as before", () => {
    for (const size of ["40-50", "50 mm O.D."]) {
      const x = p3(NR, { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: size }, ["pipe_size_mm"]);
      expect({ size, priced: x.priced, reason: x.reason }).toEqual({ size, priced: false, reason: ONE_SIZE_MESSAGE });
    }
    expect(p3(NR, { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50" }, ["pipe_size_mm"]).figures).toEqual([615, 224]);
    // BEFORE (v45, no key): the same typed range priced its top value
    expect(p3(NR, { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "40-50" }, ["pipe_size_mm"], "mts", CFG45).figures).toEqual([615, 224]);
  });
  it("P1 the panel's own typed box refuses the same way; the MODEL's reading of a range is unchanged (its top value, 615 / 224)", () => {
    const typed = p1(NIT, "RMT", { pipe_size_mm: "40-50" });
    expect({ priced: typed.priced, reason: typed.reason }).toEqual({ priced: false, reason: ONE_SIZE_MESSAGE });
    const model = p1({ ...NIT, pipe_size_mm: "40-50" });
    expect(model.figures).toEqual([615, 224]);
    expect(model.lines).toContain("pipe size: range '40-50' -> its top value 50");
  });
  it("P2 / P3b the Piping row: the pipe's own typed box was already one size (12e-2), and its section follows the pipe -- unchanged", () => {
    const x = p3b("40-50", secEdit({ cladding: "26G Aluminium", thickness_mm: "19" }));
    expect({ pipe: x.pipe.reason, section: x.reason }).toEqual({ pipe: ONE_SIZE_MESSAGE, section: ONE_SIZE_MESSAGE });
    // the model-read range on a Piping row prices exactly as before the key (P2)
    expect(p2({ size_mm: "40-50" }, { item: NR, cladding: "26G Aluminium", thickness_mm: "19" }).figures)
      .toEqual(p2({ size_mm: "40-50" }, { item: NR, cladding: "26G Aluminium", thickness_mm: "19" }, "RMT", CFG45).figures);
  });
  it("WORDING PIN (owner): the key changes no stored row's words -- Insulation rows and Piping sections read the same with and without it", () => {
    const insRows: Array<Record<string, string>> = [
      { ...NIT, pipe_size_mm: "50 mm dia" }, { ...NIT, pipe_size_mm: "32" }, { ...NIT, pipe_size_mm: "25NB" }, { ...NIT, pipe_size_mm: "22.2" },
      { ...NIT, pipe_size_mm: "1 1/4\"" }, { ...NIT, pipe_size_mm: "19/25" }, { ...NIT, pipe_size_mm: "34.3mm Dia" },
    ];
    for (const m of insRows) expect({ m, lines: p1(m).lines }).toEqual({ m, lines: p1(m, "RMT", undefined, "", CFG45).lines });
    for (const size of ["6.4", "31.8 mm dia", "Dia31.8mm", "50", "25NB", "1 1/4\""]) {
      const sec = { item: NR, cladding: "Glass Cloth with paint", thickness_mm: "19" };
      const a = p2({ size_mm: size }, sec), b = p2({ size_mm: size }, sec, "RMT", CFG45);
      expect({ size, lines: a.lines, pipe: a.pipe.lines }).toEqual({ size, lines: b.lines, pipe: b.pipe.lines });
    }
  });
  it("the 12e-2 wording still comes from Piping's other keys: a Piping typed size reads exactly as before", () => {
    const x = p3b("2\"", secEdit({ cladding: "No", thickness_mm: "13" }));
    expect(x.pipe.lines.some((l) => l.startsWith("size_mm:You typed 2\""))).toBe(true);
  });
});

// =====================================================================================================
describe("12e-6c U2 -- F-3 on every axis reading inches: a bare number below the smallest that could be inches refuses", () => {
  it("THE AXES THE RULE COVERS TODAY (owner): Piping `size_mm` and Insulation `pipe_size_mm` -- across every HVAC and Electrical config", () => {
    const covered: string[] = [];
    for (const a of [V45, E66]) {
      for (const c of a.category_configs) {
        const spec = itemListPricingSpec(c);
        if (!spec) continue;
        for (const attr of Object.keys(spec.numbers)) if (f3InchAlt(spec, attr) !== null) covered.push(`${c.category_id}.${attr}@${f3InchAlt(spec, attr)}`);
      }
    }
    expect(covered.sort()).toEqual(["hvac_insulation.pipe_size_mm@25", "hvac_piping.size_mm@25"]);
  });
  it("a bare '2' (50.8 / 50 mm as inches: in Nitrile's range) refuses on all four paths, with one sentence", () => {
    const R2 = noUnitMessage("2");
    expect(p1({ ...NIT, pipe_size_mm: "2" }).reason).toBe(R2);
    expect(p3(NR, { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "2" }, ["pipe_size_mm"]).reason).toBe(R2);
    const s = p2({ size_mm: "2" }, { item: NR, cladding: "26G Aluminium", thickness_mm: "19" });
    expect({ pipe: s.pipe.reason, section: s.reason }).toEqual({ pipe: R2, section: R2 });
    const c = p3b("2", secEdit({ cladding: "26G Aluminium", thickness_mm: "19" }));
    expect({ pipe: c.pipe.reason, section: c.reason }).toEqual({ pipe: R2, section: R2 });
  });
  it("NEGATIVE: the same number WITH its unit prices ('2 inch' -> 50.8 -> 53.98); a size at the smallest prices; Piping is unchanged", () => {
    expect(p1({ ...NIT, pipe_size_mm: "2 inch" }).priced).toBe(true);
    expect(p1({ ...NIT, pipe_size_mm: "6.35" }).priced).toBe(true);
    expect(p3(NR, { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "2 inch" }, ["pipe_size_mm"]).priced).toBe(true);
    // Piping: MS 15 still takes the smallest size, 19 mm (15 inches is outside MS's range) -- the 12e-4b pin
    expect(p2({ size_mm: "15" }, { item: NR, cladding: "No", thickness_mm: "13" }).pipe.priced).toBe(true);
  });
  it("NEGATIVE, as ruled (x25.4 / x25 within the TYPE's range): a bare '4' on Nitrile (101.6 / 100 mm, above its 53.98) still takes the smallest size -- where its MS pipe refuses", () => {
    const ins = p1({ ...NIT, pipe_size_mm: "4" });
    expect({ priced: ins.priced, figures: ins.figures }).toEqual({ priced: true, figures: [327, 224] });
    expect(ins.lines).toContain("pipe_size_mm:BoQ says 4 mm -> priced as 6.35 mm (the smallest size)");
    // on a Piping row the PIPE refuses it (MS stocks up to 300 mm, so 4 inches is in range) and its section follows the pipe
    expect(p2({ size_mm: "4" }, { item: NR, cladding: "26G Aluminium", thickness_mm: "19" }).reason).toBe(noUnitMessage("4"));
  });
  it("no wording change: the rule adds no `how` -- a laddered Insulation pipe size reads exactly as on v45 before this slice's code", () => {
    expect(p1({ ...NIT, pipe_size_mm: "50" }).lines).toContain("pipe_size_mm:BoQ says 50 mm -> priced as 53.98 mm (next size up)");
  });
});

// =====================================================================================================
describe("12e-6c O3 -- a fixing is not a cladding, before R2's GI map reads the words", () => {
  it("the reader: 'GI strip at 1 m grid' and other fixings map to nothing; '26 G GI cladding' still maps to 26G Aluminium (12e-5b R2)", () => {
    for (const w of ["GI strip at 1 m grid", "GI grid", "C shape GI frame", "GI bolts and clamps", "aluminium and GI duct"]) {
      expect({ w, got: choiceTextFor(SPEC, "cladding", item({ cladding_as_written: w })) }).toEqual({ w, got: null });
    }
    expect(choiceTextFor(SPEC, "cladding", item({ cladding_as_written: "26 G GI cladding" }))).toMatchObject({ to: "26G Aluminium", line: "BoQ says 26 G GI cladding -> priced as 26G Aluminium" });
    expect(choiceTextFor(SPEC, "cladding", item({ cladding_as_written: "24 G GI sheet" }))).toMatchObject({ to: "24G Aluminium" });
  });
  it("P1 / P2: the fixing row prices with no cladding ('not mentioned -> No'); P3 / P3b: not expressible -- the cladding is a plain dropdown", () => {
    const sec = { item: NR, cladding: "None", thickness_mm: "19", cladding_as_written: "GI strip at 1 m grid" };
    const a = p1({ ...NIT, ...sec }), b = p2({ size_mm: "50" }, sec);
    for (const x of [a, b]) {
      expect(x.lines.join("\n")).toContain("cladding not mentioned -> No (without cladding)");
      expect(x.lines.join("\n")).not.toContain("priced as 26G Aluminium");
    }
    expect(a.figures).toEqual(b.figures);
    expect((CFG[INS] as any).list_spec.pricing.panel_controls.cladding).toBe("dropdown");
  });
});

// =====================================================================================================
describe("12e-6c O4 -- a copied glass / fibre cloth facing with the cladding unanswered prices as the glass-cloth cladding", () => {
  it("the reader: cloth alone -> Glass Cloth with paint; aluminium + cloth -> 26G (no gauge) or its gauge; an unlisted gauge refuses", () => {
    const g = (w: string) => clothFacingCladding(SPEC, "cladding", item({ cladding_as_written: w }));
    expect(g("factory laminated fire resistant fibre cloth fabric")).toEqual({ to: "Glass Cloth with paint", line: "BoQ says factory laminated fire resistant fibre cloth fabric -> priced as Glass Cloth with paint" });
    expect(g("reinforced glass cloth")).toMatchObject({ to: "Glass Cloth with paint" });
    expect(g("FR fabric facing")).toMatchObject({ to: "Glass Cloth with paint" });
    expect(g("aluminium sheet with reinforced glass cloth")).toMatchObject({ to: "26G Aluminium with Glass Cloth" });
    expect(g("24 G aluminium with glass cloth facing")).toMatchObject({ to: "24G Aluminium with Glass Cloth" });
    expect(g("22 G aluminium with glass cloth")).toEqual({ refuse: "BoQ says 22 G aluminium with glass cloth - the catalogue has no cladding of that gauge - price this row by hand" });
    // NEGATIVE: no cloth named -> nothing (a bare "fabric", "laminated" or a coating is not a facing)
    for (const w of ["factory laminated", "fabric", "two coats of fire retardant coating", "26G aluminium"]) expect({ w, got: g(w) }).toEqual({ w, got: null });
  });
  it("P1 / P2 price the same cloth cladding with the amber line; an ANSWERED cladding is never overridden; P3 / P3b not expressible", () => {
    const sec = { item: NR, cladding: "None", thickness_mm: "19", cladding_as_written: "factory laminated fire resistant fibre cloth fabric" };
    const a = p1({ ...NIT, ...sec }), b = p2({ size_mm: "50" }, sec);
    for (const x of [a, b]) expect(x.lines).toContain("BoQ says factory laminated fire resistant fibre cloth fabric -> priced as Glass Cloth with paint");
    expect(a.figures).toEqual(b.figures);
    // the same figure as the cladding picked outright
    expect(a.figures).toEqual(p1({ ...NIT, cladding: "Glass Cloth with paint" }).figures);
    const answered = p1({ ...NIT, cladding: "26G Aluminium", cladding_as_written: "reinforced glass cloth" });
    expect(answered.figures).toEqual(p1(NIT).figures);
    expect(answered.lines.join("\n")).not.toContain("priced as Glass Cloth");
  });
  it("NEGATIVE: on a per-sq.m sheet row the cloth still refuses as glass cloth on sheet insulation does (D9b unchanged)", () => {
    const x = p1({ item: "Thermal Nitrile Insulation", cladding: "None", thickness_mm: "19", cladding_as_written: "reinforced glass cloth" }, "sqm");
    expect({ priced: x.priced, reason: x.reason }).toEqual({ priced: false, reason: "glass cloth is not offered on sheet insulation - price this row by hand" });
  });
});

// =====================================================================================================
describe("12e-6c R -- RPUF with no material answered prices as Tubular PUF, at the next stocked thickness up", () => {
  it("the reader: RPUF / R.P.U.F / rigid PUF in the material as written or the row's own text, on a per-metre row only", () => {
    const g = (a: Record<string, string>, own = "", cls: string | null = "length") => rpufFamily(SPEC, item(a), own, cls);
    expect(g({ material_as_written: "RPUF" })).toEqual({ family: PUF, line: `BoQ says RPUF -> priced as ${PUF}` });
    expect(g({ material_as_written: "RPUF insulation" })).toMatchObject({ family: PUF });
    expect(g({ material_as_written: "R.P.U.F." })).toMatchObject({ family: PUF });
    expect(g({}, "rigid PUF insulation 40 mm thick")).toMatchObject({ family: PUF, line: `BoQ says rigid PUF -> priced as ${PUF}` });
    // NEGATIVE: PUF alone is the stocked family's own word; a sheet row has no PUF rule; "rpufx" is no word
    for (const [a, own, cls] of [[{ material_as_written: "PUF" }, "", "length"], [{ material_as_written: "RPUF" }, "", "area"], [{ material_as_written: "rpufx" }, "", "length"]] as const) {
      expect(g(a as Record<string, string>, own, cls)).toBeNull();
    }
  });
  it("P1 / P2: 'none of these' with RPUF as written prices as Tubular PUF -- the figure the model path gives when it picks Tubular PUF itself", () => {
    const facts = { item: "none of these", cladding: "No", thickness_mm: "40", material_as_written: "RPUF" };
    const a = p1({ ...facts, pipe_size_mm: "100" }), b = p2({ size_mm: "100" }, facts);
    for (const x of [a, b]) {
      expect({ priced: x.priced, family: x.family }).toEqual({ priced: true, family: PUF });
      expect(x.lines).toContain(`BoQ says RPUF -> priced as ${PUF}`);
    }
    expect(a.figures).toEqual(b.figures);
    expect(a.figures).toEqual(p1({ ...facts, item: PUF, pipe_size_mm: "100" }).figures);
    // BEFORE (v45 and this slice's code without R): a refusal by name
    expect(p1({ ...facts, item: "none of these", material_as_written: "XLPE", pipe_size_mm: "100" }).priced).toBe(false);
  });
  it("the ladder: 40 mm on a 100 mm pipe takes the next stocked thickness up; 30 mm on a 40 mm pipe still refuses (owner 2026-10-15)", () => {
    const up = p1({ item: "None", cladding: "No", thickness_mm: "40", pipe_size_mm: "100", material_as_written: "RPUF" });
    expect(up.lines.some((l) => /thickness 40 is not on the sheet -> \d+/.test(l))).toBe(true);
    const small = p1({ item: "none of these", cladding: "No", thickness_mm: "30", pipe_size_mm: "40", material_as_written: "RPUF" });
    expect({ priced: small.priced, family: small.family }).toEqual({ priced: false, family: PUF });
    expect(small.reason).toMatch(/^thickness 30 is above the largest size on the sheet/);
  });
  it("NEGATIVE: an ANSWERED material is never overridden -- Nitrile with RPUF as written prices Nitrile; P3 / P3b are not expressible (a dropdown)", () => {
    const x = p1({ ...NIT, material_as_written: "RPUF" });
    expect({ family: x.family, figures: x.figures }).toEqual({ family: NR, figures: p1(NIT).figures });
    expect((CFG[INS] as any).list_spec.pricing.panel_controls.item).toBe("dropdown");
  });
  it("row text: 'RPUF' in the row's own words with nothing answered prices as Tubular PUF -- not the row-kind default (Nitrile)", () => {
    const x = p1({ item: "None", cladding: "No", thickness_mm: "40", pipe_size_mm: "100" }, "RMT", undefined, "RPUF insulation 40 mm thick");
    expect({ family: x.family, line: x.lines[0] }).toEqual({ family: PUF, line: `BoQ says RPUF -> priced as ${PUF}` });
    const plain = p1({ item: "None", cladding: "No", thickness_mm: "40", pipe_size_mm: "100" });
    expect(plain.family).toBe(NR);
  });
});

// =====================================================================================================
describe("12e-6c AC6 -- each rule has its own Derivation-tab line, generated from the config", () => {
  const titles = (cfg: RateCategoryConfig) => itemListRuleOrder(cfg, ITEMS).map((l) => l.title);
  it("Insulation (v45 + U1's key) gains five lines; Piping and ADP gain none", () => {
    const t = titles(CFG[INS]);
    for (const line of [
      "A typed pipe size is one size, in mm or inches",
      "A pipe size written as a bare number that could be inches refuses",
      "RPUF with no material answered prices as Tubular Puf Insulation",
      "A cladding written as 'gi', 'g.i' with none answered is priced as the stocked one of its gauge",
      "A glass or fibre cloth facing copied as the cladding with none answered prices as the glass cloth cladding",
    ]) expect(t).toContain(line);
    expect(titles(CFG[PIP])).toEqual(titles(CFG45[PIP]));
    expect(titles(CFG.hvac_adp)).toEqual(titles(CFG45.hvac_adp));
  });
  it("each line says its rule in plain words: no internal id, no tag", () => {
    const lines = itemListRuleOrder(CFG[INS], ITEMS).filter((l) => /RPUF|cloth facing|'gi'|bare number|typed pipe size/.test(l.title));
    expect(lines).toHaveLength(5);
    const text = lines.map((l) => `${l.title} | ${l.detail ?? ""}`).join("\n");
    expect(text).not.toMatch(/\b[a-z0-9]+_[a-z0-9_]+\b/i);
    expect(text).not.toMatch(/\(owner/i);
    expect(text).toContain("a fixing is not a cladding");
    expect(text).toContain("at 25.4 or 25 mm to the inch");
  });
});
