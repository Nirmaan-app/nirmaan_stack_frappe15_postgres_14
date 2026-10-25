// src/pages/outflow-import/porterPrecheck.ts
//
// The Porter Statement checked in the browser before it is uploaded (#1555, spec #1554). Pure: no React,
// no fetch. `ImportStatementDialog` renders it; `porterPrecheck.test.ts` pins it.
//
// ⚠️ THE SERVER PARSER STAYS THE AUTHORITY. This check only stops an obviously wrong file before anything
// is saved; the upload re-reads the whole file and its refusals still show. The required columns are NOT
// listed here: they are the parser's own `PORTER_STATEMENT_COLUMNS`, served by `PORTER_RULES_METHOD`.

import { parse } from "papaparse";
import { plural } from "./porterWords";

/**
 * Serves the parser's required columns, its completed-order status and the names of the columns counted by,
 * so the screen keeps no copy.
 */
export const PORTER_RULES_METHOD = "nirmaan_stack.api.outflow_import.porter.get_porter_statement_rules";

/** What `get_porter_statement_rules` answers. */
export interface PorterFileRules {
    /** Every column a Porter Statement must carry, Porter's own header names. */
    columns: string[];
    /** The `order_status` Porter writes on an order it completed; anything else is a Cancelled Porter order. */
    completed_status: string;
    /** The column holding each order's status (`order_status`). */
    status_column: string;
    /** The column holding when the order was completed (`order_completion_time`). */
    completed_at_column: string;
    /** The column holding the invoice PDF's link, one per invoice (`invoice_link`). */
    invoice_column: string;
}

export type PorterFileCheck =
    | {
          kind: "ok";
          /** How many of the required columns were found: all of them. */
          columns: number;
          orders: number;
          invoices: number;
          /** ISO dates of the first and last completed order; null when none could be read. */
          firstOrder: string | null;
          lastOrder: string | null;
          cancelled: number;
      }
    | { kind: "refused"; message: string; missing?: string[] }
    /** The rules could not be fetched: the file goes to the server unchecked, whose parser is the authority. */
    | { kind: "skipped"; message: string };

/** The one sentence a PDF or Excel file gets (story 7). */
export const PORTER_WRONG_TYPE = "A Porter statement is the CSV export, not PDF or Excel.";

/** Shown when the browser could not check the file (the rules did not load); the upload still may go. */
export const PORTER_CHECK_SKIPPED = "The file could not be checked here. Upload it and the server will check it.";

/** The upload may go once the file was accepted, or when the browser could not check it at all. */
export const porterUploadAllowed = (check: PorterFileCheck | null): boolean =>
    check?.kind === "ok" || check?.kind === "skipped";

/** Where the right file comes from (story 1), one step per line. */
export const PORTER_FILE_GUIDE: readonly string[] = [
    "Porter for Business → Statements",
    "Choose the month → Order statement",
    "Download as CSV (not PDF or Excel)",
];

/** Shown before upload (story 9). */
export const PORTER_BEFORE_UPLOAD_NOTE =
    "Uploading saves the file and starts the invoice check. No expense is created until you confirm in step 4.";

const DOWNLOAD_ADVICE = "Download the Order statement as CSV from Porter for Business and try again.";

/**
 * What the screen lists under an accepted file (stories 3-5), one line each. `date` formats an ISO date
 * for the screen.
 */
export const porterFileCheckLines = (
    check: Extract<PorterFileCheck, { kind: "ok" }>,
    date: (iso: string) => string,
): string[] => {
    const { firstOrder, lastOrder } = check;
    const when = !firstOrder || !lastOrder
        ? ""
        : firstOrder === lastOrder
          ? ` · orders on ${date(firstOrder)}`
          : ` · orders from ${date(firstOrder)} to ${date(lastOrder)}`;
    return [
        `All ${check.columns} Porter columns found`,
        `${plural(check.orders, "order", "orders")} on ${plural(check.invoices, "invoice", "invoices")}${when}`,
        check.cancelled === 0
            ? "No cancelled orders"
            : `${plural(check.cancelled, "cancelled order", "cancelled orders")} will be skipped`,
    ];
};

/** `2026-09-02T10:15:00` or `02/09/2026 10:15` as an ISO date; null when it is neither. */
const isoDate = (value: string): string | null => {
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    return null;
};

/**
 * Read a chosen file the way the upload will, and say whether it is a Porter Order statement.
 *
 * Refused: anything but a .csv (`PORTER_WRONG_TYPE`), a file missing any required column (named), and a
 * file with no orders. Accepted: the counts the Accountant checks against the month they meant. Skipped:
 * a .csv when `rules` is null because they could not be fetched.
 */
export const checkPorterFile = async (
    file: { name: string; text: () => Promise<string> },
    rules: PorterFileRules | null,
): Promise<PorterFileCheck> => {
    if (!file.name.toLowerCase().endsWith(".csv")) return { kind: "refused", message: PORTER_WRONG_TYPE };
    if (!rules) return { kind: "skipped", message: PORTER_CHECK_SKIPPED };

    const { data } = parse<string[]>((await file.text()).replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
    const header = (data[0] ?? []).map((cell) => (cell ?? "").trim());
    const missing = rules.columns.filter((column) => !header.includes(column));
    if (missing.length > 0) {
        const count = missing.length === 1 ? "1 column is" : `${missing.length} columns are`;
        return {
            kind: "refused",
            missing,
            message: `This isn't a Porter order statement. ${count} missing: ${missing.join(", ")}. ${DOWNLOAD_ADVICE}`,
        };
    }

    const at = (name: string) => header.indexOf(name);
    const rows = data.slice(1);
    if (rows.length === 0) return { kind: "refused", message: `This file has no orders. ${DOWNLOAD_ADVICE}` };

    const completed = rules.completed_status.toLowerCase();
    const invoices = new Set<string>();
    const dates: string[] = [];
    let cancelled = 0;
    for (const row of rows) {
        const cell = (name: string) => (row[at(name)] ?? "").trim();
        const invoice = cell(rules.invoice_column);
        if (invoice) invoices.add(invoice);
        if (cell(rules.status_column).toLowerCase() !== completed) {
            cancelled += 1;
            continue;
        }
        const date = isoDate(cell(rules.completed_at_column));
        if (date) dates.push(date);
    }
    dates.sort();
    return {
        kind: "ok",
        columns: rules.columns.length,
        orders: rows.length,
        invoices: invoices.size,
        firstOrder: dates[0] ?? null,
        lastOrder: dates[dates.length - 1] ?? null,
        cancelled,
    };
};
