// src/pages/outflow-import/linkLinesView.ts
//
// "Link N to one expense": the toolbar button's state and note, the picker's fit marks, the After
// linking bar, the footer label and the notice a link ends in (#1298, ADR-0027). Pure: no React, no
// fetch. `OutflowMasterPage` and `LinkLinesDialog` render these; `linkLinesView.test.ts` pins them.
//
// ⚠️ CONVENIENCE ONLY. `link_lines.link_rows_to_expense` re-reads every line and the expense under
// locks and refuses anything that does not fit; nothing here decides whether money moves. The ₹5 is
// the server's `AMOUNT_TOLERANCE`, mirrored as `LINK_TOLERANCE` for the marks only.

import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { isCreditRow, isPartLinkedRecord, type SettleableRecord } from "./outflowTableModel";

/** Mirrors `amounts.AMOUNT_TOLERANCE` (pinned by `linkLinesParity.test.ts`): the ₹5 a link may overshoot
 *  what is left, and still read Paid. */
export const LINK_TOLERANCE = 5;

/** One Reconciliation Pending expense with room, as `link_lines.get_linkable_expenses` returns it. */
export interface LinkableExpense {
    target_doctype: string;
    name: string;
    expense_type: string;
    description: string;
    project: string;
    project_name: string;
    amount: number;
    /** What its live slips already cover. */
    linked_total: number;
    line_count: number;
    remaining: number;
    payment_ref: string;
}

/** What `link_rows_to_expense` says the expense became. */
export interface LinkedExpense {
    name: string;
    status: string;
    remaining: number;
}

const rupees = (amount: number): string => formatToRoundedIndianRupee(amount);

/** Money compared in paise, so float noise never flips a mark at the ₹5 edge. */
const paise = (amount: number): number => Math.round(amount * 100);

const lines = (count: number): string => `${count} ${count === 1 ? "line" : "lines"}`;

// --- the toolbar button ---------------------------------------------------------------------------

export interface LinkButtonState {
    enabled: boolean;
    /** How many lines are ticked -- the button reads "Link N to one expense". */
    count: number;
    /** Why the button is off, shown under the toolbar; `null` when it is on or nothing is ticked. */
    note: string | null;
    /** The toolbar's short "2 on page 1", or `null` when every tick is on this page. */
    offPage: string | null;
}

const pagesPhrase = (pages: number[]): string => {
    const shown = pages.map((p) => String(p + 1));
    if (shown.length === 1) return `page ${shown[0]}`;
    return `pages ${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
};

/**
 * Whether "Link N to one expense" may open, and the note that says why not (ADR-0027 R2, Q16).
 *
 * ⚠️ ONE GRID PAGE AT A TIME. Ticks survive paging, but only this page's lines carry an amount the
 * screen can add up and show, so a tick that is not in `rows` turns the button off and says which page
 * it is on. `tickedOnPage` is the page each line was ticked on; a line with no entry reads "another
 * page" rather than a guessed number.
 *
 * ⚠️ THE OTHER PAGE IS REPORTED BEFORE A MONEY-IN LINE. A money-in line on another page cannot be seen
 * to untick, so the first thing to fix is getting back to it.
 *
 * ⚠️ A BLANK DIRECTION IS MONEY OUT, through `isCreditRow` -- the test the Amount cell's colour reads
 * and the server's debit guard agrees with.
 */
export const linkButtonState = (
    rows: OutflowImportRow[],
    selected: ReadonlySet<string>,
    tickedOnPage: ReadonlyMap<string, number>,
    currentPage: number
): LinkButtonState => {
    const count = selected.size;
    if (!count) return { enabled: false, count, note: null, offPage: null };

    const onPage = new Set(rows.map((r) => r.name));
    const away = [...selected].filter((name) => !onPage.has(name));
    if (away.length) {
        const known = away.map((name) => tickedOnPage.get(name));
        const pages = [...new Set(known.filter((p): p is number => p !== undefined && p !== currentPage))].sort(
            (a, b) => a - b
        );
        const where = pages.length && known.every((p) => p !== undefined) ? pagesPhrase(pages) : null;
        const n = away.length;
        const lead = `${n} ticked ${n === 1 ? "line is" : "lines are"} on ${where ?? "another page"}.`;
        const back = !where ? "it" : pages.length === 1 ? where : "those pages";
        const untick = n === 1 ? "untick it" : `untick those ${n}`;
        return {
            enabled: false,
            count,
            note: `${lead} Linking works on one page at a time: go back to ${back}, or ${untick}.`,
            offPage: `${n} on ${where ?? "another page"}`,
        };
    }

    const moneyIn = rows.filter((r) => selected.has(r.name) && isCreditRow(r)).length;
    if (moneyIn) {
        return {
            enabled: false,
            count,
            note:
                "An expense only takes money-out lines. " +
                `Untick the ${moneyIn} money-in ${moneyIn === 1 ? "line" : "lines"} to link the rest.`,
            offPage: null,
        };
    }
    return { enabled: true, count, note: null, offPage: null };
};

/** The money that came IN across the ticked lines -- the toolbar's "+ ₹X in", beside "₹Y out". */
export const selectedMoneyIn = (rows: OutflowImportRow[], selected: ReadonlySet<string>): number =>
    rows.reduce((sum, row) => (selected.has(row.name) && isCreditRow(row) ? sum + row.amount : sum), 0);

// --- the picker -------------------------------------------------------------------------------------

export type FitKind = "fills" | "fits" | "too_big";

export interface FitMark {
    kind: FitKind;
    /** Too big is not pickable: the server would refuse it (Q16). */
    pickable: boolean;
    label: string;
}

/**
 * How the ticked lines sit against one expense's remaining balance.
 *
 * `fills` -- what is left after is within ₹5 either way, so the expense becomes Paid.
 * `fits` -- short of that; it stays Reconciliation Pending.
 * `too_big` -- the lines exceed what is left by more than ₹5; nothing would be linked.
 */
export const fitMark = (linesTotal: number, record: LinkableExpense): FitMark => {
    const after = paise(record.remaining) - paise(linesTotal);
    const tolerance = paise(LINK_TOLERANCE);
    if (after < -tolerance) {
        return { kind: "too_big", pickable: false, label: `too big by ${rupees(-after / 100)}` };
    }
    if (after <= tolerance) {
        return { kind: "fills", pickable: true, label: "fills it · becomes Paid" };
    }
    return { kind: "fits", pickable: true, label: `fits · ${rupees(after / 100)} left after` };
};

/** "no lines yet" / "1 line" / "25 lines" under the Linked so far figure. */
export const linkedSoFarNote = (record: LinkableExpense): string =>
    record.line_count ? lines(record.line_count) : "no lines yet";

/**
 * The picker's search: every word must appear in the id, expense type, description or project.
 * A blank search passes everything through.
 */
export const filterLinkableExpenses = (records: LinkableExpense[], query: string): LinkableExpense[] => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return records;
    return records.filter((record) => {
        const haystack = [record.name, record.expense_type, record.description, record.project, record.project_name]
            .join(" ")
            .toLowerCase();
        return words.every((word) => haystack.includes(word));
    });
};

// --- the After linking bar and the footer ------------------------------------------------------------

export interface TickedLines {
    total: number;
    count: number;
    /** The latest ticked line's `added_on`; the Paid date the server will write. */
    latestDate: string | null;
    /** `bulkIdOf` over the ticked lines' narrations. */
    bulkId: string | null;
}

export interface AfterLinking {
    tone: "ok" | "over";
    summary: string;
    /** `null` when the lines do not fit: there is no outcome to describe. */
    detail: string | null;
}

/**
 * The facts the dialog and the After linking bar read off the ticked lines.
 *
 * ⚠️ THE LATEST DATE IS THE LATEST `added_on`, the same column the server's `MAX(r.added_on)` reads
 * for the Paid date; a line with none is skipped there and here.
 */
export const tickedLines = (rows: OutflowImportRow[]): TickedLines => {
    const dates = rows.map((r) => r.added_on).filter((d): d is string => Boolean(d)).sort();
    return {
        total: rows.reduce((sum, r) => sum + r.amount, 0),
        count: rows.length,
        latestDate: dates.length ? dates[dates.length - 1] : null,
        bulkId: bulkIdOf(rows.map((r) => `${r.remarks ?? ""} ${r.bank_reference_no ?? ""}`)),
    };
};

/** The dialog header's sub-line: date (or range), bank, import(s), and the bulk id when one is shared. */
export const tickedSubline = (rows: OutflowImportRow[]): string => {
    const dates = [...new Set(rows.map((r) => r.added_on?.slice(0, 10)).filter((d): d is string => Boolean(d)))].sort();
    const parts: string[] = [];
    if (dates.length === 1) parts.push(lineDate(dates[0]));
    else if (dates.length > 1) parts.push(`${lineDate(dates[0])} – ${lineDate(dates[dates.length - 1])}`);
    const sources = [...new Set(rows.map((r) => r.source).filter((s): s is string => Boolean(s)))];
    if (sources.length === 1) parts.push(sources[0]);
    const batches = [...new Set(rows.map((r) => r.import_batch).filter((b): b is string => Boolean(b)))];
    if (batches.length === 1) parts.push(batches[0]);
    else if (batches.length > 1) parts.push(`${batches.length} imports`);
    const bulkId = tickedLines(rows).bulkId;
    if (bulkId) parts.push(`bulk id ${bulkId}`);
    return parts.join(" · ");
};

/** A stored `added_on` as a calendar date, built locally so no timezone moves it a day. */
const lineDate = (value: string): string => {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number);
    return formatDate(new Date(y, m - 1, d));
};

/**
 * What linking these lines to this expense would do, in the words the server's rules follow.
 *
 * ⚠️ THE REFERENCE SENTENCE FOLLOWS `settle.link_lines_to_expense` (ADR-0027 Q10, Q13): one line on an
 * expense with no lines yet takes that line's reference; otherwise an existing reference is kept and a
 * blank one gets the bulk id the lines share, or stays blank when they share none.
 */
export const afterLinking = (ticked: TickedLines, record: LinkableExpense): AfterLinking => {
    const mark = fitMark(ticked.total, record);
    const newTotal = record.linked_total + ticked.total;
    const of = `After linking: ${rupees(newTotal)} of ${rupees(record.amount)} linked`;
    if (mark.kind === "too_big") {
        return { tone: "over", summary: `${of} · over by ${rupees(newTotal - record.amount)}`, detail: null };
    }
    const left = Math.max(0, paise(record.remaining) - paise(ticked.total)) / 100;
    const outcome =
        mark.kind === "fills"
            ? `${record.name} becomes Paid, dated ${
                  ticked.latestDate ? lineDate(ticked.latestDate) : "the latest line's date"
              } (the latest line).`
            : `${record.name} stays Reconciliation Pending until the rest is linked. No payment date yet.`;
    // A true 1:1 settle -- one line, no earlier lines, and it fills -- is the one shape that takes the
    // line's own reference; a single line that only part-fills is the first go of a run.
    const reference =
        record.line_count === 0 && ticked.count === 1 && mark.kind === "fills"
            ? "It takes this line's reference."
            : record.payment_ref.trim()
              ? "Its reference stays as it is."
              : ticked.bulkId
                ? `Its blank reference gets the bulk id ${ticked.bulkId}.`
                : "Its reference stays blank.";
    return { tone: "ok", summary: `${of} · left ${rupees(left)}`, detail: `${outcome} ${reference}` };
};

/** The footer action: "Link 5 lines" / "Link 5 lines · becomes Paid". */
export const linkActionLabel = (count: number, becomesPaid: boolean): string =>
    `Link ${lines(count)}${becomesPaid ? " · becomes Paid" : ""}`;

/** The page notice a successful link ends in. Inline, never a toast (the screen's convention). */
export const linkedNotice = (count: number, expense: LinkedExpense): { title: string; body: string } => ({
    title: "Linked.",
    body:
        `${lines(count)} ${count === 1 ? "is" : "are"} on ${expense.name}, which ` +
        (expense.status === "Paid"
            ? "is now Paid."
            : `stays ${expense.status} with ${rupees(expense.remaining)} left.`),
});

// --- Decide: one late line (#1299) -------------------------------------------------------------------
//
// ⚠️ THE SAME MARKS AND THE SAME BAR AS THE LINK DIALOG, READ FOR ONE LINE. A late line of a run is
// linked from Decide through the same server settle (ADR-0027 Q13, Q17), so it is described by the
// same `fitMark` and `afterLinking` -- two wordings for one outcome would be free to disagree.
//
// ⚠️ ONLY FOR A PART-LINKED EXPENSE. Every function here returns `null` (or today's label) for a
// payment and for an expense no line has reached yet, whose amount cell is unchanged: a fresh
// expense still settles 1:1 against its whole amount.

/** A Decide record as the link dialog's `LinkableExpense`, for the shared marks. */
const asLinkable = (record: SettleableRecord): LinkableExpense => ({
    target_doctype: record.target_doctype,
    name: record.name,
    expense_type: record.expense_type ?? "",
    description: record.description ?? "",
    project: record.project,
    project_name: record.project_name,
    amount: Number(record.amount),
    linked_total: Number(record.linked_total ?? 0),
    line_count: Number(record.line_count ?? 0),
    remaining: Number(record.remaining ?? record.amount),
    payment_ref: record.payment_ref ?? "",
});

export interface DecideAmountCell {
    /** "₹10,000 left", under the record's amount. */
    left: string;
    mark: FitMark;
}

/** The Decide picker's Amount cell extras for a part-linked expense, or `null` to render it as today. */
export const decideAmountCell = (record: SettleableRecord, lineAmount: number): DecideAmountCell | null => {
    if (!isPartLinkedRecord(record)) return null;
    const linkable = asLinkable(record);
    return { left: `${rupees(linkable.remaining)} left`, mark: fitMark(Number(lineAmount), linkable) };
};

/** The After linking bar for one line on a part-linked expense, or `null` when there is none to show. */
export const decideAfterLinking = (
    record: SettleableRecord | null | undefined,
    line: OutflowImportRow
): AfterLinking | null => {
    if (!record || !isPartLinkedRecord(record)) return null;
    return afterLinking(tickedLines([line]), asLinkable(record));
};

/**
 * Decide's Normal-mode Confirm label.
 *
 * ⚠️ IT SAYS PAID ONLY WHEN THE PICK MAKES THE RECORD PAID. A late line that part-fills leaves the
 * expense Reconciliation Pending, so "Confirm → Paid" would promise an outcome the server will not
 * write. Everything that is not a part-linked expense keeps today's label.
 */
export const decideConfirmLabel = (record: SettleableRecord | null | undefined, lineAmount: number): string => {
    const cell = record ? decideAmountCell(record, lineAmount) : null;
    return cell && cell.mark.kind === "fits" ? "Confirm → Link to expense" : "Confirm → Paid";
};

// --- the bulk id ------------------------------------------------------------------------------------

/**
 * Mirrors `expense_links._BULK_ID` / `bulk_id_of`; `linkLinesParity.test.ts` reads the Python.
 * ⚠️ THE `g` FLAG MAKES THIS STATEFUL; it is only ever used through `String.match`, which resets it.
 */
const BULK_ID = /\bBULD\d+\b/g;

/**
 * The one bulk id every narration carries, or `null` -- the same answer `expense_links.bulk_id_of`
 * gives the write. A truncated repeat of the id on one line (`/BULD67`) is that line's stub, not a
 * second run.
 */
export const bulkIdOf = (texts: string[]): string | null => {
    const found = new Set<string>();
    for (const text of texts) {
        const all = new Set((text ?? "").match(BULK_ID) ?? []);
        const ids = [...all].filter((id) => ![...all].some((other) => other !== id && other.startsWith(id)));
        if (ids.length !== 1) return null;
        found.add(ids[0]);
    }
    return found.size === 1 ? [...found][0] : null;
};
