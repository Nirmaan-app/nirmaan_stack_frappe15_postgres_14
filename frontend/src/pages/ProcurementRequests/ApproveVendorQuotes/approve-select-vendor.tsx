import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { Category, ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { Projects } from "@/types/NirmaanStack/Projects";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { ColumnDef } from "@tanstack/react-table";
import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import memoize from "lodash/memoize";
import { useCallback, useContext, useMemo } from "react";
import { Link } from "react-router-dom";

export const ApproveSelectVendor : React.FC = () => {

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
    }, "Projects")


    const getTotal = useMemo(() => memoize((order_id: string) => {
        let total: number = 0;
        const allItems = procurement_request_list?.find(item => item?.name === order_id)?.procurement_list?.list;
        const orderData = allItems?.filter((item) => item.status === "Pending")
        orderData?.map((item) => {
            total += parseNumber((item.quote || 0) * item.quantity);
        })
        return total;
    }, (order_id: string) => order_id), [procurement_request_list])

    const project_values = useMemo(() => projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || [], [projects])

    useFrappeDocTypeEventListener("Procurement Requests", async () => {
        await pr_list_mutate()
    })

    const {notifications, mark_seen_notification} = useNotificationStore()

    const {db} = useContext(FrappeContext) as FrappeConfig
    const handleNewPRSeen = useCallback((notification : NotificationType | undefined) => {
        if(notification) {
            mark_seen_notification(db, notification)
        }
    }, [db, mark_seen_notification])

    const columns: ColumnDef<ProcurementRequest>[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="#PR" />
                    )
                },
                cell: ({ row }) => {
                    const data = row.original
                    const prId : string = data.name
                    const isNew = notifications.find(
                        (item) => item.docname === prId && item.seen === "false" && item.event_id === "pr:vendorSelected"
                    )
                    return (
                        <div role="button" tabIndex={0} onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
                            {isNew && (
                                <p className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
                            )}
                            <div className="flex items-center gap-2">
                                <Link
                                    className="underline hover:underline-offset-2"
                                    to={`${prId}?tab=Approve PO`}
                                >
                                    {prId?.slice(-4)}
                                </Link>
                                 {!data.work_package && <Badge className="text-xs">Custom</Badge>}
                                 <ItemsHoverCard order_list={data?.procurement_list?.list} isPR />
                            </div>
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
                     const creation : string = row.getValue("creation")
                    return (
                        <p className="font-medium">
                            {formatDate(creation)}
                        </p>
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
                        <p className="font-medium">
                            {project?.label || "--"}
                        </p>
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
                        <p className="font-medium">
                            {row.getValue("work_package") || "--"}
                        </p>
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
                        <p className="flex flex-col gap-1 items-start justify-center">
                            {categories.list.map((obj) => <Badge key={obj.name} className="inline-block">{obj.name}</Badge>)}
                        </p>
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
                        <p className="font-medium">
                            {getTotal(id) === 0 ? "N/A" : formatToRoundedIndianRupee(getTotal(id))}
                        </p>
                    )
                }
            }

        ],
        [procurement_request_list, notifications, project_values, getTotal]
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

export default ApproveSelectVendor;