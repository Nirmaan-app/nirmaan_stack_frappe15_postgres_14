import React from "react";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FileText, Edit3, BarChart2, Wallet, Paperclip, Calendar } from "lucide-react";
import formatToIndianRupee from "@/utils/FormatPrice";
import { RevisionItem, PaymentTerm, RefundAdjustment, DifferenceData, AdjustmentMethodType } from "../../types";
import { ImpactSummaryTable } from "../Step1/ImpactSummaryTable";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";

interface Step3SummaryProps {
  revisionItems: RevisionItem[];
  justification: string;
  difference: DifferenceData;
  paymentTerms: PaymentTerm[];
  refundAdjustments: RefundAdjustment[];
  adjustmentMethod: AdjustmentMethodType;
  po: ProcurementOrder;
  beforeSummary: any;
  afterSummary: any;
  netImpact: number;
}

export const Step3Summary: React.FC<Step3SummaryProps> = ({
  revisionItems,
  justification,
  difference,
  paymentTerms,
  refundAdjustments,
  adjustmentMethod,
  po,
  beforeSummary,
  afterSummary,
  netImpact,
}) => {
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Left Column: Line Items & Justification */}
            <div className="space-y-6">
                <div>
                     <h3 className="text-sm font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2 mb-6 pl-1">
                        <FileText className="h-5 w-5 text-red-600" />
                        Summary of Item Changes
                    </h3>
                    <div className="border rounded-2xl overflow-hidden bg-white shadow-sm">
                        <Table className="text-xs">
                            <TableHeader className="bg-gray-100/50 uppercase text-[9px] text-gray-400 font-black tracking-widest">
                                <TableRow className="h-10 hover:bg-transparent">
                                    <TableHead className="pl-6">ITEM DETAILS</TableHead>
                                    <TableHead>STATUS</TableHead>
                                    <TableHead className="text-right pr-6">NEW AMOUNT</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {revisionItems.filter(i => i.item_type !== "Original").map((item, idx) => {
                                    const amount = (item.quantity || 0) * (item.quote || 0);
                                    const totalAmount = amount + (amount * (item.tax || 0) / 100);
                                    const original = item.original_row_id ? po.items.find(i => i.name === item.original_row_id) : null;
                                    const details = [];
                                    if (original && (item.item_type === "Revised" || item.item_type === "Replace")) {
                                        if (item.quantity !== original.quantity) details.push(`Qty: ${original.quantity} → ${item.quantity}`);
                                        if (item.quote !== original.quote) details.push(`Rate: ${formatToIndianRupee(original.quote)} → ${formatToIndianRupee(item.quote || 0)}`);
                                        if (item.tax !== original.tax) details.push(`Tax: ${original.tax}% → ${item.tax}%`);
                                    } else if (item.item_type === "New") {
                                        details.push(`Qty: ${item.quantity}, Rate: ${formatToIndianRupee(item.quote || 0)}`);
                                    }

                                    return (
                                        <TableRow key={idx} className="group hover:bg-gray-50/50 h-16 border-b last:border-0">
                                            <TableCell className="pl-6 py-4">
                                                <div className="font-bold text-gray-900 leading-tight mb-1">{item.item_name}</div>
                                                {details.length > 0 && (
                                                    <div className="flex flex-wrap gap-2 mt-1">
                                                        {details.map((d, i) => (
                                                            <span key={i} className="text-[9px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-black uppercase tracking-tight">
                                                                {d}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="py-4">
                                                <Badge 
                                                    variant={item.item_type === "Deleted" ? "destructive" : "outline"}
                                                    className={`text-[9px] px-2 py-0.5 border-none font-black uppercase tracking-widest ${
                                                        item.item_type === "New" ? "bg-green-100 text-green-700" : 
                                                        item.item_type === "Revised" ? "bg-blue-100 text-blue-700" : ""
                                                    }`}
                                                >
                                                    {item.item_type}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right pr-6 py-4 font-black text-gray-900 border-none">
                                                {formatToIndianRupee(totalAmount)}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                                {revisionItems.filter(i => i.item_type !== "Original").length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={3} className="text-center text-gray-400 py-12 font-medium italic">No line items were changed</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>

                <div className="bg-slate-50 p-8 rounded-3xl border border-dashed border-gray-200">
                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2 pl-1">
                        <Edit3 className="h-4 w-4 text-red-500" />
                        Justification
                    </h4>
                    <p className="text-gray-700 leading-relaxed font-bold italic text-sm">
                        "{justification || "No justification provided."}"
                    </p>
                </div>
            </div>

            {/* Right Column: Financial Summary */}
            <div className="space-y-6">
                <h3 className="text-sm font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2 mb-6 pl-1">
                    <BarChart2 className="h-5 w-5 text-red-600" />
                    Financial Summary
                </h3>
                <ImpactSummaryTable 
                    beforeSummary={beforeSummary}
                    afterSummary={afterSummary}
                    difference={difference}
                    netImpact={netImpact}
                />
                
                {difference.inclGst !== 0 && (
                    <div className="pt-4">
                        <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2 pl-1">
                            <Wallet className="h-4 w-4 text-slate-400" />
                            Adjustment Summary
                        </h4>
                        <div className={`p-6 rounded-2xl border ${difference.inclGst < 0 ? "bg-green-50/30 border-green-100" : "bg-blue-50/30 border-blue-100"}`}>
                            {difference.inclGst > 0 ? (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between mb-4">
                                        <p className="font-bold text-xs text-blue-800 tracking-tight">Payment Rectification Allocated</p>
                                        <Badge variant="outline" className="bg-blue-100 text-blue-700 border-none font-black text-[9px] px-2 py-0.5 uppercase">Positive Flow</Badge>
                                    </div>
                                    <div className="space-y-2">
                                        {paymentTerms.map((t, i) => (
                                            <div key={i} className="flex justify-between items-center text-xs bg-white p-4 rounded-xl border border-blue-100 shadow-sm">
                                                <span className="font-semibold text-slate-600">{t.term}</span>
                                                <span className="font-bold text-slate-900">{formatToIndianRupee(t.amount)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between mb-4">
                                        <p className="font-bold text-xs text-green-800 tracking-tight">Refund Adjustment Details</p>
                                        <Badge variant="outline" className="bg-green-100 text-green-700 border-none font-black text-[9px] px-2 py-0.5 uppercase">Negative Flow</Badge>
                                    </div>
                                    <div className="space-y-4">
                                        {refundAdjustments.map((a, i) => (
                                            <div key={i} className="bg-white p-5 rounded-xl border border-green-100 shadow-sm space-y-3">
                                                <div className="flex justify-between items-center pb-2 border-b border-gray-50">
                                                    <span className="font-black text-[11px] text-gray-400 uppercase tracking-widest">
                                                        {a.type === 'Another PO' ? 'PO Adjustment' : a.type === 'Adhoc' ? 'Ad-hoc Credit' : 'Vendor Refund'}
                                                    </span>
                                                    <span className="font-black text-sm text-gray-900">{formatToIndianRupee(a.amount)}</span>
                                                </div>
                                                
                                                <div className="grid grid-cols-1 gap-2">
                                                    {a.type === 'Another PO' && (
                                                        <div className="flex items-center gap-2">
                                                            <div className="h-5 w-5 rounded bg-blue-50 flex items-center justify-center">
                                                                <FileText className="h-3 w-3 text-blue-500" />
                                                            </div>
                                                            <span className="text-xs font-bold text-gray-600">Adjustment against PO: <span className="text-gray-900">{a.po_id}</span></span>
                                                        </div>
                                                    )}
                                                    {a.type === 'Adhoc' && (
                                                        <>
                                                            <div className="flex items-center gap-2">
                                                                <Badge variant="secondary" className="bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-tight">{a.adhoc_type}</Badge>
                                                                <span className="text-xs font-bold text-gray-900">{a.description}</span>
                                                            </div>
                                                            {a.comment && (
                                                                <p className="text-[11px] text-gray-400 italic font-medium pl-1">"{a.comment}"</p>
                                                            )}
                                                        </>
                                                    )}
                                                    {a.type === 'Refunded' && (
                                                        <div className="space-y-2">
                                                            <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                                                                <Calendar className="h-3.5 w-3.5 text-gray-400" />
                                                                <span>Refund Date: {a.date}</span>
                                                            </div>
                                                            { (a.refund_attachment || a.refund_attachment_file) && (
                                                                <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-lg border border-slate-100 group hover:border-blue-200 transition-colors">
                                                                    <Paperclip className="h-3.5 w-3.5 text-blue-500" />
                                                                    <span className="text-[11px] font-bold text-blue-600 truncate flex-1">
                                                                        {a.refund_attachment_file ? a.refund_attachment_file.name : 'Refund_Attachment.pdf'}
                                                                    </span>
                                                                    {a.refund_attachment && (
                                                                        <a 
                                                                            href={a.refund_attachment} 
                                                                            target="_blank" 
                                                                            rel="noreferrer"
                                                                            className="text-[9px] font-black text-white bg-blue-500 hover:bg-blue-600 px-2 py-1 rounded-md uppercase tracking-widest"
                                                                        >
                                                                            View
                                                                        </a>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    </div>
  );
};
