import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { ChevronRight } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { useCompanyBorneTds, useVendorTdsRate } from "../../hooks/useVendorTdsRates";
import { forecastTdsTotals, withholdsOnApproval } from "../../tdsForecast";
import { parseNumber } from "@/utils/parseNumber";
// Same superset row as BulkActionBar — every field this dialog reads is carried
// under its payment name, so only the type widened.
import {
  ApprovalQueueRow,
  descriptionFirstLine,
  SOURCE_BADGE,
  SOURCE_LABEL,
} from "../../config/approvalsTable.config";
import {
  countLabel,
  forwardedToCeoNote,
  selectionBreakdown,
  summarizeSelection,
} from "../../bulkSelectionSummary";
import { statusAfterL1, TIER_L2_ABOVE, TIER_L2_ABOVE_EXPENSES } from "@/utils/approvalTiers";
import { isExpenseRow } from "../hooks/useBulkApprovalActions";
import { isChequePayment, paymentModeSummary } from "../../paymentMode";
import { formatDate } from "@/utils/FormatDate";

import { BulkAction, BulkMode } from "../hooks/useBulkPaymentActions";

interface BulkConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: BulkAction;
  /** Which gate is approving: decides which rows this click actually withholds tax on. */
  mode: BulkMode;
  payments: ApprovalQueueRow[];
  isLoading: boolean;
  onConfirm: (rejectionReason?: string) => void;
  projectLabelFor?: (projectId?: string) => string;
  vendorLabelFor?: (vendorId?: string) => string;
}

/**
 * ⚠️ A NON-PROJECT EXPENSE HAS NO PROJECT, AND THAT IS THE TRUE VALUE.
 *
 * Grouping keyed on `p.project || "Unassigned"` swept every non-project expense into
 * a bucket labelled "Unassigned" — which reads as *missing data on a project row*,
 * not as *a company-wide expense*. The sentinel is now internal and the LABEL is
 * derived from what the bucket actually holds.
 */
const NO_PROJECT = "__no_project__";

interface ProjectBucket {
  key: string;
  label: string;
  /** True for the one bucket holding rows that legitimately have no project. */
  isNoProject: boolean;
  total: number;
  rows: ApprovalQueueRow[];
}

const SourceChip = ({ source }: { source: ApprovalQueueRow["source"] }) => (
  <span
    className={`inline-block shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ring-1 ring-inset ${SOURCE_BADGE[source]}`}
  >
    {SOURCE_LABEL[source]}
  </span>
);

const MODE_TONE = {
  online: {
    text: "text-sky-700 dark:text-sky-400",
    badge: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  },
  cheque: {
    text: "text-amber-700 dark:text-amber-400",
    badge: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  },
} as const;

/** `Online (99) ₹1,00,86,803` -- the count in a circle badge, the same shape as the group badges below. */
const ModeTallyChip = ({
  label,
  tally,
  tone,
}: {
  label: string;
  tally: { count: number; total: number };
  tone: keyof typeof MODE_TONE;
}) => (
  <span className="inline-flex items-center gap-1 whitespace-nowrap">
    <span className={`font-medium ${MODE_TONE[tone].text}`}>{label}</span>
    <span
      className={`inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full border px-1 text-[10px] font-semibold leading-none tabular-nums ${MODE_TONE[tone].badge}`}
    >
      {tally.count}
    </span>
    <span className="font-medium tabular-nums">{formatToRoundedIndianRupee(tally.total)}</span>
  </span>
);

export const BulkConfirmDialog: React.FC<BulkConfirmDialogProps> = ({
  open,
  onOpenChange,
  action,
  mode,
  payments,
  isLoading,
  onConfirm,
  projectLabelFor,
  vendorLabelFor,
}) => {
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) {
      setReason("");
      setReasonTouched(false);
      setExpanded(new Set());
    }
  }, [open]);

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const mix = useMemo(() => summarizeSelection(payments), [payments]);

  const { totalAmount, docCount, buckets } = useMemo(() => {
    const map = new Map<string, ProjectBucket>();
    let total = 0;
    // PO/SR count, so it stays honest on an all-expense batch: an expense has no
    // parent document, so it must not be counted as one.
    const distinctDocs = new Set<string>();

    for (const p of payments) {
      const key = p.project || NO_PROJECT;
      const amt = parseNumber(p.amount);
      total += amt;
      if (p.document_name) distinctDocs.add(p.document_name);

      if (!map.has(key)) {
        map.set(key, {
          key,
          label:
            key === NO_PROJECT
              ? "" // resolved below, from what the bucket ends up holding
              : projectLabelFor?.(key) || key,
          isNoProject: key === NO_PROJECT,
          total: 0,
          rows: [],
        });
      }
      const bucket = map.get(key)!;
      bucket.total += amt;
      bucket.rows.push(p);
    }

    const noProject = map.get(NO_PROJECT);
    if (noProject) {
      // Non-project expenses are the only ledger with no project BY DESIGN, so name
      // the bucket after them when that is all it holds. Anything else in there is a
      // record genuinely missing a project, and says so.
      const allNonProject = noProject.rows.every((r) => r.source === "Non-Project");
      noProject.label = allNonProject ? "Non Project Expense" : "No project";
    }

    const arr = Array.from(map.values()).sort((a, b) => {
      // The no-project bucket sorts last — every other bucket is a named project.
      if (a.isNoProject !== b.isNoProject) return a.isNoProject ? 1 : -1;
      return a.label.localeCompare(b.label);
    });
    return { totalAmount: total, docCount: distinctDocs.size, buckets: arr };
  }, [payments, projectLabelFor]);

  /**
   * Tax the whole selection will withhold.
   *
   * ⚠️ ONLY THE DEDUCTIBLE ROWS CONTRIBUTE — a Procurement Order payment adds nothing, not even
   * to `gross`, so the three figures always describe the same subset and read as one sentence.
   * Renders nothing at all when the selection has no SR payments, which is the common case on the
   * Approve Payments tab — and always the case for an expense, which has no vendor and never
   * withholds tax.
   */
  const rateFor = useVendorTdsRate();
  // Miscellaneous / Transportation-only Work Orders keep their payment whole; the tax is paid on top.
  const companyBorneFor = useCompanyBorneTds();
  //
  // ⚠️ ONLY THE ROWS THIS CLICK FINISHES. An L1 approval above 50,000 only forwards the payment to
  // the CEO and withholds nothing yet; counting it here overstated the tax and understated what
  // the vendors receive. Forwarded rows -- of every ledger -- get their own note below.
  const { tdsTotals, forwardedNote } = useMemo(() => {
    const finishes = payments.filter((p) => withholdsOnApproval(mode, p.amount));
    const totals = (rows: ApprovalQueueRow[]) =>
      forecastTdsTotals(rows, (p) => rateFor(p.vendor), (p) => companyBorneFor(p.document_name));
    // What this L1 click FORWARDS to the CEO instead of finishing -- every ledger, each on its own
    // CEO line, exactly as the bulk endpoints route them. The CEO's own click forwards nothing.
    const forwards =
      mode === "ceo"
        ? []
        : payments.filter(
            (p) => statusAfterL1(p.amount, isExpenseRow(p) ? TIER_L2_ABOVE_EXPENSES : undefined) === "CEO Pending"
          );
    const note = forwardedToCeoNote(
      forwards,
      formatToRoundedIndianRupee(TIER_L2_ABOVE),
      totals(forwards).count
    );
    return { tdsTotals: totals(finishes), forwardedNote: note };
  }, [payments, mode, rateFor, companyBorneFor]);

  const modes = useMemo(() => paymentModeSummary(payments), [payments]);

  const count = payments.length;
  const isReject = action === "reject";
  const trimmedReason = reason.trim();
  const canSubmit = isLoading ? false : isReject ? trimmedReason.length > 0 : true;

  // The queue holds three ledgers, so the noun is derived, never hardcoded.
  const title = `${isReject ? "Reject" : "Approve"} ${countLabel(mix)}?`;
  const breakdown = selectionBreakdown(mix, docCount);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className="
          w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)]
          sm:w-full sm:max-w-2xl
          max-h-[90vh]
          p-0 gap-0 grid-rows-none flex flex-col
          overflow-hidden
        "
      >
        {/* Header (fixed) */}
        <AlertDialogHeader className="px-3 sm:px-5 py-3 sm:py-4 border-b flex-shrink-0">
          <AlertDialogTitle className="text-base sm:text-lg text-left">
            {title}
          </AlertDialogTitle>
        </AlertDialogHeader>

        {/* Summary (fixed) — single dense line + optional warning chip */}
        <div className="px-3 sm:px-5 py-2 border-b flex-shrink-0">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold tabular-nums">
              {formatToRoundedIndianRupee(totalAmount)}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {buckets.length} group{buckets.length !== 1 ? "s" : ""}
              {breakdown && ` · ${breakdown}`}
            </span>
          </div>
          {!isReject && modes.online.count + modes.cheque.count > 0 && (
            <div className="mt-1.5 rounded border bg-muted/40 px-2 py-1.5 text-[11px] leading-snug">
              {/* One line: the heading, then each mode as "Name (count) amount", the count in a
                  circle badge in the mode's colour. The note appears only when a cheque is in. */}
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="font-semibold">Mode of Payment</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {modes.online.count > 0 && (
                    <ModeTallyChip label="Online" tally={modes.online} tone="online" />
                  )}
                  {modes.cheque.count > 0 && (
                    <ModeTallyChip label="Cheque" tally={modes.cheque} tone="cheque" />
                  )}
                </span>
              </div>
              {modes.cheque.count > 0 && (
                <div className="mt-0.5 text-muted-foreground">
                  Cheques go to Reconciliation Pending once approved.
                </div>
              )}
            </div>
          )}
          {!isReject && tdsTotals.count > 0 && (
            <div className="mt-1.5 rounded border bg-muted/40 px-2 py-1.5 text-[11px] leading-snug">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">
                  TDS on {tdsTotals.count} work order payment{tdsTotals.count !== 1 ? "s" : ""}
                </span>
                {tdsTotals.companyBorneTds > 0 ? (
                  <span className="tabular-nums font-medium">
                    {formatToRoundedIndianRupee(tdsTotals.tds)}
                  </span>
                ) : (
                  <span className="tabular-nums font-medium text-rose-600 dark:text-rose-400">
                    − {formatToRoundedIndianRupee(tdsTotals.tds)}
                  </span>
                )}
              </div>
              {tdsTotals.companyBorneTds > 0 && (
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-muted-foreground">
                    of which paid by company (Misc / Transport WOs)
                  </span>
                  <span className="tabular-nums font-medium">
                    {formatToRoundedIndianRupee(tdsTotals.companyBorneTds)}
                  </span>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">Vendors receive</span>
                <span className="tabular-nums font-semibold text-green-700 dark:text-green-400">
                  {formatToRoundedIndianRupee(tdsTotals.net)}
                </span>
              </div>
            </div>
          )}
          {!isReject && forwardedNote && (
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{forwardedNote}</p>
          )}
          {!isReject && (
            <p className="text-[11px] leading-snug text-amber-700 mt-1.5">
              Approving as-requested · amounts can't be edited in bulk.
            </p>
          )}
        </div>

        {/* Grouped list — collapsed by default; click a group to expand its rows.
            flex-1 absorbs remaining height up to container's max-h. */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-1 min-h-0 overscroll-contain">
          <ul className="divide-y divide-border/30">
            {buckets.map((bucket) => {
              const isOpen = expanded.has(bucket.key);
              return (
                <li key={bucket.key}>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(bucket.key)}
                    aria-expanded={isOpen}
                    className="w-full flex items-center gap-2 py-2 text-left hover:bg-muted/40 rounded transition-colors"
                  >
                    <ChevronRight
                      className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                    />
                    {/* Group headings are the app's red — project buckets and the
                        expense bucket alike, so the list reads as one family. */}
                    <span
                      className="font-semibold text-xs sm:text-sm text-red-700 dark:text-red-400 truncate flex-1"
                      title={bucket.label}
                    >
                      {bucket.label}
                    </span>
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <Badge
                        variant="secondary"
                        className="h-5 min-w-[1.25rem] px-1.5 text-[10px] font-semibold tabular-nums leading-none flex items-center justify-center rounded-full bg-red-100 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900"
                      >
                        {bucket.rows.length}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {formatToRoundedIndianRupee(bucket.total)}
                      </span>
                    </span>
                  </button>

                  {isOpen && (
                    <ul className="pl-5 pb-2 divide-y divide-border/20">
                      {bucket.rows.map((p) => (
                        <BulkRowLine
                          key={p.name}
                          row={p}
                          vendorLabelFor={vendorLabelFor}
                        />
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Reject reason (fixed) */}
        {isReject && (
          <div className="px-3 sm:px-5 py-2.5 sm:py-3 border-t flex-shrink-0">
            <label
              htmlFor="bulk-reject-reason"
              className="text-xs font-medium text-muted-foreground"
            >
              Reason <span className="text-red-600">*</span> (applied to all)
            </label>
            <Textarea
              id="bulk-reject-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setReasonTouched(true)}
              disabled={isLoading}
              required
              aria-required="true"
              aria-invalid={reasonTouched && trimmedReason.length === 0}
              placeholder="e.g. Vendor invoice missing"
              className={`mt-1 resize-none ${
                reasonTouched && trimmedReason.length === 0
                  ? "border-red-500 focus-visible:ring-red-500"
                  : ""
              }`}
            />
            {reasonTouched && trimmedReason.length === 0 && (
              <p className="text-[11px] text-red-600 mt-1">
                Reason is required to reject.
              </p>
            )}
          </div>
        )}

        {/* Footer (fixed) — AlertDialogFooter already stacks col-reverse on
            mobile and goes row on sm+, so the buttons reflow naturally. */}
        <AlertDialogFooter className="px-3 sm:px-5 py-2.5 sm:py-3 border-t flex-shrink-0">
          {isLoading ? (
            <div className="flex justify-center w-full">
              <TailSpin width={28} height={28} color="red" />
            </div>
          ) : (
            <>
              <AlertDialogCancel disabled={isLoading} className="mt-0">
                Cancel
              </AlertDialogCancel>
              <Button
                disabled={!canSubmit}
                variant="default"
                className={isReject ? undefined : "bg-green-600 hover:bg-green-700 text-white"}
                onClick={() => onConfirm(isReject ? trimmedReason : undefined)}
              >
                {isReject ? "Reject" : "Approve"} {count}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

interface BulkRowLineProps {
  row: ApprovalQueueRow;
  vendorLabelFor?: (vendorId?: string) => string;
}

/**
 * One record inside an expanded group.
 *
 * ⚠️ THIS USED TO BE PAYMENT-ONLY, AND AN EXPENSE RENDERED AS "· —".
 *
 * It read `document_name` for the identity and `vendor` for the sub-line — the two
 * fields an expense does not have — so every expense in the dialog was a blank line
 * beside a rupee figure, with nothing saying what was about to be approved. The
 * identity now comes from the field that actually carries it on each ledger, and the
 * source chip is what tells a project expense from a non-project one where a project
 * group holds both.
 */
const BulkRowLine: React.FC<BulkRowLineProps> = ({ row, vendorLabelFor }) => {
  const isPayment = row.source === "Vendor Payment";

  // The description is the identity of an expense; the PO/SR number is the identity
  // of a payment. Line 1 only — a raw line break here would break the row height.
  const primary = isPayment
    ? row.document_name || row.name
    : descriptionFirstLine(row.against_primary);

  // Vendor for a payment; the expense TYPE for an expense (populated 98% / 82%),
  // falling back to the comment. A blank stays blank — never "N/A".
  const secondary = isPayment
    ? vendorLabelFor?.(row.vendor) || row.vendor
    : row.against_secondary || row.comment_text;

  return (
    <li className="flex items-start justify-between gap-2 py-1.5 text-xs">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <SourceChip source={row.source} />
          <span
            className={`truncate ${isPayment ? "font-mono" : "font-medium"}`}
            title={row.against_full || primary}
          >
            {primary || <span className="text-muted-foreground">(no description)</span>}
          </span>
        </div>
        {secondary && (
          <div
            className={`truncate pl-1 text-[11px] ${
              isPayment
                ? "text-emerald-700 dark:text-emerald-400 font-medium"
                : "text-muted-foreground"
            }`}
            title={secondary}
          >
            {secondary}
          </div>
        )}
        {isPayment && isChequePayment(row) && (
          <div className="truncate pl-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
            Cheque {row.cheque_no}
            {row.cheque_date && ` · ${formatDate(row.cheque_date)}`}
          </div>
        )}
      </div>
      <span className="font-medium whitespace-nowrap tabular-nums">
        {formatToRoundedIndianRupee(parseNumber(row.amount))}
      </span>
    </li>
  );
};
