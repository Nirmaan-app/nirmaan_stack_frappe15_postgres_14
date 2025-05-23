import { ProcurementActionsHeaderCard } from "@/components/helpers/ProcurementActionsHeaderCard";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast, useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { NirmaanComments } from "@/types/NirmaanStack/NirmaanComments";
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers";
import { NirmaanVersions as NirmaanVersionsType } from "@/types/NirmaanStack/NirmaanVersions";
import { formatDate } from "@/utils/FormatDate";
import TextArea from "antd/es/input/TextArea";
import { useFrappeCreateDoc, useFrappeDocumentEventListener, useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { CheckCheck, Undo2, X } from 'lucide-react';
import { useEffect, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams } from "react-router-dom";

const ApproveAmendPO = () => {

    const { id: po } = useParams<{ id: string }>()

    if(!po) return <div>No PO ID Provided</div>
    const orderId = po?.replaceAll("&=", "/")

    const { data: po_data, isLoading: po_loading, error: po_error, mutate: po_mutate } = useFrappeGetDoc("Procurement Orders", orderId, `Procurement Orders ${orderId}`);

    useFrappeDocumentEventListener("Procurement Orders", orderId, (event) => {
          console.log("Procurement Orders document updated (real-time):", event);
          toast({
              title: "Document Updated",
              description: `Procurement Order ${event.name} has been modified.`,
          });
          po_mutate(); // Re-fetch this specific document
        },
        true // emitOpenCloseEventsOnMount (default)
        )

    const { data: usersList, isLoading: usersListLoading, error: usersListError } = useUsersList();

    const { data: versions, isLoading: versionsLoading, error: versionsError } = useFrappeGetDocList<NirmaanVersionsType>("Nirmaan Versions", {
        fields: ["*"],
        filters: [["ref_doctype", "=", "Procurement Orders"], ["docname", "=", orderId]],
        limit: 1000,
        orderBy: { field: "creation", order: "desc" }
    })

    const navigate = useNavigate()

    const getUserName = (id : string | undefined) => {
        return usersList?.find((user) => user?.name === id)?.full_name || ""
    }

    // console.log("within 1st component", owner_data)
    if (po_loading || usersListLoading || versionsLoading) return <LoadingFallback />
    
    if (po_error || usersListError || versionsError) return <AlertDestructive error={po_error || usersListError || versionsError} />

    if (po_data?.status !== "PO Amendment") return (
        <div className="flex items-center justify-center h-[90vh]">
            <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
                <h2 className="text-2xl font-semibold text-gray-800">
                    Heads Up!
                </h2>
                <p className="text-gray-600 text-lg">
                    Hey there, the Purchase Order:{" "}
                    <span className="font-medium text-gray-900">{po_data?.name}</span>{" "}
                    is no longer available for{" "}
                    <span className="italic">Amending</span>. The current state is{" "}
                    <span className="font-semibold text-blue-600">
                        {po_data?.status}
                    </span>{" "}
                    And the last modification was done by <span className="font-medium text-gray-900">
                        {po_data?.modified_by === "Administrator" ? po_data?.modified_by : getUserName(po_data?.modified_by)}
                    </span>
                    !
                </p>
                <button
                    className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors duration-300"
                    onClick={() => navigate("/purchase-orders?tab=Approve Amended PO")}
                >
                    Go Back
                </button>
            </div>
        </div>
    );
    return (
        <ApproveAmendPOPage po_data={po_data} versionsData={versions} usersList={usersList} />
    )
}

interface ApproveAmendPOPageProps {
    po_data: any
    versionsData?: NirmaanVersionsType[]
    usersList?: NirmaanUsersType[]
}


const ApproveAmendPOPage = ({ po_data, versionsData, usersList }: ApproveAmendPOPageProps) => {

    const navigate = useNavigate()
    const userData = useUserData()

    const getUserName = (name : string | undefined) => {
        if (usersList) {
            return usersList?.find((user) => user?.name === name)?.full_name
        }
    }

    const { data: amendmentComment } = useFrappeGetDocList<NirmaanComments>("Nirmaan Comments", {
        fields: ["*"],
        filters: [["reference_name", "=", po_data?.name], ["subject", "=", "updating po(amendment)"]]
    })

    // console.log("amendmentComment", amendmentComment)

    const [previousOrderList, setPreviousOrderList] = useState<any[]>([])
    const [amendedOrderList, setAmendedOrderList] = useState<any[]>([])
    const [comment, setComment] = useState('');
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [actionType, setActionType] = useState<'approve' | 'revert'>('approve');

    useEffect(() => {
        if (versionsData) {
            const orderChange = versionsData[0];

            if (orderChange) {
                // Parse the 'data' field from the orderChange object
                const parsedData = JSON.parse(orderChange.data);
                const { changed } = parsedData;

                // Find the change related to 'order_list'
                const orderListChange = changed.find((item) => item[0] === 'order_list');

                if (orderListChange) {
                    // Access the original and amended lists
                    const originalOrderList = orderListChange?.[1]?.list || [];
                    const amendedOrderList = orderListChange?.[2]?.list || [];

                    // Set the state for previous and amended lists
                    setPreviousOrderList(originalOrderList);
                    setAmendedOrderList(amendedOrderList);
                }
            }
        }
    }, [versionsData]);


    // console.log("comment", comment)

    const { updateDoc, loading: update_loading } = useFrappeUpdateDoc()
    const { createDoc, loading: create_loading } = useFrappeCreateDoc()

    const { toast } = useToast();

    const handleAction = async () => {
        try {
            if (actionType === 'approve') {
                await updateDoc("Procurement Orders", po_data.name, {
                    status: "PO Approved"
                })
                if (comment.length) {
                    await createDoc("Nirmaan Comments", {
                        comment_type: "Comment",
                        reference_doctype: "Procurement Orders",
                        reference_name: po_data.name,
                        comment_by: userData?.user_id,
                        content: comment,
                        subject: "approving po(amendment)"
                    })
                }
            } else {
                await updateDoc("Procurement Orders", po_data?.name, {
                    status: "PO Approved",
                    order_list: { list: previousOrderList }
                })
                if (comment.length) {
                    await createDoc("Nirmaan Comments", {
                        comment_type: "Comment",
                        reference_doctype: "Procurement Orders",
                        reference_name: po_data.name,
                        comment_by: userData?.user_id,
                        content: comment,
                        subject: "reverting po(amendment)"
                    })
                }
            }
            toast({
                title: "Success",
                description: `PO has been successfully ${actionType === 'approve' ? 'approved' : 'reverted'}`,
                variant: "success"
            });
            setIsDialogOpen(false);
            navigate("/purchase-orders?tab=Approve Amended PO")
        } catch (error) {
            console.log("error in ApproveAmmendPage", error)
            toast({
                title: "Error",
                description: "An error occurred. Please try again.",
                variant: "destructive"
            });
        }
    };

    const renderCell = (label: string, value: string | number, isChanged: boolean, type : string) => (
        <div className={`py-1 ${isChanged ? (type === "previous" ? 'bg-yellow-100 dark:bg-yellow-900' : 'bg-green-100 dark:bg-green-900') : ''}`}>
            <span className="font-medium">{label}:</span> {value}
        </div>
    )

    return (
        <div className="flex-1 space-y-4">
            {/* PO Details Card */}
            <div className="space-y-2">
                <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Approve/Revert Amendments</h2>
                <ProcurementActionsHeaderCard orderData={po_data} amend={true} />
            </div>

            {/* Item Comparison Table */}
            <Card className="mt-4 p-4 shadow-lg overflow-hidden">
                <Table>
                    <TableHeader className="bg-red-100 sticky top-0">
                        <TableRow>
                            <TableHead className="w-1/3">Item</TableHead>
                            <TableHead className="w-1/3">Original</TableHead>
                            <TableHead className="w-1/3">Amended</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {previousOrderList?.map((item, index) => {
                            const amendedItem = amendedOrderList?.find(i => i.name === item.name);
                            return (
                                <TableRow key={index}>
                                    {/* Item Name */}
                                    <TableCell className="font-bold">{item.item}</TableCell>
                                    {/* Original Details */}
                                    <TableCell className={`${!amendedItem ? "bg-yellow-100 dark:bg-yellow-900" : ""}`}>
                                        <div className="space-y-1 text-sm">
                                            {renderCell("Quote", item.quote, !amendedItem ? false : item.quote !== amendedItem?.quote, "previous")}
                                            {renderCell("Quantity", item.quantity, !amendedItem ? false : item.quantity !== amendedItem?.quantity, "previous")}
                                            {renderCell("Category", item.category, !amendedItem ? false : item.category !== amendedItem?.category, "previous")}
                                            {renderCell("Tax", `${item.tax}%`, !amendedItem ? false : item.tax !== amendedItem?.tax, "previous")}
                                            {renderCell("Unit", item.unit, !amendedItem ? false : item.unit !== amendedItem?.unit, "previous")}
                                            {renderCell("Make", item.makes?.list?.find(i => i?.enabled === "true")?.make, !amendedItem ? false : item.makes?.list?.find(i => i?.enabled === "true")?.make !== amendedItem?.makes?.list?.find(i => i?.enabled === "true")?.make, "previous")}
                                        </div>
                                    </TableCell>

                                    {/* Amended Details */}
                                    <TableCell>
                                        <div className="space-y-1 text-sm">
                                            {amendedItem ? (
                                                <>
                                                    {renderCell("Quote", amendedItem.quote, item.quote !== amendedItem.quote)}
                                                    {renderCell("Quantity", amendedItem.quantity, item.quantity !== amendedItem.quantity)}
                                                    {renderCell("Category", amendedItem.category, item.category !== amendedItem.category)}
                                                    {renderCell("Tax", `${amendedItem.tax}%`, item.tax !== amendedItem.tax)}
                                                    {renderCell("Unit", amendedItem.unit, item.unit !== amendedItem.unit)}
                                            {renderCell("Make", amendedItem.makes?.list?.find(i => i?.enabled === "true")?.make, item.makes?.list?.find(i => i?.enabled === "true")?.make !== amendedItem?.makes?.list?.find(i => i?.enabled === "true")?.make)}
                                                </>
                                            ) : (
                                                <p className="text-red-500">Deleted</p>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>

            </Card>

            <div className="py-4">
                <div className="flex items-center space-y-2">
                    <h2 className="text-base pt-1 pl-2 font-bold tracking-tight">Amendment Comments</h2>
                </div>

                {amendmentComment && amendmentComment?.length !== 0 ? (
                    amendmentComment.map((cmt) => (
                        <div key={cmt.name} className="flex items-start space-x-4 bg-gray-50 p-4 rounded-lg mb-2">
                            <Avatar>
                                <AvatarImage src={`https://api.dicebear.com/6.x/initials/svg?seed=${cmt.comment_by}`} />
                                <AvatarFallback>{cmt.comment_by[0]}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                                <p className="font-medium text-sm text-gray-900">{cmt.content}</p>
                                <div className="flex justify-between items-center mt-2">
                                    <p className="text-sm text-gray-500">
                                        {cmt.comment_by === "Administrator" ? "Administrator" : getUserName(cmt.comment_by)}
                                    </p>
                                    <p className="text-xs text-gray-400">
                                        {formatDate(cmt.creation.split(" ")[0])} {cmt.creation.split(" ")[1].substring(0, 5)}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))
                ) : (
                    <span className="text-xs font-semibold flex items-center justify-center">No Comments Found.</span>
                )}
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end space-x-4 my-4">
                <Button
                    variant="outline"
                    onClick={() => {
                        setActionType('revert');
                        setIsDialogOpen(true);
                    }}
                    className="flex items-center space-x-2"
                >
                    <Undo2 className="mr-2" /> Revert to Original
                </Button>
                <Button
                    onClick={() => {
                        setActionType('approve');
                        setIsDialogOpen(true);
                    }}
                    className="flex items-center space-x-2"
                >
                    <CheckCheck className="mr-2" /> Approve Amendments
                </Button>
            </div>

            {/* Comment Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{actionType === 'approve' ? 'Approve Amendments' : 'Revert to Original'}</DialogTitle>
                        <DialogDescription>Add a comment for this action.</DialogDescription>
                    </DialogHeader>
                    <TextArea
                        rows={3}
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Add a comment (optional)"
                    />
                    {(update_loading || create_loading) ? <div className='flex items-center justify-center'><TailSpin width={80} color='red' /> </div> : (
                        <div className="flex justify-end mt-4">
                            <Button variant="outline" className="flex gap-1 items-center" onClick={() => setIsDialogOpen(false)}>
                                <X className="h-4 w-4" />
                                Cancel
                            </Button>

                            <Button onClick={handleAction} className="ml-2 flex gap-1 items-center">
                                {actionType === 'approve' ? (<div className="flex gap-1 items-center"><CheckCheck className="h-4 w-4" /> Approve</div>) : (<div className="flex gap-1 items-center"><Undo2 className="h-4 w-4" /> Revert</div>)}
                            </Button>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default ApproveAmendPO;

export const Component = ApproveAmendPO;