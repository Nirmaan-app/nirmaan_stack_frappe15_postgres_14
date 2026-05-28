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
import { parseNumber } from "@/utils/parseNumber";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";

import { BulkAction } from "../hooks/useBulkPaymentActions";

interface BulkConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: BulkAction;
  payments: ProjectPayments[];
  isLoading: boolean;
  onConfirm: (rejectionReason?: string) => void;
  projectLabelFor?: (projectId?: string) => string;
  vendorLabelFor?: (vendorId?: string) => string;
}

interface ProjectBucket {
  project: string;
  projectLabel: string;
  total: number;
  rows: ProjectPayments[];
}

export const BulkConfirmDialog: React.FC<BulkConfirmDialogProps> = ({
  open,
  onOpenChange,
  action,
  payments,
  isLoading,
  onConfirm,
  projectLabelFor,
  vendorLabelFor,
}) => {
  const [reason, setReason] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) {
      setReason("");
      setExpanded(new Set());
    }
  }, [open]);

  const toggleExpanded = useCallback((projectId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const { totalAmount, docCount, buckets } = useMemo(() => {
    const map = new Map<string, ProjectBucket>();
    let total = 0;
    const distinctDocs = new Set<string>();

    for (const p of payments) {
      const projectId = p.project || "Unassigned";
      const amt = parseNumber(p.amount);
      total += amt;
      if (p.document_name) distinctDocs.add(p.document_name);

      if (!map.has(projectId)) {
        map.set(projectId, {
          project: projectId,
          projectLabel: projectLabelFor?.(projectId) || projectId,
          total: 0,
          rows: [],
        });
      }
      const bucket = map.get(projectId)!;
      bucket.total += amt;
      bucket.rows.push(p);
    }

    const arr = Array.from(map.values()).sort((a, b) =>
      a.projectLabel.localeCompare(b.projectLabel)
    );
    return { totalAmount: total, docCount: distinctDocs.size, buckets: arr };
  }, [payments, projectLabelFor]);

  const count = payments.length;
  const isReject = action === "reject";
  const trimmedReason = reason.trim();
  const canSubmit = isLoading ? false : isReject ? trimmedReason.length > 0 : true;

  const title = isReject
    ? `Reject ${count} payment${count !== 1 ? "s" : ""}?`
    : `Approve ${count} payment${count !== 1 ? "s" : ""}?`;

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
              {buckets.length} project{buckets.length !== 1 ? "s" : ""} · {docCount} PO/SR
            </span>
          </div>
          {!isReject && (
            <p className="text-[11px] leading-snug text-amber-700 mt-1.5">
              Approving as-requested · amounts can't be edited in bulk.
            </p>
          )}
        </div>

        {/* Grouped list — collapsed by default; click a project to expand its POs.
            flex-1 absorbs remaining height up to container's max-h. */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-1 min-h-0 overscroll-contain">
          <ul className="divide-y divide-border/30">
            {buckets.map((bucket) => {
              const isOpen = expanded.has(bucket.project);
              return (
                <li key={bucket.project}>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(bucket.project)}
                    aria-expanded={isOpen}
                    className="w-full flex items-center gap-2 py-2 text-left hover:bg-muted/40 rounded transition-colors"
                  >
                    <ChevronRight
                      className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                    />
                    <span
                      className="font-semibold text-xs sm:text-sm text-blue-700 dark:text-blue-400 truncate flex-1"
                      title={bucket.projectLabel}
                    >
                      {bucket.projectLabel}
                    </span>
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <Badge
                        variant="secondary"
                        className="h-5 min-w-[1.25rem] px-1.5 text-[10px] font-semibold tabular-nums leading-none flex items-center justify-center rounded-full bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900"
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
                        <li
                          key={p.name}
                          className="flex items-center justify-between gap-2 py-1.5 text-xs"
                        >
                          <div className="min-w-0 flex-1 truncate">
                            <span className="font-medium" title={p.document_name}>
                              {p.document_name}
                            </span>
                            <span className="text-muted-foreground">{" · "}</span>
                            <span
                              className="text-emerald-700 dark:text-emerald-400 font-medium"
                              title={vendorLabelFor?.(p.vendor) || p.vendor}
                            >
                              {vendorLabelFor?.(p.vendor) || p.vendor || "—"}
                            </span>
                          </div>
                          <span className="font-medium whitespace-nowrap tabular-nums">
                            {formatToRoundedIndianRupee(parseNumber(p.amount))}
                          </span>
                        </li>
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
              Reason (required, applied to all)
            </label>
            <Textarea
              id="bulk-reject-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isLoading}
              placeholder="e.g. Vendor invoice missing"
              className="mt-1 resize-none"
            />
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
                variant={isReject ? "destructive" : "default"}
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
