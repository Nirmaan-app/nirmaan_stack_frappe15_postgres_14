/**
 * ADP-2 (owner rulings: H5 damper by air stream, 2026-10-19 14:34 / 14:41; H7 plenum fields and the three-way rule,
 * 23:13 / 23:18 / 23:19, fill order and area answered 2026-10-20 00:24 (Q2 "Ok", Q3 "should be priced at max");
 * B3 neck "Other...", 14:24 "ok") -- every new rule through the PANEL'S ENTRY POINT (`makePricingSheetHelper(...)
 * .compute`) and the calculator, positive and negative, on the ADP-2 config (`applyAdp2(v47)`; the asset commit pins
 * it equal to v48), beside v47 itself.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { itemListRuleOrder } from "@/pages/pricing/rate-master/itemListRuleOrder";
import type { ExtractionRow } from "./rateHelperTypes";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, makePricingSheetHelper, type ItemListSuggestion } from "./pricingSheetHelper";
import { BOX_SIDE_ORDER, airStreamsNamed, itemFieldDefs, itemListPricingSpec, listSpecDefs, readBoxSides } from "./itemListPricing";
import type { AssetLike } from "./adp1.harness";
import { ADP2_ALL, ADP2_DAMPER_FAMILIES, ADP2_H5_RULES, applyAdp2 } from "./adp2.harness";

const V47 = readJsonFixture<AssetLike>(new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v47.json", import.meta.url));
const NEW = applyAdp2(V47);
const ADP = "hvac_adp";
const world = (a: AssetLike) => ({
  configs: new Map<string, RateCategoryConfig>(a.category_configs.map((c) => [c.category_id, c])),
  items: a.items.map((it, i) => ({ ...it, name: (it as any).name ?? `item-${i}`, discipline: a.discipline } as RateMasterItem)),
});
const W_NEW = world(NEW), W_OLD = world(V47);
type W = ReturnType<typeof world>;
const cells = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
function panel(unit: string, model: Record<string, string>, o: { desc?: string; headings?: string[]; w?: W } = {}) {
  const w = o.w ?? W_NEW;
  const ext = new Map<number, ExtractionRow>();
  ext.set(1, { excelRow: 1, description: o.desc ?? "", attributes: {}, items: [{ attributes: cells(model) }] } as unknown as ExtractionRow);
  const r = makePricingSheetHelper({ configsByCategory: w.configs, items: w.items, extractionByRow: ext })
    .compute({ excelRow: 1, description: o.desc ?? "", nodeType: "Line Item", category: ADP, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"], headings: o.headings ?? [], ownNotes: [], unit } as any, {});
  return view(r as ItemListSuggestion);
}
function calc(rowUnit: string, family: string, attrs: Record<string, string>, o: { other?: string[]; w?: W } = {}) {
  const w = o.w ?? W_NEW;
  const r = makePricingSheetHelper({ configsByCategory: w.configs, items: w.items, extractionByRow: new Map() })
    .compute({ excelRow: 1, description: "", nodeType: "Line Item", category: ADP, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"] } as any,
      { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family, attrs, other: o.other ?? [] }] }), [ROW_UNIT_OVERRIDE_KEY]: rowUnit });
  return view(r as ItemListSuggestion);
}
function view(s: ItemListSuggestion) {
  const v = s.itemList!;
  const b = v.items[0];
  const field = (label: string) => b?.fields.find((f) => f.label === label);
  return { priced: v.rowPriced, supply: s.values.supply_rate, install: s.values.install_rate, reason: b?.reason ?? v.reason,
           working: b?.working ?? [], fields: (b?.fields ?? []).map((f) => f.label), field, b };
}
const MIX = "mixing box / LP plenum";
const GROUP = "Area, or all three of Length, Width, Height";

// =====================================================================================================================
// H5 -- every damper family, every air stream, every damper answer. Hand arithmetic: the SKU's cost x (1 + markup),
// rounded up; v47 catalogue rates (markups 0.45 / 0.6).
const H5_CASES: Array<{ family: string; unit: string; facts: Record<string, string>; with: [number, number]; without: [number, number] | string }> = [
  { family: "curved grille", unit: "sqm", facts: {}, with: [10730, 2800], without: [5510, 880] },          // 7400 / 1750; 3800 / 550
  { family: "floor grille", unit: "sqm", facts: {}, with: [18343, 1920], without: [13775, 1920] },         // 12650 / 1200; 9500 / 1200
  { family: "linear grille", unit: "sqm", facts: {}, with: [9628, 2800], without: [4829, 880] },           // 6640 / 1750; 3330 / 550
  { family: "round diffuser", unit: "Nos", facts: { dia_mm: "300 mm" }, with: [1450, 400], without: [1044, 400] },   // 1000 / 250; 720 / 250
  { family: "slot diffuser", unit: "rmt", facts: { slot_count: "3" }, with: [2204, 352], without: [1682, 352] },     // 1520 / 220; 1160 / 220
  { family: "slot diffuser", unit: "sqm", facts: {}, with: [12992, 2864], without: "No SKU for a slot diffuser per sq.m without damper - price this row by hand" },
  { family: "square diffuser", unit: "Nos", facts: { neck_mm: "450 x 450" }, with: [2523, 576], without: [1813, 400] }, // 1740 / 360; 1250 / 250
];
const AIRS = ["supply", "return", "exhaust", "fresh", "None"] as const;
const DAMPERS = ["with", "without", "None"] as const;

describe("ADP-2 H5 -- the air stream decides a damper not mentioned, on every damper family (owner 14:34 / 14:41)", () => {
  it("the families are exactly those whose SKUs carry a with / without damper (2026-10-20 measured: six)", () => {
    const fams = [...new Set(V47.items.filter((it: any) => typeof it.attributes?.damper === "string").map((it: any) => it.attributes.family))].sort();
    expect(fams).toEqual([...ADP2_DAMPER_FAMILIES].sort());
  });
  for (const c of H5_CASES) {
    it(`${c.family} per ${c.unit}: supply / return / exhaust / fresh / not stated x with / without / not mentioned`, () => {
      for (const air of AIRS) for (const damper of DAMPERS) {
        const x = panel(c.unit, { family: c.family, air, damper, ...c.facts });
        const used = damper !== "None" ? damper : air === "supply" ? "with" : "without";
        const want = used === "with" ? c.with : c.without;
        const got = typeof want === "string" ? x.reason : [x.supply, x.install];
        expect({ air, damper, got, field: x.field("Damper")?.value }).toEqual({ air, damper, got: want, field: used });
        // a priced item says it in its working; a refused one (per sq.m without) carries it on the Damper field, amber
        if (damper === "None" && air !== "None") {
          if (typeof want === "string") expect(x.field("Damper")?.rule).toBe(`${air} air, damper not mentioned -> ${used} damper`);
          else expect(x.working).toContain(`${air} air, damper not mentioned -> ${used} damper`);
        }
        if (damper === "None" && air === "None" && typeof want !== "string") expect(x.working).toContain("damper not mentioned -> without");
        // NEGATIVE: an explicit damper never carries an air-stream line
        if (damper !== "None") expect(x.working.some((l) => l.includes("damper not mentioned"))).toBe(false);
      }
    });
  }
  it("NEGATIVE (v47): supply air left the damper at 'without' on every family but the linear grille (R13)", () => {
    expect([panel("Nos", { family: "square diffuser", air: "supply", damper: "None", neck_mm: "450 x 450" }, { w: W_OLD }).supply]).toEqual([1813]);
    expect([panel("rmt", { family: "slot diffuser", air: "supply", damper: "None", slot_count: "3" }, { w: W_OLD }).supply]).toEqual([1682]);
    expect([panel("sqm", { family: "linear grille", air: "supply", damper: "None" }, { w: W_OLD }).supply]).toEqual([9628]);
    expect(panel("sqm", { family: "slot diffuser", air: "supply", damper: "None" }, { w: W_OLD }).reason).toBe("No SKU for a slot diffuser per sq.m without damper - price this row by hand");
  });
  it("AC0 (a): BOQ-26-00087 r54 (supply heading, 3-slot, 1300 mm, EA) -> with, 1520 x 1.3 = 1976 -> 2866 / 458; r60 (return) -> 2187 / 458", () => {
    const r54 = panel("EA", { family: "slot diffuser", air: "supply", damper: "None", slot_count: "3 Slot", size_mm: "1300 mm Length" });
    expect([r54.supply, r54.install]).toEqual([2866, 458]);
    expect(r54.working).toEqual(expect.arrayContaining(["supply air, damper not mentioned -> with damper", "supply: 1520 x 1.3 = 1976"]));
    const r60 = panel("EA", { family: "slot diffuser", air: "return", damper: "None", slot_count: "3 Slot", size_mm: "1300 mm Length" });
    expect([r60.supply, r60.install]).toEqual([2187, 458]);
    expect(r60.working).toContain("return air, damper not mentioned -> without damper");
  });
  it("AC0 (b): an explicit 'without' under supply air stays without (BOQ-26-00231 r238 shape: round diffuser 300, 1044 / 400)", () => {
    const x = panel("No", { family: "round diffuser", air: "supply", damper: "without", dia_mm: "300mm" });
    expect([x.supply, x.install, x.field("Damper")?.value]).toEqual([1044, 400, "without"]);
  });
  it("the Air stream field is shown on every damper family (it decides the damper); v47 showed it on the linear grille only", () => {
    for (const c of H5_CASES) {
      expect({ f: c.family, has: panel(c.unit, { family: c.family, air: "None", damper: "None", ...c.facts }).fields.includes("Air stream") }).toEqual({ f: c.family, has: true });
    }
    expect(panel("sqm", { family: "curved grille", air: "None", damper: "None" }, { w: W_OLD }).fields.includes("Air stream")).toBe(false);
    expect(panel("sqm", { family: "linear grille", air: "None", damper: "None" }, { w: W_OLD }).fields.includes("Air stream")).toBe(true);
  });
  it("the four rules, exactly (R13 is replaced, not added to)", () => {
    expect(ADP2_H5_RULES.map((r) => [r.when.equals, r.then])).toEqual([["supply", "with"], ["return", "without"], ["exhaust", "without"], ["fresh", "without"]]);
    const pr = (NEW.category_configs.find((c) => c.category_id === ADP) as any).list_spec.pricing;
    expect(pr.derive_when_none.length).toBe(4);
    expect(JSON.stringify(pr.derive_when_none)).not.toContain("R13");
  });
});


// =====================================================================================================================
describe("ADP-2 H5 fix (a) -- a row naming supply AND return air leaves the damper as read (owner 2026-10-20)", () => {
  const AIRS4 = ["supply", "return", "exhaust", "fresh"];
  const SQ = { family: "square diffuser", air: "supply", damper: "None", neck_mm: "450 x 450" };
  const LINE = "BoQ names supply and return air -> damper as read (not mentioned -> without)";
  it("only words used FOR the air count", () => {
    const n = (t: string) => [...airStreamsNamed(t, AIRS4)].sort();
    expect(n("Aluminium powder coated Supply / Return air diffuser of 450x450 mm neck size")).toEqual(["return", "supply"]);
    expect(n("Supply and fixing of Powder coated Extruded Aluminium Supply & return air diffusers")).toEqual(["return", "supply"]);
    expect(n("supply and return air of the sizes mentioned below")).toEqual(["return", "supply"]);
    expect(n("Aluminium powder coated supply air 3 SLOT linear diffuser")).toEqual(["supply"]);
    expect(n("Return Air Grille with OBD")).toEqual(["return"]);
    // NEGATIVE: the everyday "Supply and installation of ..." names no stream; nor does a heading reading "SUPPLY ... AIR MASTER"
    expect(n("Supply and installation of return grilles")).toEqual([]);
    expect(n("SUPPLY LINEAR SLOT DIFFUSER MAKE: AIR MASTER")).toEqual([]);
    expect(n("")).toEqual([]);
  });
  it("(2) the row names both -> the damper as read, whatever stream the model answered (00247 r80 -> 1813 / 400)", () => {
    const x = panel("No", SQ, { desc: "Aluminium powder coated Supply / Return air diffuser of 450x450 mm neck size, the outer size of diffuser should be 600 x600" });
    expect([x.supply, x.install, x.field("Damper")?.value]).toEqual([1813, 400, "without"]);
    expect(x.working).toContain(LINE);
    expect(x.working.some((l) => l.startsWith("supply air, damper"))).toBe(false);
  });
  it("(2) the row names none under a heading naming both -> the damper as read (00103 r41 -> 1668 / 400)", () => {
    const x = panel("Nos", { ...SQ, neck_mm: "375 x 375mm neck size" }, { desc: "375 x 375mm neck size",
      headings: ["AIR DISTRIBUTION SYSTEM", "Supply and fixing of Powder coated Extruded Aluminium Supply & return air diffusers with 600 x 600mm size."] });
    expect([x.supply, x.install, x.field("Damper")?.value]).toEqual([1668, 400, "without"]);
    expect(x.working).toContain(LINE);
  });
  it("(1) the row names ONE stream under a heading naming both -> the row wins (00247 r75 shape stays with)", () => {
    const x = panel("Nos", SQ, { desc: "Aluminium powder coated supply air diffuser 450x450", headings: ["Supply & return air diffusers"] });
    expect([x.supply, x.install, x.field("Damper")?.value]).toEqual([2523, 576, "with"]);
    expect(x.working).toContain("supply air, damper not mentioned -> with damper");
    expect(x.working).not.toContain(LINE);
  });
  it("(3) NEGATIVE: no stream named anywhere -> as built; an explicit damper still wins; the calculator is unchanged", () => {
    expect(panel("Nos", SQ, { desc: "450 x 450 diffuser", headings: ["Supply and installation of diffusers"] }).supply).toBe(2523);
    expect(panel("Nos", { ...SQ, damper: "with" }, { desc: "Supply / Return air diffuser" }).field("Damper")?.value).toBe("with");
    expect(panel("No", { ...SQ, damper: "with" }, { desc: "Supply / Return air diffuser" }).working).not.toContain(LINE);
    expect(calc("nos", "square diffuser", { air: "supply", damper: "None", neck_mm: "450" }).supply).toBe(2523);
  });
  it("NEGATIVE: return air under a both-heading keeps 'without' with the same line (no figure change, the stream no longer decides)", () => {
    const x = panel("Nos", { ...SQ, air: "return" }, { desc: "450 x 450 diffuser", headings: ["Supply & return air diffusers"] });
    expect([x.supply, x.field("Damper")?.value]).toEqual([1813, "without"]);
    expect(x.working).toContain(LINE);
  });
});
// =====================================================================================================================
describe("ADP-2 H7 -- the sides of a box, as written (owner Q2, 2026-10-20 'Ok': L x W x H, height last, a label wins)", () => {
  it("unlabelled sides take length, width, height in order; a label wins", () => {
    const sides = (t: string) => Object.fromEntries(BOX_SIDE_ORDER.map((s) => [s, readBoxSides(t)?.[s]?.part ?? null]));
    expect(sides("900x200x350mm Ht.")).toEqual({ length: "900", width: "200", height: "350mm Ht." });
    expect(sides("550 x 550 x 400 mm Ht")).toEqual({ length: "550", width: "550", height: "400 mm Ht" });
    expect(sides("(275x275x350)mm")).toEqual({ length: "(275", width: "275", height: "350)mm" });
    expect(sides("3000 mm Length")).toEqual({ length: "3000 mm Length", width: null, height: null });
    expect(sides("450mm height")).toEqual({ length: null, width: null, height: "450mm height" });
    expect(sides("800mm(L)x300mm (H)")).toEqual({ length: "800mm(L)", width: null, height: "300mm (H)" });
    expect(sides("600 x 300")).toEqual({ length: "600", width: "300", height: null });
    expect(readBoxSides("900x200x350mm Ht.")?.height?.how).toBe("as written");
    expect(readBoxSides("900x200x350mm Ht.")?.length?.how).toBe("by position");
  });
  it("NEGATIVE: two parts naming one side, four parts, a list or nothing is not a box", () => {
    for (const t of ["300 H x 400 H", "1 x 2 x 3 x 4", "100/150/200 mm", "", "None", null]) expect({ t, r: readBoxSides(t) }).toEqual({ t, r: null });
  });
});

describe("ADP-2 H7 -- per-number plenum / mixing box: four fields, area or L + W + H, else refuse (owner 23:13 / 23:18 / 23:19)", () => {
  it("U1: Area, Length, Width, Height as four fields under the group label; no 'Size (as written)' -- panel and calculator", () => {
    for (const x of [panel("Nos", { family: MIX, insulated: "with", size_mm: "900x200x350mm Ht." }), calc("nos", MIX, { insulated: "with" })]) {
      expect(x.fields).toEqual(["Insulated", "Area (sq.m)", "Length (mm)", "Width (mm)", "Height (mm)"]);
      expect(x.b!.fields.filter((f) => f.label !== "Insulated").map((f) => f.group)).toEqual([GROUP, GROUP, GROUP, GROUP]);
    }
    // NEGATIVE (v47): one combined size box, no group
    const old = panel("Nos", { family: MIX, insulated: "with", size_mm: "900x200x350mm Ht." }, { w: W_OLD });
    expect(old.fields).toEqual(["Insulated", "Size (as written)"]);
    expect(old.b!.fields.some((f) => f.group)).toBe(false);
  });
  it("(b) L / W / H filled from the size as written, the value used shown with its line -- 00186 r58 stays 2233", () => {
    const x = panel("NOS", { family: MIX, insulated: "None", size_mm: "900x200x350mm Ht." });
    expect([x.supply, x.install]).toEqual([2233, 0]);
    expect([x.field("Length (mm)")?.value, x.field("Width (mm)")?.value, x.field("Height (mm)")?.value]).toEqual(["900", "200", "350"]);
    expect(x.field("Height (mm)")?.note).toBe("BoQ says 900x200x350mm Ht. -> 350 mm (the height as written)");
    expect(x.field("Length (mm)")?.note).toBe("BoQ says 900x200x350mm Ht. -> 900 mm (the first of length x width x height)");
    expect(x.working).toContain("supply: 1230 x 2 x (900 x 200 + 200 x 350 + 900 x 350) / 10^6 + 150 = 1539.9");
  });
  it("(b) calculator L / W / H 450 / 450 / 350 -> 2065 with + 150 on supply (= ADP-1); install has no adder", () => {
    const x = calc("nos", MIX, { insulated: "with", plenum_length_mm: "450", plenum_width_mm: "450", plenum_height_mm: "350" });
    expect([x.supply, x.install]).toEqual([2065, 0]);   // 1230 x 2 x (450x450 + 450x350 + 450x350)/10^6 + 150 = 1423.05 -> 1424 x 1.45
    expect(x.working).toContain("supply: 1230 x 2 x (450 x 450 + 450 x 350 + 450 x 350) / 10^6 + 150 = 1423.05");
  });
  it("(a) an area: area x the per-sq.m rate, supply and install, NO + 150 -- typed 2.5 and the model's band 'up to 0.5 sqm'", () => {
    const t = calc("nos", MIX, { insulated: "with", plenum_area_sqm: "2.5" });
    expect([t.supply, t.install]).toEqual([4459, 0]);   // 1230 x 2.5 = 3075 x 1.45 = 4458.75
    expect(t.working.some((l) => /supply adder/i.test(l))).toBe(false);
    const b = panel("Nos", { family: MIX, insulated: "with", area_band: "up to 0.5 sqm" });
    expect([b.supply, b.install]).toEqual([892, 0]);    // 1230 x 0.5 = 615 x 1.45 = 891.75
    expect(b.field("Area (sq.m)")?.value).toBe("0.5");
    expect(b.field("Area (sq.m)")?.note).toBe("BoQ says up to 0.5 sqm -> priced at 0.5 sq.m (the largest value)");
    // an area wins over the sides when both are stated
    expect(calc("nos", MIX, { insulated: "with", plenum_area_sqm: "2.5", plenum_length_mm: "450", plenum_width_mm: "450", plenum_height_mm: "350" }).supply).toBe(4459);
  });
  it("(c) refuse, offering both ways and naming what the nearest lacks -- 00087 r71 shape, a length only", () => {
    const x = panel("EA", { family: MIX, insulated: "with", size_mm: "3000 mm Length" });
    expect(x.priced).toBe(false);
    expect(x.reason).toBe("mixing box / LP plenum needs an area, or length + width + height - width and height not stated - price this row by hand");
    expect(x.field("Length (mm)")?.value).toBe("3000");
    expect(calc("nos", MIX, { insulated: "with", plenum_length_mm: "2200" }).reason)
      .toBe("mixing box / LP plenum needs an area, or length + width + height - width and height not stated - price this row by hand");
    expect(calc("nos", MIX, { insulated: "with" }).reason)
      .toBe("mixing box / LP plenum needs an area, or length + width + height - length and width and height not stated - price this row by hand");
    // NEGATIVE (v47): ADP-1's sentence
    expect(panel("EA", { family: MIX, insulated: "with", size_mm: "3000 mm Length" }, { w: W_OLD }).reason).toBe("per-number row: no width and height stated to convert the per-sq.m rate");
  });
  it("display only: every stored three-side shape prices exactly as v47 (labels, brackets, alternatives)", () => {
    for (const s of ["900x200x350mm Ht.", "550 x 550 x 400 mm Ht", "(275x275x350)mm", "525 x 525 x 450 mm High", "375x 375 x 350/400 mm High",
      "500 x 500 x 425 (H)", "600 X 600 X400", "1200x600x 350 mm High", "595mmx595mmx450mm", "1050x 100/150 x 300/350 mm High"]) {
      const a = panel("Nos", { family: MIX, insulated: "with", size_mm: s }), b = panel("Nos", { family: MIX, insulated: "with", size_mm: s }, { w: W_OLD });
      expect({ s, f: [a.supply, a.install] }).toEqual({ s, f: [b.supply, b.install] });
    }
  });
  it("NEGATIVE: per-sq.m plenums and the double-skin plenum are untouched (fields and figures equal to v47)", () => {
    for (const [unit, fam, m] of [["sqm", MIX, { insulated: "with" }], ["sqm", "double-skin plenum", { insulation_thickness_mm: "25" }]] as const) {
      const a = panel(unit, { family: fam, ...m }), b = panel(unit, { family: fam, ...m }, { w: W_OLD });
      expect({ fam, f: [a.supply, a.install], fields: a.fields }).toEqual({ fam, f: [b.supply, b.install], fields: b.fields });
    }
  });
});

// =====================================================================================================================
describe("ADP-2 B3 -- the neck dropdown offers 'Other...' (owner 14:24 'ok')", () => {
  it("the square diffuser's neck field is dropdown_or_other with the stocked necks; v47 was a plain dropdown", () => {
    const defs = (w: AssetLike) => {
      const cfg = w.category_configs.find((c) => c.category_id === ADP)!;
      return itemFieldDefs(itemListPricingSpec(cfg)!, listSpecDefs(cfg), "square diffuser", "count", { items: world(w).items });
    };
    const n = defs(NEW).find((f) => f.skuAttr === "neck_mm")!, o = defs(V47).find((f) => f.skuAttr === "neck_mm")!;
    expect([n.control, n.allowOther, n.options]).toEqual(["dropdown_or_other", true, ["300", "375", "450"]]);
    expect([o.control, o.allowOther]).toEqual(["dropdown", undefined]);
  });
  it("a typed unstocked neck ladders up with its line; above the largest (450) refuses", () => {
    const x = calc("nos", "square diffuser", { damper: "without", neck_mm: "225" }, { other: ["neck_mm"] });
    expect([x.supply, x.install]).toEqual([1532, 400]);   // the 300 neck without damper: 1056 x 1.45 = 1531.2
    expect(x.field("Neck size (as written)")?.note).toMatch(/225 mm -> priced as 300 mm/);
    expect(calc("nos", "square diffuser", { damper: "without", neck_mm: "600" }, { other: ["neck_mm"] }).reason).toBe("neck size 600 is above the largest size on the sheet (450)");
  });
  it("NEGATIVE: a model-read neck prices exactly as v47 (the ladder already applied to it)", () => {
    for (const neck of ["225 x 225", "150 x 150", "325 x 325", "375 x 375 mm", "525x 525"]) {
      const a = panel("Nos", { family: "square diffuser", damper: "without", neck_mm: neck }), b = panel("Nos", { family: "square diffuser", damper: "without", neck_mm: neck }, { w: W_OLD });
      expect({ neck, f: [a.supply, a.install, a.reason] }).toEqual({ neck, f: [b.supply, b.install, b.reason] });
    }
  });
});

// =====================================================================================================================
describe("ADP-2 U6 -- the Derivation tab", () => {
  const titles = (a: AssetLike) => itemListRuleOrder(a.category_configs.find((c) => c.category_id === ADP)!, world(a).items as any).map((l) => l.title);
  const ADDED = [
    "A damper not mentioned is decided by the air stream",
    "A per-number mixing box / LP plenum with an area is priced from the per-sq.m rate",
    "A per-number mixing box / LP plenum without an area, or length + width + height refuses, naming what is missing",
    "The length, width and height are typed in their own boxes, else read from the size",
    "An area is typed in 'Area (sq.m)', else read from the area band, at its largest value",
    "A neck size the catalogue does not stock can be typed in 'Other...'",
  ];
  const BOTH = "A row naming supply and return air leaves the damper as read";
  it("the new lines are on v48's tab and not on v47's", () => {
    const n = titles(NEW), o = titles(V47);
    for (const t of ADDED) expect({ t, n: n.includes(t), o: o.includes(t) }).toEqual({ t, n: true, o: false });
  });
  it("H5 fix (a): the both-streams line is on every tab whose rules read an air stream -- v48's four and v47's R13 alike", () => {
    expect(titles(NEW)).toContain(BOTH);
    expect(titles(V47)).toContain(BOTH);
  });
  it("ADP-1's either-or-less plenum refusal line is replaced; the H4 formula line stays", () => {
    const n = titles(NEW), o = titles(V47);
    expect(o).toContain("A per-number mixing box / LP plenum without width, height, depth refuses, naming what is missing");
    expect(n).not.toContain("A per-number mixing box / LP plenum without width, height, depth refuses, naming what is missing");
    expect(n).toContain("A per-number mixing box / LP plenum is priced from the per-sq.m rate");
  });
  it("NEGATIVE: Insulation and Piping tabs are byte-identical (their dropdown_or_other sizes get no B3 line)", () => {
    for (const cat of ["hvac_insulation", "hvac_piping"]) {
      const f = (a: AssetLike) => itemListRuleOrder(a.category_configs.find((c) => c.category_id === cat)!, world(a).items as any);
      expect(JSON.stringify(f(NEW))).toBe(JSON.stringify(f(V47)));
    }
  });
});

describe("ADP-2 harness", () => {
  it("all parts, in order", () => expect(ADP2_ALL).toEqual(["h5", "h7", "b3"]));
  it("v47 itself is not changed by applying ADP-2", () => {
    const before = JSON.stringify(V47);
    applyAdp2(V47);
    expect(JSON.stringify(V47)).toBe(before);
  });
});
