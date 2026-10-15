import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { isCompanyBorneWorkOrder } from "@/pages/ProjectPayments/tdsForecast";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { Eye, FileText, Lock, PencilRuler, Trash2, Unlock } from "lucide-react";
import { useMemo } from "react";

interface SRDetailsCardProps {
  orderData: ServiceRequests | undefined;
  project: Projects | undefined;
  vendor: Vendors | undefined;
  gstEnabled: boolean;
  getTotal: number;
  hideActions?: boolean;
  hideAmounts?: boolean;
  // Action callbacks
  onDelete?: () => void;
  onAmend?: () => void;
  onAddInvoice?: () => void;
  onRequestPayment?: () => void;
  onPreview?: () => void;
  onEditTerms?: () => void;
  // Feature flags
  summaryPage?: boolean;
  accountsPage?: boolean;
  // Delete button disabled state
  deleteDisabled?: boolean;
  isDeleting?: boolean;
  // GST validation
  missingGst?: boolean;
  // Finalization props
  isFinalized?: boolean;
  finalizedBy?: string | null;
  finalizedOn?: string | null;
  canFinalize?: boolean;
  canRevert?: boolean;
  onFinalize?: () => void;
  onRevertFinalize?: () => void;
  isProcessingFinalize?: boolean;
  isOwner?: boolean;
}

/**
 * SRDetailsCard - A sectioned card component displaying Work Order (SR) details
 *
 * Sections:
 * 1. Header - Title with Status badge
 * 2. Info - Project, Package, Vendor (with separators)
 * 3. Amounts - Total, Invoiced, Paid, TDS withheld, Due, GST status (color-coded)
 * 4. Timeline - Created, Modified, Approved dates
 * 5. Actions - Role-conditional action buttons
 */
export const SRDetailsCard: React.FC<SRDetailsCardProps> = ({
  orderData,
  project,
  vendor,
  gstEnabled,
  getTotal,
  hideActions = false,
  hideAmounts = false,
  onDelete,
  onAmend,
  onAddInvoice,
  onRequestPayment,
  onPreview,
  onEditTerms,
  summaryPage = false,
  accountsPage = false,
  deleteDisabled = false,
  isDeleting = false,
  // GST validation
  missingGst = false,
  // Finalization props
  isFinalized = false,
  finalizedBy,
  finalizedOn,
  canFinalize = false,
  canRevert = false,
  onFinalize,
  onRevertFinalize,
  isProcessingFinalize = false,
  isOwner = false,
}) => {
  // Get status badge variant
  const getStatusVariant = (status: string | undefined): "green" | "red" | "orange" | "outline" => {
    switch (status) {
      case "Approved":
        return "green";
      case "Rejected":
        return "red";
      case "Vendor Selected":
        return "orange";
      default:
        return "outline";
    }
  };

  // The three money figures are the WO's stored fields, the same ones the WO list shows (ADR-0034):
  // never re-added from payments here. `amount_paid` is what the vendor got (Paid payments less
  // Received refunds), `total_tds` the tax beside it, and `amount_due` the server's
  // `total_amount - amount_paid - total_tds`, which leaves the tax out on a company-borne WO.
  const amountPaid = parseNumber(orderData?.amount_paid);
  const tdsWithheld = parseNumber(orderData?.total_tds);
  const amountDue = parseNumber(orderData?.amount_due);
  // On a company-borne Work Order (Miscellaneous / Transportation only) the tax is paid by the
  // company on top of the payment, not withheld from the vendor (`payment_tds.is_company_borne`).
  const companyBorneTds = useMemo(
    () => isCompanyBorneWorkOrder(orderData?.service_category_list),
    [orderData?.service_category_list]
  );

  return (
    <Card className="rounded-sm shadow-md overflow-x-auto">
      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 1: HEADER - Title with Status badge
      ═══════════════════════════════════════════════════════════════════ */}
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-red-600 flex items-center gap-2">
            WO Details
          </h1>
          <div className="flex items-center gap-2">
            {/* Finalized badge - shown when WO is finalized */}
            {isFinalized && (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 flex items-center gap-1">
                <Lock className="h-3 w-3" />
                Finalized
              </Badge>
            )}
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Status
            </span>
            <Badge variant={getStatusVariant(orderData?.status)}>
              {orderData?.status}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 2: INFO - Project, Package, Vendor
        ═══════════════════════════════════════════════════════════════════ */}
        <div className="pb-3 border-b border-gray-100">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {/* Project */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Project
              </span>
              <span className="text-sm font-medium">{project?.project_name}</span>
            </div>

            <Separator orientation="vertical" className="h-5 hidden sm:block" />

            {/* Package */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Package
              </span>
              <span className="text-sm font-medium">Services</span>
            </div>

            {orderData?.status === "Approved" && vendor && (
              <>
                <Separator orientation="vertical" className="h-5 hidden sm:block" />
                {/* Vendor */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Vendor
                  </span>
                  <span className="text-sm font-medium">{vendor?.vendor_name}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 3: AMOUNTS - Financial figures (only when approved, hidden for PM)
        ═══════════════════════════════════════════════════════════════════ */}
        {orderData?.status === "Approved" && !hideAmounts && (
          <div className="pb-3 border-b border-gray-100">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Amounts
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {/* Total Value */}
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">
                  Total Value {gstEnabled ? "(Incl. GST)" : "(Excl. GST)"}
                </p>
                <p className="text-sm font-semibold text-blue-600">
                  {formatToIndianRupee(Math.floor(getTotal * (gstEnabled ? 1.18 : 1)))}
                </p>
              </div>

              {/* Total Amount Invoiced */}
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">Total Amount Invoiced</p>
                <p className="text-sm font-medium text-blue-600">
                  {formatToIndianRupee(orderData?.amount_invoiced || 0)}
                </p>
                {/* GST Invoiced (ADR-0030): GST on the approved invoices, not GST paid. */}
                {(gstEnabled || !!orderData?.gst_invoiced) && (
                  <p className="text-[11px] text-gray-500">
                    GST Invoiced{" "}
                    <span className="font-medium text-gray-700 tabular-nums">
                      {formatToIndianRupee(orderData?.gst_invoiced || 0)}
                    </span>
                  </p>
                )}
              </div>

              {/* Amount Paid: what the vendor got, refunds taken off, tax not in it */}
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">Amount Paid</p>
                <p className="text-sm font-medium text-green-600 tabular-nums">
                  {formatToIndianRupeeOrZero(amountPaid)}
                </p>
              </div>

              {/* TDS withheld: settled with the tax office, beside Amount Paid */}
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">
                  {companyBorneTds ? "TDS (paid by company)" : "TDS withheld"}
                </p>
                <p className="text-sm font-medium text-gray-700 tabular-nums">
                  {formatToIndianRupeeOrZero(tdsWithheld)}
                </p>
              </div>

              {/* Amount Due: negative when the WO is overpaid */}
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">Amount Due</p>
                <p className={`text-sm font-medium tabular-nums ${amountDue < 0 ? "text-red-600" : "text-yellow-600"}`}>
                  {formatToIndianRupeeOrZero(amountDue)}
                </p>
              </div>

              {/* GST Status */}
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">GST</p>
                <Badge variant={gstEnabled ? "green" : "outline"}>
                  {gstEnabled ? "Included" : "Not Applicable"}
                </Badge>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 4: TIMELINE - Dates
        ═══════════════════════════════════════════════════════════════════ */}
        <div className="pb-3 border-b border-gray-100">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Timeline
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {/* Date Created */}
            <div className="space-y-0.5">
              <p className="text-xs text-gray-500">Created</p>
              <p className="text-sm">{orderData?.creation ? formatDate(orderData.creation) : "--"}</p>
            </div>

            {/* Date Modified */}
            <div className="space-y-0.5">
              <p className="text-xs text-gray-500">Last Modified</p>
              <p className="text-sm">{orderData?.modified ? formatDate(orderData.modified) : "--"}</p>
            </div>

            {/* Approved Date (if applicable) */}
            {orderData?.status === "Approved"  && (
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">Approved</p>
                <p className="text-sm">{orderData?.modified ? formatDate(orderData.modified) : "--"}</p>
              </div>
            )}

            {/* Finalized Date (if finalized) */}
            {isFinalized && finalizedOn && (
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500 flex items-center gap-1">
                  <Lock className="h-3 w-3" />
                  Finalized
                </p>
                <p className="text-sm">{formatDate(finalizedOn)}</p>
                {finalizedBy && (
                  <p className="text-xs text-gray-400">by {finalizedBy}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 5: ACTIONS - All action buttons (hidden for PM role)
            Layout: Finalize/Revert → Preview → Content actions → Edit actions → Delete
        ═══════════════════════════════════════════════════════════════════ */}
        {((!hideActions && !hideAmounts) || (onDelete && !isFinalized && isOwner) || (!hideActions && onPreview)) && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 sm:flex-wrap sm:justify-end">
            {/* ─── State Control Actions (First) ─── */}
            {/* Finalize Button - Primary action when available */}
            {!hideActions && !hideAmounts && canFinalize && onFinalize && (
              <Button
                variant="outline"
                size="sm"
                disabled={isProcessingFinalize || missingGst}
                onClick={onFinalize}
                title={missingGst ? "Please select Nirmaan GST for Billing before finalizing" : undefined}
                className={`flex items-center gap-1 border-blue-600 text-blue-600 hover:bg-blue-50 shrink-0 ${missingGst ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <Lock className="h-3.5 w-3.5" />
                Finalize
              </Button>
            )}

            {/* Revert Finalization Button - Admin action when finalized */}
            {!hideActions && !hideAmounts && canRevert && onRevertFinalize && (
              <Button
                variant="outline"
                size="sm"
                disabled={isProcessingFinalize}
                onClick={onRevertFinalize}
                className="flex items-center gap-1 border-amber-600 text-amber-600 hover:bg-amber-50 shrink-0"
              >
                <Unlock className="h-3.5 w-3.5" />
                Revert Finalization
              </Button>
            )}

            {/* ─── View Action ─── */}
            {/* Preview Button — visible to PM too; SRPdf hides Rate/Tax/Amount for them */}
            {!hideActions && onPreview && (
              <Button
                variant="outline"
                size="sm"
                disabled={!orderData?.project_gst}
                onClick={onPreview}
                className="flex items-center gap-1 border-primary text-primary shrink-0"
              >
                <Eye className="h-3.5 w-3.5" />
                Preview
              </Button>
            )}

            {/* ─── Content Actions (Allowed when finalized) ─── */}
            {/* Add Invoice Button */}
            {!hideActions && !hideAmounts && onAddInvoice && (
              <Button
                variant="outline"
                size="sm"
                onClick={onAddInvoice}
                className="flex items-center gap-1 border-primary text-primary shrink-0"
              >
                <FileText className="h-3.5 w-3.5" />
                Add Invoice
              </Button>
            )}

            {/* Request Payment Button */}
            {!hideActions && !hideAmounts && onRequestPayment && !summaryPage && !accountsPage && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRequestPayment}
                className="flex items-center gap-1 border-primary text-primary shrink-0"
              >
                Request Payment
              </Button>
            )}

            {/* ─── Edit Actions (Hidden when finalized) ─── */}
            {/* Amend Button */}
            {!hideActions && !hideAmounts && onAmend && !summaryPage && !accountsPage && !isFinalized && (
              <Button
                variant="outline"
                size="sm"
                disabled={orderData?.status === "Amendment"}
                onClick={onAmend}
                className="flex items-center gap-1 border-primary text-primary shrink-0 transition-opacity"
                title={orderData?.status === "Amendment" ? "An amendment is already in progress" : undefined}
              >
                <PencilRuler className="h-3.5 w-3.5" />
                Amend
              </Button>
            )}

            {/* Edit Terms Button */}
            {!hideActions && !hideAmounts && onEditTerms && !summaryPage && !accountsPage && !isFinalized && (
              <Button
                variant="outline"
                size="sm"
                onClick={onEditTerms}
                className="flex items-center gap-1 border-primary text-primary shrink-0"
              >
                <PencilRuler className="h-3.5 w-3.5" />
                Edit Terms
              </Button>
            )}

            {/* ─── Destructive Action (Last) ─── */}
            {/* Delete Button - Shown to owner or non-restricted roles if not finalized */}
            {onDelete && !isFinalized && (isOwner || (!hideActions && !hideAmounts)) && (
              <Button
                variant="outline"
                size="sm"
                disabled={deleteDisabled || isDeleting}
                onClick={onDelete}
                className="flex items-center gap-1 border-red-600 text-red-600 hover:bg-red-50 shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SRDetailsCard;
