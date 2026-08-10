/**
 * Role-profile constants — the ONE owning module for "which role profiles count as X".
 *
 * ADR-0010 F1: a domain rule has one home. Before this file the procurement role
 * profile was written inline at ~90 call sites, which is why adding
 * `Nirmaan Procurement Lead Profile` (a real Role Profile with a real user, but a
 * string the frontend had never heard of) meant an empty sidebar and an empty
 * dashboard for that user.
 *
 * Mirrored server-side by `nirmaan_stack/api/_role_profiles.py`. Keep the two in
 * sync — the backend is the enforcement boundary, this layer is UX.
 */

export const PROCUREMENT_EXECUTIVE_PROFILE = "Nirmaan Procurement Executive Profile";
export const PROCUREMENT_LEAD_PROFILE = "Nirmaan Procurement Lead Profile";

/**
 * Every role profile that carries procurement access.
 *
 * Procurement Lead is currently a strict superset of Procurement Executive at the
 * *role* level (its Role Profile holds both `Nirmaan Procurement Executive` and
 * `Nirmaan Procurement Lead`), so at the *profile* level the two are treated
 * identically. When Lead needs something Executive does not, give Lead its own
 * gate at that one site rather than splitting this constant.
 */
export const PROCUREMENT_PROFILES: readonly string[] = [
  PROCUREMENT_EXECUTIVE_PROFILE,
  PROCUREMENT_LEAD_PROFILE,
];

/** Drop-in replacement for `role === "Nirmaan Procurement Executive Profile"`. */
export const isProcurementProfile = (role?: string | null): boolean =>
  !!role && PROCUREMENT_PROFILES.includes(role);
