import React from "react";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";

interface InvoicesSectionProps {
  invoices?: VendorInvoice[];
}

export const InvoicesSection: React.FC<InvoicesSectionProps> = ({ invoices }) => {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-gray-500" />
        <h3 className="font-bold text-[13px] text-gray-700 uppercase tracking-tight">Invoices</h3>
      </div>
      <div className="border rounded-md overflow-hidden bg-white">
        <Table>
          <TableHeader className="bg-gray-100/50">
            <TableRow className="h-10 hover:bg-transparent">
              <TableHead className="text-[10px] font-bold uppercase pl-4">DATE</TableHead>
              <TableHead className="text-[10px] font-bold uppercase">AMOUNT</TableHead>
              <TableHead className="text-[10px] font-bold uppercase">INVOICE NUMBER</TableHead>
              <TableHead className="text-[10px] font-bold uppercase">STATUS</TableHead>
              <TableHead className="text-[10px] font-bold uppercase pr-4">UPLOADED BY</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices?.map((inv) => (
              <TableRow key={inv.name} className="h-12 border-b last:border-0 hover:bg-gray-50/30">
                <TableCell className="text-xs text-gray-600 pl-4">{formatDate(inv.invoice_date)}</TableCell>
                <TableCell className="text-xs font-semibold">{formatToIndianRupee(inv.invoice_amount)}</TableCell>
                <TableCell className="text-xs text-blue-600 underline cursor-pointer font-medium">{inv.invoice_no}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-[10px] py-0 h-5">
                    {inv.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-gray-600 pr-4">{inv.owner}</TableCell>
              </TableRow>
            ))}
            {(!invoices || invoices.length === 0) && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-gray-400 text-xs italic">No invoices found</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
