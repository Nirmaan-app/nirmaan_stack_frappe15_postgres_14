import { Card } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useFrappeGetDocList, useFrappeGetDoc, useFrappeUpdateDoc, useFrappeCreateDoc } from "frappe-react-sdk";
import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react"
import { ArrowLeft, CheckCheck, Undo2, X } from 'lucide-react';
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { formatDate } from "@/utils/FormatDate";
import { ProcurementOrders as ProcurementOrdersType } from "@/types/NirmaanStack/ProcurementOrders";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers";
import { NirmaanVersions as NirmaanVersionsType } from "@/types/NirmaanStack/NirmaanVersions";
import TextArea from "antd/es/input/TextArea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useUserData } from "@/hooks/useUserData";

const ApproveAmendPO = () => {

    const { po } = useParams<{ po: string }>()
    const orderId = po?.replaceAll("&=", "/")

    const [project, setProject] = useState<String | undefined>()
    const [owner, setOwner] = useState<String | undefined>()
    const { data: po_data, isLoading: po_loading, error: po_error } = useFrappeGetDoc<ProcurementOrdersType>("Procurement Orders", orderId, `Procurement Orders ${orderId}`);
    const { data: project_data, isLoading: project_loading, error: project_error } = useFrappeGetDoc<ProjectsType>("Projects", project, project ? undefined : null);
    const { data: owner_data, isLoading: owner_loading, error: owner_error } = useFrappeGetDoc<NirmaanUsersType>("Nirmaan Users", owner, owner ? (owner === "Administrator" ? null : undefined) : null);

    const { data: versions, isLoading: versionsLoading, error: versionsError } = useFrappeGetDocList("Nirmaan Versions", {
        fields: ["*"],
        filters: [["ref_doctype", "=", "Procurement Orders"], ["docname", "=", orderId]],
        limit: 1000,
        orderBy: { field: "creation", order: "desc" }
    })

    useEffect(() => {
        if (po_data) {
            setProject(po_data?.project)
            setOwner(po_data?.owner)
        }
    }, [po_data])

    // console.log("within 1st component", owner_data)
    if (po_loading || project_loading || owner_loading || versionsLoading) return <h1>Loading...</h1>
    if (po_error || project_error || owner_error || versionsError) return <h1>Error</h1>
    return (
        <ApproveAmendPOPage po_data={po_data} project_data={project_data} versionsData={versions} owner_data={owner_data == undefined ? { full_name: "Administrator" } : owner_data} />
    )
}

interface ApproveAmendPOPageProps {
    po_data: ProcurementOrdersType | undefined
    project_data: ProjectsType | undefined
    owner_data: NirmaanUsersType | undefined | { full_name: String }
    versionsData: NirmaanVersionsType | undefined
}


const ApproveAmendPOPage = ({ po_data, project_data, owner_data, versionsData }: ApproveAmendPOPageProps) => {

    const navigate = useNavigate()
    const userData = useUserData()
    const { data: usersList } = useFrappeGetDocList("Nirmaan Users", {
        fields: ["full_name", "name"],
        limit: 1000
    })

    const getUserName = (name) => {
        if (usersList) {
            return usersList?.find((user) => user?.name === name)?.full_name
        }
    }

    const { data: amendmentComment } = useFrappeGetDocList("Nirmaan Comments", {
        fields: ["*"],
        filters: [["reference_name", "=", po_data?.name], ["subject", "=", "updating po(amendment)"]]
    })

    console.log("amendmentComment", amendmentComment)

    const [previousOrderList, setPreviousOrderList] = useState<any[]>([])
    const [amendedOrderList, setAmendedOrderList] = useState<any[]>([])

    const extractOrderListFromVersions = () => {

    }

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

    // console.log("previousOrderList", previousOrderList)

    const [comment, setComment] = useState('');
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [actionType, setActionType] = useState<'approve' | 'revert'>('approve');

    // console.log("comment", comment)

    const { updateDoc } = useFrappeUpdateDoc()
    const { createDoc } = useFrappeCreateDoc()

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
            navigate("/approve-amended-po")
        } catch (error) {
            console.log("error in ApproveAmmendPage", error)
            toast({
                title: "Error",
                description: "An error occurred. Please try again.",
                variant: "destructive"
            });
        }
    };

    const renderCell = (label: string, value: string | number, isChanged: boolean) => (
        <div className={`py-1 ${isChanged ? 'bg-green-100 dark:bg-green-900' : ''}`}>
            <span className="font-medium">{label}:</span> {value}
        </div>
    )

    return (
        <div className="flex-1 md:space-y-4">
            {/* PO Details Card */}
            <div className="flex items-center pt-1  pb-4">
                <ArrowLeft className='cursor-pointer' onClick={() => navigate("/approve-amended-po")} />
                <h2 className="text-base pl-2 font-bold tracking-tight">Amended PO: <span className="text-red-700">{po_data?.name}</span></h2>
            </div>
            <Card className="flex flex-wrap lg:grid lg:grid-cols-4 gap-4 border border-gray-100 rounded-lg p-4">
                <div className="border-0 flex flex-col justify-center max-sm:hidden">
                    <p className="text-left py-1 font-light text-sm text-sm text-red-700">Date:</p>
                    <p className="text-left font-bold py-1 font-bold text-base text-black">{formatDate(po_data?.modified)}</p>
                </div>
                <div className="border-0 flex flex-col justify-center">
                    <p className="text-left py-1 font-light text-sm text-sm text-red-700">Project</p>
                    <p className="text-left font-bold py-1 font-bold text-base text-black">{project_data?.project_name}</p>
                </div>
                <div className="border-0 flex flex-col justify-center max-sm:hidden">
                    <p className="text-left py-1 font-light text-sm text-sm text-red-700">Vendor</p>
                    <p className="text-left font-bold py-1 font-bold text-base text-black">{po_data?.vendor_name}</p>
                </div>
                <div className="border-0 flex flex-col justify-center max-sm:hidden">
                    <p className="text-left py-1 font-light text-sm text-sm text-red-700">Amended By</p>
                    <p className="text-left font-bold py-1 font-bold text-base text-black">{po_data?.modified_by === "Administrator" ? "Administrator" : getUserName(po_data?.modified_by)}</p>
                </div>
            </Card>

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
                                    <TableCell>
                                        <div className="space-y-1 text-sm">
                                            {renderCell("Quote", item.quote, item.quote !== amendedItem?.quote)}
                                            {renderCell("Quantity", item.quantity, item.quantity !== amendedItem?.quantity)}
                                            {renderCell("Category", item.category, item.category !== amendedItem?.category)}
                                            {renderCell("Tax", `${item.tax}%`, item.tax !== amendedItem?.tax)}
                                            {renderCell("Unit", item.unit, item.unit !== amendedItem?.unit)}
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
                        <div key={cmt.name} className="flex items-start space-x-4 bg-gray-50 p-4 rounded-lg">
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
                    <div className="flex justify-end mt-4">
                        <Button variant="outline" className="flex gap-1 items-center" onClick={() => setIsDialogOpen(false)}>
                            <X className="h-4 w-4" />
                            Cancel
                        </Button>


                        <Button onClick={handleAction} className="ml-2 flex gap-1 items-center">
                            {actionType === 'approve' ? (<div className="flex gap-1 items-center"><CheckCheck className="h-4 w-4" /> Approve</div>) : (<div className="flex gap-1 items-center"><Undo2 className="h-4 w-4" /> Revert</div>)}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};


export const Component = ApproveAmendPO;