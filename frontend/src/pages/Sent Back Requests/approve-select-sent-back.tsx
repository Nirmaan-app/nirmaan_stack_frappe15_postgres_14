import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { Projects } from "@/types/NirmaanStack/Projects";
import { SentBackCategory } from "@/types/NirmaanStack/SentBackCategory";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { ColumnDef } from "@tanstack/react-table";
import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import memoize from "lodash/memoize";
import { useCallback, useContext, useMemo } from "react";
import { Link } from "react-router-dom";

export const ApproveSelectSentBack : React.FC = () => {

    const { data: sent_back_list, isLoading: sent_back_list_loading, error: sent_back_list_error, mutate: sbListMutate } = useFrappeGetDocList<SentBackCategory>("Sent Back Category",
        {
            fields: ["*"],
            filters: [["workflow_state", "in", ["Vendor Selected", "Partially Approved"]]],
            limit: 1000,
            orderBy: {field: "modified", order : "desc"}
        },
        "Sent Back Category(filters,in,Vendor Selected,Partially Approved)"
    );

    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
        limit: 1000
    }, "Projects")

    const project_values = useMemo(() => projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || [], [projects])

    const filteredList = useMemo(() => sent_back_list?.filter((item) => item?.item_list?.list?.some((i) => i.status === "Pending")) || [], [sent_back_list])

    const getTotal = useMemo(() => memoize((order_id: string) => {
        let total: number = 0;
        const orderData = sent_back_list?.find(item => item.name === order_id)?.item_list;
        orderData?.list.map((item) => {
            const price = parseNumber(item.quote);
            total += parseNumber(price * item.quantity);
        })
        return total;
    }, (order_id: string) => order_id), [sent_back_list])

    useFrappeDocTypeEventListener("Sent Back Category", async (data) => {
        await sbListMutate()
    })

    const {notifications, mark_seen_notification} = useNotificationStore()

    const {db} = useContext(FrappeContext) as FrappeConfig

    const handleNewPRSeen = useCallback((notification : NotificationType | undefined) => {
        if(notification) {
            mark_seen_notification(db, notification)
        }
    }, [db, mark_seen_notification])

    const columns: ColumnDef<SentBackCategory>[] = useMemo(
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
                    const sbId = data?.name
                    const isNew = notifications.find(
                        (item) => item.docname === sbId && item.seen === "false" && item.event_id === "sb:vendorSelected"
                    )
                    return (
                        <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
                            {isNew && (
                                <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
                            )}
                            <div className="flex gap-1 items-center">
                                <Link
                                    className="underline hover:underline-offset-2"
                                    to={`${sbId}?tab=Approve Sent Back PO`}
                                >
                                    {sbId?.slice(-5)}
                                </Link>
                                <ItemsHoverCard order_list={data?.item_list?.list} isSB />
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
                            {formatToRoundedIndianRupee(getTotal(row.getValue("name")))}
                        </div>
                    )
                }
            }
        ],
        [sent_back_list, notifications, project_values, getTotal]
    )

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
                {(sent_back_list_loading || projects_loading) ? (<TableSkeleton />) : (
                    <DataTable columns={columns} data={filteredList || []} project_values={project_values} />
                )}
            </div>
    )
}

export default ApproveSelectSentBack;