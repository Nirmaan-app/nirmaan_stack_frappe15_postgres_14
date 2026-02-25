import formatCurrency from "@/utils/FormatPrice";
import { Banknote, FileText } from "lucide-react";

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
    const isPositive = diffInclGst >= 0;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            {/* Impact Summary */}
            <div className="flex flex-col">
                <div className="flex items-center gap-2 mb-1">
                    <Banknote className="w-5 h-5 text-red-600" />
                    <h3 className="text-sm font-bold text-slate-800">Revision Impact Summary</h3>
                </div>
                <div className="text-xs text-transparent mb-2 hidden lg:block select-none tracking-widest" aria-hidden="true">&nbsp;</div>
                <div className="border rounded-md shadow-sm bg-white overflow-hidden flex-1">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 border-b">
                            <tr>
                                <th className="px-4 py-3 font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                                <th className="px-4 py-3 font-semibold text-slate-500 uppercase tracking-wider">Before</th>
                                <th className="px-4 py-3 font-semibold text-slate-500 uppercase tracking-wider">After</th>
                                <th className="px-4 py-3 font-semibold text-slate-500 uppercase tracking-wider">Difference</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            <tr>
                                <td className="px-4 py-3 text-slate-800 font-medium">Total Excl. GST</td>
                                <td className="px-4 py-3 text-slate-600">{formatCurrency(beforeExclGst)}</td>
                                <td className="px-4 py-3 text-slate-800 font-medium">{formatCurrency(afterExclGst)}</td>
                                <td className={`px-4 py-3 font-bold ${diffExclGst >= 0 ? "text-amber-600" : "text-emerald-600"}`}>
                                    {diffExclGst >= 0 ? "+" : "-"} {formatCurrency(Math.abs(diffExclGst))}
                                </td>
                            </tr>
                            <tr>
                                <td className="px-4 py-3 text-slate-800 font-medium">Total Incl. GST</td>
                                <td className="px-4 py-3 text-slate-600">{formatCurrency(beforeInclGst)}</td>
                                <td className="px-4 py-3 text-slate-800 font-medium">{formatCurrency(afterInclGst)}</td>
                                <td className={`px-4 py-3 font-bold ${diffInclGst >= 0 ? "text-amber-600" : "text-emerald-600"}`}>
                                    {diffInclGst >= 0 ? "+" : "-"} {formatCurrency(Math.abs(diffInclGst))}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                    <div className={`p-4 flex items-center justify-between ${isPositive ? "bg-amber-50" : "bg-emerald-50"} border-t`}>
                        <div className="flex items-center gap-2">
                            <Banknote className={`w-5 h-5 ${isPositive ? "text-amber-700" : "text-emerald-700"}`} />
                            <div className="flex flex-col">
                                <span className={`text-xs font-bold uppercase ${isPositive ? "text-amber-800" : "text-emerald-800"}`}>
                                    Net Impact
                                </span>
                                <span className={`text-xs ${isPositive ? "text-amber-700" : "text-emerald-700"}`}>
                                    {isPositive ? "Additional Amount to be Paid" : "Amount to be Refunded"}
                                </span>
                            </div>
                        </div>
                        <span className={`text-xl font-bold ${isPositive ? "text-amber-700" : "text-emerald-700"}`}>
                            {formatCurrency(Math.abs(diffInclGst))}
                        </span>
                    </div>
                </div>
            </div>

            {/* Justification */}
            <div className="flex flex-col">
                <div className="flex items-center gap-2 mb-1">
                    <FileText className="w-4 h-4 text-red-600" />
                    <h3 className="text-sm font-bold text-slate-800">Revision Justification</h3>
                </div>
                <div className="text-xs text-slate-500 mb-2">Explanation for this revision. Submitted by the requester.</div>
                <div className="border rounded-md shadow-sm bg-white p-4 flex-1 min-h-[160px] text-sm text-slate-700 whitespace-pre-wrap">
                    {justification || <span className="text-slate-400 italic">No justification provided.</span>}
                </div>
            </div>
        </div>
    );
}
