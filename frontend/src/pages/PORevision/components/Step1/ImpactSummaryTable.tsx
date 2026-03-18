import React from "react";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import formatToIndianRupee from "@/utils/FormatPrice";
import { SummaryData, DifferenceData } from "../../types";

interface ImpactSummaryTableProps {
  beforeSummary: SummaryData;
  afterSummary: SummaryData;
  difference: DifferenceData;
  netImpact: number;
}

export const ImpactSummaryTable: React.FC<ImpactSummaryTableProps> = ({
  beforeSummary,
  afterSummary,
  difference,
  netImpact
}) => {
  const isIncrease = difference.inclGst > 0;
  const isZero = difference.inclGst === 0;

  const ImpactIcon = isZero ? Minus : isIncrease ? TrendingUp : TrendingDown;
  const impactColor = isZero ? "text-gray-500" : isIncrease ? "text-red-600" : "text-emerald-600";
  const impactBg = isZero ? "bg-gray-50" : isIncrease ? "bg-red-50/60" : "bg-emerald-50/60";
  const impactBorder = isZero ? "border-gray-200" : isIncrease ? "border-red-100" : "border-emerald-100";
  const impactLabel = isZero ? "No Change" : isIncrease ? "PO Amount Increase" : "PO Amount Decrease";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ImpactIcon className={`h-4 w-4 ${impactColor}`} />
        <h3 className="font-semibold text-xs text-gray-700 uppercase tracking-wide">Revision Impact</h3>
      </div>
      <div className="border border-gray-200 rounded-md overflow-hidden">
        <Table className="text-xs">
          <TableHeader className="bg-gray-50">
            <TableRow className="h-9 hover:bg-transparent">
              <TableHead className="font-semibold uppercase text-[10px] text-gray-500"></TableHead>
              <TableHead className="font-semibold uppercase text-[10px] text-gray-500">Before</TableHead>
              <TableHead className="font-semibold uppercase text-[10px] text-gray-500">After</TableHead>
              <TableHead className="font-semibold uppercase text-[10px] text-gray-500">Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="h-10 hover:bg-gray-50/50">
              <TableCell className="text-gray-600 font-medium">Excl. GST</TableCell>
              <TableCell className="font-medium text-gray-500">{formatToIndianRupee(beforeSummary.totalExclGst)}</TableCell>
              <TableCell className="font-medium text-gray-900">{formatToIndianRupee(afterSummary.totalExclGst)}</TableCell>
              <TableCell className={`font-semibold ${difference.exclGst < 0 ? "text-emerald-600" : difference.exclGst > 0 ? "text-red-600" : "text-gray-500"}`}>
                {difference.exclGst === 0 ? "--" : `${difference.exclGst > 0 ? "+" : ""}${formatToIndianRupee(difference.exclGst)}`}
              </TableCell>
            </TableRow>
            <TableRow className="h-10 hover:bg-gray-50/50">
              <TableCell className="text-gray-600 font-medium">Incl. GST</TableCell>
              <TableCell className="font-medium text-gray-500">{formatToIndianRupee(beforeSummary.totalInclGst)}</TableCell>
              <TableCell className="font-medium text-gray-900">{formatToIndianRupee(afterSummary.totalInclGst)}</TableCell>
              <TableCell className={`font-semibold ${difference.inclGst < 0 ? "text-emerald-600" : difference.inclGst > 0 ? "text-red-600" : "text-gray-500"}`}>
                {difference.inclGst === 0 ? "--" : `${difference.inclGst > 0 ? "+" : ""}${formatToIndianRupee(difference.inclGst)}`}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {/* Net Impact Banner */}
        <div className={`px-4 py-3 flex items-center justify-between border-t ${impactBorder} ${impactBg}`}>
          <div className="flex items-center gap-3">
            <div className={`p-1.5 rounded-md ${isZero ? "bg-gray-100" : isIncrease ? "bg-red-100" : "bg-emerald-100"}`}>
              <ImpactIcon className={`h-4 w-4 ${impactColor}`} />
            </div>
            <div>
              <p className={`text-[10px] font-semibold uppercase tracking-wider ${impactColor}`}>Net Impact</p>
              <p className={`text-xs font-medium ${impactColor}`}>{impactLabel}</p>
            </div>
          </div>
          <span className={`text-xl font-bold tabular-nums ${impactColor}`}>
            {isZero ? "--" : `${isIncrease ? "+" : "-"}${formatToIndianRupee(netImpact)}`}
          </span>
        </div>
      </div>
    </div>
  );
};
