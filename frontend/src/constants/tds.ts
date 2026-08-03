/**
 * Phase 2 SHIPPED — project TDS assembly + approval are LIVE against the group model.
 *
 * The TDS Repository is a 3-level grouping model: Items SKU → "TDS Items"
 * (grouping doctype) → "TDS Repository" entry keyed by (tds_item, make). Phase 2
 * reworked the project-side consumption + approval to this shape:
 *   - the picker selects a TDS Item (group) + Make (`api/tds/picker`),
 *   - approval/promotion is an Admin-only backend op (`api/tds/approve`) that
 *     writes the new (tds_item, make) entry shape, never the removed flat columns.
 *
 * This flag is retained as a kill-switch only. `false` = live (current). Setting it
 * back to `true` no longer gates any screen (all freeze banners/early-returns were
 * removed in Phase 2); it is kept for one release as documentation of the rollout
 * and may be deleted once Phase 2 is confirmed stable on live bench.
 */
export const TDS_ASSEMBLY_FROZEN = false;
