import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { SentBackRequest } from "@/components/procurement/sent-back-request";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { usePRorSBDelete } from "@/hooks/usePRorSBDelete";
import { useUserData } from "@/hooks/useUserData";
import { ApprovePR } from "@/pages/ProcurementRequests/ApproveNewPR/approve-pr";
import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { Projects } from "@/types/NirmaanStack/Projects";
import { UserContext } from "@/utils/auth/UserProvider";
import { formatDate } from "@/utils/FormatDate";
import getThreeMonthsLowestFiltered from "@/utils/getThreeMonthsLowest";
import { parseNumber } from "@/utils/parseNumber";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { ColumnDef } from "@tanstack/react-table";
import { Radio } from "antd";
import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { Trash2 } from "lucide-react";
import React, { useCallback, useContext, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { EstimatedPriceHoverCard } from "../../../components/procurement/EstimatedPriceHoverCard";
import { TableSkeleton } from "../../../components/ui/skeleton";

export const ProcurementRequests : React.FC = () => {

    const [searchParams] = useSearchParams();

    const { role, user_id } = useUserData()
    const navigate = useNavigate()

    const [tab, setTab] = useState<string>(searchParams.get("tab") || (["Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role) ? "Approve PR" : "New PR Request"));

    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error, mutate: prListMutate } = useFrappeGetDocList<ProcurementRequest>("Procurement Requests",
        {
            fields: ['name', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', "category_list", 'creation', 'modified'],
            filters: [["workflow_state", "=", tab === "New PR Request" ? "Approved" : "In Progress"]],
            limit: 10000,
            orderBy: { field: "modified", order: "desc" }
        },
        tab ? undefined :  null
    );

    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
        limit: 1000
    })

    const { data: quote_data } = useFrappeGetDocList<ApprovedQuotations>("Approved Quotations",
        {
            fields: ["*"],
            limit: 100000
        });

    useFrappeDocTypeEventListener("Procurement Requests", async (event) => {
        await prListMutate()
    })

    const getTotal = useCallback((order_id: string) => {
        let total: number = 0;
        let usedQuotes = {}
        const orderData = procurement_request_list?.find(item => item.name === order_id)?.procurement_list;
        // console.log("orderData", orderData)
        orderData?.list.map((item) => {
            const minQuote = getThreeMonthsLowestFiltered(quote_data, item.name)
            if (minQuote) {
                const estimateQuotes = quote_data
                    ?.filter(value => value.item_id === item.name && parseNumber(value.quote) === minQuote)?.sort((a, b) => new Date(b.modified) - new Date(a.modified)) || [];
                const latestQuote = estimateQuotes.length ? estimateQuotes[0] : null;
                usedQuotes = { ...usedQuotes, [item.item]: { items: latestQuote, amount: minQuote, quantity: item.quantity }}
            }
            total += minQuote * item.quantity;
        })
        return { total: total || "N/A", usedQuotes: usedQuotes }
    }, [quote_data, procurement_request_list])

    const { notifications, mark_seen_notification } = useNotificationStore()

    const project_values = useMemo(() => projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || [], [projects])

    const { db } = useContext(FrappeContext) as FrappeConfig

    const handleNewPRSeen = (notification : NotificationType | undefined) => {
        if (notification) {
            mark_seen_notification(db, notification)
        }
    }

    // const updateURL = (key, value) => {
    //     const url = new URL(window.location);
    //     url.searchParams.set(key, value);
    //     window.history.pushState({}, "", url);
    // };

    const onClick = (value : string) => {
        if (tab === value) return;
        setTab(value);
        navigate(`/procurement-requests?tab=${value}`)
        // updateURL("tab", newTab);
    };

    const {deleteDialog, toggleDeleteDialog} = useContext(UserContext);

    const {handleDeletePR, deleteLoading} = usePRorSBDelete(prListMutate);

    const [deleteFlagged, setDeleteFlagged] = useState<ProcurementRequest | null>(null);

    const { prCounts, adminPrCounts, newSBCounts, adminNewSBCounts } = useDocCountStore()

    const sentBackTabs = useMemo(() => [
        ...(["Nirmaan Procurement Executive Profile", "Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role) ? [
                {
                    label: (
                        <div className="flex items-center">
                            <span>Sent Back</span>
                            <span className="ml-2 text-xs font-bold">
                                {(role === "Nirmaan Admin Profile" || user_id === "Administrator") ? adminNewSBCounts.rejected : newSBCounts.rejected}
                            </span>
                        </div>
                    ),
                    value: "Rejected",
                },
                {
                    label: (
                        <div className="flex items-center">
                            <span>Skipped PR</span>
                            <span className="ml-2 rounded text-xs font-bold">
                                {(role === "Nirmaan Admin Profile" || user_id === "Administrator") ? adminNewSBCounts.delayed : newSBCounts.delayed}
                            </span>
                        </div>
                    ),
                    value: "Delayed",
                },
                {
                    label: (
                        <div className="flex items-center">
                            <span>Rejected PO</span>
                            <span className="ml-2 rounded text-xs font-bold">
                                {(role === "Nirmaan Admin Profile" || user_id === "Administrator") ? adminNewSBCounts.cancelled : newSBCounts.cancelled}
                            </span>
                        </div>
                    ),
                    value: "Cancelled",
                },
            ] : [])
    ], [role, prCounts, adminPrCounts, newSBCounts, adminNewSBCounts])

    const adminTabs = useMemo(() => [
        ...(["Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role) ? [
            {
                label: (
                    <div className="flex items-center">
                        <span>Approve PR</span>
                        <span className="ml-2 text-xs font-bold">
                            {(role === "Nirmaan Admin Profile") ? adminPrCounts.pending : prCounts.pending}
                        </span>
                    </div>
                ),
                value: "Approve PR",
            },
        ] : []),
    ], [role, prCounts, adminPrCounts])

    const items = useMemo(() => [
        ...(["Nirmaan Procurement Executive Profile", "Nirmaan Admin Profile",  "Nirmaan Project Lead Profile"].includes(role) ? [
        {
            label: (
                <div className="flex items-center">
                    <span>New PR Request</span>
                    <span className="ml-2 text-xs font-bold">
                        {(role === "Nirmaan Admin Profile") ? adminPrCounts.approved : prCounts.approved}
                    </span>
                </div>
            ),
            value: "New PR Request",
        },
        {
            label: (
                <div className="flex items-center">
                    <span>In Progress</span>
                    <span className="ml-2 text-xs font-bold">
                        {(role === "Nirmaan Admin Profile") ? adminPrCounts.inProgress : prCounts.inProgress}
                    </span>
                </div>
            ),
            value: "In Progress",
        },
    ] : []),
    ], [role, adminPrCounts, prCounts])

    const columns: ColumnDef<ProcurementRequest>[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="PR Number" />
                    )
                },
                cell: ({ row }) => {
                    const data = row.original
                    const prId = data?.name
                    const isNew = notifications.find(
                        (item) => item.docname === prId && item.seen === "false" && item.event_id === "pr:approved"
                    )
                    return (
                        <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
                            {isNew && (
                                <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
                            )}
                            <div className="flex items-center gap-2">
                                <Link
                                    className="underline hover:underline-offset-2"
                                    to={`${prId}?tab=${tab}`}
                                >
                                    {prId?.slice(-4)}
                                </Link>
                                <ItemsHoverCard order_list={data?.procurement_list?.list} isPR/>
                            </div>
                        </div>
                    )
                }
            },
            {
                accessorKey: "creation",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Date" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {formatDate(row.getValue("creation")?.split(" ")[0])}
                        </div>
                    )
                }
            },
            {
                accessorKey: "project",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Project" />
                    )
                },
                cell: ({ row }) => {
                    const project = project_values.find(
                        (project) => project.value === row.getValue("project")
                    )
                    return (
                        <div className="font-medium">
                            {project?.label || "--"}
                        </div>
                    )
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                },
            },
            {
                accessorKey: "work_package",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Package" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("work_package")}
                        </div>
                    )
                }
            },
            {
                accessorKey: "category_list",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Categories" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="flex flex-col gap-1 items-start justify-center">
                            {row.getValue("category_list")?.list?.map((obj) => <Badge className="inline-block">{obj["name"]}</Badge>)}
                        </div>
                    )
                }
            },
            {
                accessorKey: "total",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Estimated Price" />
                    )
                },
                cell: ({ row }) => {
                    const total = getTotal(row.getValue("name")).total
                    const prUsedQuotes = getTotal(row.getValue("name"))?.usedQuotes
                    return (
                        total === "N/A" ? (
                            <div className="font-medium">
                                N/A
                            </div>
                        ) : (
                            <EstimatedPriceHoverCard total={total} prUsedQuotes={prUsedQuotes} />
                        )
                    )
                }
            },
            ...((tab === "New PR Request" && ["Nirmaan Project Lead Profile", "Nirmaan Admin Profile"].includes(role)) ? [
                {
                    id: "deleteOption",
                    cell: ({row}) => {
                        return (
                            <Trash2 className="text-primary cursor-pointer" onClick={() => {
                                setDeleteFlagged(row.original)
                                toggleDeleteDialog()
                            }} />
                        )
                    }
                }
            ] : []),
        ],
        [project_values, procurement_request_list]
    )

    if (procurement_request_list_error || projects_error) {
        console.log("Error in Procurement-approved.tsx", procurement_request_list_error?.message, projects_error?.message)
        toast({
            title: "Error!",
            description: `Error ${procurement_request_list_error?.message || projects_error?.message}`,
            variant: "destructive"
        })
    }

    return (
        <>
        <div className="flex-1 space-y-4">
            <div className="flex items-center max-md:items-start gap-4 max-md:flex-col"> 
            {adminTabs && (
                    <Radio.Group
                        block
                        options={adminTabs}
                        optionType="button"
                        buttonStyle="solid"
                        value={tab}
                        onChange={(e) => onClick(e.target.value)}
                    />
                )}

                {items && (
                    <Radio.Group
                        block
                        options={items}
                        optionType="button"
                        buttonStyle="solid"
                        value={tab}
                        onChange={(e) => onClick(e.target.value)}
                    />
                )}

                {sentBackTabs && (
                    <Radio.Group
                        block
                        options={sentBackTabs}
                        optionType="button"
                        buttonStyle="solid"
                        value={tab}
                        onChange={(e) => onClick(e.target.value)}
                    />
                )}
            </div>

            <AlertDialog open={deleteDialog} onOpenChange={toggleDeleteDialog}>
                <AlertDialogContent className="py-8 max-sm:px-12 px-16 text-start overflow-auto">
                    <AlertDialogHeader className="text-start">
                        <AlertDialogTitle className="text-center">
                            Delete Procurement Request
                        </AlertDialogTitle>
                            <AlertDialogDescription>Are you sure you want to delete this PR : {deleteFlagged?.name}?</AlertDialogDescription>
                        <div className="flex gap-2 items-center pt-4 justify-center">
                            {deleteLoading ? <TailSpin color="red" width={40} height={40} /> : (
                                <>
                                    <AlertDialogCancel className="flex-1" asChild>
                                        <Button variant={"outline"} className="border-primary text-primary">Cancel</Button>
                                    </AlertDialogCancel>
                                     <Button
                                        onClick={() => handleDeletePR(deleteFlagged?.name || "")}
                                        className="flex-1">
                                            Confirm
                                    </Button>
                                </>
                            )}
                        </div>

                    </AlertDialogHeader>
                </AlertDialogContent>
            </AlertDialog>
                            
            {tab === "Approve PR" ? (
                <ApprovePR />
            ) :
            ["Rejected", "Delayed", "Cancelled"].includes(tab) ? (
                <SentBackRequest />
            ) :
             (
                (projects_loading || procurement_request_list_loading) ? (<TableSkeleton />) : (
                    <DataTable columns={columns} data={procurement_request_list || []} project_values={project_values} />
                )
            )}
            </div>
        </>
    )
}