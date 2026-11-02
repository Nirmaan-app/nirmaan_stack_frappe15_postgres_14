// RM-4a: pure helpers for the admin-only rate-master editors (the Data editor; the Derivation param edit is gone, ADP-5a).
// No React, no I/O -- unit-tested. Callers HIDE (never disable) the edit affordances when isNirmaanAdmin
// (constants/roles) is false. RM-ACCESS-1 (owner 2026-10-20): the PAGE itself is admin-only now, so there is
// no read-only surface any more.

// ADP-5a (owner D9, 2026-10-21; ADP-R5 Q9): `matchedConditionIndex` and `isEditableParam` -- the Derivation inline
// param edit's helpers -- are removed with the endpoint they addressed (`update_rate_config_param`); ADP-4b took away
// their only product caller.

/** Parse a user-typed param/rate value to a finite number, or null when it is not one (the input
 * stays open on null). Mirrors the server's _finite_number so the client rejects the same values. */
export function parseFiniteInput(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
