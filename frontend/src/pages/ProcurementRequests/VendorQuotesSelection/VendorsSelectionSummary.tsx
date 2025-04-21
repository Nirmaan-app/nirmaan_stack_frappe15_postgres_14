import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useItemEstimate } from "@/hooks/useItemEstimate";
import { COLUMN_WIDTHS } from "@/pages/Sent Back Requests/SBQuotesSelectionReview";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { ProcurementItem, ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
import getLowestQuoteFilled from "@/utils/getLowestQuoteFilled";
import { parseNumber } from "@/utils/parseNumber";
import { ConfigProvider, Table, TableColumnsType } from "antd";
import TextArea from 'antd/es/input/TextArea';
import { useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import memoize from 'lodash/memoize';
import { ArrowBigUpDash, BookOpenText, Building2, CheckCheck, Clock, ListChecks, MessageCircleMore, MoveDown, MoveUp, SendToBack, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import { ProcurementHeaderCard } from "../../../components/helpers/ProcurementHeaderCard";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { toast } from "../../../components/ui/use-toast";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";

export interface DataItem extends ProcurementItem {
  amount: number;
  vendor_name?: string;
  lowestQuotedAmount: number;
  threeMonthsLowestAmount: number;
}

export interface CategoryData {
  items: DataItem[];
  category?: string;
  totalAmount?: number | string;
  key: string;
}

export interface CategoryWithChildren {
  [category: string]: CategoryData;
}

export const columns : TableColumnsType<CategoryData> = [
  {
    title: "Category",
    dataIndex: "category",
    key: "category",
    className: COLUMN_WIDTHS.category,
    render: (text) => {
      return (
        <strong className="text-primary">{text}</strong>
      )
    },
  },
  {
    title: "Total Amount",
    dataIndex: "totalAmount",
    key: "amount",
    className: COLUMN_WIDTHS.totalAmount,
    render: (text) => <Badge>{text ? formatToIndianRupee(text) : "Delayed"}</Badge>,
  },
];

export const innerColumns : TableColumnsType<DataItem> = [
  {
    title: "Item Name",
    dataIndex: "item",
    key: "item",
    className: COLUMN_WIDTHS.item,
    render: (text, record) => (
      <div className="flex flex-col gap-1">
        <div className="inline items-baseline">
        <span>{text}</span>
        {record?.comment && (
          <HoverCard>
            <HoverCardTrigger><MessageCircleMore className="text-blue-400 w-6 h-6 inline-block ml-1" /></HoverCardTrigger>
            <HoverCardContent className="max-w-[300px] bg-gray-800 text-white p-2 rounded-md shadow-lg">
              <div className="relative pb-4">
                <span className="block">{record.comment}</span>
                <span className="text-xs absolute right-0 italic text-gray-200">-Comment by PL</span>
              </div>
            </HoverCardContent>
          </HoverCard>
        )}
        </div>
        {record?.make && (
          <span className="text-xs">Selected make : <b>{record.make}</b></span>
        )}
      </div>
    )
  },
  {
    title: "Unit",
    dataIndex: "unit",
    key: "unit",
    className: COLUMN_WIDTHS.unit,
  },
  {
    title: "Quantity",
    dataIndex: "quantity",
    key: "quantity",
    className: COLUMN_WIDTHS.quantity,
  },
  {
    title: "Rate",
    dataIndex: "quote",
    key: "quote",
    className: COLUMN_WIDTHS.rate,
    render: (text) => (
      <span className="italic">
        {text ? formatToIndianRupee(text) : "Delayed"}
      </span>
    ),
  },
  {
    title: "Vendor",
    dataIndex: "vendor_name",
    key: "vendor",
    className: COLUMN_WIDTHS.vendor,
    render: (text) => (
      <span className="italic">
        {text || "Delayed"}
      </span>
    ),
  },
  {
    title: "Amount",
    dataIndex: "amount",
    key: "amount",
    className: COLUMN_WIDTHS.amount,
    render: (text, record) => {
      const amount = text;
      const lowest3 = record?.threeMonthsLowestAmount
    
      if (!lowest3 || !amount) {
        return (
          <i>
            {amount || "Delayed"}
          </i>
        );
      }

       const percentageDifference = (
        (Math.abs(amount - lowest3) / lowest3) * 100
      ).toFixed(0);
    
      const isLessThan = amount < lowest3;
      const isEqual = amount === lowest3;
      const colorClass = isLessThan ? 'text-green-500' : 'text-red-500';
      const Icon = isLessThan ? MoveDown : MoveUp;
    
      return (
        <div
          className="flex items-center gap-1"
        >
          <i>{formatToIndianRupee(amount)}</i>
          {!isEqual && (
              <div className={`${colorClass} flex items-center`}>
                <span className="text-sm">
                  ({`${percentageDifference}%`})
                </span>
                <Icon className="w-4 h-4" />
              </div>
            )}
        </div>
      );
    },
  },
  {
    title: "Lowest Quoted Amount",
    dataIndex: "lowestQuotedAmount",
    key: "lowestQuotedAmount",
    className: COLUMN_WIDTHS.lowestQuotedAmount,
    render: (text) => (
      <span className="italic">
        {text ? formatToIndianRupee(text) : "--"}
      </span>
    ),
  },
  {
    title: "Target Amount",
    dataIndex: "threeMonthsLowestAmount",
    key: "threeMonthsLowestAmount",
    className: COLUMN_WIDTHS.threeMonthsLowestAmount,
    render: (text, record) => {

      const amount = record.amount;
      const lowest3 = text;

      if (!amount || !lowest3) {
          return <i>--</i>;
      }
      const isLessThan = amount < lowest3;
      const isEqual = amount === lowest3;
      const colorClass = isLessThan ? 'text-green-500' : 'text-red-500';

      return <i className={`${!isEqual && colorClass}`}>{formatToIndianRupee(lowest3)}</i>;
  },
},
];

export const VendorsSelectionSummary : React.FC = () => {

  const { prId } = useParams<{ prId: string }>();

  if (!prId) {
    return <div className="flex items-center justify-center h-[90vh]">Error: PR ID is missing.</div>;
  }
  const navigate = useNavigate();
  const [comment, setComment] = useState<{approving: string, delaying: string}>({ approving: "", delaying: "" })

  const {call : sendForApprCall, loading : sendForApprCallLoading} = useFrappePostCall("nirmaan_stack.api.send_vendor_quotes.handle_delayed_items")

  const [orderData, setOrderData] = useState<ProcurementRequest | undefined>();

  const {getItemEstimate} = useItemEstimate()

  const { data: procurement_request_list, isLoading: procurement_request_list_loading, mutate: pr_mutate } = useFrappeGetDocList<ProcurementRequest>("Procurement Requests",
      {
          fields: ["*"],
          filters: [['name', '=', prId]]
      },
      prId ? `Procurement Requests:${prId}` : null
  );

  const { data: vendor_list, isLoading: vendor_list_loading } = useFrappeGetDocList<Vendors>("Vendors",
    {
        fields: ['name', 'vendor_name', 'vendor_address', 'vendor_type', 'vendor_state', 'vendor_city'],
        filters: [["vendor_type", "in", ["Material", "Material & Service"]]],
        limit: 10000
  });
  
  const { data: usersList, isLoading: usersListLoading } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
        fields: ["*"],
        limit: 1000,
      }, "Nirmaan Users"
  )
      
  const getFullName = useMemo(() => (id : string | undefined) => {
    return usersList?.find((user) => user?.name == id)?.full_name || ""
  }, [usersList]);

  useEffect(() => {
    if(procurement_request_list) {
      const procurementRequest = procurement_request_list[0]
      setOrderData(procurementRequest)
    }
  }, [procurement_request_list])

  // const getCategoryTotals = useMemo(() => {
  //   const totals : {[category: string]: number} = {}

  // if(!orderData?.procurement_list?.list?.length) return totals
  //   orderData?.procurement_list?.list?.forEach(item => {
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

  const getVendorName = useMemo(() => (vendorId : string | undefined) : string => {
    return vendor_list?.find(v => v?.name === vendorId)?.vendor_name || ""
  }, [vendor_list])

  const getLowest = useMemo(() => memoize((itemId: string) => {
        return getLowestQuoteFilled(orderData, itemId)
    }, (itemId: string) => itemId),[orderData]);

  // const getFinalVendorQuotesData = useMemo(() => {
  //   const data : CategoryWithChildren[] = []
  //   if(orderData?.procurement_list.list?.length) {
  //     const procurementList = orderData.procurement_list.list
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


interface VendorWiseApprovalItems {
  [vendor : string] : {
    items : (ProcurementItem & {potentialLoss? : number})[];
    total : number;
  }
}

  const generateActionSummary = useCallback(() => {
    let allDelayedItems : ProcurementItem[] = [];
    let vendorWiseApprovalItems : VendorWiseApprovalItems  = {};
    let approvalOverallTotal : number = 0;

    orderData?.procurement_list?.list.forEach((item) => {
        const vendor = item?.vendor;
        const targetRate = getItemEstimate(item?.name)
        const lowestItemPrice = targetRate ? targetRate * 0.98 : getLowest(item?.name)
        if (!vendor) {
            // Delayed items
            allDelayedItems.push(item);
        } else {
            // Approval items segregated by vendor
            const itemTotal = parseNumber(item.quantity * parseNumber(item.quote));
            if (!vendorWiseApprovalItems[vendor]) {
                vendorWiseApprovalItems[vendor] = {
                    items: [],
                    total: 0,
                };
            }
            if(lowestItemPrice && lowestItemPrice !== parseNumber(item.quote) && lowestItemPrice < parseNumber(item?.quote)) {
              vendorWiseApprovalItems[vendor].items.push({...item, potentialLoss : itemTotal - (parseNumber(item.quantity) * lowestItemPrice)});
            } else {
              vendorWiseApprovalItems[vendor].items.push(item);
            }
            vendorWiseApprovalItems[vendor].total += itemTotal;
            approvalOverallTotal += itemTotal;
        }
    });

    return {
        allDelayedItems,
        vendorWiseApprovalItems,
        approvalOverallTotal,
    };
}, [orderData]);

const {
    allDelayedItems,
    vendorWiseApprovalItems,
    approvalOverallTotal,
} = generateActionSummary();

if (procurement_request_list_loading || vendor_list_loading || usersListLoading) return <LoadingFallback />

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
              {/* <div className="bg-white shadow-md rounded-lg border border-gray-200 mt-4"> */}
                        {/* <h2 className="text-lg font-bold mb-3 flex items-center">
                            <BookOpenText className="h-5 w-5 text-blue-500 mr-2" />
                            Actions Summary
                        </h2> */}
                       {/* <div className="flex flex-col gap-4">
                            {Object.keys(vendorWiseApprovalItems).length > 0 && (
                                <div className="p-6 rounded-lg bg-green-100 opacity-70">
                                    <div className="flex items-center mb-2">
                                        <ListChecks className="h-5 w-5 mr-2 text-green-600" />
                                        <h3 className="font-medium">Approval Products</h3>
                                    </div>
                                    <p className="text-sm">
                                        These items will be sent to the project lead for approval.
                                    </p>
                                    <ul className="list-[number] text-red-700 pl-5 space-y-2">
                                    {Object.entries(vendorWiseApprovalItems).map(([vendor, { items, total }]) => (
                                        <li key={vendor} className="mt-2 space-y-2">
                                            <h4 className="text-sm font-medium">
                                                {getVendorName(vendor)}:
                                            </h4>
                                            <ul className="list-disc pl-5 text-black space-y-2">
                                                {items.map((item) => (
                                                    <li key={item.name} className="text-xs md:text-sm">
                                                        {item.item} - {item.quantity} {item.unit} -
                                                        {formatToIndianRupee(item.quantity * (item.quote || 0))}
                                                        {item?.potentialLoss && (
                                                          <span className="ml-2 text-red-700">
                                                            (You are potentially losing {formatToIndianRupee(item.potentialLoss)} on this product)
                                                          </span>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                          <p className="text-sm text-black font-medium -ml-5 mt-2">
                                            Vendor Total: <span className="font-semibold">{formatToIndianRupee(total)}</span>
                                          </p>
                                        </li>
                                    ))}
                                    </ul>
                                    <p className="mt-2 font-medium text-end">
                                        <span className="text-red-700">Overall Total:</span> {formatToIndianRupee(approvalOverallTotal)}
                                    </p>
                                </div>
                            )}

                            {allDelayedItems.length > 0 && (
                                <div className="p-6 space-y-2 rounded-lg bg-red-100 opacity-70">
                                    <div className="flex items-center mb-2">
                                        <SendToBack className="h-5 w-5 text-red-500 mr-2" />
                                        <h3 className="font-medium">Delayed Products</h3>
                                    </div>
                                    <p className="text-sm">
                                        These items are delayed and a <strong>new Delayed Sent Back</strong> will be created:
                                    </p>
                                    <ul className="list-disc space-y-2 pl-5">
                                        {allDelayedItems.map((item) => (
                                            <li key={item.name} className="text-xs md:text-sm">
                                                {item.item} - {item.quantity} {item.unit}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div> */}

{/* <div className="flex flex-col gap-6">
  {Object.keys(vendorWiseApprovalItems).length > 0 && (
    <div className="p-6 rounded-lg bg-green-50 border border-green-100">
      <header className="flex items-start mb-4">
        <div className="bg-green-100 p-2 rounded-lg">
          <ListChecks className="h-5 w-5 text-green-600" />
        </div>
        <div className="ml-3">
          <h3 className="font-semibold text-gray-800">Approval Products</h3>
          <p className="text-sm text-gray-600 mt-1">
            Items pending project lead approval with vendor-specific breakdown
          </p>
        </div>
      </header>

      <div className="space-y-4">
        {Object.entries(vendorWiseApprovalItems).map(([vendor, { items, total }]) => (
          <div key={vendor} className="bg-white rounded-lg p-4 shadow-xs">
            <div className="flex items-center mb-3">
              <Building2 className="h-4 w-4 text-gray-400 mr-2" />
              <h4 className="font-medium text-gray-700">
                {getVendorName(vendor)}
              </h4>
            </div>

            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.name} className="border-b pb-3 last:border-0">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium text-gray-900">
                        {item.item}
                        {item.make && (
                          <span className="ml-2 text-sm font-normal text-gray-500">
                            ({item.make})
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
                        {item.quantity} {item.unit} • 
                        {formatToIndianRupee(item.quote)}/unit
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-gray-900">
                        {formatToIndianRupee(item.quantity * (item.quote || 0))}
                      </div>
                      {item?.potentialLoss && (
                        <div className="text-xs text-red-600 mt-1">
                          Potential loss: {formatToIndianRupee(item.potentialLoss)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between items-center mt-4 pt-3 border-t">
              <span className="text-sm font-medium text-gray-600">Vendor Total:</span>
              <span className="font-semibold text-gray-800">
                {formatToIndianRupee(total)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 pt-4 border-t border-green-100">
        <div className="flex justify-between items-center">
          <span className="font-medium text-gray-700">Overall Total:</span>
          <span className="font-semibold text-red-700">
            {formatToIndianRupee(approvalOverallTotal)}
          </span>
        </div>
      </div>
    </div>
  )}

  {allDelayedItems.length > 0 && (
    <div className="p-6 rounded-lg bg-red-50 border border-red-100">
      <header className="flex items-start mb-4">
        <div className="bg-red-100 p-2 rounded-lg">
          <SendToBack className="h-5 w-5 text-red-500" />
        </div>
        <div className="ml-3">
          <h3 className="font-semibold text-gray-800">Delayed Products</h3>
          <p className="text-sm text-gray-600 mt-1">
            New Delayed Sent Back will be created for these items
          </p>
        </div>
      </header>

      <div className="space-y-3">
        {allDelayedItems.map((item) => (
          <div key={item.name} className="bg-white rounded-lg p-3 shadow-xs">
            <div className="flex justify-between items-center">
              <div>
                <div className="font-medium text-gray-900">
                  {item.item}
                  {item.make && (
                    <span className="ml-2 text-sm font-normal text-gray-500">
                      ({item.make})
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-600 mt-1">
                  {item.quantity} {item.unit}
                </div>
              </div>
              <Clock className="h-5 w-5 text-red-400" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )}
</div> */}

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
                                    <li key={item.item} className="text-sm"> {/* Standardized text size */}
                                        {item.item}
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

    {/* Delayed Items Summary */}
    {allDelayedItems.length > 0 && (
        <div className="p-6 rounded-lg bg-red-50 border border-red-200 space-y-2"> {/* Changed background, removed opacity, added border */}
            <div className="flex items-center mb-2">
                <SendToBack className="h-5 w-5 text-red-600 mr-2" /> {/* Adjusted icon color */}
                <h3 className="text-lg font-semibold text-gray-800">Delayed Items</h3> {/* Slightly bolder heading */}
            </div>
            <p className="text-sm text-gray-600"> {/* Adjusted text color */}
                These items will be moved to a new 'Delayed Sent Back' list:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-gray-800"> {/* Adjusted text color, list style */}
                {allDelayedItems.map((item) => (
                    <li key={item.item} className="text-sm"> {/* Standardized text size */}
                        {item.item}
                         {/* --- Also added Make Name here for consistency --- */}
                         {item.make && (
                            <span className="text-gray-500 italic ml-1">({item.make})</span>
                        )}
                        {/* --- End Make Name --- */}
                        <span className="mx-1">-</span> {/* Added separator */}
                        {item.quantity} {item.unit}
                    </li>
                ))}
            </ul>
        </div>
    )}
</div>

              {/* </div> */}
              {/* {getFinalVendorQuotesData?.length > 0 ? (
        <div className="overflow-x-auto">
          <ConfigProvider
          
          >
            <Table
              dataSource={getFinalVendorQuotesData
                ?.sort((a, b) =>
                  Object.keys(a)[0]?.localeCompare(Object.keys(b)[0])
                )
                ?.map((key) => ({
                  key: Object.values(key)[0]?.key,
                  totalAmount: Object.values(key)[0]?.totalAmount,
                  category: Object.keys(key)[0],
                  items: Object.values(key)[0]?.items,
                }))}
              rowClassName={(record) => !record?.totalAmount ? "bg-red-100" : ""}
              columns={columns}
              pagination={false}
              expandable={{
                defaultExpandAllRows : true,
                expandedRowRender: (record) => (
                  <Table
                    rowClassName={(record) => !record?.amount ? "bg-red-50" : ""}
                    dataSource={record.items}
                    columns={innerColumns}
                    pagination={false}
                    rowKey={(item) => item.name || uuidv4()}
                  />
                ),
              }}
              rowKey="key"
            />
          </ConfigProvider>
        </div>
      ) : (
        <div className="h-[10vh] flex items-center justify-center">
          No Results.
        </div>
      )} */}
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