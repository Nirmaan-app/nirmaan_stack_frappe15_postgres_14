import { useUserData } from "@/hooks/useUserData";
import { NirmaanComments } from "@/types/NirmaanStack/NirmaanComments";
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers";
import { ProcurementOrder as ProcurementOrdersType } from "@/types/NirmaanStack/ProcurementOrders";
import { Category, ProcurementRequest, ProcurementRequestItemDetail } from "@/types/NirmaanStack/ProcurementRequests";
import { formatDate } from "@/utils/FormatDate";
import { parseCategoryList } from "@/utils/safeJsonParse";
import { Timeline } from "antd";
import { FrappeDoc, useFrappeDeleteDoc, useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc, useSWRConfig,useFrappePostCall } from "frappe-react-sdk";
import { FileSliders, ListChecks, MessageCircleMore, Settings2, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";
import { Label } from "./ui/label";
import { PRSummarySkeleton } from "./ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { toast } from "./ui/use-toast";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { KeyedMutator } from "swr";


const PRSummary: React.FC = () => {

    const { prId: id } = useParams<{ prId: string }>();

    if(!id) return <div>No PR ID provided.</div>

    const { data: pr_data, error: pr_error, isLoading: prLoading, mutate: pr_data_mutate } = useFrappeGetDoc<ProcurementRequest>("Procurement Requests", id, `Procurement Requests ${id}`);

    const { data: usersList, isLoading: userLoading, error: userError } = useUsersList()

    const { data: universalComments, isLoading: universalCommentsLoading } = useFrappeGetDocList<NirmaanComments>("Nirmaan Comments", {
        fields: ["*"],
        limit: 0,
        filters: [["reference_name", "=", id]],
        orderBy: { field: "creation", order: "desc" }
    }, id ? `Nirmaan Comments ${id}` : null)

    const { data: procurementOrdersList, error: procurementOrdersError, isLoading: procurementOrdersLoading } = useFrappeGetDocList<ProcurementOrdersType>("Procurement Orders", {
        fields: ["*"],
        filters: [['procurement_request', '=', id]],
        limit: 0
    },
        id ? undefined : null
    )

    if (pr_error || procurementOrdersError || userError) {
        return <h1>{pr_error?.message || procurementOrdersError?.message || userError?.message}</h1>;
    }

    if (prLoading || procurementOrdersLoading || userLoading || universalCommentsLoading) {
        return <PRSummarySkeleton />;
    }

    return (
        <PRSummaryPage pr_data={pr_data} po_data={procurementOrdersList} universalComments={universalComments || []} usersList={usersList} pr_data_mutate={pr_data_mutate} />
    )
};

interface PRSummaryPageProps {
    pr_data?: FrappeDoc<ProcurementRequest>;
    po_data?: ProcurementOrdersType[]
    universalComments?: NirmaanComments[]
    usersList?: NirmaanUsersType[]
    pr_data_mutate: KeyedMutator<FrappeDoc<ProcurementRequest>>
}

const PRSummaryPage: React.FC<PRSummaryPageProps> = ({ pr_data, po_data, universalComments, usersList, pr_data_mutate }) => {

    if(!pr_data) return <div>No PR data found.</div>
// console.log("PR Data",pr_data)  
// console.log("PO Data",po_data)
    const navigate = useNavigate();
    const { role, user_id } = useUserData()
    const { deleteDoc } = useFrappeDeleteDoc()
    const [poItemList, setPoItemList] = useState<Set<string>>(new Set())
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc()
    const { mutate } = useSWRConfig()

    const getFullName = useMemo(() => (id: string) => usersList?.find(user => user.name === id)?.full_name || '', [usersList]);



    // useEffect(() => {
    //     if (po_data) {
    //         const newSet = new Set<string>()
    //         po_data.forEach(po => {
    //             po.items.forEach(item => {
    //                 newSet.add(item.name)
    //             })
    //         })
    //         setPoItemList(newSet)
    //     }

    // }, [po_data])
    // This useEffect now calls our working API
// In your PRSummaryPage component...

// Make sure your fetch call is defined correctly


// This is the corrected useEffect block
// In your PRSummaryPage component...

// In your PRSummaryPage component...

// Your custom API call hook remains the same
const { call: fetchPoItems } = useFrappePostCall<ProcurementOrdersType>(
    'nirmaan_stack.api.projects.project_aggregates.get_purchase_order_with_items'
);

// This is the corrected useEffect block using async/await
useEffect(() => {
    // Define an async function to handle the fetching
    const fetchAllPoItems = async () => {
        // We need the initial list of POs to loop through
        if (po_data && po_data.length > 0) {
            
            const newIdSet = new Set<string>();

            // Loop through each PO from the initial list
            for (const po of po_data) {
                try {
                    // Correctly call the API for each PO
                    const {message:fullPoDoc} = await fetchPoItems({ po_name: po.name });
                //  console.log("fullPoDoc",fullPoDoc)
                    // Check if the response and its 'items' array exist
                    if (fullPoDoc && fullPoDoc.items) {
                        // Loop through the items array of the fetched PO
                        fullPoDoc.items.forEach(item => {
                            // --- THE CRITICAL FIX IS HERE ---
                            // console.log("item",item)
                            // Add the actual Item ID to the set, not the row's unique name.
                            newIdSet.add(item.procurement_request_item);
                        });
                    }
                } catch (err) {
                    console.error(`Error fetching details for PO ${po.name}:`, err);
                    toast({
                        title: "Failed to Load Order Details",
                        description: `Could not fetch items for PO ${po.name}.`,
                        variant: "destructive",
                    });
                    return; // Stop if one fails
                }
            }
            
            // After the loop, update the state with the set of ordered Item IDs.
            setPoItemList(newIdSet);
        }
    };

    // Execute the async function
    fetchAllPoItems();

}, [po_data, fetchPoItems, toast]);


// console.log("PO Items",poItemList)


    const actualPrItems = useMemo(() => pr_data?.order_list || [], [pr_data]);

    const statusRender = useMemo(() => (status: string) => {
        if (["Approved", "In Progress", "Vendor Selected"].includes(status)) return "Open PR";
        // const itemList = pr_data?.procurement_list?.list || [];
        // if (itemList?.some(i => i?.status === "Deleted")) return "Open PR";
        // const allItemsApproved = itemList.every(item => (poItemList.has(item?.name) || item?.status === "Deleted"));
         // Use actualPrItems which is pr_data.order_list
        if (!actualPrItems.length) return "Open PR"; // Or handle as appropriate if empty

        // An item is considered "covered" if it's in a PO or its status is "Deleted"
        const allItemsCovered = actualPrItems.every(item => 
            poItemList.has(item.item_id) || item.status === "Deleted"
        );
        return allItemsCovered ? "Approved PO" : "Open PR";

    }, [poItemList, actualPrItems]);

    const itemsTimelineList = useMemo(() => universalComments?.map(cmt => ({
        label: <span className="max-sm:text-wrap text-xs m-0 p-0">{formatDate(cmt.creation.split(" ")[0])} {cmt.creation.split(" ")[1].substring(0, 5)}</span>,
        children: <Card><CardHeader className="p-2"><CardTitle><span className="text-sm">{cmt.comment_by === "Administrator" ? "Administrator" : getFullName(cmt.comment_by)}</span></CardTitle></CardHeader><CardContent className="p-3 pt-0">{cmt.content}</CardContent></Card>,
        color: cmt.subject ? (cmt.subject === "creating pr" ? "green" : cmt.subject === "rejecting pr" ? "red" : "blue") : 'gray'
    })), [universalComments, getFullName]);

    const handleDeletePr = async () => {
        try {
            await deleteDoc("Procurement Requests", pr_data?.name)
            await mutate(`Procurement Requests ${pr_data?.project}`)
            toast({
                title: "Success!",
                description: `PR: ${pr_data?.name} deleted successfully!`,
                variant: "success"
            })
            navigate("/prs&milestones/procurement-requests")
        } catch (error) {
            console.log("error while deleting PR", error)
            toast({
                title: "Failed!",
                description: `PR: ${pr_data.name} deletion Failed!`,
                variant: "destructive"
            })
        }
    }

    const getItemStatus = useMemo(() => (prItemDetail: ProcurementRequestItemDetail) => {
        // console.log("PO Item List",poItemList,prItemDetail)

        // prItemDetail.item_id is the Item DocName
        return poItemList.has(prItemDetail.name) ? "Ordered" : "In Progress";
    }, [poItemList]);


    const handleMarkDraftPR = async () => {
        try {
            await updateDoc("Procurement Requests", pr_data?.name, {
                workflow_state: "Draft"
            })

            await pr_data_mutate()
            navigate("edit-pr")
        } catch (error) {
            console.log("error while marking pr as draft", error)
            toast({
                title: "Failed!",
                description: `Marking PR: ${pr_data?.name} as Draft failed!`,
                variant: "destructive"
            })
        }
    }

    const handleSendForAppr = async () => {
        try {
            await updateDoc("Procurement Requests", pr_data?.name, {
                workflow_state: "Pending"
            })
            await pr_data_mutate()

            toast({
                title: "Success!",
                description: `PR: ${pr_data?.name} Sent for approval!`,
                variant: "success"
            })

        } catch (error) {
            console.log("error while sending pr for approval", error)
            toast({
                title: "Failed!",
                description: `Sending PR: ${pr_data?.name} for approval failed!`,
                variant: "destructive"
            })
        }
    }

    const categories = useMemo(() => {
        const uniqueCategories = new Map<string, Category>();
        const parsedList = parseCategoryList<Category>(pr_data?.category_list);

        parsedList.forEach((cat) => {
            if (cat && cat.name && !uniqueCategories.has(cat.name)) {
                uniqueCategories.set(cat.name, cat);
            }
        });
        return Array.from(uniqueCategories.values());
    }, [pr_data?.category_list]);

    const deletedItems = useMemo(() => {
        return actualPrItems.filter((item: ProcurementRequestItemDetail) => item.status === "Deleted");
    }, [actualPrItems]);

    const requestedItems = useMemo(() => (categoryDocName: string) => {
        return actualPrItems.filter((item: ProcurementRequestItemDetail) => 
            item.category === categoryDocName && item.status === "Request"
        );
    }, [actualPrItems]);

    const categoryItemsToDisplay = useMemo(() => (categoryDocName: string) => {
        // Filters items for a given category that are NOT "Request" or "Deleted"
        return actualPrItems.filter((item: ProcurementRequestItemDetail) => 
            item.category === categoryDocName && !["Request", "Deleted"].includes(item.status)
        );
    }, [actualPrItems]);



    return (
        <div className={`flex-1 space-y-2 md:space-y-4`}>
            <div className="flex items-center justify-between">
                <h2 className="text-xl max-md:text-lg font-bold tracking-tight ml-2">Summary</h2>
                <div className="flex gap-4 items-center">
                    {pr_data?.workflow_state === "Pending" && pr_data?.work_package && (
                        <HoverCard>
                            <HoverCardTrigger>
                                <Button disabled={updateLoading} onClick={handleMarkDraftPR} className="items-center gap-2 flex" variant="secondary">{updateLoading ? <TailSpin width={20} height={16} color="white" /> : <><FileSliders className="w-4 h-4" /><span>Edit</span></>}</Button>
                            </HoverCardTrigger>
                            <HoverCardContent className="bg-gray-800 text-white rounded-md shadow-lg text-center">
                                Mark as <span className="text-primary underline">Draft</span> and Edit!
                            </HoverCardContent>
                        </HoverCard>
                    )}

                    {pr_data?.workflow_state === "Draft" && (
                        <div className="flex items-center gap-2">
                            <Button onClick={() => navigate("edit-pr")}>Continue Editing</Button>
                            <Button disabled={updateLoading} onClick={handleSendForAppr}>{updateLoading ? <TailSpin width={20} height={16} color="white" /> : "Send for Approval"}</Button>
                        </div>
                    )}
                    {
                        [...((!["Nirmaan Project Lead Profile", "Nirmaan Admin Profile", "Nirmaan PMO Executive Profile"].includes(role) && user_id === pr_data?.owner) ? ["Rejected", "Pending"] : []), ...(["Nirmaan Project Lead Profile", "Nirmaan Admin Profile", "Nirmaan PMO Executive Profile"].includes(role) ? ["Approved", "Rejected", "Pending"] : []),].includes(pr_data?.workflow_state) && (
                            <AlertDialog>
                                <AlertDialogTrigger>
                                    <Button className="flex items-center gap-1">
                                        <Trash2 className="h-4 w-4" />
                                        Delete</Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle className="text-center">
                                            Are you sure, you want to delete this PR?
                                        </AlertDialogTitle>
                                    </AlertDialogHeader>
                                    <AlertDialogDescription className="">
                                        This action will delete this pr from the system. Are you sure you want to continue?
                                        <div className="flex gap-2 items-center justify-center">
                                            <AlertDialogCancel className="flex items-center gap-1">
                                                <Undo2 className="h-4 w-4" />
                                                Cancel
                                            </AlertDialogCancel>
                                            <AlertDialogAction className="flex items-center gap-1" onClick={handleDeletePr}>
                                                <ListChecks className="h-4 w-4" />
                                                Confirm
                                            </AlertDialogAction>
                                        </div>
                                    </AlertDialogDescription>
                                </AlertDialogContent>
                            </AlertDialog>
                        )
                    }
                    {pr_data?.workflow_state === "Rejected" && (

                        <Button className="flex items-center gap-1" onClick={() => {
                            if (pr_data?.work_package) {
                                navigate("resolve-pr")
                            } else {
                                navigate("resolve-custom-pr")
                            }
                        }}>
                            <Settings2 className="h-4 w-4" />
                            Resolve</Button>
                    )}
                </div>
            </div>
            <div className="flex max-lg:flex-col gap-4">
                <div className="flex flex-col gap-4 flex-1">
                    <Card className="w-full">
                        <CardHeader>
                            <CardTitle className="text-xl text-red-600 flex items-center justify-between">
                                PR Details
                                <Badge variant={`${pr_data?.workflow_state === "Rejected" ? "red" : pr_data?.workflow_state === "Pending" ? "yellow" : pr_data?.workflow_state === "Draft" ? "indigo" : statusRender(pr_data?.workflow_state) === "Open PR" ? "orange" : statusRender(pr_data?.workflow_state) === "Approved PO" ? "green" : "default"}`}>
                                    {pr_data?.workflow_state === "Rejected" ? "Rejected" : pr_data?.workflow_state === "Pending" ? "Approval Pending" : pr_data?.workflow_state === "Draft" ? "Draft" : statusRender(pr_data?.workflow_state) === "Open PR" ? "In Progress" : statusRender(pr_data?.workflow_state) === "Approved PO" ? "Ordered" : ""}
                                </Badge>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-4">
                            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                                <div className="space-y-1">
                                    <Label className="text-slim text-red-300">Package:</Label>
                                    <p className="font-semibold">{pr_data?.work_package || "Custom"}</p>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-slim text-red-300">Date Created:</Label>
                                    <p className="font-semibold">{new Date(pr_data?.creation).toDateString()}</p>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-slim text-red-300">Created by:</Label>
                                    <p className="font-semibold">{pr_data?.owner}</p>
                                </div>
                            </div>

                            <div className="space-y-1 flex flex-col items-start justify-start">
                                <Label className="text-slim text-red-300 mb-4 block">Comments:</Label>
                                <Timeline
                                    className="w-full"
                                    mode={'left'}
                                    items={itemsTimelineList}
                                />
                            </div>
                        </CardContent>
                    </Card>
                    {role !== "Nirmaan Project Manager Profile" &&
                        <Card className="w-full">
                            <CardHeader>
                                <CardTitle className="text-xl text-red-600">Associated POs:</CardTitle>
                                <div className="overflow-x-auto">
                                    {po_data?.length === 0 ? <p>No POs generated as of now</p>
                                        :
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="bg-red-100">
                                                    <TableHead className="w-[40%]">PO Number</TableHead>
                                                    <TableHead className="w-[30%]">Date Created</TableHead>
                                                    <TableHead className="w-[30%]">Status</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {po_data?.map((po) => {
                                                    return (
                                                        <TableRow key={po.name}>
                                                            <TableCell>
                                                                <Link to={po?.name.replaceAll("/", "&=")} className="text-blue-500 underline">{po?.name}</Link>
                                                            </TableCell>
                                                            <TableCell>{formatDate(po.creation)}</TableCell>
                                                            <TableCell><Badge variant="outline">{po.status}</Badge></TableCell>
                                                        </TableRow>
                                                    )
                                                })}
                                            </TableBody>
                                        </Table>}
                                </div>
                            </CardHeader>
                        </Card>}
                    <Card className="w-full">
                        <CardHeader>
                            <CardTitle className="text-xl text-red-600">Associated Delivery Notes:</CardTitle>
                            <div className="overflow-x-auto">
                                {po_data?.filter(item => ["Dispatched", "Delivered", "Partially Delivered"].includes(item.status)).length === 0 ? <p>No DNs generated as of now</p>
                                    :
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="bg-red-100">
                                                <TableHead className="w-[40%]">DN No.</TableHead>
                                                <TableHead className="w-[30%]">Date Created</TableHead>
                                                <TableHead className="w-[30%]">Status</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {po_data?.filter(item => ["Dispatched", "Delivered", "Partially Delivered"].includes(item.status)).map((po) => {
                                                return (
                                                    <TableRow key={po.name}>
                                                        <TableCell>
                                                            <Link to={`dn/${po?.name.replaceAll("/", "&=").replace("PO", "DN")}`} className="text-blue-500 underline">DN-{po?.name.split("/")[1]}</Link>
                                                        </TableCell>
                                                        <TableCell>{formatDate(po.creation)}</TableCell>
                                                        <TableCell><Badge variant="outline">{po.status}</Badge></TableCell>
                                                    </TableRow>
                                                )
                                            })}
                                        </TableBody>
                                    </Table>}
                            </div>
                        </CardHeader>
                    </Card>
                </div>
                <div className="flex flex-col flex-1 gap-4">
                    {/* Order Details Card */}
                    <Card className="w-full">
                        <CardHeader>
                            <CardTitle className="text-xl text-red-600">Order Details</CardTitle>
                            {/* Iterate over categories derived from category_list JSON */}
                            {categories.map((cat) => {
                                const itemsForCategory = categoryItemsToDisplay(cat.name);
                                const reqItemsForCategory = requestedItems(cat.name);

                                if (itemsForCategory.length === 0 && reqItemsForCategory.length === 0) {
                                    return null; // Don't render table if no items for this category
                                }
                                // console.log("itemsForCategory",itemsForCategory)
                              
                                return (
                                    <div className="overflow-x-auto w-full" key={cat.name}>
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="bg-red-100">
                                                    <TableHead className="w-[50%]">
                                                        <span className="text-red-700 pr-1 font-extrabold">{cat.name /* Display category name */}</span>
                                                    </TableHead>
                                                    <TableHead className="w-[15%]">UOM</TableHead>
                                                    <TableHead className="w-[15%]">Qty</TableHead>
                                                    <TableHead className="w-[20%]">Status</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {/* Display "normal" items */}
                                                {itemsForCategory.map((item: ProcurementRequestItemDetail) => (
                                                    <TableRow key={item.name /* Use child row name as key */}>
                                                        <TableCell>
                                                            {item.item_name /* Display item_name */}
                                                            {item.make && ( /* Display make if present */
                                                                <span className="ml-1 text-red-700 font-light text-xs">({item.make})</span>
                                                            )}
                                                            <div className="flex gap-1 pt-2 items-start">
                                                                <MessageCircleMore className="w-6 h-6 text-blue-400 flex-shrink-0" />
                                                                <p className={`text-xs ${!item.comment ? "text-gray-400" : "tracking-wide"}`}>{item.comment || "No Comments"}</p>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>{item.unit}</TableCell>
                                                        <TableCell>{item.quantity}</TableCell>
                                                        <TableCell><Badge variant="outline">
                                                            {/* {item.status === "Pending" ? "Pending" : getItemStatus(item)} */}
                                                            {item.status==="Approved"?"ordered":"In Progress"}
                                                            </Badge></TableCell>
                                                    </TableRow>
                                                ))}
                                                {/* Display "requested" items */}
                                                {reqItemsForCategory.map((item: ProcurementRequestItemDetail) => (
                                                    <TableRow className="bg-yellow-50" key={item.name /* Use child row name as key */}>
                                                        <TableCell>
                                                            {item.item_name /* Display item_name */}
                                                            {item.make && ( /* Display make if present */
                                                                <span className="ml-1 text-red-700 font-light text-xs">({item.make})</span>
                                                            )}
                                                            <div className="flex gap-1 pt-2 items-start">
                                                                <MessageCircleMore className="w-6 h-6 text-blue-400 flex-shrink-0" />
                                                                <p className={`text-xs ${!item.comment ? "text-gray-400" : "tracking-wide"}`}>{item.comment || "No Comments"}</p>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>{item.unit}</TableCell>
                                                        <TableCell>{item.quantity}</TableCell>
                                                        <TableCell><Badge variant="outline">Requested</Badge></TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                );
                            })}
                        </CardHeader>
                    </Card>

                    {/* Deleted Items Card */}
                    {deletedItems.length > 0 && (
                        <Card className="w-full">
                            <CardHeader>
                                <CardTitle className="text-xl text-red-600">Deleted Items</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-red-100">
                                            <TableHead className="w-[50%]">Item</TableHead>
                                            <TableHead className="w-[15%]">UOM</TableHead>
                                            <TableHead className="w-[15%]">Qty</TableHead>
                                            <TableHead className="w-[20%]">Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {deletedItems.map((item: ProcurementRequestItemDetail) => (
                                            <TableRow key={item.name /* Use child row name as key */}>
                                                <TableCell className="text-red-700 font-light">
                                                    {item.item_name /* Display item_name */}
                                                    {item.make && ( /* Display make if present */
                                                        <span className="ml-1">({item.make})</span>
                                                    )}
                                                </TableCell>
                                                <TableCell>{item.unit}</TableCell>
                                                <TableCell>{item.quantity}</TableCell>
                                                <TableCell>Deleted</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );

}

export const Component = PRSummary;