import { ProcurementHeaderCard } from "@/components/helpers/ProcurementHeaderCard";
import { Badge } from "@/components/ui/badge";
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
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { toast } from "@/components/ui/use-toast";
import { useItemEstimate } from "@/hooks/useItemEstimate";
import { useUserData } from '@/hooks/useUserData';
import { ProcurementItem } from "@/types/NirmaanStack/ProcurementRequests";
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
import getLowestQuoteFilled from "@/utils/getLowestQuoteFilled";
import { parseNumber } from "@/utils/parseNumber";
import { ConfigProvider, Table, TableColumnsType } from "antd";
import TextArea from 'antd/es/input/TextArea';
import { useFrappeCreateDoc, useFrappeGetDocList, useFrappeUpdateDoc, useSWRConfig } from "frappe-react-sdk";
import memoize from 'lodash/memoize';
import { ArrowBigUpDash, BookOpenText, CheckCheck, ListChecks, MessageCircleMore, MoveDown, MoveUp, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import { CategoryData, CategoryWithChildren, DataItem } from "../ProcurementRequests/VendorQuotesSelection/VendorsSelectionSummary";

export const COLUMN_WIDTHS = {
  category: "auto",
  totalAmount: "auto",
  item: "20%",
  unit: "5%",
  quantity: "7%",
  rate: "10%",
  vendor: "15%",
  amount: "12%",
  lowestQuotedAmount: "10%",
  threeMonthsLowestAmount: "10%",
};

export const columns: TableColumnsType<CategoryData> = [
  {
      title: "Category",
      dataIndex: "category",
      key: "category",
      width: COLUMN_WIDTHS.category,
      render: (text) => <strong className="text-primary">{text}</strong>,
  },
  {
      title: "Total Amount",
      dataIndex: "totalAmount",
      key: "amount",
      width: COLUMN_WIDTHS.totalAmount,
      render: (text) => <Badge>{formatToIndianRupee(text)}</Badge>,
  },
];

export const innerColumns: TableColumnsType<DataItem> = [
  {
      title: "Item Name",
      dataIndex: "item",
      key: "item",
      width: COLUMN_WIDTHS.item,
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
      width: COLUMN_WIDTHS.unit,
  },
  {
      title: "Quantity",
      dataIndex: "quantity",
      key: "quantity",
      width: COLUMN_WIDTHS.quantity,
  },
  {
      title: "Rate",
      dataIndex: "quote",
      key: "quote",
      width: COLUMN_WIDTHS.rate,
      render: (text) => <span className="italic">{formatToIndianRupee(text)}</span>,
  },
  {
      title: "Vendor",
      dataIndex: "vendor_name",
      key: "vendor",
      width: COLUMN_WIDTHS.vendor,
      render: (text) => <span className="italic">{text}</span>,
  },
  {
      title: "Amount",
      dataIndex: "amount",
      key: "amount",
      width: COLUMN_WIDTHS.amount,
      render: (text, record) => {
          const amount = text;
          const lowest3 = record?.threeMonthsLowestAmount;

          if (!lowest3 || !amount) {
              return <i>{formatToIndianRupee(amount)}</i>;
          }

          const percentageDifference = ((Math.abs(amount - lowest3) / lowest3) * 100).toFixed(0);
          const isLessThan = amount < lowest3;
          const isEqual = amount === lowest3;
          const colorClass = isLessThan ? 'text-green-500' : 'text-red-500';
          const Icon = isLessThan ? MoveDown : MoveUp;

          return (
              <div className="flex items-center gap-1">
                  <i>{formatToIndianRupee(amount)}</i>
                  {!isEqual && (
                      <div className={`${colorClass} flex items-center`}>
                          <span className="text-sm">({`${percentageDifference}%`})</span>
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
      width: COLUMN_WIDTHS.lowestQuotedAmount,
      render: (text) => <span className="italic">{text ? formatToIndianRupee(text) : "--"}</span>,
  },
  {
      title: "Target Amount",
      dataIndex: "threeMonthsLowestAmount",
      key: "threeMonthsLowestAmount",
      width: COLUMN_WIDTHS.threeMonthsLowestAmount,
      render: (text, record) => {
          const amount = record.amount;
          const lowest3 = text;

          if (!lowest3) {
              return <i>--</i>;
          }
          const isLessThan = amount < lowest3;
          const isEqual = amount === lowest3;
          const colorClass = isLessThan ? 'text-green-500' : 'text-red-500';

          return <i className={`${!isEqual && colorClass}`}>{formatToIndianRupee(lowest3)}</i>;
      },
  },
];


export const SBQuotesSelectionReview : React.FC = () => {

  const { sbId } = useParams<{ sbId: string }>();
  const navigate = useNavigate();
  const [comment, setComment] = useState<string>("")
  const userData = useUserData()

  const { updateDoc: updateDoc, loading: update_loading } = useFrappeUpdateDoc()
  const { createDoc: createDoc, loading: create_loading } = useFrappeCreateDoc()

  const {mutate} = useSWRConfig()

  const {getItemEstimate} = useItemEstimate()

  const [orderData, setOrderData] = useState<SentBackCategory | undefined>();

  const { data: sent_back_list, isLoading: sent_back_list_loading } = useFrappeGetDocList<SentBackCategory>("Sent Back Category", {
        fields: ["*"],
        filters: [["name", "=", sbId]]
      },
      sbId ? `Sent Back Category:${sbId}` : null
  );

  const { data: vendor_list, isLoading: vendor_list_loading } = useFrappeGetDocList<Vendors>("Vendors",
    {
        fields: ['name', 'vendor_name', 'vendor_address', 'vendor_type', 'vendor_state', 'vendor_city'],
        filters: [["vendor_type", "in", ["Material", "Material & Service"]]],
        limit: 10000
  });

  useEffect(() => {
    if(sent_back_list) {
      const request = sent_back_list[0]
      setOrderData(request)
    }
  }, [sent_back_list])

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
    }, (itemId: string) => itemId),[orderData]);

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
  [vendor : string] : {
    items : (ProcurementItem & {potentialLoss? : number})[];
    total : number;
  }
}

const generateActionSummary = useCallback(() => {
    let vendorWiseApprovalItems : VendorWiseApprovalItems  = {};
    let approvalOverallTotal : number = 0;

    orderData?.item_list?.list.forEach((item) => {
        const vendor = item?.vendor || "";
            // Approval items segregated by vendor
            const targetRate = getItemEstimate(item?.name)
          const lowestItemPrice = targetRate ? targetRate * 0.98 : getLowest(item?.name)
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
    });

    return {
        vendorWiseApprovalItems,
        approvalOverallTotal,
    };
}, [orderData]);

const {
    vendorWiseApprovalItems,
    approvalOverallTotal,
} = generateActionSummary();


if (sent_back_list_loading || vendor_list_loading) return <div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>
    
  return (
          <div className="flex-1 space-y-4">
              <div className="flex items-center">
                  <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Comparison</h2>
              </div>
              <ProcurementHeaderCard orderData={orderData} sentBack />
              {/* <div className="bg-white shadow-md rounded-lg p-4 border border-gray-200 mt-4"> */}
                        {/* <h2 className="text-lg font-bold mb-3 flex items-center">
                            <BookOpenText className="h-5 w-5 text-blue-500 mr-2" />
                            Approval Products
                        </h2> */}
                        {/* <div className="p-6"> */}
                            {/* Approval Items Summary */}
                            {/* {Object.keys(vendorWiseApprovalItems).length > 0 && (
                                <div className="p-6 rounded-lg bg-green-100 opacity-70">
                                    <div className="flex items-center mb-2">
                                        <ListChecks className="h-5 w-5 mr-2 text-green-600" />
                                        <h3 className="font-medium">Approval Items</h3>
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
                                                            (You are potentially losing {formatToIndianRupee(item.potentialLoss)} on this product)                                                                                                                </span>
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
                            )} */}
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
                            </div>
                        {/* </div> */}
                    {/* </div> */}
              {/* <div className='mt-6 overflow-x-auto'>
              {getFinalVendorQuotesData?.length > 0 ? (
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
      )}
              </div> */}
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
  )
}

export default SBQuotesSelectionReview;