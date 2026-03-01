import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import formatCurrency from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";
import { ReceiptText } from "lucide-react";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { useCallback } from "react";

interface PORevisionInvoicesProps {
    invoices: any[];
    isLoading: boolean;
}

export default function PORevisionInvoices({ invoices, isLoading }: PORevisionInvoicesProps) {
    const { data: usersList } = useUsersList();

    const getUserName = useCallback((id: string | undefined): string => {
        if (!id) return "--";
        if (id === "Administrator") return "Administrator";
        const user = usersList?.find(u => u.name === id);
        return user?.full_name || id;
    }, [usersList]);

    if (isLoading) return <div className="text-sm text-slate-500 p-4 border rounded-md">Loading invoices...</div>;

    if (!invoices || invoices.length === 0) {
        return (
            <div className="text-sm text-slate-500 p-4 border rounded-md">
                No invoices found against this Purchase Order.
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2 mb-2">
                <ReceiptText className="w-4 h-4 text-red-600" />
                <h3 className="text-sm font-bold text-slate-800">Invoices</h3>
            </div>
            <div className="rounded-md border">
                <Table>
                    <TableHeader className="bg-slate-50">
                        <TableRow>
                            <TableHead className="font-semibold text-slate-700 h-10">DATE</TableHead>
                            <TableHead className="font-semibold text-slate-700 h-10">AMOUNT</TableHead>
                            <TableHead className="font-semibold text-slate-700 h-10">INVOICE NUMBER</TableHead>
                            <TableHead className="font-semibold text-slate-700 h-10">STATUS</TableHead>
                            <TableHead className="font-semibold text-slate-700 h-10">UPLOADED BY</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {invoices.map((inv, idx) => (
                            <TableRow key={idx}>
                                <TableCell>{inv.invoice_date ? formatDate(inv.invoice_date) : "N/A"}</TableCell>
                                <TableCell>{formatCurrency(inv.invoice_amount || 0)}</TableCell>
                                <TableCell className="text-blue-600 hover:underline cursor-pointer">{inv.invoice_no || inv.name}</TableCell>
                                <TableCell>
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                        {inv.status || "Approved"}
                                    </span>
                                </TableCell>
                                <TableCell>{getUserName(inv.uploaded_by || inv.owner) || "System"}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
