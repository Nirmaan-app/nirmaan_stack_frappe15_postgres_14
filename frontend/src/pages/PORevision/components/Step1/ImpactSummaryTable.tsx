import React from "react";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Wallet, BarChart2 } from "lucide-react";
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
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BarChart2 className="h-4 w-4 text-red-600" />
        <h3 className="font-bold text-[13px] text-gray-700 uppercase tracking-tight">Revision Impact Summary</h3>
      </div>
      <div className="border rounded-md overflow-hidden bg-white">
        <Table className="text-xs">
          <TableHeader className="bg-gray-100/50">
            <TableRow className="h-9 hover:bg-transparent">
              <TableHead className="font-bold uppercase text-[10px]">TYPE</TableHead>
              <TableHead className="font-bold uppercase text-[10px]">BEFORE</TableHead>
              <TableHead className="font-bold uppercase text-[10px]">AFTER</TableHead>
              <TableHead className="font-bold uppercase text-[10px]">DIFFERENCE</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="h-10 hover:bg-gray-50/50">
              <TableCell className="text-gray-500 font-medium">Total Excl. GST</TableCell>
              <TableCell className="font-medium text-gray-500">{formatToIndianRupee(beforeSummary.totalExclGst)}</TableCell>
              <TableCell className="font-medium text-gray-900">{formatToIndianRupee(afterSummary.totalExclGst)}</TableCell>
              <TableCell className={`font-bold ${difference.exclGst < 0 ? "text-red-500" : "text-green-600"}`}>
                {difference.exclGst < 0 ? "- " : "+ "}{formatToIndianRupee(Math.abs(difference.exclGst))}
              </TableCell>
            </TableRow>
            <TableRow className="h-10 hover:bg-gray-50/50 bg-gray-50/30">
              <TableCell className="text-gray-500 font-medium">Total Incl. GST</TableCell>
              <TableCell className="font-medium text-gray-500">{formatToIndianRupee(beforeSummary.totalInclGst)}</TableCell>
              <TableCell className="font-medium text-gray-900">{formatToIndianRupee(afterSummary.totalInclGst)}</TableCell>
              <TableCell className={`font-bold ${difference.inclGst < 0 ? "text-red-500" : "text-green-600"}`}>
                {difference.inclGst < 0 ? "- " : "+ "}{formatToIndianRupee(Math.abs(difference.inclGst))}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <div className={`p-4 flex items-center justify-between ${difference.inclGst < 0 ? "bg-green-50/80" : "bg-red-50/80"}`}>
          <div className="flex items-center gap-4">
            <div className={`p-2.5 rounded-lg ${difference.inclGst < 0 ? "bg-green-100" : "bg-red-100"}`}>
              <Wallet className={`h-6 w-6 ${difference.inclGst < 0 ? "text-green-600" : "text-red-600"}`} />
            </div>
            <div>
              <p className={`text-[10px] font-black uppercase tracking-widest ${difference.inclGst < 0 ? "text-green-600/80" : "text-red-600/80"}`}>NET IMPACT</p>
              <p className={`text-[13px] font-bold ${difference.inclGst < 0 ? "text-green-700" : "text-red-700"}`}>
                {difference.inclGst < 0 ? "Amount to be Refunded" : "Additional Payable"}
              </p>
            </div>
          </div>
          <div className={`text-3xl font-black ${difference.inclGst < 0 ? "text-green-600" : "text-red-600"}`}>
            {formatToIndianRupee(netImpact)}
          </div>
        </div>
      </div>
    </div>
  );
};
