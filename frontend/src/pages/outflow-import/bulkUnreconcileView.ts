// src/pages/outflow-import/bulkUnreconcileView.ts
//
// The bulk Unreconcile toolbar button and its check step (#1319, parent #1317). Pure: no React, no
// fetch. `bulkUnreconcileView.test.ts` pins it; `OutflowMasterPage` / `BulkUnreconcileDialog` render it.
//
// ⚠️ NO RULE OF ITS OWN. Every record's sentence is the one-line dialog's (`unreconcileView.legOutcomeLine`)
// and every verdict is the server's (`bulk_unreconcile.get_bulk_unreconcile_plan`, one `get_unreconcile_plan`
// per line). The only thing added is the line-level rule the write already has: a line is undone whole,
// so one refused record leaves the whole line out.

import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { offPageTicks } from "./offPageTicks";
import { ROW_SETTLED } from "./outflowImportStatus";
import {
    legOutcomeLine,
    VERDICT_REFUSED,
    type LegOutcomeLine,
    type UnreconcilePlan,
    type UnreconcilePlanLeg,
} from "./unreconcileView";

export interface UnreconcileButtonState {
    enabled: boolean;
    count: number;
    /** The amber note under the toolbar, or `null`. */
    note: string | null;
    /** The toolbar's short "2 on page 3", or `null`. */
    offPage: string | null;
}

/**
 * "Unreconcile N": on when every ticked Settled line is on this page (#1317 stories 12, 13).
 *
 * ⚠️ ONE PAGE AT A TIME, LIKE LINKING, through the same `offPageTicks` check. The page holds 50, so this
 * also keeps a run at the server's cap -- which the server enforces again on its own.
 */
export const unreconcileButtonState = (
    rows: ReadonlyArray<{ name: string }>,
    selected: ReadonlySet<string>,
    tickedOnPage: ReadonlyMap<string, number>,
    currentPage: number
): UnreconcileButtonState => {
    const count = selected.size;
    if (!count) return { enabled: false, count, note: null, offPage: null };
    const away = offPageTicks(rows, selected, tickedOnPage, currentPage, "Unreconcile");
    if (away) return { enabled: false, count, ...away };
    return { enabled: true, count, note: null, offPage: null };
};

const transfers = (n: number) => `${n} ${n === 1 ? "transfer" : "transfers"}`;

export const bulkUnreconcileTitle = (count: number): string => `Unreconcile ${transfers(count)}?`;

/** A line whose import was deleted after it was ticked. */
export const LINE_GONE = "This transfer no longer exists, so there is nothing to undo.";
/** A line that changed after it was ticked: someone else already undid it. */
export const NOT_SETTLED_ANY_MORE = "This transfer is no longer Settled, so there is nothing to undo.";
/** A Settled line with no Settled record -- should not happen, and is left out rather than guessed at. */
export const NOTHING_SETTLED = "Nothing on this transfer is settled, so there is nothing to undo.";

export interface BulkCheckRecord {
    leg: UnreconcilePlanLeg;
    outcome: LegOutcomeLine;
}

export interface BulkCheckLine {
    plan: UnreconcilePlan;
    /** Greyed and left out. */
    blocked: boolean;
    /** Why, when no record says it -- `null` when a refused record carries the sentence. */
    reason: string | null;
    records: BulkCheckRecord[];
}

export interface BulkCheckPill {
    tone: "go" | "stop";
    text: string;
}

export interface BulkCheckSummary {
    /** Lines that will be undone first, then the blocked ones, each group in the order ticked. */
    lines: BulkCheckLine[];
    undoCount: number;
    undoAmount: number;
    blockedCount: number;
    /** "N will be undone · ₹X", and "M can't be undone · left out" when there are any. */
    pills: BulkCheckPill[];
}

const checkLine = (plan: UnreconcilePlan): BulkCheckLine => {
    const records = plan.legs.map((leg) => ({ leg, outcome: legOutcomeLine(leg) }));
    const reason = plan.not_found
        ? LINE_GONE
        : plan.row_status !== ROW_SETTLED
          ? NOT_SETTLED_ANY_MORE
          : !plan.legs.length
            ? NOTHING_SETTLED
            : null;
    // ⚠️ ONE REFUSED RECORD LEAVES THE WHOLE LINE OUT -- the write undoes a line whole or not at all.
    const refused = plan.legs.some((leg) => leg.verdict === VERDICT_REFUSED);
    return { plan, blocked: reason !== null || refused, reason, records };
};

/** The check step, from the server's plans (#1317 stories 15-17). */
export const bulkCheckSummary = (plans: readonly UnreconcilePlan[]): BulkCheckSummary => {
    const all = plans.map(checkLine);
    const going = all.filter((line) => !line.blocked);
    const blocked = all.filter((line) => line.blocked);
    const undoAmount = going.reduce((sum, line) => sum + line.plan.amount, 0);
    const pills: BulkCheckPill[] = [
        {
            tone: "go",
            text: going.length
                ? `${going.length} will be undone · ${formatToRoundedIndianRupee(undoAmount)}`
                : "0 will be undone",
        },
    ];
    if (blocked.length) pills.push({ tone: "stop", text: `${blocked.length} can't be undone · left out` });
    return {
        lines: [...going, ...blocked],
        undoCount: going.length,
        undoAmount,
        blockedCount: blocked.length,
        pills,
    };
};
