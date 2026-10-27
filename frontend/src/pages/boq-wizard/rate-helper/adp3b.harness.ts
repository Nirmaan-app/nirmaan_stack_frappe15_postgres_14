/**
 * ADP-3b (owner B1; D1-D4, 2026-10-20 22:25 "ok to all") -- THE CONFIG CHANGES OF HVAC v49, as an in-memory edit of
 * v48. NOT product code: the tests of the code commit run the new boxes on it before v49 exists, and the asset commit
 * pins it EQUAL to the minted v49, so the two can never drift. The mint is `scripts/_instruments/mint_hvac_v49_adp3b.py`;
 * the asset is the authority. No catalogue item changes; only hvac_adp's config.
 */
import type { AssetLike } from "./adp1.harness";

/** B1: the face's two sides as their OWN typed boxes, filled from the size as written (`face_side`). The ids stay the
 * SKU attributes, so every need, conversion, match and pipeline that reads them is unchanged. */
export const ADP3B_FACE_NUMBERS = {
  face_w_mm: { from: ["face_w_mm"], name: "width", unit: "mm", typed_only: true, length_from: "size_mm", face_side: "width", label: "Width (mm)" },
  face_h_mm: { from: ["face_h_mm"], name: "height", unit: "mm", typed_only: true, length_from: "size_mm", face_side: "height", label: "Height (mm)" },
} as const;

/** The one-line note each box carries (the combined box's "width x height" note, worded per box; D4 drops its depth clause). */
export const ADP3B_PANEL_NOTES = {
  face_w_mm: [{ text: "Type the width the BoQ states, in mm." }],
  face_h_mm: [{ text: "Type the height the BoQ states, in mm." }],
} as const;

/** Apply the ADP-3b config edits to a v48-shaped asset; returns a NEW object. */
export function applyAdp3b<T extends AssetLike>(v48: T): T {
  const a: T = structuredClone(v48);
  const pr = (a.category_configs.find((c) => c.category_id === "hvac_adp") as any).list_spec.pricing;
  // B1: the face boxes
  pr.numbers = { ...pr.numbers, ...structuredClone(ADP3B_FACE_NUMBERS) };
  // D4: the depth axis retired -- its reader, its match attribute, its control and its never-shown note
  delete pr.numbers.depth_mm;
  pr.match_attrs = pr.match_attrs.filter((x: string) => x !== "depth_mm");
  const { depth_mm: _d, ...controls } = pr.panel_controls;
  pr.panel_controls = controls;
  pr.panel_notes = { ...pr.panel_notes, ...structuredClone(ADP3B_PANEL_NOTES) };
  return a;
}
