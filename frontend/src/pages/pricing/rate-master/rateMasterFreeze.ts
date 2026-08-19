// Slice RMF-1: pure helpers for the rate-master DEPLOYMENT FREEZE. No React, no I/O -- unit-tested.
//
// WHY THE FEATURE EXISTS: on 2026-08-18, 235 hand-entered production cable prices were overwritten
// by a dev-minted asset because they existed in no committed asset. The remedy is Deployment Mode --
// freeze production, export, merge dev's config with production's items, deploy. This is the freeze.
//
// ⚠️ THE FREEZE BLOCKS WRITES ONLY. The two DOWNLOAD buttons (editable CSV + asset backup) and the
// upload PREVIEW keep working while frozen, because the export is the action the freeze exists to
// protect (owner ruling R3). Nothing here may be wired to a download control.
//
// ⚠️ BoQ PRICING IS UNAFFECTED (owner ruling R2) and this module is deliberately not importable
// from the pricing screen's concern: no pricing path writes the rate master.

import { formatDistanceToNow } from "date-fns";
import { isRateMasterAdmin } from "./rateMasterEdit";

/** The freeze state as `get_rate_master_freeze` returns it. */
export type RateMasterFreezeState = {
  frozen: boolean;
  frozen_by: string | null;
  frozen_at: string | null;
};

/**
 * ⚠️ OWNER'S TEXT, VERBATIM (2026-08-18). APPROVED. Not to be reworded, expanded, or given a
 * second sentence -- including the spacing inside "Nitesh/ Abhishek", which is the owner's own.
 *
 * It duplicates `services/boq_rate_master/freeze.py` BLOCKED_MESSAGE across the language boundary,
 * which is the same deliberate cross-language duplication as `PricingGrid.isRowQtyBearing` vs the
 * server's `persist.node_is_qty_bearing`. A backend test pins the two strings byte-for-byte so they
 * cannot drift.
 */
export const FREEZE_BLOCKED_MESSAGE =
  "Rate master is locked for deployment. Contact Nitesh/ Abhishek.";

/**
 * ⚠️⚠️ PROPOSED WORDING -- AWAITING OWNER APPROVAL (working agreement #57).
 * The owner approved exactly ONE user-visible string for this feature: FREEZE_BLOCKED_MESSAGE
 * above. Every string in this object is a DRAFT written to make the approved UI buildable and
 * certifiable, and each is reported to the owner as a proposal. Change freely on their ruling --
 * they are isolated here, in one object, for exactly that reason, and nothing else in the feature
 * hardcodes a label.
 */
export const FREEZE_COPY = {
  /** The control that sets the freeze (admin-only). */
  freezeButton: "Freeze for deployment",
  /** The control that lifts it (admin-only). Any admin may lift any admin's freeze (R6). */
  unfreezeButton: "Lift freeze",
  /** Shown while the request is in flight. */
  busy: "Working...",
  /** The banner heading. */
  bannerTitle: "Rate master frozen for deployment",
} as const;

/**
 * May this user set or lift the freeze? DELEGATES to `isRateMasterAdmin` -- owner ruling R5 is that
 * the freeze population IS the rate-master edit population (Administrator or role_profile
 * "Nirmaan Admin Profile"), so this must never become a second predicate that could drift.
 * The server re-gates on `_require_rate_admin` and is authoritative.
 */
export function canManageRateMasterFreeze(role: string, userId: string): boolean {
  return isRateMasterAdmin(role, userId);
}

/**
 * "3 days ago" for the banner's ELAPSED time (owner requirement B4). Returns null when there is no
 * timestamp or it cannot be parsed -- the caller then omits the phrase rather than rendering
 * "Invalid Date", because a freeze whose age we cannot state is still a freeze and the banner must
 * not be suppressed by a bad timestamp.
 *
 * Frappe hands back a naive "YYYY-MM-DD HH:MM:SS[.ffffff]" string in SITE-LOCAL time. `new Date()`
 * on that is parsed as LOCAL by every browser (it is not ISO-8601 with a zone), which is the
 * behaviour we want here: the site and its users share a timezone, and the existing
 * `formatDistanceToNow` call sites (`draft-resume-dialog`, `useProjectDraftManager`) do exactly
 * this with Frappe timestamps. The "T" swap is what stops Safari rejecting the space.
 */
export function frozenSinceText(frozenAt: string | null | undefined): string | null {
  if (!frozenAt) return null;
  const parsed = new Date(String(frozenAt).trim().replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return null;
  return formatDistanceToNow(parsed, { addSuffix: true });
}

/**
 * The banner's detail line: since when, and who turned it on (owner requirement B4). Each half is
 * omitted independently when unknown -- a freeze with no provenance still renders, because the
 * fact that writes are blocked is the load-bearing part and the attribution is the supporting part.
 * Returns null only when BOTH are unknown, in which case the caller shows the title alone.
 */
export function freezeBannerDetail(state: RateMasterFreezeState): string | null {
  const since = frozenSinceText(state.frozen_at);
  const who = (state.frozen_by || "").trim();
  if (since && who) return `Frozen ${since} by ${who}.`;
  if (since) return `Frozen ${since}.`;
  if (who) return `Frozen by ${who}.`;
  return null;
}

/**
 * Is a rate-master WRITE control blocked right now? ONE predicate for every disabled control on the
 * screen (the row editor, Add row, and the CSV upload), so they cannot disagree about the same
 * state -- the `isMasterSetBlank` four-surfaces-one-predicate discipline.
 *
 * ⚠️ NEVER call this for a download or the upload PREVIEW (R3).
 */
export function isRateMasterWriteBlocked(state: RateMasterFreezeState | null | undefined): boolean {
  return !!state?.frozen;
}

/** The freeze state a missing/failed read degrades to: NOT frozen, so the screen behaves exactly as
 *  it did before this slice. Mirrors the server's fail-open read for the same reason. */
export const UNFROZEN: RateMasterFreezeState = { frozen: false, frozen_by: null, frozen_at: null };
