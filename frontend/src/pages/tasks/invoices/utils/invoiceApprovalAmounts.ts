/**
 * What the invoice approval screen shows about an invoice's base / GST / total and, on a
 * GST-on Work Order, how much GST approving it opens up. ADR-0030; glossary: CONTEXT.md,
 * "Invoice amounts" and "GST Invoiced".
 *
 * The GST figure is computed on the server (`api/invoices/gst_release.get_invoice_gst_release`,
 * rule in `services/work_order_gst.py`); this module only words it.
 */

/** Shape returned by `get_invoice_gst_release`. */
export interface GstRelease {
    applies: boolean;
    invoice_gst: number;
    gst_invoiced: number;
    work_order_gst: number;
    opens_up: number;
}

const parseRaw = (value: string | number | null | undefined): number | null => {
    if (value === undefined || value === null) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    // OCR values can carry commas / currency symbols ("3,257.00", "₹ 540").
    const cleaned = String(value).replace(/[^\d.-]/g, "");
    if (!cleaned) return null;
    const n = parseFloat(cleaned);
    return Number.isNaN(n) ? null : n;
};

/**
 * An AI-read figure: the dedicated `autofill_extracted_*` column when it holds a figure,
 * else the raw extraction entity (older invoices have only that). The Currency column reads
 * back 0 when never written, so a 0 there defers to the entity; null = not extracted.
 */
export const aiReadFigure = (
    dedicated: number | string | null | undefined,
    entityValue: string | undefined,
): number | null => {
    const fromColumn = parseRaw(dedicated);
    if (fromColumn) return fromColumn;
    return parseRaw(entityValue);
};

export const rupees = (n: number): string =>
    `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The one GST line on the approval screen, or null when it does not apply. */
export const gstReleaseLine = (release: GstRelease | null | undefined): string | null => {
    if (!release?.applies) return null;
    const x = release.opens_up;
    if (x < 0) {
        return `This approval takes back ${rupees(-x)} of GST that could be paid.`;
    }
    const line = `This approval opens up ${rupees(x)} of GST`;
    if (x > 0) return `${line}.`;
    if (release.invoice_gst <= 0) return `${line} (no GST entered on this invoice).`;
    return `${line}: the Work Order's own GST of ${rupees(release.work_order_gst)} is already fully invoiced.`;
};
