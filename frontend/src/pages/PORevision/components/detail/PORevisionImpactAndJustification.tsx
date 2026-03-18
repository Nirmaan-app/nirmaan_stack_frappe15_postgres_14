import formatCurrency from "@/utils/FormatPrice";
import { TrendingUp, TrendingDown, Minus, FileText } from "lucide-react";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";

interface PORevisionImpactAndJustificationProps {
    beforeExclGst?: number;
    afterExclGst?: number;
    beforeInclGst?: number;
    afterInclGst?: number;
    justification?: string;
}

export default function PORevisionImpactAndJustification({
    beforeExclGst = 0,
    afterExclGst = 0,
    beforeInclGst = 0,
    afterInclGst = 0,
    justification = ""
}: PORevisionImpactAndJustificationProps) {
    const diffExclGst = afterExclGst - beforeExclGst;
    const diffInclGst = afterInclGst - beforeInclGst;

    const isIncrease = diffInclGst > 0;
    const isZero = diffInclGst === 0;
    const netImpact = Math.abs(diffInclGst);

    const ImpactIcon = isZero ? Minus : isIncrease ? TrendingUp : TrendingDown;
    const impactColor = isZero ? "text-gray-500" : isIncrease ? "text-red-600" : "text-emerald-600";
    const impactBg = isZero ? "bg-gray-50" : isIncrease ? "bg-red-50/60" : "bg-emerald-50/60";
    const impactBorder = isZero ? "border-gray-200" : isIncrease ? "border-red-100" : "border-emerald-100";
    const impactLabel = isZero ? "No Change" : isIncrease ? "PO Amount Increase" : "PO Amount Decrease";
    const iconBg = isZero ? "bg-gray-100" : isIncrease ? "bg-red-100" : "bg-emerald-100";

    return (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Justification — 2/5 width */}
            <div className="lg:col-span-2 flex flex-col">
                <div className="flex items-center gap-1.5 mb-2">
                    <FileText className="w-3.5 h-3.5 text-gray-400" />
                    <h3 className="font-semibold text-[11px] text-gray-500 uppercase tracking-wide">Justification</h3>
                </div>
                <div className="border border-gray-200 rounded-md bg-white p-3.5 flex-1 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed min-h-[120px]">
                    {justification || <span className="text-gray-400 italic text-xs">No justification provided.</span>}
                </div>
            </div>

            {/* Impact Summary — 3/5 width, matching dialog's ImpactSummaryTable */}
            <div className="lg:col-span-3 flex flex-col">
                <div className="flex items-center gap-1.5 mb-2">
                    <ImpactIcon className={`w-3.5 h-3.5 ${impactColor}`} />
                    <h3 className="font-semibold text-[11px] text-gray-500 uppercase tracking-wide">Revision Impact</h3>
                </div>
                <div className="border border-gray-200 rounded-md overflow-hidden flex flex-col flex-1">
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
                                <TableCell className="font-medium text-gray-500">{formatCurrency(beforeExclGst)}</TableCell>
                                <TableCell className="font-medium text-gray-900">{formatCurrency(afterExclGst)}</TableCell>
                                <TableCell className={`font-semibold ${diffExclGst < 0 ? "text-emerald-600" : diffExclGst > 0 ? "text-red-600" : "text-gray-500"}`}>
                                    {diffExclGst === 0 ? "--" : `${diffExclGst > 0 ? "+" : ""}${formatCurrency(diffExclGst)}`}
                                </TableCell>
                            </TableRow>
                            <TableRow className="h-10 hover:bg-gray-50/50">
                                <TableCell className="text-gray-600 font-medium">Incl. GST</TableCell>
                                <TableCell className="font-medium text-gray-500">{formatCurrency(beforeInclGst)}</TableCell>
                                <TableCell className="font-medium text-gray-900">{formatCurrency(afterInclGst)}</TableCell>
                                <TableCell className={`font-semibold ${diffInclGst < 0 ? "text-emerald-600" : diffInclGst > 0 ? "text-red-600" : "text-gray-500"}`}>
                                    {diffInclGst === 0 ? "--" : `${diffInclGst > 0 ? "+" : ""}${formatCurrency(diffInclGst)}`}
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>

                    {/* Net Impact Banner — matches dialog ImpactSummaryTable */}
                    <div className={`px-4 py-2.5 flex items-center justify-between border-t ${impactBorder} ${impactBg}`}>
                        <div className="flex items-center gap-2.5">
                            <div className={`p-1.5 rounded-md ${iconBg}`}>
                                <ImpactIcon className={`h-3.5 w-3.5 ${impactColor}`} />
                            </div>
                            <div>
                                <p className={`text-[10px] font-semibold uppercase tracking-wider ${impactColor}`}>Net Impact</p>
                                <p className={`text-[11px] font-medium ${impactColor}`}>{impactLabel}</p>
                            </div>
                        </div>
                        <span className={`text-lg font-bold tabular-nums ${impactColor}`}>
                            {isZero ? "--" : `${isIncrease ? "+" : "-"}${formatCurrency(netImpact)}`}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
