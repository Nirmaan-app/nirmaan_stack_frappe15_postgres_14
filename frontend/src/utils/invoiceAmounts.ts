/**
 * The three figures on a Vendor Invoice: Invoice Base Amount, Invoice GST Amount and
 * Invoice Amount (total incl. GST). ADR-0030; glossary: CONTEXT.md, "Invoice amounts".
 *
 * Server twin: `nirmaan_stack/services/invoice_amounts.py`. The server is the real
 * boundary (it refuses a create without the split, signs a credit note and returns the
 * same two warnings); these helpers only let the dialog say so before a round-trip.
 */

/** ₹ gap allowed between base + GST and the Invoice Amount before a warning shows. */
export const INVOICE_SPLIT_TOLERANCE = 5;

export const BASE_LABEL = "Invoice Base Amount";
export const GST_LABEL = "Invoice GST Amount";

/** A typed figure as a number, or null when blank / unreadable. 0 is a figure. */
export const parseFigure = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/,/g, "").trim();
  if (!text || text === "-" || text === ".") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

/** Labels of the split figures still blank, in form order ([] when both are filled). */
export const missingSplitLabels = (base: string, gst: string): string[] =>
  [
    [BASE_LABEL, base],
    [GST_LABEL, gst],
  ]
    .filter(([, value]) => parseFigure(value) === null)
    .map(([label]) => label);

export interface SplitMismatch {
  splitTotal: number;
  gap: number;
}

/** A figure as it will be stored: negative on a credit note, as typed otherwise. */
export const signedFigure = (value: string, isCreditNote: boolean): number | null => {
  const n = parseFigure(value);
  if (n === null || !isCreditNote) return n;
  return -Math.abs(n);
};

/**
 * Base + GST more than INVOICE_SPLIT_TOLERANCE away from the total, or null -- judged on
 * the figures as they will be stored (a credit note's are all negative), like the server.
 * A split never entered (blank, or 0 / 0) is not a mismatch.
 */
export const splitMismatch = (
  amount: string,
  base: string,
  gst: string,
  isCreditNote = false,
): SplitMismatch | null => {
  const a = signedFigure(amount, isCreditNote);
  const b = signedFigure(base, isCreditNote);
  const g = signedFigure(gst, isCreditNote);
  if (a === null || b === null || g === null || (b === 0 && g === 0)) return null;
  const splitTotal = b + g;
  const gap = Math.abs(splitTotal - a);
  return gap > INVOICE_SPLIT_TOLERANCE ? { splitTotal, gap } : null;
};

/** A bill showing GST on a Work Order whose GST flag is off (Work Orders have no credit notes). */
export const gstOnGstOffWorkOrder = (gst: string, workOrderGstOff: boolean): boolean => {
  const g = parseFigure(gst);
  return workOrderGstOff && g !== null && g > 0;
};

/**
 * The split as the edit form should show it. The Currency columns read back 0 when the
 * split was never entered, so 0 / 0 shows blank rather than claiming a zero bill.
 */
export const splitForEditForm = (
  base: number | null | undefined,
  gst: number | null | undefined,
): { base: string; gst: string } => {
  const b = Number(base) || 0;
  const g = Number(gst) || 0;
  if (b === 0 && g === 0) return { base: "", gst: "" };
  return { base: String(b), gst: String(g) };
};
