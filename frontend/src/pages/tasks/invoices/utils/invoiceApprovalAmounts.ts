/**
 * What the invoice approval screen shows about an invoice's base / GST / total and, on a
 * GST-on Work Order, how much GST approving it opens up. ADR-0030; glossary: CONTEXT.md,
 * "Invoice amounts" and "GST Invoiced".
 *
 * The GST figure is computed on the server (`api/invoices/gst_release.get_invoice_gst_release`,
 * rule in `services/work_order_gst.py`); this module only words it.
 */

import { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";
import { parseReadFigure } from "@/utils/invoiceAmounts";

/** Shape returned by `get_invoice_gst_release`. */
export interface GstRelease {
    applies: boolean;
    invoice_gst: number;
    gst_invoiced: number;
    work_order_gst: number;
    opens_up: number;
}

/**
 * An AI-read figure: the dedicated `autofill_extracted_*` column when it holds a figure,
 * else the raw extraction entity (older invoices have only that). The Currency column reads
 * back 0 when never written, so a 0 there defers to the entity; null = not extracted.
 */
export const aiReadFigure = (
    dedicated: number | string | null | undefined,
    entityValue: string | undefined,
): number | null => {
    const fromColumn = parseReadFigure(dedicated);
    if (fromColumn) return fromColumn;
    return parseReadFigure(entityValue);
};

/** The one GST line on the approval screen, or null when it does not apply. */
export const gstReleaseLine = (release: GstRelease | null | undefined): string | null => {
    if (!release?.applies) return null;
    const x = release.opens_up;
    if (x < 0) {
        return `This approval takes back ${formatToIndianRupeeOrZero(-x)} of GST that could be paid.`;
    }
    const line = `This approval opens up ${formatToIndianRupeeOrZero(x)} of GST`;
    if (x > 0) return `${line}.`;
    if (release.invoice_gst <= 0) return `${line} (no GST entered on this invoice).`;
    return `${line}: the Work Order's own GST of ${formatToIndianRupeeOrZero(release.work_order_gst)} is already fully invoiced.`;
};
