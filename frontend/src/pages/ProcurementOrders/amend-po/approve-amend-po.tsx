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
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import { CEOHoldBanner } from "@/components/ui/ceo-hold-banner";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { NirmaanComments } from "@/types/NirmaanStack/NirmaanComments";
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers";
import { NirmaanVersions as NirmaanVersionsType } from "@/types/NirmaanStack/NirmaanVersions";
import { formatDate } from "@/utils/FormatDate";
import TextArea from "antd/es/input/TextArea";
import { useFrappeCreateDoc, useFrappeDocumentEventListener, useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc ,useFrappePostCall} from "frappe-react-sdk";
import { CheckCheck, Undo2, X } from 'lucide-react';
import { version } from "os";
import { useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate, useParams } from "react-router-dom";
import { invalidateSidebarCounts } from "@/hooks/useSidebarCounts";
interface ApiResponse {
    message: {
        status: number;
        message?: string; // Success message
        error?: string; // Error message
    }
}
// --- Main Entry Component (No Changes) ---
const ApproveAmendPO = () => {
    const { id: po } = useParams<{ id: string }>();

    if (!po) return <div>No PO ID Provided</div>;
    const orderId = po.replaceAll("&=", "/");

    const { data: po_data, isLoading: po_loading, error: po_error, mutate: po_mutate } = useFrappeGetDoc("Procurement Orders", orderId, `Procurement Orders ${orderId}`);

    // Direct API call For Amend PO

    useFrappeDocumentEventListener("Procurement Orders", orderId, (event) => {
        toast({ title: "Document Updated", description: `PO ${event.name} has been modified.` });
        po_mutate();
    }, true);

    const { data: usersList, isLoading: usersListLoading, error: usersListError } = useUsersList();

    const { data: versions, isLoading: versionsLoading, error: versionsError } = useFrappeGetDocList<NirmaanVersionsType>("Nirmaan Versions", {
        fields: ["data"],
        filters: [["ref_doctype", "=", "Procurement Orders"], ["docname", "=", orderId]],
        limit: 1,
        orderBy: { field: "creation", order: "desc" }
    });

    const navigate = useNavigate();

    if (po_loading || usersListLoading || versionsLoading) return <LoadingFallback />;
    if (po_error || usersListError || versionsError) return <AlertDestructive error={po_error || usersListError || versionsError} />;

    if (po_data?.status !== "PO Amendment") {
        return (
            <div className="flex items-center justify-center h-[90vh]">
                <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
                    <h2 className="text-2xl font-semibold text-gray-800">Heads Up!</h2>
                    <p className="text-gray-600 text-lg">
                        The Purchase Order: <span className="font-medium text-gray-900">{po_data?.name}</span> is no longer available for amending. Its current state is <span className="font-semibold text-blue-600">{po_data?.status}</span>.
                    </p>
                    <Button className="mt-4" onClick={() => { invalidateSidebarCounts(); navigate("/purchase-orders?tab=Approve Amended PO"); }}>Go Back</Button>
                </div>
            </div>
        );
    }

    return <ApproveAmendPOPage po_data={po_data} versionsData={versions} usersList={usersList}  />;
};


// --- Page Component with Updated Logic ---
interface ApproveAmendPOPageProps {
    po_data: any;
    po_mutate:any;
    versionsData?: NirmaanVersionsType[];
    usersList?: NirmaanUsersType[];
}

const ApproveAmendPOPage = ({ po_data, versionsData, usersList,po_mutate }: ApproveAmendPOPageProps) => {
    const navigate = useNavigate();
    const userData = useUserData();
    const { toast } = useToast();
    const { isCEOHold, showBlockedToast } = useCEOHoldGuard(po_data?.project);
    const { updateDoc, loading: update_loading } = useFrappeUpdateDoc();
    const { createDoc, loading: create_loading } = useFrappeCreateDoc();

    const [comment, setComment] = useState('');
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [actionType, setActionType] = useState<'approve' | 'revert'>('approve');

    const { data: amendmentComment } = useFrappeGetDocList<NirmaanComments>("Nirmaan Comments", {
        fields: ["content", "comment_by", "creation"],
        filters: [["reference_name", "=", po_data?.name], ["subject", "=", "updating po(amendment)"]]
    });

    const { call: approveAmendItemsCall, loading: approveAmendLoading } = useFrappePostCall<ApiResponse>("nirmaan_stack.api.approve_amend_po.approve_amend_po_with_payment_terms");
    const { call: revertFromAmendCall, loading: revert_loading } = useFrappePostCall('nirmaan_stack.api.approve_amend_po.revert_from_amend_po');



    const getUserName = (name: string | undefined) => {
        return usersList?.find((user) => user?.name === name)?.full_name;
    };

    // --- REFACTORED LOGIC: Reconstruct Original Items and Prepare for Comparison ---
    const { originalItems, originalItemsMap, allItemNames } = useMemo(() => {
        if (!versionsData || versionsData.length === 0 || !po_data) {
            return { originalItems: [], originalItemsMap: new Map(), allItemNames: new Set() };
        }

        const latestVersion = versionsData[0];
        if (!latestVersion.data) return { originalItems: [], originalItemsMap: new Map(), allItemNames: new Set() };


        const parsedVersionData = JSON.parse(latestVersion.data);
        // console.log("Amended Po version data",parsedVersionData.remove)

        let reconstructedItems = [...po_data.items,];

        // 2. Add back the items that were removed.
        if (parsedVersionData.removed && Array.isArray(parsedVersionData.removed)) {
            const removedItemRows = parsedVersionData.removed.filter(([tableName]: any) => tableName === 'items');
            removedItemRows.forEach(([, itemData]: any) => {
                reconstructedItems.push(itemData);
            });
        }

        // console.log("Amended Po version data",reconstructedItems)


        if (parsedVersionData.row_changed) {
            const rowChanges = parsedVersionData.row_changed.filter(([tableName]: any) => tableName === 'items');
            reconstructedItems = reconstructedItems.map((item, index) => {
                const itemChange = rowChanges.find(([, rowIndex]: any) => rowIndex === index);
                if (itemChange) {
                    const revertedItem = { ...item };
                    itemChange[3].forEach(([fieldName, oldValue]: any) => {
                        revertedItem[fieldName] = oldValue;
                    });
                    return revertedItem;
                }
                return item;
            });
        }

        const originalMap = new Map(reconstructedItems.map((item: any) => [item.name, item]));
        const currentNames = po_data.items.map((item:any) => item.name);
        const originalNames = reconstructedItems.map((item:any) => item.name);
        const combinedNames = new Set([...currentNames, ...originalNames]);

        // console.log("Amended PORe",reconstructedItems)
        // console.log("Amended POOR",originalMap)
        // console.log("Amended POCo",combinedNames)

        return { originalItems: reconstructedItems, originalItemsMap: originalMap, allItemNames: combinedNames };

    }, [versionsData]);


    const handleAction = async () => {
        if (isCEOHold) {
            showBlockedToast();
            return;
        }
        try {
            if (actionType === 'approve') {
                // await updateDoc("Procurement Orders", po_data.name, { status: "PO Approved" });
                const {message:result}=await approveAmendItemsCall({po_name: po_data.name})
                if(result.status===200){
                    toast({ title: "Success", description: `Amende PO has been successfully ${actionType === 'approve' ? 'approved' : 'reverted'}`, variant: "success" });
                }else{
                    toast({ title: "Error", description: `An error occurred while processing the action ${result.message}.`, variant: "destructive" });
                }

            } else {

                // console.log("Reverting Amended PO",originalItems)

                // await updateDoc("Procurement Orders", po_data.name, {
                //     status: "PO Approved",
                //     items: [...originalItems], // Revert using the reconstructed list
                // });
                const {message:result} = await revertFromAmendCall({
                    po_name: po_data.name,
                    status: "PO Approved",
                    items: originalItems
                });

                // console.log("result",result)
                if (result.status !== 200) {
                    toast({
                        title: "Revert Failed",
                        description: result.message.message || "An error occurred while reverting.",
                        variant: "destructive",
                    });
                }else{
                    toast({ title: "Error Revert", description: `An error occurred while processing the action ${result.message}.`, variant: "destructive" });
                }



            }

            if (comment.length) {
                await createDoc("Nirmaan Comments", {
                    comment_type: "Comment", reference_doctype: "Procurement Orders",
                    reference_name: po_data.name, comment_by: userData?.user_id,
                    content: comment, subject: actionType === 'approve' ? "approving po(amendment)" : "reverting po(amendment)"
                });
            }

            // toast({ title: "Success", description: `Amende PO has been successfully ${actionType === 'approve' ? 'approved' : 'reverted'}`, variant: "success" });
            setIsDialogOpen(false);
            invalidateSidebarCounts();
            navigate("/purchase-orders?tab=Approve Amended PO");
        } catch (error) {
            toast({ title: "Error", description: "An error occurred while processing the action.", variant: "destructive" });
        }
    };

    // --- YOUR UI (UNCHANGED) ---
    // This function renders a single cell and highlights if changed.
    const renderCell = (label: string, originalValue: any, currentValue: any) => {
        const isChanged = String(originalValue) !== String(currentValue);
        return (
            <div className={`py-1 ${isChanged ? 'bg-yellow-100 dark:bg-yellow-900 font-semibold' : ''}`}>
                <span className="font-medium">{label}:</span> {originalValue ?? "N/A"}
            </div>
        );
    };

    return (
        <div className="p-4 md:p-6 space-y-4">
            <div className="space-y-2">
                <h2 className="text-lg font-bold tracking-tight">Approve/Revert Amendments</h2>
                <ProcurementActionsHeaderCard orderData={po_data} amend={true} />
            </div>

            {isCEOHold && <CEOHoldBanner className="mb-4" />}

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
                        {Array.from(allItemNames).map((itemName, index) => {
                            const originalItem = originalItemsMap.get(itemName);
                            const currentItem = po_data.items.find((i: any) => i.name == itemName);

                            // Determine item status: Added, Deleted, or Modified/Unchanged
                            const isAdded = !originalItem && currentItem;
                            const isDeleted = originalItem && !currentItem;

                            // console.log("Amended PO ALL",allItemNames)
                            // console.log("Amended PObbb",originalItem,currentItem)

                            return (
                                <TableRow key={index} className={isAdded ? "bg-green-50" : isDeleted ? "bg-red-50" : ""}>
                                    <TableCell className="font-bold">
                                        {currentItem?.item_name || originalItem?.item_name}
                                    </TableCell>
                                    <TableCell>
                                        {isAdded ? <p className="text-green-600 font-semibold">Newly Added</p> : (
                                            <div className="space-y-1 text-sm">
                                                {renderCell("Quote", originalItem.quote, currentItem?.quote)}
                                                {renderCell("Quantity", originalItem.quantity, currentItem?.quantity)}
                                                {renderCell("Make", originalItem.make, currentItem?.make)}
                                                {renderCell("Tax", `${originalItem.tax}%`, `${currentItem?.tax}%`)}
                                                {/* Add other fields as needed */}
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {isDeleted ? <p className="text-red-600 font-semibold">Deleted</p> : (
                                            <div className="space-y-1 text-sm">
                                                {renderCell("Quote", currentItem.quote, originalItem?.quote)}
                                                {renderCell("Quantity", currentItem.quantity, originalItem?.quantity)}
                                                {renderCell("Make", currentItem.make, originalItem?.make)}
                                                {renderCell("Tax", `${currentItem.tax}%`, `${originalItem?.tax}%`)}
                                                {/* Add other fields as needed */}
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </Card>

            <div className="py-4 space-y-2">
                <h2 className="text-lg font-bold tracking-tight">Amendment Comments</h2>
                {amendmentComment && amendmentComment.length > 0 ? (
                    amendmentComment.map((cmt) => (
                        <div key={cmt.name} className="flex items-start space-x-4 bg-gray-50 p-4 rounded-lg">
                            <Avatar><AvatarImage src={`https://api.dicebear.com/6.x/initials/svg?seed=${cmt.comment_by}`} /><AvatarFallback>{cmt.comment_by[0]}</AvatarFallback></Avatar>
                            <div className="flex-1">
                                <p className="font-medium text-sm text-gray-900">{cmt.content}</p>
                                <div className="flex justify-between items-center mt-2">
                                    <p className="text-sm text-gray-500">{getUserName(cmt.comment_by) || cmt.comment_by}</p>
                                    <p className="text-xs text-gray-400">{formatDate(cmt.creation)}</p>
                                </div>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="text-sm text-gray-500 text-center py-4">No specific amendment comments found.</div>
                )}
            </div>

            <div className="flex justify-end space-x-4 my-4">
                <Button variant="outline" onClick={() => { setActionType('revert'); setIsDialogOpen(true); }} className="flex items-center" disabled={revert_loading}>
                    <Undo2 className="mr-2 h-4 w-4" /> Revert to Original
                </Button>
                <Button onClick={() => { setActionType('approve'); setIsDialogOpen(true); }} className="flex items-center" disabled={approveAmendLoading}>
                    <CheckCheck className="mr-2 h-4 w-4" /> Approve Amendments
                </Button>
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{actionType === 'approve' ? 'Approve Amendments' : 'Revert to Original'}</DialogTitle>
                        <DialogDescription>Add a comment for this action (optional).</DialogDescription>
                    </DialogHeader>
                    <TextArea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g., Changes approved as per discussion."/>
                    {(approveAmendLoading) ? <div className='flex items-center justify-center p-6'><TailSpin width={60} color='red' /> </div> : (
                        <div className="flex justify-end mt-4 space-x-2">
                            <Button variant="ghost" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                            <Button onClick={handleAction}>Confirm {actionType === 'approve' ? 'Approval' : 'Revert'}</Button>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default ApproveAmendPO;
export const Component = ApproveAmendPO;

