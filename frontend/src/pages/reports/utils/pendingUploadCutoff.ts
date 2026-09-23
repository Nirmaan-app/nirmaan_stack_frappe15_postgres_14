/**
 * The financial-year cutoff applied ONLY under Invoice Reconciliation > Pending
 * Invoices Upload.
 *
 * One home for the rule, shared by the PO and WO report bodies, so the two halves of
 * that tab can never disagree about where the year starts (ADR-0010 F1). The Reports
 * page passes `pendingUploadMode = false` -- i.e. never calls this at all -- and keeps
 * showing every year, by owner ruling.
 *
 * Applied to the FINISHED row set rather than to the fetch: both screens share one
 * cached superset, so narrowing the query would narrow the Reports page too. The
 * payload is therefore unchanged; only what is displayed differs.
 */
import { PENDING_UPLOAD_CREATION_FROM } from "../constants";

/** Frappe stores `creation` as "YYYY-MM-DD HH:MM:SS", which orders correctly against
 *  the bare "YYYY-MM-DD" cutoff, so no date parsing is needed (or wanted -- parsing
 *  would drag the browser's timezone into a business-calendar comparison). A row with
 *  no `creation` cannot be shown to be in the year, so it is excluded. */
export const isOnOrAfterPendingUploadCutoff = (creation?: string | null): boolean =>
    !!creation && creation >= PENDING_UPLOAD_CREATION_FROM;

/** Pass-through when not in pending-upload mode -- the Reports page keeps every row. */
export const applyPendingUploadCutoff = <T extends { creation?: string | null }>(
    rows: T[],
    pendingUploadMode: boolean
): T[] =>
    pendingUploadMode
        ? rows.filter((row) => isOnOrAfterPendingUploadCutoff(row.creation))
        : rows;
