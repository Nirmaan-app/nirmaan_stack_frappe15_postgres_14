/**
 * SLICE 12b(B), owner ruling 2026-09-29 — THE PANEL MUST FOLLOW THE PIPELINE.
 *
 * The panel used to price a SKU as `stored rate x the multiplier the input contributes`. Measured end
 * to end against a live BoQ row, that agreed to the rupee for a PAIR input and was WRONG twice:
 *
 *   * an INSTALLATION SHARE read 13 -> 32.5 where the product quoted 10 -> 30 — it applied the share to
 *     a stored install column instead of the COMPUTED SUPPLY rate, and skipped the round-up to tens;
 *   * a FLAT ADDER read +44 where the product quoted +64 — it added the addend AFTER the multiplier,
 *     where the pipeline adds it into the sum the markup then multiplies.
 *
 * These tests pin the two rules the owner named. They are written against a pipeline shaped exactly
 * like the shipped ones, so they fail if the order of operations or the rounding is ever lost — and
 * they assert the FIGURES, not the implementation, so the production path may be refactored freely.
 */
import { describe, it, expect } from "vitest";
import { priceSkuExact, itemsWithInput, skuSelection, legClassOf, conditionsFor,
         neutralConditions } from "./pricingInputExact";
import type { RateMasterItem } from "./rateMasterTypes";

const PI = (item: string, rates: Record<string, number>): RateMasterItem => ({
  name: `pi-${item}`, item_uid: `pi-${item}`, kind: "x_pricing_input",
  attributes: { item }, rates,
} as unknown as RateMasterItem);

/** a conduit SKU: the pipeline computes supply from it, then the install SHARE off that supply */
const CONDUIT = {
  name: "c1", item_uid: "u-conduit", kind: "conduit",
  attributes: { conduit_type: "MS", size_mm: 20 },
  rates: { list_price_per_mtr: 65 },
} as unknown as RateMasterItem;

/** a tray SKU: components sum (base + adder), and only THEN the supply markup */
const TRAY = {
  name: "t1", item_uid: "u-tray", kind: "cable_tray",
  attributes: { tray_type: "Ladder", material: "GI", width_mm: 150 },
  rates: { without_cover_list: 200 },
} as unknown as RateMasterItem;

// ── the conduit pipeline, shaped like the shipped `conduit_boq` ────────────────────────────────────
const CONDUIT_PIPE: any = {
  output: ["supply_per_mtr", "install_per_mtr"],
  steps: [
    { step: "match_master_row", params: { kind: "conduit" } },
    { step: "scale", target: "list_price_per_mtr", result: "supply_per_mtr",
      params: { boq_multiplier_from_ctx: "pi_boq" }, formula: "base*boq_multiplier" },
    { step: "scale", target: "supply_per_mtr", result: "install_per_mtr",
      params: { install_ratio_from_ctx: "pi_share" }, formula: "base*install_ratio" },
    { step: "roundup", target: "install_per_mtr", params: { digits: -1 } },
    { step: "rate_ref", ref: { kind: "x_pricing_input", item: "cond" }, target: "boq_multiplier", result: "pi_boq" },
    { step: "rate_ref", ref: { kind: "x_pricing_input", item: "share" }, target: "share", result: "pi_share" },
  ],
};

// ── the tray pipeline, shaped like the shipped `tray_boq_supply` ───────────────────────────────────
const TRAY_PIPE: any = {
  output: ["supply_per_rmt"],
  steps: [
    { step: "match_master_row", params: { kind: "cable_tray" } },
    { step: "component", name: "base", target: "without_cover_list", params: {}, formula: "base" },
    { step: "component", name: "accessories", formula: "acc",
      conditions: [{ when: { installation_type: "Ceiling" }, params: { acc_from_ctx: "pi_acc" } },
                   { when: { installation_type: "Floor" }, params: { acc: 0.0 } }] },
    { step: "sum_components", result: "supply_per_rmt" },
    { step: "scale", target: "supply_per_rmt", result: "supply_per_rmt",
      params: { markup_from_ctx: "pi_markup" }, formula: "base*(1+markup)" },
    { step: "rate_ref", ref: { kind: "x_pricing_input", item: "acc" }, target: "amount", result: "pi_acc" },
    { step: "rate_ref", ref: { kind: "x_pricing_input", item: "trmk" }, target: "supply_markup", result: "pi_markup" },
  ],
};

const refs = (id: string, pipeline: any) => [{ category: "c", pipelineId: id, pipeline }];
const leg = (r: ReturnType<typeof priceSkuExact>, out: string) => r.legs.find((l) => l.output === out);

describe("the INSTALLATION SHARE follows the pipeline: the SUPPLY base, and the round-up to tens", () => {
  const items = [CONDUIT, PI("cond", { boq_multiplier: 0.7 }), PI("share", { share: 0.20 })];

  it("prices the share off the COMPUTED SUPPLY, not off a stored install column", () => {
    const next = itemsWithInput(items, "share", { share: 0.50 });
    const r = priceSkuExact(CONDUIT, refs("conduit_boq", CONDUIT_PIPE), items, next, {});
    // supply = 65 x 0.7 = 45.5  ->  install = 0.20 x 45.5 = 9.1, rounded UP to tens = 10
    expect(leg(r, "supply_per_mtr")!.now).toBeCloseTo(45.5, 9);
    expect(leg(r, "install_per_mtr")!.now).toBe(10);
    // after: 0.50 x 45.5 = 22.75, rounded UP to tens = 30
    expect(leg(r, "install_per_mtr")!.becomes).toBe(30);
  });

  it("⚠️ NOT the old arithmetic: a stored install base x the share would have read 13 -> 32.5", () => {
    const next = itemsWithInput(items, "share", { share: 0.50 });
    const r = priceSkuExact(CONDUIT, refs("conduit_boq", CONDUIT_PIPE), items, next, {});
    expect(leg(r, "install_per_mtr")!.now).not.toBe(13);
    expect(leg(r, "install_per_mtr")!.becomes).not.toBe(32.5);
  });

  it("the ROUND-UP is not optional: a share that lands mid-decade still rounds up", () => {
    const next = itemsWithInput(items, "share", { share: 0.21 });   // 0.21 x 45.5 = 9.555
    const r = priceSkuExact(CONDUIT, refs("conduit_boq", CONDUIT_PIPE), items, next, {});
    expect(leg(r, "install_per_mtr")!.becomes).toBe(10);            // not 9.555
  });
});

describe("the FLAT ADDER follows the pipeline: the addend lands BEFORE the markup", () => {
  const items = [TRAY, PI("acc", { amount: 100 }), PI("trmk", { supply_markup: 0.45 })];
  const conds = { installation_type: "Ceiling" };

  it("the addend is inside the sum the markup multiplies", () => {
    const next = itemsWithInput(items, "acc", { amount: 200 });
    const r = priceSkuExact(TRAY, refs("tray_boq_supply", TRAY_PIPE), items, next, conds);
    // (200 + 100) x 1.45 = 435   ->   (200 + 200) x 1.45 = 580
    expect(leg(r, "supply_per_rmt")!.now).toBeCloseTo(435, 6);
    expect(leg(r, "supply_per_rmt")!.becomes).toBeCloseTo(580, 6);
  });

  it("⚠️ NOT added afterwards: that would have moved it by the bare 100, to 535", () => {
    const next = itemsWithInput(items, "acc", { amount: 200 });
    const r = priceSkuExact(TRAY, refs("tray_boq_supply", TRAY_PIPE), items, next, conds);
    const d = leg(r, "supply_per_rmt")!.becomes - leg(r, "supply_per_rmt")!.now;
    expect(d).toBeCloseTo(145, 6);        // 100 x 1.45, the markup applied to the addend
    expect(d).not.toBeCloseTo(100, 6);    // the old, wrong, order
  });

  it("the adder's CONDITION decides whether it lands at all", () => {
    const next = itemsWithInput(items, "acc", { amount: 200 });
    const r = priceSkuExact(TRAY, refs("tray_boq_supply", TRAY_PIPE), items, next, { installation_type: "Floor" });
    expect(leg(r, "supply_per_rmt")!.moved).toBe(false);   // a floor run carries no accessories
  });
});

describe("every output that moves is reported, not only the input's own leg", () => {
  it("a change to the SUPPLY multiplier reports the INSTALL leg moving too", () => {
    const items = [CONDUIT, PI("cond", { boq_multiplier: 0.7 }), PI("share", { share: 0.20 })];
    const next = itemsWithInput(items, "cond", { boq_multiplier: 0.84 });
    const r = priceSkuExact(CONDUIT, refs("conduit_boq", CONDUIT_PIPE), items, next, {});
    // supply 45.5 -> 54.6, and install follows it because install is a share OF supply
    expect(leg(r, "supply_per_mtr")!.becomes).toBeCloseTo(54.6, 9);
    expect(leg(r, "install_per_mtr")!.now).toBe(10);
    expect(leg(r, "install_per_mtr")!.becomes).toBe(20);
    expect(leg(r, "install_per_mtr")!.moved).toBe(true);
  });
});

describe("the small pieces", () => {
  it("skuSelection takes the SKU's own attributes and lets conditions override", () => {
    const sel = skuSelection(TRAY, { installation_type: "Ceiling", material: "SS" });
    expect(sel.tray_type).toBe("Ladder");
    expect(sel.width_mm).toBe(150);
    expect(sel.installation_type).toBe("Ceiling");
    expect(sel.material).toBe("SS");            // a condition wins over the SKU's own value
  });

  it("itemsWithInput patches ONLY the named pricing input, and leaves the catalogue alone", () => {
    const items = [CONDUIT, PI("cond", { boq_multiplier: 0.7 }), PI("share", { share: 0.20 })];
    const out = itemsWithInput(items, "share", { share: 0.5 });
    expect(out.find((i) => i.item_uid === "pi-share")!.rates.share).toBe(0.5);
    expect(out.find((i) => i.item_uid === "pi-cond")!.rates.boq_multiplier).toBe(0.7);
    expect(out.find((i) => i.item_uid === "u-conduit")).toBe(CONDUIT);   // untouched, same reference
    expect(items.find((i) => i.item_uid === "pi-share")!.rates.share).toBe(0.20);  // no mutation
  });

  it("legClassOf reads the output name, and bcs wins over install", () => {
    expect(legClassOf("supply_per_mtr")).toBe("supply");
    expect(legClassOf("install_per_rmt")).toBe("install");
    expect(legClassOf("bcs_supply")).toBe("bcs");
    expect(legClassOf("bcs_install")).toBe("bcs");
  });

  it("conditionsFor picks the branch that BINDS the input, not the one that zeroes it", () => {
    const reach: any = { adder: { formula: "acc", component: "accessories", category: "c", branches: [
      { when: { installation_type: "Ceiling" }, ctxBinds: { acc: "pi_acc" }, literals: {} },
      { when: { installation_type: "Floor" }, ctxBinds: {}, literals: { acc: 0 } },
    ] } };
    expect(conditionsFor(reach)).toEqual({ installation_type: "Ceiling" });
  });

  it("no adder means no assumed conditions", () => {
    expect(conditionsFor({ adder: undefined } as never)).toEqual({});
  });
});

describe("neutralConditions - the other options are held OFF, and the input's own is not", () => {
  const refs = [{ category: "c", pipelineId: "tray_boq_supply", pipeline: TRAY_PIPE as never }];

  it("takes the branch whose params are all literals -- the 'not taken' branch", () => {
    // TRAY_PIPE's accessories component is the only conditional one; without an ownComponent it is
    // held at its neutral branch, which is Floor
    expect(neutralConditions(refs)).toEqual({ installation_type: "Floor" });
  });

  it("⚠️ the input's OWN component is skipped, so its enabling branch still decides", () => {
    expect(neutralConditions(refs, "accessories")).toEqual({});
  });

  it("without them a multi-option pipeline never resolves, so the exact path would silently fall back", () => {
    const items = [TRAY, PI("acc", { amount: 100 }), PI("trmk", { supply_markup: 0.45 })];
    const next = itemsWithInput(items, "acc", { amount: 200 });
    // the enabling branch alone IS enough here because TRAY_PIPE has one conditional component;
    // the guard that matters is that neutral + own compose in the right order
    const conds = { ...neutralConditions(refs, "accessories"), ...conditionsFor({ adder: {
      formula: "acc", component: "accessories", category: "c", branches: [
        { when: { installation_type: "Ceiling" }, ctxBinds: { acc: "pi_acc" }, literals: {} },
        { when: { installation_type: "Floor" }, ctxBinds: {}, literals: { acc: 0 } }] } } as never) };
    expect(conds).toEqual({ installation_type: "Ceiling" });
    const r = priceSkuExact(TRAY, refs, items, next, conds);
    expect(r.ok).toBe(true);
    expect(r.legs[0].becomes).toBeCloseTo(580, 6);
  });
});

describe("⚠️ the neutral branch is 'all literals are ZERO', not 'all params are literals'", () => {
  /** the shipped cable-tray `cover` shape: a zero factor BESIDE a ctx bind */
  const PIPE_WITH_COVER: any = { output: ["supply"], steps: [
    { step: "match_master_row", params: { kind: "cable_tray" } },
    { step: "component", name: "base", target: "without_cover_list", params: {}, formula: "base" },
    { step: "component", name: "cover", target: "without_cover_list", formula: "base*factor",
      conditions: [{ when: { cover: "Yes" }, params: { factor: 1.0, discount_from_ctx: "pi_d" } },
                   { when: { cover: "No" },  params: { factor: 0.0, discount_from_ctx: "pi_d" } }] },
    { step: "sum_components", result: "supply" },
  ] };
  it("picks the zero-literal branch even when a ctx bind sits beside it", () => {
    const got = neutralConditions([{ category: "c", pipelineId: "p", pipeline: PIPE_WITH_COVER as never }]);
    expect(got).toEqual({ cover: "No" });
  });
  it("a branch with NO literal is the enabling one and is never chosen as neutral", () => {
    const PIPE: any = { output: ["s"], steps: [
      { step: "component", name: "x", formula: "v", conditions: [
        { when: { opt: "On" }, params: { v_from_ctx: "pi_v" } },
        { when: { opt: "Off" }, params: { v: 0 } }] }] };
    expect(neutralConditions([{ category: "c", pipelineId: "p", pipeline: PIPE as never }])).toEqual({ opt: "Off" });
  });
});
