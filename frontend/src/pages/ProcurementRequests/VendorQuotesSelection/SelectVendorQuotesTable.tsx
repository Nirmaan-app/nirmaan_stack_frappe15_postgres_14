// import QuantityQuoteInput from "@/components/helpers/QtyandQuoteInput";
// import { VendorHoverCard } from "@/components/helpers/vendor-hover-card";
// import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
// import { Button } from "@/components/ui/button";
// import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
// import { Label } from "@/components/ui/label";
// import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
// // import { useItemEstimate } from "@/hooks/useItemEstimate";
// import { ProcurementItem, ProcurementRequest, RFQData } from "@/types/NirmaanStack/ProcurementRequests";
// import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory";
// import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
// import { omit } from "lodash";
// import { CheckCheck, CircleCheck, CircleMinus, MessageCircleMore } from "lucide-react";
// import React, { useCallback } from "react";
// import { MakesSelection } from "./components/ItemVendorMakeSelection";
// import { parseNumber } from "@/utils/parseNumber";
// // import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations";
// import { HistoricalQuotesHoverCard } from "./components/HistoricalQuotesHoverCard";
// // Import the necessary types and mapping function
// import { TargetRateDetailFromAPI, ApiSelectedQuotation, ApprovedQuotations, mapApiQuotesToApprovedQuotations } from '../ApproveVendorQuotes/types'; // Adjust path if needed

// type DocumentType = ProcurementRequest | SentBackCategory

// interface SelectVendorQuotesTableProps<T extends DocumentType> {
//   sentBack?: boolean;
//   orderData: T;
//   formData: RFQData;
//   setFormData: React.Dispatch<React.SetStateAction<RFQData>>
//   selectedVendorQuotes: Map<any, any>
//   setSelectedVendorQuotes: React.Dispatch<React.SetStateAction<Map<any, any>>>
//   mode: string
//   setOrderData: React.Dispatch<React.SetStateAction<T | null>>
//   // --- ADDED PROP for Target Rate Data ---
//   targetRatesData?: Map<string, TargetRateDetailFromAPI>; // Pass the map from the parent
// }

// export function SelectVendorQuotesTable<T extends DocumentType>({ sentBack = false, orderData, setOrderData, formData, setFormData, selectedVendorQuotes, setSelectedVendorQuotes, mode, targetRatesData }: SelectVendorQuotesTableProps<T>) {

//   // const { getItemEstimate } = useItemEstimate()

//   const handleQuoteChange = useCallback((
//     itemId: string,
//     vendorId: string,
//     quote: string | number | undefined,
//   ) => {
//     setFormData((prev) => ({
//       ...prev,
//       details: {
//         ...prev.details,
//         [itemId]: {
//           ...prev.details[itemId],
//           vendorQuotes: {
//             ...prev.details[itemId].vendorQuotes,
//             [vendorId]: { ...(prev.details[itemId].vendorQuotes[vendorId] || {}), quote: quote },
//           },
//         },
//       },
//     }))

//     const isValidQuote = quote && parseNumber(quote) > 0;
//     if (!isValidQuote) {
//       setSelectedVendorQuotes(prev => {
//         const updated = new Map(prev);
//         if (updated.get(itemId) === vendorId) {
//           updated.delete(itemId);
//         }
//         return updated;
//       });
//     }
//   }, [setFormData, setSelectedVendorQuotes]);

//   // Define type guards (if not already defined elsewhere)
//   function isProcurementRequest(doc: DocumentType): doc is ProcurementRequest {
//     return 'procurement_list' in doc;
//   }

//   function isSentBackCategory(doc: DocumentType): doc is SentBackCategory {
//     return 'item_list' in doc;
//   }

//   const removeVendor = useCallback((vendorId: string) => {
//     setFormData((prev) => {
//       const updatedSelectedVendors = prev.selectedVendors.filter(
//         (v) => v?.value !== vendorId
//       );

//       const updatedDetails = Object.keys(prev.details).reduce(
//         (acc, itemId) => {
//           const itemDetails = prev.details[itemId];
//           const updatedVendorQuotes = { ...itemDetails.vendorQuotes };
//           delete updatedVendorQuotes[vendorId];

//           acc[itemId] = {
//             ...itemDetails,
//             vendorQuotes: updatedVendorQuotes,
//           };
//           return acc;
//         },
//         {} as typeof prev.details
//       );

//       return {
//         ...prev,
//         selectedVendors: updatedSelectedVendors,
//         details: updatedDetails,
//       };
//     });

//     setSelectedVendorQuotes(prev => {
//       const updatedQuotes = new Map(prev)

//       for (const [itemId, vendor] of updatedQuotes) {
//         if (vendor === vendorId) updatedQuotes.delete(itemId)
//       }
//       return updatedQuotes
//     })

//     // if(sentBack) {
//     //   setOrderData((prev) => ({
//     //     ...prev,
//     //     item_list: {
//     //       list: prev?.item_list.list.map((item) => 
//     //       item?.vendor === vendorId ? omit(item, ["vendor", "quote", "make"]) : item
//     //       )
//     //     }
//     //   }))
//     // } else {
//     //   setOrderData((prev) => ({
//     //       ...prev,
//     //       procurement_list: {
//     //         list: prev.procurement_list.list.map((item) => 
//     //         item?.vendor === vendorId ? omit(item, ["vendor", "quote", "make"]) : item
//     //         )
//     //       }
//     //     }))
//     // }

//     // In removeVendor
//     setOrderData((prevOrderData) => {
//       if (!prevOrderData) return null;

//       if (sentBack && isSentBackCategory(prevOrderData)) {
//         return {
//           ...prevOrderData, // Now prevOrderData is correctly typed as SentBackCategory
//           item_list: {
//             ...(prevOrderData.item_list || { list: [] }),
//             list: (prevOrderData.item_list?.list || []).map((item: any) =>
//               item?.vendor === vendorId ? omit(item, ["vendor", "quote", "make"]) : item
//             )
//           }
//         }; // No 'as T' needed here, TypeScript infers it
//       } else if (!sentBack && isProcurementRequest(prevOrderData)) {
//         return {
//           ...prevOrderData, // Now prevOrderData is correctly typed as ProcurementRequest
//           procurement_list: {
//             ...(prevOrderData.procurement_list || { list: [] }),
//             list: (prevOrderData.procurement_list?.list || []).map((item: any) =>
//               item?.vendor === vendorId ? omit(item, ["vendor", "quote", "make"]) : item
//             )
//           }
//         }; // No 'as T' needed here
//       }
//       // Fallback or error if type doesn't match expectation, though this shouldn't happen with your logic
//       console.warn("Type mismatch in setOrderData for removeVendor");
//       return prevOrderData; // Or null, or throw error
//     });
//   }, [setOrderData, setSelectedVendorQuotes, setFormData]);



//   return (
//     <div className="overflow-x-auto space-y-4 rounded-md border shadow-sm p-4">
//       {/* Check if category_list exists and is an array */}
//       {Array.isArray(orderData?.category_list?.list) && orderData.category_list.list.map((cat: any, index: number) => {
//         return <div key={cat.name} className="min-w-[400px]">
//           <Table>
//             <TableHeader>
//               {index === 0 && (
//                 <TableRow className="bg-red-100">
//                   <TableHead className="min-w-[200px] w-[30%] text-red-700 font-bold">
//                     Item Details
//                   </TableHead>
//                   <TableHead className="min-w-[80px] w-[10%] text-red-700 font-bold">QTY</TableHead>
//                   <TableHead className="min-w-[80px] w-[10%] text-red-700 font-bold">UOM</TableHead>
//                   {formData?.selectedVendors?.length === 0 ? (
//                     <TableHead className="min-w-[300px] w-[40%] text-red-700">
//                       <p className="border text-center border-gray-400 rounded-md py-1 font-medium">No Vendors Selected</p>
//                     </TableHead>
//                   ) : (
//                     formData?.selectedVendors?.map((v, _) => <TableHead key={v?.value} className={`text-center w-[15%] text-red-700 text-xs font-medium`}>
//                       <p className="min-w-[150px] max-w-[150px] border border-gray-400 rounded-md py-1 flex gap-1 items-center justify-center">
//                         <div className="truncate text-left">
//                           <VendorHoverCard vendor_id={v?.value} />
//                         </div>
//                         {mode === "edit" && (
//                           <AlertDialog>
//                             <AlertDialogTrigger asChild>
//                               <CircleMinus className="w-4 h-4 cursor-pointer" />
//                             </AlertDialogTrigger>
//                             <AlertDialogContent>
//                               <AlertDialogHeader>
//                                 <AlertDialogTitle>Are you sure?</AlertDialogTitle>
//                                 <AlertDialogDescription>Click on confirm to remove this vendor?</AlertDialogDescription>
//                                 <div className="flex items-end justify-end gap-2">
//                                   <AlertDialogCancel asChild>
//                                     <Button variant="outline" className="border-primary text-primary">Cancel</Button>
//                                   </AlertDialogCancel>
//                                   <Button onClick={() => removeVendor(v?.value || "")} className="flex items-center gap-1">
//                                     <CheckCheck className="h-4 w-4" />
//                                     Confirm
//                                   </Button>
//                                 </div>
//                               </AlertDialogHeader>

//                             </AlertDialogContent>
//                           </AlertDialog>
//                         )}
//                       </p>
//                     </TableHead>)
//                   )}
//                   <TableHead className="min-w-[80px] w-[10%] text-red-700 font-bold">Target Rate</TableHead>
//                 </TableRow>
//               )}
//               <TableRow className="bg-red-50">
//                 <TableHead className="min-w-[200px] w-[30%] text-red-700">
//                   {cat.name}
//                 </TableHead>
//                 <TableHead className="min-w-[80px] w-[10%]" />
//                 <TableHead className="min-w-[80px] w-[10%]" />
//                 {formData?.selectedVendors?.length === 0 ? (
//                   <TableHead className="min-w-[300px] w-[40%]" />
//                 ) : (
//                   formData?.selectedVendors?.map((v) => <TableHead key={v?.value} className={`min-w-[150px] w-[15%] max-w-[150px]`} />) // Added key
//                 )}
//                 <TableHead className="min-w-[80px] w-[10%]" />
//               </TableRow>
//             </TableHeader>
//             <TableBody>
//               {/* Check if procurement_list exists and is an array */}
//               {Array.isArray((sentBack ? (orderData as SentBackCategory)?.item_list : (orderData as ProcurementRequest)?.procurement_list)?.list) &&
//                 (sentBack ? (orderData as SentBackCategory)?.item_list : (orderData as ProcurementRequest)?.procurement_list)?.list.map((item: ProcurementItem) => { // Added type
//                   if (item.category === cat.name) {
//                     // const targetQuote: number = (getItemEstimate(item.name)?.averageRate ?? 0) * 0.98
//                     // const contributingQuotes = getItemEstimate(item.name)?.contributingQuotes
//                     // const estimate = getItemEstimate(item.name); // Call your function to get data
//                     // const targetQuoteValue: number = estimate ? estimate.averageRate * 0.98 : 0; // Calculate target
//                     // const contributingQuotes: ApprovedQuotations[] | null = estimate ? estimate.contributingQuotes : null;
//                     // --- Get Target Rate Info from Prop ---
//                     const targetRateDetail = targetRatesData?.get(item.name); // Use the passed map
//                     let targetRateValue: number = -1;
//                     let contributingQuotes: ApiSelectedQuotation[] = [];
//                     if (targetRateDetail && targetRateDetail.rate) {
//                       const parsedRate = parseFloat(targetRateDetail.rate);
//                       if (!isNaN(parsedRate)) targetRateValue = parsedRate;
//                     }
//                     if (targetRateDetail?.selected_quotations_items) {
//                       contributingQuotes = targetRateDetail.selected_quotations_items;
//                     }
//                     // Map quotes for hover card
//                     const mappedQuotes = mapApiQuotesToApprovedQuotations(contributingQuotes);
//                     // --- End Target Rate Info ---

//                     return (
//                       <TableRow key={`${cat.name}-${item.name}`}>
//                         <TableCell className="py-8">
//                           <div className="inline items-baseline">
//                             <span>{item.item}</span>
//                             {item.comment && (
//                               <HoverCard>
//                                 <HoverCardTrigger><MessageCircleMore className="text-blue-400 w-6 h-6 inline-block ml-1" /></HoverCardTrigger>
//                                 <HoverCardContent className="max-w-[300px] bg-gray-800 text-white p-2 rounded-md shadow-lg">
//                                   <div className="relative pb-4">
//                                     <span className="block">{item.comment}</span>
//                                     <span className="text-xs absolute right-0 italic text-gray-200">-Comment by PL</span>
//                                   </div>

//                                 </HoverCardContent>
//                               </HoverCard>
//                             )}
//                           </div>
//                         </TableCell>
//                         <TableCell>{item.unit}</TableCell>
//                         <TableCell>{item.quantity}</TableCell>
//                         {/* Map through selected vendors */}
//                         {Array.isArray(formData?.selectedVendors) && formData.selectedVendors.map(v => {
//                           const vendorQuotes = formData?.details?.[item.name]?.vendorQuotes
//                           const defaultMake = formData?.details?.[item.name]?.initialMake
//                           // let lowestQuote = Number.POSITIVE_INFINITY; // Initialize with the highest possible value
//                           // let lowestVendorId: string | null = null; // Initialize winner vendor ID as null

//                           // // 3. Iterate through each [vendorId, quoteData] pair in vendorQuotes
//                           // for (const [vendorId, quoteData] of Object.entries(vendorQuotes)) {
//                           //   const q = parseNumber(quoteData?.quote)
//                           //   if (q < lowestQuote) {
//                           //     lowestQuote = parseNumber(q)
//                           //     lowestVendorId = vendorId
//                           //   }
//                           // }
//                           const data = vendorQuotes?.[v?.value]
//                           const quote = parseNumber(data?.quote)
//                           const make = data?.make
//                           const isSelected = mode === "view" && selectedVendorQuotes?.get(item?.name) === v?.value;
//                           return (
//                             <TableCell key={`${item.name}-${v?.value}`}> {/* Added key */}
//                               <div aria-disabled={mode === "edit" || !quote} aria-checked={isSelected}
//                                 onClick={() => {
//                                   if (mode === "edit") {
//                                     return
//                                   }
//                                   if (isSelected) {
//                                     const updatedQuotes = new Map(selectedVendorQuotes);
//                                     updatedQuotes.delete(item.name);
//                                     setSelectedVendorQuotes(updatedQuotes);
//                                   } else {
//                                     setSelectedVendorQuotes(new Map(selectedVendorQuotes.set(item.name, v?.value)));
//                                   }
//                                 }}
//                                 role="radio"
//                                 tabIndex={0}
//                                 className={`min-w-[150px] max-w-[150px] space-y-3 p-3 border border-gray-300 rounded-md shadow-md transition-all 
//                                     ring-offset-2 ring-gray-300 focus:ring-2 focus:ring-primary hover:shadow-lg ${mode === "view" && !quote ? "pointer-events-none opacity-50" : ""} ${isSelected ? "bg-red-100 ring-2 ring-primary" : "bg-white"} relative`}>
//                                 <CircleCheck className={`absolute w-5 h-5 right-2 text-red-600 ${isSelected ? "" : 'hidden'}`} />
//                                 <div className="flex flex-col gap-1">
//                                   <Label className="text-xs font-semibold text-primary">Make</Label>
//                                   {mode === "edit" ? (
//                                     <MakesSelection defaultMake={defaultMake} vendor={v} item={item} formData={formData} orderData={orderData} setFormData={setFormData} />
//                                   ) : (
//                                     <p className={`text-sm font-medium text-gray-700 ${targetRateValue !== -1 && quote < targetRateValue ? "text-green-600" : ""}`}>{make || defaultMake || "--"}</p> // Apply green if lower than target
//                                   )}
//                                 </div>
//                                 <div className="flex flex-col gap-1">
//                                   <Label className="text-xs font-semibold text-primary">Rate</Label>
//                                   {mode === "edit" ? (
//                                     // <Input
//                                     //     className="h-8"
//                                     //     value={quote || ""}
//                                     //     onChange={(e) => {
//                                     //         const value = e.target.value;
//                                     //         if (/^\d*\.?\d*$/.test(value) || value === "") {
//                                     //             handleQuoteChange(item.name, v?.value || "", value);
//                                     //         }
//                                     //     }}
//                                     // />
//                                     <QuantityQuoteInput value={quote || ""} onChange={(value) => handleQuoteChange(item.name, v?.value || "", value)} />
//                                   ) : (
//                                     <p className={`text-sm font-medium text-gray-700 ${targetRateValue !== -1 && quote < targetRateValue ? "text-green-600" : ""}`}>{quote ? formatToIndianRupee(quote) : "--"}</p> // Apply green if lower than target
//                                   )}
//                                 </div>
//                               </div>
//                             </TableCell>
//                           )
//                         })}
//                         {/* Handle case where no vendors are selected */}
//                         {(!formData?.selectedVendors || formData.selectedVendors.length === 0) && <TableCell />}
//                         {/* --- Target Rate Cell --- */}
//                         <TableCell>
//                           <HistoricalQuotesHoverCard quotes={mappedQuotes}>
//                             {targetRateValue === -1 ? "N/A" : formatToRoundedIndianRupee(targetRateValue * 0.98)}
//                           </HistoricalQuotesHoverCard>
//                         </TableCell>
//                       </TableRow>
//                     )
//                   }
//                   return null;
//                 })}
//             </TableBody>
//           </Table>
//         </div>
//       })}
//     </div>
//   )
// }


// import React, { useCallback } from 'react'; // Removed unused useMemo
// import { ProcurementItem, RFQData, ProcurementRequest, ProcurementItemWithVendor } from "@/types/NirmaanStack/ProcurementRequests"; // Keep
// import { SentBackCategory, SentBackItem } from "@/types/NirmaanStack/SentBackCategory"; // Keep
// import { TargetRateDetailFromAPI, ApiSelectedQuotation, ApprovedQuotations, mapApiQuotesToApprovedQuotations } from '../ApproveVendorQuotes/types'; // Keep
// import { ProgressDocumentType, VendorOption, getItemListFromDocument, getCategoryListFromDocument } from './types'; // Local feature types
// import { MakesSelection } from './components/ItemVendorMakeSelection'; // Path might need adjustment
// import { HistoricalQuotesHoverCard } from './components/HistoricalQuotesHoverCard'; // Path
// import formatToIndianRupee, { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
// import { parseNumber } from '@/utils/parseNumber';
// import { omit } from 'lodash';
// import { CheckCheck, CircleCheck, CircleMinus, MessageCircleMore } from 'lucide-react';
// import { Label } from '@/components/ui/label';
// import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
// import { VendorHoverCard } from '@/components/helpers/vendor-hover-card';
// import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
// import { Button } from '@/components/ui/button';
// import QuantityQuoteInput from '@/components/helpers/QtyandQuoteInput';

// // Props this component now expects
// interface SelectVendorQuotesTableProps {
//     currentDocument: ProgressDocumentType; // The PR or SBC document itself
//     formData: RFQData;
//     selectedVendorQuotes: Map<string, string>; // item.name -> vendor.value
//     mode: 'edit' | 'view' | 'review';
//     targetRatesData?: Map<string, TargetRateDetailFromAPI>;
    
//     // Specific Callbacks from the logic hook
//     onQuoteChange: (itemId: string, vendorId: string, quote: string) => void;
//     onMakeChange: (itemId: string, vendorId: string, make: string) => void;
//     onVendorSelectForItem: (itemId: string, vendorId: string | null) => void; // For radio button selection
//     onDeleteVendorFromRFQ: (vendorId: string) => void;
//     // For MakesSelection, it needs to update formData directly if a make changes
//     setFormData: React.Dispatch<React.SetStateAction<RFQData>>;
//     // If SelectVendorQuotesTable needs to update the main document state for some reason (e.g., optimistic UI)
//     // This is less ideal, try to avoid if possible and let actions handle it.
//     // setOrderData: React.Dispatch<React.SetStateAction<ProgressDocumentType | undefined>>;
// }

// export function SelectVendorQuotesTable({
//     currentDocument,
//     formData,
//     selectedVendorQuotes,
//     mode,
//     targetRatesData,
//     onQuoteChange,
//     onMakeChange,
//     onVendorSelectForItem,
//     onDeleteVendorFromRFQ,
//     setFormData, // Passed to MakesSelection
//     // setOrderData, // Removed direct setOrderData for now, can be added if strictly necessary
// }: SelectVendorQuotesTableProps) {

//     const itemsToDisplay = getItemListFromDocument(currentDocument);
//     const categoriesToDisplay = getCategoryListFromDocument(currentDocument);

//     // Type guard (can be defined globally or imported)
//     function isProcurementItemWithVendor(item: ProcurementItem | SentBackItem): item is ProcurementItemWithVendor {
//       return 'vendor' in item;
//     }


//     const handleInternalQuoteChange = useCallback((itemId: string, vendorId: string, quoteValue: string | number | undefined) => {
//         // Convert to string before calling parent, as input gives string or number
//         onQuoteChange(itemId, vendorId, String(quoteValue ?? ""));

//         // Logic to deselect vendor if quote becomes invalid (already in your original hook)
//         const isValidQuote = quoteValue !== undefined && quoteValue !== "" && parseNumber(String(quoteValue)) > 0;
//         if (!isValidQuote) {
//             if (selectedVendorQuotes.get(itemId) === vendorId) {
//                 onVendorSelectForItem(itemId, null); // Deselect
//             }
//         }
//     }, [onQuoteChange, onVendorSelectForItem, selectedVendorQuotes]);


//     if (!currentDocument) {
//         return <div className="p-4 text-muted-foreground">Loading items...</div>;
//     }

//     return (
//         <div className="overflow-x-auto space-y-4 rounded-md border shadow-sm p-2 md:p-4">
//             {categoriesToDisplay.map((cat, index) => {
//                 const itemsInCategory = itemsToDisplay.filter(item => item.category === cat.name);
//                 if (itemsInCategory.length === 0) return null;

//                 return (
//                     <div key={cat.name} className="min-w-[600px]"> {/* Min width for horizontal scroll */}
//                         <Table>
//                             <TableHeader>
//                                 {index === 0 && ( // Render main headers only for the first category
//                                     <TableRow className="bg-primary/10">
//                                         <TableHead className="min-w-[200px] w-[25%] text-primary font-semibold">Item Details</TableHead>
//                                         <TableHead className="min-w-[70px] w-[8%] text-primary font-semibold">Qty</TableHead>
//                                         <TableHead className="min-w-[70px] w-[8%] text-primary font-semibold">UOM</TableHead>
//                                         {formData.selectedVendors.length === 0 ? (
//                                             <TableHead className="min-w-[250px] w-[44%] text-primary">
//                                                 <p className="text-center text-muted-foreground py-1 font-normal">No Vendors Selected for RFQ</p>
//                                             </TableHead>
//                                         ) : (
//                                             formData.selectedVendors.map((v) => (
//                                                 <TableHead key={v.value} className="text-center w-[150px] text-primary text-xs font-medium">
//                                                     <div className="min-w-[150px] max-w-[180px] py-1 flex gap-1 items-center justify-center">
//                                                         <div className="truncate">
//                                                             <VendorHoverCard vendor_id={v.value} vendor_name={v.label} />
//                                                         </div>
//                                                         {mode === "edit" && (
//                                                             <AlertDialog>
//                                                                 <AlertDialogTrigger asChild>
//                                                                     <Button variant="ghost" size="icon" className="h-5 w-5 p-0 text-destructive hover:bg-destructive/10">
//                                                                         <CircleMinus className="w-3.5 h-3.5" />
//                                                                     </Button>
//                                                                 </AlertDialogTrigger>
//                                                                 <AlertDialogContent>
//                                                                     <AlertDialogHeader>
//                                                                         <AlertDialogTitle>Remove Vendor: {v.label}?</AlertDialogTitle>
//                                                                         <AlertDialogDescription>This will remove the vendor and all their quotes from this RFQ. This action cannot be undone from here.</AlertDialogDescription>
//                                                                     </AlertDialogHeader>
//                                                                     <AlertDialogFooter>
//                                                                         <AlertDialogCancel>Cancel</AlertDialogCancel>
//                                                                         <Button
//                                                                         variant="destructive" onClick={() => onDeleteVendorFromRFQ(v.value)}>
//                                                                             <CheckCheck className="mr-2 h-4 w-4" />Confirm Remove
//                                                                         </Button>
//                                                                     </AlertDialogFooter>
//                                                                 </AlertDialogContent>
//                                                             </AlertDialog>
//                                                         )}
//                                                     </div>
//                                                 </TableHead>
//                                             ))
//                                         )}
//                                         <TableHead className="min-w-[100px] w-[15%] text-primary font-semibold text-right">Target Rate</TableHead>
//                                     </TableRow>
//                                 )}
//                                 <TableRow className="bg-muted/50">
//                                     <TableHead colSpan={3} className="text-muted-foreground font-medium">{cat.name}</TableHead>
//                                     {formData.selectedVendors.map(v => <TableHead key={`${cat.name}-${v.value}`} />)}
//                                     <TableHead />{/* For Target Rate column */}
//                                 </TableRow>
//                             </TableHeader>
//                             <TableBody>
//                                 {itemsInCategory.map((item) => {
//                                     const targetRateDetail = targetRatesData?.get(item.name);
//                                     let targetRateValue: number = -1;
//                                     if (targetRateDetail?.rate) {
//                                         const parsedRate = parseFloat(targetRateDetail.rate);
//                                         if (!isNaN(parsedRate)) targetRateValue = parsedRate * 0.98; // Apply 2% reduction
//                                     }
//                                     const mappedContributingQuotes = mapApiQuotesToApprovedQuotations(targetRateDetail?.selected_quotations_items || []);

//                                     return (
//                                         <TableRow key={item.name}>
//                                             <TableCell className="py-3 align-top">
//                                                 <div className="font-medium">{item.item}</div>
//                                                 {item.comment && (
//                                                     <div className="flex items-start gap-1 mt-1">
//                                                         <MessageCircleMore className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
//                                                         <p className="text-xs text-muted-foreground italic">{item.comment}</p>
//                                                     </div>
//                                                 )}
//                                             </TableCell>
//                                             <TableCell className="align-middle text-center">{item.quantity}</TableCell>
//                                             <TableCell className="align-middle text-center">{item.unit}</TableCell>
//                                             {formData.selectedVendors.map(vendor => {
//                                                 const itemVendorDetails = formData.details[item.name]?.vendorQuotes?.[vendor.value];
//                                                 const currentQuote = itemVendorDetails?.quote ?? "";
//                                                 const currentMake = itemVendorDetails?.make ?? formData.details[item.name]?.initialMake;
//                                                 const isSelectedForQuote = selectedVendorQuotes.get(item.name) === vendor.value;

//                                                 return (
//                                                     <TableCell key={`${item.name}-${vendor.value}`} className="align-top p-2">
//                                                         <div
//                                                             role="radio"
//                                                             aria-checked={isSelectedForQuote}
//                                                             tabIndex={0}
//                                                             onClick={() => {
//                                                                 if (mode === "view" && (currentQuote || String(currentQuote) === "0")) {
//                                                                     onVendorSelectForItem(item.name, vendor.value);
//                                                                 }
//                                                             }}
//                                                             onKeyDown={(e) => {
//                                                                 if (mode === "view" && (currentQuote || String(currentQuote) === "0") && (e.key === 'Enter' || e.key === ' ')) {
//                                                                     onVendorSelectForItem(item.name, vendor.value);
//                                                                 }
//                                                             }}
//                                                             className={`space-y-2 p-2.5 border rounded-md transition-all relative hover:shadow-md
//                                                                 ${isSelectedForQuote ? "ring-2 ring-primary bg-primary/5" : "bg-card"}
//                                                                 ${mode === "view" && (!currentQuote && String(currentQuote) !== "0") ? "opacity-50 cursor-not-allowed" : "cursor-pointer focus:ring-2 focus:ring-ring"}
//                                                             `}
//                                                         >
//                                                             {isSelectedForQuote && <CircleCheck className="absolute w-4 h-4 top-1.5 right-1.5 text-primary" />}
//                                                             <div className="space-y-0.5">
//                                                                 <Label className="text-xs font-medium text-muted-foreground">Make</Label>
//                                                                 {mode === "edit" ? (
//                                                                     <MakesSelection
//                                                                         defaultMake={formData.details[item.name]?.initialMake}
//                                                                         vendor={vendor}
//                                                                         item={item}
//                                                                         formData={formData}
//                                                                         // orderData={currentDocument} // Pass currentDocument
//                                                                         setFormData={setFormData} // Pass setFormData for direct updates
//                                                                     />
//                                                                 ) : (
//                                                                     <p className={`text-sm font-medium ${targetRateValue !== -1 && parseNumber(String(currentQuote)) < targetRateValue ? "text-green-600" : ""}`}>{currentMake || "-"}</p>
//                                                                 )}
//                                                             </div>
//                                                             <div className="space-y-0.5">
//                                                                 <Label className="text-xs font-medium text-muted-foreground">Rate</Label>
//                                                                 {mode === "edit" ? (
//                                                                     <QuantityQuoteInput
//                                                                         value={currentQuote}
//                                                                         onChange={(val) => handleInternalQuoteChange(item.name, vendor.value, val)}
//                                                                     />
//                                                                 ) : (
//                                                                     <p className={`text-sm font-medium ${targetRateValue !== -1 && parseNumber(String(currentQuote)) < targetRateValue ? "text-green-600" : ""}`}>{ (currentQuote || String(currentQuote) === "0") ? formatToIndianRupee(parseNumber(String(currentQuote))) : "-"}</p>
//                                                                 )}
//                                                             </div>
//                                                         </div>
//                                                     </TableCell>
//                                                 );
//                                             })}
//                                             {formData.selectedVendors.length === 0 && <TableCell />}
//                                             <TableCell className="align-middle text-right">
//                                                 <HistoricalQuotesHoverCard quotes={mappedContributingQuotes}>
//                                                     {targetRateValue === -1 ? "N/A" : formatToRoundedIndianRupee(targetRateValue)}
//                                                 </HistoricalQuotesHoverCard>
//                                             </TableCell>
//                                         </TableRow>
//                                     );
//                                 })}
//                             </TableBody>
//                         </Table>
//                     </div>
//                 );
//             })}
//         </div>
//     );
// }


// src/features/procurement/progress/SelectVendorQuotesTable.tsx
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
import { CheckCheck, CircleCheck, CircleMinus, MessageCircleMore } from "lucide-react";
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
                    <div key={cat.name} className="min-w-[700px]"> {/* Ensure min-width for horizontal scroll */}
                        <Table style={{ tableLayout: 'fixed' }}>
                          <colgroup>
                                <col style={{ width: '25%' }} /> {/* Item Details */}
                                <col style={{ width: '7%' }} />  {/* Qty */}
                                <col style={{ width: '7%' }} />  {/* UOM */}
                                {formData.selectedVendors.map(v => (
                                    <col key={`col-${v.value}`} style={{ width: '160px' }} /> // Fixed width for each vendor column
                                ))}
                                {formData.selectedVendors.length === 0 && (
                                    <col style={{ width: 'calc(46% - 140px)' }} /> // Placeholder width
                                )}
                                <col style={{ width: '15%' }} /> {/* Target Rate */}
                            </colgroup>
                            <TableHeader>
                                {index === 0 && (
                                    <TableRow className="bg-primary/5">
                                        <TableHead className="min-w-[220px] w-[25%] text-primary font-semibold">Item Details</TableHead>
                                        <TableHead className="min-w-[70px] w-[7%] text-primary font-semibold text-center">Qty</TableHead>
                                        <TableHead className="min-w-[70px] w-[7%] text-primary font-semibold text-center">UOM</TableHead>
                                        {formData.selectedVendors.map((v) => (
                                            <TableHead key={v.value} className="text-left w-[160px] text-primary text-xs font-medium">
                                                <div className="min-w-[150px] py-1 flex gap-1 items-center justify-center">
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
                                                            <AlertDialogContent> {/* ... Dialog Content ... */} 
                                                                <AlertDialogHeader><AlertDialogTitle>Remove Vendor: {v.label}?</AlertDialogTitle><AlertDialogDescription>This will remove the vendor and all their quotes from this RFQ.</AlertDialogDescription></AlertDialogHeader>
                                                                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><Button variant="destructive" onClick={() => handleInternalDeleteVendor(v.value)}>Confirm Remove</Button></AlertDialogFooter>
                                                            </AlertDialogContent>
                                                        </AlertDialog>
                                                    )}
                                                </div>
                                            </TableHead>
                                        ))}
                                        {formData.selectedVendors.length === 0 && <TableHead className="w-[calc(46%-140px)] text-center text-muted-foreground py-2 font-normal">No Vendors Selected</TableHead>}
                                        <TableHead className="min-w-[100px] w-[15%] text-primary font-semibold text-right">Target Rate</TableHead>
                                    </TableRow>
                                )}
                                <TableRow className="bg-red-50/80 hover:bg-red-50/40">
                                    <TableHead colSpan={3} className="text-muted-foreground font-medium py-1.5 px-3">{cat.name}</TableHead>
                                    {formData.selectedVendors.map(v => <TableHead key={`${cat.name}-${v.value}`} className="py-1.5"/>)}
                                    {formData.selectedVendors.length === 0 && <TableHead className="py-1.5"/>}
                                    <TableHead  className="py-1.5"/>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {itemsInCategory.map((item) => {
                                    const targetRateDetail = targetRatesData?.get(item.name);
                                    let targetRateValue: number = -1;
                                    if (targetRateDetail?.rate && targetRateDetail.rate !== "-1") {
                                        const parsedRate = parseNumber(targetRateDetail.rate);
                                        if (!isNaN(parsedRate)) targetRateValue = parsedRate * 0.98;
                                    }
                                    const mappedContributingQuotes = mapApiQuotesToApprovedQuotations(targetRateDetail?.selected_quotations_items || []);

                                    return (
                                        <TableRow key={item.name}>
                                            <TableCell className="py-2.5 align-top">
                                                <div className="font-medium">{item.item}</div>
                                                {item.comment && (
                                                    <div className="flex items-start gap-1 mt-1">
                                                        <MessageCircleMore className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                                                        <p className="text-xs text-muted-foreground italic">{item.comment}</p>
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="align-middle text-center">{item.quantity}</TableCell>
                                            <TableCell className="align-middle text-center">{item.unit}</TableCell>
                                            {formData.selectedVendors.map(vendor => {
                                                const itemVendorDetails = formData.details[item.name]?.vendorQuotes?.[vendor.value];
                                                const currentQuote = itemVendorDetails?.quote ?? "";
                                                const currentMake = itemVendorDetails?.make ?? formData.details[item.name]?.initialMake;
                                                const isSelectedForQuote = selectedVendorQuotes.get(item.name) === vendor.value;
                                                const canSelectThisQuote = (currentQuote || String(currentQuote) === "0") && !isReadOnly && mode !== 'edit';


                                                return (
                                                    <TableCell key={`${item.name}-${vendor.value}`} className="align-top p-1.5">
                                                        <div
                                                            role="radio"
                                                            aria-checked={isSelectedForQuote}
                                                            tabIndex={canSelectThisQuote ? 0 : -1}
                                                            onClick={() => canSelectThisQuote && onVendorSelectForItem(item.name, vendor.value)}
                                                            onKeyDown={(e) => canSelectThisQuote && (e.key === 'Enter' || e.key === ' ') && onVendorSelectForItem(item.name, vendor.value)}
                                                            className={`space-y-1.5 p-2 border rounded-md transition-all relative hover:shadow-sm
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
                                                                        vendor={vendor} // Pass VendorOption type
                                                                        item={item}
                                                                        formData={formData} // Pass RFQData
                                                                        // orderData={currentDocument} This was problematic, MakesSelection shouldn't need the whole doc
                                                                        setFormData={setFormData} // For direct updates from MakesSelection's internal logic
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
                                                                    <p className={`text-sm font-semibold ${targetRateValue !== -1 && parseNumber(String(currentQuote)) < targetRateValue ? "text-green-600" : ""}`}>{ (currentQuote || String(currentQuote) === "0") ? formatToIndianRupee(parseNumber(String(currentQuote))) : "-"}</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                );
                                            })}
                                            {formData.selectedVendors.length === 0 && <TableCell />}
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