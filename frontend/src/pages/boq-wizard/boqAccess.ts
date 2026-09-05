/**
 * boqAccess.ts -- WHO SEES WHAT on the BoQ surfaces, as pure predicates.
 *
 * One home for these rules (ADR-0010 F1) rather than a role-string literal at each render site:
 * they are two DIFFERENT populations that read almost identically, and a scattered copy of
 * either is the kind of thing that gets half-updated. The role strings are the canonical
 * `role_profile` values in `utils/roleColors.ts`.
 *
 * ⚠️ THESE ARE UI GATES ONLY. The wizard endpoints and the pricing API are the real enforcement
 * layer; hiding a button or a column is a convenience, never a permission. A determined reader
 * can still call the endpoint, so do not use these to protect anything that actually matters --
 * gate it server-side as well.
 *
 * `role` arrives as the literal "Loading" / "Error" from useUserData in those states. Both fall
 * through to false with NO special case, which is the behaviour we want: withhold until the role
 * is KNOWN, because appearing late is a smaller lie than appearing and then being taken away.
 *
 * `Administrator` is checked by USER ID rather than being listed as a profile. useUserData
 * already resolves that user to the Admin profile today, but the explicit check means these stay
 * right if that ever stops being true.
 */

/** Admins + estimation -- the SAME population `PricingRoute` admits. */
const BOQ_WIZARD_PROFILES: ReadonlySet<string> = new Set([
  "Nirmaan Admin Profile",
  "Nirmaan Estimates Executive Profile",
]);

/** Admins + estimation + billing -- the wizard set plus the people who bill against a sheet. */
const BOQ_COMMERCIALS_PROFILES: ReadonlySet<string> = new Set([
  ...BOQ_WIZARD_PROFILES,
  "Nirmaan Billing Executive Profile",
]);

/**
 * May reach the BoQ WIZARD from the project's BoQ list -- the Action column and its pencil.
 *
 * The ROW CLICK is deliberately NOT gated by this: it opens the read-only viewer, which writes
 * nothing. What the viewer SHOWS is narrowed by `canSeeBoqCommercials` instead.
 */
export function canOpenBoqWizard(role: string | undefined, userId: string | undefined): boolean {
  if (userId === "Administrator") return true;
  return !!role && BOQ_WIZARD_PROFILES.has(role);
}

/**
 * May see a committed sheet's COMMERCIAL columns: every Rate column, every Amount column, and
 * the whole BCS cost block.
 *
 * ⚠️ WHY THESE THREE TRAVEL TOGETHER. Amount is Rate x Quantity, so a visible Amount column
 * beside a visible Quantity column DISCLOSES THE RATE by division -- hiding one without the
 * other reveals what it was meant to conceal. BCS is the internal cost, which is strictly more
 * sensitive than either. So this is ONE predicate, never three: splitting it would let a future
 * change grant Amount alone and quietly leak Rate.
 *
 * Billing is in this set and NOT in the wizard set: billing reads a priced sheet, it does not
 * author one.
 */
export function canSeeBoqCommercials(
  role: string | undefined,
  userId: string | undefined,
): boolean {
  if (userId === "Administrator") return true;
  return !!role && BOQ_COMMERCIALS_PROFILES.has(role);
}
