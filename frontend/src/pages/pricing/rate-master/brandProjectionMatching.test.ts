import { describe, it, expect } from "vitest";
import { runPipeline } from "./ratePipelineInterpreter";
import type { Pipeline, RateMasterItem } from "./rateMasterTypes";

// ══════════════════════════════════════════════════════════════════════════════════════════
// READ-TIME COLUMN PROJECTION -- THE MATCHABILITY HALF. Owner-chosen option (C), 2026-09-03.
// ══════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ THIS IS THE ONE PROOF OPTION (B) COULD NOT DELIVER, AND IT IS WHY THESE TESTS EXIST.
//
// Option (B) was "widen the dropdown readers to a column whitelist". It was rejected as
// HALF-EXTENSIBLE: the dropdown readers and the MATCHERS are disjoint code -- 3 readers versus 13
// `it.attributes[...]` sites in `ratePipelineInterpreter.ts`, not one shared line. Measured
// 2026-09-03: that interpreter contains ZERO references to `brand`. So (B) would have shipped a
// picker that selects a value no pipeline can match on -- worse than the status quo, because the
// status quo at least does not offer a control that lies.
//
// Option (C) projects the `brand` COLUMN into `attributes` server-side, at
// `api/boq/rate_master.get_rate_master_items` -- the single endpoint that produces the one `items`
// array every matcher below consumes. THE INTERPRETER IS NOT MODIFIED AND MUST NOT BE: these tests
// pass because a projected item simply HAS the key the matchers already index.
//
// The backend half of the mechanism is pinned in
// `nirmaan_stack/api/boq/test_rate_master.py::TestBrandColumnProjection`.
//
// The items below are shaped EXACTLY as `get_rate_master_items` returns them after projection:
// `brand` present BOTH as the top-level column (unchanged, for the Data-tab column and the
// Derivation `(fixed)` block) AND inside `attributes` (projected, for matching).
// ══════════════════════════════════════════════════════════════════════════════════════════

/** An `lms_item` as the projected endpoint returns it. Two LMS rows share a description and are
 *  told apart ONLY by brand -- the live shape: 6 of 18 LMS descriptions carry two brands, with
 *  rates diverging up to 6.19x (AV Interface: Lutron 65,000 vs Zen Control 10,500). */
function projectedLms(description: string, brand: string, rate: number): RateMasterItem {
  return {
    discipline: "Electrical",
    kind: "lms_item",
    brand,
    unit: "Nos.",
    attributes: { description, brand },
    rates: { rate },
  };
}

const AV = "AV Interface module";
const LMS_ITEMS: RateMasterItem[] = [
  projectedLms(AV, "Lutron", 65000),
  projectedLms(AV, "Zen Control", 10500),
  projectedLms("QS Sensor Module", "Lutron", 15900),
  projectedLms("QS Sensor Module", "Zen Control", 8500),
];

/** `component_ref` -- the assembly matcher (ratePipelineInterpreter.ts ~L1811). Its `ref` map is
 *  matched key-by-key against `it.attributes`, so a brand key in the ref can only resolve against
 *  a PROJECTED item. */
const REF_PIPELINE: Pipeline = {
  output: ["total"],
  steps: [
    {
      step: "component_ref",
      name: "device",
      ref: { kind: "lms_item", description: "@description", brand: "@brand" },
      target: "rate",
      rate_stages: [{ mult: 1.0 }],
      qty: 1.0,
    },
    { step: "sum_components", result: "total" },
  ],
} as unknown as Pipeline;

describe("read-time column projection: brand is a MATCH KEY, not just a dropdown", () => {
  it("component_ref resolves the SAME description to different rows by brand", () => {
    // ⚠️ THE LOAD-BEARING ASSERTION. Both rows share a description; only the projected brand
    // separates them. Before the projection this ref matched TWO rows and `component_ref` refuses
    // on `refRows.length !== 1`, so the row could not price at all.
    const lutron = runPipeline("p", REF_PIPELINE, LMS_ITEMS, { description: AV, brand: "Lutron" });
    expect(lutron.status).toBe("ok");
    expect(lutron.finals.total).toBe(65000);

    const zen = runPipeline("p", REF_PIPELINE, LMS_ITEMS, { description: AV, brand: "Zen Control" });
    expect(zen.status).toBe("ok");
    expect(zen.finals.total).toBe(10500);

    // and the two genuinely differ -- a 6.19x spread, not a rounding difference
    expect(lutron.finals.total).not.toBe(zen.finals.total);
  });

  it("NEGATIVE: without the projected brand key the same ref is ambiguous and refuses", () => {
    // The pre-projection world, reproduced exactly: identical items with brand ONLY as a column.
    // This is the state 24 live lms_item rows are in today, and it is why the projection exists.
    const unprojected = LMS_ITEMS.map((it) => ({
      ...it,
      attributes: { description: it.attributes.description },
    })) as RateMasterItem[];
    const res = runPipeline("p", REF_PIPELINE, unprojected, { description: AV, brand: "Lutron" });
    expect(res.status).toBe("no_match");
    expect(res.finals.total).toBeUndefined();
  });

  it("NEGATIVE: a brand that no row carries matches nothing rather than guessing", () => {
    const res = runPipeline("p", REF_PIPELINE, LMS_ITEMS, { description: AV, brand: "Nonesuch" });
    expect(res.status).toBe("no_match");
  });
});

/** `catalog_fit` -- fits a stated number onto a catalogue ladder built from the rows matching
 *  `where` (ratePipelineInterpreter.ts ~L1424/1427), then binds the chosen row's LABEL. A
 *  projected brand in `where` narrows that ladder to one brand's rungs. */
function tray(brand: string, item: string, width: number, rate: number): RateMasterItem {
  return {
    discipline: "Electrical", kind: "cable_tray", brand, unit: "Rmt",
    attributes: { brand, item, width_mm: width }, rates: { list_price_per_mtr: rate },
  };
}

const TRAYS: RateMasterItem[] = [
  tray("Legrand", "Legrand 100", 100, 100),
  tray("Legrand", "Legrand 300", 300, 300),
  tray("Generic", "Generic 150", 150, 150),
];

const FIT_PIPELINE: Pipeline = {
  output: ["total"],
  steps: [
    {
      step: "catalog_fit",
      params: {
        bind: "fitted_tray", kind: "cable_tray",
        where: { brand: "@brand" },
        label_attr: "item", size_from: { attr: "width_mm" },
        fit_from: { attr: "width_mm" }, direction: "up", on_miss: "no_compute",
      },
    },
    {
      step: "component_ref", name: "tray",
      ref: { kind: "cable_tray", item: "@fitted_tray" },
      target: "list_price_per_mtr", rate_stages: [{ mult: 1.0 }], qty: 1.0,
    },
    { step: "sum_components", result: "total" },
  ],
} as unknown as Pipeline;

describe("read-time column projection: catalog_fit narrows its ladder by the projected brand", () => {
  it("fits 120mm up to the brand's OWN next rung, not another brand's nearer one", () => {
    // Legrand stocks 100 and 300; Generic stocks 150. Fitting 120 UP must reach Legrand's 300 and
    // must NOT be allowed to pick Generic's nearer 150. Only a brand-aware `where` can express
    // that, and only a PROJECTED item can satisfy it -- the column is invisible here.
    const res = runPipeline("p", FIT_PIPELINE, TRAYS, { width_mm: 120, brand: "Legrand" });
    expect(res.status).toBe("ok");
    expect(res.finals.total).toBe(300);
  });

  it("the other brand's ladder fits the same number differently", () => {
    const res = runPipeline("p", FIT_PIPELINE, TRAYS, { width_mm: 120, brand: "Generic" });
    expect(res.status).toBe("ok");
    expect(res.finals.total).toBe(150);
  });
});

describe("read-time column projection: absence and precedence, client side", () => {
  it("an item with no projected brand key is simply not matched by a brand-keyed ref", () => {
    // Mirrors the backend rule pinned by test_bp_05: a blank column contributes NO key, so such a
    // row must be invisible to a brand-keyed match rather than matching a blank.
    const noBrand: RateMasterItem[] = [
      { discipline: "Electrical", kind: "lms_item", unit: "Nos.",
        attributes: { description: AV }, rates: { rate: 1 } } as RateMasterItem,
    ];
    const res = runPipeline("p", REF_PIPELINE, noBrand, { description: AV, brand: "Lutron" });
    expect(res.status).toBe("no_match");
  });

  it("NEGATIVE: an item WITHOUT a brand still prices through a ref that does not mention brand", () => {
    // The whole-catalogue guarantee: the projection adds a key to every item, so this proves it
    // cannot break the ~1,343 rows whose pipelines never mention brand.
    const plain: Pipeline = {
      output: ["total"],
      steps: [
        { step: "component_ref", name: "device",
          ref: { kind: "lms_item", description: "@description" },
          target: "rate", rate_stages: [{ mult: 1.0 }], qty: 1.0 },
        { step: "sum_components", result: "total" },
      ],
    } as unknown as Pipeline;
    const one: RateMasterItem[] = [projectedLms("Solo widget", "Lutron", 42)];
    const res = runPipeline("p", plain, one, { description: "Solo widget" });
    expect(res.status).toBe("ok");
    expect(res.finals.total).toBe(42);
  });
});
