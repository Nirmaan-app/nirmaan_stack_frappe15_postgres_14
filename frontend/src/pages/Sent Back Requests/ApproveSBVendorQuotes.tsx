import { ActionSummary } from '@/components/ui/ActionSummary';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ApproveVendorQuotesPRorSBAntDTable } from '@/components/ui/ApproveVendorQuotesPRorSBAntDTable';
import { Button } from "@/components/ui/button";
import { ProcurementActionsHeaderCard } from "@/components/ui/ProcurementActionsHeaderCard";
import { useToast } from "@/components/ui/use-toast";
import { CategoryWithChildren, DataItem } from "@/pages/ProcurementRequests/VendorQuotesSelection/VendorsSelectionSummary";
import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations";
import { NirmaanComments } from "@/types/NirmaanStack/NirmaanComments";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { SentBackCategory } from '@/types/NirmaanStack/SentBackCategory';
import { Vendors } from "@/types/NirmaanStack/Vendors";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useFrappeGetDoc, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { CheckCheck, ListChecks, SendToBack, Undo2 } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { TailSpin } from 'react-loader-spinner';
import { useNavigate, useParams } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import { RenderPRorSBComments } from '../../components/ui/RenderPRorSBComments';

const ApproveSBVendorQuotes : React.FC = () => {

    const { id : sbId } = useParams<{ id: string }>()
    const { data: sb, isLoading: sb_loading, error: sb_error, mutate: sb_mutate } = useFrappeGetDoc("Sent Back Category", sbId);

    const { data: usersList, isLoading: usersListLoading, error: usersListError } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
        fields: ["name", "full_name"],
        limit: 1000
    })

    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocList<Vendors>("Vendors",
      {
          fields: ['name', 'vendor_name', 'vendor_address', 'vendor_gst', 'vendor_type'],
          filters: [["vendor_type", "in", ["Material", "Material & Service"]]],
          limit: 10000
      });
    
    const { data: universalComment, isLoading: universalCommentLoading, error: universalCommentError } = useFrappeGetDocList<NirmaanComments>("Nirmaan Comments", {
        fields: ["*"],
        filters: [["reference_name", "=", sb?.name], ["subject", "=", "sb vendors selected"]]
    },
    sb ? undefined : null
  )

  const { data: quotes_data, isLoading: quotesLoading, error: quotesError } = useFrappeGetDocList<ApprovedQuotations>("Approved Quotations",
        {
            fields: ['*'],
            limit: 100000
        });

    const navigate = useNavigate()

    const getUserName = (id : string | undefined) => {
        if (usersList) {
            return usersList.find((user) => user?.name === id)?.full_name || ""
        }
        return ""
    }

    // console.log("within 1st component", owner_data)
    if (sb_loading || usersListLoading || vendor_list_loading || universalCommentLoading || quotesLoading) return <div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>
    if (sb_error || usersListError || universalCommentError || vendor_list_error || quotesError) return <h1>Error</h1>

    if (!["Vendor Selected", "Partially Approved"].includes(sb?.workflow_state || "") && !sb?.item_list?.list?.some((i) => i?.status === "Pending")) return (
        <div className="flex items-center justify-center h-[90vh]">
            <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
                <h2 className="text-2xl font-semibold text-gray-800">
                    Heads Up!
                </h2>
                <p className="text-gray-600 text-lg">
                    Hey there, the SB:{" "}
                    <span className="font-medium text-gray-900">{sb?.name}</span>{" "}
                    is no longer available for{" "}
                    <span className="italic">Reviewing</span>. The current state is{" "}
                    <span className="font-semibold text-blue-600">
                        {sb?.workflow_state}
                    </span>{" "}
                    And the last modification was done by <span className="font-medium text-gray-900">
                        {sb?.modified_by === "Administrator" ? sb?.modified_by : getUserName(sb?.modified_by)}
                    </span>
                    !
                </p>
                <button
                    className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors duration-300"
                    onClick={() => navigate("/purchase-orders?tab=Approve Sent Back PO")}
                >
                    Go Back
                </button>
            </div>
        </div>
    );
    return (
      <ApproveSBVendorQuotesPage vendor_list={vendor_list} sb_data={sb} sb_mutate = {sb_mutate} quotes_data={quotes_data} universalComment={universalComment} getUserName={getUserName} />
    )
}

type ApproveSBVendorQuotesPageProps = {
  sb_data: any
  sb_mutate?: any
  vendor_list?: Vendors[]
  quotes_data?: ApprovedQuotations[]
  universalComment? :  NirmaanComments[]
  getUserName: (id : string | undefined) => string
}

export const ApproveSBVendorQuotesPage : React.FC<ApproveSBVendorQuotesPageProps> = ({sb_data, sb_mutate, vendor_list, quotes_data, universalComment, getUserName}) => {

  const {call : approveItemsCall, loading : approveItemsCallLoading} = useFrappePostCall("nirmaan_stack.api.approve_reject_sb_vendor_quotes.new_handle_approve")

  const {call : sendBackItemsCall, loading : sendBackItemsCallLoading} = useFrappePostCall("nirmaan_stack.api.approve_reject_sb_vendor_quotes.new_handle_sent_back")

  const navigate = useNavigate()

  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState<string | null>(null);
  const [comment, setComment] = useState<string>("")

  const [orderData, setOrderData] = useState<SentBackCategory | undefined>()

  const [sentBackDialog, setSentBackDialog] = useState<boolean>(false)

  const toggleSentBackDialog = () => setSentBackDialog(!sentBackDialog);

  const [approveDialog, setApproveDialog] = useState<boolean>(false)

  const toggleApproveDialog = () => setApproveDialog(!approveDialog);


  useEffect(() => {
     const newOrderData = sb_data;
     const newCategories: { name: string, makes : string[] }[] = [];
     const newList: SentBackCategory[] = [];
     JSON.parse(newOrderData?.item_list)?.list?.forEach((item) => {
         if (item.status === "Pending") newList.push(item);
         if (!newCategories.some(category => category.name === item.category)) {
             newCategories.push({ name: item.category, makes : [] });
         }
     });

     const rfq_data = JSON.parse(newOrderData?.rfq_data);

     // Update orderData with computed lists
     setOrderData(() => ({
         ...newOrderData,
         item_list: {
             list: newList
         },
         category_list: {
             list: newCategories
         },
         rfq_data: rfq_data
     }));
  }, [sb_data])

  const getVendorName = (vendorId: string) => {
      return vendor_list?.find(vendor => vendor.name === vendorId)?.vendor_name
  }

  const getLowest = (itemId: string) => {
      const filtered : number[] = []
      Object.values(orderData?.rfq_data?.details?.[itemId]?.vendorQuotes || {})?.map(i => {
      if(i?.quote) {
        filtered.push(i?.quote)
      }
    })
       
    let minQuote;
    if (filtered.length > 0) minQuote = Math.min(...filtered);
    return minQuote || 0;
  }

  const getThreeMonthsLowest = (itemId : string) => {
      const quotesForItem = quotes_data
        ?.filter(value => value?.item_id === itemId && ![null, "0", 0, undefined].includes(value?.quote))
        ?.map(value => parseFloat(value?.quote || "0"));
      let minQuote;
      if (quotesForItem && quotesForItem.length > 0) minQuote = Math.min(...quotesForItem);
      return minQuote || 0;
  }

  const getCategoryTotals = useMemo(() => {
    const totals : {[category: string]: number} = {}

  if(!orderData?.item_list?.list?.length) return totals
    orderData?.item_list?.list?.forEach(item => {
      const category = item.category
      const quote = item.quote || 0
      const quantity = item.quantity
      if(!totals[category]) {
        totals[category] = 0
      }
      totals[category] += quote * quantity
    })

    return totals
  }, [orderData])

  const getFinalVendorQuotesData = useMemo(() => {
      const data : CategoryWithChildren[] = []
      if(orderData?.item_list.list?.length) {
        const procurementList = orderData.item_list.list
        procurementList.forEach(item => {
          const category : string = item.category
          const existingCategory = data?.find(entry => entry[category])
          if(existingCategory) {
            existingCategory[category]?.items.push({
              ...item,
              vendor_name : item?.vendor ? getVendorName(item?.vendor) : undefined,
              amount: (item.quote || 0) * item.quantity,
              threeMonthsLowestAmount: getThreeMonthsLowest(item.name) * item.quantity,
              lowestQuotedAmount: getLowest(item.name) * item.quantity,
            })
          } else {
            data.push({
              [category]: {
                totalAmount: getCategoryTotals[category],
                key: uuidv4(),
                items: [{
                  ...item,
                  vendor_name : item?.vendor ? getVendorName(item?.vendor) : undefined,
                  amount: (item.quote || 0) * item.quantity,
                  threeMonthsLowestAmount: getThreeMonthsLowest(item.name) * item.quantity,
                  lowestQuotedAmount: getLowest(item.name) * item.quantity,
                }]
              }
            })
          }
        })
      }
      return data
    }, [orderData, vendor_list])
  

  const dataSource = getFinalVendorQuotesData
  ?.sort((a, b) =>
    Object.keys(a)[0]?.localeCompare(Object.keys(b)[0])
  )
  ?.map((key) => ({
    key: Object.values(key)[0]?.key,
    totalAmount: Object.values(key)[0]?.totalAmount,
    category: Object.keys(key)[0],
    items: Object.values(key)[0]?.items,
  }))

  const [selectionMap, setSelectionMap] = useState(new Map());

const newHandleApprove = async () => {
  try {
      setIsLoading("newHandleApprove");

      const selectedItemNames : string[] = [];
      const vendorMap : {[itemName: string]: string} = {};

      selectionMap.forEach((categorySelection, categoryKey) => {
          if (categorySelection.all) {
              // All items in category selected
              dataSource.find(category => category.key === categoryKey)?.items.forEach(item => {
                  selectedItemNames.push(item.name);
                  vendorMap[item.name] = item.vendor || "";
              });
          } else {
              // Some items in category selected
              categorySelection.items.forEach((itemName : string)  => {
                  selectedItemNames.push(itemName);
                  dataSource.find(category => category.key === categoryKey)?.items.find(item => item.name === itemName) && (vendorMap[itemName] = dataSource.find(category => category.key === categoryKey)?.items.find(item => item.name === itemName)?.vendor || "");
              });
          }
      });

      const response = await approveItemsCall({
          project_id: orderData?.project,
          sb_id: orderData?.name,
          selected_items: selectedItemNames,
          selected_vendors: vendorMap,
      });

      if (response.message.status === 200) {
          toast({
              title: "Success!",
              description: response.message.message,
              variant: "success",
          });

          setSelectionMap(new Map());
          await sb_mutate();
          if (orderData?.item_list.list.length === selectedItemNames.length) {
              navigate('/purchase-orders?tab=Approve Sent Back PO');
          }
          toggleApproveDialog();
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
          description: "Approving Vendor Quotes Failed!",
          variant: "destructive",
      });
  } finally {
      setIsLoading("");
  }
};

const newHandleSentBack = async () => {
  try {
      setIsLoading("newHandleSentBack");

      const selectedItemNames : string[] = [];

      selectionMap.forEach((categorySelection, categoryKey) => {
          if (categorySelection.all) {
              // All items in category selected
              dataSource.find(category => category.key === categoryKey)?.items.forEach(item => {
                  selectedItemNames.push(item.name);
              });
          } else {
              // Some items in category selected
              categorySelection.items.forEach((itemName : string) => {
                  selectedItemNames.push(itemName);
              });
          }
      });

      const response = await sendBackItemsCall({
          sb_id: orderData?.name,
          selected_items: selectedItemNames,
          comment: comment,
      });

      if (response.message.status === 200) {
          toast({
              title: "Success!",
              description: response.message.message,
              variant: "success",
          });

          setSelectionMap(new Map());
          await sb_mutate();

          if (orderData?.item_list?.list?.length === selectedItemNames.length) {
              navigate('/purchase-orders?tab=Approve Sent Back PO');
          }

          toggleSentBackDialog();
      } else if (response.message.status === 400) {
          toast({
              title: "Failed!",
              description: response.message.error,
              variant: "destructive",
          });
      }
  } catch (error) {
      console.error("Error sending back items:", error);
      toast({
          title: "Failed!",
          description: "Sending Back Items Failed!",
          variant: "destructive",
      });
  } finally {
      setIsLoading("");
      setComment("");
  }
};

const generateActionSummary = (actionType : string) => {
  if (actionType === "approve") {
      const selectedItems : DataItem[] = [];
      const selectedVendors : {[itemName: string]: string} = {};

      selectionMap.forEach((categorySelection, categoryKey) => {
          const categoryData = dataSource.find(category => category.key === categoryKey);
          if (!categoryData) return; // Skip if category not found

          if (categorySelection.all) {
              // All items in category selected
              categoryData.items.forEach(item => {
                  selectedItems.push(item);
                  selectedVendors[item.name] = item.vendor || "";
              });
          } else {
              // Some items in category selected
              categorySelection.items.forEach((itemName : string) => {
                  const item = categoryData.items.find(item => item.name === itemName);
                  if (item) {
                      selectedItems.push(item);
                      selectedVendors[item.name] = item.vendor || "";
                  }
              });
          }
      });

      const groupedVendors = selectedItems.reduce((acc : {[vendor: string]: DataItem[]}, item) => {
          const vendor = selectedVendors[item.name];
          if (vendor) {
              if (!acc[vendor]) acc[vendor] = [];
              acc[vendor].push(item);
          }
          return acc;
      }, {});

      if (!groupedVendors || Object.keys(groupedVendors).length === 0) {
          return "No valid items selected for approval.";
      }

      const vendorTotals = Object.entries(groupedVendors).map(([vendor, items]) => ({
          vendor,
          total: items.reduce((sum, item) => sum + (item.amount || 0), 0),
      }));
      const overallTotal = vendorTotals.reduce((sum, { total }) => sum + total, 0);

      return (
          <div>
              <p>Upon approval, the following actions will be taken:</p>
              <ul className="mt-2 list-disc pl-5">
                  {Object.entries(groupedVendors).map(([vendor, items]) => (
                      <li key={vendor}>
                          A <strong>new PO</strong> will be created for vendor <strong>{getVendorName(vendor)}</strong>:
                          <ul className="mt-1 list-disc pl-5">
                              {items.map((item) => (
                                  <li key={item.name}>
                                      {item.item} - {item.quantity} {item.unit} ({formatToIndianRupee(item.amount)})
                                  </li>
                              ))}
                          </ul>
                          <p className="mt-1 text-gray-600">
                              Vendor Total: <strong>{formatToIndianRupee(vendorTotals.find(v => v.vendor === vendor)?.total)}</strong>
                          </p>
                      </li>
                  ))}
              </ul>
              <p className="mt-3 text-gray-800">
                  Overall Total: <strong>{formatToIndianRupee(overallTotal)}</strong>
              </p>
          </div>
      );
  } else if (actionType === "sendBack") {
      const selectedItems : DataItem[] = [];

      selectionMap.forEach((categorySelection, categoryKey) => {
          const categoryData = dataSource.find(category => category.key === categoryKey);
          if (!categoryData) return; // Skip if category not found

          if (categorySelection.all) {
              // All items in category selected
              categoryData.items.forEach(item => {
                  selectedItems.push(item);
              });
          } else {
              // Some items in category selected
              categorySelection.items.forEach((itemName : string) => {
                  const item = categoryData.items.find(item => item.name === itemName);
                  if (item) {
                      selectedItems.push(item);
                  }
              });
          }
      });

      if (selectedItems.length === 0) {
          return "No valid items selected for sending back.";
      }

      return (
          <div>
              <p>Upon sending back, the following actions will be taken:</p>
              <ul className="mt-2 list-disc pl-5">
                  <li>
                      A <strong>new sent-back</strong> will be created with the following items:
                      <ul className="mt-1 list-disc pl-5">
                          {selectedItems.map((item) => (
                              <li key={item.name}>
                                  {item.item} - {item.quantity} {item.unit}
                              </li>
                          ))}
                      </ul>
                  </li>
              </ul>
          </div>
      );
  }

  return "No valid action details available.";
};

  return (
        <div className="flex-1 space-y-4">
            <div className="flex items-center">
                <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Approve/Send-Back</h2>
            </div>
                <ProcurementActionsHeaderCard orderData={orderData} sentBack />

                {selectionMap.size > 0 && (
                           <ActionSummary generateActionSummary={generateActionSummary} />
                      )}
            <div className='mt-6 overflow-x-auto'>
                {getFinalVendorQuotesData?.length > 0 ? (
                    <ApproveVendorQuotesPRorSBAntDTable dataSource={dataSource} selectionMap={selectionMap} setSelectionMap={setSelectionMap} />
              ) : (
                <div className="h-[10vh] flex items-center justify-center">
                  No Results.
                </div>
              )}
            </div>

        {selectionMap.size > 0 && <div className="flex justify-end gap-2 mr-2 mt-4">
                        <Button onClick={toggleSentBackDialog} variant={"outline"} className="text-red-500 border-red-500 flex items-center gap-1">
                            <SendToBack className='w-4 h-4' />
                            Send Back
                        </Button>
                        <Button onClick={toggleApproveDialog} variant={"outline"} className='text-red-500 border-red-500 flex gap-1 items-center'>
                            <ListChecks className="h-4 w-4" />
                            Approve
                        </Button>
                <AlertDialog open={sentBackDialog} onOpenChange={toggleSentBackDialog}>
                    <AlertDialogContent className="sm:max-w-[425px]">
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you Sure</AlertDialogTitle>
                            <AlertDialogDescription>
                                Add Comments and Send Back the Selected Items.
                                <div className="py-2"><label htmlFor="textarea" >Comment:</label></div>
                                <textarea
                                    id="textarea"
                                    className="w-full border rounded-lg p-2"
                                    value={comment}
                                    placeholder="type here..."
                                    onChange={(e) => setComment(e.target.value)}
                                />
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        {isLoading === "newHandleSentBack" || sendBackItemsCallLoading  ? <div className='flex items-center justify-center'><TailSpin width={80} color='red' /> </div> : (
                            <AlertDialogFooter>
                                <AlertDialogCancel onClick={toggleSentBackDialog} className="flex items-center gap-1">
                                    <Undo2 className="h-4 w-4" />
                                    Cancel
                                </AlertDialogCancel>
                                <Button onClick={newHandleSentBack} className='flex items-center gap-1'>
                                    <CheckCheck className="h-4 w-4" />
                                    Confirm
                                </Button>
                            </AlertDialogFooter>
                        )}
                    </AlertDialogContent>
                </AlertDialog>
                <AlertDialog open={approveDialog} onOpenChange={toggleApproveDialog}>
                    <AlertDialogContent className="sm:max-w-[425px]">
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you Sure</AlertDialogTitle>
                            <AlertDialogDescription>
                                Click on Confirm to Approve the Selected Items.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        {(isLoading === "newHandleApprove" || approveItemsCallLoading) ? <div className='flex items-center justify-center'><TailSpin width={80} color='red' /> </div> : (
                            <AlertDialogFooter>
                                <AlertDialogCancel onClick={toggleApproveDialog} className="flex items-center gap-1">
                                    <Undo2 className="h-4 w-4" />
                                    Cancel
                                </AlertDialogCancel>
                                <Button onClick={newHandleApprove} className='flex items-center gap-1'>
                                    <CheckCheck className="h-4 w-4" />
                                    Confirm
                                </Button>
                            </AlertDialogFooter>
                        )}
                    </AlertDialogContent>
                </AlertDialog>
            </div>}
        <h2 className="text-base pl-2 font-bold tracking-tight">Sent Back Comments</h2>
        <RenderPRorSBComments universalComment={universalComment} getUserName={getUserName} />
  </div>
  )
}

export default ApproveSBVendorQuotes;
export const Component = ApproveSBVendorQuotes