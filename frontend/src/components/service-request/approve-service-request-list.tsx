import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { useContext, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Projects } from "@/types/NirmaanStack/Projects";
import { useToast } from "@/components/ui/use-toast";
import { TableSkeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useNotificationStore } from "@/zustand/useNotificationStore";


type PRTable = {
    name: string
    project_name: string
    creation: string
    category: string
}

export const ApproveSelectSR = () => {
    const { data: service_request_list, isLoading: service_request_list_loading, error: service_request_list_error, mutate: sr_list_mutate } = useFrappeGetDocList("Service Requests",
        {
            fields: ["*"],
            filters: [["status", "=", "Vendor Selected"]],
            limit: 1000,
            orderBy: {field: "creation", order : "desc"}
        }
    );

    useFrappeDocTypeEventListener("Service Requests", async () => {
        await sr_list_mutate()
    })

    // console.log("sbdata", sent_back_list)

    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
        limit: 1000
    })

    const project_values = projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || []

    const getTotal = (order_id: string) => {
        let total: number = 0;

        // console.log("service_request_list", service_request_list)
        const orderData = service_request_list?.find(item => item.name === order_id)?.service_order_list;
        orderData?.list.map((item) => {
            const price = (item?.rate * item?.quantity);
            total += price ? parseFloat(price) : 0
        })
        return total;
    }

    const {notifications, mark_seen_notification} = useNotificationStore()

    const {db} = useContext(FrappeContext) as FrappeConfig

    const handleNewPRSeen = (notification) => {
        if(notification) {
            mark_seen_notification(db, notification)
        }
    }

    console.log("service list", service_request_list)
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
                    const srId = row.getValue("name")
                    const isNew = notifications.find(
                        (item) => item.docname === srId && item.seen === "false" && item.event_id === "sr:vendorSelected"
                    )
                    return (
                        <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
                            {isNew && (
                                <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
                            )}
                            <Link
                                className="underline hover:underline-offset-2"
                                to={`${srId}`}
                            >
                                {srId?.slice(-5)}
                            </Link>
                        </div>
                    )
                }
            },
            // {
            //     accessorKey: "procurement_request",
            //     header: ({ column }) => {
            //         return (
            //             <DataTableColumnHeader column={column} title="PR Number" />
            //         )
            //     },
            //     cell: ({ row }) => {
            //         return (
            //             <div className="font-medium">
            //                 {row.getValue("procurement_request")?.slice(-4)}
            //             </div>
            //         )
            //     }
            // },
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
        [service_request_list, project_values]
    )

    // let filteredList;

    // if (sent_back_list) {
    //     filteredList = sent_back_list.filter((item) => item.item_list?.list?.some((i) => i.status === "Pending"))
    // }

    const { toast } = useToast()

    if (service_request_list_error || projects_error) {
        console.log("Error in approve-select-sent-back.tsx", service_request_list_error?.message, projects_error?.message)
        toast({
            title: "Error!",
            description: `Error ${service_request_list_error?.message || projects_error?.message}`,
            variant: "destructive"
        })
    }


    return (
            <div className="flex-1 md:space-y-4">
                <div className="flex items-center justify-between space-y-2 pl-2">
                    <h2 className="text-lg font-bold tracking-tight">Approve Sent Back PO</h2>
                </div>
                {(service_request_list_loading || projects_loading) ? (<TableSkeleton />) : (
                    <DataTable columns={columns} data={service_request_list || []} project_values={project_values} />
                )}
            </div>
    )
}