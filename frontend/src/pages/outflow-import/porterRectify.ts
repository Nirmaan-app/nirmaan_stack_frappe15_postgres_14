// src/pages/outflow-import/porterRectify.ts
//
// Rectify a created Porter order (#1449, ADR-0032): which lines offer it, the toolbar's "Rectify N", and what
// the dialog and the run's result say. Pure: no React, no fetch. `porterRectify.test.ts` pins it;
// `OutflowRowsTable`, `OutflowMasterPage` and `RectifyDialog` render it.
//
// ⚠️ NO RULE OF ITS OWN ABOUT A LINE. Whether a line can move is the server's (`rectify.get_rectify_plan`
// `refusal`); the write re-asks under its locks. This only decides what to offer and how to word it.

import { CASHBOOK_SOURCE, moveLabel } from "./cashbookRectify";
import { offPageTicks } from "./offPageTicks";
import { ROW_SETTLED } from "./outflowImportStatus";
import { PORTER_SOURCE } from "./porterImport";
import { orders } from "./porterWords";

/** The Move endpoints for any wired source (#1757): each takes the source from the ticked lines. */
export const RECTIFY_PLAN_METHOD = "nirmaan_stack.api.outflow_import.rectify.get_rectify_plan";
export const RECTIFY_METHOD = "nirmaan_stack.api.outflow_import.rectify.rectify_lines";

const PROJECT_EXPENSE = "Project Expenses";

/**
 * The dialog's title (story 39), by the label rule over the lines whose expense the plan read (a refused line has
 * none); "Move to a project" when no line has one.
 */
export const moveDialogTitle = (lines: readonly RectifyPlanLine[]): string => {
    const ledgers = lines.filter((line) => line.ledger).map((line) => line.ledger);
    return moveLabel(ledgers.length ? ledgers : lines.map(() => undefined));
};

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
    /** The ticked lines' source (`rectify.get_rectify_plan`, #1757). */
    source?: string;
    /** The expense types each ledger takes, for the type a Cashbook Move offers. */
    types?: Record<string, string[]>;
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

type MovableRow = { row_status: string; source?: string | null; suggested_doctype?: string | null };

/** The sources Move is wired for (#1449 Porter, #1757 Cashbook), and what each calls its lines. */
const MOVABLE_SOURCES: Record<string, string> = { [PORTER_SOURCE]: "Porter orders", [CASHBOOK_SOURCE]: "Cashbook lines" };

/** The line's source when it is a Settled line Move is wired for, else `null`. */
const movableSource = (row: MovableRow): string | null => {
    const source = (row.source ?? "").trim();
    return row.row_status === ROW_SETTLED && source in MOVABLE_SOURCES ? source : null;
};

/**
 * The Rectify (Move) button beside Unreconcile on one line: a Settled Porter or Cashbook line, for the undo roles
 * (`outflowImportStatus.canUndoOutflow`) -- the same people who can Unreconcile it.
 */
export const rectifyAffordance = (row: MovableRow, canUndo: boolean): boolean => canUndo && Boolean(movableSource(row));

/** The line button's words, by where the line's expense is now (`moveLabel`; a Porter line too, #1759). */
export const lineMoveLabel = (row: MovableRow): string => moveLabel([row.suggested_doctype]);

/** The toolbar's words over the ticked lines, by the same rule as one line's (#1757, Porter #1759). */
export const toolbarMoveLabel = (rows: ReadonlyArray<MovableRow & { name: string }>, selected: ReadonlySet<string>): string =>
    moveLabel(rows.filter((row) => selected.has(row.name)).map((row) => row.suggested_doctype));

export interface RectifyButtonState {
    /** Shown once a Settled Porter or Cashbook line is ticked on this page. */
    visible: boolean;
    enabled: boolean;
    count: number;
    /** Why it is off, or `null`. */
    note: string | null;
}

/**
 * Move (Rectify) in the Settled-lines toolbar, beside "Unreconcile N". On only when every ticked line is a Settled
 * line of ONE wired source on this page (Porter first when both are ticked): the run moves every line to ONE
 * placement, through that source's rules, which means nothing for a bank line.
 */
export const rectifyButtonState = (
    rows: ReadonlyArray<MovableRow & { name: string }>,
    selected: ReadonlySet<string>,
    tickedOnPage: ReadonlyMap<string, number>,
    currentPage: number,
): RectifyButtonState => {
    const count = selected.size;
    const sources = rows.filter((row) => selected.has(row.name)).map(movableSource);
    const source = sources.includes(PORTER_SOURCE) ? PORTER_SOURCE : sources.find(Boolean);
    if (!source) return { visible: false, enabled: false, count, note: null };
    const ofSource = sources.filter((s) => s === source).length;
    const away = offPageTicks(rows, selected, tickedOnPage, currentPage, "Moving");
    if (away) return { visible: true, enabled: false, count, note: away.note };
    const others = count - ofSource;
    if (others) {
        return {
            visible: true,
            enabled: false,
            count,
            note: `Moving works on ${MOVABLE_SOURCES[source]} only: untick the ${others} other ${others === 1 ? "line" : "lines"}.`,
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
export const linesToMove = <T extends RectifyPlanLine>(lines: readonly T[], target: string): T[] =>
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
