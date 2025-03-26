import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { EstimatedPriceHoverCard } from "@/components/procurement/EstimatedPriceHoverCard";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { Projects } from "@/types/NirmaanStack/Projects";
import { formatDate } from "@/utils/FormatDate";
import getThreeMonthsLowestFiltered from "@/utils/getThreeMonthsLowest";
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { ColumnDef } from "@tanstack/react-table";
import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import React, { useCallback, useContext, useMemo } from "react";
import { Link } from "react-router-dom";

export const ApprovePR : React.FC = () => {

    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error, mutate: pr_list_mutate } = useFrappeGetDocList<ProcurementRequest>("Procurement Requests",
        {
            fields: ["*"],
            filters: [["workflow_state", "=", "Pending"]],
            limit: 1000,
            orderBy: { field: "modified", order: "desc" }
        },
    );
    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects",
        {
            fields: ["name", "project_name"],
            limit: 1000
        })
    const { data: quote_data } = useFrappeGetDocList<ApprovedQuotations>("Approved Quotations",
        {
            fields: ["*"],
            limit: 100000
        });

    useFrappeDocTypeEventListener("Procurement Requests", async (data) => {
        await pr_list_mutate()
    })

    const { toast } = useToast()

    const { notifications, mark_seen_notification } = useNotificationStore()

    // console.log('quotes', quote_data)

    const getTotal = useCallback((order_id: string) => {
        let total: number = 0;
        let usedQuotes = {}
        const orderData = procurement_request_list?.find(item => item.name === order_id)?.procurement_list;
        orderData?.list?.filter((i) => i.status !== "Request")?.map((item: any) => {
            const minQuote = getThreeMonthsLowestFiltered(quote_data, item.name)
            if (minQuote) {
                const estimateQuotes = quote_data
                    ?.filter(value => value.item_id === item.name && parseNumber(value.quote) === minQuote)?.sort((a, b) => new Date(b.modified) - new Date(a.modified)) || [];
                const latestQuote = estimateQuotes?.length ? estimateQuotes[0] : null;
                usedQuotes = { ...usedQuotes, [item.item]: { items: latestQuote, amount: minQuote, quantity: item.quantity } }
            }
            total += minQuote * item.quantity;
        })
        return { total: total || "N/A", usedQuotes: usedQuotes }
    }, [procurement_request_list, quote_data])

    const project_values = projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || []

    const { db } = useContext(FrappeContext) as FrappeConfig
    const handleNewPRSeen = useCallback((notification : NotificationType | undefined) => {
        if (notification) {
            mark_seen_notification(db, notification)
        }
    }, [db, mark_seen_notification])

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
                        (item) => item.docname === prId && item.seen === "false" && item.event_id === "pr:new"
                    )
                    return (
                        <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
                            {isNew && (
                                <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
                            )}
                            <div className="flex items-center gap-1">
                                <Link
                                    className="underline hover:underline-offset-2"
                                    to={`${prId}?tab=Approve PR`}
                                >
                                    {prId?.slice(-4)}
                                </Link>
                                <ItemsHoverCard order_list={data?.procurement_list?.list} isPR/>
                            </div>
                        </div>
                    )
                },
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
                    const categories : Set<string> = new Set()
                    const categoryList : {name : string}[]= row.getValue("category_list")?.list || []
                    categoryList?.forEach((i) => {
                        categories.add(i?.name)
                    })

                    return (
                        <div className="flex flex-col gap-1 items-start justify-center">
                            {Array.from(categories)?.map((obj) => <Badge className="inline-block">{obj}</Badge>)}
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
            }

        ],
        [project_values, notifications, procurement_request_list, notifications]
    )

    if (procurement_request_list_error || projects_error) {
        console.log("Error in approve-pr.tsx", procurement_request_list_error?.message, projects_error?.message)
        toast({
            title: "Error!",
            description: `Error ${procurement_request_list_error?.message || projects_error?.message}`,
            variant: "destructive"
        })
    }
    return (
        <div className="flex-1 md:space-y-4">
            {projects_loading || procurement_request_list_loading ? (<TableSkeleton />)
                :
                (<DataTable columns={columns} data={procurement_request_list || []} project_values={project_values} />)}
        </div>
    )
}

export default ApprovePR;