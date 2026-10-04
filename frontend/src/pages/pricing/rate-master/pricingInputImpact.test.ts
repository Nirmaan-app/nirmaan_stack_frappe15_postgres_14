/**
 * SLICE 12b(B) -- the pricing-input REACH walk and the IMPACT arithmetic.
 *
 * Both modules are PURE, which is the point: this repo has NO DOM test environment
 * (`frontend/CLAUDE.md`), so anything that matters has to live outside the component.
 *
 * ⚠️ THE REACH FIXTURE REPRODUCES THE THREE SHAPES THAT WERE MEASURED WRONG FIRST. Every one of them
 * OVER-counted, which is the dangerous direction: the badge would promise a pricer that more SKUs move
 * than do. They are pinned here as NEGATIVES so a regression cannot pass by reading "more".
 */
import { describe, it, expect } from "vitest";
import { computePricingInputReach, reachedSkuCount } from "./pricingInputReach";
import {
  computeImpact, panelShapeOf, movedLegOf, multiplierFor, editableFieldsOf, workingLegs,
  LEG_LABEL, NOT_MOVED_NOTE, isPercentField, pctText,
  skuKey, skuLabel, skuLabelContext, skuName,
} from "./pricingInputImpact";
import type { RateMasterItem } from "./rateMasterTypes";
// SLICE 12c FINISH / F3 -- the real shipped asset, because the defect lives in the join
import HVAC_V25 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v25.json";

const item = (uid: string, kind: string, attrs: Record<string, unknown>, rates: Record<string, number>): RateMasterItem =>
  ({ item_uid: uid, kind, discipline: "Electrical", unit: "Nos", attributes: attrs, rates } as unknown as RateMasterItem);

// ── the catalogue ─────────────────────────────────────────────────────────────────────────────────
const ITEMS: RateMasterItem[] = [
  // two families of one kind: only ONE is referenced, so a walk that ignores `family` over-counts
  item("u-sw1", "gear", { family: "Switchgear", item: "16A MCB" }, { list_price: 100 }),
  item("u-sw2", "gear", { family: "Switchgear", item: "32A MCB" }, { list_price: 200 }),
  item("u-db1", "gear", { family: "DB", item: "8-way DB" }, { list_price: 999 }),
  // two insulations of one kind: the conditional multiplier selects ONE
  item("u-ca", "cable", { insulation: "ARMOURED", item: "4c armoured" }, { list_price_per_mtr: 50 }),
  item("u-cu", "cable", { insulation: "UNARMOURED", item: "4c unarmoured" }, { list_price_per_mtr: 40 }),
  // a row whose install leg is a ratio of a SUM of two of its own columns
  item("u-t1", "term", { item: "10 sqmm set" }, { lug_list: 10, gland_list: 90 }),
  item("u-t2", "term", { item: "300 sqmm set" }, { lug_list: 20, gland_list: 180 }),
];
const BY_UID = new Map(ITEMS.map((i) => [i.item_uid ?? "", i]));

const CONFIGS: any = {
  // an ASSEMBLY: the multiplier lands on the SUM, so provenance is the only way to reach the components
  db: {
    category_id: "db", item_kinds: ["gear"], attribute_definitions: [], pipelines: {
      db_boq: {
        output: ["supply"], steps: [
          { step: "component_ref", name: "mcb", ref: { kind: "gear", item: "@mcb_item", family: "Switchgear" }, target: "list_price" },
          { step: "sum_components", result: "supply" },
          { step: "scale", target: "supply", result: "supply", params: { m_from_ctx: "pi_sg" }, formula: "base*m" },
          { step: "rate_ref", ref: { kind: "x_pricing_input", item: "sg" }, target: "discount", result: "pi_sg_d" },
          { step: "rate_ref", ref: { kind: "x_pricing_input", item: "sg" }, target: "supply_markup", result: "pi_sg_m" },
          { step: "scale", target: "pi_sg_d", result: "pi_sg", params: { m_from_ctx: "pi_sg_m" }, formula: "(1-base)*(1+m)", pricing_input: true },
          // an installation SHARE of the assembly total
          { step: "scale", target: "supply", result: "install", params: { m_from_ctx: "pi_share" }, formula: "base*m" },
          { step: "rate_ref", ref: { kind: "x_pricing_input", item: "db_share" }, target: "share", result: "pi_share" },
        ],
      },
    },
  },
  // a CONDITIONAL multiplier: two branches, two inputs, two SKU subsets
  cab: {
    category_id: "cab", item_kinds: ["cable"], attribute_definitions: [], pipelines: {
      cable_boq: {
        output: ["supply"], steps: [
          { step: "match_master_row", params: { kind: "cable" } },
          {
            step: "apply_effective_multiplier", target: "list_price_per_mtr", result: "supply",
            formula: "(1-discount)*(1+markup)",
            conditions: [
              { when: { insulation: "ARMOURED" }, params: { discount_from_ctx: "pi_arm_d", markup_from_ctx: "pi_arm_m" } },
              { when: { insulation: "UNARMOURED" }, params: { discount_from_ctx: "pi_un_d", markup_from_ctx: "pi_un_m" } },
            ],
          },
          { step: "rate_ref", ref: { kind: "x_pricing_input", item: "cab_arm" }, target: "discount", result: "pi_arm_d" },
          { step: "rate_ref", ref: { kind: "x_pricing_input", item: "cab_arm" }, target: "supply_markup", result: "pi_arm_m" },
          { step: "rate_ref", ref: { kind: "x_pricing_input", item: "cab_un" }, target: "discount", result: "pi_un_d" },
          { step: "rate_ref", ref: { kind: "x_pricing_input", item: "cab_un" }, target: "supply_markup", result: "pi_un_m" },
        ],
      },
    },
  },
  // `install_as_ratio` with NO `target`: it ratios whatever the pipeline is holding
  term: {
    category_id: "term", item_kinds: ["term"], attribute_definitions: [], pipelines: {
      term_boq: {
        output: ["supply_per_set", "install_per_set"], steps: [
          { step: "match_master_row", params: { kind: "term" } },
          { step: "component", name: "lug", target: "lug_list", params: {}, formula: "base" },
          { step: "component", name: "gland", target: "gland_list", params: {}, formula: "base" },
          { step: "sum_components", result: "supply_per_set" },
          { step: "install_as_ratio", params: { ratio_from_ctx: "pi_tshare" }, result: "install_per_set" },
          { step: "rate_ref", ref: { kind: "x_pricing_input", item: "term_share" }, target: "share", result: "pi_tshare" },
        ],
      },
    },
  },
  // a FLAT ADDER: the component's value comes only from ctx -- no SKU rate is scaled
  tray: {
    category_id: "tray", item_kinds: ["gear"], attribute_definitions: [], pipelines: {
      /**
       * ⚠️ MIRRORS THE REAL CABLE-TRAY PIPELINE (updated 2026-09-29). It used to hold the additive
       * component ALONE, which modelled the walk's original belief that an adder reaches nothing --
       * a fixture shaped around the defect. A real adder sits AFTER a matched row and a targeted
       * base component, and that is what gives its addend something to be added to.
       */
      tray_boq: {
        output: ["supply"], steps: [
          { step: "match_master_row", params: { kind: "gear" } },
          { step: "component", name: "base", target: "list_price", params: {}, formula: "base" },
          { step: "component", name: "accessories", formula: "amount",
            conditions: [
              { when: { installation_type: "Ceiling" }, params: { amount_from_ctx: "pi_acc" } },
              { when: { installation_type: "Floor" }, params: { amount: 0.0 } },
            ] },
          { step: "sum_components", result: "supply" },
          { step: "rate_ref", ref: { kind: "x_pricing_input", item: "tray_acc" }, target: "amount", result: "pi_acc" },
        ],
      },
    },
  },
};

describe("SLICE 12b(B) -- the pricing-input REACH walk", () => {
  const R = computePricingInputReach(CONFIGS, ITEMS);

  it("PROVENANCE: an assembly's multiplier reaches the components that fed the SUM", () => {
    // the recon's first pass reported ZERO here, because the scale touches `supply`, not the component
    expect(reachedSkuCount(R, "sg")).toBe(2);
    expect(R["sg"].distinctSkus).toEqual(["u-sw1", "u-sw2"]);
  });

  it("NEGATIVE, over-count #1: a literal `family` on the ref NARROWS the reach", () => {
    // without it the walk takes every `gear` row -- 3 instead of 2, and the extra one is a DB shell
    expect(R["sg"].distinctSkus).not.toContain("u-db1");
  });

  it("NEGATIVE, over-count #2: a conditional multiplier is walked PER BRANCH", () => {
    // folded together, each input would take BOTH cables
    expect(R["cab_arm"].distinctSkus).toEqual(["u-ca"]);
    expect(R["cab_un"].distinctSkus).toEqual(["u-cu"]);
    expect(R["cab_arm"].distinctSkus).not.toContain("u-cu");
  });

  it("NEGATIVE, over-count #3: `install_as_ratio` has no target, and still reaches the summed columns", () => {
    // it read ZERO before, and was mis-reported as a flat adder
    expect(reachedSkuCount(R, "term_share")).toBe(2);
    expect(R["term_share"].isFlatAdder).toBe(false);
    // BOTH columns of each row are in the sum, so each SKU appears once per column
    expect(R["term_share"].columns.filter((c) => c.itemUid === "u-t1").map((c) => c.rateKey).sort())
      .toEqual(["gland_list", "lug_list"]);
  });

  /**
   * ⚠️ INVERTED, NOT DELETED (owner ruling, 2026-09-29). This pinned the walk's ORIGINAL answer --
   * that a flat adder reaches no SKU -- which was a symptom of the walk never following the ADDITIVE
   * path: an additive `component` carries no `target`, so nothing was recorded. The owner's rule is
   * whose PRICE MOVES, not what the input multiplies, and an adder moves every SKU of its pipeline.
   * The old claim is now asserted FALSE so it can never come back quietly.
   */
  it("a FLAT ADDER reaches EVERY SKU whose price it moves, and is still marked as an adder", () => {
    expect(reachedSkuCount(R, "tray_acc")).toBeGreaterThan(0);   // was: toBe(0)
    expect(R["tray_acc"].isFlatAdder).toBe(true);
    expect(R["tray_acc"].adder).toBeTruthy();
    expect(R["tray_acc"].adder!.formula).toBeTruthy();
    expect(R["tray_acc"].readByCategories).toEqual(["tray"]);
  });

  it("owner N-4: the reach records WHICH rate column each input moves", () => {
    expect(R["sg"].columns.every((c) => c.rateKey === "list_price")).toBe(true);
    expect(R["cab_un"].columns[0].rateKey).toBe("list_price_per_mtr");
  });

  it("owner N-2: DISTINCT SKUs, and the categories ride on the row", () => {
    // `db_share` reaches the same two rows through the same assembly
    expect(R["db_share"].distinctSkus).toEqual(["u-sw1", "u-sw2"]);
    expect(R["db_share"].byCategory["db"]).toEqual(["u-sw1", "u-sw2"]);
    expect(R["sg"].columns[0].categories).toEqual(["db"]);
  });

  it("NEGATIVE: no cross-call leakage -- two runs of different config sets do not pollute each other", () => {
    // the (kind, rateKey) lookup was module state once; a second call inherited the first's columns
    const only = computePricingInputReach({ tray: CONFIGS.tray }, ITEMS);
    expect(Object.keys(only)).toEqual(["tray_acc"]);
    expect(reachedSkuCount(only, "sg")).toBe(0);
    // and the original result is unchanged
    expect(reachedSkuCount(R, "sg")).toBe(2);
  });

  it("NEGATIVE: an empty config set reaches nothing and does not throw", () => {
    expect(computePricingInputReach({}, ITEMS)).toEqual({});
    expect(computePricingInputReach(null, null)).toEqual({});
  });
});

describe("SLICE 12b(B) -- the five panel shapes", () => {
  const R = computePricingInputReach(CONFIGS, ITEMS);

  it("maps every shipped rate-key shape, including the four the owner settled at Q1-Q4", () => {
    expect(panelShapeOf({ discount: 0.7, supply_markup: 0.65 }, R["sg"])).toBe("pair");
    // Q1: a wastage rides INSIDE a pair -- the input still moves the BoQ rate
    expect(panelShapeOf({ discount: 0.57, supply_markup: 0.4, wastage: 0.05 }, R["cab_un"])).toBe("pair");
    // Q2: markup only, and Q4: discount only -- both still pairs, with fewer fields
    expect(panelShapeOf({ supply_markup: 0.45 }, R["sg"])).toBe("pair");
    expect(panelShapeOf({ discount: 0.0 }, R["sg"])).toBe("pair");
    expect(panelShapeOf({ share: 0.2 }, R["db_share"])).toBe("installation_share");
    expect(panelShapeOf({ installation_markup: 1.0 }, R["sg"])).toBe("installation_markup");
    expect(panelShapeOf({ ratio: 0.8 }, R["sg"])).toBe("bcs_only");
    expect(panelShapeOf({ bcs_markup: 0.0 }, R["sg"])).toBe("bcs_only");
    expect(panelShapeOf({ amount: 106 }, R["tray_acc"])).toBe("flat_adder");
  });

  it("Q3: the shape comes from HOW the input is consumed, never the rate key's name", () => {
    // `tray_cutting` carries `installation_markup` and would read as an installation-markup panel --
    // but it marks up a flat ADDER, so it shares the adder's panel and its condition (owner Q3).
    // ⚠️ THE TEST THAT CARRIES THIS CHANGED WITH THE RULING: it used to rest on the adder reaching no
    // SKU. It now rests on the adder FLAG, which is set by the additive component that reads it --
    // the only signal that survives the adder correctly reaching all of its SKUs.
    expect(panelShapeOf({ installation_markup: 0.45 }, R["tray_acc"])).toBe("flat_adder");
    expect(reachedSkuCount(R, "tray_acc")).toBeGreaterThan(0);   // ...and its panel is NOT empty
    // and with a real reach, the same rate key IS an installation markup
    expect(panelShapeOf({ installation_markup: 0.45 }, R["sg"])).toBe("installation_markup");
  });

  it("each shape names its leg, and says what it does NOT move (item 12)", () => {
    expect(movedLegOf("pair")).toBe("boq_supply");
    expect(movedLegOf("installation_share")).toBe("boq_install");
    expect(movedLegOf("installation_markup")).toBe("boq_install");
    expect(movedLegOf("bcs_only")).toBe("bcs");
    expect(LEG_LABEL.boq_supply).toBe("SKU rate (BoQ supply)");
    expect(LEG_LABEL.bcs).toBe("SKU rate (BCS)");
    // owner N-3, verbatim intent: a BCS-only input must say the BoQ rate is untouched
    expect(NOT_MOVED_NOTE.bcs_only).toBe("The BoQ rate is not impacted.");
    expect(NOT_MOVED_NOTE.installation_share).toBe("The BoQ supply rate is not impacted.");
    expect(NOT_MOVED_NOTE.installation_markup).toBe("The BCS install rate is not impacted.");
    for (const s of ["pair", "installation_share", "installation_markup", "bcs_only", "flat_adder"] as const) {
      expect(NOT_MOVED_NOTE[s]).toBeTruthy();
    }
  });

  it("the panel offers only the fields the input actually carries (Q2 / Q4)", () => {
    expect(editableFieldsOf({ discount: 0.7, supply_markup: 0.65 })).toEqual(["discount", "supply_markup"]);
    expect(editableFieldsOf({ supply_markup: 0.45 })).toEqual(["supply_markup"]);
    expect(editableFieldsOf({ discount: 0 })).toEqual(["discount"]);
    // Q1: the wastage IS offered -- the mock's pair panel had no field for it
    expect(editableFieldsOf({ discount: 0.57, supply_markup: 0.4, wastage: 0.05 }))
      .toEqual(["discount", "supply_markup", "wastage"]);
  });
});

describe("SLICE 12b(B) -- the multipliers are DERIVED, never stored", () => {
  it("BoQ = (1-discount) x (1+markup); BCS = (1-discount) x (1+wastage)", () => {
    expect(multiplierFor("pair", { discount: 0.7, supply_markup: 0.65 }, "boq_supply"))
      .toBeCloseTo(0.495, 12);
    expect(multiplierFor("pair", { discount: 0.57, wastage: 0.05 }, "bcs")).toBeCloseTo(0.4515, 12);
  });

  it("a MISSING operand contributes its identity -- which is what makes Q2 and Q4 need no special case", () => {
    expect(multiplierFor("pair", { supply_markup: 0.45 }, "boq_supply")).toBeCloseTo(1.45, 12);
    expect(multiplierFor("pair", { discount: 0.5 }, "boq_supply")).toBeCloseTo(0.5, 12);
    // a 0% discount is a REAL value, not an absent one: five inputs are 0% by ruling
    expect(multiplierFor("pair", { discount: 0, supply_markup: 0.45 }, "boq_supply")).toBeCloseTo(1.45, 12);
  });

  it("a share is the ratio itself; a markup is 1 + it; a flat adder has no multiplier at all", () => {
    expect(multiplierFor("installation_share", { share: 0.2 }, "boq_install")).toBe(0.2);
    expect(multiplierFor("installation_markup", { installation_markup: 1.0 }, "boq_install")).toBe(2);
    expect(multiplierFor("bcs_only", { ratio: 0.8 }, "bcs")).toBe(0.8);
    expect(multiplierFor("bcs_only", { bcs_markup: 0 }, "bcs")).toBe(1);
    expect(multiplierFor("flat_adder", { amount: 106 }, "boq_supply")).toBeNull();
  });
});

describe("SLICE 12b(B) -- the per-SKU impact (owner N-1)", () => {
  const R = computePricingInputReach(CONFIGS, ITEMS);

  it("the figure is the SKU's OWN stored rate x the multiplier, UNROUNDED", () => {
    const out = computeImpact({ discount: 0.7, supply_markup: 0.65 }, { discount: 0.65 }, R["sg"], BY_UID);
    const r = out.rows.find((x) => x.itemUid === "u-sw1")!;
    expect(r.storedRate).toBe(100);
    expect(r.now).toBeCloseTo(49.5, 9);          // 100 x 0.495 -- NOT rounded to tens
    expect(r.becomes).toBeCloseTo(57.75, 9);     // 100 x (0.35 x 1.65)
    expect(r.pctChange).toBeCloseTo(16.6666, 3);
    expect(out.legLabel).toBe("SKU rate (BoQ supply)");
  });

  it("Save is gated on something having CHANGED (item 10)", () => {
    expect(computeImpact({ discount: 0.7 }, {}, R["sg"], BY_UID).changed).toBe(false);
    expect(computeImpact({ discount: 0.7 }, { discount: 0.7 }, R["sg"], BY_UID).changed).toBe(false);
    expect(computeImpact({ discount: 0.7 }, { discount: 0.65 }, R["sg"], BY_UID).changed).toBe(true);
    // ...including a change TO zero, which is a legitimate value
    expect(computeImpact({ discount: 0.7 }, { discount: 0 }, R["sg"], BY_UID).changed).toBe(true);
  });

  it("owner N-2: ONE row per distinct SKU per column, grouped by category", () => {
    const out = computeImpact({ share: 0.2 }, { share: 0.25 }, R["db_share"], BY_UID);
    expect(out.rows.map((r) => r.itemUid).sort()).toEqual(["u-sw1", "u-sw2"]);
    expect(Object.keys(out.rowsByCategory)).toEqual(["db"]);
  });

  it("a SKU moved on TWO columns yields one row per column -- they are different numbers", () => {
    const out = computeImpact({ share: 0.25 }, { share: 0.3 }, R["term_share"], BY_UID);
    const t1 = out.rows.filter((r) => r.itemUid === "u-t1");
    expect(t1.map((r) => r.rateKey).sort()).toEqual(["gland_list", "lug_list"]);
    expect(t1.find((r) => r.rateKey === "lug_list")!.storedRate).toBe(10);
    expect(t1.find((r) => r.rateKey === "gland_list")!.storedRate).toBe(90);
  });

  it("NEGATIVE: nothing moves when the edit matches the stored value", () => {
    const out = computeImpact({ discount: 0.7, supply_markup: 0.65 }, { discount: 0.7 }, R["sg"], BY_UID);
    expect(out.rows.every((r) => !r.moved)).toBe(true);
  });

  it("NEGATIVE: a zero `now` gives a null percentage, never an infinity", () => {
    const zero = new Map(BY_UID);
    zero.set("u-sw1", item("u-sw1", "gear", { family: "Switchgear", item: "free" }, { list_price: 0 }));
    const out = computeImpact({ discount: 0.7, supply_markup: 0.65 }, { discount: 0.65 }, R["sg"], zero);
    expect(out.rows.find((r) => r.itemUid === "u-sw1")!.pctChange).toBeNull();
  });

  /**
   * ⚠️ INVERTED (owner ruling, 2026-09-29). This asserted an EMPTY adder panel, which is exactly what
   * the owner rejected: an adder moves every price in its pipeline, so its panel lists them. The rows
   * are `rate + adder`, never `rate x multiplier`, and the % therefore VARIES across the SKUs -- a
   * flat amount is a larger share of a cheap item than a dear one, and that spread is the point.
   */
  it("a flat adder lists every SKU whose price moves, as rate PLUS adder", () => {
    const ctx = {
      ctxNow: { pi_acc: 106 },
      ctxNext: { pi_acc: 120 },
      baseMultiplier: new Map<string, number>(),
    };
    const out = computeImpact({ amount: 106 }, { amount: 120 }, R["tray_acc"], BY_UID, ctx);
    expect(out.shape).toBe("flat_adder");
    expect(out.rows.length).toBeGreaterThan(0);        // was: toEqual([])
    expect(out.changed).toBe(true);
    expect(out.adderNow).toBe(106);
    expect(out.adderNext).toBe(120);
    expect(out.adderWhen).toEqual({ installation_type: "Ceiling" });
    // the addend is ADDED, and it is the SAME addend on every row...
    for (const r of out.rows) expect(r.becomes - r.now).toBeCloseTo(14, 9);
    // ...so the PERCENTAGE differs between a cheap SKU and a dear one, which a multiplier could never do
    const pcts = out.rows.map((r) => r.pctChange!);
    expect(Math.max(...pcts)).toBeGreaterThan(Math.min(...pcts));
  });

  it("a flat adder is ONE row per SKU, never one per rate column", () => {
    const ctx = { ctxNow: { pi_acc: 106 }, ctxNext: { pi_acc: 120 }, baseMultiplier: new Map<string, number>() };
    const out = computeImpact({ amount: 106 }, { amount: 120 }, R["tray_acc"], BY_UID, ctx);
    // an addend lands ONCE on the sum; the same tray rendered per column would read as double the money
    expect(new Set(out.rows.map((r) => r.itemUid)).size).toBe(out.rows.length);
  });

  it("display helpers: a percentage renders as one, an amount does not", () => {
    expect(isPercentField("discount")).toBe(true);
    expect(isPercentField("share")).toBe(true);
    expect(isPercentField("amount")).toBe(false);
    expect(pctText(0.45)).toBe("45%");
    expect(pctText(0)).toBe("0%");
    expect(pctText(null)).toBe("");
  });
});

describe("SLICE 12b(B) -- the SKU working shows BOTH legs (owner item 11)", () => {
  it("⚠️ a PAIR shows the BoQ leg AND the BCS leg, with their own figures", () => {
    // Found in the BROWSER CERT, not by a test: the detail rendered one leg and carried the LIST's
    // wording, "open a SKU to see both legs" -- an instruction to do what the reader had already done,
    // with the second leg never shown. The pure module had no notion of a detail view, so nothing here
    // could have failed. This is that gap, closed and pinned.
    const legs = workingLegs("pair", 17950, { discount: 0.7, supply_markup: 0.65 },
                             { discount: 0.65, supply_markup: 0.65 });
    expect(legs).toHaveLength(2);
    expect(legs[0].title).toBe("SKU rate (BoQ supply)");
    expect(legs[0].now).toBeCloseTo(8885.25, 6);
    expect(legs[0].becomes).toBeCloseTo(10366.125, 6);
    expect(legs[1].title).toBe("SKU rate (BCS)");
    expect(legs[1].now).toBeCloseTo(5385, 6);          // 17950 x (1 - 0.70)
    expect(legs[1].becomes).toBeCloseTo(6282.5, 6);    // 17950 x (1 - 0.65)
    expect(legs[1].moves).toBe(true);
    // ⚠️ the BCS leg does NOT use the supply markup, and must not list it: showing every field under
    // every leg told the reader the markup feeds a figure it has no part in (found in the cert).
    expect(legs[0].uses).toEqual(["discount", "supply_markup"]);
    expect(legs[1].uses).toEqual(["discount"]);
    expect(legs[1].uses).not.toContain("supply_markup");
  });

  it("the BCS leg carries the WASTAGE term where the input has one (Q1)", () => {
    const legs = workingLegs("pair", 100, { discount: 0.57, supply_markup: 0.4, wastage: 0.05 },
                             { discount: 0.57, supply_markup: 0.4, wastage: 0.1 });
    expect(legs[1].formula).toContain("wastage");
    expect(legs[1].now).toBeCloseTo(45.15, 6);         // 100 x 0.43 x 1.05
    expect(legs[1].becomes).toBeCloseTo(47.3, 6);      // 100 x 0.43 x 1.10
    // ...and the BoQ leg does NOT move, because only the wastage changed
    expect(legs[0].now).toBeCloseTo(legs[0].becomes, 9);
  });

  it("NEGATIVE: a one-leg shape shows exactly ONE block", () => {
    for (const s of ["installation_share", "installation_markup", "bcs_only", "flat_adder"] as const) {
      expect(workingLegs(s, 100, { share: 0.2, installation_markup: 1, ratio: 0.8, amount: 5 },
                         { share: 0.25, installation_markup: 1, ratio: 0.8, amount: 5 })).toHaveLength(1);
    }
  });

  it("a leg that does NOT move says so rather than showing a silent equal pair", () => {
    const legs = workingLegs("pair", 100, { discount: 0.5, supply_markup: 0.4 },
                             { discount: 0.5, supply_markup: 0.6 });   // only the MARKUP changed
    expect(legs[0].moves).toBe(true);
    expect(legs[1].moves).toBe(false);                 // BCS has no markup term
  });
});

/**
 * ⚠️ THE PANEL'S OPEN SKU IS KEYED, NOT CAPTURED. The component half is a React semantic and this
 * repo has no DOM environment, so what is pinned here is the property the re-derivation RESTS on:
 * a SKU's key is a function of its identity alone, so it survives any change to the values, and a
 * lookup by that key returns the LIVE row. Holding the row object instead froze the verdict's
 * figures while its own legs kept recomputing -- found in the browser cert.
 */
describe("skuKey - the identity the open detail is re-derived from", () => {
  const row = { itemUid: "rmi-aaa", kind: "db_item", rateKey: "list_price" };

  it("is a function of identity ALONE, so it is stable across a value change", () => {
    expect(skuKey(row)).toBe(skuKey({ ...row }));
  });

  it("separates rows that differ in ANY of the three parts", () => {
    const keys = new Set([
      skuKey(row),
      skuKey({ ...row, itemUid: "rmi-bbb" }),
      skuKey({ ...row, kind: "socket_item" }),
      skuKey({ ...row, rateKey: "install_base" }),
    ]);
    expect(keys.size).toBe(4);
  });

  it("cannot be forged: a NUL join keeps the three parts unambiguous", () => {
    // a plain "-" join would let ("a-b","c") collide with ("a","b-c")
    expect(skuKey({ itemUid: "a", kind: "b", rateKey: "c" }))
      .not.toBe(skuKey({ itemUid: "a-b", kind: "c", rateKey: "" }));
    expect(skuKey({ itemUid: "a", kind: "b", rateKey: "c" }))
      .toBe(["a", "b", "c"].join("\u0000"));
  });

  it("a row looked up by key after an edit is the LIVE row, not the captured one", () => {
    const rows = [
      { ...row, now: 10, becomes: 10 },
      { ...row, itemUid: "rmi-bbb", now: 20, becomes: 20 },
    ];
    const captured = rows[0];
    const afterEdit = rows.map((r) => ({ ...r, becomes: r.now * 1.5 }));
    const live = afterEdit.find((r) => skuKey(r) === skuKey(captured));
    expect(captured.becomes).toBe(10);        // the snapshot is frozen...
    expect(live!.becomes).toBe(15);           // ...the re-derived row is not
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * SLICE 12c FINISH -- THE SKU LABEL TELLS SIBLINGS APART (owner, 2026-10-03)
 *
 * "the SKu shows only item and not descriptio. it ius not possible to find which SKu is which"
 *
 * Measured on the live catalogue: 319 of HVAC's 331 named rows share a name (168 of them read
 * "Nitrile Rubber Insulation"), and 142 Electrical rows share one too. A name is a label only where
 * it identifies one row.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
describe("SLICE 12c FINISH -- the SKU label distinguishes rows sharing a name", () => {
  const ins = (cladding: string, thickness: number, pipe?: number) =>
    item(`u-${cladding}-${thickness}-${pipe ?? "x"}`, "hvac_insulation_item",
         pipe === undefined
           ? { item: "Nitrile Rubber Insulation", cladding, thickness_mm: thickness }
           : { item: "Nitrile Rubber Insulation", cladding, thickness_mm: thickness, pipe_size_mm: pipe },
         { cost_insulation: 1 });

  it("a UNIQUE name is the label, byte-identical to before -- nothing is appended", () => {
    const only = item("u1", "k", { item_name: "Cable lug 16 sq.mm" }, { list_price: 10 });
    const ctx = skuLabelContext([only]);
    expect(ctx.size).toBe(0);                 // the name identifies it; nothing to disambiguate
    expect(skuLabel(only, ctx)).toBe("Cable lug 16 sq.mm");
    expect(skuLabel(only)).toBe("Cable lug 16 sq.mm");   // and with no context at all
  });

  it("a SHARED name is followed by the facts that differ -- and ONLY those", () => {
    const rows = [ins("26G Aluminium", 25, 100), ins("26G Aluminium", 50, 100), ins("Aluminium Foil", 25, 100)];
    const ctx = skuLabelContext(rows);
    // pipe_size_mm is the SAME on all three, so it is NOT a distinguishing fact and is left out
    expect(ctx.get("Nitrile Rubber Insulation")).toEqual(["cladding", "thickness_mm"]);
    expect(skuLabel(rows[0], ctx)).toBe("Nitrile Rubber Insulation · cladding 26G Aluminium · thickness_mm 25");
    expect(skuLabel(rows[1], ctx)).toBe("Nitrile Rubber Insulation · cladding 26G Aluminium · thickness_mm 50");
    // THE DEFECT: without the context every one of them reads the same
    expect(new Set(rows.map((r) => skuLabel(r))).size).toBe(1);
    expect(new Set(rows.map((r) => skuLabel(r, ctx))).size).toBe(3);
  });

  it("a fact ABSENT on a row is skipped rather than printed as blank or null", () => {
    const rows = [ins("26G Aluminium", 25, 100), ins("26G Aluminium", 25)];
    const ctx = skuLabelContext(rows);
    expect(ctx.get("Nitrile Rubber Insulation")).toEqual(["pipe_size_mm"]);
    expect(skuLabel(rows[1], ctx)).toBe("Nitrile Rubber Insulation");
    expect(skuLabel(rows[0], ctx)).toBe("Nitrile Rubber Insulation · pipe_size_mm 100");
  });

  it("the spec bookkeeping attributes never reach a label", () => {
    const a = item("a", "k", { item: "X", spec_status: "ok", spec_note: "n", unit: "Mtr" }, { r: 1 });
    const b = item("b", "k", { item: "X", spec_status: "flagged", spec_note: "m", unit: "Nos" }, { r: 1 });
    const ctx = skuLabelContext([a, b]);
    expect(ctx.get("X")).toEqual(["unit"]);
    expect(skuLabel(a, ctx)).toBe("X · unit Mtr");
  });

  it("skuName reads the first of item / item_name / name, and null when none says anything", () => {
    expect(skuName(item("a", "k", { item: " Padded ", item_name: "Other" }, {}))).toBe("Padded");
    expect(skuName(item("a", "k", { item_name: "Second" }, {}))).toBe("Second");
    expect(skuName(item("a", "k", { name: "Third" }, {}))).toBe("Third");
    expect(skuName(item("a", "k", { item: "   " }, {}))).toBeNull();
    expect(skuName(null)).toBeNull();
  });

  it("an UNNAMED row keeps its value-list fallback, unchanged", () => {
    const it0 = item("u9", "k", { cladding: "26G Aluminium", thickness_mm: 25 }, { r: 1 });
    expect(skuLabel(it0, skuLabelContext([it0]))).toBe("26G Aluminium · 25");
  });

  it("the label is capped, so one row can never push a table column off screen", () => {
    const wide = (n: number) => item(`w${n}`, "k",
      { item: "Same", a: n, b: n, c: n, d: n, e: n, f: n, g: n }, { r: 1 });
    const rows = [wide(1), wide(2)];
    const ctx = skuLabelContext(rows);
    expect(ctx.get("Same")!.length).toBe(7);
    expect(skuLabel(rows[0], ctx).split(" · ").length).toBe(6);   // the name + 5 facts
  });

  it("the impact rows carry the DISAMBIGUATED label, not the bare name", () => {
    const rows = [ins("26G Aluminium", 25, 100), ins("Aluminium Foil", 25, 100)];
    const ctx = skuLabelContext(rows);
    const labels = rows.map((r) => skuLabel(r, ctx));
    expect(labels.every((l) => l.includes("cladding"))).toBe(true);
    expect(new Set(labels).size).toBe(rows.length);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * SLICE 12c FINISH, F3 -- AN ITEM-LIST SKU THE RULES REFUSE NEVER REACHES THE APPROXIMATE PATH
 *
 * The multiplier path in `computeImpact` is the approximate arithmetic the owner ruled against
 * (2026-09-29): for an item-list category it is a second implementation of rules it cannot see. A
 * CLADDING-ONLY SKU is exactly the row that used to fall into it -- the exact pricer refuses it for
 * want of a geometry, the row kept going, and the multiplier quoted a confident figure for a
 * geometry nobody named.
 *
 * Built over the REAL shipped asset and the REAL reach walk, because the defect lives in the join.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
describe("SLICE 12c FINISH / F3 -- a refused item-list SKU is sampled or reported, never guessed", () => {
  const INS = "hvac_insulation";
  const cfgs = (HVAC_V25 as { category_configs: Array<Record<string, unknown> & { category_id: string }> })
    .category_configs;
  const insCfg = cfgs.find((c) => c.category_id === INS)!;
  const allItems = (HVAC_V25 as unknown as { items: RateMasterItem[] }).items;
  const byUid = new Map(allItems.map((i) => [String(i.item_uid ?? ""), i]));
  const configs: Record<string, unknown> = {};
  for (const c of cfgs) configs[c.category_id] = c;

  /** the glass-cloth pricing input -- the one a cladding-only glass-cloth SKU reads */
  const gc = allItems.find((i) => i.kind === "hvac_pricing_input"
    && /glass/i.test(String((i.attributes as Record<string, unknown>)?.name ?? "")))!;

  const reach = computePricingInputReach(
    { [INS]: insCfg } as never,
    allItems,
  );

  it("the reach walk finds the input and its SKUs at all (else the rest proves nothing)", () => {
    expect(gc).toBeTruthy();
    const inputId = String((gc.attributes as Record<string, unknown>).item ?? "");
    expect(Object.keys(reach)).toContain(inputId);
  });

  it("⚠️ MEASURED: no input reaches a cladding-only SKU today, so the samples do not yet RENDER", () => {
    /**
     * The sampler, the no-guess guard and the panel rows are built and pinned (see
     * `pricingInputExactItemList.test.ts`), but a row only appears in the impact list if the REACH
     * WALK reports it -- and the walk records a SKU only where a step writes a STORED RATE COLUMN of
     * the matched row. A cladding-only SKU stores no cost column at all: its pipelines build the
     * assembly total. Measured on the shipped asset, every one of the seven HVAC inputs reaches only
     * `cost_insulation` / `cost_adhesive` / `cost_cladding`, all on COMPOSITE rows.
     *
     * This is the `isFlatAdder` lesson one level further on -- a target-keyed walk measures what an
     * input MULTIPLIES, not whose PRICE MOVES. Widening it changes the SKU counts and lists on a
     * surface the owner has already reviewed twice, so it is a ruling, not a tidy-up. The pin states
     * the measurement so the day the walk changes, this test says so instead of passing quietly.
     */
    const inputId = String((gc.attributes as Record<string, unknown>).item ?? "");
    const r = reach[inputId];
    const claddingOnlyUids = new Set(allItems
      .filter((i) => (i.attributes as Record<string, unknown>)?.item === "Cladding Only")
      .map((i) => String(i.item_uid ?? "")));
    expect(claddingOnlyUids.size).toBe(5);
    const reached = (r?.columns ?? []).filter((c) => claddingOnlyUids.has(c.itemUid));
    expect(reached).toEqual([]);
    // every input: the same answer, and only composite columns
    for (const rr of Object.values(reach)) {
      expect((rr.columns ?? []).filter((c) => claddingOnlyUids.has(c.itemUid))).toEqual([]);
    }
  });

  it("and if one DID reach the panel it would be sampled, not guessed -- the row shape is ready", () => {
    // the guard is in `computeImpact`: an item-list SKU with no legs takes the samples branch and
    // leaves now/becomes at 0, so the multiplier path can never write a figure for it. Proven here
    // on a SYNTHETIC reach column for a real cladding-only SKU.
    const inputId = String((gc.attributes as Record<string, unknown>).item ?? "");
    const co = allItems.find((i) => (i.attributes as Record<string, unknown>)?.item === "Cladding Only")!;
    const r = {
      ...reach[inputId],
      columns: [{ itemUid: String(co.item_uid ?? ""), kind: co.kind, rateKey: "cost_cladding",
                  categories: [INS] }],
    } as never;
    const stored = { ...(gc.rates ?? {}) } as Record<string, number>;
    const out = computeImpact(stored, { ...stored, rate: Number(stored.rate ?? 0) + 50 },
      r, byUid, null,
      { items: allItems, inputItemKey: String(gc.item_uid ?? ""), configs } as never);
    expect(out.rows.length).toBe(1);
    const row = out.rows[0];
    expect(!!row.samples || !!row.note).toBe(true);
    if (row.samples) {
      expect(row.now).toBe(0);            // ⚠️ the multiplier path would have written a figure here
      expect(row.becomes).toBe(0);
      expect(row.pctChange).toBeNull();
      expect(row.samples.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("a GEOMETRY-CARRYING SKU of the same category is still priced directly, with no samples", () => {
    const inputId = String((gc.attributes as Record<string, unknown>).item ?? "");
    const stored = { ...(gc.rates ?? {}) } as Record<string, number>;
    const out = computeImpact(stored, { ...stored, rate: Number(stored.rate ?? 0) + 50 },
      reach[inputId], byUid, null,
      { items: allItems, inputItemKey: String(gc.item_uid ?? ""), configs } as never);
    const composites = out.rows.filter((row) => {
      const it = byUid.get(row.itemUid);
      return it && (it.attributes as Record<string, unknown>)?.item !== "Cladding Only";
    });
    expect(composites.length).toBeGreaterThan(0);
    for (const row of composites) expect(row.samples).toBeUndefined();
  });
});
