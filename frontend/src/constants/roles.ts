/**
 * Role-profile constants — the ONE owning module for "which role profiles count as X".
 *
 * ADR-0010 F1: a domain rule has one home. Before this file the procurement role
 * profile was written inline at ~90 call sites, which is why adding
 * `Nirmaan Procurement Lead Profile` (a real Role Profile with a real user, but a
 * string the frontend had never heard of) meant an empty sidebar and an empty
 * dashboard for that user.
 *
 * Mirrored server-side by `nirmaan_stack/services/role_profiles.py`. Keep the two
 * in sync — the backend is the enforcement boundary, this layer is UX.
 */

export const PROCUREMENT_EXECUTIVE_PROFILE = "Nirmaan Procurement Executive Profile";
export const PROCUREMENT_LEAD_PROFILE = "Nirmaan Procurement Lead Profile";
export const MATERIAL_PROCUREMENT_EXECUTIVE_PROFILE =
  "Nirmaan Material Procurement Executive Profile";
export const SERVICE_PROCUREMENT_EXECUTIVE_PROFILE =
  "Nirmaan Service Procurement Executive Profile";

/**
 * Procurement splits by WHAT IS BOUGHT, and the split is a VIEW split, not an
 * access boundary (owner ruling): a narrowed profile stops seeing the other
 * side's nav items, but its routes stay reachable and the server still answers.
 * Do not read these sets as security.
 *
 * Material = the PR -> PO chain and everything downstream of a material buy
 * (products, inventory, warehouse, transfers, delivery).
 * Service  = Work Orders, i.e. Service Requests, and the WO rate card.
 *
 * The two legacy profiles sit in BOTH sets on purpose:
 *   - Procurement Executive predates the split and keeps seeing everything, so
 *     the four existing users are untouched until they are migrated by hand.
 *   - Procurement Lead leads both sides.
 */
export const MATERIAL_PROCUREMENT_PROFILES: readonly string[] = [
  PROCUREMENT_EXECUTIVE_PROFILE,
  PROCUREMENT_LEAD_PROFILE,
  MATERIAL_PROCUREMENT_EXECUTIVE_PROFILE,
];

export const SERVICE_PROCUREMENT_PROFILES: readonly string[] = [
  PROCUREMENT_EXECUTIVE_PROFILE,
  PROCUREMENT_LEAD_PROFILE,
  SERVICE_PROCUREMENT_EXECUTIVE_PROFILE,
];

/**
 * Every profile carrying procurement access — the UNION, and the DEFAULT.
 *
 * This name and meaning are deliberately unchanged by the material/service
 * split: a shared surface (Projects, Vendors, Payments, Reports, BoQ upload)
 * belongs to every procurement person, and those call sites should keep reading
 * this set. Only material-only and service-only surfaces get narrowed.
 *
 * The direction matters. Defaulting to the union means a site someone forgets
 * to narrow shows one stray nav item -- it can never lock a user out of their
 * own job. Defaulting to a narrow set would fail the other way round.
 */
export const PROCUREMENT_PROFILES: readonly string[] = [
  PROCUREMENT_EXECUTIVE_PROFILE,
  PROCUREMENT_LEAD_PROFILE,
  MATERIAL_PROCUREMENT_EXECUTIVE_PROFILE,
  SERVICE_PROCUREMENT_EXECUTIVE_PROFILE,
];

/** Any procurement profile. The default for a SHARED surface. */
export const isProcurementProfile = (role?: string | null): boolean =>
  !!role && PROCUREMENT_PROFILES.includes(role);

/** Sees the material side (PR/PO and downstream). */
export const isMaterialProcurementProfile = (role?: string | null): boolean =>
  !!role && MATERIAL_PROCUREMENT_PROFILES.includes(role);

/** Sees the service side (Work Orders / Service Requests). */
export const isServiceProcurementProfile = (role?: string | null): boolean =>
  !!role && SERVICE_PROCUREMENT_PROFILES.includes(role);
