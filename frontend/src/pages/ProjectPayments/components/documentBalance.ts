import { parseNumber } from "@/utils/parseNumber";

/** The money fields the PO / WO detail popover reads off the document. */
export interface DocumentMoney {
  total_amount?: number | string | null;
  amount_paid?: number | string | null;
  amount_due?: number | string | null;
}

/**
 * The detail popover's "Balance" (#1511).
 *
 * A Work Order's is its stored Amount Due (`total_amount - amount_paid`, where Amount Paid holds the
 * TDS withheld from the vendor, ADR-0034 Amendment A), read as it is: the server owns that rule.
 * A Purchase Order's stored Amount Due is against what was invoiced, so its Balance stays the PO
 * value less its Amount Paid.
 */
export const documentBalance = (docType: string, doc: DocumentMoney | undefined): number => {
  if (!doc) return 0;
  if (docType === "Service Requests") return parseNumber(doc.amount_due);
  return parseNumber(doc.total_amount) - parseNumber(doc.amount_paid);
};
