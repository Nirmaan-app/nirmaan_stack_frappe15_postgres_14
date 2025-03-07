import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { Category, ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { Projects } from "@/types/NirmaanStack/Projects";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useNotificationStore } from "@/zustand/useNotificationStore";
import { ColumnDef } from "@tanstack/react-table";
import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { useContext, useMemo } from "react";
import { Link } from "react-router-dom";

export const ApproveSelectVendor = () => {
    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error, mutate: pr_list_mutate } = useFrappeGetDocList<ProcurementRequest>("Procurement Requests",
        {
            fields: ['name', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', 'category_list', 'creation', "modified"],
            filters: [
                ["workflow_state", "in", ["Vendor Selected", "Partially Approved"]]
            ],
            limit: 1000,
            orderBy: {field: "modified", order: "desc"}
        });

    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
        limit: 1000
    })


    const getTotal = (order_id: string) => {
        let total: number = 0;
        const allItems = procurement_request_list?.find(item => item?.name === order_id)?.procurement_list?.list;
        const orderData = allItems?.filter((item) => item.status === "Pending")
        orderData?.map((item) => {
            total += (item.quote || 0) * item.quantity;
        })
        return total;
    }

    const project_values = projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || []

    useFrappeDocTypeEventListener("Procurement Requests", async () => {
        await pr_list_mutate()
    })

    const {notifications, mark_seen_notification} = useNotificationStore()

    const {db} = useContext(FrappeContext) as FrappeConfig
    const handleNewPRSeen = (notification) => {
        if(notification) {
            mark_seen_notification(db, notification)
        }
    }

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
                    const prId : string = row.getValue("name")
                    const isNew = notifications.find(
                        (item) => item.docname === prId && item.seen === "false" && item.event_id === "pr:vendorSelected"
                    )
                    return (
                        <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
                            {isNew && (
                                <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
                            )}
                            <Link
                                className="underline hover:underline-offset-2"
                                to={`/approve-po/${prId}`}
                            >
                                {prId?.slice(-4)}
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
                     const creation : string = row.getValue("creation")
                    return (
                        <div className="font-medium">
                            {formatDate(creation.split(" ")[0])}
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
                    const categories : { list : Category[] } = row.getValue("category_list")
                    return (
                        <div className="flex flex-col gap-1 items-start justify-center">
                            {categories.list.map((obj) => <Badge className="inline-block">{obj.name}</Badge>)}
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
                cell: ({row}) => {
                    const id : string = row.getValue("name")
                    return (
                        <div className="font-medium">
                            {getTotal(id) === 0 ? "N/A" : formatToIndianRupee(getTotal(id))}
                        </div>
                    )
                }
            }

        ],
        [procurement_request_list, notifications, project_values]
    )

    const { toast } = useToast()

    if (procurement_request_list_error || projects_error) {
        console.log("Error in approve-select-vendor.tsx", procurement_request_list_error?.message, projects_error?.message)
        toast({
            title: "Error!",
            description: `Error ${procurement_request_list_error?.message || projects_error?.message}`,
            variant: "destructive"
        })
    }

    return (
        <div className="flex-1 md:space-y-4">
            {(projects_loading || procurement_request_list_loading) ? (<TableSkeleton />) : (
                <DataTable columns={columns} data={procurement_request_list?.filter((item) => item.procurement_list?.list?.some((i) => i.status === "Pending")) || []} project_values={project_values} />
            )}
        </div>
    )
}