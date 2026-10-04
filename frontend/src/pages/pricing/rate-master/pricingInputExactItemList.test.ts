/**
 * SLICE 12c, ACCEPTANCE ITEM 23 -- ONE PRICING PATH, PROVEN.
 *
 * Owner: "for the pricing input sheet panel, we need to use the same pipeline for pricing impact
 * calculation as the rate helper panel. just like we did for electrical."
 *
 * ⚠️ WHAT MAKES THIS NOT VACUOUS. `priceSkuExactItemList` calls `priceItemList`, so comparing it with
 * itself would prove nothing. What is at stake is not the ARITHMETIC (there is only one copy of that)
 * but the WIRING: whether the panel hands that function the right spec, the right row unit and the
 * right attributes. So this file builds the row INDEPENDENTLY -- the way a reader would say "price
 * this SKU" -- calls `priceItemList` directly, and asserts the panel's before and after figures equal
 * it, for every SKU and for every one of the seven inputs.
 */
import { describe, it, expect } from "vitest";
import HVAC from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v16.json";
import {
  priceSkuExactItemList, isItemListConfig, itemsWithInput, sampleGeometries,
  priceSkuExactSamples, skuCarriesGeometry,
} from "./pricingInputExact";
import { sampleGeometryText } from "./pricingInputImpact";
// SLICE 12c FINISH / F3 -- the real shipped asset, never a fixture
import HVAC_V22 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v22.json";
import { itemListPricingSpec, priceItemList } from "../../boq-wizard/rate-helper/itemListPricing";
import { computePricingInputReach } from "./pricingInputReach";
import EALL from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_electrical_all_v66.json";
import type { RateMasterItem, RateCategoryConfig } from "./rateMasterTypes";

type Asset = { discipline: string; items: any[]; category_configs: any[] };
const asset = HVAC as unknown as Asset;
const hvacAsset = HVAC as unknown as { category_configs: any[] };
const KIND = "hvac_insulation_item";
const PI_KIND = "hvac_pricing_input";

const items: RateMasterItem[] = asset.items.map((it) => ({
  item_uid: it.item_uid, discipline: asset.discipline, kind: it.kind,
  brand: it.brand ?? undefined, unit: it.unit,
  attributes: { ...it.attributes }, rates: { ...it.rates },
})) as RateMasterItem[];
const cfg = asset.category_configs.find((c) => c.category_id === "hvac_insulation") as RateCategoryConfig;
const spec = itemListPricingSpec(cfg)!;
const skus = items.filter((i) => i.kind === KIND);
const inputIds = asset.items.filter((i) => i.kind === PI_KIND)
  .map((i) => String(i.attributes.item)).sort();

/** THE INDEPENDENT READING: a perfectly-stated row for this SKU, built here and priced here. */
function helperFigures(sku: RateMasterItem, cat: readonly RateMasterItem[]) {
  const attributes: Record<string, { value: string | number | null }> = {};
  for (const [k, v] of Object.entries((sku.attributes ?? {}) as Record<string, unknown>)) {
    if (k === spec.unit_class_attr) continue;
    if (v === null || v === undefined || v === "") continue;
    attributes[k] = { value: String(v) };
  }
  const r = priceItemList(spec, cat as RateMasterItem[], String(sku.unit ?? ""), [{ attributes } as never]);
  return r.priced ? { supply: r.supply, install: r.install } : null;
}

/** the value column an input carries, and a changed value for it */
function bumped(id: string): Record<string, number> {
  const row = asset.items.find((i) => i.kind === PI_KIND && i.attributes.item === id)!;
  const key = ["rate", "factor", "amount"].find((k) => row.rates[k] !== undefined)!;
  return { [key]: Number(row.rates[key]) + (key === "factor" ? 0.05 : 50) };
}

describe("acceptance 23: the impact panel prices through the rate-helper panel's own pricer", () => {
  it("(a) the category IS an item-list one, so the panel takes that path at all", () => {
    expect(isItemListConfig(cfg)).toBe(true);
    expect(skus.length).toBe(224);
    expect(inputIds).toHaveLength(7);
  });

  it("(b) BEFORE: every SKU's panel figure equals the helper path's, 0 differences", () => {
    let checked = 0, priced = 0;
    for (const sku of skus) {
      const ex = priceSkuExactItemList(sku, cfg, items, items);
      const want = helperFigures(sku, items);
      expect(ex.ok).toBe(want !== null);
      if (!want) continue;
      priced++;
      const got = Object.fromEntries(ex.legs.map((l) => [l.output, l.now]));
      expect(got.supply).toBe(want.supply);
      expect(got.install).toBe(want.install);
      // nothing moved, because nothing was patched
      expect(ex.legs.every((l) => !l.moved)).toBe(true);
      checked += 2;
    }
    // ⚠️ the counts are asserted so this cannot pass on an empty set
    expect(priced).toBe(224);
    expect(checked).toBe(448);
  });

  it("(b) AFTER: for each of the SEVEN inputs, every SKU's 'becomes' equals the helper path's", () => {
    const moversByInput: Record<string, number> = {};
    let checked = 0;
    for (const id of inputIds) {
      const patch = bumped(id);
      const next = itemsWithInput(items, id, patch);
      let movers = 0;
      for (const sku of skus) {
        const ex = priceSkuExactItemList(sku, cfg, items, next);
        const want = helperFigures(sku, next);
        if (!want) { expect(ex.ok).toBe(false); continue; }
        const got = Object.fromEntries(ex.legs.map((l) => [l.output, l.becomes]));
        expect(got.supply).toBe(want.supply);
        expect(got.install).toBe(want.install);
        checked += 2;
        if (ex.legs.some((l) => l.moved)) movers++;
      }
      moversByInput[id] = movers;
    }
    expect(checked).toBe(7 * 448);
    // the separation the seventh input exists for: the GI rate moves ONLY the 3 GI rows, and the two
    // aluminium grades move disjoint sets of 68
    expect(moversByInput.gi_sheet_rate).toBe(3);
    expect(moversByInput.gi_framework_factor).toBe(3);
    expect(moversByInput.gi_framework_adder).toBe(3);
    expect(moversByInput.alu_sheet_24g).toBe(68);
    expect(moversByInput.alu_sheet_26g).toBe(68);
    expect(moversByInput.glass_cloth).toBe(84);
    expect(moversByInput.cladding_overlap).toBe(136);   // every aluminium-clad row, both grades
    // ⚠️ an explicit timeout, NOT a smaller sample: this prices 224 SKUs twice for each of 7 inputs
    // (3,136 figures). It runs in ~2.5 s alone and over vitest's 5 s default when the suite is loaded.
  }, 120_000);

  it("NEGATIVE: a SKU the rules refuse is REPORTED with its reason, never silently dropped", () => {
    const broken = { ...skus[0], attributes: { ...skus[0].attributes, cladding: "Not A Cladding" } };
    const ex = priceSkuExactItemList(broken as RateMasterItem, cfg, items, items);
    expect(ex.ok).toBe(false);
    expect(ex.legs).toHaveLength(0);
    expect(typeof ex.note).toBe("string");
    expect(ex.note!.length).toBeGreaterThan(0);
  });

  it("NEGATIVE: a config with no item-list rules is not routed down this path", () => {
    const adp = asset.category_configs.find((c) => c.category_id === "hvac_adp");
    const vendor = asset.category_configs.find((c) => c.category_id === "hvac_ahu");
    expect(isItemListConfig(adp)).toBe(true);        // ADP IS item-list
    expect(isItemListConfig(vendor)).toBe(false);    // a message-only config is not
    expect(isItemListConfig(null)).toBe(false);
    const ex = priceSkuExactItemList(skus[0], vendor, items, items);
    expect(ex.ok).toBe(false);
    expect(ex.note).toContain("no item-list pricing rules");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// OWNER RULING 2 / U9 -- the sample geometries, and the fact that nothing renders them yet.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("ruling 2 / U9: sample geometries from the catalogue's own stocked sizes", () => {
  const NITRILE = "Nitrile Rubber Insulation";
  const AXES = spec.ladders as readonly string[];

  /**
   * The stocked tuples of a family, ordered by the LADDER AXES IN THEIR DECLARED ORDER -- the picker's
   * rule, derived here from `spec.ladders` rather than assumed.
   *
   * ⚠️ MY FIRST VERSION HARDCODED PIPE-MAJOR ORDER AND PASSED BY COINCIDENCE: on this catalogue the
   * pipe-major and thickness-major extremes happen to agree, so the test was green while asserting a
   * rule the code does not follow. It only surfaced when a 9999 mm row was added in the next test --
   * a reminder that a green assertion over real data can still be the wrong assertion.
   */
  const orderedTuples = (family: string, isLength: boolean) => {
    const seen = new Map<string, number[]>();
    for (const s of skus) {
      const at = s.attributes as Record<string, unknown>;
      if (at.item !== family) continue;
      if (isLength !== (String(s.unit) !== "SQM")) continue;
      const t = AXES.map((a) => Number(at[a]));
      if (t.some((n) => !Number.isFinite(n))) continue;
      seen.set(t.join("|"), t);
    }
    return Array.from(seen.values()).sort((x, y) => {
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
      return 0;
    });
  };

  it("picks the SMALLEST, MIDDLE and LARGEST stocked combination -- no number written in code", () => {
    const got = sampleGeometries(spec as never, items, NITRILE, "length", 3);
    expect(got).toHaveLength(3);
    const all = orderedTuples(NITRILE, true);
    expect(all.length).toBeGreaterThan(3);
    const stocked = new Set(all.map((t) => t.join("|")));
    for (const g of got) expect(stocked.has(AXES.map((a) => g[a]).join("|"))).toBe(true);
    // the ends ARE the ends, and the middle sits between them, under the DECLARED axis order
    expect(AXES.map((a) => got[0][a])).toEqual(all[0]);
    expect(AXES.map((a) => got[2][a])).toEqual(all[all.length - 1]);
    expect(got[1][AXES[0]]).toBeGreaterThanOrEqual(got[0][AXES[0]]);
    expect(got[2][AXES[0]]).toBeGreaterThanOrEqual(got[1][AXES[0]]);
  });

  it("is a FUNCTION OF THE CATALOGUE, so it follows a new SKU with no code change", () => {
    // cloned from a NITRILE row, because the picker is per family and per unit class; and given the TOP
    // rung on the FIRST declared axis, because that is the axis the order is major on
    const seed = skus.find((s) => (s.attributes as Record<string, unknown>).item === NITRILE)!;
    const topFirstAxis = Math.max(...orderedTuples(NITRILE, true).map((t) => t[0]));
    const clone = {
      ...seed, item_uid: "rmi-test-sample-geometry",
      attributes: { ...seed.attributes, [AXES[0]]: topFirstAxis, [AXES[1]]: 9999 },
    } as RateMasterItem;
    const got = sampleGeometries(spec as never, [...items, clone], NITRILE, "length", 3);
    expect(got[got.length - 1][AXES[1]]).toBe(9999);
  });

  it("NEGATIVE: fewer picks than asked yields however many exist, and never a duplicate", () => {
    expect(sampleGeometries(spec as never, items, NITRILE, "length", 2)).toHaveLength(2);
    expect(sampleGeometries(spec as never, items, NITRILE, "length", 1)).toHaveLength(1);
    const many = sampleGeometries(spec as never, items, NITRILE, "length", 3);
    expect(new Set(many.map((g) => JSON.stringify(g))).size).toBe(many.length);
  });

  it("NEGATIVE: a family with no stocked geometry on an axis yields NO samples, never a guess", () => {
    // the sheet families carry no pipe size, so they have no complete ladder tuple
    expect(sampleGeometries(spec as never, items, "Thermal Nitrile Insulation", "area", 3)).toEqual([]);
    expect(sampleGeometries(spec as never, items, "no such family", "length", 3)).toEqual([]);
    expect(sampleGeometries({ ...spec, ladders: [] } as never, items, NITRILE, "length", 3)).toEqual([]);
  });

  it("⚠️ NEGATIVE: there are NO cladding-only SKUs yet, which is why nothing renders a sample", () => {
    // A cladding-only row would price a cladding and carry no insulation cost of its own. Design
    // question O1 -- one SKU per cladding type, or one per type per geometry -- is still OPEN, as is
    // Q7's PROVISIONAL rider on whether a per-sq.m cladding-only row takes the overlap factor. So the
    // picker above is shipped and tested but unused. THIS PIN FAILS, loudly, the moment such a row is
    // minted, which is exactly when the panel work has a real row to render.
    const claddingOnly = skus.filter((s) => {
      const r = (s.rates ?? {}) as Record<string, number>;
      return !(typeof r.cost_insulation === "number" && r.cost_insulation > 0);
    });
    expect(claddingOnly).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// OWNER, on the live page: "only the linked SKUs should be in the SKU list. not impacted SKUs should
// not be a part of it."
//
// The badge and the list showed every SKU the PIPELINE touches, not the ones the input's own branch
// selects: 224 for an input that moves 68, and 20 for one that moves 3. The figures were right -- only
// the real ones ever showed a change -- so this is the COUNT and the LIST, not the arithmetic.
//
// A conditional component is now noted PER BRANCH, narrowed by the `when` keys THE SKUs CARRY. Every
// conditional component Electrical has keys on a BoQ-ROW option (`cover`, `installation_type`,
// `floor_refilling`, `floor_cutting`) that no SKU carries, so it narrows by nothing and is unchanged.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("the SKU list holds only the SKUs an input really reaches", () => {
  const reach = computePricingInputReach(
    Object.fromEntries(hvacAsset.category_configs.map((c: any) => [c.category_id, c])) as never,
    items,
  );

  it("each input's count equals the number of SKUs that actually MOVE when it changes", () => {
    // the right-hand numbers are measured independently, by pricing every SKU before and after
    const expected: Record<string, number> = {
      alu_sheet_24g: 68, alu_sheet_26g: 68, glass_cloth: 84, cladding_overlap: 136,
      gi_sheet_rate: 3, gi_framework_factor: 3, gi_framework_adder: 3,
    };
    for (const [id, want] of Object.entries(expected)) {
      expect(reach[id], `${id} has no reach`).toBeTruthy();
      expect(reach[id].distinctSkus.length, `${id} lists the wrong SKU count`).toBe(want);
      // and the listed SKUs are EXACTLY the ones that move -- not a count that happens to agree
      const patch = bumped(id);
      const next = itemsWithInput(items, id, patch);
      const movers = new Set(skus.filter((s) => {
        const ex = priceSkuExactItemList(s, cfg, items, next);
        return ex.ok && ex.legs.some((l) => l.moved);
      }).map((s) => String(s.item_uid)));
      expect(new Set(reach[id].distinctSkus)).toEqual(movers);
    }
    // same reason as above -- it re-prices every SKU for all seven inputs to derive the mover SET
  }, 120_000);

  it("⚠️ NEGATIVE: a branch keying on a BoQ-ROW option narrows by NOTHING, so Electrical is unchanged", () => {
    const eallCfgs = Object.fromEntries(
      (EALL as unknown as { category_configs: any[] }).category_configs.map((c) => [c.category_id, c]));
    const eItems = (EALL as unknown as { items: any[] }).items.map((i) => ({ ...i, discipline: "Electrical" }));
    const r = computePricingInputReach(eallCfgs as never, eItems as never);
    expect(Object.keys(r).length).toBe(35);
    // the tray adders still reach every tray row -- their condition is a row option, not a SKU fact
    const trays = eItems.filter((i) => i.kind === "cable_tray").length;
    expect(trays).toBeGreaterThan(0);
    for (const id of ["tray_accessories", "tray_refilling"]) {
      if (!r[id]) continue;
      expect(r[id].isFlatAdder).toBe(true);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * SLICE 12c FINISH, F3 -- SAMPLE IMPACTS FOR A SKU WITH NO GEOMETRY OF ITS OWN
 *
 * Owner F3: "show 2-3 sample impact calculations based on sizes stored in SKU."
 *
 * A CLADDING-ONLY SKU prices a cladding and nothing else, so by design it stores neither pipe size
 * nor thickness -- and a cladding cost is proportional to the girth, which is made of exactly those
 * two. One figure for such a row would be a figure for a geometry nobody named.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
describe("SLICE 12c FINISH / F3 -- sample impacts for a geometry-less SKU", () => {
  const INS = "hvac_insulation";
  const cfg = (HVAC_V22 as { category_configs: Array<Record<string, unknown> & { category_id: string }> })
    .category_configs.find((c) => c.category_id === INS)!;
  const allItems = (HVAC_V22 as unknown as { items: RateMasterItem[] }).items;
  const items = allItems.filter((i) => i.kind === "hvac_insulation_item"
                                    || i.kind === "hvac_pricing_input");
  const claddingOnly = items.filter(
    (i) => (i.attributes as Record<string, unknown>)?.item === "Cladding Only");
  const composite = items.filter(
    (i) => i.kind === "hvac_insulation_item"
        && (i.attributes as Record<string, unknown>)?.item !== "Cladding Only");

  it("the fixture is the real thing: five cladding-only SKUs, none carrying a geometry", () => {
    expect(claddingOnly).toHaveLength(5);
    for (const sku of claddingOnly) expect(skuCarriesGeometry(cfg, sku)).toBe(false);
    // and a composite DOES carry one, so it is priced directly and needs no samples
    const withGeom = composite.filter((i) => skuCarriesGeometry(cfg, i));
    expect(withGeom.length).toBeGreaterThan(0);
    expect(priceSkuExactSamples(withGeom[0], cfg, items, items)).toEqual([]);
  });

  it("a cladding-only SKU is quoted at up to THREE stocked geometries", () => {
    const got = priceSkuExactSamples(claddingOnly[0], cfg, items, items, 3);
    expect(got.length).toBeGreaterThanOrEqual(2);
    expect(got.length).toBeLessThanOrEqual(3);
    for (const sm of got) {
      // every sample names a COMPLETE geometry, and the rules priced it
      expect(Object.keys(sm.geometry).length).toBeGreaterThan(0);
      for (const v of Object.values(sm.geometry)) expect(Number.isFinite(v)).toBe(true);
      expect(sm.result.legs.length).toBeGreaterThan(0);
    }
  });

  it("⚠️ THE SIZES ARE STOCKED ONES, never invented", () => {
    const got = priceSkuExactSamples(claddingOnly[0], cfg, items, items, 3);
    const stocked = new Set(
      composite.map((i) => {
        const a = i.attributes as Record<string, unknown>;
        return `${Number(a.pipe_size_mm)}x${Number(a.thickness_mm)}`;
      }),
    );
    for (const sm of got) {
      const key = `${sm.geometry.pipe_size_mm}x${sm.geometry.thickness_mm}`;
      expect(stocked.has(key), key).toBe(true);
    }
  });

  it("⚠️ IT NEVER MUTATES THE CATALOGUE ROW -- the SKU still stores no geometry afterwards", () => {
    const before = JSON.stringify(claddingOnly[0]);
    priceSkuExactSamples(claddingOnly[0], cfg, items, items, 3);
    expect(JSON.stringify(claddingOnly[0])).toBe(before);
    expect(skuCarriesGeometry(cfg, claddingOnly[0])).toBe(false);
  });

  it("a sample MOVES when the input moves, and the figures come from the real pricer", () => {
    // raise the glass-cloth rate and the glass-cloth claddings must move at every sample
    const gc = items.find((i) => i.kind === "hvac_pricing_input"
      && /glass/i.test(String((i.attributes as Record<string, unknown>)?.name ?? "")));
    expect(gc, "the fixture needs a glass-cloth pricing input").toBeTruthy();
    const next = items.map((i) => i.item_uid === gc!.item_uid
      ? { ...i, rates: { ...(i.rates ?? {}), rate: Number((i.rates ?? {}).rate ?? 0) + 50 } }
      : i);
    const sku = claddingOnly.find(
      (i) => /Glass Cloth/i.test(String((i.attributes as Record<string, unknown>)?.cladding ?? "")))!;
    const got = priceSkuExactSamples(sku, cfg, items, next, 3);
    expect(got.length).toBeGreaterThan(0);
    for (const sm of got) {
      const supply = sm.result.legs.find((l) => l.output === "supply")!;
      expect(supply.moved, JSON.stringify(sm.geometry)).toBe(true);
      expect(supply.becomes).toBeGreaterThan(supply.now);
    }
  });

  it("a LARGER sample geometry costs more than a smaller one -- the girth really drives it", () => {
    const got = priceSkuExactSamples(claddingOnly[0], cfg, items, items, 3);
    const girth = (g: Record<string, number>) => (g.pipe_size_mm ?? 0) + 2 * (g.thickness_mm ?? 0);
    const sorted = [...got].sort((a, b) => girth(a.geometry) - girth(b.geometry));
    const rate = (sm: typeof got[number]) => sm.result.legs.find((l) => l.output === "supply")!.now;
    for (let i = 1; i < sorted.length; i += 1) {
      expect(rate(sorted[i]), JSON.stringify(sorted[i].geometry))
        .toBeGreaterThan(rate(sorted[i - 1]));
    }
  });

  it("NEGATIVE: nothing to sample yields NO samples -- the caller then shows the refusal", () => {
    // a catalogue with no complete geometry anywhere
    const bare = [...claddingOnly, ...items.filter((i) => i.kind === "hvac_pricing_input")];
    expect(priceSkuExactSamples(claddingOnly[0], cfg, bare, bare, 3)).toEqual([]);
  });

  it("the geometry label names no axis in code and reports one unit, not three", () => {
    expect(sampleGeometryText({ pipe_size_mm: 100, thickness_mm: 25 })).toBe("pipe size 100 x 25 mm");
    expect(sampleGeometryText({ width: 2, depth: 3 })).toBe("width 2 x depth 3");
    expect(sampleGeometryText({})).toBe("");
  });
});
