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
import { DeliveryDataType } from '@/types/NirmaanStack/ProcurementOrders';
// import { formatDate } from "date-fns";
import { formatDate } from "@/utils/FormatDate";

import { useFrappeGetDocList } from "frappe-react-sdk";
import memoize from 'lodash/memoize';
import { ChevronDown, ChevronUp } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';
import { Printer } from 'lucide-react';
import { Button } from "@/components/ui/button";



const TRANSITION_DURATION = 300;
const MAX_HEIGHT = 1000;

interface DeliveryHistoryTableProps {
  deliveryData: DeliveryDataType | null;
  onPrintHistory: (historyEntryData: DeliveryDataType[string]) => void; // <-- ADD THIS PROP
}

interface ExpandableRowProps {
  index: number;
  date: string;
  data: DeliveryDataType[string];
  isExpanded: boolean;
  onToggle: (date: string) => void;
  onPrint: (historyEntryData: DeliveryDataType[string]) => void;
}

const ExpandableRow: React.FC<ExpandableRowProps> = ({ index, date, data, isExpanded, onToggle, onPrint }) => {


  // console.log("DeliveryHistoryTable", JSON.stringify(data));

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      onToggle(date);
    }
  }, [date, onToggle]);

  const { data: usersList } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
    fields: ["name", "full_name"],
    limit: 1000,
  }, `Nirmaan Users`);

  const getUserName = useMemo(() => memoize((id: string | undefined) => {
    if (id === "Administrator") return "Administrator"
    return usersList?.find((user) => user.name === id)?.full_name || ""
  }, (id: string | undefined) => id), [usersList]);

  return (
    // --- (Indicator) MODIFIED: For mobile, each "row" is now a block element inside a div. On desktop, it's a TableRow. ---
    // We use a React.Fragment to avoid adding an extra DOM element.
    <>
      {/* Mobile Card View */}
      <div className="block sm:hidden border-t p-4">
        <div className="flex justify-between items-center" onClick={() => onToggle(date)}>
          <div>
            <div className="font-medium">{formatDate(new Date(date), "dd MM, yyyy")}</div>
            <div className="text-sm text-gray-500">{data?.note_no}</div>
            <div className="text-sm text-gray-500">{data.items.length} item(s) updated by {getUserName(data.updated_by)}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); onPrint(data); }}><Printer className="h-4 w-4" /></Button>
            <button aria-label="Toggle details" className="p-1">{isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}</button>
          </div>
        </div>
        <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-[1000px] mt-4' : 'max-h-0'}`}>
          <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">
            {data.items.map((item, idx) => (
              <li key={idx} className="flex-col"><div><strong>{item.item_name}</strong></div> <div>Received : {item.to - item.from}({item.unit})</div></li>
            ))}
          </ul>
        </div>
      </div>

      {/* Desktop Table Row View */}
      <TableRow role="button" onClick={() => onToggle(date)} className="hidden sm:table-row cursor-pointer hover:bg-gray-50">
        <TableCell>
          <div className="flex items-center font-medium">{formatDate(new Date(date), "dd/MM/yyyy")} <span className="ml-2">{isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span></div>
        </TableCell>
        <TableCell>{data.note_no}</TableCell>
        <TableCell>{data.items.length}</TableCell>
        <TableCell className={`${index === 0 ? "font-bold" : ""}`}>{index === 0 ? "Create" : "Update"}</TableCell>
        <TableCell>{getUserName(data.updated_by)}</TableCell>
        <TableCell>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); onPrint(data); }}><Printer className="h-4 w-4 text-gray-700" /></Button>
        </TableCell>
      </TableRow>
      {/* The expanded content row for desktop */}
      <TableRow className="hidden sm:table-row" aria-hidden={!isExpanded}>
        <TableCell colSpan={5} className="p-0">
          <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-[1000px]' : 'max-h-0'}`}>
            <div className="p-4 bg-gray-50">
              <Table>
                <TableHeader className="bg-gray-200"><TableRow><TableHead>Item Name</TableHead><TableHead>Unit</TableHead><TableHead>Received</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.items.map((item, itemIdx) => (<TableRow key={itemIdx}><TableCell>{item.item_name}</TableCell><TableCell>{item.unit}</TableCell><TableCell>{item.to - item.from}</TableCell></TableRow>))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TableCell>
      </TableRow>
    </>
  );
};


const DeliveryHistoryTable: React.FC<DeliveryHistoryTableProps> = ({ deliveryData, onPrintHistory }) => {
  const [expandedRows, setExpandedRows] = useState<string[]>([]);

  

  const handleToggle = useCallback((date: string) => {
    setExpandedRows(prev => prev.includes(date)
      ? prev.filter(d => d !== date)
      : [...prev, date]
    );
  }, []);
  const hasHistory = deliveryData && Object.keys(deliveryData).length > 0; ''


  return (
    <Card>
      <CardHeader className="font-semibold text-lg text-red-600 pl-6"><CardTitle>Delivery History</CardTitle></CardHeader>
      <CardContent className="p-0"> {/* Remove padding on mobile, add it back for desktop table */}
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
              {deliveryData && Object.keys(deliveryData).length > 0 ? (
                Object.entries(deliveryData).map(([date, data], index) => (
                  <ExpandableRow key={date} index={index} date={date} data={data} isExpanded={expandedRows.includes(date)} onToggle={handleToggle} onPrint={onPrintHistory} />
                ))
              ) : (
                <TableRow><TableCell colSpan={5} className="text-center py-4 text-gray-500">No delivery history available</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {/* For Mobile */}
        <div className="block sm:hidden">
          {deliveryData && Object.keys(deliveryData).length > 0 ? (
            <div className="divide-y">
              {Object.entries(deliveryData).map(([date, data], index) => (
                <ExpandableRow key={date} index={index} date={date} data={data} isExpanded={expandedRows.includes(date)} onToggle={handleToggle} onPrint={onPrintHistory} />
              ))}
            </div>
          ) : (
            <p className="text-center p-4 text-gray-500">No delivery history available</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default React.memo(DeliveryHistoryTable);