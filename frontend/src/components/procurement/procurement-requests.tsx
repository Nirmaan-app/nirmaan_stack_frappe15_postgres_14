import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { Link, useSearchParams } from "react-router-dom";
import { useContext, useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Projects } from "@/types/NirmaanStack/Projects";
import { useToast } from "../ui/use-toast";
import { TableSkeleton } from "../ui/skeleton";
import { formatDate } from "@/utils/FormatDate";
import { useNotificationStore } from "@/zustand/useNotificationStore";
import { EstimatedPriceHoverCard } from "./EstimatedPriceHoverCard";
import { Radio } from "antd";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { useUserData } from "@/hooks/useUserData";

type PRTable = {
    name: string
    project: string
    creation: string
    work_package: string
}

export const ProcurementRequests = () => {

    const [searchParams] = useSearchParams();

    const {role, user_id} = useUserData()   
    
    const [tab, setTab] = useState<string>(searchParams.get("tab") || "New PR Request");

    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error, mutate: prListMutate } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'workflow_state', 'owner', 'project', 'work_package', 'procurement_list', "category_list", 'creation', 'modified'],
            filters: [["workflow_state", "=", tab === "New PR Request" ? "Approved" : tab === "Update Quote" ? "RFQ Generated" : "Quote Updated"]],
            limit: 1000,
            orderBy: { field: "modified", order: "desc" }
        });
    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
        limit: 1000
    })

    const { data: quote_data } = useFrappeGetDocList("Approved Quotations",
        {
            fields: ["*"],
            limit: 10000
        });

    useFrappeDocTypeEventListener("Procurement Requests", async (event) => {
        await prListMutate()
    })

    const getTotal = (order_id: string) => {
        let total: number = 0;
        let usedQuotes = {}
        const orderData = procurement_request_list?.find(item => item.name === order_id)?.procurement_list;
        // console.log("orderData", orderData)
        orderData?.list.map((item) => {
            const quotesForItem = quote_data
                ?.filter(value => value.item_id === item.name && ![null, "0", 0, undefined].includes(value.quote))
                ?.map(value => value.quote);
            let minQuote;
            if (quotesForItem && quotesForItem.length > 0) {
                minQuote = Math.min(...quotesForItem);
                const estimateQuotes = quote_data
                    ?.filter(value => value.item_id === item.name && parseFloat(value.quote) === parseFloat(minQuote))?.sort((a, b) => new Date(b.modified) - new Date(a.modified));
                const latestQuote = estimateQuotes?.length > 0 ? estimateQuotes[0] : null;
                usedQuotes = { ...usedQuotes, [item.item]: { items: latestQuote, amount: minQuote, quantity: item.quantity } }
            }
            total += (minQuote ? parseFloat(minQuote) : 0) * item.quantity;
        })
        return { total: total || "N/A", usedQuotes: usedQuotes }
    }

    const { notifications, mark_seen_notification } = useNotificationStore()

    const project_values = projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || []

    const { db } = useContext(FrappeContext) as FrappeConfig

    const handleNewPRSeen = (notification) => {
        if (notification) {
            mark_seen_notification(db, notification)
        }
    }

    useEffect(() => {
      const currentTab = searchParams.get("tab") || "New PR Request";
      setTab(currentTab);
      updateURL("tab", currentTab);
    }, []);
        
    const updateURL = (key, value) => {
      const url = new URL(window.location);
      url.searchParams.set(key, value);
      window.history.pushState({}, "", url);
    };

    const onClick = (value) => {
        
        if (tab === value) return; // Prevent redundant updates
    
        const newTab = value;
        setTab(newTab);
        updateURL("tab", newTab);
    
    };
    
    // type MenuItem = Required<MenuProps>["items"][number];

    const {approvedPRCount, adminApprovedPRCount, updateQuotePRCount, adminUpdateQuotePRCount, chooseVendorPRCount, adminChooseVendorPRCount} = useDocCountStore()
    
    const items = [
        {
          label: (
            <div className="flex items-center">
              <span>New PR Request</span>
              <span className="ml-2 text-xs font-bold">
                {(role === "Nirmaan Admin Profile" || user_id === "Administrator") ? adminApprovedPRCount : approvedPRCount}
              </span>
            </div>
          ),
          value: "New PR Request",
        },
        {
          label: (
            <div className="flex items-center">
              <span>Update Quote</span>
              <span className="ml-2 rounded text-xs font-bold">
              {(role === "Nirmaan Admin Profile" || user_id === "Administrator") ? adminUpdateQuotePRCount : updateQuotePRCount}
              </span>
            </div>
          ),
          value: "Update Quote",
        },
        {
            label: (
              <div className="flex items-center">
                <span>Choose Vendor</span>
                <span className="ml-2 rounded text-xs font-bold">
                {(role === "Nirmaan Admin Profile" || user_id === "Administrator") ? adminChooseVendorPRCount : chooseVendorPRCount}
                </span>
              </div>
            ),
            value: "Choose Vendor",
          },
      ];

    const columns: ColumnDef<PRTable>[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="PR Number" />
                    )
                },
                cell: ({ row }) => {
                    const prId = row.getValue("name")
                    const isNew = notifications.find(
                        (item) => item.docname === prId && item.seen === "false" && item.event_id === "pr:approved"
                    )
                    return (
                        <div onClick={() => handleNewPRSeen(isNew)} className="font-medium flex items-center gap-2 relative">
                            {isNew && (
                                <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
                            )}
                            <Link
                                className="underline hover:underline-offset-2"
                                to={`${prId}?tab=${tab}`}
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
                    return (
                        <div className="flex flex-col gap-1 items-start justify-center">
                            {row.getValue("category_list").list.map((obj) => <Badge className="inline-block">{obj["name"]}</Badge>)}
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
                cell: ({ row }) => {
                    const total = getTotal(row.getValue("name")).total
                    const prUsedQuotes = getTotal(row.getValue("name"))?.usedQuotes
                    return (
                        total === "N/A" ? (
                            <div className="font-medium">
                                N/A
                            </div>
                        ) : (
                            <EstimatedPriceHoverCard total={total} prUsedQuotes={prUsedQuotes} />
                        )
                    )
                }
            }

        ],
        [project_values, procurement_request_list]
    )
    const { toast } = useToast()

    if (procurement_request_list_error || projects_error) {
        console.log("Error in Procurement-approved.tsx", procurement_request_list_error?.message, projects_error?.message)
        toast({
            title: "Error!",
            description: `Error ${procurement_request_list_error?.message || projects_error?.message}`,
            variant: "destructive"
        })
    }

    return (
        <>
            <div className="flex-1 space-y-4">
                {/* <div className="flex items-center justify-between space-y-2">
                    <h2 className="text-base pt-1 pl-2 font-bold tracking-tight">New PR Request</h2>
                </div> */}

            {items && (
                <Radio.Group
                    block
                    options={items}
                    defaultValue="New PR Request"
                    optionType="button"
                    buttonStyle="solid"
                    value={tab}
                    onChange={(e) => onClick(e.target.value)}
                  />
                )}

                {(projects_loading || procurement_request_list_loading) ? (<TableSkeleton />) : (
                    <DataTable columns={columns} data={procurement_request_list || []} project_values={project_values} />
                )}
            </div>
        </>
    )
}