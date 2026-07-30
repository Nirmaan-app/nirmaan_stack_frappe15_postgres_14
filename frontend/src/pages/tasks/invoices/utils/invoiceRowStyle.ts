/**
 * Row highlighting for the Vendor Invoice reconciliation tables.
 *
 * A Pending invoice older than INVOICE_AGING_RED_DAYS is tinted red — it has
 * been sitting unreviewed too long. Lives here as a pure function (ADR-0010 F4)
 * so PendingTasksTable and TaskHistoryTable share ONE definition and cannot
 * drift; it also makes the rule unit-testable, which it would not be inside a
 * component (this repo's vitest is node-env, no DOM).
 *
 * REPLACED the previous CEO-Hold row tint on these two tables (2026-07-27,
 * owner decision). Row background is a single binary channel and it now belongs
 * to aging. `CEO_HOLD_ROW_CLASSES` / `useCEOHoldProjects` are untouched and
 * still used by 30+ other pages — only this screen stopped consuming them.
 */
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";

/**
 * Age in days at which a still-Pending invoice turns red.
 *
 * Named so it can be retuned after watching it live without hunting through
 * component code. Note the real-data caveat this shipped with: on the current
 * backlog effectively every pending invoice is already past this threshold, so
 * the tint reads as "the queue is stale" rather than "this row is unusual"
 * until the backlog is worked down.
 */
export const INVOICE_AGING_RED_DAYS = 3;

/** Tailwind classes for an aged, still-unreviewed invoice row. */
export const INVOICE_AGED_ROW_CLASSES =
    "bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/50";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days elapsed between `createdAt` and `now`.
 *
 * Returns null when the timestamp is missing or unparseable — an unknown age is
 * NOT an old age, so such a row stays untinted rather than being wrongly
 * flagged. Frappe emits `creation` as "YYYY-MM-DD HH:mm:ss.ffffff", which
 * Safari's Date parser rejects, so the space is normalised to "T" first.
 */
export const invoiceAgeInDays = (
    createdAt: string | undefined | null,
    now: Date = new Date()
): number | null => {
    if (!createdAt) return null;
    const normalized = String(createdAt).trim().replace(" ", "T");
    const created = new Date(normalized);
    if (Number.isNaN(created.getTime())) return null;
    return Math.floor((now.getTime() - created.getTime()) / MS_PER_DAY);
};

/**
 * True when this invoice is still Pending AND was created more than
 * INVOICE_AGING_RED_DAYS ago.
 *
 * Gated on status because the history table also lists Approved and Rejected
 * rows, where age carries no meaning — an invoice approved three weeks ago is
 * simply done, not overdue.
 */
export const isAgedPendingInvoice = (
    invoice: Pick<VendorInvoice, "status" | "creation">,
    now: Date = new Date()
): boolean => {
    if (invoice?.status !== "Pending") return false;
    const age = invoiceAgeInDays(invoice.creation, now);
    return age !== null && age > INVOICE_AGING_RED_DAYS;
};

/**
 * `getRowClassName` body for both invoice tables. Returns undefined (not an
 * empty string) when the row needs no tint, matching the DataTable contract.
 */
export const invoiceRowClassName = (
    invoice: Pick<VendorInvoice, "status" | "creation">,
    now: Date = new Date()
): string | undefined =>
    isAgedPendingInvoice(invoice, now) ? INVOICE_AGED_ROW_CLASSES : undefined;
