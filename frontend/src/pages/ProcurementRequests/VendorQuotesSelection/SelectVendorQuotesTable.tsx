import QuantityQuoteInput from "@/components/helpers/QtyandQuoteInput";
import { VendorHoverCard } from "@/components/helpers/vendor-hover-card";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
// import { useItemEstimate } from "@/hooks/useItemEstimate";
import { ProcurementItem, ProcurementRequest, RFQData } from "@/types/NirmaanStack/ProcurementRequests";
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory";
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { omit } from "lodash";
import { CheckCheck, CircleCheck, CircleMinus, MessageCircleMore } from "lucide-react";
import React, { useCallback } from "react";
import { MakesSelection } from "./components/ItemVendorMakeSelection";
import { parseNumber } from "@/utils/parseNumber";
// import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations";
import { HistoricalQuotesHoverCard } from "./components/HistoricalQuotesHoverCard";
// Import the necessary types and mapping function
import { TargetRateDetailFromAPI, ApiSelectedQuotation, ApprovedQuotations, mapApiQuotesToApprovedQuotations } from '../ApproveVendorQuotes/types'; // Adjust path if needed

type DocumentType = ProcurementRequest | SentBackCategory

interface SelectVendorQuotesTableProps<T extends DocumentType> {
  sentBack?: boolean;
  orderData: T;
  formData: RFQData;
  setFormData: React.Dispatch<React.SetStateAction<RFQData>>
  selectedVendorQuotes: Map<any, any>
  setSelectedVendorQuotes: React.Dispatch<React.SetStateAction<Map<any, any>>>
  mode: string
  setOrderData: React.Dispatch<React.SetStateAction<T | null>>
  // --- ADDED PROP for Target Rate Data ---
  targetRatesData?: Map<string, TargetRateDetailFromAPI>; // Pass the map from the parent
}

export function SelectVendorQuotesTable<T extends DocumentType>({ sentBack = false, orderData, setOrderData, formData, setFormData, selectedVendorQuotes, setSelectedVendorQuotes, mode, targetRatesData }: SelectVendorQuotesTableProps<T>) {

  // const { getItemEstimate } = useItemEstimate()

  const handleQuoteChange = useCallback((
    itemId: string,
    vendorId: string,
    quote: string | number | undefined,
  ) => {
    setFormData((prev) => ({
      ...prev,
      details: {
        ...prev.details,
        [itemId]: {
          ...prev.details[itemId],
          vendorQuotes: {
            ...prev.details[itemId].vendorQuotes,
            [vendorId]: { ...(prev.details[itemId].vendorQuotes[vendorId] || {}), quote: quote },
          },
        },
      },
    }))

    const isValidQuote = quote && parseNumber(quote) > 0;
    if (!isValidQuote) {
      setSelectedVendorQuotes(prev => {
        const updated = new Map(prev);
        if (updated.get(itemId) === vendorId) {
          updated.delete(itemId);
        }
        return updated;
      });
    }
  }, [setFormData, setSelectedVendorQuotes]);

  // Define type guards (if not already defined elsewhere)
  function isProcurementRequest(doc: DocumentType): doc is ProcurementRequest {
    return 'procurement_list' in doc;
  }

  function isSentBackCategory(doc: DocumentType): doc is SentBackCategory {
    return 'item_list' in doc;
  }

  const removeVendor = useCallback((vendorId: string) => {
    setFormData((prev) => {
      const updatedSelectedVendors = prev.selectedVendors.filter(
        (v) => v?.value !== vendorId
      );

      const updatedDetails = Object.keys(prev.details).reduce(
        (acc, itemId) => {
          const itemDetails = prev.details[itemId];
          const updatedVendorQuotes = { ...itemDetails.vendorQuotes };
          delete updatedVendorQuotes[vendorId];

          acc[itemId] = {
            ...itemDetails,
            vendorQuotes: updatedVendorQuotes,
          };
          return acc;
        },
        {} as typeof prev.details
      );

      return {
        ...prev,
        selectedVendors: updatedSelectedVendors,
        details: updatedDetails,
      };
    });

    setSelectedVendorQuotes(prev => {
      const updatedQuotes = new Map(prev)

      for (const [itemId, vendor] of updatedQuotes) {
        if (vendor === vendorId) updatedQuotes.delete(itemId)
      }
      return updatedQuotes
    })

    // if(sentBack) {
    //   setOrderData((prev) => ({
    //     ...prev,
    //     item_list: {
    //       list: prev?.item_list.list.map((item) => 
    //       item?.vendor === vendorId ? omit(item, ["vendor", "quote", "make"]) : item
    //       )
    //     }
    //   }))
    // } else {
    //   setOrderData((prev) => ({
    //       ...prev,
    //       procurement_list: {
    //         list: prev.procurement_list.list.map((item) => 
    //         item?.vendor === vendorId ? omit(item, ["vendor", "quote", "make"]) : item
    //         )
    //       }
    //     }))
    // }

    // In removeVendor
    setOrderData((prevOrderData) => {
      if (!prevOrderData) return null;

      if (sentBack && isSentBackCategory(prevOrderData)) {
        return {
          ...prevOrderData, // Now prevOrderData is correctly typed as SentBackCategory
          item_list: {
            ...(prevOrderData.item_list || { list: [] }),
            list: (prevOrderData.item_list?.list || []).map((item: any) =>
              item?.vendor === vendorId ? omit(item, ["vendor", "quote", "make"]) : item
            )
          }
        }; // No 'as T' needed here, TypeScript infers it
      } else if (!sentBack && isProcurementRequest(prevOrderData)) {
        return {
          ...prevOrderData, // Now prevOrderData is correctly typed as ProcurementRequest
          procurement_list: {
            ...(prevOrderData.procurement_list || { list: [] }),
            list: (prevOrderData.procurement_list?.list || []).map((item: any) =>
              item?.vendor === vendorId ? omit(item, ["vendor", "quote", "make"]) : item
            )
          }
        }; // No 'as T' needed here
      }
      // Fallback or error if type doesn't match expectation, though this shouldn't happen with your logic
      console.warn("Type mismatch in setOrderData for removeVendor");
      return prevOrderData; // Or null, or throw error
    });
  }, [setOrderData, setSelectedVendorQuotes, setFormData]);



  return (
    <div className="overflow-x-auto space-y-4 rounded-md border shadow-sm p-4">
      {/* Check if category_list exists and is an array */}
      {Array.isArray(orderData?.category_list?.list) && orderData.category_list.list.map((cat: any, index: number) => {
        return <div key={cat.name} className="min-w-[400px]">
          <Table>
            <TableHeader>
              {index === 0 && (
                <TableRow className="bg-red-100">
                  <TableHead className="min-w-[200px] w-[30%] text-red-700 font-bold">
                    Item Details
                  </TableHead>
                  <TableHead className="min-w-[80px] w-[10%] text-red-700 font-bold">QTY</TableHead>
                  <TableHead className="min-w-[80px] w-[10%] text-red-700 font-bold">UOM</TableHead>
                  {formData?.selectedVendors?.length === 0 ? (
                    <TableHead className="min-w-[300px] w-[40%] text-red-700">
                      <p className="border text-center border-gray-400 rounded-md py-1 font-medium">No Vendors Selected</p>
                    </TableHead>
                  ) : (
                    formData?.selectedVendors?.map((v, _) => <TableHead key={v?.value} className={`text-center w-[15%] text-red-700 text-xs font-medium`}>
                      <p className="min-w-[150px] max-w-[150px] border border-gray-400 rounded-md py-1 flex gap-1 items-center justify-center">
                        <div className="truncate text-left">
                          <VendorHoverCard vendor_id={v?.value} />
                        </div>
                        {mode === "edit" && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <CircleMinus className="w-4 h-4 cursor-pointer" />
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                <AlertDialogDescription>Click on confirm to remove this vendor?</AlertDialogDescription>
                                <div className="flex items-end justify-end gap-2">
                                  <AlertDialogCancel asChild>
                                    <Button variant="outline" className="border-primary text-primary">Cancel</Button>
                                  </AlertDialogCancel>
                                  <Button onClick={() => removeVendor(v?.value || "")} className="flex items-center gap-1">
                                    <CheckCheck className="h-4 w-4" />
                                    Confirm
                                  </Button>
                                </div>
                              </AlertDialogHeader>

                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </p>
                    </TableHead>)
                  )}
                  <TableHead className="min-w-[80px] w-[10%] text-red-700 font-bold">Target Rate</TableHead>
                </TableRow>
              )}
              <TableRow className="bg-red-50">
                <TableHead className="min-w-[200px] w-[30%] text-red-700">
                  {cat.name}
                </TableHead>
                <TableHead className="min-w-[80px] w-[10%]" />
                <TableHead className="min-w-[80px] w-[10%]" />
                {formData?.selectedVendors?.length === 0 ? (
                  <TableHead className="min-w-[300px] w-[40%]" />
                ) : (
                  formData?.selectedVendors?.map((v) => <TableHead key={v?.value} className={`min-w-[150px] w-[15%] max-w-[150px]`} />) // Added key
                )}
                <TableHead className="min-w-[80px] w-[10%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Check if procurement_list exists and is an array */}
              {Array.isArray((sentBack ? (orderData as SentBackCategory)?.item_list : (orderData as ProcurementRequest)?.procurement_list)?.list) &&
                (sentBack ? (orderData as SentBackCategory)?.item_list : (orderData as ProcurementRequest)?.procurement_list)?.list.map((item: ProcurementItem) => { // Added type
                  if (item.category === cat.name) {
                    // const targetQuote: number = (getItemEstimate(item.name)?.averageRate ?? 0) * 0.98
                    // const contributingQuotes = getItemEstimate(item.name)?.contributingQuotes
                    // const estimate = getItemEstimate(item.name); // Call your function to get data
                    // const targetQuoteValue: number = estimate ? estimate.averageRate * 0.98 : 0; // Calculate target
                    // const contributingQuotes: ApprovedQuotations[] | null = estimate ? estimate.contributingQuotes : null;
                    // --- Get Target Rate Info from Prop ---
                    const targetRateDetail = targetRatesData?.get(item.name); // Use the passed map
                    let targetRateValue: number = -1;
                    let contributingQuotes: ApiSelectedQuotation[] = [];
                    if (targetRateDetail && targetRateDetail.rate) {
                      const parsedRate = parseFloat(targetRateDetail.rate);
                      if (!isNaN(parsedRate)) targetRateValue = parsedRate;
                    }
                    if (targetRateDetail?.selected_quotations_items) {
                      contributingQuotes = targetRateDetail.selected_quotations_items;
                    }
                    // Map quotes for hover card
                    const mappedQuotes = mapApiQuotesToApprovedQuotations(contributingQuotes);
                    // --- End Target Rate Info ---

                    return (
                      <TableRow key={`${cat.name}-${item.name}`}>
                        <TableCell className="py-8">
                          <div className="inline items-baseline">
                            <span>{item.item}</span>
                            {item.comment && (
                              <HoverCard>
                                <HoverCardTrigger><MessageCircleMore className="text-blue-400 w-6 h-6 inline-block ml-1" /></HoverCardTrigger>
                                <HoverCardContent className="max-w-[300px] bg-gray-800 text-white p-2 rounded-md shadow-lg">
                                  <div className="relative pb-4">
                                    <span className="block">{item.comment}</span>
                                    <span className="text-xs absolute right-0 italic text-gray-200">-Comment by PL</span>
                                  </div>

                                </HoverCardContent>
                              </HoverCard>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell>{item.quantity}</TableCell>
                        {/* Map through selected vendors */}
                        {Array.isArray(formData?.selectedVendors) && formData.selectedVendors.map(v => {
                          const vendorQuotes = formData?.details?.[item.name]?.vendorQuotes
                          const defaultMake = formData?.details?.[item.name]?.initialMake
                          // let lowestQuote = Number.POSITIVE_INFINITY; // Initialize with the highest possible value
                          // let lowestVendorId: string | null = null; // Initialize winner vendor ID as null

                          // // 3. Iterate through each [vendorId, quoteData] pair in vendorQuotes
                          // for (const [vendorId, quoteData] of Object.entries(vendorQuotes)) {
                          //   const q = parseNumber(quoteData?.quote)
                          //   if (q < lowestQuote) {
                          //     lowestQuote = parseNumber(q)
                          //     lowestVendorId = vendorId
                          //   }
                          // }
                          const data = vendorQuotes?.[v?.value]
                          const quote = parseNumber(data?.quote)
                          const make = data?.make
                          const isSelected = mode === "view" && selectedVendorQuotes?.get(item?.name) === v?.value;
                          return (
                            <TableCell key={`${item.name}-${v?.value}`}> {/* Added key */}
                              <div aria-disabled={mode === "edit" || !quote} aria-checked={isSelected}
                                onClick={() => {
                                  if (mode === "edit") {
                                    return
                                  }
                                  if (isSelected) {
                                    const updatedQuotes = new Map(selectedVendorQuotes);
                                    updatedQuotes.delete(item.name);
                                    setSelectedVendorQuotes(updatedQuotes);
                                  } else {
                                    setSelectedVendorQuotes(new Map(selectedVendorQuotes.set(item.name, v?.value)));
                                  }
                                }}
                                role="radio"
                                tabIndex={0}
                                className={`min-w-[150px] max-w-[150px] space-y-3 p-3 border border-gray-300 rounded-md shadow-md transition-all 
                                    ring-offset-2 ring-gray-300 focus:ring-2 focus:ring-primary hover:shadow-lg ${mode === "view" && !quote ? "pointer-events-none opacity-50" : ""} ${isSelected ? "bg-red-100 ring-2 ring-primary" : "bg-white"} relative`}>
                                <CircleCheck className={`absolute w-5 h-5 right-2 text-red-600 ${isSelected ? "" : 'hidden'}`} />
                                <div className="flex flex-col gap-1">
                                  <Label className="text-xs font-semibold text-primary">Make</Label>
                                  {mode === "edit" ? (
                                    <MakesSelection defaultMake={defaultMake} vendor={v} item={item} formData={formData} orderData={orderData} setFormData={setFormData} />
                                  ) : (
                                    <p className={`text-sm font-medium text-gray-700 ${targetRateValue !== -1 && quote < targetRateValue ? "text-green-600" : ""}`}>{make || defaultMake || "--"}</p> // Apply green if lower than target
                                  )}
                                </div>
                                <div className="flex flex-col gap-1">
                                  <Label className="text-xs font-semibold text-primary">Rate</Label>
                                  {mode === "edit" ? (
                                    // <Input
                                    //     className="h-8"
                                    //     value={quote || ""}
                                    //     onChange={(e) => {
                                    //         const value = e.target.value;
                                    //         if (/^\d*\.?\d*$/.test(value) || value === "") {
                                    //             handleQuoteChange(item.name, v?.value || "", value);
                                    //         }
                                    //     }}
                                    // />
                                    <QuantityQuoteInput value={quote || ""} onChange={(value) => handleQuoteChange(item.name, v?.value || "", value)} />
                                  ) : (
                                    <p className={`text-sm font-medium text-gray-700 ${targetRateValue !== -1 && quote < targetRateValue ? "text-green-600" : ""}`}>{quote ? formatToIndianRupee(quote) : "--"}</p> // Apply green if lower than target
                                  )}
                                </div>
                              </div>
                            </TableCell>
                          )
                        })}
                        {/* Handle case where no vendors are selected */}
                        {(!formData?.selectedVendors || formData.selectedVendors.length === 0) && <TableCell />}
                        {/* --- Target Rate Cell --- */}
                        <TableCell>
                          <HistoricalQuotesHoverCard quotes={mappedQuotes}>
                            {targetRateValue === -1 ? "N/A" : formatToRoundedIndianRupee(targetRateValue * 0.98)}
                          </HistoricalQuotesHoverCard>
                        </TableCell>
                      </TableRow>
                    )
                  }
                  return null;
                })}
            </TableBody>
          </Table>
        </div>
      })}
    </div>
  )
}