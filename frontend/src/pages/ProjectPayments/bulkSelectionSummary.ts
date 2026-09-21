/**
 * What a bulk selection on the unified approval queue is MADE OF, and what to call it.
 *
 * PURE — no React, no SDK. The bulk bar, the confirm dialog and its group headers all
 * read the same answer, so the toast cannot say "8 payments" over a dialog listing
 * eight expenses. That is exactly what it did before this existed: every string on
 * the bulk path was hardcoded to "payment" while the queue had already been widened
 * to all three money-out ledgers.
 */

import { ApprovalQueueRow } from "./config/approvalsTable.config";

export type LedgerRow = Pick<ApprovalQueueRow, "source">;

export interface SelectionMix {
  total: number;
  payments: number;
  projectExpenses: number;
  nonProjectExpenses: number;
  /** Both expense ledgers together — what the expense bulk endpoint receives. */
  expenses: number;
}

export const summarizeSelection = (rows: readonly LedgerRow[]): SelectionMix => {
  let payments = 0;
  let projectExpenses = 0;
  let nonProjectExpenses = 0;
  for (const r of rows) {
    if (r.source === "Project Expense") projectExpenses += 1;
    else if (r.source === "Non-Project") nonProjectExpenses += 1;
    else payments += 1;
  }
  return {
    total: rows.length,
    payments,
    projectExpenses,
    nonProjectExpenses,
    expenses: projectExpenses + nonProjectExpenses,
  };
};

/**
 * The word for one row of this selection.
 *
 * A MIXED selection is called a "request", not a "payment": it is the one word that
 * is true of every row without claiming a ledger. Naming the majority ledger would
 * be worse than a neutral word — it would be confidently wrong for the rest.
 */
export const selectionNoun = (mix: SelectionMix): string => {
  if (mix.total === 0) return "request";
  if (mix.expenses === 0) return "payment";
  if (mix.payments === 0) return "expense";
  return "request";
};

/** `3 payments` / `1 expense` — the noun already agreeing with the count. */
export const countLabel = (mix: SelectionMix, count: number = mix.total): string =>
  `${count} ${selectionNoun(mix)}${count !== 1 ? "s" : ""}`;

/**
 * The dialog's dense second line: what the selection spans, in the units a reader
 * can act on. Parts that are zero are OMITTED rather than printed — "0 PO/SR" on an
 * all-expense batch is noise that reads like a missing value.
 */
export const selectionBreakdown = (mix: SelectionMix, poSrCount: number): string => {
  const parts: string[] = [];
  if (poSrCount > 0) parts.push(`${poSrCount} PO/SR`);
  if (mix.projectExpenses > 0) {
    parts.push(`${mix.projectExpenses} project expense${mix.projectExpenses !== 1 ? "s" : ""}`);
  }
  if (mix.nonProjectExpenses > 0) {
    parts.push(
      `${mix.nonProjectExpenses} non-project expense${mix.nonProjectExpenses !== 1 ? "s" : ""}`
    );
  }
  return parts.join(" · ");
};

/**
 * The line under a LEAD bulk approve naming what goes to the CEO next instead of finishing.
 * `""` when nothing does. Every ledger counts -- PO payments, work order payments and both expense
 * ledgers all forward above the CEO line (owner, 2026-09-19) -- and only the work order part has
 * tax, so TDS is mentioned for those alone. `tdsCount` is how many of the forwarded rows carry a
 * TDS forecast (`forecastTdsTotals(...).count`); `ceoLine` is the formatted line, e.g. "₹50,000".
 */
export const forwardedToCeoNote = (
  rows: readonly Pick<ApprovalQueueRow, "source" | "source_type">[],
  ceoLine: string,
  tdsCount: number
): string => {
  if (rows.length === 0) return "";
  const plural = (n: number, noun: string) => `${n} ${noun}${n !== 1 ? "s" : ""}`;
  const count = (pred: (r: (typeof rows)[number]) => boolean) => rows.filter(pred).length;
  const parts = [
    [count((r) => r.source_type === "PO Payment"), "PO payment"],
    [count((r) => r.source_type === "SR Payment"), "work order payment"],
    [count((r) => r.source === "Vendor Payment" && r.source_type !== "PO Payment" && r.source_type !== "SR Payment"), "payment"],
    [count((r) => r.source === "Project Expense"), "project expense"],
    [count((r) => r.source === "Non-Project"), "non-project expense"],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, noun]) => plural(n as number, noun as string));

  const verb = rows.length === 1 ? "goes" : "go";
  const head =
    parts.length === 1
      ? `${parts[0]} above ${ceoLine} ${verb} to the CEO next.`
      : `${countLabel(summarizeSelection(rows), rows.length)} above ${ceoLine} ${verb} to the CEO next: ${parts.join(", ")}.`;
  const tds = tdsCount > 0 ? ` TDS on ${plural(tdsCount, "work order payment")} is taken at CEO approval.` : "";
  return head + tds;
};
