/**
 * Pure helpers `useServerDataTable` uses when another user's change refreshes an open table quietly
 * (Speed Plan task 14, step 3a). No React, so each rule is tested on its own.
 */

/** A row from a Frappe list: `name` is the document id. */
interface NamedRow {
    name?: unknown;
}

/**
 * True when every row has a non-empty string `name` and no two rows share one, so `name` can be the
 * table's row id. When it is not (rows without a name, or one document listed twice), the table keeps
 * TanStack's default id: the row's position on the page.
 */
export function namesAsRowIds(rows: readonly NamedRow[]): boolean {
    const seen = new Set<string>();
    for (const row of rows) {
        const name = row?.name;
        if (typeof name !== "string" || name === "" || seen.has(name)) return false;
        seen.add(name);
    }
    return true;
}

/** The row id when `namesAsRowIds` holds: the document's own name. One function, so its identity is stable. */
export const nameAsRowId = (row: NamedRow): string => row.name as string;

/**
 * True when a refreshed list reply would show exactly what is on screen: same rows, same values, same
 * total and summary figures. Then the table is left alone, so a change the viewer cannot see (another
 * project's record, a field not shown) redraws nothing.
 */
export function sameReply(previous: unknown, next: unknown): boolean {
    if (previous === next) return true;
    try {
        return JSON.stringify(previous) === JSON.stringify(next);
    } catch {
        return false;
    }
}

/**
 * The ticks to keep after the rows were refreshed: only those whose record is still in the list, so a
 * record another user moved out (approved, deleted) can no longer ride along in a bulk action. When the
 * ids are row positions, a position now holds a different record, so every tick is dropped. Returns the
 * same object when nothing changes.
 */
export function keepTicksForRows<T extends NamedRow>(
    selection: Record<string, boolean>,
    rows: readonly T[],
    getRowId?: (row: T, index: number) => string,
): Record<string, boolean> {
    const ticked = Object.keys(selection).filter((id) => selection[id]);
    if (ticked.length === 0) return selection;
    let ids: string[];
    if (getRowId) ids = rows.map((row, index) => getRowId(row, index));
    else if (namesAsRowIds(rows)) ids = rows.map(nameAsRowId);
    else return {};
    const present = new Set(ids);
    const kept = ticked.filter((id) => present.has(id));
    if (kept.length === ticked.length && kept.length === Object.keys(selection).length) return selection;
    return Object.fromEntries(kept.map((id) => [id, true]));
}

/** The index of the last page that has rows (0 when there are none). */
export function lastPageIndex(totalCount: number, pageSize: number): number {
    if (totalCount <= 0 || pageSize <= 0) return 0;
    return Math.ceil(totalCount / pageSize) - 1;
}
