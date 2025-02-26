import { FrappeConfig, FrappeContext, useFrappeGetDocList } from "frappe-react-sdk";
import { Link, useSearchParams } from "react-router-dom";
import { useContext, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Projects } from "@/types/NirmaanStack/Projects";
import { useToast } from "../ui/use-toast";
import { TableSkeleton } from "../ui/skeleton";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { useNotificationStore } from "@/zustand/useNotificationStore";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { useUserData } from "@/hooks/useUserData";
import { Radio } from "antd";


type PRTable = {
    name: string
    project_name: string
    creation: string
    category: string
}

export const SentBackRequest = () => {

    const [searchParams] = useSearchParams();

    const [type, setType] = useState<string>(searchParams.get("type") || "Rejected");

    const { data: sent_back_list, isLoading: sent_back_list_loading, error: sent_back_list_error } = useFrappeGetDocList("Sent Back Category",
        {
            fields: ['name', 'item_list', 'workflow_state', 'procurement_request', 'project', 'creation', 'type', 'modified'],
            filters: [["workflow_state", "=", "Pending"], ["type", "=", type]],
            limit: 10000,
            orderBy: { field: "modified", order: "desc" }
        },
        type ? `${type} Sent Back Category` : null
    );

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

    const { role, user_id } = useUserData()

    const { newSBCounts, adminNewSBCounts } = useDocCountStore()

    const { mark_seen_notification, notifications } = useNotificationStore()

    const { db } = useContext(FrappeContext) as FrappeConfig
    const handleNewPRSeen = (notification) => {
        if (notification) {
            mark_seen_notification(db, notification)
        }
    }
        
    const updateURL = (key, value) => {
        const url = new URL(window.location);
        url.searchParams.set(key, value);
        window.history.pushState({}, "", url);
    };


    const onClick = (value) => {

        if (type === value) return; // Prevent redundant updates

        const newTab = value;
        setType(newTab);
        updateURL("type", newTab);

    };

    const items = [
        {
            label: (
                <div className="flex items-center">
                    <span>Rejected</span>
                    <span className="ml-2 text-xs font-bold">
                        {(role === "Nirmaan Admin Profile" || user_id === "Administrator") ? adminNewSBCounts.rejected : newSBCounts.rejected}
                    </span>
                </div>
            ),
            value: "Rejected",
        },
        {
            label: (
                <div className="flex items-center">
                    <span>Delayed</span>
                    <span className="ml-2 rounded text-xs font-bold">
                        {(role === "Nirmaan Admin Profile" || user_id === "Administrator") ? adminNewSBCounts.delayed : newSBCounts.delayed}
                    </span>
                </div>
            ),
            value: "Delayed",
        },
        {
            label: (
                <div className="flex items-center">
                    <span>Cancelled</span>
                    <span className="ml-2 rounded text-xs font-bold">
                        {(role === "Nirmaan Admin Profile" || user_id === "Administrator") ? adminNewSBCounts.cancelled : newSBCounts.cancelled}
                    </span>
                </div>
            ),
            value: "Cancelled",
        },
    ];

    const columns: ColumnDef<PRTable>[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Sentback ID" />
                    )
                },
                cell: ({ row }) => {
                    const sbId = row.getValue("name")
                    const isNew = notifications.find(
                        (item) => item.docname === sbId && item.seen === "false" && item.event_id === `${type}-sb:new`
                    )
                    return (
                        <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
                            {isNew && (
                                <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
                            )}
                            <Link
                                className="underline hover:underline-offset-2"
                                to={`${sbId}`}
                            >
                                {sbId?.slice(-4)}
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
                        <DataTableColumnHeader column={column} title="Amount" />
                    )
                },
                cell: ({ row }) => {
                    const id = row.getValue("name")
                    return (
                        <div className="font-medium">
                            {getTotal(id) === 0 ? "N/A" : formatToIndianRupee(getTotal(id))}
                        </div>
                    )
                }
            }
        ],
        [project_values, sent_back_list]
    )

    const { toast } = useToast()

    if (sent_back_list_error || projects_error) {
        console.log("Error in sent-back-request.tsx", sent_back_list_error?.message, projects_error?.message)
        toast({
            title: "Error!",
            description: `Error ${sent_back_list_error?.message || projects_error?.message}`,
            variant: "destructive"
        })
    }

    return (
        <div className="flex-1 space-y-4">
            {/* <div className="flex items-center justify-between pl-2 space-y-2">
                    <h2 className="text-lg font-bold tracking-tight">{type} Sent Back PR</h2>
                </div> */}
            {/* <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2"> */}
            {items && (
                    <Radio.Group
                        block
                        options={items}
                        defaultValue="Rejected"
                        optionType="button"
                        buttonStyle="solid"
                        value={type}
                        onChange={(e) => onClick(e.target.value)}
                    />
                )}
            {(sent_back_list_loading || projects_loading) ? (<TableSkeleton />) : (
                <DataTable columns={columns} data={sent_back_list || []} project_values={project_values} />
            )}

            {/* <div className="overflow-x-auto">
                        <table className="min-w-full divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sent Back ID</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PR number</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Package</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estimated Price</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {sent_back_list?.map(item => (
                                    <tr key={item.name}>
                                        <td className="px-6 py-4 text-blue-600 whitespace-nowrap"><Link to={`/sent-back-request/${item.name}`}>{item.name}</Link></td>
                                        <td className="px-6 py-4 whitespace-nowrap">{item.procurement_request.slice(-4)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {item.creation.split(" ")[0]}
                                        </td>
                                        <td className="px-6 py-4 text-sm whitespace-nowrap">{item.project_name}</td>
                                        <td className="px-6 py-4 text-sm whitespace-nowrap">{getPackage(item.procurement_request)}</td>
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