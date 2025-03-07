import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ProcurementActionsHeaderCard } from "@/components/ui/ProcurementActionsHeaderCard";
import { Table as ReactTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { CategoryData, CategoryWithChildren, columns, DataItem, innerColumns } from "@/pages/ProcurementRequests/VendorQuotesSelection/VendorsSelectionSummary";
import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations";
import { NirmaanComments } from "@/types/NirmaanStack/NirmaanComments";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { ProcurementItem, ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { ConfigProvider, Table, TableProps } from "antd";
import { useFrappeGetDoc, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { BookOpenText, CheckCheck, ListChecks, SendToBack, Undo2 } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { TailSpin } from 'react-loader-spinner';
import { useNavigate, useParams } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";

export const ApproveRejectVendorQuotes : React.FC = () => {

    const { prId } = useParams<{ prId: string }>()
    const { data: pr, isLoading: pr_loading, error: pr_error, mutate: pr_mutate } = useFrappeGetDoc("Procurement Requests", prId);

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
        filters: [["reference_name", "=", pr?.name], ["subject", "=", "pr vendors selected"]]
    },
    pr ? undefined : null
  )

  const { data: quotes_data, isLoading: quotesLoading, error: quotesError } = useFrappeGetDocList<ApprovedQuotations>("Approved Quotations",
        {
            fields: ['*'],
            limit: 100000
        });

    const navigate = useNavigate()

    const getUserName = (id : string | undefined) => {
        if (usersList) {
            return usersList.find((user) => user?.name === id)?.full_name
        }
    }

    // console.log("within 1st component", owner_data)
    if (pr_loading || usersListLoading || vendor_list_loading || universalCommentLoading || quotesLoading) return <div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>
    if (pr_error || usersListError || universalCommentError || vendor_list_error || quotesError) return <h1>Error</h1>

    if (!["Vendor Selected", "Partially Approved"].includes(pr?.workflow_state || "") && !pr?.procurement_list?.list?.some((i) => i?.status === "Pending")) return (
        <div className="flex items-center justify-center h-[90vh]">
            <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
                <h2 className="text-2xl font-semibold text-gray-800">
                    Heads Up!
                </h2>
                <p className="text-gray-600 text-lg">
                    Hey there, the PR:{" "}
                    <span className="font-medium text-gray-900">{pr?.name}</span>{" "}
                    is no longer available for{" "}
                    <span className="italic">Reviewing</span>. The current state is{" "}
                    <span className="font-semibold text-blue-600">
                        {pr?.workflow_state}
                    </span>{" "}
                    And the last modification was done by <span className="font-medium text-gray-900">
                        {pr?.modified_by === "Administrator" ? pr?.modified_by : getUserName(pr?.modified_by)}
                    </span>
                    !
                </p>
                <button
                    className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors duration-300"
                    onClick={() => navigate("/approve-po")}
                >
                    Go Back
                </button>
            </div>
        </div>
    );
    return (
      <ApproveRejectVendorQuotesPage vendor_list={vendor_list} pr_data={pr} pr_mutate = {pr_mutate} quotes_data={quotes_data} universalComment={universalComment} getUserName={getUserName} />
    )
}

type ApproveRejectVendorQuotesPageProps = {
  pr_data: any
  pr_mutate?: any
  vendor_list?: Vendors[]
  quotes_data?: ApprovedQuotations[]
  universalComment? :  NirmaanComments[]
  getUserName?: (id : string | undefined) => string | undefined
}

export const ApproveRejectVendorQuotesPage : React.FC<ApproveRejectVendorQuotesPageProps> = ({pr_data, pr_mutate, vendor_list, quotes_data, universalComment, getUserName}) => {

  const {call : approveItemsCall, loading : approveItemsCallLoading} = useFrappePostCall("nirmaan_stack.api.approve_vendor_quotes.generate_pos_from_selection")

  const {call : sendBackItemsCall, loading : sendBackItemsCallLoading} = useFrappePostCall("nirmaan_stack.api.reject_vendor_quotes.send_back_items")

  const navigate = useNavigate()

  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState<string | null>(null);
  const [comment, setComment] = useState<string>("")

  const [orderData, setOrderData] = useState<ProcurementRequest | undefined>()

  const [sentBackDialog, setSentBackDialog] = useState<boolean>(false)

  const toggleSentBackDialog = () => setSentBackDialog(!sentBackDialog);

  const [approveDialog, setApproveDialog] = useState<boolean>(false)

  const toggleApproveDialog = () => setApproveDialog(!approveDialog);


  useEffect(() => {
     const newOrderData = pr_data;
     const newCategories: { name: string, makes : string[] }[] = [];
     const newList: ProcurementItem[] = [];
     JSON.parse(newOrderData?.procurement_list)?.list?.forEach((item) => {
         if (item.status === "Pending") newList.push(item);
         if (!newCategories.some(category => category.name === item.category)) {
             newCategories.push({ name: item.category, makes : [] });
         }
     });

     const rfq_data = JSON.parse(newOrderData?.rfq_data);

     // Update orderData with computed lists
     setOrderData(() => ({
         ...newOrderData,
         procurement_list: {
             list: newList
         },
         category_list: {
             list: newCategories
         },
         rfq_data: rfq_data
     }));
  }, [pr_data])

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

  if(!orderData?.procurement_list?.list?.length) return totals
    orderData?.procurement_list?.list?.forEach(item => {
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
      if(orderData?.procurement_list.list?.length) {
        const procurementList = orderData.procurement_list.list
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

  const parentRowSelection: TableProps<any>['rowSelection'] = {
    selectedRowKeys: Array.from(selectionMap.keys()).filter(key => selectionMap.get(key)?.all),
    onChange: (selectedCategoryKeys) => {
        setSelectionMap(prevMap => {
            const newMap = new Map(prevMap);
            const selectedKeysSet = new Set(selectedCategoryKeys);

            dataSource.forEach(category => {
                const categoryKey = category.key;
                const categoryItems = new Set(category.items.map(item => item.name));

                if (selectedKeysSet.has(categoryKey)) {
                    // Category selected
                    newMap.set(categoryKey, { all: true, items: categoryItems });
                } else {
                    // Category deselected
                    if (newMap.has(categoryKey) && newMap.get(categoryKey).all) {
                        // If it was all selected, remove it completely
                        newMap.delete(categoryKey);
                    }
                    // If some items were selected, it should stay.
                }
            });

            return newMap;
        });
    },
    onSelectAll: (selected) => {
      setSelectionMap(prevMap => {
          const newMap = new Map(prevMap);

          if (selected) {
              dataSource.forEach(category => {
                  const categoryKey = category.key;
                  const categoryItems = new Set(category.items.map(item => item.name));
                  newMap.set(categoryKey, { all: true, items: categoryItems });
              });
          } else {
              newMap.clear();
          }

          return newMap;
      });
  },
    getCheckboxProps: (record) => ({
        indeterminate: selectionMap.has(record.key) && !selectionMap.get(record.key)?.all,
    }),
};


const getChildRowSelection = (category: CategoryData): TableProps<DataItem>['rowSelection'] => ({
  selectedRowKeys: Array.from(selectionMap.get(category.key)?.items || new Set()),
  onChange: (selectedItemKeys) => {
      setSelectionMap(prevMap => {
          const newMap = new Map(prevMap);
          const categoryItems = new Set(category.items.map(item => item.name));
          const selectedItems = new Set(selectedItemKeys);

          const allSelected = selectedItems.size === categoryItems.size;
          const noneSelected = selectedItems.size === 0;

          if (allSelected) {
              newMap.set(category.key, { all: true, items: categoryItems });
          } else if (noneSelected) {
              newMap.delete(category.key);
          } else {
              newMap.set(category.key, { all: false, items: selectedItems });
          }

          return newMap;
      });
  },
  hideSelectAll: true,
});

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
          pr_name: orderData?.name,
          selected_items: selectedItemNames,
          selected_vendors: vendorMap,
      });

      if (response.message.status === 200) {
          toast({
              title: "Success!",
              description: "Successfully approved selected items",
              variant: "success",
          });

          setSelectionMap(new Map());
          await pr_mutate();
          if (orderData?.procurement_list.list.length === selectedItemNames.length) {
              navigate('/approve-po');
          }
          toggleApproveDialog();
      } else if (response.message.status === 400) {
          toast({
              title: "Failed!",
              description: "Error while approving vendor quotes",
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
          project_id: orderData?.project,
          pr_name: orderData?.name,
          selected_items: selectedItemNames,
          comments: comment,
      });

      if (response.message.status === 200) {
          toast({
              title: "Success!",
              description: "Successfully Rejected selected items",
              variant: "success",
          });

          setSelectionMap(new Map());
          await pr_mutate();

          if (orderData?.procurement_list?.list?.length === selectedItemNames.length) {
              navigate('/approve-po');
          }

          toggleSentBackDialog();
      } else if (response.message.status === 400) {
          toast({
              title: "Failed!",
              description: "Error while sending back items",
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
                      A <strong>new rejected type sent-back</strong> will be created with the following items:
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
          <ProcurementActionsHeaderCard orderData={orderData} po={true} />

                {selectionMap.size > 0 && (
                          <div className="bg-white shadow-md rounded-lg p-4 border border-gray-200">
                              <h2 className="text-lg font-bold mb-3 flex items-center">
                                  <BookOpenText className="h-5 w-5 text-blue-500 mr-2" />
                                  Actions Summary
                              </h2>
                              <div className="grid md:grid-cols-2 gap-4">
                                  {/* Send Back Action Summary */}
                                  <div className="p-3 border border-gray-300 rounded-lg bg-gray-50">
                                      <div className="flex items-center mb-2">
                                          <SendToBack className="h-5 w-5 text-red-500 mr-2" />
                                          <h3 className="font-medium text-gray-700">Send Back</h3>
                                      </div>
                                      <p className="text-sm text-gray-600">{generateActionSummary("sendBack")}</p>
                                  </div>
          
                                  {/* Approve Action Summary */}
                                  <div className="p-3 border border-gray-300 rounded-lg bg-gray-50">
                                      <div className="flex items-center mb-2">
                                          <ListChecks className="h-5 w-5 text-green-500 mr-2" />
                                          <h3 className="font-medium text-gray-700">Approve</h3>
                                      </div>
                                      <p className="text-sm text-gray-600">{generateActionSummary("approve")}</p>
                                  </div>
                              </div>
                          </div>
                      )}
    <div className='mt-6 overflow-x-auto'>
              {getFinalVendorQuotesData?.length > 0 ? (
        <div className="overflow-x-auto">
          <ConfigProvider
          
          >
            <Table
              dataSource={dataSource}
              rowClassName={(record) => !record?.totalAmount ? "bg-red-100" : ""}
              columns={columns}
              rowSelection={parentRowSelection}
              pagination={false}
              expandable={{
                defaultExpandAllRows : true,
                expandedRowRender: (record) => (
                  <Table
                    rowSelection={getChildRowSelection(record)}
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
        <div className="flex items-center space-y-2">
                        <h2 className="text-base pl-2 font-bold tracking-tight">Procurement Comments</h2>
                    </div>
                    <div className="border border-gray-200 rounded-lg p-4 flex flex-col gap-2 mb-2">
                        {universalComment?.length !== 0 ? (
                            universalComment?.map((comment) => (
                                <div key={comment?.name} className="flex items-start space-x-4 bg-gray-50 p-4 rounded-lg">
                                    <Avatar>
                                        <AvatarImage src={`https://api.dicebear.com/6.x/initials/svg?seed=${comment?.comment_by}`} />
                                        <AvatarFallback>{comment?.comment_by?.[0]}</AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1">
                                        <p className="font-medium text-sm text-gray-900">{comment?.content}</p>
                                        <div className="flex justify-between items-center mt-2">
                                            <p className="text-sm text-gray-500">
                                                {comment?.comment_by === "Administrator" ? "Administrator" : getUserName(comment?.comment_by)}
                                            </p>
                                            <p className="text-xs text-gray-400">
                                                {formatDate(comment?.creation?.split(" ")[0])} {comment?.creation?.split(" ")[1].substring(0, 5)}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <span className="text-xs font-semibold">No Comments Found</span>
                        )}
                    </div>
                    <div className="flex items-center py-4">
                        <h2 className="text-base pl-6 font-bold tracking-tight">Delayed Items</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <div className="min-w-full inline-block align-middle">
                            {/* Group items by category */}
                            {(() => {
                                const delayedItems = JSON.parse(pr_data?.procurement_list)?.list.filter((item : ProcurementItem) => item.status === "Delayed");
                                const groupedByCategory = delayedItems.reduce((acc, item) => {
                                    if (!acc[item.category]) {
                                        acc[item.category] = [];
                                    }
                                    acc[item.category].push(item);
                                    return acc;
                                }, {});

                                if(delayedItems?.length === 0) return <div
                                className="flex items-center justify-center font-semibold text-gray-500 text-sm"
                                >No Delayed Items</div>
        
                                return Object.keys(groupedByCategory).map(category => (
                                    <div key={category} className="p-5">
                                        <ReactTable>
                                            <TableHeader>
                                                <TableRow className="bg-red-100">
                                                    <TableHead className="w-[60%]">
                                                        <span className="text-red-700 pr-1 font-extrabold">{category}</span>
                                                    </TableHead>
                                                    <TableHead className="w-[25%]">UOM</TableHead>
                                                    <TableHead className="w-[15%]">Qty</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {groupedByCategory[category].map(item => (
                                                    <TableRow key={item.item}>
                                                        <TableCell>{item.item}</TableCell>
                                                        <TableCell>{item.unit}</TableCell>
                                                        <TableCell>{item.quantity}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </ReactTable>
                                    </div>
                                ));
                            })()}
                        </div>
                    </div>
  </div>
  )
}

export const Component = ApproveRejectVendorQuotes