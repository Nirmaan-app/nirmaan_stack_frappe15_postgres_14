import React from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, ClipboardList, Plus, Undo, Trash2, Edit3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableHeader, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import ReactSelect from "react-select";
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
  itemOptions?: { label: string; value: string; item_id: string; item_name: string; make: string; available_makes: string[]; unit: string; category: string; tax: number }[];
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
  itemOptions = [],
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
        <div className="border rounded-md overflow-visible bg-white pb-24">
          <Table>
            <TableHeader className="bg-gray-50 text-[11px] uppercase text-gray-500">
              <TableRow>
                <TableHead className="w-[350px] pl-4">ITEM NAME</TableHead>
                <TableHead className="w-[200px]">MAKE</TableHead>
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
                      {item.item_type !== 'Deleted'  && item.item_type !== 'Revised' ? (
                        <ReactSelect
                          options={itemOptions.filter(opt => !revisionItems.some(ri => ri.item_id === opt.item_id && ri.item_type !== 'Deleted'))}
                          value={
                          item.item_id 
                            ? itemOptions.find(opt => opt.item_id === item.item_id) 
                            : item.item_name 
                              ? { label: item.item_name, value: item.item_name, item_id: "", item_name: item.item_name, make: item.make || "", unit: item.unit || "", category: "", tax: item.tax || 0 }
                              : null
                        }
                        onChange={(selected: any) => {
                          const isOriginal = item.item_type === 'Original';
                          let typeUpdates: Partial<RevisionItem> = {};
                          
                          if (selected) {
                            if (isOriginal && selected.item_id !== item.item_id) {
                              typeUpdates = { item_type: 'Replace', original_row_id: item.name };
                            }
                            handleUpdateItem(idx, { 
                              ...typeUpdates,
                              item_id: selected.item_id, 
                              item_name: selected.item_name, 
                              make: selected.make,
                              unit: selected.unit,
                              tax: selected.tax
                            });
                          } else {
                            if (isOriginal) {
                              typeUpdates = { item_type: 'Replace', original_row_id: item.name };
                            }
                            handleUpdateItem(idx, { ...typeUpdates, item_id: undefined, item_name: "", make: "", unit: "Nos", tax: 0 });
                          }
                        }}
                        isDisabled={isDeleted || (item.item_type !== 'New' && (item.received_quantity || 0) > 0)}
                        placeholder="Select Item..."
                        isClearable
                        styles={{
                          control: (base) => ({
                            ...base,
                            minHeight: '36px',
                            height: '36px',
                            fontSize: '12px',
                            fontWeight: 600,
                          }),
                          valueContainer: (base) => ({
                            ...base,
                            padding: '0 8px',
                          }),
                          input: (base) => ({
                            ...base,
                            margin: 0,
                            padding: 0,
                          }),
                        }}
                      />
                      ) : (
                        <div className="flex items-center h-9 px-3 text-xs font-semibold text-gray-700 bg-gray-50 border rounded-md cursor-not-allowed">
                          {item.item_name}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <ReactSelect
                        options={
                          (() => {
                            const optionItem = itemOptions.find(opt => opt.item_id === item.item_id);
                            const makes = optionItem?.available_makes || (item.make ? [item.make] : []);
                            return makes.map(m => ({ label: m, value: m }));
                          })()
                        }
                        value={item.make ? { label: item.make, value: item.make } : null}
                        onChange={(selected: any) => handleUpdateItem(idx, { make: selected?.value || "" })}
                        isDisabled={isDeleted || !item.item_id}
                        placeholder="Make..."
                        isClearable
                        styles={{
                          control: (base) => ({
                            ...base,
                            minHeight: '36px',
                            height: '36px',
                            fontSize: '12px',
                            fontWeight: 600,
                          }),
                          valueContainer: (base) => ({
                            ...base,
                            padding: '0 8px',
                          }),
                          input: (base) => ({
                            ...base,
                            margin: 0,
                            padding: 0,
                          }),
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <SelectUnit 
                        value={item.unit || ""} 
                        onChange={(v) => handleUpdateItem(idx, { unit: v })}
                        disabled={isDeleted || (item.item_type !== 'New' && (item.received_quantity || 0) > 0)}
                        className="text-xs h-9"
                      />
                    </TableCell>
                    <TableCell>
                      <Input 
                        type="number"
                        min={item.item_type !== 'New' && (item.received_quantity || 0) > 0 ? item.received_quantity : 0}
                        value={item.quantity} 
                        onChange={(e) => {
                           const val = parseFloat(e.target.value) || 0;
                           const minQty = (item.item_type !== 'New' && item.received_quantity) ? item.received_quantity : 0;
                           if (val < minQty) {
                               // Optional: could toast a warning here, but simply ignoring the invalid input or capping it works best
                               handleUpdateItem(idx, { quantity: minQty });
                           } else {
                               handleUpdateItem(idx, { quantity: val });
                           }
                        }}
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
                              if (item.item_type !== "New" && (item.received_quantity || 0) > 0) return;
                              handleRemoveItem(idx);
                          }} 
                          disabled={item.item_type !== "New" && (item.received_quantity || 0) > 0 && !isDeleted}
                          className={`p-0 h-8 w-8 rounded-lg ${isDeleted ? "text-blue-600 bg-blue-50" : "text-red-500 hover:text-red-600 hover:bg-red-50"} disabled:opacity-50 disabled:cursor-not-allowed`}
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
