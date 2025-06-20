import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";
import { useItemEstimate } from "@/hooks/useItemEstimate";
import { ProcurementRequest, ProcurementRequestItemDetail } from "@/types/NirmaanStack/ProcurementRequests";
import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
import getLowestQuoteFilled from "@/utils/getLowestQuoteFilled";
import { parseNumber } from "@/utils/parseNumber";
import TextArea from 'antd/es/input/TextArea';
import { useFrappeDocumentEventListener, useFrappePostCall } from "frappe-react-sdk";
import memoize from 'lodash/memoize';
import { ArrowBigUpDash, CheckCheck, ListChecks, SendToBack, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams } from "react-router-dom";
import { ProcurementHeaderCard } from "../../../components/helpers/ProcurementHeaderCard";
import { Button } from "../../../components/ui/button";
import { toast } from "../../../components/ui/use-toast";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { useVendorsList } from "./hooks/useVendorsList";
import { useUsersList } from "../ApproveNewPR/hooks/useUsersList";
import { useProcurementRequest } from "@/hooks/useProcurementRequest";

// Interface for items with calculated properties for display
interface DisplayItem extends ProcurementRequestItemDetail {
  amount?: number; // Calculated amount including GST
  vendor_name?: string;
  lowestQuotedAmount?: number;
  threeMonthsLowestAmount?: number;
  potentialLoss?: number;
}

// Interface for the vendor-wise summary object
interface VendorWiseApprovalItems {
    [vendor: string]: { // vendor here is vendor_id (DocName)
      items: DisplayItem[];
      total: number; // Total EXCLUDING GST
      totalInclGst: number; // Total INCLUDING GST
    };
}

export const VendorsSelectionSummary : React.FC = () => {

  const { prId } = useParams<{ prId: string }>();

  if (!prId) {
    return <div className="flex items-center justify-center h-[90vh]">Error: PR ID is missing.</div>;
  }
  const navigate = useNavigate();
  const [comment, setComment] = useState<{approving: string, delaying: string}>({ approving: "", delaying: "" })

  const {call : sendForApprCall, loading : sendForApprCallLoading} = useFrappePostCall("nirmaan_stack.api.send_vendor_quotes.handle_delayed_items")

  const [orderData, setOrderData] = useState<ProcurementRequest | null>(null);

  const {getItemEstimate} = useItemEstimate()

  const { data: procurement_request, isLoading: procurement_request_loading, mutate: pr_mutate } = useProcurementRequest(prId);

  useFrappeDocumentEventListener("Procurement Requests", prId, (event) => {
      console.log("Procurement Request document updated (real-time):", event);
      toast({
          title: "Document Updated",
          description: `Procurement Request ${event.name} has been modified.`,
      });
      pr_mutate(); // Re-fetch this specific document
    },
    true
    )

  const {data: usersList, isLoading: usersListLoading} = useUsersList()

  const {allVendors: vendor_list, isLoading: vendor_list_loading} = useVendorsList({vendorTypes: ["Material", "Material & Service"]})
      
  const getFullName = useMemo(() => (id : string | undefined) => {
    return usersList?.find((user) => user?.name == id)?.full_name || ""
  }, [usersList]);

  useEffect(() => {
    if (procurement_request) {
      const items = procurement_request.order_list && Array.isArray(procurement_request.order_list) ? procurement_request.order_list : [];
      setOrderData({ ...procurement_request, order_list: items });
    } 
  }, [procurement_request]);

  const getVendorName = useMemo(() => (vendorId : string | undefined) : string => {
    return vendor_list?.find(v => v?.name === vendorId)?.vendor_name || ""
  }, [vendor_list])

  const getLowest = useMemo(() => memoize((itemId: string): number => {
        return getLowestQuoteFilled(orderData, itemId); 
    }, (itemId: string) => `${itemId}-${JSON.stringify(orderData?.order_list?.find(i => i.item_id === itemId)?.quote)}`),
  [orderData]);

  const handleSubmit = async () => {
    try {
        const response = await sendForApprCall({
            pr_id: orderData?.name,
            comments: comment
        });
  
        if (response.message.status === 200) {
            toast({
                title: "Success!",
                description: response.message.message,
                variant: "success",
            });
  
            await pr_mutate();

            navigate(`/procurement-requests?tab=New PR Request`);
           
        } else if (response.message.status === 400) {
            toast({
                title: "Failed!",
                description: response.message.error,
                variant: "destructive",
            });
        }
    } catch (error) {
        console.error("Error approving vendor:", error);
        toast({
            title: "Failed!",
            description: "Error while Sending vendor quotes for approval!",
            variant: "destructive",
        });
    }
  };

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
    allDelayedItems,
    vendorWiseApprovalItems,
    approvalOverallTotal,
    approvalOverallTotalInclGst,
    delayedItemsTotalInclGst,
  } = useMemo(() => generateActionSummary(), [generateActionSummary]);

if (procurement_request_loading || vendor_list_loading || usersListLoading) return <LoadingFallback />

  if (orderData?.workflow_state !== "In Progress") {
    return (
      <div className="flex items-center justify-center h-[90vh]">
        <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">
            Heads Up!
          </h2>
          <p className="text-gray-600 text-lg">
            Hey there, the PR:{" "}
            <span className="font-medium text-gray-900">{orderData?.name}</span>{" "}
            is no longer available in the{" "}
            <span className="italic">In Progress</span> state. The current state is{" "}
            <span className="font-semibold text-blue-600">
              {orderData?.workflow_state}
            </span>{" "}
            And the last modification was done by <span className="font-medium text-gray-900">
              {orderData?.modified_by === "Administrator" ? orderData?.modified_by : getFullName(orderData?.modified_by)}
            </span>
            !
          </p>
          <button
            className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors duration-300"
            onClick={() => navigate("/procurement-requests")}
          >
            Go Back to PR List
          </button>
        </div>
      </div>
    );
  }
    
  return (
          <div className="flex-1 space-y-4">
              <div className="space-y-2">
                  <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Comparison</h2>
                  <ProcurementHeaderCard orderData={orderData} />
              </div>

<div className="flex flex-col gap-4">
    {/* Approval Items Summary */}
    {Object.keys(vendorWiseApprovalItems).length > 0 && (
        <div className="p-6 rounded-lg bg-green-50 border border-green-200">
            <div className="flex items-center mb-2">
                <ListChecks className="h-5 w-5 mr-2 text-green-600" />
                <h3 className="text-lg font-semibold text-gray-800">Items for Approval</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">
                These items have been assigned to vendors and require project lead approval.
            </p>
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

    {/* Delayed Items Summary */}
    {allDelayedItems.length > 0 && (
        <div className="p-6 rounded-lg bg-red-50 border border-red-200 space-y-2">
            <div className="flex items-center mb-2">
                <SendToBack className="h-5 w-5 text-red-600 mr-2" />
                <h3 className="text-lg font-semibold text-gray-800">Delayed Items</h3>
            </div>
            <p className="text-sm text-gray-600">
                These items will be moved to a new 'Delayed Sent Back' list:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-gray-800">
                {allDelayedItems.map((item) => (
                    <li key={item.item_id} className="text-sm">
                        {item.item_name}
                         {item.make && (
                            <span className="text-gray-500 italic ml-1">({item.make})</span>
                        )}
                        <span className="mx-1">-</span>
                        {item.quantity}  {item.unit}
                    </li>
                ))}
            </ul>
            {delayedItemsTotalInclGst > 0 && (
                 <div className="mt-4 pt-4 border-t border-red-200 text-right">
                    <p className="text-sm font-medium text-gray-800">
                        Estimated Delayed Total (inc. GST): 
                        <span className="text-base font-semibold text-red-700"> {formatToRoundedIndianRupee(delayedItemsTotalInclGst)}</span>
                    </p>
                    <p className="text-xs text-gray-500 italic">(Based on last entered quotes)</p>
                </div>
            )}
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
                                        {allDelayedItems.length !== 0 && (
                                            <p>
                                                Remainder: Items whose quotes are not selected will have a delayed status
                                                attached to them. If confirmed, Delayed sent back request will be created for those Items.
                                            </p>
                                        )}

                                        {Object.keys(vendorWiseApprovalItems).length !== 0 && (
                                            <div className='flex flex-col gap-2 mt-2 text-start'>
                                                <h4 className='font-bold'>Any remarks for the Project Lead?</h4>
                                                <TextArea className='border-green-400 focus:border-green-800 bg-green-200' placeholder='type here...' value={comment?.approving} onChange={(e) => setComment({ ...comment, "approving": e.target.value })} />
                                            </div>
                                        )}

                                        {allDelayedItems.length !== 0 ? (
                                            <div className='flex flex-col gap-2 mt-2 text-start'>
                                                <h4 className='font-bold'>some items are delayed, any reason?</h4>
                                                <TextArea className='border-primary focus:border-red-800 bg-red-200' placeholder='type here...' value={comment?.delaying} onChange={(e) => setComment({ ...comment, "delaying": e.target.value })} />
                                            </div>
                                        ) : <></>}
                                    </DialogDescription>
                                </DialogHeader>
                                <DialogDescription className='flex items-center justify-center gap-2'>
                                    {(sendForApprCallLoading) ? <TailSpin width={60} color={"red"} /> : (
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
  )
}

export default VendorsSelectionSummary;
