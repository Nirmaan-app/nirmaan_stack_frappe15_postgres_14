import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { ArrowDownToLine, Wallet } from "lucide-react";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useVendorAdjustmentCredit } from "./data/usePOAdjustmentQueries";
import { ApplyVendorCreditDialog } from "./ApplyVendorCreditDialog";

// Mirrors the existing "Adjust Payments" gating in PODetails.tsx.
const APPLY_ROLES = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
  "Nirmaan Procurement Executive Profile",
];

interface PaymentTermLike {
  term_status?: string;
  amount?: number;
}

interface VendorCreditSummaryCardProps {
  poId: string;
  vendor: string;
  vendorName?: string;
  /** The current PO's payment terms — Created terms define the absorbable payable. */
  paymentTerms?: PaymentTermLike[];
  role?: string;
  /** Called after a successful apply so the parent can refresh the PO + payments. */
  onApplied?: () => void;
}

/**
 * Top-of-PO banner: shows how much overpaid credit the vendor is holding across
 * its POs, with an "Apply to this PO" action that pulls that credit into the
 * current PO. Renders nothing when the vendor has no available credit.
 */
export function VendorCreditSummaryCard({
  poId,
  vendor,
  vendorName,
  paymentTerms,
  role,
  onApplied,
}: VendorCreditSummaryCardProps) {
  const { vendorCredit, isLoading, mutate } = useVendorAdjustmentCredit(
    vendor,
    poId
  );
  const [dialogOpen, setDialogOpen] = useState(false);

  const payableCapacity = useMemo(
    () =>
      (paymentTerms || [])
        .filter((t) => t.term_status === "Created")
        .reduce((sum, t) => sum + (Number(t.amount) || 0), 0),
    [paymentTerms]
  );

  if (isLoading || !vendorCredit) return null;
  if (!vendorCredit.total_available || vendorCredit.total_available <= 0)
    return null;
  // No pending payable on this PO (nothing owed) -> nothing to apply credit to ->
  // hide the banner entirely rather than show a dead "Apply" button.
  if (payableCapacity <= 0.01) return null;

  const canApply = !!role && APPLY_ROLES.includes(role);

  const applyButton = (
    <Button
      size="sm"
      onClick={() => setDialogOpen(true)}
      disabled={!canApply}
      className="h-8 px-3 gap-1.5 w-full justify-center sm:w-auto"
    >
      <ArrowDownToLine className="h-3.5 w-3.5" />
      <span className="text-xs">Apply to this PO</span>
    </Button>
  );

  return (
    <>
      <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
            <Wallet className="h-4 w-4 text-emerald-700" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-900 leading-snug">
              Adjustment credit available
              {vendorName ? ` from ${vendorName}` : ""}
            </p>
            <p className="text-xs text-emerald-700/80 mt-0.5">
              {formatToIndianRupee(vendorCredit.total_available)} across{" "}
              {vendorCredit.source_count}{" "}
              {vendorCredit.source_count === 1 ? "PO" : "POs"} for this vendor
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto sm:justify-end">
          <Badge
            variant="outline"
            className="hidden sm:inline-flex border-emerald-300 bg-white text-emerald-700 font-semibold tabular-nums"
          >
            {formatToIndianRupee(vendorCredit.total_available)}
            <span className="ml-1 font-normal text-emerald-700/70">
              ({vendorCredit.source_count}{" "}
              {vendorCredit.source_count === 1 ? "PO" : "POs"})
            </span>
          </Badge>
          {canApply ? (
            applyButton
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="w-full sm:w-auto">{applyButton}</span>
              </TooltipTrigger>
              <TooltipContent>
                You don't have permission to apply credit.
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      <ApplyVendorCreditDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        destPo={poId}
        payableCapacity={payableCapacity}
        sources={vendorCredit.sources}
        onApplied={() => {
          mutate();
          onApplied?.();
        }}
      />
    </>
  );
}

export default VendorCreditSummaryCard;
