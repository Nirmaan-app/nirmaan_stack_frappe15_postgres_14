import { ProcurementHeaderCard } from "@/components/helpers/ProcurementHeaderCard";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useItemEstimate } from "@/hooks/useItemEstimate";
import { useUserData } from '@/hooks/useUserData';
import { ProcurementRequestItemDetail } from "@/types/NirmaanStack/ProcurementRequests";
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory";
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import getLowestQuoteFilled from "@/utils/getLowestQuoteFilled";
import { parseNumber } from "@/utils/parseNumber";
import TextArea from 'antd/es/input/TextArea';
import { useFrappeCreateDoc, useFrappeDocumentEventListener, useFrappeUpdateDoc, useSWRConfig } from "frappe-react-sdk";
import memoize from 'lodash/memoize';
import { ArrowBigUpDash, CheckCheck, ListChecks, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams } from "react-router-dom";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { useSentBackCategory } from "@/hooks/useSentBackCategory";
import { useVendorsList } from "../ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";

interface DisplayItem extends ProcurementRequestItemDetail {
    amount?: number; // Calculated amount based on quote
    vendor_name?: string; // Added by getVendorName
    lowestQuotedAmount?: number; // From getLowest
    threeMonthsLowestAmount?: number; // From getItemEstimate (if used)
    potentialLoss?: number;
}

export const SBQuotesSelectionReview: React.FC = () => {

    const { sbId } = useParams<{ sbId: string }>();

    if (!sbId) return <div>No Sent Back ID Provided</div>
    const navigate = useNavigate();
    const [comment, setComment] = useState<string>("")
    const userData = useUserData()

    const { updateDoc: updateDoc, loading: update_loading } = useFrappeUpdateDoc()
    const { createDoc: createDoc, loading: create_loading } = useFrappeCreateDoc()

    const { mutate } = useSWRConfig()

    const { getItemEstimate } = useItemEstimate()

    const [orderData, setOrderData] = useState<SentBackCategory | undefined>();

    const { data: sent_back, isLoading: sent_back_loading, mutate: sent_back_mutate } = useSentBackCategory(sbId)

    useFrappeDocumentEventListener("Sent Back Category", sbId, (event) => {
        console.log("Sent Back document updated (real-time):", event);
        toast({
            title: "Document Updated",
            description: `Sent Back ${event.name} has been modified.`,
        });
        sent_back_mutate(); // Re-fetch this specific document
    },
        true // emitOpenCloseEventsOnMount (default)
    )


    const { data: vendor_list, isLoading: vendor_list_loading } = useVendorsList({ vendorTypes: ["Material", "Material & Service"] })

    useEffect(() => {
        if (sent_back) {
            setOrderData(sent_back)
        }
    }, [sent_back])

    // const getCategoryTotals = useMemo(() => {
    //   const totals : {[category: string]: number} = {}

    // if(!orderData?.item_list?.list?.length) return totals
    //   orderData?.item_list?.list?.forEach(item => {
    //     const category = item.category
    //     const quote = item.quote || 0
    //     const quantity = item.quantity
    //     if(!totals[category]) {
    //       totals[category] = 0
    //     }
    //     totals[category] += quote * quantity
    //   })

    //   return totals
    // }, [orderData])

    // const getVendorName = (vendorId : string) => 
    //   useMemo(() => (vendor_list || [])?.find(v => v?.name === vendorId)?.vendor_name
    //   , [vendorId, vendor_list])

    const getVendorName = useMemo(() => (vendorId: string | undefined) => {
        return vendor_list?.find(vendor => vendor?.name === vendorId)?.vendor_name || "";
    }, [vendor_list]);

    const getLowest = useMemo(() => memoize((itemId: string) => {
        return getLowestQuoteFilled(orderData, itemId)
    }, (itemId: string) => itemId), [orderData]);

    // const getFinalVendorQuotesData = useMemo(() => {
    //   const data : CategoryWithChildren[] = []
    //   if(orderData?.item_list.list?.length) {
    //     const procurementList = orderData.item_list.list
    //     procurementList.forEach(item => {
    //       const category : string = item.category
    //       const existingCategory = data?.find(entry => entry[category])
    //       if(existingCategory) {
    //         existingCategory[category]?.items.push({
    //           ...item,
    //           vendor_name : item?.vendor ? getVendorName(item?.vendor) : undefined,
    //           amount: (item.quote || 0) * item.quantity,
    //           threeMonthsLowestAmount: (getItemEstimate(item.name) * 0.98) * item.quantity,
    //           lowestQuotedAmount: getLowest(item.name) * item.quantity,
    //         })
    //       } else {
    //         data.push({
    //           [category]: {
    //             totalAmount: getCategoryTotals[category],
    //             key: uuidv4(),
    //             items: [{
    //               ...item,
    //               vendor_name : item?.vendor ? getVendorName(item?.vendor) : undefined,
    //               amount: (item.quote || 0) * item.quantity,
    //               threeMonthsLowestAmount: (getItemEstimate(item.name) * 0.98) * item.quantity,
    //               lowestQuotedAmount: getLowest(item.name) * item.quantity,
    //             }]
    //           }
    //         })
    //       }
    //     })
    //   }
    //   return data
    // }, [orderData, vendor_list])


    const handleSubmit = async () => {
        try {
            await updateDoc('Sent Back Category', sbId, {
                workflow_state: "Vendor Selected"
            });

            if (comment) {
                await createDoc("Nirmaan Comments", {
                    comment_type: "Comment",
                    reference_doctype: "Sent Back Category",
                    reference_name: sbId,
                    comment_by: userData?.user_id,
                    content: comment,
                    subject: "sb vendors selected",
                });
            }

            toast({
                title: "Success!",
                description: `Sent Back: ${sbId} sent for Approval!`,
                variant: "success",
            });

            await mutate(`${orderData?.type} Sent Back Category`)

            navigate(`/procurement-requests?tab=${orderData?.type}`)
        } catch (error) {
            toast({
                title: "Failed!",
                description: `Failed to send Sent Back: ${sbId} for Approval.`,
                variant: "destructive",
            });
            console.log("submit_error", error);
        }
    };

   // Interface for the vendor-wise summary object
   interface VendorWiseApprovalItems {
       [vendor: string]: { // vendor here is vendor_id (DocName)
         items: DisplayItem[];
         total: number; // Total EXCLUDING GST
         totalInclGst: number; // Total INCLUDING GST
       };
   }
   

     const generateActionSummary = useCallback(() => {
       let allDelayedItems: DisplayItem[] = [];
       let vendorWiseApprovalItems: VendorWiseApprovalItems = {};
       
       let approvalOverallTotalExclGst: number = 0;
       let approvalOverallTotalInclGst: number = 0;
       let delayedItemsTotalExclGst: number = 0;
       let delayedItemsTotalInclGst: number = 0;
   
       orderData?.order_list.forEach((item: ProcurementRequestItemDetail) => {
           const vendor = item?.vendor;
           const quote = parseNumber(item.quote);
           const quantity = parseNumber(item.quantity);
           const taxRate = parseNumber(item.tax) / 100; // e.g., 18 -> 0.18
   
           const baseItemTotal = quantity * quote;
           const itemTotalInclGst = baseItemTotal * (1 + taxRate);
           
           if (!vendor || !quote) {
               allDelayedItems.push(item);
               delayedItemsTotalExclGst += baseItemTotal;
               delayedItemsTotalInclGst += itemTotalInclGst;
           } else {
               const targetRate = getItemEstimate(item?.item_id)?.averageRate;
               const lowestItemPrice = targetRate ? targetRate * 0.98 : getLowest(item?.item_id);
               
               if (!vendorWiseApprovalItems[vendor]) {
                   vendorWiseApprovalItems[vendor] = {
                       items: [],
                       total: 0,
                       totalInclGst: 0,
                   };
               }
               
               const displayItem: DisplayItem = { ...item, amount: itemTotalInclGst };
   
               if (lowestItemPrice && lowestItemPrice < quote) {
                   displayItem.potentialLoss = baseItemTotal - (quantity * lowestItemPrice);
               }
               
               vendorWiseApprovalItems[vendor].items.push(displayItem);
               vendorWiseApprovalItems[vendor].total += baseItemTotal;
               vendorWiseApprovalItems[vendor].totalInclGst += itemTotalInclGst;
               
               approvalOverallTotalExclGst += baseItemTotal;
               approvalOverallTotalInclGst += itemTotalInclGst;
           }
       });
   
       return {
           allDelayedItems,
           vendorWiseApprovalItems,
           approvalOverallTotal: approvalOverallTotalExclGst,
           approvalOverallTotalInclGst,
           delayedItemsTotalInclGst,
       };
   }, [orderData, getLowest, getItemEstimate]);
   
   const {
       vendorWiseApprovalItems,
       approvalOverallTotal,
       approvalOverallTotalInclGst,
     } = useMemo(() => generateActionSummary(), [generateActionSummary]);
   

    if (sent_back_loading || vendor_list_loading) return <LoadingFallback />
    return (
        <>
            {orderData &&
                <div className="flex-1 space-y-4">
                    <div className="flex items-center">
                        <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Comparison</h2>
                    </div>
                    <ProcurementHeaderCard orderData={orderData} sentBack />
                    <div className="flex flex-col gap-4">
                        {/* Approval Items Summary */}
                        {Object.keys(vendorWiseApprovalItems).length > 0 && (
                            <div className="p-6 rounded-lg bg-green-50 border border-green-200"> {/* Changed background, removed opacity, added border */}
                                <div className="flex items-center mb-2">
                                    <ListChecks className="h-5 w-5 mr-2 text-green-600" />
                                    <h3 className="text-lg font-semibold text-gray-800">Items for Approval</h3> {/* Slightly bolder heading */}
                                </div>
                                <p className="text-sm text-gray-600 mb-4"> {/* Adjusted text color and margin */}
                                    These items have been assigned to vendors and require project lead approval.
                                </p>
                                {/* Using a definition list style for vendors for better structure */}
                                <dl className="space-y-4">
                                    {Object.entries(vendorWiseApprovalItems).map(([vendor, { items, total, totalInclGst }]) => (
                                                       <div key={vendor}>
                                                           <dt className="text-sm border-b border-grey-200 font-medium text-red-500">
                                                               Vendor: <span className="font-semibold text-red-600">{getVendorName(vendor)}</span>
                                                           </dt>
                                                           <dd className="mt-1 pl-5">
                                                               <ul className="list-disc space-y-1 text-gray-800">
                                                                   {items.map((item) => (
                                                                       <li key={item.item_id} className="text-sm">
                                                                           {item.item_name}
                                                                           {item.make && (
                                                                               <span className="text-gray-500 italic ml-1">({item.make})</span>
                                                                           )}
                                                                           <span className="mx-1">-</span>
                                                                           {item.quantity} x {formatToIndianRupee(item.quote)}
                                                                           <span className="mx-1 text-gray-500">+</span>
                                                                           {item.tax}% GST
                                                                           <span className="mx-1">=</span>
                                                                           <span className="font-medium">{formatToIndianRupee(item.amount)}</span>
                                                                           {item?.potentialLoss && (
                                                                               <span className="block text-xs text-red-600 mt-0.5">
                                                                                   Potential Loss: {formatToIndianRupee(item.potentialLoss)}
                                                                               </span>
                                                                           )}
                                                                       </li>
                                                                   ))}
                                                               </ul>
                                                               <div className="mt-2 text-right text-sm font-medium text-gray-800">
                                                                   <p>Subtotal: <span className="font-semibold">{formatToIndianRupee(total)}</span></p>
                                                                   <p>Subtotal (inc. GST): <span className="font-semibold text-green-700">{formatToIndianRupee(totalInclGst)}</span></p>
                                                               </div>
                                                           </dd>
                                                       </div>
                                                   ))}
                                </dl>
                                <div className="mt-4 pt-4 border-t border-green-200 text-right">
                                              <p className="text-sm font-medium text-gray-800">
                                                  Approval Grand Total: <span className="font-semibold">{formatToRoundedIndianRupee(approvalOverallTotal)}</span>
                                              </p>
                                              <p className="text-sm font-medium text-gray-800">
                                                  Approval Grand Total (inc. GST): <span className="text-base font-semibold text-green-700">{formatToRoundedIndianRupee(approvalOverallTotalInclGst)}</span>
                                              </p>
                                          </div>
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col justify-end items-end mr-2 my-4">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button className="flex items-center gap-1">
                                    <ArrowBigUpDash className="" />
                                    Send for Approval
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px]">
                                <DialogHeader>
                                    <DialogTitle>Have you cross-checked your selections?</DialogTitle>
                                    <DialogDescription>

                                        {Object.keys(vendorWiseApprovalItems).length !== 0 && (
                                            <div className='flex flex-col gap-2 mt-2 text-start'>
                                                <h4 className='font-bold'>Any remarks for the Project Lead?</h4>
                                                <TextArea className='border-green-400 focus:border-green-800 bg-green-200' placeholder='type here...' value={comment} onChange={(e) => setComment(e.target.value)} />
                                            </div>
                                        )}
                                    </DialogDescription>
                                </DialogHeader>
                                <DialogDescription className='flex items-center justify-center gap-2'>
                                    {(create_loading || update_loading) ? <TailSpin width={60} color={"red"} /> : (
                                        <>
                                            <DialogClose><Button variant="secondary" className="flex items-center gap-1">
                                                <Undo2 className="h-4 w-4" />
                                                Cancel</Button></DialogClose>
                                            <Button variant="default"
                                                onClick={handleSubmit}
                                                className="flex items-center gap-1">
                                                <CheckCheck className="h-4 w-4" />
                                                Confirm</Button>
                                        </>
                                    )}
                                </DialogDescription>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>
            }
        </>
    )
}

export default SBQuotesSelectionReview;