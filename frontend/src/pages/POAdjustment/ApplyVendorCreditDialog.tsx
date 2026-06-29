import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, IndianRupee } from "lucide-react";
import formatToIndianRupee from "@/utils/FormatPrice";
import { toast } from "@/components/ui/use-toast";
import { useApplyVendorCredit } from "./data/usePOAdjustmentMutations";
import type { VendorCreditSource } from "./data/usePOAdjustmentQueries";

interface ApplyVendorCreditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  destPo: string;
  /** Sum of the current PO's "Created" payment terms — the amount credit can fill. */
  payableCapacity: number;
  sources: VendorCreditSource[];
  onApplied?: () => void;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function ApplyVendorCreditDialog({
  isOpen,
  onClose,
  destPo,
  payableCapacity,
  sources,
  onApplied,
}: ApplyVendorCreditDialogProps) {
  // Allocations keyed by source po_id -> amount to pull from it.
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const { apply, loading } = useApplyVendorCredit();

  const totalAllocated = useMemo(
    () => Object.values(allocations).reduce((s, a) => s + (a || 0), 0),
    [allocations]
  );
  const remainingToFill = Math.max(0, round2(payableCapacity - totalAllocated));
  const fillPercent =
    payableCapacity > 0
      ? Math.min(100, (totalAllocated / payableCapacity) * 100)
      : 0;

  const reset = () => setAllocations({});

  const toggleSource = (src: VendorCreditSource) => {
    setAllocations((prev) => {
      const next = { ...prev };
      if (src.po_id in next) {
        delete next[src.po_id];
      } else {
        const cap = Math.min(src.available, remainingToFill);
        if (cap > 0) next[src.po_id] = round2(cap);
      }
      return next;
    });
  };

  const setAmount = (src: VendorCreditSource, val: string) => {
    let num = parseFloat(val) || 0;
    if (num < 0) num = 0;
    const currentForThis = allocations[src.po_id] || 0;
    const maxForThis = Math.min(src.available, remainingToFill + currentForThis);
    if (num > maxForThis) num = round2(maxForThis);
    setAllocations((prev) => ({ ...prev, [src.po_id]: num }));
  };

  const handleSubmit = async () => {
    const payload = Object.entries(allocations)
      .filter(([, amt]) => amt > 0)
      .map(([source_po, amount]) => ({ source_po, amount }));
    if (payload.length === 0) return;
    try {
      await apply(destPo, payload);
      toast({
        title: "Credit applied",
        description: "Vendor credit has been applied to this PO.",
      });
      reset();
      onApplied?.();
      onClose();
    } catch (err: unknown) {
      toast({
        title: "Failed to apply credit",
        description: err instanceof Error ? err.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  const canSubmit = totalAllocated > 0 && !loading;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-0 gap-0">
        {/* ── Header ── */}
        <div className="px-5 pt-5 pb-4 border-b border-gray-100">
          <DialogHeader className="p-0 space-y-0">
            <DialogTitle className="text-base font-semibold text-gray-900">
              Apply Vendor Credit
            </DialogTitle>
          </DialogHeader>

          <div className="mt-3 flex items-center justify-between gap-4 bg-primary/[0.04] rounded-lg px-4 py-3 border border-primary/10">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <IndianRupee className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-primary/60 uppercase tracking-wider leading-none mb-1">
                  Pending Payable
                </p>
                <p className="text-lg sm:text-xl font-bold text-gray-900 leading-none tabular-nums truncate">
                  {formatToIndianRupee(payableCapacity)}
                </p>
              </div>
            </div>
            <div className="text-right min-w-0 shrink-0 max-w-[40%]">
              <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-0.5 truncate">
                {destPo}
              </p>
            </div>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-5 py-4 space-y-4">
          {/* Fill tracker */}
          <div
            className={`rounded-lg border px-4 py-3 ${
              remainingToFill <= 0.01
                ? "bg-green-50/60 border-green-200/60"
                : "bg-amber-50/40 border-amber-200/50"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <p
                className={`text-xs font-semibold ${
                  remainingToFill <= 0.01 ? "text-green-700" : "text-amber-700"
                }`}
              >
                Remaining to fill
              </p>
              <p
                className={`text-sm font-bold tabular-nums ${
                  remainingToFill <= 0.01 ? "text-green-700" : "text-amber-700"
                }`}
              >
                {formatToIndianRupee(remainingToFill)}
              </p>
            </div>
            <div className="h-1.5 w-full rounded-full bg-black/5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  remainingToFill <= 0.01 ? "bg-green-500" : "bg-primary"
                }`}
                style={{ width: `${fillPercent}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              {formatToIndianRupee(totalAllocated)} of{" "}
              {formatToIndianRupee(payableCapacity)} allocated
            </p>
          </div>

          {/* Source PO list */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
              Draw credit from{sources.length > 0 ? ` (${sources.length})` : ""}
            </label>
            <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
              {sources.length === 0 ? (
                <div className="text-center py-8 border border-dashed border-gray-200 rounded-lg">
                  <p className="text-gray-400 text-sm">
                    No overpaid POs for this vendor
                  </p>
                </div>
              ) : (
                sources.map((src) => {
                  const isSelected = src.po_id in allocations;
                  const applied = allocations[src.po_id] || 0;
                  const cap = Math.min(
                    src.available,
                    remainingToFill + applied
                  );
                  const canSelect = isSelected || remainingToFill > 0;

                  return (
                    <div
                      key={src.po_id}
                      className={`px-3 py-2 sm:py-2.5 rounded-md border transition-all ${
                        isSelected
                          ? "border-primary/30 bg-primary/[0.02]"
                          : "border-gray-100 bg-white hover:border-gray-200"
                      } ${!canSelect ? "opacity-40" : ""}`}
                    >
                      <div className="flex items-start gap-3 sm:items-center">
                        <button
                          type="button"
                          onClick={() => canSelect && toggleSource(src)}
                          disabled={!canSelect}
                          className={`h-4 w-4 rounded flex-shrink-0 flex items-center justify-center border transition-colors ${
                            isSelected
                              ? "bg-primary border-primary text-white"
                              : "border-gray-300 bg-white"
                          }`}
                        >
                          {isSelected && (
                            <CheckCircle2 className="h-3 w-3" strokeWidth={3} />
                          )}
                        </button>

                        <div className="flex flex-col gap-1 flex-1 min-w-0 sm:grid sm:grid-cols-3 sm:items-center sm:gap-2">
                          <div className="min-w-0">
                            <span className="text-xs font-semibold text-gray-900 truncate block">
                              {src.po_id}
                            </span>
                            <p className="text-[10px] text-primary font-medium mt-0.5 truncate">
                              {src.project_name || src.project}
                            </p>
                          </div>

                          <div className="flex items-center justify-between gap-2 sm:block sm:pl-3 sm:border-l sm:border-gray-100">
                            <p className="text-[10px] text-gray-400">Available</p>
                            <p className="text-xs font-semibold text-emerald-600 tabular-nums">
                              {formatToIndianRupee(src.available)}
                            </p>
                          </div>

                          <div className="flex items-center justify-between gap-2 sm:block sm:pl-3 sm:border-l sm:border-gray-100">
                            <p className="text-[10px] text-gray-400">Apply</p>
                            {isSelected ? (
                              <input
                                type="number"
                                min={0}
                                max={cap}
                                value={applied || ""}
                                onChange={(e) => setAmount(src, e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className="h-7 w-28 sm:w-full px-1.5 text-xs font-semibold border border-gray-200 rounded tabular-nums"
                              />
                            ) : (
                              <p className="text-xs font-semibold text-gray-300 tabular-nums">
                                —
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500">
            Total:{" "}
            <span className="font-semibold tabular-nums">
              {formatToIndianRupee(totalAllocated)}
            </span>
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                reset();
                onClose();
              }}
              disabled={loading}
              className="text-gray-500 font-medium"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="px-5"
            >
              {loading ? "Applying..." : "Apply Credit"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ApplyVendorCreditDialog;
