import React, { useState } from "react";
import { ClipboardList, Plus, Undo, Trash2, Edit3, Eye, Lock } from "lucide-react";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableHeader, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import ReactSelect from "react-select";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SelectUnit } from "@/components/helpers/SelectUnit";
import formatToIndianRupee from "@/utils/FormatPrice";
import { RevisionItem, SummaryData, DifferenceData } from "../../types";
import { ImpactSummaryTable } from "./ImpactSummaryTable";
import { AddNewItemDialog } from "./AddNewItemDialog";
import { AddChargeDialog } from "./AddChargeDialog";

interface Step1ReviseItemsProps {
  revisionItems: RevisionItem[];
  justification: string;
  setJustification: (val: string) => void;
  handleAddItem: (item?: RevisionItem) => void;
  handleUpdateItem: (idx: number, updates: Partial<RevisionItem>) => void;
  handleRemoveItem: (idx: number) => void;
  beforeSummary: SummaryData;
  afterSummary: SummaryData;
  difference: DifferenceData;
  netImpact: number;
  itemOptions?: { label: string; value: string; item_id: string; item_name: string; make: string; available_makes: string[]; unit: string; category: string; tax: number }[];
  isCustom?: boolean;
  poTotalAmount: number;
  poAmountPaid: number;
  poAmountDelivered: number;
}

export const Step1ReviseItems: React.FC<Step1ReviseItemsProps> = ({
  revisionItems,
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
  isCustom = false,
  poTotalAmount,
  poAmountPaid,
  poAmountDelivered,
}) => {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isAddChargeDialogOpen, setIsAddChargeDialogOpen] = useState(false);

  return (
    <div className="space-y-4">
      {/* ── Amounts Strip ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-3 border border-gray-200 rounded-md bg-gray-50/50">
        <div className="space-y-0.5">
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Current PO Amount (Incl. GST)</p>
          <p className="text-sm font-semibold text-gray-900">{formatToIndianRupee(poTotalAmount)}</p>
        </div>
        <div className="space-y-0.5 border-l-0 sm:border-l sm:pl-4 border-gray-200">
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Total Paid</p>
          <p className="text-sm font-semibold text-emerald-600">{formatToIndianRupee(poAmountPaid)}</p>
        </div>
        <div className="space-y-0.5 border-l-0 sm:border-l sm:pl-4 border-gray-200">
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">PO Payable Amount against Delivery</p>
          <p className="text-sm font-medium text-blue-600">{formatToIndianRupee(poAmountDelivered)}</p>
        </div>
      </div>

      {/* ── Item Revision Table ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-xs text-gray-700 uppercase tracking-wide">Item Revision</h3>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsAddChargeDialogOpen(true)} className="text-blue-600 border-blue-200 hover:bg-blue-50 text-[11px] h-7 font-medium px-3">
              <Plus className="h-3 w-3 mr-1" /> Add Charges
            </Button>
            <Button variant="outline" size="sm" onClick={() => setIsAddDialogOpen(true)} className="text-primary border-primary/30 hover:bg-primary/5 text-[11px] h-7 font-medium px-3">
              <Plus className="h-3 w-3 mr-1" /> Add New Item
            </Button>
          </div>
        </div>
        <div className="border border-gray-200 rounded-md overflow-visible bg-white pb-20">
          <Table>
            <TableHeader className="bg-gray-50 text-[10px] uppercase text-gray-500">
              <TableRow>
                <TableHead className="w-[36px] pl-3"></TableHead>
                <TableHead className="w-[340px]">Item Name</TableHead>
                {!isCustom && <TableHead className="w-[200px]">Make</TableHead>}
                <TableHead className="w-[100px]">Unit</TableHead>
                <TableHead className="w-[100px]">Qty</TableHead>
                <TableHead className="w-[120px]">Rate</TableHead>
                <TableHead className="w-[100px]">Tax</TableHead>
                <TableHead>Amount (Incl. GST)</TableHead>
                <TableHead className="w-[44px] pr-3"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {revisionItems.map((item, idx) => {
                const amount = (item.quantity || 0) * (item.quote || 0);
                const totalAmount = amount + (amount * (item.tax || 0) / 100);
                const isDeleted = item.item_type === "Deleted";
                const isReplaced = item.item_type === "Replace";
                const isPartiallyDelivered = item.item_type !== "New" && (item.received_quantity || 0) > 0;

                return (
                  <TableRow key={idx} className={`h-14 border-b last:border-0 ${isDeleted ? "opacity-25 grayscale pointer-events-none" : "hover:bg-gray-50/50"}`}>
                    {/* Info hover */}
                    <TableCell className="pl-3 pr-0">
                      <HoverCard openDelay={100} closeDelay={100}>
                        <HoverCardTrigger asChild>
                          <button className="p-1 rounded hover:bg-gray-100 transition-colors">
                            <Eye className="h-3.5 w-3.5 text-gray-400 hover:text-primary" />
                          </button>
                        </HoverCardTrigger>
                        <HoverCardContent side="right" align="start" className="w-56 p-3 text-xs space-y-2">
                          <p className="font-semibold text-gray-900 text-[11px] uppercase tracking-wide">Item Info</p>
                          <div className="space-y-1 text-gray-600">
                            <div className="flex justify-between"><span>Type</span><span className="font-medium text-gray-900">{item.item_type}</span></div>
                            <div className="flex justify-between"><span>Received Qty</span><span className="font-medium text-gray-900">{item.received_quantity || 0}</span></div>
                            <div className="flex justify-between"><span>Min Qty</span><span className="font-medium text-gray-900">{isPartiallyDelivered ? item.received_quantity : 0}</span></div>
                          </div>
                          {isPartiallyDelivered && (
                            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
                              Partially delivered. Item name, unit cannot be changed. Qty cannot go below {item.received_quantity}.
                            </p>
                          )}
                          {isDeleted && (
                            <p className="text-[10px] text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1.5">
                              Marked for deletion. Will be removed from PO.
                            </p>
                          )}
                          {item.item_type === "New" && (
                            <p className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-2 py-1.5">
                              New item. All fields editable.
                            </p>
                          )}
                        </HoverCardContent>
                      </HoverCard>
                    </TableCell>

                    {/* Item Name */}
                    <TableCell>
                      {isCustom ? (
                        <Input
                          value={item.item_name}
                          onChange={(e) => {
                            const val = e.target.value;
                            const isOriginal = item.item_type === "Original";
                            let typeUpdates: Partial<RevisionItem> = {};
                            if (isOriginal && val !== item.item_name) {
                              typeUpdates = { item_type: "Replace", original_row_id: item.name };
                            }
                            handleUpdateItem(idx, { ...typeUpdates, item_name: val });
                          }}
                          disabled={isDeleted || item.category === "Additional Charges"}
                          placeholder="Item Name..."
                          className="text-xs font-medium h-9"
                        />
                      ) : item.item_type !== "Deleted" && item.item_type !== "Revised" ? (
                        <ReactSelect
                          options={itemOptions.filter(opt => !revisionItems.some(ri => ri.item_id === opt.item_id && ri.item_type !== "Deleted"))}
                          value={
                            item.item_id
                              ? itemOptions.find(opt => opt.item_id === item.item_id)
                              : item.item_name
                                ? { label: item.item_name, value: item.item_name, item_id: "", item_name: item.item_name, make: item.make || "", unit: item.unit || "", category: "", tax: item.tax || 0 }
                                : null
                          }
                          onChange={(selected: any) => {
                            const isOriginal = item.item_type === "Original";
                            let typeUpdates: Partial<RevisionItem> = {};
                            if (selected) {
                              if (isOriginal && selected.item_id !== item.item_id) {
                                typeUpdates = { item_type: "Replace", original_row_id: item.name };
                              }
                              handleUpdateItem(idx, {
                                ...typeUpdates,
                                item_id: selected.item_id,
                                item_name: selected.item_name,
                                make: selected.make,
                                unit: selected.unit,
                                tax: selected.tax,
                              });
                            } else {
                              if (isOriginal) {
                                typeUpdates = { item_type: "Replace", original_row_id: item.name };
                              }
                              handleUpdateItem(idx, { ...typeUpdates, item_id: undefined, item_name: "", make: "", unit: "Nos", tax: 0 });
                            }
                          }}
                          isDisabled={isDeleted || isPartiallyDelivered}
                          placeholder="Select Item..."
                          isClearable
                          styles={{
                            control: (base) => ({ ...base, minHeight: "36px", height: "36px", fontSize: "12px", fontWeight: 500 }),
                            valueContainer: (base) => ({ ...base, padding: "0 8px" }),
                            input: (base) => ({ ...base, margin: 0, padding: 0 }),
                          }}
                        />
                      ) : (
                        <div className="flex items-center h-9 px-3 text-xs font-medium text-gray-700 bg-gray-50 border rounded-md cursor-not-allowed">
                          {item.item_name}
                        </div>
                      )}
                    </TableCell>

                    {/* Make */}
                    {!isCustom && (
                      <TableCell>
                        <ReactSelect
                          options={(() => {
                            const optionItem = itemOptions.find(opt => opt.item_id === item.item_id);
                            const makes = optionItem?.available_makes || (item.make ? [item.make] : []);
                            return makes.map(m => ({ label: m, value: m }));
                          })()}
                          value={item.make ? { label: item.make, value: item.make } : null}
                          onChange={(selected: any) => handleUpdateItem(idx, { make: selected?.value || "" })}
                          isDisabled={isDeleted || !item.item_id}
                          placeholder="Make..."
                          isClearable
                          styles={{
                            control: (base) => ({ ...base, minHeight: "36px", height: "36px", fontSize: "12px", fontWeight: 500 }),
                            valueContainer: (base) => ({ ...base, padding: "0 8px" }),
                            input: (base) => ({ ...base, margin: 0, padding: 0 }),
                          }}
                        />
                      </TableCell>
                    )}

                    {/* Unit */}
                    <TableCell>
                      {isReplaced ? (
                        <LockedCell value={item.unit || "Nos"} />
                      ) : (
                        <SelectUnit
                          value={item.unit || ""}
                          onChange={(v) => handleUpdateItem(idx, { unit: v })}
                          disabled={isDeleted || isPartiallyDelivered}
                          className="text-xs h-9"
                        />
                      )}
                    </TableCell>

                    {/* Qty */}
                    <TableCell>
                      {isReplaced ? (
                        <LockedCell value={String(item.quantity)} />
                      ) : (
                        <Input
                          type="number"
                          min={isPartiallyDelivered ? item.received_quantity : 0}
                          value={item.category === "Additional Charges" ? 1 : item.quantity}
                          onChange={(e) => {
                            if (item.category === "Additional Charges") return;
                            handleUpdateItem(idx, { quantity: parseFloat(e.target.value) || 0 });
                          }}
                          disabled={isDeleted || item.category === "Additional Charges"}
                          className={`text-xs font-medium h-9 ${
                            !isDeleted && item.category !== "Additional Charges" &&
                            (item.quantity === undefined || item.quantity <= 0 || item.quantity < (isPartiallyDelivered ? (item.received_quantity ?? 0) : 0))
                              ? "border-red-400 ring-1 ring-red-400 bg-red-50/30"
                              : ""
                          } ${item.category === "Additional Charges" ? "bg-gray-50" : ""}`}
                        />
                      )}
                    </TableCell>

                    {/* Rate */}
                    <TableCell>
                      {isReplaced ? (
                        <LockedCell value={`₹${item.quote}`} />
                      ) : (
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-[10px]">₹</span>
                          <Input
                            type="number"
                            value={item.quote}
                            onChange={(e) => handleUpdateItem(idx, { quote: parseFloat(e.target.value) || 0 })}
                            disabled={isDeleted}
                            className={`text-xs font-medium pl-5 h-9 ${
                              !isDeleted && (item.quote === undefined || item.quote <= 0)
                                ? "border-red-400 ring-1 ring-red-400 bg-red-50/30"
                                : ""
                            }`}
                          />
                        </div>
                      )}
                    </TableCell>

                    {/* Tax */}
                    <TableCell>
                      {isReplaced ? (
                        <LockedCell value={`${item.tax}%`} />
                      ) : (
                        <Select
                          value={String(item.tax)}
                          onValueChange={(v) => handleUpdateItem(idx, { tax: parseFloat(v) })}
                          disabled={isDeleted}
                        >
                          <SelectTrigger className="text-xs h-9 border-gray-200 bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="5">5%</SelectItem>
                            <SelectItem value="12">12%</SelectItem>
                            <SelectItem value="18">18%</SelectItem>
                            <SelectItem value="28">28%</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>

                    {/* Amount */}
                    <TableCell className="text-xs font-semibold text-gray-900 tabular-nums">
                      {formatToIndianRupee(totalAmount)}
                    </TableCell>

                    {/* Delete/Undo */}
                    <TableCell className="pr-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (item.item_type !== "New" && (item.received_quantity || 0) > 0) return;
                          handleRemoveItem(idx);
                        }}
                        disabled={item.item_type !== "New" && (item.received_quantity || 0) > 0 && !isDeleted}
                        className={`p-0 h-7 w-7 rounded ${
                          isDeleted
                            ? "text-blue-600 bg-blue-50 hover:bg-blue-100"
                            : "text-gray-400 hover:text-red-500 hover:bg-red-50"
                        } disabled:opacity-30 disabled:cursor-not-allowed`}
                      >
                        {isDeleted ? <Undo className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ── Justification + Impact ── */}
      <div className="grid grid-cols-2 gap-8 pt-2">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Edit3 className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-xs text-gray-700 uppercase tracking-wide">
              Revision Justification
              <span className="text-red-500 ml-0.5">*</span>
            </h3>
          </div>
          <p className="text-[11px] text-gray-400 leading-tight">
            Provide a clear explanation for this revision. Recorded for audit purposes.
          </p>
          <Textarea
            placeholder="Explain what has changed and why (e.g. quantity correction, rate revision, scope change)"
            className="min-h-[120px] bg-white border-gray-200 text-xs placeholder:text-gray-300 rounded-md p-3 resize-none focus-visible:ring-primary/30"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
        </div>
        <ImpactSummaryTable
          beforeSummary={beforeSummary}
          afterSummary={afterSummary}
          difference={difference}
          netImpact={netImpact}
        />
      </div>

      <AddNewItemDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        onAdd={handleAddItem}
        isCustom={isCustom}
        itemOptions={itemOptions}
        revisionItems={revisionItems}
      />

      <AddChargeDialog
        open={isAddChargeDialogOpen}
        onOpenChange={setIsAddChargeDialogOpen}
        onAdd={handleAddItem}
        isCustom={isCustom}
        itemOptions={itemOptions}
        revisionItems={revisionItems}
      />
    </div>
  );
};

/** Small locked-field display for Replace-type items */
function LockedCell({ value }: { value: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center h-9 px-3 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-md cursor-not-allowed gap-1.5">
            <Lock className="h-3 w-3 text-gray-300" />
            {value}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Delete this row and add a new item for further changes
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
