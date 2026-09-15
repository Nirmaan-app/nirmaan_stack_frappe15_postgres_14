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
