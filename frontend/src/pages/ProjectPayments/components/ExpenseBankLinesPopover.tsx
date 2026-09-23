/**
 * The expense's Bank lines card, on the Payments & Expenses table (#1303, ADR-0027 R5).
 *
 * A salary or reimbursement run leaves the bank as many lines and is recorded as ONE expense. This
 * card is where the accountant sees which lines paid it, and — while it is still Reconciliation
 * Pending — how much of it no bank line has covered yet.
 *
 * ⚠️ SAME CLICK-TO-OPEN PATTERN AS THE Against / Vendor / Project CARDS, and deliberately the same
 * trigger style (`DETAIL_TRIGGER_CLASS`): on this table a dotted underline already means "there is
 * more behind this", so a second affordance for the same promise would read as a different one.
 *
 * ⚠️ THE FETCH IS LAZY AND MUST STAY LAZY. One trigger renders PER ROW; a fetch on mount would be a
 * query per expense per page of the queue, for cards nobody opened. `useFrappeGetCall`'s THIRD
 * argument is the swrKey: `null` = do not fetch, `undefined` = fetch under the default key. SWR
 * caches it, so re-opening the same row costs nothing.
 *
 * ⚠️ READ-ONLY, AND THAT IS THE DESIGN, NOT AN OMISSION (ADR-0027 Q15). Links are taken off in ONE
 * place — Unreconcile on Bulk Import Transactions — because the verdict that decides whether a line
 * MAY come off lives there. The footer says so rather than leaving the reader to wonder.
 */

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useFrappeGetCall } from "frappe-react-sdk";
import { ExternalLink } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import type { ApprovalQueueRow } from "../config/approvalsTable.config";

import { DETAIL_TRIGGER_CLASS } from "./DetailPopovers";
import {
  type ExpenseBankLine,
  type ExpenseBankLines,
  linkedProgress,
  partUsedLines,
  statusTone,
} from "./expenseBankLinesView";

const BANK_LINES_METHOD =
  "nirmaan_stack.api.approvals.expense_bank_lines.get_expense_bank_lines";

/** Where links are changed. One place, on purpose. */
const IMPORT_SCREEN = "/bulk-import-transactions";

interface ExpenseBankLinesPopoverProps {
  /**
   * The expense ledger. ⚠️ THE ROW'S OWN UNION, NOT `string` — widening it here would let a payment
   * doctype through to the server's `EXPENSE_DOCTYPES` throw instead of failing at the call site.
   */
  doctype: ApprovalQueueRow["doctype"];
  /** The expense or payment document name. */
  name: string;
  /**
   * The line under the name — an expense's type, a payment's PO / WO number. Known before the card
   * opens, so the header never flashes an id or an empty line.
   */
  subtitle?: string;
  /**
   * The expense's FULL description, line breaks and all, plus its comment.
   *
   * ⚠️ BOTH ARE HERE BECAUSE THIS CARD REPLACES THE Against HOVER on the rows it renders on, and
   * that hover showed exactly these two. About a third of expense descriptions carry a line break,
   * and the extra lines are bank details; dropping them would be a silent regression on the rows
   * this feature is FOR.
   */
  description?: string;
  comment?: string;
  status?: string;
  /**
   * The row's `bank_line_count` from the queue. Used only for the skeleton's height while the
   * lines arrive — the card itself renders the fetched list.
   */
  lineCount?: number;
  children: React.ReactNode;
}

const LineRow: React.FC<{ line: ExpenseBankLine }> = ({ line }) => (
  <tr className="border-t">
    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
      {line.added_on ? formatDate(line.added_on) : "—"}
    </td>
    <td className="max-w-[9rem] truncate px-2 py-1.5" title={line.beneficiary_name}>
      {line.beneficiary_name || "—"}
    </td>
    <td
      className="max-w-[7rem] truncate px-2 py-1.5 font-mono text-[10px]"
      title={line.reference}
    >
      {line.reference || "—"}
    </td>
    <td
      className="max-w-[7rem] truncate px-2 py-1.5 font-mono text-[10px]"
      title={line.import_batch}
    >
      {line.import_batch || "—"}
    </td>
    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
      {formatToRoundedIndianRupee(line.amount)}
    </td>
  </tr>
);

export const ExpenseBankLinesPopover: React.FC<ExpenseBankLinesPopoverProps> = ({
  doctype,
  name,
  subtitle,
  description,
  comment,
  status,
  lineCount,
  children,
}) => {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useFrappeGetCall<{ message: ExpenseBankLines }>(
    BANK_LINES_METHOD,
    { doctype, name },
    open ? undefined : null,
  );
  const card = data?.message;

  // The known status shows immediately; the fetched one replaces it, because an expense can have
  // been settled by someone else since this page of the queue was read.
  const shownStatus = card?.status || status || "";
  const progress = card ? linkedProgress(card) : null;
  // The date belongs to the bank lines: it is the latest linked line's, and only a Paid expense
  // has one. While the run is short there is deliberately nothing to show.
  const paidOn = card?.payment_date ? formatDate(card.payment_date) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={DETAIL_TRIGGER_CLASS}>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-[30rem] p-3">
        <div className="space-y-2 text-xs">
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              <p className="break-all font-semibold leading-tight">{name}</p>
              {subtitle && (
                <p className="text-[11px] text-muted-foreground">{subtitle}</p>
              )}
            </div>
            {shownStatus && (
              <span
                className={cn(
                  "ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                  statusTone(shownStatus),
                )}
              >
                {shownStatus}
              </span>
            )}
          </div>

          {/* ⚠️ THE DESCRIPTION AND COMMENT THE Against HOVER USED TO SHOW, IN FULL AND WITH THEIR
              LINE BREAKS. This card replaces that hover on the rows it renders on, so truncating
              them here would quietly lose the bank details a third of expense descriptions carry.
              It is scrollable rather than clipped, and it needs no fetch — the row already has it. */}
          {(description || comment) && (
            <div className="max-h-20 space-y-1 overflow-y-auto border-t pt-2 text-muted-foreground">
              {description && <p className="whitespace-pre-wrap">{description}</p>}
              {comment && <p className="border-t pt-1 italic">{comment}</p>}
            </div>
          )}

          {isLoading && (
            <div className="space-y-1.5 border-t pt-2">
              <Skeleton className="h-3 w-3/5" />
              <Skeleton className="h-1.5 w-full" />
              {Array.from({ length: Math.min(lineCount || 3, 5) }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-full" />
              ))}
            </div>
          )}

          {/* A failed read says so. Rendering an empty table instead would read as
              "no bank lines", which is the one thing this card exists to deny. */}
          {!isLoading && error && (
            <p className="border-t pt-2 text-destructive">
              Could not read these bank lines. Try again.
            </p>
          )}

          {!isLoading && !error && card && progress && (
            <>
              <div className="border-t pt-2">
                <p className="tabular-nums">
                  <span className="font-semibold">{progress.linked}</span>{" "}
                  <span className="text-muted-foreground">{progress.note}</span>
                  {progress.stillToLink && (
                    <span className="text-muted-foreground">
                      {" · "}
                      {progress.stillToLink}
                    </span>
                  )}
                </p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full",
                      progress.complete ? "bg-green-600" : "bg-orange-500",
                    )}
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                {/* What makes the Paid look a Paid look: the run's completion date, which IS the
                    latest linked line's. A short expense has none, and that absence is the fact. */}
                {paidOn && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Paid on <span className="tabular-nums">{paidOn}</span>, the latest linked line.
                  </p>
                )}
              </div>

              {/* 30 lines is an ordinary run, so the list scrolls rather than pushing the
                  footer — and the footer is where the reader is told what to do next. */}
              <div className="max-h-56 overflow-y-auto rounded border">
                <table className="w-full table-fixed">
                  <thead className="sticky top-0 bg-muted/60">
                    <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="w-[5.5rem] px-2 py-1 text-left font-medium">Date</th>
                      <th className="px-2 py-1 text-left font-medium">Beneficiary</th>
                      <th className="w-[6rem] px-2 py-1 text-left font-medium">Reference</th>
                      <th className="w-[6.5rem] px-2 py-1 text-left font-medium">Import</th>
                      <th className="w-[5.5rem] px-2 py-1 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {card.lines.map((line) => (
                      <LineRow key={line.match} line={line} />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* A line split across several records says how much of IT is reconciled and how
                  much still waits in Bulk Import — the rows above only show this record's share. */}
              {partUsedLines(card.lines).map((line, i) => (
                <p key={i} className="text-[11px] tabular-nums">
                  <span className="text-muted-foreground">
                    Bank line {line.beneficiary} ({line.lineAmount}) is split across records:{" "}
                  </span>
                  <span className="text-green-700">{line.reconciled} reconciled</span>
                  <span className="text-muted-foreground"> · </span>
                  <span className="text-orange-600">{line.pending} pending</span>
                </p>
              ))}

              <p className="text-[11px] text-muted-foreground">
                Read only. To take a line off, open{" "}
                <Link
                  to={IMPORT_SCREEN}
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  Bulk Import Transactions
                  <ExternalLink className="h-3 w-3" />
                </Link>{" "}
                and use Unreconcile.
              </p>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
