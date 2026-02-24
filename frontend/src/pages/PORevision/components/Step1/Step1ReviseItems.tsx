import React from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, ClipboardList, Plus, Undo, Trash2, Edit3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableHeader, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SelectUnit } from "@/components/helpers/SelectUnit";
import formatToIndianRupee from "@/utils/FormatPrice";
import { RevisionItem, SummaryData, DifferenceData } from "../../types";
import { InvoicesSection } from "./InvoicesSection";
import { ImpactSummaryTable } from "./ImpactSummaryTable";
import { VendorInvoice } from "@/types/NirmaanStack/VendorInvoice";

interface Step1ReviseItemsProps {
  revisionItems: RevisionItem[];
  invoices?: VendorInvoice[];
  justification: string;
  setJustification: (val: string) => void;
  handleAddItem: () => void;
  handleUpdateItem: (idx: number, updates: Partial<RevisionItem>) => void;
  handleRemoveItem: (idx: number) => void;
  beforeSummary: SummaryData;
  afterSummary: SummaryData;
  difference: DifferenceData;
  netImpact: number;
}

export const Step1ReviseItems: React.FC<Step1ReviseItemsProps> = ({
  revisionItems,
  invoices,
  justification,
  setJustification,
  handleAddItem,
  handleUpdateItem,
  handleRemoveItem,
  beforeSummary,
  afterSummary,
  difference,
  netImpact,
}) => {
  return (
    <div className="space-y-8">
      <Alert className="bg-blue-50 border-blue-100 py-3">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-700 text-xs">
          Note: Once submitted, this PO revision will be locked for 7 days. Please review all line items and amount changes carefully before proceeding.
        </AlertDescription>
      </Alert>

      <InvoicesSection invoices={invoices} />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-red-600" />
            <h3 className="font-bold text-[13px] text-gray-700 uppercase tracking-tight">Line Item Revision</h3>
          </div>
          <Button variant="outline" size="sm" onClick={handleAddItem} className="text-red-500 border-red-500 hover:bg-red-50 text-[11px] h-8 font-bold px-4">
            <Plus className="h-3 w-3 mr-1" /> Add Line Item
          </Button>
        </div>
        <div className="border rounded-md overflow-hidden bg-white">
          <Table>
            <TableHeader className="bg-gray-50 text-[11px] uppercase text-gray-500">
              <TableRow>
                <TableHead className="w-[200px] pl-4">ITEM NAME</TableHead>
                <TableHead>MAKE</TableHead>
                <TableHead className="w-[100px]">UNIT</TableHead>
                <TableHead className="w-[100px]">QTY</TableHead>
                <TableHead className="w-[120px]">RATE</TableHead>
                <TableHead className="w-[100px]">TAX</TableHead>
                <TableHead>AMOUNT (Incl. GST)</TableHead>
                <TableHead className="w-[50px] pr-4"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {revisionItems.map((item, idx) => {
                const amount = (item.quantity || 0) * (item.quote || 0);
                const totalAmount = amount + (amount * (item.tax || 0) / 100);
                const isDeleted = item.item_type === "Deleted";

                return (
                  <TableRow key={idx} className={`h-16 border-b last:border-0 ${isDeleted ? "opacity-30 grayscale pointer-events-none" : "hover:bg-gray-50/50"}`}>
                    <TableCell className="pl-4">
                      <Input 
                        value={item.item_name} 
                        onChange={(e) => handleUpdateItem(idx, { item_name: e.target.value })}
                        disabled={isDeleted}
                        className="text-xs font-semibold h-9"
                      />
                    </TableCell>
                    <TableCell>
                      <Input 
                        value={item.make} 
                        onChange={(e) => handleUpdateItem(idx, { make: e.target.value })}
                        disabled={isDeleted}
                        className="text-xs h-9"
                      />
                    </TableCell>
                    <TableCell>
                      <SelectUnit 
                        value={item.unit || ""} 
                        onChange={(v) => handleUpdateItem(idx, { unit: v })}
                        disabled={isDeleted}
                        className="text-xs h-9"
                      />
                    </TableCell>
                    <TableCell>
                      <Input 
                        type="number"
                        value={item.quantity} 
                        onChange={(e) => handleUpdateItem(idx, { quantity: parseFloat(e.target.value) || 0 })}
                        disabled={isDeleted}
                        className="text-xs font-bold h-9"
                      />
                    </TableCell>
                    <TableCell>
                       <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-[10px]">₹</span>
                          <Input 
                              type="number"
                              value={item.quote} 
                              onChange={(e) => handleUpdateItem(idx, { quote: parseFloat(e.target.value) || 0 })}
                              disabled={isDeleted}
                              className="text-xs font-bold pl-5 h-9"
                          />
                       </div>
                    </TableCell>
                    <TableCell>
                      <Select 
                        value={String(item.tax)} 
                        onValueChange={(v) => handleUpdateItem(idx, { tax: parseFloat(v) })}
                        disabled={isDeleted}
                      >
                        <SelectTrigger className="text-xs h-9 border-gray-100 bg-gray-50/50">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">0%</SelectItem>
                          <SelectItem value="5">5%</SelectItem>
                          <SelectItem value="12">12%</SelectItem>
                          <SelectItem value="18">18%</SelectItem>
                          <SelectItem value="28">28%</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-xs font-bold text-gray-900">
                      {formatToIndianRupee(totalAmount)}
                    </TableCell>
                    <TableCell className="pr-4">
                      <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveItem(idx);
                          }} 
                          className={`p-0 h-8 w-8 rounded-lg ${isDeleted ? "text-blue-600 bg-blue-50" : "text-gray-300 hover:text-red-500 hover:bg-red-50"}`}
                      >
                        {isDeleted ? <Undo className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-10 pt-4">
        <ImpactSummaryTable 
          beforeSummary={beforeSummary}
          afterSummary={afterSummary}
          difference={difference}
          netImpact={netImpact}
        />

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Edit3 className="h-4 w-4 text-red-600" />
            <h3 className="font-bold text-[13px] text-gray-700 uppercase tracking-tight">Revision Justification</h3>
          </div>
          <p className="text-gray-400 text-[11px] leading-tight font-medium">
              Provide a clear explanation for this revision. This will be recorded for audit and compliance purposes.
          </p>
          <div className="relative">
              <Textarea 
              placeholder="Explain what has changed and why (e.g. quantity correction, rate revision, tax update, scope change)"
              className="min-h-[140px] bg-white border-gray-200 text-xs placeholder:text-gray-300 rounded-lg p-4 resize-none focus-visible:ring-red-100"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              />
          </div>
        </div>
      </div>
    </div>
  );
};
