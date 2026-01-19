import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { NirmaanComments as NirmaanCommentsType } from "@/types/NirmaanStack/NirmaanComments";
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { Timeline } from "antd";
import {
  ChevronDown,
  Eye,
  FileText,
  MessageSquare,
  PencilRuler,
  Printer,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

interface SRDetailsCardProps {
  orderData: ServiceRequests | undefined;
  project: Projects | undefined;
  vendor: Vendors | undefined;
  gstEnabled: boolean;
  getTotal: number;
  amountPaid: number;
  isRestrictedRole: boolean;
  usersList?: NirmaanUsersType[];
  universalComments?: NirmaanCommentsType[];
  // Action callbacks
  onPrint?: () => void;
  onDelete?: () => void;
  onAmend?: () => void;
  onAddInvoice?: () => void;
  onRequestPayment?: () => void;
  onPreview?: () => void;
  // Feature flags
  summaryPage?: boolean;
  accountsPage?: boolean;
  // Delete button disabled state
  deleteDisabled?: boolean;
  isDeleting?: boolean;
}

/**
 * SRDetailsCard - A sectioned card component displaying Work Order (SR) details
 *
 * Sections:
 * 1. Header - Title with Status badge
 * 2. Info - Project, Package, Vendor (with separators)
 * 3. Amounts - Total, Paid, Pending, GST status (color-coded)
 * 4. Timeline - Created, Modified, Approved dates
 * 5. Comments - Collapsible timeline of comments
 * 6. Actions - Role-conditional action buttons
 */
export const SRDetailsCard: React.FC<SRDetailsCardProps> = ({
  orderData,
  project,
  vendor,
  gstEnabled,
  getTotal,
  amountPaid,
  isRestrictedRole,
  usersList,
  universalComments,
  onPrint,
  onDelete,
  onAmend,
  onAddInvoice,
  onRequestPayment,
  onPreview,
  summaryPage = false,
  accountsPage = false,
  deleteDisabled = false,
  isDeleting = false,
}) => {
  const [commentsExpanded, setCommentsExpanded] = useState(false);

  // Get full name from user ID
  const getFullName = (id: string) => {
    return usersList?.find((user) => user.name === id)?.full_name;
  };

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

  // Calculate amount pending (total - paid)
  const calculatedAmountPending = useMemo(() => {
    const totalWithGst = gstEnabled ? getTotal * 1.18 : getTotal;
    return Math.max(0, Math.floor(totalWithGst) - amountPaid);
  }, [getTotal, gstEnabled, amountPaid]);

  // Build comments timeline
  const itemsTimelineList = useMemo(() => {
    return universalComments?.map((cmt) => ({
      label: (
        <span className="max-sm:text-wrap text-xs m-0 p-0">
          {formatDate(cmt.creation?.split(" ")[0])} {cmt.creation?.split(" ")[1]?.substring(0, 5)}
        </span>
      ),
      children: (
        <div className="bg-gray-50 rounded-md p-2 border border-gray-100">
          <div className="text-sm font-medium text-gray-700">
            {cmt.comment_by === "Administrator" ? (
              <span>Administrator</span>
            ) : (
              <span>{getFullName(cmt.comment_by || "") || cmt.comment_by}</span>
            )}
          </div>
          <div className="text-sm text-gray-600 mt-1">{cmt.content}</div>
        </div>
      ),
      color: cmt.subject
        ? cmt.subject === "creating pr"
          ? "green"
          : cmt.subject === "rejecting pr"
          ? "red"
          : "blue"
        : "gray",
    }));
  }, [universalComments, usersList]);

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
            SECTION 3: AMOUNTS - Financial figures (only when approved)
        ═══════════════════════════════════════════════════════════════════ */}
        {orderData?.status === "Approved" && (
          <div className="pb-3 border-b border-gray-100">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Amounts
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {/* Total Value */}
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">
                  Total Value {gstEnabled ? "(Incl. GST)" : "(Excl. GST)"}
                </p>
                <p className="text-sm font-semibold text-blue-600">
                  {formatToIndianRupee(Math.floor(getTotal * (gstEnabled ? 1.18 : 1)))}
                </p>
              </div>

              {/* Amount Paid */}
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">Amount Paid</p>
                <p className="text-sm font-medium text-green-600">
                  {formatToIndianRupee(amountPaid || 0)}
                </p>
              </div>

              {/* Amount Payable */}
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">Amount Payable</p>
                <p className="text-sm font-medium text-yellow-600">
                  {formatToIndianRupee(calculatedAmountPending)}
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
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
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
            {orderData?.status === "Approved" && (
              <div className="space-y-0.5">
                <p className="text-xs text-gray-500">Approved</p>
                <p className="text-sm">{orderData?.modified ? formatDate(orderData.modified) : "--"}</p>
              </div>
            )}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 5: COMMENTS - Collapsible
        ═══════════════════════════════════════════════════════════════════ */}
        {itemsTimelineList && itemsTimelineList.length > 0 && (
          <div className="pb-3 border-b border-gray-100">
            <Collapsible open={commentsExpanded} onOpenChange={setCommentsExpanded}>
              <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors w-full justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  <span>Comments ({itemsTimelineList.length})</span>
                </div>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    commentsExpanded ? "rotate-180" : ""
                  }`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                <Timeline className="w-full" mode={"left"} items={itemsTimelineList} />
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION 6: ACTIONS - All action buttons
        ═══════════════════════════════════════════════════════════════════ */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 sm:flex-wrap sm:justify-end">
          {/* For restricted roles (PM, Estimates Executive), only show Preview button */}
          {isRestrictedRole ? (
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
          ) : (
            <>
              {/* Delete Button */}
              {onDelete && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={deleteDisabled || isDeleting}
                  onClick={onDelete}
                  className="flex items-center gap-1 border-primary text-primary shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              )}

              {/* Amend Button */}
              {onAmend && !summaryPage && !accountsPage && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onAmend}
                  className="flex items-center gap-1 border-primary text-primary shrink-0"
                >
                  <PencilRuler className="h-3.5 w-3.5" />
                  Amend
                </Button>
              )}

              {/* Add Invoice Button */}
              {onAddInvoice && (
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
              {onRequestPayment && !summaryPage && !accountsPage && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRequestPayment}
                  className="flex items-center gap-1 border-primary text-primary shrink-0"
                >
                  Request Payment
                </Button>
              )}

              {/* Preview Button */}
              {onPreview && (
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

              {/* Print Button */}
              {onPrint && orderData?.status === "Approved" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onPrint}
                  className="flex items-center gap-1 border-primary text-primary shrink-0"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </Button>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default SRDetailsCard;
