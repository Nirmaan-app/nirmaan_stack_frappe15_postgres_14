// src/pages/outflow-import/porterDiscard.ts
//
// A Porter import's re-upload figure and its Discard (#1447, ADR-0032), as pure data. No React, no fetch.
// `PorterDiscardButton` and `PorterImportSummary` render it; `porterDiscard.test.ts` pins it.

import type { PorterStatus } from "./porterImport";
import { plural } from "./plural";

export const PORTER_DISCARD_METHOD = "nirmaan_stack.api.outflow_import.porter_discard.discard_porter_import";

/**
 * Discard is offered to an Admin or Accountant Lead (`canUndo`, the undo-access check) on an import Create
 * has written nothing to — `discardable`, the server's own verdict — and not while the Create job runs.
 * A Validating import qualifies: Discard is the way out of one whose check never finished. The server
 * asks every rule again, and also refuses while a validation job is still running.
 */
export const canDiscardPorter = (
    status: Pick<PorterStatus, "state" | "create_running" | "discardable">,
    canUndo: boolean,
): boolean => canUndo && status.discardable === true && !status.create_running;

/** The confirmation: the import, what goes with it, and that the statement can be uploaded again. */
export const discardConfirmation = (status: { batch: string; orders: number; invoices: unknown[] }): string => {
    const invoices = status.invoices.length;
    return (
        `Discard ${status.batch}? This deletes its ${plural(status.orders, "order", "orders")}, ` +
        `its ${plural(invoices, "Porter invoice", "Porter invoices")} and ${invoices === 1 ? "its PDF" : "their PDFs"}. ` +
        "Nothing was created from it, so nothing else changes. You can upload the statement again afterwards."
    );
};

/**
 * The orders this upload left out because their invoices were already created (`repeats_not_saved`, the
 * batch's ADR-0031 figure). Null when none were.
 */
export const repeatsLeftOutNote = (count: number | null | undefined): string | null => {
    if (!count) return null;
    return count === 1
        ? "1 order on an invoice already created was left out: it is not saved again."
        : `${count} orders on invoices already created were left out: they are not saved again.`;
};
