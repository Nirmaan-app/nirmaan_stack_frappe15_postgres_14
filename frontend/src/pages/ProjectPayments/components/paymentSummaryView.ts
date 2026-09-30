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

/**
 * A Work Order's payment limit (ADR-0030), from `services/work_order_payment_limit.py`. Every figure
 * is the server's; the dialog shows them and never re-derives one.
 */
export interface WorkOrderLimit {
  gst_on: boolean;
  base_value: number;
  work_order_gst: number;
  gst_invoiced: number;
  /** min(GST Invoiced, Work Order GST): the GST that may be paid at all. */
  gst_released: number;
  base_paid: number;
  gst_paid: number;
  base_left: number;
  gst_left: number;
  total_left: number;
}

export type PayFor = "base" | "gst";

export interface PaymentSummary {
  document_type: "Procurement Orders" | "Service Requests";
  document_name: string;
  value_basis: "incl_gst" | "total";
  line_order: SummaryLineKey[];
  value: number;
  lines: Record<SummaryLineKey, number>;
  committed: number;
  left: number;
  payments: SummaryPayment[];
  /** Work Orders only. */
  limit?: WorkOrderLimit;
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

/**
 * What a request for one part of a GST-on Work Order is measured against: `value` for Full / %,
 * `max` for Due and the cap -- the part's own left, but never above total left, as the server's
 * `request_refusal` checks both. `capLabel` names whichever of the two binds.
 */
export const payForCap = (limit: WorkOrderLimit, payFor: PayFor) => {
  const partLeft = payFor === "gst" ? limit.gst_left : limit.base_left;
  const totalBinds = limit.total_left < partLeft;
  return {
    value: payFor === "gst" ? limit.gst_released : limit.base_value,
    max: Math.max(0, totalBinds ? limit.total_left : partLeft),
    capLabel: totalBinds ? "total left" : payFor === "gst" ? "GST left" : "Base left",
  };
};

/** Why GST left reads 0, or null while some is left. */
export const gstLeftNote = (limit: WorkOrderLimit): string | null => {
  if (limit.gst_left > 0) return null;
  return limit.gst_released <= 0
    ? "Opens when an invoice with GST is approved"
    : "All approved invoice GST is already requested";
};

/**
 * The most a new payment on a Work Order may be, as the server's limit checks it: the chosen part's
 * cap on a GST-on Work Order, otherwise what is left of its total. For the Accountant's paid entry,
 * which records a payment straight as Paid and has no Full / % / Due shortcuts.
 */
export const workOrderPaymentCap = (
  summary: Pick<PaymentSummary, "left" | "limit">,
  payFor: PayFor
): { max: number; capLabel: string } =>
  summary.limit?.gst_on
    ? payForCap(summary.limit, payFor)
    : { max: Math.max(0, summary.left), capLabel: "balance" };
