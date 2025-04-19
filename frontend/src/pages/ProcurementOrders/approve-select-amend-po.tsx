import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { ProcurementOrder as ProcurementOrdersType } from "@/types/NirmaanStack/ProcurementOrders";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { ColumnDef } from "@tanstack/react-table";
import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import memoize from "lodash/memoize";
import { useCallback, useContext, useMemo } from "react";
import { Link } from "react-router-dom";

export const ApproveSelectAmendPO : React.FC = () => {

    const { data: procurement_order_list, isLoading: procurement_order_list_loading, error: procurement_order_list_error, mutate: mutate } = useFrappeGetDocList<ProcurementOrdersType>("Procurement Orders",
        {
            fields: ["*"],
            filters: [["status", "=", "PO Amendment"]],
            limit: 1000,
            orderBy: {field : "modified", order: "desc"}
        },
    );

    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<ProjectsType>("Projects", {
        fields: ["name", "project_name"],
        limit: 1000
    })

    const { data: vendorsList, isLoading: vendorsListLoading, error: vendorsError } = useFrappeGetDocList<Vendors>("Vendors", {
        fields: ["vendor_name", 'vendor_type'],
        filters: [["vendor_type", "in", ["Material", "Material & Service"]]],
        limit: 10000
    },
        "Material Vendors"
    )

    useFrappeDocTypeEventListener("Procurement Orders", async (data) => {
        await mutate()
    })

    const vendorOptions = useMemo(() => vendorsList?.map((ven) => ({ label: ven.vendor_name, value: ven.vendor_name })), [vendorsList])

    const project_values = useMemo(() => projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || [], [projects])

    const getTotal = useMemo(() => memoize((order_id: string) => {
        let total: number = 0;
        const orderData = procurement_order_list?.find(item => item.name === order_id)?.order_list;
        orderData?.list.map((item) => {
            const price = item.quote;
            total += parseNumber(price * item.quantity);
        })
        return total;
    }, (order_id: string) => order_id), [procurement_order_list])

    const {notifications, mark_seen_notification} = useNotificationStore()


    const {db} = useContext(FrappeContext) as FrappeConfig
    const handleNewPRSeen = useCallback((notification : NotificationType | undefined) => {
        if(notification) {
            mark_seen_notification(db, notification)
        }
    }, [db, mark_seen_notification])

    const columns: ColumnDef<ProcurementOrdersType>[] = useMemo(
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
                    const poId = data?.name
                    const isNew = notifications.find(
                        (item) => item.docname === poId && item.seen === "false" && item.event_id === "po:amended"
                    )
                    return (
                        <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
                            {isNew && (
                                <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
                            )}
                            <div className="flex gap-1 items-center">
                                <Link
                                    className="underline hover:underline-offset-2"
                                    to={`${poId?.replaceAll("/", "&=")}?tab=Approve Amended PO`}
                                >
                                    {poId?.toUpperCase()}
                                </Link>
                            <ItemsHoverCard order_list={data?.order_list?.list} />
                            </div>
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
                        <DataTableColumnHeader column={column} title="Date Created" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {formatDate(row.getValue("creation"))}
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
                accessorKey: "vendor_name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Vendor" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {row.getValue("vendor_name")}
                        </div>
                    )
                },
                filterFn: (row, id, value) => {
                    return value.includes(row.getValue(id))
                }
            },
            {
                accessorKey: "total",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Amount" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <div className="font-medium">
                            {formatToRoundedIndianRupee(getTotal(row.getValue("name")))}
                        </div>
                    )
                }
            }
        ],
        [project_values, procurement_order_list, vendorOptions, getTotal]
    )

    const { toast } = useToast()

    if (procurement_order_list_error || projects_error || vendorsError) {
        console.log("Error in approve-select-amend-po.tsx", procurement_order_list_error?.message, projects_error?.message, vendorsError?.message)
        toast({
            title: "Error!",
            description: `Error ${procurement_order_list_error?.message || projects_error?.message || vendorsError?.message}`,
            variant: "destructive"
        })
    }

    return (
            <div className="flex-1 md:space-y-4">
                {(procurement_order_list_loading || projects_loading || vendorsListLoading) ? (<TableSkeleton />) : (
                    <DataTable columns={columns} data={procurement_order_list?.filter((po) => po.status !== "Cancelled") || []} project_values={project_values} vendorOptions={vendorOptions} />
                )}
            </div>
    )
}

export default ApproveSelectAmendPO;