import React from "react";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FileText, Edit3 } from "lucide-react";
import formatToIndianRupee from "@/utils/FormatPrice";
import { RevisionItem, DifferenceData } from "../../types";
import { ImpactSummaryTable } from "../Step1/ImpactSummaryTable";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";

interface Step3SummaryProps {
  revisionItems: RevisionItem[];
  justification: string;
  difference: DifferenceData;
  po: ProcurementOrder;
  beforeSummary: any;
  afterSummary: any;
  netImpact: number;
}

const STATUS_STYLES: Record<string, string> = {
  New: "bg-emerald-50 text-emerald-700",
  Revised: "bg-blue-50 text-blue-700",
  Replace: "bg-amber-50 text-amber-700",
  Deleted: "bg-red-50 text-red-700",
};

export const Step3Summary: React.FC<Step3SummaryProps> = ({
  revisionItems,
  justification,
  difference,
  po,
  beforeSummary,
  afterSummary,
  netImpact,
}) => {
  const changedItems = revisionItems.filter(i => i.item_type !== "Original");

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left — Item Changes + Justification */}
        <div className="space-y-5">
          <div>
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2 mb-3">
              <FileText className="h-4 w-4 text-primary" />
              Item Changes
            </h3>
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <Table className="text-xs">
                <TableHeader className="bg-gray-50">
                  <TableRow className="h-9 hover:bg-transparent">
                    <TableHead className="text-[10px] font-semibold uppercase text-gray-500 pl-4">Item</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase text-gray-500">Status</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase text-gray-500 text-right pr-4">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {changedItems.map((item, idx) => {
                    const amount = (item.quantity || 0) * (item.quote || 0);
                    const totalAmount = amount + (amount * (item.tax || 0) / 100);
                    const original = item.original_row_id ? po.items?.find(i => i.name === item.original_row_id) : null;

                    const details: string[] = [];
                    if (original && (item.item_type === "Revised" || item.item_type === "Replace")) {
                      if (item.quantity !== original.quantity) details.push(`Qty: ${original.quantity} → ${item.quantity}`);
                      if (item.quote !== original.quote) details.push(`Rate: ${formatToIndianRupee(original.quote)} → ${formatToIndianRupee(item.quote || 0)}`);
                      if (item.tax !== original.tax) details.push(`Tax: ${original.tax}% → ${item.tax}%`);
                    } else if (item.item_type === "New") {
                      details.push(`Qty: ${item.quantity}, Rate: ${formatToIndianRupee(item.quote || 0)}`);
                    }

                    return (
                      <TableRow key={idx} className="h-14 border-b last:border-0 hover:bg-gray-50/50">
                        <TableCell className="pl-4 py-3">
                          <div className="font-medium text-gray-900 leading-tight mb-0.5">{item.item_name}</div>
                          {details.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {details.map((d, i) => (
                                <span key={i} className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">
                                  {d}
                                </span>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="py-3">
                          <Badge
                            variant="outline"
                            className={`text-[9px] px-2 py-0.5 border-none font-semibold uppercase tracking-wide ${STATUS_STYLES[item.item_type] || ""}`}
                          >
                            {item.item_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-4 py-3 font-semibold text-gray-900 tabular-nums">
                          {item.item_type === "Deleted" ? (
                            <span className="text-red-500 line-through">{formatToIndianRupee(totalAmount)}</span>
                          ) : (
                            formatToIndianRupee(totalAmount)
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {changedItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-gray-400 py-10 text-xs italic">
                        No items were changed
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Justification */}
          <div className="bg-gray-50 p-5 rounded-md border border-gray-200">
            <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Edit3 className="h-3.5 w-3.5 text-primary" />
              Justification
            </h4>
            <p className="text-gray-700 leading-relaxed text-sm italic">
              &ldquo;{justification || "No justification provided."}&rdquo;
            </p>
          </div>
        </div>

        {/* Right — Financial Summary */}
        <div>
          <ImpactSummaryTable
            beforeSummary={beforeSummary}
            afterSummary={afterSummary}
            difference={difference}
            netImpact={netImpact}
          />
        </div>
      </div>
    </div>
  );
};
