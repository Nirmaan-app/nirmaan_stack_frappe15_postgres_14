import React, { useCallback } from 'react';
import {
    RFQData
} from "@/types/NirmaanStack/ProcurementRequests";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MakesSelection } from './components/ItemVendorMakeSelection'; // Ensure path is correct
import { HistoricalQuotesHoverCard } from './components/HistoricalQuotesHoverCard'; // Ensure path
import QuantityQuoteInput from "@/components/helpers/QtyandQuoteInput";
import { VendorHoverCard } from "@/components/helpers/vendor-hover-card";
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { CircleCheck, CircleMinus, MessageCircleMore } from "lucide-react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { TargetRateDetailFromAPI, mapApiQuotesToApprovedQuotations } from '../ApproveVendorQuotes/types'; // Keep
import { ProgressDocument, getItemListFromDocument, getCategoryListFromDocument, ProgressItem } from './types'; // Local feature types
import { getTargetRateKey } from './hooks/useTargetRatesForItems';

interface SelectVendorQuotesTableProps {
    currentDocument: ProgressDocument;
    formData: RFQData;
    selectedVendorQuotes: Map<string, string>; // item.name -> vendor.value (ID)
    mode: 'edit' | 'view' | 'review';
    targetRatesData?: Map<string, TargetRateDetailFromAPI>;
    isReadOnly?: boolean; // New prop to disable inputs/actions
 // MODIFIED: Add a specific handler for tax changes
    onTaxChange: (itemId: string, tax: string) => void;

    onQuoteChange: (itemId: string, vendorId: string, quote: string) => void;
    onMakeChange: (itemId: string, vendorId: string, make: string) => void;
    onVendorSelectForItem: (itemId: string, vendorId: string | null) => void;
    onDeleteVendorFromRFQ: (vendorId: string) => void;
    setFormData: React.Dispatch<React.SetStateAction<RFQData>>; // For MakesSelection to directly update RFQData
    // Callback to update the item list in the parent (currentDocumentState)
    updateCurrentDocumentItemList: (updater: (prevItems: ProgressItem[]) => ProgressItem[]) => void;
}

export function SelectVendorQuotesTable({
    currentDocument,
    formData,
    selectedVendorQuotes,
    mode,
    targetRatesData,
    isReadOnly = false, // Default to false
    onTaxChange, // MODIFIED: Destructure the new prop
    onQuoteChange,
    onVendorSelectForItem,
    onDeleteVendorFromRFQ,
    setFormData,
    updateCurrentDocumentItemList,
}: SelectVendorQuotesTableProps) {

    // console.log("currentDocument", currentDocument)
    const itemsToDisplay = getItemListFromDocument(currentDocument);
    const categoriesToDisplay = getCategoryListFromDocument(currentDocument);
    // console.log("currentDocument", currentDocument) 

    const handleInternalQuoteChange = useCallback((itemId: string, vendorId: string, quoteValue: string | number | undefined) => {
        const newQuoteString = String(quoteValue ?? "");
        onQuoteChange(itemId, vendorId, newQuoteString);

        const isValidQuote = newQuoteString && parseNumber(newQuoteString) > 0;
        if (!isValidQuote) {
            if (selectedVendorQuotes.get(itemId) === vendorId) {
                onVendorSelectForItem(itemId, null);
            }
        }
    }, [onQuoteChange, onVendorSelectForItem, selectedVendorQuotes]);

    const handleInternalDeleteVendor = useCallback((vendorId: string) => {
        onDeleteVendorFromRFQ(vendorId);
        // Also update the currentDocumentState's item list to remove vendor details
        updateCurrentDocumentItemList(prevItems =>
            prevItems.map(item => {
                if ('vendor' in item && item.vendor === vendorId) {
                    const { vendor, quote, make, ...rest } = item;
                    return rest; // Return as base item
                }
                return item;
            })
        );
    }, [onDeleteVendorFromRFQ, updateCurrentDocumentItemList]);


    if (!currentDocument || itemsToDisplay.length === 0 && categoriesToDisplay.length === 0) {
        return <div className="p-4 text-center text-muted-foreground">No items in this document to display RFQ for.</div>;
    }
    // if (formData.selectedVendors.length === 0 && mode === 'edit') {
    //     return <div className="p-4 text-center text-muted-foreground">Please add vendors to start entering quotes.</div>
    // }
    //  if (formData.selectedVendors.length === 0 && mode === 'view') {
    //     return <div className="p-4 text-center text-muted-foreground">No vendors were selected for RFQ in edit mode.</div>
    // }
 
    const numVendors = formData.selectedVendors.length;

    return (
        <div className="overflow-x-auto space-y-4 rounded-md border shadow-sm p-2 md:p-4">
            {categoriesToDisplay.map((cat, index) => {
                const itemsInCategory = itemsToDisplay.filter(item => item.category === cat.name);
                if (itemsInCategory.length === 0) return null;

                return (
                    <div key={cat.name} className="min-w-[600px]">
                        <Table className="w-full">
                            <colgroup>
                                 <col style={{ width: '200px', minWidth: '200px' }} /> {/* Item Details */}
                                <col style={{ width: '60px' }} />  {/* Qty */}
                                <col style={{ width: '60px' }} />  {/* UOM */}
                                <col style={{ width: '100px' }} /> {/* TAX - This was missing */}
                                 {formData.selectedVendors.map(v => (
                                    <col key={v.value} style={{ width: numVendors <= 3 ? 'auto' : '160px', minWidth: '160px' }} />
                                ))}
                               {numVendors === 0 && <col style={{ width: 'auto' }} />}
                                <col style={{ width: '120px' }} /> {/* Target Rate */}
                            </colgroup>
                            <TableHeader>
                                {index === 0 && (
                                    <TableRow className="bg-primary/5">
                                        <TableHead className="text-primary font-semibold">Item Details</TableHead>
                                        <TableHead className="text-primary font-semibold text-center">Qty</TableHead>
                                        <TableHead className="text-primary font-semibold text-center">UOM</TableHead>
                                        <TableHead className="text-primary font-semibold text-center">TAX</TableHead>
                                       {numVendors === 0 ? (
                                             <TableHead className="text-primary font-semibold text-center">
                                                <div className="py-2 text-primary font-medium border border-gray-400 rounded-md">
                                                    No Vendors Selected
                                                </div>
                                            </TableHead>
                                        ) : (
                                            formData.selectedVendors.map((v) => (
                                                <TableHead key={v.value} className="text-primary font-semibold p-1.5 text-center">
                                                    <div className="min-w-[150px] max-w-[150px] mx-auto py-1 flex gap-1 items-center justify-center border border-gray-400 rounded-md px-2 text-xs">
                                                        <div className="truncate flex-grow">
                                                            <VendorHoverCard vendor_id={v.value} />
                                                        </div>
                                                        {mode === "edit" && !isReadOnly && (
                                                            <AlertDialog>
                                                                <AlertDialogTrigger asChild>
                                                                    <Button variant="ghost" size="icon" className="h-5 w-5 p-0 text-destructive hover:bg-destructive/10 flex-shrink-0">
                                                                        <CircleMinus className="w-3.5 h-3.5" />
                                                                    </Button>
                                                                </AlertDialogTrigger>
                                                               <AlertDialogContent>
                                                                             <AlertDialogHeader>
                                                                                <AlertDialogTitle>Remove Vendor: {v.label}?</AlertDialogTitle>                                                                                <AlertDialogDescription>This will remove the vendor and all their quotes from this RFQ.</AlertDialogDescription>
                                                                           </AlertDialogHeader>
                                                                            <AlertDialogFooter>
                                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>                                                                                <Button variant="destructive" onClick={() => handleInternalDeleteVendor(v.value)}>Confirm Remove</Button>
                                                                            </AlertDialogFooter>
                                                                        </AlertDialogContent>
                                                            </AlertDialog>
                                                        )}
                                                    </div>
                                                </TableHead>
                                            ))
                                        )}
                                        <TableHead className="text-primary font-semibold text-right">Target Rate</TableHead>
                                    </TableRow>
                                )}
                                <TableRow className="bg-red-50/80 hover:bg-red-50/40">
                                 <TableHead colSpan={4 + (numVendors || 1) + 1} className="text-muted-foreground font-medium py-1.5 px-3">{cat.name}</TableHead>
                                    {/* <TableHead className="py-1.5" />
                                    <TableHead className="py-1.5" />
                                    <TableHead className="py-1.5" />
                                    <TableHead className="py-1.5" /> */}


                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {itemsInCategory.map((item) => {
                                     const lookupKey = getTargetRateKey(item.item_id, item.unit);
                                    const targetRateDetail = targetRatesData?.get(lookupKey);
                                    let targetRateValue = -1;
                                    if (targetRateDetail?.rate && targetRateDetail.rate !== "-1") {
                                        const parsedRate = parseNumber(targetRateDetail.rate);
                                        if (!isNaN(parsedRate)) targetRateValue = parsedRate * 0.98;
                                    }
                                    const mappedContributingQuotes = mapApiQuotesToApprovedQuotations(targetRateDetail?.selected_quotations_items || []);
                                    return (
                                        <TableRow key={item.item_id}>
                                            <TableCell className="py-2.5 text-start align-middle">
                                                <div className="font-medium text-sm">{item.item_name}</div>
                                                {item.comment && (
                                                    <div className="flex items-start gap-1 mt-1">
                                                        <MessageCircleMore className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                                                        <p className="text-xs text-muted-foreground italic">{item.comment}</p>
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="align-middle text-center text-sm">{item.quantity}</TableCell>
                                            <TableCell className="align-middle text-center text-sm">{item.unit}</TableCell>
                                            <TableCell className="align-middle text-center text-sm w-24">
                                                <Select
                                                    value={String(item.tax)||""}
                                                    onValueChange={(value) => {
                                                                    // console.log(`Tax selection changed for String(item.tax || "")item_id: ${item.item_id}. New value: ${value}`);

                                                        onTaxChange(item.item_id, value)}}
                                                    disabled={mode === 'view' || isReadOnly}  
                                                >
                                                    <SelectTrigger >
                                                        <SelectValue className="text-gray-200" placeholder="Select Tax %" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem key={5} value={"5"}>5 %</SelectItem>
                                                        {/* <SelectItem key={12} value={"12"}>12 %</SelectItem> */}
                                                        <SelectItem key={18} value={"18"}>18 %</SelectItem>
                                                        {/* <SelectItem key={28} value={"28"}>28 %</SelectItem> */}
                                                    </SelectContent>
                                                </Select>
                                            </TableCell>
                                             {numVendors === 0 && <TableCell />}
                                            {formData.selectedVendors.map(vendor => {
                                                const itemVendorDetails = formData.details[item.item_id]?.vendorQuotes?.[vendor.value];
                                                const currentQuote = itemVendorDetails?.quote ?? "";
                                                const currentMake = itemVendorDetails?.make ?? formData.details[item.item_id]?.initialMake;
                                                const isSelectedForQuote = selectedVendorQuotes.get(item.item_id) === vendor.value;
                                                const canSelectThisQuote = (currentQuote || String(currentQuote) === "0") && !isReadOnly && mode !== 'edit';

                                                return (
                                                    <TableCell key={`${item.item_id}-${vendor.value}`} className="p-1.5">
                                                        <div
                                                            role="radio"
                                                            aria-checked={isSelectedForQuote}
                                                            tabIndex={canSelectThisQuote ? 0 : -1}
                                                            onClick={() => canSelectThisQuote && onVendorSelectForItem(item.item_id, vendor.value)}
                                                            onKeyDown={(e) => canSelectThisQuote && (e.key === 'Enter' || e.key === ' ') && onVendorSelectForItem(item.item_id, vendor.value)}
                                                            className={`min-w-[150px] max-w-[150px] mx-auto space-y-1.5 p-2 border rounded-md transition-all relative hover:shadow-sm
                                                                ${isSelectedForQuote ? "ring-1 ring-primary bg-primary/5 shadow-md" : "bg-card"}
                                                                ${!canSelectThisQuote && mode === 'view' ? "opacity-60 cursor-not-allowed" : canSelectThisQuote ? "cursor-pointer focus:ring-1 focus:ring-ring" : ""}
                                                            `}
                                                        >
                                                            {isSelectedForQuote && <CircleCheck className="absolute w-3.5 h-3.5 top-1 right-1 text-primary" />}
                                                            {/* ... Vendor Make and Rate details ... */}
                                                             <div className="space-y-0.5">
                                                                <Label className="text-xs font-medium text-muted-foreground">Make</Label>
                                                                {mode === "edit" && !isReadOnly ? (
                                                                                <MakesSelection
                                                                                    defaultMake={formData.details[item.item_id]?.initialMake}
                                                                                    vendor={vendor}
                                                                                    item={item}
                                                                                    formData={formData}
                                                                                    setFormData={setFormData}
                                                                                />
                                                                            ) : (
                                                                                <p className={`text-xs font-medium truncate ${targetRateValue !== -1 && parseNumber(String(currentQuote)) < targetRateValue ? "text-green-600" : ""}`}>{currentMake || "-"}</p>
                                                                            )}
                                                             </div>
                                                             <div className="space-y-0.5">
                                                                <Label className="text-xs font-medium text-muted-foreground">Rate</Label>
                                                                {mode === "edit" && !isReadOnly ? (
                                                                                <QuantityQuoteInput
                                                                                    value={currentQuote}
                                                                                    onChange={(val) => handleInternalQuoteChange(item.item_id, vendor.value, val)}
                                                                                />
                                                                            ) : (
                                                                                <p className={`text-sm font-semibold ${targetRateValue !== -1 && parseNumber(String(currentQuote)) < targetRateValue ? "text-green-600" : ""}`}>{(currentQuote || String(currentQuote) === "0") ? formatToIndianRupee(parseNumber(String(currentQuote))) : "-"}</p>
                                                                            )}
                                                             </div>
                                                        </div>
                                                    </TableCell>
                                                );
                                            })}
                                         
                                            <TableCell className="align-middle text-right">
                                                <HistoricalQuotesHoverCard quotes={mappedContributingQuotes}>
                                                    {(targetRateValue === -1 || !targetRateValue) ? "N/A" : formatToRoundedIndianRupee(targetRateValue)}
                                                </HistoricalQuotesHoverCard>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                );
            })}
        </div>
    );
}

