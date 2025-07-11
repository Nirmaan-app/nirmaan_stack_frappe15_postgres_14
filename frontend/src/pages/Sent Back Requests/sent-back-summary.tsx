import { RenderPRorSBComments } from "@/components/helpers/RenderPRorSBComments";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { usePRorSBDelete } from "@/hooks/usePRorSBDelete";
import { NirmaanComments } from "@/types/NirmaanStack/NirmaanComments";
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory";
import { UserContext } from "@/utils/auth/UserProvider";
import { useFrappeDocumentEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { ArrowBigRightDash, MessageCircleMore, Trash2 } from "lucide-react";
import { useContext, useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams } from "react-router-dom";
import { ProcurementHeaderCard } from "../../components/helpers/ProcurementHeaderCard";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../../components/ui/hover-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { toast } from "@/components/ui/use-toast";
import { useUsersList } from "../ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { useSentBackCategory } from "@/hooks/useSentBackCategory";

export const SentBackSummary = () => {

    const { sbId: id } = useParams<{ sbId: string }>()
    const navigate = useNavigate();

    if (!id) return <div>No Sent Back Provided</div>

    const { data: sent_back, isLoading: sent_back_loading, mutate: sent_back_mutate } = useSentBackCategory(id)

    useFrappeDocumentEventListener("Sent Back Category", id, (event) => {
        console.log("Sent Back document updated (real-time):", event);
        toast({
            title: "Document Updated",
            description: `Sent Back ${event.name} has been modified.`,
        });
        sent_back_mutate(); // Re-fetch this specific document
      },
      true // emitOpenCloseEventsOnMount (default)
      )

    const { deleteDialog, toggleDeleteDialog } = useContext(UserContext);

    const { handleDeleteSB, deleteLoading } = usePRorSBDelete(sent_back_mutate);

    const { data: universalComments, isLoading: universalCommentsLoading } = useFrappeGetDocList<NirmaanComments>("Nirmaan Comments", {
        fields: ["name", "comment_by", "content", "creation", "reference_name"],
        filters: [["reference_name", "=", id]],
        orderBy: { field: "creation", order: "desc" }
    },
        id ? undefined : null
    )

    const {data: usersList, isLoading: usersListLoading} = useUsersList()

    const getFullName = useMemo(() => (id: string | undefined) => {
        return usersList?.find((user) => user.name == id)?.full_name || ""
    }, [usersList])

    const [orderData, setOrderData] = useState<SentBackCategory | undefined>()

    useEffect(() => {
        if (sent_back) {
            setOrderData(sent_back)
        }
    }, [sent_back]);

    if (sent_back_loading || usersListLoading || universalCommentsLoading) return <LoadingFallback />

    if (orderData?.workflow_state !== "Pending") {
        return (
            <div className="flex items-center justify-center h-[90vh]">
                <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
                    <h2 className="text-2xl font-semibold text-gray-800">
                        Heads Up!
                    </h2>
                    <p className="text-gray-600 text-lg">
                        Hey there, the SB:{" "}
                        <span className="font-medium text-gray-900">{orderData?.name}</span>{" "}
                        is no longer available in the{" "}
                        <span className="italic">Pending</span> state. The current state is{" "}
                        <span className="font-semibold text-blue-600">
                            {orderData?.workflow_state}
                        </span>{" "}
                        And the last modification was done by <span className="font-medium text-gray-900">
                            {orderData?.modified_by === "Administrator" ? "Administrator" : getFullName(orderData?.modified_by || "")}
                        </span>
                        !
                    </p>
                    <button
                        className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors duration-300"
                        onClick={() => navigate(-1)}
                    >
                        Go Back
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center">
                    {/* <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} /> */}
                    <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Summary</h2>
                </div>
                <Badge variant={orderData?.type === "Rejected" ? "destructive" : orderData?.type === "Delayed" ? "orange" : "gray"}>{orderData?.type}</Badge>
            </div>
            <ProcurementHeaderCard orderData={orderData} sentBack />
            <div className="pt-5 text-red-700 font-light text-base underline">{orderData?.type} Items</div>
            <div className="overflow-x-auto">
                <Table className="min-w-full divide-gray-200">
                    <TableHeader className="bg-red-100">
                        <TableRow>
                            <TableHead className="w-[60%]">Items</TableHead>
                            <TableHead className="w-[10%]">UOM</TableHead>
                            <TableHead className="w-[10%]">Quantity</TableHead>
                            {/* <TableHead className="w-[10%]">Rate</TableHead>
                                    <TableHead className="w-[10%]">Amount</TableHead> */}
                        </TableRow>
                    </TableHeader>
                    <TableBody className="bg-white divide-y divide-gray-200">
                        {orderData?.order_list.map(item => (
                            <TableRow key={item.name}>
                                <TableCell>
                                    <div className="inline items-baseline">
                                        <span>{item.item_name}</span>
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
                                    </div>
                                </TableCell>
                                <TableCell>{item.unit}</TableCell>
                                <TableCell>{item.quantity}</TableCell>
                                {/* <TableCell>{item.quote}</TableCell>
                                        <TableCell>{item.quote * item.quantity}</TableCell> */}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
            <div className="space-y-2">
                <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Sent Back Comments</h2>
                <RenderPRorSBComments universalComment={universalComments} getUserName={getFullName} />
            </div>
            <div className="flex justify-between items-end">
                <AlertDialog open={deleteDialog} onOpenChange={toggleDeleteDialog}>
                    <AlertDialogTrigger asChild>
                        <Button className="flex items-center gap-1">
                            <Trash2 className="w-4 h-4" />
                            Delete
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="py-8 max-sm:px-12 px-16 text-start overflow-auto">
                        <AlertDialogHeader className="text-start">
                            <AlertDialogTitle className="text-center">
                                Delete Sent Back PR
                            </AlertDialogTitle>
                            <AlertDialogDescription>Are you sure you want to delete this Sent Back PR?</AlertDialogDescription>
                            <div className="flex gap-2 items-center pt-4 justify-center">
                                {deleteLoading ? <TailSpin color="red" width={40} height={40} /> : (
                                    <>
                                        <AlertDialogCancel className="flex-1" asChild>
                                            <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
                                        </AlertDialogCancel>
                                        <Button
                                            onClick={() => handleDeleteSB(orderData?.name, true)}
                                            className="flex-1">
                                            Confirm
                                        </Button>
                                    </>
                                )}
                            </div>

                        </AlertDialogHeader>
                    </AlertDialogContent>
                </AlertDialog>
                <Button onClick={() => navigate(`/sent-back-requests/${id}?mode=edit`)} className="flex items-center gap-1">
                    Next
                    <ArrowBigRightDash className="max-md:w-4 max-md:h-4" />
                </Button>
            </div>
        </div>
    )
}

export default SentBackSummary;