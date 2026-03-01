import React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import formatCurrency from "@/utils/FormatPrice";
import { List } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PORevisionLineItemsProps {
    items: any[];
}

export default function PORevisionLineItems({ items }: PORevisionLineItemsProps) {
    const renderTag = (status: string) => {
        switch (status) {
            case "New":
                return <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">Added</span>;
            case "Revised":
                return <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">Revised</span>;
            case "Replace":
                return <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">Replaced</span>;
            case "Deleted":
                return <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">Removed</span>;
            case "Original":
                return <span className="inline-flex px-2 py-0.5 rounded text-[8px] font-medium bg-slate-100 text-slate-800">Original</span>;
            default:
                return null;
        }
    };

    return (
        <div className="space-y-2 mt-6">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <List className="w-5 h-5 text-red-600" />
                    <h3 className="text-sm font-bold text-slate-800">Line Items ({items.length})</h3>
                </div>
                <Button variant="outline" size="sm" className="text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600">
                    View Changes
                </Button>
            </div>
            
            <div className="rounded-md border shadow-sm bg-white overflow-x-auto">
                <Table>
                    <TableHeader className="bg-slate-50">
                        <TableRow>
                            <TableHead className="font-semibold text-slate-700 h-10 w-[30%]">ITEM</TableHead>
                            <TableHead className="font-semibold text-slate-700 h-10">MAKE</TableHead>
                            <TableHead className="font-semibold text-slate-700 h-10 w-20">UNIT</TableHead>
                            <TableHead className="font-semibold text-slate-700 h-10 text-right">QTY</TableHead>
                            <TableHead className="font-semibold text-slate-700 h-10 text-right">RATE</TableHead>
                            <TableHead className="font-semibold text-slate-700 h-10 text-right">TAX</TableHead>
                            <TableHead className="font-semibold text-slate-700 h-10 text-right">AMOUNT</TableHead>
                            <TableHead className="font-semibold text-slate-700 h-10 text-right whitespace-nowrap">AMOUNT (Incl. GST)</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={8} className="text-center text-slate-500 py-8">
                                    No item changes recorded.
                                </TableCell>
                            </TableRow>
                        ) : (
                            items.map((item, idx) => {
                                const isDeleted = item.item_type === "Deleted";
                                const isRevised = item.item_type === "Revised";
                                const isReplaced = item.item_type === "Replace";
                                const isChanged = isRevised || isReplaced;
                                const showTwoRows = false; // Both Revised and Replace are now inline
                                const isOriginal = item.item_type === "Original";
                                
                                const itemName = (isOriginal || isDeleted) ? (item.original_item_name || item.item_name || item.item || "Unknown Item") : (item.revision_item_name || item.item_name || item.original_item_name || item.item || "Unknown Item");
                                const make = (isOriginal || isDeleted) ? (item.original_make || item.make || "N/A") : (item.revision_make || item.make || item.original_make || "N/A");
                                const unit = (isOriginal || isDeleted) ? (item.original_unit || item.unit || item.uom || "NOS") : (item.revision_unit || item.unit || item.original_unit || item.uom || "NOS");
                                
                                const qty = (isOriginal || isDeleted) ? (item.original_qty ?? item.quantity ?? item.qty ?? 0) : (item.revision_qty ?? item.quantity ?? item.qty ?? 0);
                                const originalQty = item.original_qty ?? 0;
                                
                                const rate = (isOriginal || isDeleted) ? (item.original_rate ?? item.quote ?? item.rate ?? 0) : (item.revision_rate ?? item.quote ?? item.rate ?? 0);
                                const originalRate = item.original_rate ?? 0;
                                
                                const tax = (isOriginal || isDeleted) ? (item.original_tax ?? item.tax ?? 0) : (item.revision_tax ?? item.tax ?? item.original_tax ?? 0);
                                const originalTax = item.original_tax ?? 0;
                                
                                const baseAmount = (isOriginal || isDeleted) ? (item.original_amount ?? item.amount ?? (qty * rate) ?? 0) : (item.revision_amount ?? item.amount ?? (qty * rate) ?? 0);
                                const originalBaseAmount = item.original_amount ?? (originalQty * originalRate) ?? 0;
                                
                                const amountInclGst = baseAmount + (baseAmount * (tax / 100));
                                const originalAmountInclGst = originalBaseAmount + (originalBaseAmount * (originalTax / 100));

                                return (
                                    <React.Fragment key={idx}>
                                        {/* Original Row for Revised/Replaced Items */}
                                        {showTwoRows && (
                                            <TableRow className="opacity-50 line-through text-slate-400 bg-slate-50/50">
                                                <TableCell>
                                                    <div className="flex flex-col gap-1 items-start">
                                                        <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-600 no-underline">
                                                            Previous
                                                        </span>
                                                        <span className="font-medium mt-1">{item.original_item_name || item.item_name || item.item || "Unknown Item"}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell>{item.original_make || item.make || "N/A"}</TableCell>
                                                <TableCell>{item.original_unit || item.unit || item.uom || "NOS"}</TableCell>
                                                <TableCell className="text-right">{Number(originalQty).toFixed(2)}</TableCell>
                                                <TableCell className="text-right">{formatCurrency(originalRate)}</TableCell>
                                                <TableCell className="text-right">{originalTax}%</TableCell>
                                                <TableCell className="text-right whitespace-nowrap">{formatCurrency(originalBaseAmount)}</TableCell>
                                                <TableCell className="text-right whitespace-nowrap font-medium text-slate-500">
                                                    {formatCurrency(originalAmountInclGst)}
                                                </TableCell>
                                            </TableRow>
                                        )}

                                        {/* Main/Revised Row */}
                                        <TableRow className={isDeleted ? "opacity-50 line-through text-slate-400" : ""}>
                                            <TableCell>
                                                <div className="flex flex-col gap-1 items-start">
                                                    {renderTag(item.item_type)}
                                                    <div className="flex flex-col mt-1">
                                                        <span className="font-medium">{itemName}</span>
                                                        {isChanged && item.original_item_name && item.original_item_name !== item.revision_item_name && (
                                                            <span className="text-[10px] text-slate-400 line-through">{item.original_item_name}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className={isChanged && make !== (item.original_make || item.make || "N/A") ? "text-emerald-600 font-bold" : ""}>
                                                        {make}
                                                    </span>
                                                    {isChanged && item.original_make && item.original_make !== item.revision_make && (
                                                        <span className="text-[10px] text-slate-400 line-through">{item.original_make}</span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className={isChanged && unit !== (item.original_unit || item.unit || item.uom || "NOS") ? "text-emerald-600 font-bold" : ""}>
                                                        {unit}
                                                    </span>
                                                    {isChanged && item.original_unit && item.original_unit !== item.revision_unit && (
                                                        <span className="text-[10px] text-slate-400 line-through">{item.original_unit}</span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="text-right font-medium flex flex-col">
                                                    <span className={isChanged && qty !== originalQty ? "text-emerald-600 font-bold" : "text-slate-800"}>
                                                        {Number(qty).toFixed(2)}
                                                    </span>
                                                    {isChanged && qty !== originalQty && (
                                                        <span className="text-[10px] text-slate-400 line-through">{Number(originalQty).toFixed(2)}</span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="text-right font-medium flex flex-col">
                                                    <span className={isChanged && rate !== originalRate ? "text-emerald-600 font-bold" : "text-slate-800"}>
                                                        {formatCurrency(rate)}
                                                    </span>
                                                    {isChanged && rate !== originalRate && (
                                                        <span className="text-[10px] text-slate-400 line-through">{formatCurrency(originalRate)}</span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex flex-col items-end">
                                                    <span className={isChanged && tax !== originalTax ? "text-emerald-600 font-bold" : "text-slate-800 font-medium"}>
                                                        {tax}%
                                                    </span>
                                                    {isChanged && tax !== originalTax && (
                                                        <span className="text-[10px] text-slate-400 line-through">{originalTax}%</span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right whitespace-nowrap">
                                                <div className="flex flex-col items-end">
                                                    <span className={isChanged && baseAmount !== originalBaseAmount ? "text-emerald-600 font-bold" : "text-slate-800 font-medium"}>
                                                        {formatCurrency(baseAmount)}
                                                    </span>
                                                    {isChanged && baseAmount !== originalBaseAmount && (
                                                        <span className="text-[10px] text-slate-400 line-through">{formatCurrency(originalBaseAmount)}</span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right whitespace-nowrap">
                                                <div className="flex flex-col items-end">
                                                    <span className={isChanged && amountInclGst !== originalAmountInclGst ? "text-emerald-600 font-bold" : "text-slate-800 font-bold"}>
                                                        {formatCurrency(amountInclGst)}
                                                    </span>
                                                    {isChanged && amountInclGst !== originalAmountInclGst && (
                                                        <span className="text-[10px] text-slate-400 line-through">{formatCurrency(originalAmountInclGst)}</span>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    </React.Fragment>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
