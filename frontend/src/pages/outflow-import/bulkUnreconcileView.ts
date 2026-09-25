// src/pages/outflow-import/bulkUnreconcileView.ts
//
// The bulk Unreconcile toolbar button, its check step (#1319), and the run's labels and result box
// (#1320, parent #1317). Pure: no React, no fetch. `bulkUnreconcileView.test.ts` pins it; `OutflowMasterPage` / `BulkUnreconcileDialog` render it.
//
// ⚠️ NO RULE OF ITS OWN. Every record's sentence in the check step is the one-line dialog's (`unreconcileView.legOutcomeLine`)
// and every verdict is the server's (`bulk_unreconcile.get_bulk_unreconcile_plan`, one `get_unreconcile_plan`
// per line). The only thing added is the line-level rule the write already has: a line is undone whole,
// so one refused record leaves the whole line out.

import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { offPageTicks } from "./offPageTicks";
import { ROW_MATCHED, ROW_MISMATCHED, ROW_SETTLED, rowStatusLabel } from "./outflowImportStatus";
import {
    legOutcomeLine,
    VERDICT_DELETE_CREATED,
    VERDICT_REFUSED,
    VERDICT_REVERT_EXPENSE,
    VERDICT_REVERT_PAYMENT,
    VERDICT_UNLINK_EXPENSE_LINE,
    VERDICT_UNSPLIT_PAYMENT,
    type LegOutcomeLine,
    type ReversedLeg,
    type UnreconcileResult,
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

/**
 * The wording for the lines a run did NOT undo -- in the check step's footer, the result box's heading
 * and the failed-request box.
 *
 * ⚠️ NEVER "STILL SETTLED". A line lands here for being refused, but also for no longer existing
 * (`LINE_GONE`) or no longer being Settled (`NOT_SETTLED_ANY_MORE`), and calling those Settled is false.
 * What IS true of every one of them is that this run changed nothing on it, so that is what is said.
 */
export const NOT_UNDONE_HEADING = "Not undone";
export const NOT_UNDONE_NOTE = "nothing changed on these";
export const CHECK_STEP_FOOTER =
    "A transfer that can't be undone is left exactly as it is. You can fix it and undo it later on its own.";
export const FAILED_RUN_NOTE =
    "Each transfer is saved on its own, so any finished before it stopped stay undone and the rest are left as they were. The table has been refreshed to show what really changed.";

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

/** The check step's red button (mockup dialog 1). Counts only the lines that will be sent. */
export const bulkStartLabel = (count: number): string => `Unreconcile ${transfers(count)}`;

/** The blocking spinner's heading (mockup dialog 2). */
export const bulkRunningTitle = (count: number): string => `Unreconciling ${transfers(count)}…`;

/** One line as `bulk_unreconcile.bulk_unreconcile_rows` returns it: the one-line response, or a refusal. */
export type BulkUnreconcileEntry =
    | ({ row: string; undone: true } & Omit<UnreconcileResult, "row">)
    | { row: string; undone: false; reason: string };

export interface BulkUnreconcileResponse {
    count: number;
    lines: BulkUnreconcileEntry[];
}

export interface BulkResultLine {
    row: string;
    beneficiary: string | null;
    /** `null` when the check step had no plan for the line. */
    amount: number | null;
    /** "PAY-18 back to Reconciliation Pending", one per record that came off. */
    records: string[];
}

export interface BulkResultGroup {
    /** The line's stored status now. */
    status: string;
    /** What the screen calls it (`Mismatched` reads "Not-Matched"). */
    label: string;
    /** A Matched line keeps its pick, so it is marked Confirm by hand (#1280). */
    confirmByHand: boolean;
    lines: BulkResultLine[];
}

export interface BulkBlockedLine {
    row: string;
    beneficiary: string | null;
    amount: number | null;
    reason: string;
}

export interface BulkResultSummary {
    title: string;
    undoneCount: number;
    /** Undone lines grouped by where each one went: Matched first, then Not-Matched, then anything else. */
    groups: BulkResultGroup[];
    /** Not undone (refused, gone or no longer Settled) -- each with its sentence. */
    blocked: BulkBlockedLine[];
    /** Show the "marked Confirm by hand" note: some line landed Matched. */
    confirmByHandNote: boolean;
}

/**
 * What happened to one record, in a few words, for the result box. The server's verdict decides it, never
 * this. It is a PAST-TENSE summary of a write that has happened -- the check step above it still shows the
 * one-line dialog's own sentences (`legOutcomeLine`) for what WILL happen.
 */
const recordOutcome = (leg: ReversedLeg): string => {
    if (leg.verdict === VERDICT_DELETE_CREATED) return `${leg.target_name} deleted`;
    if (leg.verdict === VERDICT_UNSPLIT_PAYMENT) return `${leg.target_name} split undone, back to Reconciliation Pending`;
    if (leg.verdict === VERDICT_UNLINK_EXPENSE_LINE)
        return leg.stays_paid
            ? `${leg.target_name} came off; the expense stays Paid`
            : `${leg.target_name} back to Reconciliation Pending`;
    if (leg.verdict === VERDICT_REVERT_PAYMENT || leg.verdict === VERDICT_REVERT_EXPENSE)
        return `${leg.target_name} back to Reconciliation Pending`;
    // A verdict this screen has no words for yet: say only what is certain.
    return `${leg.target_name} came off`;
};

/** The box a failed request leaves (#1317 story 21a). */
export const bulkFailedSentence = (count: number, error: string): string =>
    `The request for ${transfers(count)} failed (${error}).`;

const STATUS_ORDER = [ROW_MATCHED, ROW_MISMATCHED];
const statusRank = (status: string) => {
    const at = STATUS_ORDER.indexOf(status);
    return at === -1 ? STATUS_ORDER.length : at;
};

/**
 * The result box, from the run's response and the check step's plans (#1320, mockup dialog 3). The plans
 * give each line's name and money, and the lines the check step left out (listed as blocked first).
 *
 * ⚠️ "WHERE IT WENT" IS THE SERVER'S `row_status`, never guessed from the source: a Cashbook line lands
 * Not-Matched because its pick was deleted, and so does a hand-linked line with no suggestion to fall back on.
 */
export const bulkResultSummary = (
    response: BulkUnreconcileResponse,
    plans: readonly UnreconcilePlan[]
): BulkResultSummary => {
    const byRow = new Map(plans.map((plan) => [plan.row, plan]));
    const facts = (row: string) => {
        const plan = byRow.get(row);
        return { beneficiary: plan?.beneficiary_name || null, amount: plan ? plan.amount : null };
    };
    const groups = new Map<string, BulkResultGroup>();
    const blocked: BulkBlockedLine[] = [];
    // ⚠️ LINES LEFT OUT AT THE CHECK STEP WERE NEVER SENT, so the response does not name them -- but the
    // person ticked them, and "Not undone" must still account for every one.
    const sent = new Set(response.lines.map((entry) => entry.row));
    for (const line of plans.map(checkLine)) {
        if (!line.blocked || sent.has(line.plan.row)) continue;
        const refused = line.records.find(({ leg }) => leg.verdict === VERDICT_REFUSED);
        blocked.push({
            row: line.plan.row,
            ...facts(line.plan.row),
            reason: line.reason ?? refused?.leg.reason ?? NOTHING_SETTLED,
        });
    }
    for (const entry of response.lines) {
        if (!entry.undone) {
            blocked.push({ row: entry.row, ...facts(entry.row), reason: entry.reason });
            continue;
        }
        const status = entry.row_status;
        let group = groups.get(status);
        if (!group) {
            group = { status, label: rowStatusLabel(status), confirmByHand: status === ROW_MATCHED, lines: [] };
            groups.set(status, group);
        }
        group.lines.push({ row: entry.row, ...facts(entry.row), records: entry.reversed.map(recordOutcome) });
    }
    const ordered = [...groups.values()].sort((a, b) => statusRank(a.status) - statusRank(b.status));
    const undoneCount = ordered.reduce((sum, group) => sum + group.lines.length, 0);
    const head = undoneCount ? `${transfers(undoneCount)} unreconciled` : "Nothing unreconciled";
    return {
        title: blocked.length ? `${head}, ${blocked.length} blocked` : head,
        undoneCount,
        groups: ordered,
        blocked,
        confirmByHandNote: ordered.some((group) => group.confirmByHand),
    };
};
