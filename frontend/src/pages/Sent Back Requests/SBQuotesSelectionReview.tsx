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

    if(!sbId) return <div>No Sent Back ID Provided</div>
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


    const { data: vendor_list, isLoading: vendor_list_loading } = useVendorsList({vendorTypes: ["Material", "Material & Service"]})

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

    interface VendorWiseApprovalItems {
        [vendor: string]: { // vendor here is vendor_id (DocName)
          items: DisplayItem[]; // Use DisplayItem or add properties to ProcurementRequestItemDetail
          total: number;
        };
      }

    const generateActionSummary = useCallback(() => {
        let vendorWiseApprovalItems: VendorWiseApprovalItems = {};
        let approvalOverallTotal: number = 0;

        orderData?.order_list.forEach((item) => {
            const vendor = item?.vendor || "";
            // Approval items segregated by vendor
            const targetRate = getItemEstimate(item?.item_id)?.averageRate
            const lowestItemPrice = targetRate ? targetRate * 0.98 : getLowest(item?.item_id)
            const itemTotal = parseNumber(item.quantity * parseNumber(item.quote));
            if (!vendorWiseApprovalItems[vendor]) {
                vendorWiseApprovalItems[vendor] = {
                    items: [],
                    total: 0,
                };
            }
            if (lowestItemPrice && lowestItemPrice !== parseNumber(item.quote) && lowestItemPrice < parseNumber(item?.quote)) {
                vendorWiseApprovalItems[vendor].items.push({ ...item, potentialLoss: itemTotal - (parseNumber(item.quantity) * lowestItemPrice) });
            } else {
                vendorWiseApprovalItems[vendor].items.push(item);
            }
            vendorWiseApprovalItems[vendor].total += itemTotal;
            approvalOverallTotal += itemTotal;
        });

        return {
            vendorWiseApprovalItems,
            approvalOverallTotal,
        };
    }, [orderData]);

    const {
        vendorWiseApprovalItems,
        approvalOverallTotal,
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
                                    {Object.entries(vendorWiseApprovalItems).map(([vendor, { items, total }]) => (
                                        <div key={vendor}> {/* Use div instead of li for dl structure */}
                                            <dt className="text-sm font-medium text-gray-700">
                                                Vendor: <span className="font-semibold text-gray-900">{getVendorName(vendor)}</span>
                                            </dt>
                                            <dd className="mt-1 pl-5"> {/* Indent item details */}
                                                <ul className="list-disc space-y-1 text-gray-800"> {/* Changed text color, list style */}
                                                    {items.map((item) => (
                                                        <li key={item.name} className="text-sm"> {/* Standardized text size */}
                                                            {item.item_name}
                                                            {/* --- Make Name Added Here --- */}
                                                            {item.make && (
                                                                <span className="text-gray-500 italic ml-1">({item.make})</span>
                                                            )}
                                                            {/* --- End Make Name --- */}
                                                            <span className="mx-1">-</span> {/* Added separator for clarity */}
                                                            {item.quantity} {item.unit}
                                                            <span className="mx-1">-</span> {/* Added separator */}
                                                            <span className="font-medium">{formatToIndianRupee(item.quantity * (item.quote || 0))}</span>
                                                            {item?.potentialLoss && (
                                                                <span className="block text-xs text-red-600 mt-0.5"> {/* Changed display and color slightly */}
                                                                    Potential Loss: {formatToIndianRupee(item.potentialLoss)}
                                                                </span>
                                                            )}
                                                        </li>
                                                    ))}
                                                </ul>
                                                <p className="mt-2 text-sm text-right font-medium text-gray-800"> {/* Aligned right */}
                                                    Subtotal for {getVendorName(vendor)}: <span className="font-semibold">{formatToIndianRupee(total)}</span>
                                                </p>
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                                <div className="mt-4 pt-4 border-t border-green-200 text-right"> {/* Added separator line */}
                                    <p className="text-sm font-medium text-gray-800">
                                        Approval Overall Total: <span className="text-base font-semibold text-green-700">{formatToRoundedIndianRupee(approvalOverallTotal)}</span> {/* Made total stand out */}
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