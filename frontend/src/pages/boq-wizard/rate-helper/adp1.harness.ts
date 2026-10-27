/**
 * ADP-1 (owner rulings H3 / H4 / A4 / F1, 2026-10-19) -- THE CONFIG AND CATALOGUE CHANGES OF HVAC v47, as an in-memory
 * edit of v46. NOT product code: the tests of the code commit run the new rules on it before v47 exists, and the asset
 * commit pins it EQUAL to the minted v47 (configs, the three new Pricing Inputs, the two retired SKUs), so the two can
 * never drift. The mint itself is `scripts/_instruments/mint_hvac_v47_adp1.py`; the asset is the authority.
 */
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";

export interface AssetLike { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { item_uid?: string }>; category_configs: RateCategoryConfig[] }

/** H4: the two per-number plenum SKUs the owner removes from the catalogue (deactivated, never deleted). */
export const ADP1_RETIRED_UIDS = ["rmi-4184735331c3", "rmi-a23b43d34447"] as const;

/** A4: the three literals, now Pricing Inputs (ids, labels and values exactly as minted). */
export const ADP1_INPUTS = [
  { item: "mixing_box_supply_adder", name: "Mixing box supply adder", column: "amount", value: 150, unit: "Rs per number",
    remarks: "Added to a per-number mixing box / LP plenum's SUPPLY cost, before the round-up and the supply markup; never to install. Read by ADP's per-number mixing box rule." },
  { item: "crosstalk_assumed_depth_mm", name: "Cross-talk assumed depth", column: "factor", value: 300, unit: "mm",
    remarks: "The depth a per-number cross-talk is assumed to have: 2 x (W + H) x this / 10^6 sq.m of the per-sq.m rate. Read by ADP's per-number cross-talk rule." },
  { item: "flexible_duct_length_m", name: "Flexible duct length per piece", column: "factor", value: 2.5, unit: "m per piece",
    remarks: "The standard length of one piece of flexible duct: a per-number row is the per-metre rate x this. Read by ADP's per-number flexible duct rule." },
] as const;

const markup = (leg: "supply" | "install") => [
  { step: "scale", target: `cost_${leg}`, result: leg, params: { m_from_ctx: `${leg}_markup` }, formula: "base*(1+m)", explain: `${leg}: cost x (1 + the SKU's ${leg} markup) (R15)` },
  { step: "roundup", target: leg, params: { digits: 0 }, explain: `ROUNDUP(${leg}, 0) (R15)` },
];
const match = { step: "match_master_row", params: { kind: "hvac_adp_item" }, explain: "match the ADP SKU (family, unit class and the stated attributes)" };
const input = (id: string, column: string, result: string) => ({ step: "rate_ref", ref: { kind: "hvac_pricing_input", item: id }, target: column, result, explain: `pricing input: ${id} (${column})` });

/** H3 (a): per number = the per-metre SKU (slots + damper) x the piece length in metres. */
export const ADP1_SLOT_COUNT_OPTION = {
  to: "length",
  needs: ["slot_count", "piece_length_m"],
  rule: "H3 per-number slot diffuser: the per-metre rate (slots and damper) x the piece length in metres",
  show_numbers: true,
  name_missing: true,
  pipelines: Object.fromEntries((["supply", "install"] as const).map((leg) => [leg, {
    output: [leg],
    steps: [match,
      { step: "scale", target: `cost_${leg}`, result: `cost_${leg}`, params: { l_from_attr: "piece_length_m" }, formula: "base*l", explain: `per-metre ${leg} cost x the piece length in metres (H3)` },
      ...markup(leg)],
  }])),
};

/** The parts of the change, by the ruling that orders each (the replay applies them one at a time, AC3 / AC9). */
export type Adp1Part = "h3" | "h4" | "a4" | "f1" | "retire";
export const ADP1_ALL: readonly Adp1Part[] = ["h3", "h4", "a4", "f1", "retire"];

/** Apply the ADP-1 changes (all of them, or the parts named) to a v46-shaped asset; returns a NEW object. */
export function applyAdp1<T extends AssetLike>(v46: T, parts: readonly Adp1Part[] = ADP1_ALL): T {
  const on = new Set(parts);
  const a: T = structuredClone(v46);
  const adp = a.category_configs.find((c) => c.category_id === "hvac_adp") as any;
  const ins = a.category_configs.find((c) => c.category_id === "hvac_insulation") as any;
  const pr = adp.list_spec.pricing;
  // ── H3: the slot diffuser ──
  if (on.has("h3")) {
    pr.numbers.piece_length_m = { from: ["piece_length_m"], name: "piece length", unit: "m", typed_only: true, length_from: "size_mm", label: "Piece length (m)" };
    pr.numbers.slot_count = { ...pr.numbers.slot_count, not_stocked: "No SKU for a {value}-slot diffuser - price this row by hand" };
    pr.match_attrs = [...pr.match_attrs, "piece_length_m"];
    pr.panel_controls = { ...pr.panel_controls, piece_length_m: "text" };
    pr.number_defaults = { piece_length_m: { value: 1, families: ["slot diffuser"], rule: "no piece length stated - priced at 1 m (owner H3, 2026-10-19)" } };
    pr.refuse_on_unit_class = [{ unit_class: "area", families: ["slot diffuser"], attr: "damper", value_contains: "without",
      refuse: "No SKU for a slot diffuser per sq.m without damper - price this row by hand",
      rule: "H3 (b) per sq.m the slots do not matter and only the with-damper SKU is stocked (owner 2026-10-19)" }];
    pr.families["slot diffuser"].convert.count = [ADP1_SLOT_COUNT_OPTION];
  }
  // ── H4: the mixing box per number -- the rule's words, the numbers in the working, the missing dimension named ──
  const mb = pr.families["mixing box / LP plenum"].convert.count[0];
  if (on.has("h4")) {
    mb.rule = "H4 per-number mixing box / LP plenum: per-sq.m cost x 2 x (L x B + B x H + L x H) / 10^6 sq.m, + the mixing-box supply adder on supply only, rounded up, then the markup";
    mb.show_numbers = true;
    mb.name_missing = true;
  }
  // ── A4: the three literals become Pricing Inputs (the mixing box's 150, the cross-talk depth, the flexible duct) ──
  if (on.has("a4")) {
    const mbs = mb.pipelines.supply.steps;
    const mbScale = mbs.find((s: any) => s.step === "scale" && s.result === "cost_supply");
    mbScale.formula = "base*2*(w*h+h*d+w*d)/1000000+mba";
    mbScale.params = { ...mbScale.params, mba_from_ctx: "mba" };
    mbScale.explain = "per-sq.m supply cost x 2 x (W x H + H x D + W x D) / 10^6 sq.m + the mixing-box supply adder (S7, H4)";
    mb.pipelines.supply.steps = [input("mixing_box_supply_adder", "amount", "mba"), ...mbs];
    for (const leg of ["supply", "install"] as const) {
      const pl = pr.families["cross-talk"].units.count.pipelines[leg];
      const sc = pl.steps.find((s: any) => s.step === "scale" && s.params?.depth === 300);
      const { depth: _d, ...rest } = sc.params;
      sc.params = { ...rest, depth_from_ctx: "ctd" };
      sc.explain = `sheet formula: 2 x (W + H) x the cross-talk assumed depth / 10^6 sq.m x the base per-sq.m ${leg} cost (R20)`;
      pl.steps = [input("crosstalk_assumed_depth_mm", "factor", "ctd"), ...pl.steps];
    }
    const fd = pr.families["flexible duct"].convert.count[0];
    fd.rule = "per piece: per-metre rate x the flexible duct length per piece (R-M-c)";
    for (const pid of Object.keys(fd.pipelines)) {
      const pl = fd.pipelines[pid];
      const sc = pl.steps.find((s: any) => s.step === "scale" && s.params?.standard_length_m === 2.5);
      sc.params = { standard_length_m_from_ctx: "fdl" };
      sc.explain = sc.explain.replace("2.5 m standard length", "the flexible duct length per piece");
      pl.steps = [input("flexible_duct_length_m", "factor", "fdl"), ...pl.steps];
      if (typeof pl.note === "string") pl.note = pl.note.replace("The length is declared HERE, in config", "The length is a Pricing Input (ADP-1, owner A4)");
    }
  }
  // ── F1: Insulation's pipe size ──
  if (on.has("f1")) ins.list_spec.pricing.numbers.pipe_size_mm = { ...ins.list_spec.pricing.numbers.pipe_size_mm, bare_above_largest: "refuse" };
  // ── the catalogue: two SKUs retired (H4), three Pricing Inputs added (A4) ──
  if (on.has("retire")) a.items = a.items.filter((it) => !(ADP1_RETIRED_UIDS as readonly string[]).includes(String(it.item_uid)));
  if (on.has("a4")) for (const p of ADP1_INPUTS) {
    a.items.push({ kind: "hvac_pricing_input", brand: null, unit: p.unit,
      attributes: { item: p.item, name: p.name, remarks: p.remarks, shared_by: "adp" }, rates: { [p.column]: p.value } } as any);
  }
  return a;
}
