// src/pages/outflow-import/porterRectify.ts
//
// Rectify a created Porter order (#1449, ADR-0032): which lines offer it, the toolbar's "Rectify N", and what
// the dialog and the run's result say. Pure: no React, no fetch. `porterRectify.test.ts` pins it;
// `OutflowRowsTable`, `OutflowMasterPage` and `RectifyDialog` render it.
//
// ⚠️ NO RULE OF ITS OWN ABOUT A LINE. Whether a line can move is the server's (`porter_rectify.get_porter_rectify_plan`
// `refusal`); the write re-asks under its locks. This only decides what to offer and how to word it.

import { MOVE_ORDER_LABEL } from "@/utils/porterExpense";

import { offPageTicks } from "./offPageTicks";
import { ROW_SETTLED } from "./outflowImportStatus";
import { PORTER_SOURCE } from "./porterImport";
import { orders } from "./porterWords";

export const RECTIFY_PLAN_METHOD = "nirmaan_stack.api.outflow_import.porter_rectify.get_porter_rectify_plan";
export const RECTIFY_METHOD = "nirmaan_stack.api.outflow_import.porter_rectify.rectify_porter_rows";

const PROJECT_EXPENSE = "Project Expenses";

/** On screen Rectify is "Move to another project" (#1558); the code and the domain keep the name Rectify. */
export { MOVE_ORDER_LABEL };

/** The toolbar's button over ticked lines, and the dialog's run button. */
export const moveOrdersLabel = (n: number): string => `Move ${orders(n)}`;

export const moveDialogTitle = (n: number): string =>
    n === 1 ? "Move this Porter order to another project" : `Move ${n} Porter orders to another project`;

/** One ticked line, as the plan reads it. Every field past `refusal` is absent on a refused line. */
export interface RectifyPlanLine {
    row: string;
    crn: string | null;
    refusal: string | null;
    amount?: number;
    booked_by?: string;
    ledger?: string;
    project?: string | null;
    project_name?: string | null;
    expense?: string;
    description?: string;
    /** The description differs from the generated text, so a Rectify keeps it as it is. */
    description_edited?: boolean;
}

export interface RectifyPlan {
    lines: RectifyPlanLine[];
    /** The Won projects: the only ones an order can move to. */
    projects: { name: string; project_name: string }[];
}

export interface RectifyResultLine {
    row: string;
    rectified: boolean;
    reason?: string;
    description_kept?: boolean;
}

export interface RectifyResult {
    count: number;
    lines: RectifyResultLine[];
}

const isPorterSettled = (row: { row_status: string; source?: string | null }) =>
    row.row_status === ROW_SETTLED && (row.source ?? "").trim() === PORTER_SOURCE;

/**
 * The Rectify button beside Unreconcile on one line: a Settled Porter line, for the undo roles
 * (`outflowImportStatus.canUndoOutflow`) -- the same people who can Unreconcile it.
 */
export const rectifyAffordance = (row: { row_status: string; source?: string | null }, canUndo: boolean): boolean =>
    canUndo && isPorterSettled(row);

export interface RectifyButtonState {
    /** Shown once a Settled Porter line is ticked on this page. */
    visible: boolean;
    enabled: boolean;
    count: number;
    /** Why it is off, or `null`. */
    note: string | null;
}

/**
 * "Move N orders" (Rectify) in the Settled-lines toolbar, beside "Unreconcile N". On only when every ticked line is a Settled
 * Porter line on this page: the run moves every line to ONE placement, which means nothing for a bank line.
 */
export const rectifyButtonState = (
    rows: ReadonlyArray<{ name: string; row_status: string; source?: string | null }>,
    selected: ReadonlySet<string>,
    tickedOnPage: ReadonlyMap<string, number>,
    currentPage: number,
): RectifyButtonState => {
    const count = selected.size;
    const porterTicked = rows.filter((row) => selected.has(row.name) && isPorterSettled(row)).length;
    if (!porterTicked) return { visible: false, enabled: false, count, note: null };
    const away = offPageTicks(rows, selected, tickedOnPage, currentPage, "Moving");
    if (away) return { visible: true, enabled: false, count, note: away.note };
    const others = count - porterTicked;
    if (others) {
        return {
            visible: true,
            enabled: false,
            count,
            note: `Moving works on Porter orders only: untick the ${others} other ${others === 1 ? "line" : "lines"}.`,
        };
    }
    return { visible: true, enabled: true, count, note: null };
};

/** Where the order's Expense is now: "Project Expense on Quillon Park" or "Non-Project Expense". */
export const placementText = (line: RectifyPlanLine): string =>
    line.ledger === PROJECT_EXPENSE
        ? `Project Expense on ${line.project_name || line.project || "a project"}`
        : "Non-Project Expense";

const alreadyThere = (line: RectifyPlanLine, target: string): boolean =>
    target ? line.ledger === PROJECT_EXPENSE && line.project === target : line.ledger !== PROJECT_EXPENSE;

/** The lines a Rectify to `target` (a project, or "" for Non-Project) would move: not refused, not there already. */
export const linesToMove = (lines: readonly RectifyPlanLine[], target: string): RectifyPlanLine[] =>
    lines.filter((line) => !line.refusal && !alreadyThere(line, target));

/** Why a line will not move to `target`, or `null` when it will. */
export const staysNote = (line: RectifyPlanLine, target: string): string | null =>
    line.refusal ?? (alreadyThere(line, target) ? "Already there, so it stays as it is." : null);

export interface RectifyOutcome {
    moved: number;
    title: string;
    notes: string[];
    failed: { row: string; reason: string }[];
}

/** What a run reports: how many moved where, and each line that did not, in the server's own words. */
export const rectifyOutcome = (result: RectifyResult, targetName: string | null): RectifyOutcome => {
    const moved = result.lines.filter((line) => line.rectified);
    const kept = moved.filter((line) => line.description_kept).length;
    return {
        moved: moved.length,
        title: moved.length
            ? `${orders(moved.length)} moved to ${targetName || "Non-Project"}.`
            : "Nothing was moved.",
        notes: kept ? [`${kept} kept ${kept === 1 ? "its" : "their"} hand-edited description.`] : [],
        failed: result.lines
            .filter((line) => !line.rectified)
            .map((line) => ({ row: line.row, reason: line.reason ?? "Not moved." })),
    };
};
