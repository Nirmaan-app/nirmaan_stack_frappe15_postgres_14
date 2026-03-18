import React, { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  ChevronRight,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  MessageSquareText,
  ArrowUpDown,
  Wallet,
  History,
  ArrowLeftRight,
} from "lucide-react";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import PORevisionPaymentRectification from "@/pages/PORevision/components/detail/PORevisionPaymentRectification";
import { useRevisionHistory } from "@/pages/PORevision/data/usePORevisionQueries";
import {
  usePOAdjustment,
  type POAdjustmentDoc,
} from "@/pages/POAdjustment/data/usePOAdjustmentQueries";
import { useUserData } from "@/hooks/useUserData";

interface PORevisionsAndAdjustmentsProps {
  poId: string;
}

const REVISION_ROLES = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
  "Nirmaan Accountant Profile",
  "Nirmaan Procurement Executive Profile",
];

const statusConfig: Record<
  string,
  { bg: string; text: string; dot: string; border: string }
> = {
  Pending: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    dot: "bg-amber-400",
    border: "border-amber-200",
  },
  Approved: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    dot: "bg-emerald-400",
    border: "border-emerald-200",
  },
  Rejected: {
    bg: "bg-rose-50",
    text: "text-rose-700",
    dot: "bg-rose-400",
    border: "border-rose-200",
  },
};

const ENTRY_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  "Revision Impact": { bg: "bg-orange-50", text: "text-orange-700" },
  "Auto Absorb": { bg: "bg-blue-50", text: "text-blue-700" },
  "Term Addition": { bg: "bg-emerald-50", text: "text-emerald-700" },
  "Term Rebalance": { bg: "bg-purple-50", text: "text-purple-700" },
  "Against PO": { bg: "bg-indigo-50", text: "text-indigo-700" },
  Adhoc: { bg: "bg-yellow-50", text: "text-yellow-800" },
  "Vendor Refund": { bg: "bg-rose-50", text: "text-rose-700" },
};

export const PORevisionsAndAdjustments: React.FC<
  PORevisionsAndAdjustmentsProps
> = ({ poId }) => {
  const { data: revisions, isLoading: revisionsLoading } =
    useRevisionHistory(poId);
  const { adjustment, isLoading: adjustmentLoading } = usePOAdjustment(poId);
  const { role } = useUserData();

  const isRevisionAllowed = REVISION_ROLES.includes(role);
  const revisionList =
    isRevisionAllowed && revisions?.length ? revisions : [];
  const adjustmentItems = adjustment?.adjustment_items || [];

  const hasRevisions = revisionList.length > 0;
  const hasAdjustments = adjustmentItems.length > 0;

  if (revisionsLoading && adjustmentLoading) return null;
  if (!hasRevisions && !hasAdjustments) return null;

  return (
    <Card className="rounded-sm md:col-span-3 p-2">
      <Accordion type="multiple" className="w-full">
        <AccordionItem value="revisions-adjustments">
          <AccordionTrigger>
            <div className="flex items-center gap-3 pl-6">
              <p className="font-semibold text-lg text-red-600">
                Revisions & Adjustments
              </p>
              <div className="flex items-center gap-2 text-sm">
                {hasRevisions && (
                  <>
                    <span className="text-gray-600">Revisions:</span>
                    <Badge variant="secondary">{revisionList.length}</Badge>
                  </>
                )}
                {hasRevisions && hasAdjustments && (
                  <span className="text-gray-400">|</span>
                )}
                {hasAdjustments && (
                  <>
                    <span className="text-gray-600">Adjustments:</span>
                    <Badge variant="secondary">{adjustmentItems.length}</Badge>
                    {adjustment?.status === "Pending" &&
                      adjustment.remaining_impact !== 0 && (
                        <Badge
                          variant="outline"
                          className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]"
                        >
                          {formatToIndianRupee(
                            Math.abs(adjustment.remaining_impact)
                          )}{" "}
                          remaining
                        </Badge>
                      )}
                  </>
                )}
              </div>
            </div>
          </AccordionTrigger>

          <AccordionContent>
            <div className={`px-4 pt-2 pb-1 ${hasRevisions && hasAdjustments ? "grid grid-cols-1 md:grid-cols-2 gap-6" : ""}`}>
              {/* ── Revision History Sub-section ── */}
              {hasRevisions && (
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-3">
                    <History className="h-4 w-4 text-red-500" />
                    <h4 className="text-sm font-semibold text-slate-700">
                      Revision History
                    </h4>
                    <div className="h-5 w-5 rounded-full bg-slate-200 flex items-center justify-center">
                      <span className="text-[10px] font-bold text-slate-600">
                        {revisionList.length}
                      </span>
                    </div>
                  </div>

                  <div className="relative ml-3">
                    {/* Timeline line */}
                    <div className="absolute left-[7px] top-4 bottom-4 w-[2px] bg-gradient-to-b from-slate-200 via-slate-200 to-transparent" />
                    <div className="space-y-3">
                      {revisionList.map((rev: any) => (
                        <RevisionCard key={rev.name} revision={rev} />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Payment Adjustments Sub-section ── */}
              {hasAdjustments && (
                <AdjustmentsList adjustment={adjustment!} />
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
   Revision Card (timeline item) — preserved from PORevisionHistory
   ───────────────────────────────────────────────────────────────────────────── */

const RevisionCard: React.FC<{ revision: any }> = ({ revision }) => {
  const [open, setOpen] = useState(false);

  const diff = revision.total_amount_difference || 0;
  const isPositive = diff > 0;
  const isNegative = diff < 0;
  const status = statusConfig[revision.status] || statusConfig.Pending;

  const revisionItems = revision.revision_items || [];
  const originalTotalInclTax = revision.original_total_incl_tax || 0;
  const revisedTotalInclTax = revision.revised_total_incl_tax || 0;

  return (
    <div className="relative pl-6">
      {/* Timeline dot */}
      <div
        className={`absolute left-0 top-4 h-[14px] w-[14px] rounded-full border-2 border-white shadow-sm ${status.dot} z-10`}
      />

      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            className={`w-full flex items-center justify-between px-4 py-3 bg-white border rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-all duration-200 text-left ${open ? "rounded-b-none border-b-0" : ""}`}
          >
            <div className="flex items-center gap-3">
              <ChevronRight
                className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-200 shrink-0 ${open ? "rotate-90" : ""}`}
              />
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-slate-800 tracking-tight">
                    {revision.name}
                  </p>
                  <Badge
                    variant="outline"
                    className={`text-[9px] py-0 h-[18px] font-semibold ${status.bg} ${status.text} ${status.border}`}
                  >
                    {revision.status}
                  </Badge>
                  {revision.approved_by && revision.status === "Approved" && (
                    <span className="text-[10px] font-medium">
                      {revision.approved_by === "System"
                        ? <span className="text-teal-600">Auto-Approved</span>
                        : <span className="text-slate-400">by {revision.approved_by}</span>}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {revision.creation
                    ? formatDate(revision.creation)
                    : "N/A"}
                </p>
              </div>
            </div>
            <div
              className={`flex items-center gap-1.5 text-xs font-bold tabular-nums ${isPositive ? "text-emerald-600" : isNegative ? "text-rose-600" : "text-slate-500"}`}
            >
              {isPositive ? (
                <TrendingUp className="h-3.5 w-3.5" />
              ) : isNegative ? (
                <TrendingDown className="h-3.5 w-3.5" />
              ) : null}
              <span>
                {isPositive ? "+" : ""}
                {formatToIndianRupee(diff)}
              </span>
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border border-t-0 rounded-b-xl bg-gradient-to-b from-white to-slate-50/50 px-4 py-4 space-y-4">
            {/* Amount Summary Cards */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                <p className="text-[9px] font-medium text-slate-400 uppercase tracking-wider">
                  Before
                </p>
                <p className="text-sm font-bold text-slate-700 mt-1 tabular-nums">
                  {formatToIndianRupee(originalTotalInclTax)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                <p className="text-[9px] font-medium text-slate-400 uppercase tracking-wider">
                  After
                </p>
                <p className="text-sm font-bold text-slate-700 mt-1 tabular-nums">
                  {formatToIndianRupee(revisedTotalInclTax)}
                </p>
              </div>
              <div
                className={`rounded-lg p-3 border ${isPositive ? "bg-emerald-50/60 border-emerald-100" : isNegative ? "bg-rose-50/60 border-rose-100" : "bg-slate-50 border-slate-100"}`}
              >
                <p className="text-[9px] font-medium text-slate-400 uppercase tracking-wider">
                  Impact (incl.GST)
                </p>
                <p
                  className={`text-sm font-bold mt-1 tabular-nums ${isPositive ? "text-emerald-600" : isNegative ? "text-rose-600" : "text-slate-600"}`}
                >
                  {isPositive ? "+" : ""}
                  {formatToIndianRupee(diff)}
                </p>
              </div>
            </div>

            {/* Justification */}
            {revision.revision_justification && (
              <div className="flex gap-2">
                <div className="mt-0.5">
                  <MessageSquareText className="h-3.5 w-3.5 text-slate-300" />
                </div>
                <div className="flex-1">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Reason for Revision
                  </p>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {revision.revision_justification}
                  </p>
                </div>
              </div>
            )}

            {/* Item Changes */}
            {(() => {
              const changedItems = revisionItems.filter(
                (item: any) => item.item_type !== "Original"
              );
              if (changedItems.length === 0) return null;
              return (
                <div className="flex gap-2">
                  <div className="mt-0.5">
                    <ArrowUpDown className="h-3.5 w-3.5 text-slate-300" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                      Items Changed
                      <span className="ml-1 text-slate-300">
                        ({changedItems.length})
                      </span>
                    </p>
                    <div className="rounded-lg border border-slate-100 overflow-hidden max-h-[200px] overflow-y-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-slate-50/80 border-b border-slate-100">
                            <th className="text-left pl-3 py-2 text-[9px] font-semibold text-slate-400 uppercase tracking-wider w-[60px]">
                              Type
                            </th>
                            <th className="text-left py-2 text-[9px] font-semibold text-slate-400 uppercase tracking-wider">
                              Item
                            </th>
                            <th className="text-center py-2 text-[9px] font-semibold text-slate-400 uppercase tracking-wider w-[140px]">
                              Changes
                            </th>
                            <th className="text-right pr-3 py-2 text-[9px] font-semibold text-slate-400 uppercase tracking-wider w-[90px]">
                              Amount
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {changedItems.map((item: any, idx: number) => (
                            <ItemChangeRow key={idx} item={item} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Payment Rectification */}
            {revision.payment_return_details && (
              <div className="flex gap-2">
                <div className="mt-0.5">
                  <Wallet className="h-3.5 w-3.5 text-slate-300" />
                </div>
                <div className="flex-1">
                  <PORevisionPaymentRectification
                    paymentData={revision.payment_return_details}
                  />
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
   Item Change Row — extracted for readability
   ───────────────────────────────────────────────────────────────────────────── */

const ItemChangeRow: React.FC<{ item: any }> = ({ item }) => {
  const origAmt = Number(item.original_amount || 0);
  const revAmt = Number(item.revision_amount || 0);
  const itemDiff =
    item.item_type === "Deleted"
      ? -origAmt
      : item.item_type === "New"
        ? revAmt
        : revAmt - origAmt;

  const typeBadge = (
    {
      New: { bg: "bg-emerald-100", text: "text-emerald-700" },
      Deleted: { bg: "bg-rose-100", text: "text-rose-700" },
      Revised: { bg: "bg-blue-100", text: "text-blue-700" },
      Replace: { bg: "bg-blue-100", text: "text-blue-700" },
    } as Record<string, { bg: string; text: string }>
  )[item.item_type] || { bg: "bg-slate-100", text: "text-slate-600" };

  const origQty = item.original_qty || 0;
  const revQty = item.revision_qty || 0;
  const origRate = item.original_rate || 0;
  const revRate = item.revision_rate || 0;

  const qtyChanged =
    item.item_type === "Deleted" ||
    item.item_type === "New" ||
    origQty !== revQty;
  const rateChanged =
    item.item_type === "Deleted" ||
    item.item_type === "New" ||
    origRate !== revRate;

  return (
    <tr className="hover:bg-slate-50/50 transition-colors border-b border-slate-50 last:border-0">
      <td className="pl-3 py-2.5">
        <span
          className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${typeBadge.bg} ${typeBadge.text}`}
        >
          {item.item_type}
        </span>
      </td>
      <td className="py-2.5 pr-2">
        <span className="text-[11px] text-slate-700 font-medium line-clamp-1">
          {item.revision_item_name || item.original_item_name || "--"}
        </span>
      </td>
      <td className="py-2.5 text-center">
        <div className="flex flex-col items-center gap-1">
          {qtyChanged && (
            <ChangeChip
              label="Qty"
              itemType={item.item_type}
              original={origQty}
              revised={revQty}
            />
          )}
          {rateChanged && (
            <ChangeChip
              label="Rate"
              itemType={item.item_type}
              original={origRate}
              revised={revRate}
              formatFn={formatToIndianRupee}
            />
          )}
        </div>
      </td>
      <td
        className={`text-right pr-3 py-2.5 text-[10px] font-semibold tabular-nums ${itemDiff > 0 ? "text-emerald-600" : itemDiff < 0 ? "text-rose-600" : "text-slate-400"}`}
      >
        {itemDiff !== 0
          ? (itemDiff > 0 ? "+" : "") + formatToIndianRupee(itemDiff)
          : "--"}
      </td>
    </tr>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
   Change Chip — qty/rate change display
   ───────────────────────────────────────────────────────────────────────────── */

const ChangeChip: React.FC<{
  label: string;
  itemType: string;
  original: number;
  revised: number;
  formatFn?: (v: number) => string;
}> = ({ label, itemType, original, revised, formatFn }) => {
  const fmt = formatFn || String;
  return (
    <div className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-50 rounded border border-slate-100/50">
      <span className="text-[9px] font-medium text-slate-400 uppercase tracking-tighter">
        {label}:
      </span>
      {itemType === "Deleted" ? (
        <span className="text-[10px] text-rose-500 line-through">
          {fmt(original)}
        </span>
      ) : itemType === "New" ? (
        <span className="text-[10px] text-emerald-600 font-medium">
          {fmt(revised)}
        </span>
      ) : (
        <span className="text-[10px] text-slate-600 flex items-center gap-1">
          {fmt(original)}{" "}
          <ArrowRight className="h-2 w-2 text-slate-300" />{" "}
          <span className="font-medium text-slate-800">{fmt(revised)}</span>
        </span>
      )}
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
   Adjustments List — restyled to match revision timeline design
   ───────────────────────────────────────────────────────────────────────────── */

const AdjustmentsList: React.FC<{ adjustment: POAdjustmentDoc }> = ({
  adjustment,
}) => {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <ArrowLeftRight className="h-4 w-4 text-red-500" />
        <h4 className="text-sm font-semibold text-slate-700">
          Payment Adjustments
        </h4>
        <div className="h-5 w-5 rounded-full bg-slate-200 flex items-center justify-center">
          <span className="text-[10px] font-bold text-slate-600">
            {adjustment.adjustment_items.length}
          </span>
        </div>
        {adjustment.status === "Pending" && (
          <Badge
            variant="outline"
            className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-semibold"
          >
            Pending
          </Badge>
        )}
        {adjustment.status === "Done" && (
          <Badge
            variant="outline"
            className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-semibold"
          >
            Done
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        {adjustment.adjustment_items.map((item, idx) => {
          const colors = ENTRY_TYPE_COLORS[item.entry_type] || {
            bg: "bg-slate-50",
            text: "text-slate-600",
          };
          const isNeg = item.amount < 0;

          return (
            <div
              key={idx}
              className="flex items-start justify-between px-4 py-3 bg-white border border-slate-100 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-all duration-200"
            >
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${colors.bg} ${colors.text}`}
                  >
                    {item.entry_type}
                  </span>
                  {item.revision_id && (
                    <span className="text-[10px] text-slate-400 font-medium">
                      {item.revision_id}
                    </span>
                  )}
                </div>
                {item.description && (
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    {item.description}
                  </p>
                )}
                {item.target_po && (
                  <p className="text-[11px] text-slate-600 font-medium">
                    Target: {item.target_po}
                  </p>
                )}
                {item.timestamp && (
                  <p className="text-[10px] text-slate-400">
                    {formatDate(item.timestamp)}
                  </p>
                )}
              </div>
              <span
                className={`text-xs font-bold tabular-nums shrink-0 ml-3 ${isNeg ? "text-rose-600" : "text-emerald-600"}`}
              >
                {isNeg ? "-" : "+"}
                {formatToIndianRupee(Math.abs(item.amount))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PORevisionsAndAdjustments;
