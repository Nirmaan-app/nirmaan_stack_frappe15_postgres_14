import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { useContext, useMemo } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Badge } from "../ui/badge";
import { useToast } from "../ui/use-toast";
import { TableSkeleton } from "../ui/skeleton";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useNotificationStore } from "@/zustand/useNotificationStore";

interface ApprovedSRListProps {
    for_vendor?: string
}


export const ApprovedSRList = ({ for_vendor = undefined }: ApprovedSRListProps) => {
    const sr_filters: any = [["status", "=", "Approved"]]
    if (for_vendor !== undefined) {
        sr_filters.push(["vendor", "=", for_vendor])
    }
    const { data: service_list, isLoading: service_list_loading, error: service_list_error, mutate: serviceListMutate } = useFrappeGetDocList("Service Requests",
        {
            fields: ["*"],
            filters: sr_filters,
            limit: 1000,
            orderBy: { field: "modified", order: "desc" }
        });

    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
        limit: 1000
    })

    const { data: projectPayments, isLoading: projectPaymentsLoading, error: projectPaymentsError, mutate: projectPaymentsMutate } = useFrappeGetDocList("Project Payments", {
        fields: ["*"],
        limit: 100000
    })


    useFrappeDocTypeEventListener("Service Requests", async (event) => {
        await serviceListMutate()
    })

    const project_values = projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || []

    const getTotal = (order_id: string) => {
        let total: number = 0;
        const orderData = service_list?.find(item => item.name === order_id)?.service_order_list;
        orderData?.list.map((item) => {
            const price = item.rate * item.quantity;
            total += price ? parseFloat(price) : 0
        })
        return total;
    }

    const getTotalAmountPaid = (id) => {
        const payments = projectPayments?.filter((payment) => payment.document_name === id);


        return payments?.reduce((acc, payment) => {
            const amount = parseFloat(payment.amount || 0)
            const tds = parseFloat(payment.tds || 0)
            return acc + amount;
        }, 0);
    }

    const { notifications, mark_seen_notification } = useNotificationStore()

    const { db } = useContext(FrappeContext) as FrappeConfig

    const handleNewPRSeen = (notification) => {
        if (notification) {
            mark_seen_notification(db, notification)
        }
    }

    const columns = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="SR Number" />
                    )
                },
                cell: ({ row }) => {
                    const srId = row.getValue("name")
                    const isNew = notifications.find(
                        (item) => item.docname === srId && item.seen === "false" && item.event_id === "sr:approved"
                    )
                    return (
                        <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
                            {isNew && (
                                <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
                            )}
                            <Link
                                className="underline hover:underline-offset-2"
                                to={for_vendor === undefined ? `${srId}` : `/service-requests/${srId}`}
                            >
                                {srId?.slice(-5)}
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
                        </div>
                    )
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                },
            },
            // {
            //     accessorKey: "work_package",
            //     header: ({ column }) => {
            //         return (
            //             <DataTableColumnHeader column={column} title="Package" />
            //         )
            //     },
            //     cell: ({ row }) => {
            //         return (
            //             <div className="font-medium">
            //                 {row.getValue("work_package")}
            //             </div>
            //         )
            //     }
            // },
            {
                accessorKey: "service_category_list",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Categories" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="flex flex-col gap-1 items-start justify-center">
                            {row.getValue("service_category_list").list.map((obj) => <Badge className="inline-block">{obj["name"]}</Badge>)}
                        </div>
                    )
                }
            },
            {
                accessorKey: "total",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Total PO Amt" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {formatToIndianRupee(getTotal(row.getValue("name")))}
                        </div>
                    )
                }
            },
            {
                id: "Amount_paid",
                header: "Amt Paid",
                cell: ({ row }) => {
                    const data = row.original
                    const amountPaid = getTotalAmountPaid(data?.name);
                    return <div className="font-medium">
                        {formatToIndianRupee(amountPaid)}
                    </div>
                },
            },

        ],
        [project_values, service_list, projectPayments]
    )
    const { toast } = useToast()

    if (service_list_error || projects_error) {
        console.log("Error in approved-sr-list.tsx", service_list_error?.message, projects_error?.message)
        toast({
            title: "Error!",
            description: `Error ${service_list_error?.message || projects_error?.message}`,
            variant: "destructive"
        })
    }

    return (
        <div className="flex-1 space-y-4">
            {/* {for_vendor === undefined && <div className="flex items-center justify-between space-y-2">
                <h2 className="text-base pt-1 pl-2 font-bold tracking-tight">Approved SR</h2>
            </div>} */}
            {(projects_loading || service_list_loading) ? (<TableSkeleton />) : (
                <DataTable columns={columns} data={service_list || []} project_values={project_values} />
            )}
        </div>
    )
}