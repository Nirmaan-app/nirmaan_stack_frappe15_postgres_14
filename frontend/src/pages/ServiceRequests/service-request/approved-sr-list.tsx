import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { getSRTotal, getTotalAmountPaid } from "@/utils/getAmounts";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { ColumnDef } from "@tanstack/react-table";
import { Filter, FrappeConfig, FrappeContext, FrappeDoc, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { useCallback, useContext, useMemo } from "react";
import { Link } from "react-router-dom";

interface ApprovedSRListProps {
    for_vendor?: string
}

export const ApprovedSRList : React.FC<ApprovedSRListProps> = ({ for_vendor = undefined }) => {
    const sr_filters: Filter<FrappeDoc<ServiceRequests>>[] | undefined = [["status", "=", "Approved"]]
    if (for_vendor) {
        sr_filters.push(["vendor", "=", for_vendor])
    }
    const { data: service_list, isLoading: service_list_loading, error: service_list_error, mutate: serviceListMutate } = useFrappeGetDocList<ServiceRequests>("Service Requests",
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

    const { data: projectPayments, isLoading: projectPaymentsLoading } = useFrappeGetDocList<ProjectPayments>("Project Payments", {
        fields: ["*"],
        limit: 100000
    })

    const { data: vendorsList, isLoading: vendorsListLoading } = useFrappeGetDocList<Vendors>("Vendors", {
        fields: ["vendor_name", 'vendor_type', 'name'],
        filters: [["vendor_type", "in", ["Service", "Material & Service"]]],
        limit: 1000
    },
        "Service Vendors"
    )

    const vendorOptions = useMemo(() => vendorsList?.map((ven) => ({ label: ven.vendor_name, value: ven.name })) || [], [vendorsList])


    useFrappeDocTypeEventListener("Service Requests", async () => {
        await serviceListMutate()
    })

    const project_values = useMemo(() => projects?.map((item) => ({ label: item.project_name, value: item.name})) || [], [projects])

    const getTotal = useCallback((order_id: string) => {
        const orderData = service_list?.find(item => item.name === order_id);
        return getSRTotal(orderData)
    }, [service_list])

    const getAmountPaid = useCallback((id : string) => {
        const payments = projectPayments?.filter((payment) => payment?.document_name === id && payment?.status === "Paid") || [];
        return getTotalAmountPaid(payments)
    }, [projectPayments])

    const { notifications, mark_seen_notification } = useNotificationStore()

    const { db } = useContext(FrappeContext) as FrappeConfig

    const handleNewPRSeen = (notification : NotificationType | undefined) => {
        if (notification) {
            mark_seen_notification(db, notification)
        }
    }

    const getVendorName = useCallback((vendorId: string | undefined) => {
        return vendorsList?.find(vendor => vendor.name === vendorId)?.vendor_name || "";
    }, [vendorsList])

    const columns : ColumnDef<ServiceRequests>[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="SR Number" />
                    )
                },
                cell: ({ row }) => {
                    const data = row.original
                    const srId = data?.name
                    const isNew = notifications.find(
                        (item) => item.docname === srId && item.seen === "false" && item.event_id === "sr:approved"
                    )
                    return (
                        <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
                            {isNew && (
                                <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
                            )}
                            <div className="flex items-center gap-2">
                            <Link
                                className="underline hover:underline-offset-2"
                                to={for_vendor === undefined ? `${srId}?tab=approved-sr` : `/service-requests-list/${srId}`}
                            >
                                {srId?.slice(-5)}
                            </Link>
                            <ItemsHoverCard order_list={data.service_order_list.list} isSR />
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
            {
                // accessorKey: "vendor",
                id: "vendor_name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Vendor" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {getVendorName(row.original.vendor)}
                        </div>
                    )
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.original.vendor)
                }
            },
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
                    const amountPaid = getAmountPaid(data?.name);
                    return <div className="font-medium">
                        {formatToIndianRupee(amountPaid)}
                    </div>
                },
            },

        ],
        [project_values, service_list, projectPayments, vendorsList, vendorOptions]
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
            {(projects_loading || service_list_loading || vendorsListLoading || projectPaymentsLoading) ? (<TableSkeleton />) : (
                <DataTable columns={columns} data={service_list || []} project_values={project_values} vendorOptions={vendorOptions} />
            )}
        </div>
    )
}

export default ApprovedSRList;