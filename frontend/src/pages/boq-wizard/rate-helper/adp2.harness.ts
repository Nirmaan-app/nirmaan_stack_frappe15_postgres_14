/**
 * ADP-2 (owner rulings H5 / H7 / B3, 2026-10-19 / 2026-10-20) -- THE CONFIG CHANGES OF HVAC v48, as an in-memory edit of
 * v47. NOT product code: the tests of the code commit run the new rules on it before v48 exists, and the asset commit
 * pins it EQUAL to the minted v48, so the two can never drift. The mint is `scripts/_instruments/mint_hvac_v48_adp2.py`;
 * the asset is the authority. No catalogue item changes in ADP-2.
 */
import type { AssetLike } from "./adp1.harness";

/** H5 (2026-10-19 14:41 (2)): every ADP family with a with / without damper choice -- all grilles and diffusers. */
export const ADP2_DAMPER_FAMILIES = ["curved grille", "floor grille", "linear grille", "round diffuser", "slot diffuser", "square diffuser"] as const;

/** H5: the air stream decides a damper that was not mentioned -- supply -> with; return, exhaust, fresh -> without.
 * An explicit damper (with or without) always wins: `derive_when_none` fires only over "None" or an absent answer. */
export const ADP2_H5_RULES = (["supply", "return", "exhaust", "fresh"] as const).map((air) => ({
  attr: "damper",
  families: [...ADP2_DAMPER_FAMILIES],
  when: { attr: "air", equals: air },
  then: air === "supply" ? "with" : "without",
  rule: `${air} air, damper not mentioned -> ${air === "supply" ? "with" : "without"} damper`,
}));

/** H7: the four typed boxes of a per-number plenum -- Area (filled from the model's area band, its largest value) and
 * Length / Width / Height (filled from the size as written, L x W x H, height last, a written label winning). */
export const ADP2_PLENUM_NUMBERS = {
  plenum_area_sqm: { from: ["plenum_area_sqm"], name: "area", unit: "sqm", range: "max", typed_only: true, length_from: "area_band", label: "Area (sq.m)" },
  plenum_length_mm: { from: ["plenum_length_mm"], name: "length", unit: "mm", typed_only: true, length_from: "size_mm", box_side: "length", label: "Length (mm)" },
  plenum_width_mm: { from: ["plenum_width_mm"], name: "width", unit: "mm", typed_only: true, length_from: "size_mm", box_side: "width", label: "Width (mm)" },
  plenum_height_mm: { from: ["plenum_height_mm"], name: "height", unit: "mm", typed_only: true, length_from: "size_mm", box_side: "height", label: "Height (mm)" },
} as const;

const match = { step: "match_master_row", params: { kind: "hvac_adp_item" }, explain: "match the ADP SKU (family, unit class and the stated attributes)" };
const markup = (leg: "supply" | "install") => [
  { step: "scale", target: `cost_${leg}`, result: leg, params: { m_from_ctx: `${leg}_markup` }, formula: "base*(1+m)", explain: `${leg}: cost x (1 + the SKU's ${leg} markup) (R15)` },
  { step: "roundup", target: leg, params: { digits: 0 }, explain: `ROUNDUP(${leg}, 0) (R15)` },
];

/** H7 (a): an area stated -> the area x the per-sq.m rate, supply and install, NO adder (23:18: "we just use the rate
 * from it"). The R16 area-band shape, read from the plenum's own Area box. */
export const ADP2_PLENUM_AREA_OPTION = {
  to: "area",
  needs: ["plenum_area_sqm"],
  rule: "H7 per-number mixing box / LP plenum with an area: the area x the per-sq.m rate, supply and install (no adder)",
  show_numbers: true,
  name_missing: true,
  pipelines: Object.fromEntries((["supply", "install"] as const).map((leg) => [leg, {
    output: [leg],
    steps: [match,
      { step: "scale", target: `cost_${leg}`, result: `cost_${leg}`, params: { a_from_attr: "plenum_area_sqm" }, formula: "base*a", explain: `per-sq.m ${leg} cost x the area (H7)` },
      ...markup(leg)],
  }])),
};

export type Adp2Part = "h5" | "h7" | "b3";
export const ADP2_ALL: readonly Adp2Part[] = ["h5", "h7", "b3"];

/** Apply the ADP-2 changes (all of them, or the parts named) to a v47-shaped asset; returns a NEW object. */
export function applyAdp2<T extends AssetLike>(v47: T, parts: readonly Adp2Part[] = ADP2_ALL): T {
  const on = new Set(parts);
  const a: T = structuredClone(v47);
  const pr = (a.category_configs.find((c) => c.category_id === "hvac_adp") as any).list_spec.pricing;
  // ── H5: R13 (linear grille, supply -> with) widens to every damper family, and the other three streams say "without" ──
  if (on.has("h5")) pr.derive_when_none = ADP2_H5_RULES.map((r) => structuredClone(r));
  // ── H7: four separate boxes; area first, else length + width + height (ADP-1's formula, unchanged), else refuse ──
  if (on.has("h7")) {
    pr.numbers = { ...pr.numbers, ...structuredClone(ADP2_PLENUM_NUMBERS) };
    pr.match_attrs = [...pr.match_attrs, ...Object.keys(ADP2_PLENUM_NUMBERS)];
    pr.panel_controls = { ...pr.panel_controls, ...Object.fromEntries(Object.keys(ADP2_PLENUM_NUMBERS).map((k) => [k, "text"])) };
    const mb = pr.families["mixing box / LP plenum"].convert.count[0];
    mb.needs = ["plenum_length_mm", "plenum_width_mm", "plenum_height_mm"];
    for (const leg of ["supply", "install"] as const) {
      const sc = mb.pipelines[leg].steps.find((s: any) => s.step === "scale" && s.params?.w_from_attr);
      sc.params = { ...sc.params, w_from_attr: "plenum_length_mm", h_from_attr: "plenum_width_mm", d_from_attr: "plenum_height_mm" };
    }
    pr.families["mixing box / LP plenum"].convert.count = [structuredClone(ADP2_PLENUM_AREA_OPTION), mb];
  }
  // ── B3: the neck dropdown offers "Other..." -- a typed unstocked neck ladders up, above the largest refuses ──
  if (on.has("b3")) pr.panel_controls = { ...pr.panel_controls, neck_mm: "dropdown_or_other" };
  return a;
}
