import React, { useCallback } from 'react';
import {
    ProcurementItem, RFQData, ProcurementItemBase, ProcurementItemWithVendor
} from "@/types/NirmaanStack/ProcurementRequests";
import { SentBackItem } from "@/types/NirmaanStack/SentBackCategory";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MakesSelection } from './components/ItemVendorMakeSelection'; // Ensure path is correct
import { HistoricalQuotesHoverCard } from './components/HistoricalQuotesHoverCard'; // Ensure path
import QuantityQuoteInput from "@/components/helpers/QtyandQuoteInput";
import { VendorHoverCard } from "@/components/helpers/vendor-hover-card";
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { CircleCheck, CircleMinus, MessageCircleMore } from "lucide-react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { TargetRateDetailFromAPI, mapApiQuotesToApprovedQuotations } from '../ApproveVendorQuotes/types'; // Keep
import { ProgressDocumentType, getItemListFromDocument, getCategoryListFromDocument } from './types'; // Local feature types


interface SelectVendorQuotesTableProps {
    currentDocument: ProgressDocumentType;
    formData: RFQData;
    selectedVendorQuotes: Map<string, string>; // item.name -> vendor.value (ID)
    mode: 'edit' | 'view' | 'review';
    targetRatesData?: Map<string, TargetRateDetailFromAPI>;
    isReadOnly?: boolean; // New prop to disable inputs/actions

    onQuoteChange: (itemId: string, vendorId: string, quote: string) => void;
    onMakeChange: (itemId: string, vendorId: string, make: string) => void;
    onVendorSelectForItem: (itemId: string, vendorId: string | null) => void;
    onDeleteVendorFromRFQ: (vendorId: string) => void;
    setFormData: React.Dispatch<React.SetStateAction<RFQData>>; // For MakesSelection to directly update RFQData
    // Callback to update the item list in the parent (currentDocumentState)
    updateCurrentDocumentItemList: (updater: (prevItems: Array<ProcurementItem | SentBackItem>) => Array<ProcurementItem | SentBackItem>) => void;
}

export function SelectVendorQuotesTable({
    currentDocument,
    formData,
    selectedVendorQuotes,
    mode,
    targetRatesData,
    isReadOnly = false, // Default to false
    onQuoteChange,
    onVendorSelectForItem,
    onDeleteVendorFromRFQ,
    setFormData,
    updateCurrentDocumentItemList,
}: SelectVendorQuotesTableProps) {

    const itemsToDisplay = getItemListFromDocument(currentDocument);
    const categoriesToDisplay = getCategoryListFromDocument(currentDocument);

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
                    const { vendor, quote, make, ...rest } = item as ProcurementItemWithVendor;
                    return rest as ProcurementItemBase; // Return as base item
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


    return (
    <div className="overflow-x-auto space-y-4 rounded-md border shadow-sm p-2 md:p-4">
    {categoriesToDisplay.map((cat, index) => {
        const itemsInCategory = itemsToDisplay.filter(item => item.category === cat.name);
        if (itemsInCategory.length === 0) return null;

        return (
            <div key={cat.name} className="min-w-[600px]">
                <Table className="w-full">
                    <colgroup>
                        <col style={{ width: '200px', minWidth: '200px' }} /> {/* Item Details - fixed width */}
                        <col style={{ width: '60px', minWidth: '60px' }} />  {/* Qty - fixed width */}
                        <col style={{ width: '60px', minWidth: '60px' }} />  {/* UOM - fixed width */}
                        <col style={{ width: 'auto' }} /> {/* Dynamic vendor area */}
                        <col style={{ width: '120px', minWidth: '120px' }} /> {/* Target Rate - fixed width */}
                    </colgroup>
                    <TableHeader>
                        {index === 0 && (
                            <TableRow className="bg-primary/5">
                                <TableHead className="text-primary font-semibold">Item Details</TableHead>
                                <TableHead className="text-primary font-semibold text-center">Qty</TableHead>
                                <TableHead className="text-primary font-semibold text-center">UOM</TableHead>
                                <TableHead className="text-primary font-semibold p-0">
                                    <div className={`flex ${formData.selectedVendors.length <= 3 ? 'justify-center' : 'justify-start'} gap-2 overflow-x-auto px-2`}>
                                        {formData.selectedVendors.length === 0 ? (
                                            <div className="min-w-[180px] py-2 text-center text-primary font-medium border border-gray-400 rounded-md mx-auto">
                                                No Vendors Selected
                                            </div>
                                        ) : (
                                            formData.selectedVendors.map((v) => (
                                                <div key={v.value} className="flex-shrink-0">
                                                    <div className="min-w-[150px] max-w-[150px] py-1 flex gap-1 items-center justify-center border border-gray-400 rounded-md px-2 text-xs">
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
                                                                        <AlertDialogTitle>Remove Vendor: {v.label}?</AlertDialogTitle>
                                                                        <AlertDialogDescription>This will remove the vendor and all their quotes from this RFQ.</AlertDialogDescription>
                                                                    </AlertDialogHeader>
                                                                    <AlertDialogFooter>
                                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                        <Button variant="destructive" onClick={() => handleInternalDeleteVendor(v.value)}>Confirm Remove</Button>
                                                                    </AlertDialogFooter>
                                                                </AlertDialogContent>
                                                            </AlertDialog>
                                                        )}
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </TableHead>
                                <TableHead className="text-primary font-semibold text-right">Target Rate</TableHead>
                            </TableRow>
                        )}
                        <TableRow className="bg-red-50/80 hover:bg-red-50/40">
                            <TableHead colSpan={3} className="text-muted-foreground font-medium py-1.5 px-3">{cat.name}</TableHead>
                            <TableHead className="py-1.5"/>
                            <TableHead className="py-1.5"/>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {itemsInCategory.map((item) => {
                            const targetRateDetail = targetRatesData?.get(item.name);
                            let targetRateValue = -1;
                            if (targetRateDetail?.rate && targetRateDetail.rate !== "-1") {
                                const parsedRate = parseNumber(targetRateDetail.rate);
                                if (!isNaN(parsedRate)) targetRateValue = parsedRate * 0.98;
                            }
                            const mappedContributingQuotes = mapApiQuotesToApprovedQuotations(targetRateDetail?.selected_quotations_items || []);

                            return (
                                <TableRow key={item.name}>
                                    <TableCell className="py-2.5 align-top">
                                        <div className="font-medium text-sm">{item.item}</div>
                                        {item.comment && (
                                            <div className="flex items-start gap-1 mt-1">
                                                <MessageCircleMore className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                                                <p className="text-xs text-muted-foreground italic">{item.comment}</p>
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell className="align-middle text-center text-sm">{item.quantity}</TableCell>
                                    <TableCell className="align-middle text-center text-sm">{item.unit}</TableCell>
                                    <TableCell className="p-0">
                                        <div className={`flex ${formData.selectedVendors.length <= 3 ? 'justify-center' : 'justify-start'} gap-2 overflow-x-auto px-2 py-1.5`}>
                                            {formData.selectedVendors.length === 0 ? (
                                                <div className="min-w-[180px]" />
                                            ) : (
                                                formData.selectedVendors.map(vendor => {
                                                    const itemVendorDetails = formData.details[item.name]?.vendorQuotes?.[vendor.value];
                                                    const currentQuote = itemVendorDetails?.quote ?? "";
                                                    const currentMake = itemVendorDetails?.make ?? formData.details[item.name]?.initialMake;
                                                    const isSelectedForQuote = selectedVendorQuotes.get(item.name) === vendor.value;
                                                    const canSelectThisQuote = (currentQuote || String(currentQuote) === "0") && !isReadOnly && mode !== 'edit';

                                                    return (
                                                        <div key={`${item.name}-${vendor.value}`} className="flex-shrink-0">
                                                            <div
                                                                role="radio"
                                                                aria-checked={isSelectedForQuote}
                                                                tabIndex={canSelectThisQuote ? 0 : -1}
                                                                onClick={() => canSelectThisQuote && onVendorSelectForItem(item.name, vendor.value)}
                                                                onKeyDown={(e) => canSelectThisQuote && (e.key === 'Enter' || e.key === ' ') && onVendorSelectForItem(item.name, vendor.value)}
                                                                className={`min-w-[150px] max-w-[150px] space-y-1.5 p-2 border rounded-md transition-all relative hover:shadow-sm
                                                                    ${isSelectedForQuote ? "ring-1 ring-primary bg-primary/5 shadow-md" : "bg-card"}
                                                                    ${!canSelectThisQuote && mode === 'view' ? "opacity-60 cursor-not-allowed" : canSelectThisQuote ? "cursor-pointer focus:ring-1 focus:ring-ring" : ""}
                                                                `}
                                                            >
                                                                {isSelectedForQuote && <CircleCheck className="absolute w-3.5 h-3.5 top-1 right-1 text-primary" />}
                                                                <div className="space-y-0.5">
                                                                    <Label className="text-xs font-medium text-muted-foreground">Make</Label>
                                                                    {mode === "edit" && !isReadOnly ? (
                                                                        <MakesSelection
                                                                            defaultMake={formData.details[item.name]?.initialMake}
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
                                                                            onChange={(val) => handleInternalQuoteChange(item.name, vendor.value, val)}
                                                                        />
                                                                    ) : (
                                                                        <p className={`text-sm font-semibold ${targetRateValue !== -1 && parseNumber(String(currentQuote)) < targetRateValue ? "text-green-600" : ""}`}>{(currentQuote || String(currentQuote) === "0") ? formatToIndianRupee(parseNumber(String(currentQuote))) : "-"}</p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </TableCell>
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