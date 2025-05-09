import { RenderPRorSBComments } from "@/components/helpers/RenderPRorSBComments";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
// import { useItemEstimate } from "@/hooks/useItemEstimate";
import { usePRorSBDelete } from "@/hooks/usePRorSBDelete";
import { NirmaanComments } from "@/types/NirmaanStack/NirmaanComments";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { ProcurementRequest, ProcurementItem } from "@/types/NirmaanStack/ProcurementRequests";
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { UserContext } from "@/utils/auth/UserProvider";
import { useFrappeGetDocList, useFrappeUpdateDoc, useFrappeGetCall } from "frappe-react-sdk";
import { ArrowBigRightDash, MessageCircleMore, Trash2 } from 'lucide-react';
import { useContext, useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams } from "react-router-dom";
import { ProcurementHeaderCard } from "../../../components/helpers/ProcurementHeaderCard";
import { Button } from "../../../components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../../../components/ui/hover-card";
import { toast } from "../../../components/ui/use-toast";
import { Projects } from "@/types/NirmaanStack/Projects";
import { HistoricalQuotesHoverCard } from "./components/HistoricalQuotesHoverCard"; // Import the hover card
import { TargetRateDetailFromAPI, FrappeTargetRateApiResponse, ApiSelectedQuotation, ApprovedQuotations, mapApiQuotesToApprovedQuotations } from '../ApproveVendorQuotes/types'; // Adjust path if needed


export const ProcurementOrder: React.FC = () => {

  const { prId: orderId } = useParams<{ prId: string }>()
  const navigate = useNavigate();

  const [orderData, setOrderData] = useState<ProcurementRequest | null>(null)

  // const { getItemEstimate } = useItemEstimate()

  const { data: procurement_request_list, isLoading: procurement_request_list_loading, mutate: prMutate } = useFrappeGetDocList<ProcurementRequest>("Procurement Requests",
    {
      fields: ["*"],
      filters: [["name", "=", orderId]],
      limit: 1000
    },
    orderId ? `Procurement Requests ${orderId}` : null
  );

  const { data: projectDoc, isLoading: projectLoading } = useFrappeGetDocList<Projects>("Projects", {
    fields: ["*"],
    filters: [["name", "=", procurement_request_list?.[0]?.project]],
    limit: 1,
  }, procurement_request_list?.[0]?.project ? `Projects ${procurement_request_list?.[0]?.project}` : null);

  // --- Fetch Target Rates using Custom API ---
  const itemIdsToFetch = useMemo(() => {
    return procurement_request_list?.[0]?.procurement_list?.list
      ?.map(item => item.name) // Assuming item.name is the item_id
      .filter(id => !!id) ?? [];
  }, [procurement_request_list]);

  const {
    data: targetRatesApiResponse,
    isLoading: targetRatesLoading,
    error: targetRatesError
  } = useFrappeGetCall<FrappeTargetRateApiResponse>(
    'nirmaan_stack.api.target_rates.get_target_rates_for_item_list.get_target_rates_for_item_list', // Replace with your actual API path
    { item_ids_json: itemIdsToFetch.length > 0 ? JSON.stringify(itemIdsToFetch) : undefined },
    itemIdsToFetch.length > 0 ? `target_rates_for_items_summary_${orderId}` : null // Unique SWR key
    // Add SWR options if needed
  );

  const targetRatesDataMap = useMemo(() => {
    const map = new Map<string, TargetRateDetailFromAPI>();
    targetRatesApiResponse?.message?.forEach(tr => {
      if (tr.item_id) {
        map.set(tr.item_id, tr);
      }
    });
    return map;
  }, [targetRatesApiResponse]);

  // Log error if target rate fetch fails
  useEffect(() => {
    if (targetRatesError) {
      console.error("Error fetching target rates in procurement-vendor:", targetRatesError);
      // Optional: Show toast notification
      // toast({ title: "Error", description: "Could not load target rates.", variant: "destructive" });
    }
  }, [targetRatesError]);

  // --- End Target Rate Fetching ---

  const categoryMakesMap = useMemo(() => {
    const map = new Map<string, string[]>();
    if (projectDoc?.[0]?.project_work_packages) {
      try {
        const workPackages = (typeof projectDoc[0].project_work_packages === "string"
          ? JSON.parse(projectDoc[0].project_work_packages)
          : projectDoc[0].project_work_packages
        )?.work_packages ?? [];

        workPackages.forEach((wp: any) => {
          (wp.category_list?.list ?? []).forEach((cat: any) => {
            const catInOrder = orderData?.category_list?.list.find(i => i.name === cat.name);
            if (cat.name && catInOrder && catInOrder?.makes?.length > 0) {
              map.set(cat.name, catInOrder?.makes);
            } else if (cat.name && cat.makes?.length > 0) {
              map.set(cat.name, cat.makes);
            }
          });
        });
      } catch (e) {
        console.error("Failed to parse project work packages for makes:", e);
      }
    }
    return map;
  }, [projectDoc, orderData]);


  const { deleteDialog, toggleDeleteDialog } = useContext(UserContext);

  const { handleDeletePR, deleteLoading } = usePRorSBDelete(prMutate);

  const { data: universalComments, isLoading: universalCommentsLoading } = useFrappeGetDocList<NirmaanComments>("Nirmaan Comments", {
    fields: ["*"],
    filters: [["reference_name", "=", orderId], ['subject', 'in', ['approving pr', 'creating pr']]],
    orderBy: { field: "creation", order: "desc" },
    limit: 1000,
  },
    orderId ? undefined : null
  )

  const { data: usersList, isLoading: usersListLoading } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
    fields: ["*"],
    limit: 1000,
  },
    `Nirmaan Users`
  )

  const getFullName = useMemo(() => (id: string | undefined) => {
    return usersList?.find((user) => user?.name == id)?.full_name || ""
  }, [usersList]);

  const { updateDoc: updateDoc, loading: update_loading } = useFrappeUpdateDoc()


  useEffect(() => {
    if (procurement_request_list && procurement_request_list.length > 0) {
      // Parse procurement_list if it's a string
      const requestData = procurement_request_list[0];
      if (typeof requestData.procurement_list === 'string') {
        try {
          requestData.procurement_list = JSON.parse(requestData.procurement_list);
        } catch (e) {
          console.error("Failed to parse procurement_list:", e);
          // Handle error appropriately, maybe set to an empty list
          requestData.procurement_list = { list: [] };
        }
      }
      // Parse category_list if it's a string
      if (typeof requestData.category_list === 'string') {
        try {
          requestData.category_list = JSON.parse(requestData.category_list);
        } catch (e) {
          console.error("Failed to parse category_list:", e);
          requestData.category_list = { list: [] };
        }
      }
      setOrderData(requestData);
    }
  }, [procurement_request_list]);


  const handleStartProcuring = async () => {
    try {

      await updateDoc("Procurement Requests", orderId, {
        workflow_state: "In Progress"
      })

      await prMutate()

      navigate(`/procurement-requests/${orderId}?tab=In Progress`);

    } catch (error) {
      console.error("Error while updating the status of PR:", error);
      toast({
        title: "Failed!",
        description: "Failed to update the status of the Procurement Request.",
        variant: "destructive"
      });
    }
  }
  // Combined loading state
  const isLoading = procurement_request_list_loading || usersListLoading || universalCommentsLoading || projectLoading || targetRatesLoading;

  if (isLoading && !orderData) return <div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>;

  if (orderData?.workflow_state !== "Approved") {
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
            <span className="italic">Approved</span> state. The current state is{" "}
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
    <>
      <div className="flex-1 space-y-4">
        <div className="space-y-2">
          <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Summary</h2>
          <ProcurementHeaderCard orderData={orderData} />
        </div>
        <div className="overflow-x-auto space-y-4 rounded-md border shadow-sm p-4">
          {/* Check if category_list exists and is an array */}
          {Array.isArray(orderData?.category_list?.list) && orderData.category_list.list.map((cat) => {
            return <div key={cat.name} className="min-w-[400px]"> {/* Added key here */}
              <Table>
                <TableHeader>
                  <TableRow className="bg-red-100">
                    <TableHead className="w-[50%]">
                      <span className="font-extrabold text-red-700">{cat.name}</span>
                      <div className="text-xs font-bold text-gray-500">
                        {categoryMakesMap.get(cat.name)?.length ? (
                          <>
                            <span>Makelist: </span>
                            {categoryMakesMap.get(cat.name)?.map((make, index, arr) => (
                              <i key={make}>{make}{index < arr.length - 1 && ", "}</i>
                            ))}
                          </>
                        ) : ""}
                      </div>
                    </TableHead>
                    <TableHead className="w-[10%] text-red-700">UOM</TableHead>
                    <TableHead className="w-[10%] text-red-700">Qty</TableHead>
                    <TableHead className="w-[20%] text-red-700">Target Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Check if procurement_list exists and is an array */}
                  {Array.isArray(orderData?.procurement_list?.list) && orderData.procurement_list.list.map((item: ProcurementItem) => { // Added type
                    if (item.category === cat.name) {
                      // const minQuote = getItemEstimate(item.name)?.averageRate
                      // --- Get Target Rate Info ---
                      const targetRateDetail = targetRatesDataMap.get(item.name); // item.name is the item_id
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
                        <TableRow key={item.item}>
                          <TableCell>
                            <div className="inline items-baseline">
                              <span>{item.item}</span>
                              {/* Conditionally display Make with specific styling */}
                              {item.make && (
                                <span className="ml-1 text-red-700 font-light text-xs">({item.make})</span>
                              )}
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
                              {/* <p><strong>make: {" "}</strong>{item?.make || "--"}</p> */}
                            </div>
                          </TableCell>
                          <TableCell>{item.unit}</TableCell>
                          <TableCell>{item.quantity}</TableCell>
                          <TableCell>
                            {/* Use HistoricalQuotesHoverCard here */}
                            <HistoricalQuotesHoverCard quotes={mappedQuotes}>
                              {targetRateValue === -1 ? "N/A" : formatToRoundedIndianRupee(targetRateValue * 0.98)}
                            </HistoricalQuotesHoverCard>
                          </TableCell>
                        </TableRow>
                      );
                    }
                    return null; // Return null if the item doesn't match the category
                  })}
                </TableBody>
              </Table>
            </div>
          })}
        </div>

        <div className="space-y-2">
          <h2 className="text-base pl-2 font-bold tracking-tight">PR Comments</h2>
          <RenderPRorSBComments universalComment={universalComments} getUserName={getFullName} />
        </div>
        <div className="flex justify-between items-end">
          <AlertDialog open={deleteDialog} onOpenChange={toggleDeleteDialog}>
            <AlertDialogTrigger asChild>
              <Button className="flex items-center gap-1">
                <Trash2 className="w-4 h-4" />
                Delete PR
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="py-8 max-sm:px-12 px-16 text-start overflow-auto">
              <AlertDialogHeader className="text-start">
                <AlertDialogTitle className="text-center">
                  Delete Procurement Request
                </AlertDialogTitle>
                <AlertDialogDescription>Are you sure you want to delete this PR?</AlertDialogDescription>
                <div className="flex gap-2 items-center pt-4 justify-center">
                  {deleteLoading ? <TailSpin color="red" width={40} height={40} /> : (
                    <>
                      <AlertDialogCancel className="flex-1" asChild>
                        <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
                      </AlertDialogCancel>
                      <Button
                        onClick={() => handleDeletePR(orderData?.name, true)}
                        className="flex-1">
                        Confirm
                      </Button>
                    </>
                  )}
                </div>

              </AlertDialogHeader>
            </AlertDialogContent>
          </AlertDialog>
          {update_loading ? <TailSpin color="red" height={30} width={30} /> : (
            <Button onClick={handleStartProcuring} className="flex items-center gap-1">
              Continue
              <ArrowBigRightDash className="max-md:h-4 max-md:w-4" />
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

export default ProcurementOrder;