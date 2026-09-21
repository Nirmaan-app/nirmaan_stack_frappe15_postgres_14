/**
 * Pure display rules for the PO / WO payment summary (owner, 2026-09-21).
 *
 * The FIGURES come from the server (`api/payments/payment_summary.get_payment_summary`, built on
 * `services/payment_summary.py`), whose "left" is exactly the Request Payment cap's balance. This
 * module only decides how they read: labels, which lines show, the "other payment waiting" alert,
 * and "left after this payment".
 */

export type SummaryLineKey =
  | "paid"
  | "reconciliation_pending"
  | "approved"
  | "ceo_pending"
  | "requested"
  | "rejected";

export interface SummaryPayment {
  name: string;
  amount: number;
  gross_amount: number;
  status: string;
  creation: string | null;
  raised_by: string | null;
  raised_by_name: string | null;
  mode_of_payment?: string | null;
}

export interface PaymentSummary {
  document_type: "Procurement Orders" | "Service Requests";
  document_name: string;
  value_basis: "incl_gst" | "ex_gst" | "total";
  line_order: SummaryLineKey[];
  value: number;
  lines: Record<SummaryLineKey, number>;
  committed: number;
  left: number;
  payments: SummaryPayment[];
}

/** Display order, server-independent: money that has left, money on its way, money held. */
export const LINE_ORDER: SummaryLineKey[] = [
  "paid",
  "reconciliation_pending",
  "approved",
  "ceo_pending",
  "requested",
  "rejected",
];

export const LINE_LABEL: Record<SummaryLineKey, string> = {
  paid: "Paid",
  reconciliation_pending: "Paid, not yet reconciled",
  approved: "Approved, waiting to be paid",
  ceo_pending: "Waiting for CEO",
  requested: "Waiting for L1",
  rejected: "Rejected, not yet deleted",
};

/** A status as the "Other payments" list shows it. */
export const STATUS_LABEL: Record<string, string> = {
  Paid: "Paid",
  "Reconciliation Pending": "Paid, not reconciled",
  Approved: "Approved",
  "CEO Pending": "Waiting for CEO",
  Requested: "Waiting for L1",
  Rejected: "Rejected",
};

/** Statuses that are still WAITING to become money out — what the alert line is about. */
const WAITING_STATUSES = ["Approved", "CEO Pending", "Requested"];

export const orderNoun = (documentType: string) =>
  documentType === "Service Requests" ? "WO" : "PO";

export const valueLabel = (summary: Pick<PaymentSummary, "document_type" | "value_basis">): string => {
  const noun = orderNoun(summary.document_type);
  if (summary.value_basis === "ex_gst") return `${noun} base amount (ex-GST)`;
  if (summary.value_basis === "incl_gst") return `${noun} value (incl. GST)`;
  return `${noun} value`;
};

/**
 * The lines to show, in order. A ₹0 line is left out — the tax rows in the approve dialog follow
 * the same rule, because a column of zeroes teaches people to stop reading the panel.
 */
export const visibleLines = (lines: Partial<Record<SummaryLineKey, number>>) =>
  LINE_ORDER.filter((key) => Math.abs(Number(lines[key] || 0)) >= 0.005).map((key) => ({
    key,
    label: LINE_LABEL[key],
    amount: Number(lines[key] || 0),
  }));

/** "Left after this payment": the cap's balance less the figure being approved or requested. */
export const leftAfter = (left: number, thisAmount: number) =>
  Math.round((Number(left || 0) - Number(thisAmount || 0)) * 100) / 100;

/** The other payments on the order still waiting to become money out, newest first. */
export const waitingPayments = (payments: SummaryPayment[]) =>
  payments.filter((p) => WAITING_STATUSES.includes((p.status || "").trim()));

/** Percent widths for the bar: [settled, on its way, this payment, left]. Never negative. */
export const barSegments = (
  lines: Partial<Record<SummaryLineKey, number>>,
  value: number,
  thisAmount: number
) => {
  const settled = Math.max(0, Number(lines.paid || 0) + Number(lines.reconciliation_pending || 0));
  const onItsWay = Math.max(
    0,
    Number(lines.approved || 0) +
      Number(lines.ceo_pending || 0) +
      Number(lines.requested || 0) +
      Number(lines.rejected || 0)
  );
  const current = Math.max(0, Number(thisAmount || 0));
  const total = Math.max(Number(value || 0), settled + onItsWay + current);
  if (total <= 0) return { settled: 0, onItsWay: 0, current: 0, left: 0 };
  const pct = (n: number) => Math.round((n / total) * 10000) / 100;
  const left = Math.max(0, total - settled - onItsWay - current);
  return { settled: pct(settled), onItsWay: pct(onItsWay), current: pct(current), left: pct(left) };
};
