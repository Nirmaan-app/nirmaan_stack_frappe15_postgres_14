/**
 * The Generate Invoice form's pure rules, for a GST-off Work Order (#1546; GLOSSARY *Generated invoice*).
 *
 * The server decides every figure (`nirmaan_stack/api/service_requests/generated_invoices.py`); these only
 * preview it. `isFinalAmount` mirrors `services/wo_generated_invoices.is_final`, pinned by the cases both
 * sides' tests read from `generatedInvoiceFinalCases.json` (F1).
 */

/** How far short of the WO amount the invoices may stop and the last one still be the FINAL (server: `FULLY_PAID_TOLERANCE`). */
export const FINAL_TOLERANCE = 10;

/** Whether an invoice of `amount` would be saved as the FINAL: with `billed` it reaches the WO amount, to within ₹10. */
export const isFinalAmount = (woAmount: number, billed: number, amount: number): boolean =>
  billed + amount >= woAmount - FINAL_TOLERANCE;

/** n rounded to 2 decimals, without trailing zeros: 420000 -> "420000", 33.3333 -> "33.33". */
const toTwoDecimals = (n: number): string => String(Math.round(n * 100) / 100);

/** Percentage and Amount after one of them is typed: the other follows through the WO amount. */
export const syncPercentAmount = (
  field: "percent" | "amount",
  value: string,
  woAmount: number
): { amount: string; percent: string } => {
  const n = Number(value);
  const canSync = value !== "" && Number.isFinite(n) && woAmount > 0;
  return field === "percent"
    ? { percent: value, amount: canSync ? toTwoDecimals((woAmount * n) / 100) : "" }
    : { amount: value, percent: canSync ? toTwoDecimals((n / woAmount) * 100) : "" };
};

/**
 * The extra line a Vendor Invoice's delete confirmation shows when its delete takes a generated invoice
 * with it (the signed upload's invoice; `controllers/vendor_invoices.delete_generated_invoice_with_it`).
 */
export const generatedInvoiceDeleteNote = (
  generated: { vendor_invoice?: string | null; invoice_no: string }[],
  vendorInvoice: string
): string | undefined => {
  const record = generated.find((g) => g.vendor_invoice === vendorInvoice);
  return record ? `This also deletes generated invoice ${record.invoice_no}.` : undefined;
};
