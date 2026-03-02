import React, { useState } from "react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  ChevronRight,
  History,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  MessageSquareText,
  ArrowUpDown,
  Wallet,
} from "lucide-react";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import PORevisionPaymentRectification from "./detail/PORevisionPaymentRectification";
import { useRevisionHistory } from "../data/usePORevisionQueries";

interface PORevisionHistoryProps {
  poId: string;
}

const statusConfig: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  Pending: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-400", border: "border-amber-200" },
  Approved: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-400", border: "border-emerald-200" },
  Rejected: { bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-400", border: "border-rose-200" },
};

export const PORevisionHistory: React.FC<PORevisionHistoryProps> = ({ poId }) => {
  const [sectionOpen, setSectionOpen] = useState(false);

  const { data: revisions, isLoading } = useRevisionHistory(poId);


  if (isLoading || !revisions || revisions.length === 0) {
    return null;
  }

  return (
    <div className="mt-4">
      <Collapsible open={sectionOpen} onOpenChange={setSectionOpen}>
        <CollapsibleTrigger asChild>
          <button className="group w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-slate-50 to-slate-100/80 border border-slate-200 rounded-xl hover:from-slate-100 hover:to-slate-50 transition-all duration-200">
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-lg bg-red-50 border border-red-100 flex items-center justify-center group-hover:bg-red-100 transition-colors">
                <History className="h-3.5 w-3.5 text-red-500" />
              </div>
              <span className="font-semibold text-sm text-slate-700 tracking-tight">
                Revision History
              </span>
              <div className="h-5 w-5 rounded-full bg-slate-200 flex items-center justify-center">
                <span className="text-[10px] font-bold text-slate-600">{revisions.length}</span>
              </div>
            </div>
            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${sectionOpen ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="relative mt-3 ml-3">
            {/* Timeline line */}
            <div className="absolute left-[7px] top-4 bottom-4 w-[2px] bg-gradient-to-b from-slate-200 via-slate-200 to-transparent" />

            <div className="space-y-3">
              {revisions.map((rev: any) => (
                <RevisionCard key={rev.name} revision={rev} />
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

interface RevisionCardProps {
  revision: any;
}

const RevisionCard: React.FC<RevisionCardProps> = ({ revision }) => {
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
      <div className={`absolute left-0 top-4 h-[14px] w-[14px] rounded-full border-2 border-white shadow-sm ${status.dot} z-10`} />

      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button className={`w-full flex items-center justify-between px-4 py-3 bg-white border rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-all duration-200 text-left ${open ? "rounded-b-none border-b-0" : ""}`}>
            <div className="flex items-center gap-3">
              <ChevronRight className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-200 shrink-0 ${open ? "rotate-90" : ""}`} />
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-slate-800 tracking-tight">{revision.name}</p>
                  <Badge variant="outline" className={`text-[9px] py-0 h-[18px] font-semibold ${status.bg} ${status.text} ${status.border}`}>
                    {revision.status}
                  </Badge>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {revision.creation ? formatDate(revision.creation) : "N/A"}
                </p>
              </div>
            </div>
            <div className={`flex items-center gap-1.5 text-xs font-bold tabular-nums ${isPositive ? "text-emerald-600" : isNegative ? "text-rose-600" : "text-slate-500"}`}>
              {isPositive ? (
                <TrendingUp className="h-3.5 w-3.5" />
              ) : isNegative ? (
                <TrendingDown className="h-3.5 w-3.5" />
              ) : null}
              <span>{isPositive ? "+" : ""}{formatToIndianRupee(diff)}</span>
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border border-t-0 rounded-b-xl bg-gradient-to-b from-white to-slate-50/50 px-4 py-4 space-y-4">

            {/* Amount Summary Cards */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                <p className="text-[9px] font-medium text-slate-400 uppercase tracking-wider">Before</p>
                <p className="text-sm font-bold text-slate-700 mt-1 tabular-nums">
                  {formatToIndianRupee(originalTotalInclTax)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                <p className="text-[9px] font-medium text-slate-400 uppercase tracking-wider">After</p>
                <p className="text-sm font-bold text-slate-700 mt-1 tabular-nums">
                  {formatToIndianRupee(revisedTotalInclTax)}
                </p>
              </div>
              <div className={`rounded-lg p-3 border ${isPositive ? "bg-emerald-50/60 border-emerald-100" : isNegative ? "bg-rose-50/60 border-rose-100" : "bg-slate-50 border-slate-100"}`}>
                <p className="text-[9px] font-medium text-slate-400 uppercase tracking-wider">Impact</p>
                <p className={`text-sm font-bold mt-1 tabular-nums ${isPositive ? "text-emerald-600" : isNegative ? "text-rose-600" : "text-slate-600"}`}>
                  {isPositive ? "+" : ""}{formatToIndianRupee(diff)}
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
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Reason for Revision</p>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {revision.revision_justification}
                  </p>
                </div>
              </div>
            )}

            {/* Item Changes */}
            {(() => {
              const changedItems = revisionItems.filter((item: any) => item.item_type !== "Original");
              if (changedItems.length === 0) return null;
              return (
                <div className="flex gap-2">
                  <div className="mt-0.5">
                    <ArrowUpDown className="h-3.5 w-3.5 text-slate-300" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                      Items Changed
                      <span className="ml-1 text-slate-300">({changedItems.length})</span>
                    </p>
                    <div className="rounded-lg border border-slate-100 overflow-hidden max-h-[200px] overflow-y-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-slate-50/80 border-b border-slate-100">
                            <th className="text-left pl-3 py-2 text-[9px] font-semibold text-slate-400 uppercase tracking-wider w-[60px]">Type</th>
                            <th className="text-left py-2 text-[9px] font-semibold text-slate-400 uppercase tracking-wider">Item</th>
                            <th className="text-center py-2 text-[9px] font-semibold text-slate-400 uppercase tracking-wider w-[100px]">Qty Change</th>
                            <th className="text-right pr-3 py-2 text-[9px] font-semibold text-slate-400 uppercase tracking-wider w-[90px]">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {changedItems.map((item: any, idx: number) => {
                            const origAmt = Number(item.original_amount || 0);
                            const revAmt = Number(item.revision_amount || 0);
                            const itemDiff = item.item_type === "Deleted" ? -origAmt : item.item_type === "New" ? revAmt : revAmt - origAmt;

                            const typeBadge = ({
                              New: { bg: "bg-emerald-100", text: "text-emerald-700" },
                              Deleted: { bg: "bg-rose-100", text: "text-rose-700" },
                              Revised: { bg: "bg-blue-100", text: "text-blue-700" },
                              Replace: { bg: "bg-blue-100", text: "text-blue-700" },
                            } as Record<string, { bg: string; text: string }>)[item.item_type] || { bg: "bg-slate-100", text: "text-slate-600" };

                            const origQty = item.original_qty || 0;
                            const revQty = item.revision_qty || 0;

                            return (
                              <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                                <td className="pl-3 py-2">
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${typeBadge.bg} ${typeBadge.text}`}>
                                    {item.item_type}
                                  </span>
                                </td>
                                <td className="py-2 pr-2">
                                  <span className="text-[11px] text-slate-700 font-medium line-clamp-1">
                                    {item.revision_item_name || item.original_item_name || "--"}
                                  </span>
                                </td>
                                <td className="py-2 text-center">
                                  {item.item_type === "Deleted" ? (
                                    <span className="text-[10px] text-rose-500 line-through">{origQty}</span>
                                  ) : item.item_type === "New" ? (
                                    <span className="text-[10px] text-emerald-600 font-medium">{revQty}</span>
                                  ) : (
                                    <span className="text-[10px] text-slate-600">
                                      {origQty} <ArrowRight className="h-2.5 w-2.5 inline text-slate-300 mx-0.5" /> <span className="font-medium text-slate-800">{revQty}</span>
                                    </span>
                                  )}
                                </td>
                                <td className={`text-right pr-3 py-2 text-[10px] font-semibold tabular-nums ${itemDiff > 0 ? "text-emerald-600" : itemDiff < 0 ? "text-rose-600" : "text-slate-400"}`}>
                                  {itemDiff !== 0 ? (itemDiff > 0 ? "+" : "") + formatToIndianRupee(itemDiff) : "--"}
                                </td>
                              </tr>
                            );
                          })}
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
                  <PORevisionPaymentRectification paymentData={revision.payment_return_details} />
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

export default PORevisionHistory;
