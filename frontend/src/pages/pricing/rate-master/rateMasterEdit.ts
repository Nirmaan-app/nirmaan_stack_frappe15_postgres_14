// RM-4a: pure helpers for the admin-only rate-master editors (Derivation param edit + Data editor).
// No React, no I/O -- unit-tested. Owner option (a): non-admins get a READ-ONLY surface; callers HIDE
// (never disable) the edit affordances when isRateMasterAdmin is false.

/**
 * May the current user edit the rate master? MIRRORS SheetPricingPage.canAdminOverride and the server
 * pricing._is_nirmaan_admin (Administrator OR role_profile "Nirmaan Admin Profile"). False while the
 * role is still "Loading" so an admin never flashes read-only controls, and false for "Error".
 * CONVENIENCE ONLY -- the four write endpoints re-gate server-side and are authoritative.
 */
export function isRateMasterAdmin(role: string, userId: string): boolean {
  if (role === "Loading") return false;
  return userId === "Administrator" || role === "Nirmaan Admin Profile";
}

/**
 * The index of the condition (in a config step's `conditions` array) that the interpreter matched for
 * the given matched-item attributes -- re-derived EXACTLY as ratePipelineInterpreter does (every
 * `when[k] === matchedItem.attributes[k]`), so an inline param edit addresses the same branch the
 * derivation used. Returns null for a plain step (no conditions) or when nothing matches. This does
 * NOT modify the interpreter -- it only reads the same config + matched item to address the edit path.
 */
export function matchedConditionIndex(
  step: { conditions?: { when: Record<string, string | number> }[] } | undefined,
  matchedAttrs: Record<string, string | number> | undefined | null,
): number | null {
  const conditions = step?.conditions;
  if (!conditions || conditions.length === 0) return null;
  const idx = conditions.findIndex((c) =>
    Object.entries(c.when).every(([k, v]) => matchedAttrs?.[k] === v),
  );
  return idx >= 0 ? idx : null;
}

/** A step-trace parameter is EDITABLE only when its value is a finite number -- string params (e.g.
 * `kind` on match_master_row) stay read-only, matching the server's numeric-only param rule. */
export function isEditableParam(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Parse a user-typed param/rate value to a finite number, or null when it is not one (the input
 * stays open on null). Mirrors the server's _finite_number so the client rejects the same values. */
export function parseFiniteInput(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
