import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { Projects } from "@/types/NirmaanStack/Projects";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useNotificationStore } from "@/zustand/useNotificationStore";
import { ColumnDef } from "@tanstack/react-table";
import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { useContext, useMemo } from "react";
import { Link } from "react-router-dom";


type PRTable = {
    name: string
    project_name: string
    creation: string
    category: string
}

export const ApproveSelectSentBack = () => {
    const { data: sent_back_list, isLoading: sent_back_list_loading, error: sent_back_list_error, mutate: sbListMutate } = useFrappeGetDocList("Sent Back Category",
        {
            fields: ["*"],
            filters: [["workflow_state", "in", ["Vendor Selected", "Partially Approved"]]],
            limit: 1000,
            orderBy: {field: "modified", order : "desc"}
        },
        "Sent Back Category(filters,in,Vendor Selected,Partially Approved)"
    );

    // console.log("sbdata", sent_back_list)

    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
        limit: 1000
    })

    const project_values = projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || []

    const getTotal = (order_id: string) => {
        let total: number = 0;
        const orderData = sent_back_list?.find(item => item.name === order_id)?.item_list;
        orderData?.list.map((item) => {
            const price = item.quote;
            total += (price ? parseFloat(price) : 0) * item.quantity;
        })
        return total;
    }

    useFrappeDocTypeEventListener("Sent Back Category", async (data) => {
        await sbListMutate()
    })

    const {notifications, mark_seen_notification} = useNotificationStore()

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
                        <DataTableColumnHeader column={column} title="ID" />
                    )
                },
                cell: ({ row }) => {
                    const sbId = row.getValue("name")
                    const isNew = notifications.find(
                        (item) => item.docname === sbId && item.seen === "false" && item.event_id === "sb:vendorSelected"
                    )
                    return (
                        <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
                            {isNew && (
                                <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
                            )}
                            <Link
                                className="underline hover:underline-offset-2"
                                to={`${sbId}?tab=Approve Sent Back PO`}
                            >
                                {sbId?.slice(-5)}
                            </Link>
                        </div>
                    )
                }
            },
            {
                accessorKey: "procurement_request",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="PR Number" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("procurement_request")?.slice(-4)}
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
                accessorKey: "total",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Estimated Price" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {formatToIndianRupee(getTotal(row.getValue("name")))}
                        </div>
                    )
                }
            }
        ],
        [sent_back_list, notifications, project_values]
    )

    let filteredList;

    if (sent_back_list) {
        filteredList = sent_back_list.filter((item) => item.item_list?.list?.some((i) => i.status === "Pending"))
    }

    const { toast } = useToast()

    if (sent_back_list_error || projects_error) {
        console.log("Error in approve-select-sent-back.tsx", sent_back_list_error?.message, projects_error?.message)
        toast({
            title: "Error!",
            description: `Error ${sent_back_list_error?.message || projects_error?.message}`,
            variant: "destructive"
        })
    }


    return (
            <div className="flex-1 md:space-y-4">
                {/* <div className="flex items-center justify-between space-y-2 pl-2">
                    <h2 className="text-lg font-bold tracking-tight">Approve Sent Back PO</h2>
                </div> */}
                {(sent_back_list_loading || projects_loading) ? (<TableSkeleton />) : (
                    <DataTable columns={columns} data={filteredList || []} project_values={project_values} />
                )}
                {/* <div className="overflow-x-auto">
                        <table className="min-w-full divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sent Back ID</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PR number</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estimated Price</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {sent_back_list?.map(item => (
                                    <tr key={item.name}>
                                        
                                        <td className="px-6 py-4 text-blue-600 whitespace-nowrap"><Link to={`/approve-sent-back/${item.name}`}>{item.name}</Link></td>
                                        <td className="px-6 py-4 whitespace-nowrap">{item.procurement_request.slice(-4)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {item.creation.split(" ")[0]}
                                        </td>
                                        <td className="px-6 py-4 text-sm whitespace-nowrap">{item.project_name}</td>
                                        <td className="px-6 py-4 text-sm whitespace-nowrap">{item.category}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                        {getTotal(item.name)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div> */}
            </div>
    )
}