import { RenderPRorSBComments } from "@/components/ui/RenderPRorSBComments";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePRorSBDelete } from "@/hooks/usePRorSBDelete";
import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations";
import { NirmaanComments } from "@/types/NirmaanStack/NirmaanComments";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import formatToIndianRupee from "@/utils/FormatPrice";
import { UserContext } from "@/utils/auth/UserProvider";
import getThreeMonthsLowestFiltered from "@/utils/getThreeMonthsLowest";
import { useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { ArrowBigRightDash, MessageCircleMore, Trash2 } from 'lucide-react';
import { useCallback, useContext, useEffect, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams } from "react-router-dom";
import { ProcurementHeaderCard } from "../../../components/ui/ProcurementHeaderCard";
import { Button } from "../../../components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../../../components/ui/hover-card";
import { toast } from "../../../components/ui/use-toast";

export const ProcurementOrder : React.FC = () => {

  const { prId: orderId } = useParams<{ prId: string }>()
  const navigate = useNavigate();

  const [orderData, setOrderData] = useState<ProcurementRequest | null>(null)

  const [comments, setComments] = useState<NirmaanComments[]>([])

  const { data: procurement_request_list, isLoading: procurement_request_list_loading, mutate: prMutate } = useFrappeGetDocList<ProcurementRequest>("Procurement Requests",
    {
      fields: ["*"],
      filters: [["name", "=", orderId]],
      limit: 1000
    },
    orderId ? `Procurement Requests ${orderId}` : null
  );


  const {deleteDialog, toggleDeleteDialog} = useContext(UserContext);
  
  const {handleDeletePR, deleteLoading} = usePRorSBDelete(prMutate);

  const { data: quote_data, isLoading : quote_data_loading } = useFrappeGetDocList<ApprovedQuotations>("Approved Quotations",
    {
      fields: ["*"],
      limit: 10000
    },
    `Approved Quotations`
  );

  const { data: universalComments, isLoading: universalCommentsLoading } = useFrappeGetDocList<NirmaanComments>("Nirmaan Comments", {
    fields: ["*"],
    filters: [["reference_name", "=", orderId]],
    orderBy: { field: "creation", order: "desc" },
    limit: 1000,
  },
  orderId ? undefined : null
  )

  const { data: usersList, isLoading: usersListLoading } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
    fields: ["*"],
    limit: 1000,
  })

  const getFullName = useCallback((id : string | undefined) => {
    return usersList?.find((user) => user?.name == id)?.full_name || ""
  }, [usersList]);

  const { updateDoc: updateDoc, loading: update_loading } = useFrappeUpdateDoc()


  useEffect(() => {
    if (procurement_request_list) {
      setOrderData(procurement_request_list[0])
    }
  }, [procurement_request_list])

  useEffect(() => {
    if (universalComments) {
      const comments = universalComments?.filter((cmt) => ["approving pr", "creating pr"].includes(cmt.subject || ""))
      setComments(comments)
    }
  }, [universalComments])


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

  if (procurement_request_list_loading || usersListLoading || quote_data_loading || universalCommentsLoading) return <div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>

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
              {orderData?.category_list.list.map((cat) => {
                return <div className="min-w-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-red-100">
                        <TableHead className="w-[50%]">
                          <span className="font-extrabold text-red-700">{cat.name}</span>
                          <div className="text-xs font-bold text-gray-500">
                            {cat?.makes?.length > 0 ? (
                              cat?.makes?.map((i, index : number, arr : any[]) => (
                                <i>{i}{index < arr.length - 1 && ", "}</i>
                              ))
                            ) : "--"}
                          </div>
                        </TableHead>
                        <TableHead className="w-[20%] text-red-700">UOM</TableHead>
                        <TableHead className="w-[10%] text-red-700">Qty</TableHead>
                        <TableHead className="w-[10%] text-red-700">Est. Amt</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderData?.procurement_list.list.map((item: any) => {
                        if (item.category === cat.name) {
                          const minQuote = getThreeMonthsLowestFiltered(quote_data, item.name)
                          return (
                            <TableRow key={item.item}>
                              <TableCell>
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
                              <TableCell>{minQuote ? formatToIndianRupee(minQuote * item.quantity) : "N/A"}</TableCell>
                            </TableRow>
                          )
                        }
                      })}
                    </TableBody>
                  </Table>
                </div>
              })}
          </div>

          <div className="space-y-2">
            <h2 className="text-base pl-2 font-bold tracking-tight">PR Comments</h2>
            <RenderPRorSBComments  universalComment={comments} getUserName={getFullName} />
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