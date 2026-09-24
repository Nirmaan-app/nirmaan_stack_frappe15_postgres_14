// src/pages/outflow-import/tickMode.ts
//
// Which lines may be ticked, and what the top box ticks (#1319, parent #1317). Pure: no React, no fetch.
// `tickMode.test.ts` pins it; `OutflowMasterPage` feeds its answer to `OutflowRowsTable`.
//
// ⚠️ A SELECTION IS ALL OPEN LINES (to confirm or link) OR ALL SETTLED LINES (to unreconcile), NEVER
// BOTH (#1317 story 8). The first tick sets the mode; clearing every tick ends it. This is the one place
// that rule lives -- a confirm and an undo must never ride in one click.

import type { OutflowTab } from "./outflowTableModel";
import { OPEN_ROW_STATUSES, ROW_SETTLED } from "./outflowImportStatus";

/** What a ticked line was ticked AS. */
export type TickKind = "open" | "settled";

/** `none` = nothing ticked; otherwise the kind every ticked line shares. */
export type TickMode = "none" | TickKind;

/**
 * The tabs that offer Settled lines for a bulk Unreconcile (#1317 stories 5, 6). Never "All": open and
 * settled work are not mixed in one selection.
 */
const SETTLED_TICK_TABS: ReadonlySet<OutflowTab> = new Set<OutflowTab>(["matchedOutflow", "settledInflow"]);

/** Whether this tab offers Settled lines to this user. */
export const settledTicksAllowed = (tab: OutflowTab, canUndo: boolean): boolean =>
    canUndo && SETTLED_TICK_TABS.has(tab);

/** The amber line under the toolbar while Settled lines are ticked (mockup screen 0). */
export const SETTLED_MODE_NOTE =
    "Only Settled lines can be ticked now. Clear your ticks to pick lines to confirm or link.";

/** On a greyed open line's box while Settled lines are ticked. */
export const LOCKED_OPEN_TITLE = "Clear your ticks to pick lines to confirm or link.";

/** On a greyed Settled line's box while open lines are ticked. */
export const LOCKED_SETTLED_TITLE = "Clear your ticks to pick lines to unreconcile.";

/** The title on a greyed box: a Settled line waits for open ticks to clear, an open line for Settled ones. */
export const lockedTitle = (row: { row_status: string }): string =>
    row.row_status === ROW_SETTLED ? LOCKED_SETTLED_TITLE : LOCKED_OPEN_TITLE;

/** The top box's hint: how to select a page of Settled lines (#1317 story 11). */
export const SELECT_SETTLED_HINT =
    "Selects the open lines. To select the Settled lines on this page, tick one Settled line first.";

/**
 * What `row` could be ticked as, whatever is already ticked -- or `null` when it can never be ticked.
 *
 * ⚠️ PARTIALLY ALLOCATED IS NEITHER. It is not open (`OPEN_ROW_STATUSES`) and not Settled; its undo stays
 * in the decision dialog (#1317 story 7).
 */
export const tickKindOf = (row: { row_status: string }, settledAllowed: boolean): TickKind | null => {
    if (OPEN_ROW_STATUSES.has(row.row_status)) return "open";
    if (settledAllowed && row.row_status === ROW_SETTLED) return "settled";
    return null;
};

/**
 * The mode the current ticks put the table in.
 *
 * ⚠️ KEYED ON WHAT EACH LINE WAS TICKED AS, NOT ON ITS STATUS NOW. A ticked line may sit on another page,
 * where its row is not loaded, and a refetch may move a ticked line's status. A tick with no recorded
 * kind reads as `open`, which is what every tick meant before #1319.
 */
export const selectionMode = (
    selected: ReadonlySet<string>,
    kindByName: ReadonlyMap<string, TickKind>
): TickMode => {
    for (const name of selected) return kindByName.get(name) ?? "open";
    return "none";
};

export interface TickRules {
    /** The lines whose box can be ticked now. */
    tickable: ReadonlySet<string>;
    /** Lines that could be ticked but for the current mode: a greyed box, with a title saying why. */
    locked: ReadonlySet<string>;
    /** What the top box ticks, in page order. */
    selectAll: string[];
    /** The top box's title, or `null`. */
    selectAllHint: string | null;
    /** The amber note under the toolbar that explains the mode, or `null`. */
    note: string | null;
}

/**
 * The tick rules for one page of `rows`.
 *
 * - nothing ticked: open lines, plus Settled lines for the undo roles on the two Matched/Settled tabs.
 *   The top box ticks the open lines, as it did before #1319 (story 10).
 * - open mode: only open lines; Settled lines are greyed.
 * - settled mode: only Settled lines; open lines are greyed, and the top box ticks the Settled lines.
 *
 * ⚠️ `canUndo` IS `outflowImportStatus.canUndoOutflow`. Convenience only: the plan and write endpoints
 * refuse a plain Accountant themselves.
 */
export const tickRules = ({
    rows,
    mode,
    tab,
    canUndo,
}: {
    rows: ReadonlyArray<{ name: string; row_status: string }>;
    mode: TickMode;
    tab: OutflowTab;
    canUndo: boolean;
}): TickRules => {
    const settledAllowed = settledTicksAllowed(tab, canUndo);
    const open: string[] = [];
    const settled: string[] = [];
    for (const row of rows) {
        const kind = tickKindOf(row, settledAllowed);
        if (kind === "open") open.push(row.name);
        else if (kind === "settled") settled.push(row.name);
    }
    const hint = settled.length > 0 ? SELECT_SETTLED_HINT : null;

    if (mode === "settled") {
        return {
            tickable: new Set(settled),
            locked: new Set(open),
            selectAll: settled,
            selectAllHint: null,
            note: SETTLED_MODE_NOTE,
        };
    }
    if (mode === "open") {
        return { tickable: new Set(open), locked: new Set(settled), selectAll: open, selectAllHint: hint, note: null };
    }
    return {
        tickable: new Set([...open, ...settled]),
        locked: new Set(),
        selectAll: open,
        selectAllHint: hint,
        note: null,
    };
};
