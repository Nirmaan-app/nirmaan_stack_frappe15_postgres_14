import { CategoryData, CategoryWithChildren, columns, DataItem, innerColumns } from "@/components/procurement/VendorsSelectionSummary";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from "@/components/ui/button";
import { ProcurementActionsHeaderCard } from "@/components/ui/ProcurementActionsHeaderCard";
import { useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations";
import { NirmaanComments } from "@/types/NirmaanStack/NirmaanComments";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { ProcurementItem, ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { ConfigProvider, Table, TableProps } from "antd";
import { useFrappeGetDoc, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { CheckCheck, ListChecks, SendToBack, Undo2 } from "lucide-react";
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
      <ApproveRejectVendorQuotesPage vendor_list={vendor_list} pr_data={pr} pr_mutate = {pr_mutate} quotes_data={quotes_data} />
    )
}

type ApproveRejectVendorQuotesPageProps = {
  pr_data: any
  pr_mutate?: any
  vendor_list?: Vendors[]
  quotes_data?: ApprovedQuotations[]
}

export const ApproveRejectVendorQuotesPage : React.FC<ApproveRejectVendorQuotesPageProps> = ({pr_data, pr_mutate, vendor_list, quotes_data}) => {

  const {call, loading : callLoading} = useFrappePostCall("nirmaan_stack.api.approve_vendor_quotes.generate_pos_from_selection")

  const navigate = useNavigate()

  const { toast } = useToast();
  const userData = useUserData()
  const [isLoading, setIsLoading] = useState<string | null>(null);
  const [comment, setComment] = useState<string>("")

  const [orderData, setOrderData] = useState<ProcurementRequest | undefined>()

  const [sentBackDialog, setSentBackDialog] = useState<boolean>(false)

  const [approveDialog, setApproveDialog] = useState<boolean>(false)

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

  interface SelectionState {
    selectedItems: React.Key[];
    selectedCategories: React.Key[];
  }
  

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

  const [selection, setSelection] = useState<SelectionState>({
    selectedItems: [],
    selectedCategories: []
  });

  // Derived state
  const allItemKeys = useMemo(() => 
    dataSource.flatMap(category => category.items.map(item => item.name)),
    [dataSource]
  );

  const parentRowSelection: TableProps<any>['rowSelection'] = {
    selectedRowKeys: selection.selectedCategories,
    onChange: (selectedCategoryKeys, selectedCategories) => {
      const newSelectedItems = new Set(selection.selectedItems);

      selectedCategories.forEach(category => {
        category.items.forEach(item => newSelectedItems.add(item.name));
      });

      dataSource?.forEach(category => {
        if (!selectedCategoryKeys.includes(category.key)) {
          category.items.forEach(item => newSelectedItems.delete(item.name));
        }
      });

      setSelection({
        selectedItems: Array.from(newSelectedItems),
        selectedCategories: selectedCategoryKeys,
      });
    },
    onSelectAll: (selected) => {
      if (selected) {
        setSelection({
          selectedItems: allItemKeys,
          selectedCategories: dataSource?.map(c => c.key) || [],
        });
      } else {
        setSelection({ selectedItems: [], selectedCategories: [] });
      }
    },
    getCheckboxProps: (record) => ({
      indeterminate: record.items.some(item => selection.selectedItems.includes(item.name)) && !selection.selectedCategories.includes(record.key),
    }),
  };

  const getChildRowSelection = (category: CategoryData): TableProps<DataItem>['rowSelection'] => ({
    selectedRowKeys: selection.selectedItems,
    onChange: (selectedItemKeys) => {
      const categoryItems = category.items.map(item => item.name);
      const newSelectedItems = selection.selectedItems.filter(key => !categoryItems.includes(key)).concat(selectedItemKeys);

      const allCategorySelected = selectedItemKeys.length === category.items.length;
      const noCategorySelected = selectedItemKeys.length === 0;

      setSelection(prev => ({
        selectedItems: newSelectedItems,
        selectedCategories: allCategorySelected
          ? [...prev.selectedCategories, category.key]
          : prev.selectedCategories.filter(k => k !== category.key && !noCategorySelected),
      }));
    },
    hideSelectAll: true, // Remove checkbox from inner table header.
  });

  const newHandleApprove = async () => {
    try {
        setIsLoading("newHandleApprove");

        const selectedItemNames = selection.selectedItems; 
        const vendorMap : {[itemName: string]: string} = {};
        dataSource.forEach(category => {
            category.items.forEach(item => {
                if (selectedItemNames.includes(item.name)) {
                    vendorMap[item.name] = item.vendor;
                }
            });
        });

        const response = await call({
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

            await pr_mutate();

            if(orderData?.procurement_list.list.length === selectedItemNames.length){
              navigate('/approve-po');
            }

            setApproveDialog(false)
        } else if (response.message.status === 400) {
            toast({
                title: "Failed!",
                description: "Error whle approving vendor quotes",
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

      const selectedItemNames = selection.selectedItems;

      const response = await call({
          project_id: orderData?.project,
          pr_name: orderData?.name,
          selected_items: selectedItemNames,
          comments: comment, // Assuming 'comment' is your comment state variable
      });

      if (response.message.status === 200) {
          toast({
              title: "Success!",
              description: "Successfully Rejected selected items",
              variant: "success",
          });

          await pr_mutate();

          if (orderData?.procurement_list?.list?.length === selectedItemNames.length) {
              navigate('/approve-po');
          }

          setSentBackDialog(false);
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

  return (
        <div>
            <div className="flex items-center">
                <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Approve/Send-Back</h2>
            </div>
          <ProcurementActionsHeaderCard orderData={orderData} po={true} />
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

    {selection.selectedItems?.length > 0 && <div className="flex justify-end gap-2 mr-2 mt-4">
                        <Button onClick={() => setSentBackDialog(true)} variant={"outline"} className="text-red-500 border-red-500 flex items-center gap-1">
                            <SendToBack className='w-4 h-4' />
                            Send Back
                        </Button>
                        <Button onClick={() => setApproveDialog(true)} variant={"outline"} className='text-red-500 border-red-500 flex gap-1 items-center'>
                            <ListChecks className="h-4 w-4" />
                            Approve
                        </Button>
                <AlertDialog open={sentBackDialog} onOpenChange={(prev) =>  setSentBackDialog(!prev)}>
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
                        {isLoading === "newHandleSentBack" ? <div className='flex items-center justify-center'><TailSpin width={80} color='red' /> </div> : (
                            <AlertDialogFooter>
                                <AlertDialogCancel onClick={() => setSentBackDialog(false)} className="flex items-center gap-1">
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
                <AlertDialog open={approveDialog} onOpenChange={(prev) =>  setApproveDialog(!prev)}>
                    <AlertDialogContent className="sm:max-w-[425px]">
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you Sure</AlertDialogTitle>
                            <AlertDialogDescription>
                                Click on Confirm to Approve the Selected Items.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        {isLoading === "newHandleApprove" ? <div className='flex items-center justify-center'><TailSpin width={80} color='red' /> </div> : (
                            <AlertDialogFooter>
                                <AlertDialogCancel onClick={() => setApproveDialog(false)} className="flex items-center gap-1">
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
  </div>
  )
}

export const Component = ApproveRejectVendorQuotes