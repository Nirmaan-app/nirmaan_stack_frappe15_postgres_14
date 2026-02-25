import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import formatCurrency from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";
import { CreditCard, Edit } from "lucide-react";

interface PORevisionPaymentRectificationProps {
    paymentData?: string | object | null;
}

export default function PORevisionPaymentRectification({ paymentData }: PORevisionPaymentRectificationProps) {
    if (!paymentData) return null;

    let data: any = null;
    try {
        data = typeof paymentData === "string" ? JSON.parse(paymentData) : paymentData;
    } catch {
        return <div className="text-red-500 text-sm mt-4">Error parsing payment details.</div>;
    }

    const type = data?.list?.type;
    const details = data?.list?.Details || [];

    if (!type || details.length === 0) return null;

    return (
        <div className="space-y-4 mt-6">
            <div className="flex items-center justify-between mb-2 border-b pb-2">
                <div className="flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-red-600" />
                    <h3 className="text-sm font-bold text-slate-800">Payment Rectification</h3>
                </div>
                {/* <Button variant="outline" size="sm" className="h-8 shadow-sm">
                    <Edit className="w-4 h-4 mr-2" /> Edit
                </Button> */}
            </div>

            {type === "Payment Terms" && (
                <div className="space-y-2">
                    {details.map((detail: any, idx: number) => (
                        <div key={idx} className="rounded-md border shadow-sm bg-white overflow-x-auto">
                            <Table>
                                <TableHeader className="bg-slate-50">
                                    <TableRow>
                                        <TableHead className="font-semibold text-slate-700 h-10 w-1/3">TERM</TableHead>
                                        <TableHead className="font-semibold text-slate-700 h-10 w-1/3">AMOUNT</TableHead>
                                        <TableHead className="font-semibold text-slate-700 h-10 text-right">DUE DATE</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {detail.terms && detail.terms.map((t: any, tidx: number) => (
                                        <TableRow key={tidx}>
                                            <TableCell className="font-medium text-slate-800">{t.label || t.payment_term || "Term"}</TableCell>
                                            <TableCell>{formatCurrency(t.amount || t.invoice_portion || 0)}</TableCell>
                                            <TableCell className="text-right text-slate-600">{t.due_date ? formatDate(t.due_date) : "-"}</TableCell>
                                        </TableRow>
                                    ))}
                                    {(!detail.terms || detail.terms.length === 0) && (
                                        <TableRow>
                                            <TableCell className="font-medium text-slate-800">Revise PO Payment</TableCell>
                                            <TableCell>{formatCurrency(detail.amount || 0)}</TableCell>
                                            <TableCell className="text-right text-slate-600">-</TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    ))}
                </div>
            )}

            {type === "Refund Adjustment" && (
                <div className="space-y-6">
                    {/* Render separate tables for each return_type inside the details array */}
                    {details.map((detail: any, idx: number) => {
                        const rtype = detail.return_type;

                        if (rtype === "Against-po") {
                            return (
                                <div key={idx} className="space-y-2">
                                    <h4 className="text-sm font-bold text-red-600">Adjustment against PO:</h4>
                                    <div className="rounded-md border shadow-sm bg-white overflow-x-auto">
                                        <Table>
                                            <TableHeader className="bg-slate-50">
                                                <TableRow>
                                                    <TableHead className="font-semibold text-slate-700 h-10 uppercase tracking-wider text-xs">SELECTED PO</TableHead>
                                                    <TableHead className="font-semibold text-slate-700 h-10 uppercase tracking-wider text-xs">TOTAL REFUND AMOUNT</TableHead>
                                                    <TableHead className="font-semibold text-slate-700 h-10 uppercase tracking-wider text-xs">AMOUNT PAYABLE</TableHead>
                                                    <TableHead className="font-semibold text-slate-700 h-10 uppercase tracking-wider text-xs">ADJUSTMENT APPLIED</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {detail.target_pos?.map((tpo: any, tidx: number) => (
                                                    <TableRow key={tidx}>
                                                        <TableCell className="font-medium text-slate-800">{tpo.po_number}</TableCell>
                                                        <TableCell>{formatCurrency(detail.amount || 0)}</TableCell>
                                                        {/* For payable we'd ideally get tpo balance, but just showing adjustment mapping for now */}
                                                        <TableCell className="text-slate-600">-</TableCell>
                                                        <TableCell className="text-slate-800 font-medium">-{formatCurrency(tpo.amount || 0)}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                            );
                        }

                        if (rtype === "Ad-hoc") {
                            return (
                                <div key={idx} className="space-y-2">
                                    <h4 className="text-sm font-bold text-red-600">Adjustment against Adhoc Purchase:</h4>
                                    <div className="rounded-md border shadow-sm bg-white overflow-x-auto">
                                        <Table>
                                            <TableHeader className="bg-slate-50">
                                                <TableRow>
                                                    <TableHead className="font-semibold text-slate-700 h-10 uppercase tracking-wider text-xs w-1/4">TOTAL REFUND AMT</TableHead>
                                                    <TableHead className="font-semibold text-slate-700 h-10 uppercase tracking-wider text-xs w-1/4">TYPE</TableHead>
                                                    <TableHead className="font-semibold text-slate-700 h-10 uppercase tracking-wider text-xs">DESCRIPTION/COMMENT</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                <TableRow>
                                                    <TableCell className="font-medium text-slate-800">{formatCurrency(detail.amount || 0)}</TableCell>
                                                    <TableCell className="text-slate-600">{detail["ad-hoc_tyep"] || "Expense"}</TableCell>
                                                    <TableCell className="text-slate-600 text-xs">{detail.comment || detail["ad-hoc_dexription"] || "-"}</TableCell>
                                                </TableRow>
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                            );
                        }

                        if (rtype === "Vendor-has-refund") {
                            return (
                                <div key={idx} className="space-y-2">
                                    <h4 className="text-sm font-bold text-red-600">Vendor has Refunded:</h4>
                                    <div className="rounded-md border shadow-sm bg-white overflow-x-auto">
                                        <Table>
                                            <TableHeader className="bg-slate-50">
                                                <TableRow>
                                                    <TableHead className="font-semibold text-slate-700 h-10 uppercase tracking-wider text-xs w-1/3">TOTAL REFUND AMOUNT</TableHead>
                                                    <TableHead className="font-semibold text-slate-700 h-10 uppercase tracking-wider text-xs w-1/3">INVOICE DOC</TableHead>
                                                    <TableHead className="font-semibold text-slate-700 h-10 uppercase tracking-wider text-xs">REFUND DATE</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                <TableRow>
                                                    <TableCell className="font-medium text-slate-800">{formatCurrency(detail.amount || 0)}</TableCell>
                                                    <TableCell>
                                                        {detail.refund_attachment ? (
                                                            <a href={detail.refund_attachment} target="_blank" rel="noreferrer" className="inline-flex items-center px-3 py-1 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700">
                                                                Invoice Doc
                                                            </a>
                                                        ) : (
                                                            <span className="text-slate-400 italic">No File</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-slate-600">{detail.refund_date ? formatDate(detail.refund_date) : "-"}</TableCell>
                                                </TableRow>
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                            );
                        }

                        return null;
                    })}
                </div>
            )}
        </div>
    );
}
