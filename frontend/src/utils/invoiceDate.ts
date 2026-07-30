/**
 * Future-invoice-date rule — the client half of the hard block enforced by
 * `_check_invoice_date_not_future` in
 * `nirmaan_stack/api/delivery_notes/update_invoice_data.py`.
 *
 * An invoice can never be dated after today. The SERVER is the authoritative
 * boundary (it runs on Asia/Kolkata); this module exists so the Submit button
 * can refuse before a round-trip, and so the date input's `max` attribute and
 * the submit gate share ONE definition of "today" instead of drifting.
 *
 * ADR-0010 F1: the rule has one home on each side, pinned to its backend twin.
 */

/**
 * Today (or any Date) as `YYYY-MM-DD` in the BROWSER'S LOCAL timezone.
 *
 * Deliberately NOT `toISOString().split("T")[0]`, which returns the *UTC* date.
 * Between 00:00 and 05:30 IST the UTC date is still yesterday, so a `max` built
 * from it would reject an invoice legitimately dated today. Local-time
 * construction also matches the server, which evaluates `getdate(today())`
 * under Asia/Kolkata.
 */
export const toLocalDateString = (d: Date = new Date()): string => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

/**
 * True when `dateStr` is strictly after today.
 *
 * Returns FALSE for empty input (emptiness is the separate required-field
 * concern) and for anything that isn't a `YYYY-MM-DD` prefix — an unparseable
 * date is not a *future* date, and the server's stricter parse is what should
 * reject it. Comparison is lexicographic, which is exact for zero-padded
 * ISO dates.
 */
export const isFutureInvoiceDate = (
    dateStr: string | undefined | null,
    now: Date = new Date()
): boolean => {
    if (!dateStr) return false;
    const value = String(dateStr).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    return value > toLocalDateString(now);
};

/** Inline error copy, shared by every surface that gates on the rule. */
export const FUTURE_INVOICE_DATE_MESSAGE =
    "Invoice date cannot be in the future.";
