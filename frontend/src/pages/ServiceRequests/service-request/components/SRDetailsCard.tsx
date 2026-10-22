import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Separator } from "@/components/ui/separator";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { amountPaidParts, type WorkOrderTds } from "@/pages/ProjectPayments/tdsForecast";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { Eye, FileText, Lock, PencilRuler, Trash2, Unlock } from "lucide-react";
import { UNDER_AMENDMENT_PAYMENT_NOTE } from "../../config/workOrderAmendment";

interface SRDetailsCardProps {
  orderData: ServiceRequests | undefined;
  /** The WO's paid TDS by who bore it, as the server answers it (`get_work_order_tds`); undefined while loading. */
  workOrderTds?: WorkOrderTds;
  project: Projects | undefined;
  vendor: Vendors | undefined;
  gstEnabled: boolean;
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
  /** Who first approved it, as a name to show (falls back to the user id) */
  approvedBy?: string | null;
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
  /** Why Amend can't start (payments in flight, #1540), or null when it may. */
  amendBlockedReason?: string | null;
}

/**
 * SRDetailsCard - A sectioned card component displaying Work Order (SR) details
 *
 * Sections:
 * 1. Header - Title with Status badge
 * 2. Info - Project, Package, Vendor (with separators)
 * 3. Amounts - Total, Invoiced, Paid (hover: paid to vendor / TDS withheld), Due, GST status (color-coded)
 * 4. Timeline - Created, Modified, Approved (the stored approval date and approver) dates
 * 5. Actions - Role-conditional action buttons
 */
export const SRDetailsCard: React.FC<SRDetailsCardProps> = ({
  orderData,
  workOrderTds,
  project,
  vendor,
  gstEnabled,
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
  approvedBy,
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
  amendBlockedReason = null,
}) => {
  const underAmendment = orderData?.status === "Amendment";
  const showsAmend = !hideActions && !hideAmounts && !!onAmend && !summaryPage && !accountsPage && !isFinalized;
  const showsRequestPayment = !hideActions && !hideAmounts && !!onRequestPayment && !summaryPage && !accountsPage;
  const actionNote = underAmendment
    ? showsRequestPayment ? UNDER_AMENDMENT_PAYMENT_NOTE : null
    : showsAmend ? amendBlockedReason : null;
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

  // The money figures are the WO's stored fields, the same ones the WO list shows (ADR-0034): never
  // re-added from payments here. `amount_paid` is the Paid payments plus the TDS withheld from the
  // vendor, less Received refunds (Amendment A); `amount_due` is `total_amount - amount_paid`.
  const amountPaid = parseNumber(orderData?.amount_paid);
  const amountDue = parseNumber(orderData?.amount_due);
  // The hover's split is the server's answer off the WO's deductions (`borne_by`), never its categories
  // and never the page's own deduction read, which a Procurement user is refused (#1451).
  const paidParts = amountPaidParts(amountPaid, workOrderTds);

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
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {/* Total Value */}
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">
                  Total Value {gstEnabled ? "(Incl. GST)" : "(Excl. GST)"}
                </p>
                <p className="text-sm font-semibold text-blue-600">
                  {/* The server's stored total (#1543), never items x 1.18 worked out here: the payment
                      limit and Amount Due measure against it. Every figure here rounds to the nearest rupee. */}
                  {formatToRoundedIndianRupee(orderData?.total_amount)}
                </p>
              </div>

              {/* Total Amount Invoiced */}
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">Total Amount Invoiced</p>
                <p className="text-sm font-medium text-blue-600">
                  {formatToRoundedIndianRupee(orderData?.amount_invoiced || 0)}
                </p>
                {/* GST Invoiced (ADR-0030): GST on the approved invoices, not GST paid. */}
                {(gstEnabled || !!orderData?.gst_invoiced) && (
                  <p className="text-[11px] text-gray-500">
                    GST Invoiced{" "}
                    <span className="font-medium text-gray-700 tabular-nums">
                      {formatToRoundedIndianRupee(orderData?.gst_invoiced || 0)}
                    </span>
                  </p>
                )}
              </div>

              {/* Amount Paid: payments + the vendor's TDS - refunds; the hover splits it */}
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">Amount Paid</p>
                {paidParts ? (
                  <HoverCard openDelay={100}>
                    <HoverCardTrigger asChild>
                      <p className="text-sm font-medium text-green-600 tabular-nums underline decoration-dotted underline-offset-4 cursor-help">
                        {formatToRoundedIndianRupee(amountPaid)}
                      </p>
                    </HoverCardTrigger>
                    <HoverCardContent className="w-72" align="start">
                      <p className="text-xs font-semibold mb-2">Amount Paid</p>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between gap-4">
                          <span className="text-gray-500">Paid to vendor</span>
                          <span className="font-medium tabular-nums">{formatToRoundedIndianRupee(paidParts.paidToVendor)}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-gray-500">TDS withheld</span>
                          <span className="font-medium tabular-nums">{formatToRoundedIndianRupee(paidParts.tdsWithheld)}</span>
                        </div>
                        <div className="flex justify-between gap-4 border-t pt-1">
                          <span className="font-semibold">Total</span>
                          <span className="font-semibold tabular-nums">{formatToRoundedIndianRupee(paidParts.total)}</span>
                        </div>
                        {paidParts.companyOnTop > 0 && (
                          <div className="flex justify-between gap-4 pt-2 text-gray-500">
                            <span>TDS paid by company (on top)</span>
                            <span className="tabular-nums">{formatToRoundedIndianRupee(paidParts.companyOnTop)}</span>
                          </div>
                        )}
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                ) : (
                  <p className="text-sm font-medium text-green-600 tabular-nums">
                    {formatToRoundedIndianRupee(amountPaid)}
                  </p>
                )}
              </div>

              {/* Amount Due: negative when the WO is overpaid */}
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">Amount Due</p>
                <p className={`text-sm font-medium tabular-nums ${amountDue < 0 ? "text-red-600" : "text-yellow-600"}`}>
                  {formatToRoundedIndianRupee(amountDue)}
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

            {/* Approved: the stored first approval (#1532), not the last edit; shown whenever there is one,
                so a Work Order under amendment (or Finalized) still says when and by whom it was approved */}
            {orderData?.approved_on && (
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">Approved</p>
                <p className="text-sm">{formatDate(orderData.approved_on)}</p>
                {approvedBy && (
                  <p className="text-xs text-gray-400">by {approvedBy}</p>
                )}
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
            {showsRequestPayment && (
              <Button
                variant="outline"
                size="sm"
                disabled={underAmendment}
                onClick={onRequestPayment}
                className="flex items-center gap-1 border-primary text-primary shrink-0"
                title={underAmendment ? UNDER_AMENDMENT_PAYMENT_NOTE : undefined}
              >
                Request Payment
              </Button>
            )}

            {/* ─── Edit Actions (Hidden when finalized) ─── */}
            {/* Amend Button */}
            {showsAmend && (
              <Button
                variant="outline"
                size="sm"
                disabled={underAmendment || !!amendBlockedReason}
                onClick={onAmend}
                className="flex items-center gap-1 border-primary text-primary shrink-0 transition-opacity"
                title={underAmendment ? "An amendment is already in progress" : amendBlockedReason || undefined}
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
        {actionNote && (
          <p className="text-xs text-amber-700 sm:text-right" data-testid="sr-amendment-note">
            {actionNote}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default SRDetailsCard;
