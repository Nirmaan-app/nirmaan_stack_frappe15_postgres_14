/**
 * Revised-BoQ config-screen flags (S4 / #1101, ADR-0014 D5) -- PURE, no React (F4).
 *
 * The backend seeds a matched revision sheet's config with the ORIGINAL's rectified role map
 * (S4). When the revised workbook dropped a mapped column, that role now points at a column
 * that is not in the revised sheet -- a "dangling role" (D5: flag, never auto-clear). This is
 * the config-screen surfacing of the same fact the backend computes at seeding: it re-derives
 * it from the seeded role map vs the columns actually present in the sheet.
 *
 * REVISION-ONLY by design: a normal sheet's config is built by the user AGAINST the preview,
 * so it can never map an absent column; only a SEEDED (carried) config can. Scoping to
 * `isRevisionSheet` keeps the normal config flow byte-identical.
 *
 * SOFT signal (a flag, not a hard gate): `presentColumns` comes from the WINDOWED preview, so
 * it is not 100% authoritative (a mapped column blank in the first N rows could be absent from
 * the window). A blank `presentColumns` (preview not loaded yet) yields NO dangling roles --
 * never flag before the columns are known.
 */

interface RoleEntryLike {
  role: string;
  area: string | null;
}

const DESCRIPTION_ROLE = "description";

/**
 * Role-mapped column letters that are absent from the sheet's present columns (dangling roles).
 * Empty unless `isRevisionSheet` and at least one column is known (preview loaded).
 */
export function computeDanglingRoles(
  columnRoleMap: Record<string, RoleEntryLike>,
  presentColumns: Iterable<string>,
  isRevisionSheet: boolean,
): Set<string> {
  const dangling = new Set<string>();
  if (!isRevisionSheet) return dangling;
  const present = new Set(presentColumns);
  if (present.size === 0) return dangling; // preview not loaded -> can't tell; never flag
  for (const [col, entry] of Object.entries(columnRoleMap)) {
    if (entry && entry.role && !present.has(col)) dangling.add(col);
  }
  return dangling;
}

/**
 * True iff any dangling column carries the `description` role -- a removed description column
 * changes the combined description the whole pipeline keys on (D5's config-time warning).
 */
export function hasDanglingDescription(
  danglingCols: Set<string>,
  columnRoleMap: Record<string, RoleEntryLike>,
): boolean {
  for (const col of danglingCols) {
    if (columnRoleMap[col]?.role === DESCRIPTION_ROLE) return true;
  }
  return false;
}
