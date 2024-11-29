import { useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Badge } from "../ui/badge";
import { useToast } from "../ui/use-toast";
import { TableSkeleton } from "../ui/skeleton";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";


type PRTable = {
    name: string
    project: string
    creation: string
    work_package: string
    category_list: {}
}

export const SelectVendorList = () => {
    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error, mutate: prListMutate } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'category_list', 'creation', 'modified'],
            filters: [["workflow_state", "=", "Quote Updated"]],
            limit: 1000,
            orderBy: {field: "modified", order: "desc"}
        });

    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
        limit: 1000
    })

    const { data: quote_data } = useFrappeGetDocList("Approved Quotations",
        {
            fields: ["*"],
            limit: 2000
        });
    
    useFrappeDocTypeEventListener("Procurement Requests", async (event) => {
        await prListMutate()
    })

    const project_values = projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || []

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
                ?.filter(value => value.item_id === item.name && parseFloat(value.quote) === parseFloat(minQuote))?.sort((a, b) => new Date(b.modified) - new Date(a.modified));
                const latestQuote = estimateQuotes?.length > 0 ? estimateQuotes[0] : null;
                usedQuotes = {...usedQuotes, [item.item] : {items : latestQuote, amount : minQuote, quantity:  item.quantity}}
            }
            total += (minQuote ? parseFloat(minQuote) : 0) * item.quantity;
        })
        return {total : total || "N/A", usedQuotes : usedQuotes}
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
                    return (
                        <div className="font-medium">
                            <Link className="underline hover:underline-offset-2" to={`${row.getValue("name")}`}>
                                {row.getValue("name")?.slice(-4)}
                            </Link>
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
                                            <p className="font-semibold">{item}({quotes?.quantity} * ₹{quotes?.amount} = {formatToIndianRupee(quotes?.quantity * quotes?.amount)})</p>
                                            <ul className="list-disc ">
                                            {quotes?.items ? (
                                                        <li className="ml-4 text-gray-600 underline hover:underline-offset-2" key={quotes?.items?.name}><Link to={`/debug/${quotes?.items?.procurement_order?.replaceAll("/", "&=")}`}>{quotes?.items?.procurement_order}</Link></li>
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
        [project_values]
    )
    const { toast } = useToast()

    if (procurement_request_list_error || projects_error) {
        console.log("Error in select-vendor-list.tsx", procurement_request_list_error?.message, projects_error?.message)
        toast({
            title: "Error!",
            description: `Error ${procurement_request_list_error?.message || projects_error?.message}`,
            variant: "destructive"
        })
    }

    return (
        <div className="flex-1 md:space-y-4">
            <div className="flex items-center justify-between space-y-2">
                <h2 className="text-base pt-1 pl-2 font-bold tracking-tight">Choose Vendor PR</h2>
            </div>
            {(projects_loading || procurement_request_list_loading) ? (<TableSkeleton />) : (
                <DataTable columns={columns} data={procurement_request_list || []} project_values={project_values} />
            )}
        </div>
    )
}