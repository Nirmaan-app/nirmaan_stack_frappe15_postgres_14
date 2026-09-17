// src/pages/outflow-import/skipSourceView.ts
//
// What the Skipped popup's Skip Type cell says about the document behind a skip (owner, 2026-09-17).
// Pure: no React. `SkipTypeCell` renders it; `skipSourceView.test.ts` pins it.

import type { OutflowImportRow, SkipSourceRecord } from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { outcomeNoteOf } from "./outflowTableModel";
import {
    SKIP_KIND_ALREADY_IMPORTED,
    SKIP_KIND_BANK_REFUSED,
    SKIP_KIND_BY_HAND,
    SKIP_KIND_INFLOW_RECORDED,
    SKIP_KIND_NO_AMOUNT,
    SKIP_KIND_OUTFLOW_RECORDED,
    SKIP_KIND_REPEATED_IN_FILE,
} from "./skipKinds";

export interface SkipFact {
    label: string;
    value: string;
}

export interface SkipFactGroup {
    /** Names the document, e.g. "Project Payment PAY-1" or "Import OFI-26-00007". Blank for none. */
    title: string;
    facts: SkipFact[];
}

export interface SkipSourceSummary {
    /** One short line under the kind in the cell: the document reference. `""` when there is none. */
    reference: string;
    /** The hover card's body, in order. The reason sentence is always the last group. */
    groups: SkipFactGroup[];
}

/** Singular ledger names, as a reviewer reads one record. */
const LEDGER_SINGULAR: Record<string, string> = {
    "Project Payments": "Project Payment",
    "Project Expenses": "Project Expense",
    "Non Project Expenses": "Non-Project Expense",
    "Project Inflows": "Project Inflow",
    "Non Project Inflows": "Non-Project Inflow",
};

// Dates arrive as "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS"; the screen shows dd-MMM-yyyy.
const day = (value: string | null | undefined): string => {
    const date = (value ?? "").split(/[ T]/)[0];
    return date ? formatDate(date) : "";
};

// A fact with no value is left out rather than shown as a dash: the card lists what is known.
const facts = (...pairs: [string, string | null | undefined][]): SkipFact[] =>
    pairs
        .map(([label, value]) => ({ label, value: (value ?? "").trim() }))
        .filter((fact) => fact.value);

/**
 * ⚠️ AN EXPENSE IS NAMED BY ITS DESCRIPTION, NOT ITS ID. Both expense doctypes autoname with a random
 * hash that no screen can search by (the same reason `status._DESCRIBED_LEDGERS` describes them).
 */
const recordTitle = (record: SkipSourceRecord): string => {
    const noun = LEDGER_SINGULAR[record.doctype] ?? record.doctype;
    const isExpense = record.doctype.endsWith("Expenses");
    return `${noun} ${isExpense && record.description ? record.description : record.name}`;
};

const recordGroup = (record: SkipSourceRecord): SkipFactGroup => ({
    title: recordTitle(record),
    facts: facts(
        ["Amount", formatToRoundedIndianRupee(record.amount)],
        ["Status", record.status],
        ["Date", day(record.date)],
        ["Project", record.project],
        ["Party", record.party],
        ["Reference", record.reference],
    ),
});

/**
 * The reference line and hover body for one Skipped row, chosen by its Skip Type.
 *
 * ⚠️ A MISSING DOCUMENT IS NOT AN ERROR. The server finds it through the same lookups the skip was
 * decided with, but a batch can be deleted or a record renamed since. The card then shows only the
 * reason sentence, which the software wrote at the time and always names what it found.
 */
export const skipSourceSummary = (row: OutflowImportRow): SkipSourceSummary => {
    const source = row.skip_source;
    const kind = (row.skip_kind ?? "").trim();
    const reason = outcomeNoteOf(row);
    const groups: SkipFactGroup[] = [];
    let reference = "";

    if (kind === SKIP_KIND_ALREADY_IMPORTED && source?.earlier_import) {
        const earlier = source.earlier_import;
        reference = `In ${earlier.name}`;
        const period = [day(earlier.period_from), day(earlier.period_to)].filter(Boolean).join(" to ");
        groups.push({
            title: `Import ${earlier.name}`,
            facts: facts(
                ["File", earlier.filename],
                ["Source", earlier.source],
                ["Period", period],
                ["Uploaded by", earlier.uploaded_by],
                ["Uploaded on", day(earlier.uploaded_at)],
            ),
        });
    } else if (kind === SKIP_KIND_REPEATED_IN_FILE && source?.earlier_line) {
        const earlier = source.earlier_line;
        reference = `Same as ${earlier.reference || earlier.name}`;
        groups.push({
            title: `Line ${earlier.name}`,
            facts: facts(
                ["Date", day(earlier.added_on)],
                ["Amount", formatToRoundedIndianRupee(earlier.amount)],
                ["Reference", earlier.reference],
                ["Status", earlier.row_status],
            ),
        });
    } else if ((kind === SKIP_KIND_OUTFLOW_RECORDED || kind === SKIP_KIND_INFLOW_RECORDED) && source?.records?.length) {
        const titles = source.records.map(recordTitle);
        reference = titles.length === 1 ? titles[0] : `${titles[0]} +${titles.length - 1} more`;
        groups.push(...source.records.map(recordGroup));
    } else if (kind === SKIP_KIND_BANK_REFUSED) {
        const status = (row.status_raw ?? "").trim();
        reference = status ? `Bank status: ${status}` : "";
        groups.push({ title: "", facts: facts(["Bank status", status || "none given"]) });
    } else if (kind === SKIP_KIND_BY_HAND) {
        reference = [row.decided_by, day(row.decided_at)].filter(Boolean).join(" · ");
        groups.push({
            title: "",
            facts: facts(["By", row.decided_by], ["On", day(row.decided_at)]),
        });
    } else if (kind === SKIP_KIND_NO_AMOUNT) {
        groups.push({ title: "", facts: facts(["Amount", "Nothing was debited"]) });
    }

    if (source?.rule) {
        groups.push({ title: "", facts: facts(["Rule", source.rule]) });
    }
    if (reason) {
        groups.push({ title: "", facts: facts([kind === SKIP_KIND_BY_HAND ? "Reason" : "Why", reason]) });
    }

    return { reference, groups: groups.filter((g) => g.title || g.facts.length) };
};
