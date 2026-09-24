/**
 * Where a PO / WO's money stands, shown inside the single Approve dialog and both Request Payment
 * dialogs (owner, 2026-09-21). One block, so the three dialogs always read and count the same.
 *
 * Figures: `api/payments/payment_summary.get_payment_summary` — its "left" IS the Request Payment
 * cap's balance. Wording and layout: the pure `paymentSummaryView.ts`.
 */
import { useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";

import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import {
  barSegments,
  leftAfter,
  orderNoun,
  PaymentSummary,
  STATUS_LABEL,
  valueLabel,
  visibleLines,
  waitingPayments,
} from "./paymentSummaryView";

const SUMMARY_API = "nirmaan_stack.api.payments.payment_summary.get_payment_summary";
const ORDER_DOCTYPES = ["Procurement Orders", "Service Requests"];

/**
 * The summary for one PO / WO. `excludePayment` is the payment being APPROVED, which the block
 * shows as "This payment" rather than inside its own status line. Pass no `documentName` to skip.
 */
export const usePaymentSummary = (
  documentType?: string | null,
  documentName?: string | null,
  excludePayment?: string | null
) => {
  const enabled = !!documentName && !!documentType && ORDER_DOCTYPES.includes(documentType);
  const { data, error, isLoading, mutate } = useFrappeGetCall<{ message: PaymentSummary }>(
    SUMMARY_API,
    enabled
      ? { document_type: documentType, document_name: documentName, exclude_payment: excludePayment || undefined }
      : undefined,
    enabled ? `payment-summary:${documentType}:${documentName}:${excludePayment || ""}` : null
  );
  return { summary: data?.message, error, isLoading: enabled && isLoading, mutate };
};

interface PaymentSummaryBlockProps {
  summary?: PaymentSummary;
  isLoading?: boolean;
  /** The payment being approved, or the amount being requested (updates as it is typed). */
  thisAmount: number;
}

export const PaymentSummaryBlock = ({ summary, isLoading, thisAmount }: PaymentSummaryBlockProps) => {
  const [showOthers, setShowOthers] = useState(false);

  if (isLoading) {
    return <div className="h-24 animate-pulse rounded-md border bg-muted/40" aria-label="Loading payment summary" />;
  }
  // No summary (an error, or an expense row): the dialog works exactly as it did before.
  if (!summary) return null;

  const noun = orderNoun(summary.document_type);
  const lines = visibleLines(summary.lines);
  const after = leftAfter(summary.left, thisAmount);
  const waiting = waitingPayments(summary.payments);
  const seg = barSegments(summary.lines, summary.value, thisAmount);

  return (
    <div className="space-y-2 text-sm">
      {waiting.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            This {noun} has {waiting.length} other payment{waiting.length > 1 ? "s" : ""} waiting:{" "}
            {waiting
              .map((p) => `${formatToIndianRupee(p.gross_amount)} (${STATUS_LABEL[p.status] ?? p.status})`)
              .join(" · ")}
          </span>
        </p>
      )}

      <div className="rounded-md border">
        <div className="flex items-baseline justify-between px-3 py-2">
          <span className="font-medium">{valueLabel(summary)}</span>
          <span className="font-semibold tabular-nums">{formatToIndianRupee(summary.value)}</span>
        </div>
        <div className="mx-3 mb-2 flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="bg-green-600" style={{ width: `${seg.settled}%` }} />
          <div className="bg-amber-400" style={{ width: `${seg.onItsWay}%` }} />
          <div className={after < 0 ? "bg-red-500" : "bg-sky-500"} style={{ width: `${seg.current}%` }} />
        </div>
        <div className="divide-y border-t">
          {lines.map((line) => (
            <div key={line.key} className="flex items-baseline justify-between px-3 py-1.5">
              <span className="text-muted-foreground">{line.label}</span>
              <span className="tabular-nums">{formatToIndianRupee(line.amount)}</span>
            </div>
          ))}
          <div className="flex items-baseline justify-between bg-muted/40 px-3 py-1.5">
            <span className="font-semibold">This payment</span>
            <span className="font-semibold tabular-nums">{formatToIndianRupee(thisAmount)}</span>
          </div>
          <div className="flex items-baseline justify-between px-3 py-1.5">
            <span className="font-semibold">Left after this payment</span>
            {after < 0 ? (
              <span className="font-semibold tabular-nums text-red-600 dark:text-red-400">
                Over by {formatToIndianRupee(-after)}
              </span>
            ) : (
              <span className="font-semibold tabular-nums text-green-700 dark:text-green-400">
                {formatToIndianRupee(after)}
              </span>
            )}
          </div>
        </div>
      </div>

      {summary.payments.length > 0 && (
        <div>
          <button
            type="button"
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setShowOthers((v) => !v)}
            aria-expanded={showOthers}
          >
            {showOthers ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Other payments on this {noun} ({summary.payments.length})
          </button>
          {showOthers && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded-md border text-xs">
              {summary.payments.map((p) => (
                <div key={p.name} className="grid grid-cols-[1fr_auto] gap-x-2 border-b px-2 py-1 last:border-b-0">
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="text-right tabular-nums">{formatToIndianRupee(p.gross_amount)}</span>
                  <span className="truncate text-muted-foreground">
                    {STATUS_LABEL[p.status] ?? p.status}
                    {p.raised_by_name ? ` · ${p.raised_by_name}` : ""}
                  </span>
                  <span className="text-right text-muted-foreground">{p.creation ? formatDate(p.creation) : "--"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
