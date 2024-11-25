import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { useContext, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Projects } from "@/types/NirmaanStack/Projects";
import { useToast } from "@/components/ui/use-toast";
import { TableSkeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useNotificationStore } from "@/zustand/useNotificationStore";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

type PRTable = {
    name: string
    project: string
    creation: string
    work_package: string
    category_list: {}
}

export const ApprovePR = () => {

    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error, mutate : pr_list_mutate } = useFrappeGetDocList("Procurement Requests",
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
    const { data: quote_data } = useFrappeGetDocList("Approved Quotations",
        {
            fields: ["*"],
            limit: 10000
        });
    const {data : po_data} = useFrappeGetDocList("Procurement Orders", {
        fields: ["*"],
        limit: 1000
    })

    useFrappeDocTypeEventListener("Procurement Requests", async (data) => {
        await pr_list_mutate()
    })

    const { toast } = useToast()

    const {notifications, mark_seen_notification} = useNotificationStore()

    console.log('quotes', quote_data)

    const getTotal = (order_id: string) => {
        let total: number = 0;
        let usedQuotes = {}
        const orderData = procurement_request_list?.find(item => item.name === order_id)?.procurement_list;
        orderData?.list.map((item: any) => {
            const quotesForItem = quote_data
                ?.filter(value => value.item_id === item.name && value.quote != null)
                ?.map(value => value.quote);
            let minQuote;
            if (quotesForItem && quotesForItem.length > 0) {
                minQuote = Math.min(...quotesForItem);
                const estimateQuotes = quote_data
                ?.filter(value => value.item_id === item.name && parseFloat(value.quote) === parseFloat(minQuote))
                usedQuotes = {...usedQuotes, [item.item] : {items : estimateQuotes, amount : minQuote * item.quantity}}
            }
            total += (minQuote ? parseFloat(minQuote) : 0) * item.quantity;
        })
        return {total : total || "N/A", usedQuotes : usedQuotes}
    }

    const project_values = projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || []

    const {db} = useContext(FrappeContext) as FrappeConfig
    const handleNewPRSeen = (notification) => {
        if(notification) {
            mark_seen_notification(db, notification)
        }
    }

    const columns: ColumnDef<PRTable>[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="PR Number" />
                    )
                },
                cell: ({ row }) => {
                    const prId = row.getValue("name")
                    const isNew = notifications.find(
                        (item) => item.docname === prId && item.seen === "false" && item.event_id === "pr:new"
                    )
                    return (
                        <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
                            {isNew && (
                                <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
                            )}
                            <Link
                                className="underline hover:underline-offset-2"
                                to={`/approve-order/${prId}`}
                            >
                                {prId?.slice(-4)}
                            </Link>
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
                    if (!project) {
                        return null;
                    }

                    return (
                        <div className="font-medium">
                            {project.label}
                            {/* {row.getValue("project")} */}
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
                            {row.getValue("category_list").list.map((obj) => <Badge className="inline-block">{obj["name"]}</Badge>)}
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
                    // console.log('usedQuotes', prUsedQuotes)
                    return (
                        total === "N/A" ? (
                            <div className="font-medium">
                                N/A
                            </div>
                        ) : (
                            <HoverCard>
                            <HoverCardTrigger>
                            <div className="font-medium underline">
                                {formatToIndianRupee(total)}
                            </div>
                            </HoverCardTrigger>
                            <HoverCardContent>
                                <div>
                                    <h2 className="text-primary font-semibold mb-4">PO Quotes used for calculating this Estimation!</h2>
                                    <div className="flex flex-col gap-4">
                                    {Object.entries(prUsedQuotes)?.map(([item, quotes]) => (
                                        <div key={item} className="flex flex-col gap-2">
                                            <p className="font-semibold">{item}({formatToIndianRupee(quotes?.amount)})</p>
                                            <ul className="list-disc ">
                                                {quotes?.items?.length ? (
                                                    quotes?.items?.map((quote) => (
                                                        <li className="ml-4 text-gray-600 underline hover:underline-offset-2" key={quote?.name}><Link to={`/debug/${quote?.procurement_order?.replaceAll("/", "&=")}`}>{quote?.procurement_order}</Link></li>
                                                    ))
                                                ) : (
                                                    <p className="text-xs">No previous Quotes found for this item</p>
                                                )}
                                            </ul>
                                        </div>
                                    ))}
                                    </div>
                                </div>
                            </HoverCardContent>
                        </HoverCard>
                        )
                    )
                }
            }

        ],
        [project_values, notifications, procurement_request_list]
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
            <div className="flex items-center justify-between space-y-2 pl-2">
                <h2 className="text-lg font-bold tracking-tight">Approve New PR</h2>
            </div>
            {/* <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2"> */}

            {projects_loading || procurement_request_list_loading ? (<TableSkeleton />)
                :
                (<DataTable columns={columns} data={procurement_request_list || []} project_values={project_values} />)}




            {/* <div className="overflow-x-auto">
                        <table className="min-w-full divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PR number</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Package</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estimated Price</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {procurement_request_lists?.map(item => (
                                    <tr key={item.name}>
                                        <td className="px-6 py-4 text-blue-600 whitespace-nowrap"><Link to={`/approve-order/${item.name}`}>{item.name.slice(-4)}</Link></td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {item.creation.split(" ")[0]}
                                        </td>
                                        <td className="px-6 py-4 text-sm whitespace-nowrap">{item.project}</td>
                                        <td className="px-6 py-4 text-sm whitespace-nowrap">{item.work_package}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                            N/A
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div> */}
        </div>
    )
}