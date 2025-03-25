import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { ColumnDef } from "@tanstack/react-table";
import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { useCallback, useContext, useMemo } from "react";
import { Link } from "react-router-dom";

export const ApproveSelectAmendSR : React.FC = () => {
    const { data: service_request_list, isLoading: service_request_list_loading, error: service_request_list_error, mutate: sr_list_mutate } = useFrappeGetDocList<ServiceRequests>("Service Requests",
        {
            fields: ["*"],
            filters: [["status", "=", "Amendment"]],
            limit: 1000,
            orderBy: { field: "creation", order: "desc" }
        }
    );

    useFrappeDocTypeEventListener("Service Requests", async () => {
        await sr_list_mutate()
    })

    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
        limit: 1000
    })

    const project_values = useMemo(() => projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || [], [projects])

    const { data: vendorsList, isLoading: vendorsListLoading } = useFrappeGetDocList<Vendors>("Vendors", {
        fields: ["vendor_name", 'vendor_type', 'name'],
        filters: [["vendor_type", "in", ["Service", "Material & Service"]]],
        limit: 1000
    },
        "Service Vendors"
    )

    const vendorOptions = useMemo(() => vendorsList?.map((ven) => ({ label: ven.vendor_name, value: ven.name })) || [], [vendorsList])

    const getTotal = useCallback((order_id: string) => {
        let total: number = 0;

        const orderData = service_request_list?.find(item => item.name === order_id)?.service_order_list;
        orderData?.list.map((item) => {
            total +=  parseNumber(item?.rate) * parseNumber(item?.quantity);
        })
        return total;
    }, [service_request_list])

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

    const columns: ColumnDef<ServiceRequests>[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="ID" />
                    )
                },
                cell: ({ row }) => {
                    const data = row.original
                    const srId = data?.name
                    const isNew = notifications.find(
                        (item) => item.docname === srId && item.seen === "false" && item.event_id === "sr:amended"
                    )
                    return (
                        <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
                            {isNew && (
                                <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
                            )}
                            <div className="flex items-center gap-2">
                            <Link
                                className="underline hover:underline-offset-2"
                                to={`${srId}?tab=approve-amended-so`}
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
        [service_request_list, project_values, vendorsList, vendorOptions]
    )

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
            {(service_request_list_loading || projects_loading || vendorsListLoading) ? (<TableSkeleton />) : (
                <DataTable columns={columns} data={service_request_list || []} project_values={project_values} vendorOptions={vendorOptions} />
            )}
        </div>
    )
}

export default ApproveSelectAmendSR;