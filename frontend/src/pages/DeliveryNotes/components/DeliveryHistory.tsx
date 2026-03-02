import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { DeliveryNote } from "@/types/NirmaanStack/DeliveryNotes";
import { formatDate } from "@/utils/FormatDate";
import { toast } from "@/components/ui/use-toast";

import { useFrappeGetDocList } from "frappe-react-sdk";
import memoize from 'lodash/memoize';
import { ChevronDown, ChevronUp } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';
import { Printer } from 'lucide-react';
import { Button } from "@/components/ui/button";


interface DeliveryHistoryTableProps {
  poId?: string;
  dnRecords: DeliveryNote[];
  onPrintHistory: (date: string, dn: DeliveryNote) => void;
  showHeader?: boolean;
}

interface ExpandableRowProps {
  index: number;
  dn: DeliveryNote;
  poId?: string;
  isExpanded: boolean;
  onToggle: (key: string) => void;
}

const ExpandableRow: React.FC<ExpandableRowProps> = ({ index, dn, poId, isExpanded, onToggle }) => {
  const rowKey = dn.name;

  const handleDownloadDeliveryNote = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!poId) {
      toast({ title: "Error", description: "PO ID is missing", variant: "destructive" });
      return;
    }

    try {
      toast({ title: "Generating PDF", description: `Downloading note for ${formatDate(dn.delivery_date)}...` });

      const formatname = "PO Delivery Histroy";
      const formattedDate = dn.delivery_date;

      const printUrl = `/api/method/frappe.utils.print_format.download_pdf?doctype=Procurement%20Orders&name=${poId}&format=${encodeURIComponent(formatname)}&no_letterhead=0&delivery_date=${encodeURIComponent(formattedDate)}`;

      const response = await fetch(printUrl);
      if (!response.ok) throw new Error("Failed to generate PDF");

      const blob = await response.blob();

      const fileName = `${poId}_Delivery_${dn.delivery_date}.pdf`;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();

      link.remove();
      window.URL.revokeObjectURL(url);

      toast({ title: "Success", description: "Delivery note downloaded.", variant: "default" });
    } catch (error) {
      console.error("Download error:", error);
      toast({ title: "Error", description: "Failed to download delivery note.", variant: "destructive" });
    }
  };

  const { data: usersList } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
    fields: ["name", "full_name", "email"],
    limit: 1000,
  }, `Nirmaan Users`);

  const getUserName = useMemo(() => memoize((id: string | undefined) => {
    if (!id) return "";
    if (id === "Administrator") return "Administrator";
    const byName = usersList?.find((user) => user.name === id);
    if (byName) return byName.full_name;
    const byEmail = usersList?.find((user) => user.email === id);
    if (byEmail) return byEmail.full_name;
    return id;
  }, (id: string | undefined) => id), [usersList]);

  return (
    <>
      {/* Mobile Card View */}
      <div className="block sm:hidden border-t p-4">
        <div className="flex justify-between items-center" onClick={() => onToggle(rowKey)}>
          <div>
            <div className="font-medium">{formatDate(dn.delivery_date)}</div>
            <div className="text-sm text-gray-500">{dn.note_no}</div>
            <div className="text-sm text-gray-500">{dn.items.length} item(s) updated by {getUserName(dn.updated_by_user)}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleDownloadDeliveryNote}>
              <Printer className="h-4 w-4 text-gray-700" />
            </Button>
            <button aria-label="Toggle details" className="p-1">{isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}</button>
          </div>
        </div>
        <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-[1000px] mt-4' : 'max-h-0'}`}>
          <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">
            {dn.items.map((item, idx) => (
              <li key={idx} className="flex-col"><div><strong>{item.item_name}</strong></div> <div>Received : {item.delivered_quantity}({item.unit})</div></li>
            ))}
          </ul>
        </div>
      </div>

      {/* Desktop Table Row View */}
      <TableRow role="button" onClick={() => onToggle(rowKey)} className="hidden sm:table-row cursor-pointer hover:bg-gray-50">
        <TableCell>
          <div className="flex items-center font-medium">{formatDate(dn.delivery_date)} <span className="ml-2">{isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span></div>
        </TableCell>
        <TableCell>{dn.note_no}</TableCell>
        <TableCell>{dn.items.length}</TableCell>
        <TableCell className={`${index === 0 ? "font-bold" : ""}`}>{index === 0 ? "Create" : "Update"}</TableCell>
        <TableCell>{getUserName(dn.updated_by_user)}</TableCell>
        <TableCell>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleDownloadDeliveryNote}><Printer className="h-4 w-4 text-gray-700" /></Button>
        </TableCell>
      </TableRow>
      {/* The expanded content row for desktop */}
      <TableRow className="hidden sm:table-row" aria-hidden={!isExpanded}>
        <TableCell colSpan={6} className="p-0">
          <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-[1000px]' : 'max-h-0'}`}>
            <div className="p-4 bg-gray-50">
              <Table>
                <TableHeader className="bg-gray-200"><TableRow><TableHead>Item Name</TableHead><TableHead>Unit</TableHead><TableHead>Received</TableHead></TableRow></TableHeader>
                <TableBody>
                  {dn.items.map((item, itemIdx) => (<TableRow key={itemIdx}><TableCell>{item.item_name}</TableCell><TableCell>{item.unit}</TableCell><TableCell>{item.delivered_quantity}</TableCell></TableRow>))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TableCell>
      </TableRow>
    </>
  );
};


const DeliveryHistoryTable: React.FC<DeliveryHistoryTableProps> = ({
  poId,
  dnRecords,
  onPrintHistory: _onPrintHistory,
  showHeader = true,
}) => {
  const [expandedRows, setExpandedRows] = useState<string[]>([]);

  const handleToggle = useCallback((key: string) => {
    setExpandedRows((prev) =>
      prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key]
    );
  }, []);

  const tableContent = (
    <>
      {/* For Desktop */}
      <div className="overflow-auto hidden sm:block">
        <Table>
          <TableHeader className="bg-red-100">
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>DN ID</TableHead>
              <TableHead>No. of Items</TableHead>
              <TableHead>Change Type</TableHead>
              <TableHead>Updated By</TableHead>
              <TableHead>Print</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dnRecords.length > 0 ? (
              dnRecords.map((dn, index) => (
                <ExpandableRow
                  key={dn.name}
                  index={index}
                  dn={dn}
                  poId={poId}
                  isExpanded={expandedRows.includes(dn.name)}
                  onToggle={handleToggle}
                />
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-4 text-gray-500">
                  No delivery history available
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {/* For Mobile */}
      <div className="block sm:hidden">
        {dnRecords.length > 0 ? (
          <div className="divide-y">
            {dnRecords.map((dn, index) => (
              <ExpandableRow
                key={dn.name}
                index={index}
                dn={dn}
                poId={poId}
                isExpanded={expandedRows.includes(dn.name)}
                onToggle={handleToggle}
              />
            ))}
          </div>
        ) : (
          <p className="text-center p-4 text-gray-500">
            No delivery history available
          </p>
        )}
      </div>
    </>
  );

  if (!showHeader) {
    return <div className="w-full">{tableContent}</div>;
  }

  return (
    <Card>
      <CardHeader className="font-semibold text-lg text-red-600 pl-6">
        <CardTitle>Delivery History</CardTitle>
      </CardHeader>
      <CardContent className="p-0">{tableContent}</CardContent>
    </Card>
  );
};

export default React.memo(DeliveryHistoryTable);
