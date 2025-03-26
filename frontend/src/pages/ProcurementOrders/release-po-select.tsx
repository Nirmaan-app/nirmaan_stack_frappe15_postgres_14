import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import { useUserData } from "@/hooks/useUserData";
import { ProcurementOrder as ProcurementOrdersType } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { getPOTotal, getTotalAmountPaid } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { ColumnDef } from "@tanstack/react-table";
import { Radio } from "antd";
import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import memoize from 'lodash/memoize';
import React, { Suspense, useCallback, useContext, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { Link, useSearchParams } from "react-router-dom";
import { Badge } from "../../components/ui/badge";
import { TableSkeleton } from "../../components/ui/skeleton";
import { useToast } from "../../components/ui/use-toast";

const ApproveSelectVendor = React.lazy(() => import("../ProcurementRequests/ApproveVendorQuotes/approve-select-vendor"));
const ApproveSelectSentBack = React.lazy(() => import("../Sent Back Requests/approve-select-sent-back"));
const ApproveSelectAmendPO = React.lazy(() => import("./approve-select-amend-po"));

export const ReleasePOSelect : React.FC = () => {

    const [searchParams] = useSearchParams();

    const { role } = useUserData()

    const [tab, setTab] = useState<string>(searchParams.get("tab") || (["Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role) ? "Approve PO" : "Approved PO"));

    const { data: procurement_order_list, isLoading: procurement_order_list_loading, error: procurement_order_list_error, mutate: mutate } = useFrappeGetDocList<ProcurementOrdersType>("Procurement Orders",
        {
            fields: ["*"],
            filters: [["status", (tab === "Dispatched PO" || role === "Nirmaan Estimates Executive Profile") ? "not in" : "in", tab === "Dispatched PO" ? ["PO Approved", "PO Amendment", "Merged", "Partially Delivered", "Delivered"] : (role === "Nirmaan Estimates Executive Profile" ? ["PO Amendment", "Merged"] : tab === "Approved PO" ? ["PO Approved"] : ["Partially Delivered", "Delivered"])]],
            limit: 10000,
            orderBy: { field: "modified", order: "desc" }
        },
    );

    const { data: projectPayments, isLoading: projectPaymentsLoading, error: projectPaymentsError } = useFrappeGetDocList<ProjectPayments>("Project Payments", {
            fields: ["*"],
            limit: 100000
        })

    useFrappeDocTypeEventListener("Procurement Orders", async (event) => {
        await mutate()
    })

    const { data: projects, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name", "project_name"],
        limit: 1000
    })

    const { data: vendorsList, isLoading: vendorsListLoading, error: vendorsError } = useFrappeGetDocList<Vendors>("Vendors", {
        fields: ["vendor_name", 'vendor_type'],
        filters: [["vendor_type", "in", ["Material", "Material & Service"]]],
        limit: 1000
    },
        "Material Vendors"
    )

    const vendorOptions = useMemo(() => vendorsList?.map((ven) => ({ label: ven.vendor_name, value: ven.vendor_name })), [vendorsList])
    const project_values = useMemo(() => projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || [], [projects])

    const getAmountPaid = useMemo(() => memoize((id : string) => {
        const payments = projectPayments?.filter((payment) => payment?.document_name === id && payment?.status === "Paid") || [];
        return getTotalAmountPaid(payments);
    }, (id: string) => id),[projectPayments])

    const { newPOCount, otherPOCount, adminNewPOCount, adminOtherPOCount, adminDispatchedPOCount, dispatchedPOCount, adminPrCounts, prCounts, adminAmendPOCount, amendPOCount, adminNewApproveSBCount, newSBApproveCount } = useDocCountStore()

    const { notifications, mark_seen_notification } = useNotificationStore()

    const { db } = useContext(FrappeContext) as FrappeConfig
    const handleNewPRSeen = useCallback((notification : NotificationType | undefined) => {
        if (notification) {
            mark_seen_notification(db, notification)
        }
    }, [db, mark_seen_notification])

    const updateURL = useCallback((key : string, value : string) => {
        const url = new URL(window.location.href);
        url.searchParams.set(key, value);
        window.history.pushState({}, "", url);
    }, []);

    const onClick = useCallback((value : string) => {
        if (tab === value) return; // Prevent redundant updates
        setTab(value);
        updateURL("tab", value);
    }, [tab, updateURL]);

    const adminTabs = useMemo(() => [
        ...(["Nirmaan Project Lead Profile", "Nirmaan Admin Profile"].includes(
            role
          ) ? [
            {
                label: (
                    <div className="flex items-center">
                        <span>Approve PO</span>
                        <span className="ml-2 text-xs font-bold">
                            {role === "Nirmaan Admin Profile" ? adminPrCounts.approve
                                : prCounts.approve}
                        </span>
                    </div>
                ),
                value: "Approve PO",
            },
            {
                label: (
                    <div className="flex items-center">
                        <span>Approve Amended PO</span>
                        <span className="ml-2 text-xs font-bold">
                            {role === "Nirmaan Admin Profile" ? adminAmendPOCount
                                : amendPOCount}
                        </span>
                    </div>
                ),
                value: "Approve Amended PO",
            },
            {
                label: (
                    <div className="flex items-center">
                        <span>Approve Sent Back PO</span>
                        <span className="ml-2 text-xs font-bold">
                            {role === "Nirmaan Admin Profile" ? adminNewApproveSBCount
                    : newSBApproveCount}
                        </span>
                    </div>
                ),
                value: "Approve Sent Back PO",
            },
          ] : []),
    ], [role, adminPrCounts, prCounts, adminAmendPOCount, amendPOCount, adminNewApproveSBCount, newSBApproveCount])

    const items = useMemo(() => [
        {
            label: (
                <div className="flex items-center">
                    <span>Approved PO</span>
                    <span className="ml-2 text-xs font-bold">
                        {role === "Nirmaan Admin Profile" ? adminNewPOCount : newPOCount}
                    </span>
                </div>
            ),
            value: "Approved PO",
        },
        {
            label: (
                <div className="flex items-center">
                    <span>Dispatched PO</span>
                    <span className="ml-2 rounded text-xs font-bold">
                        {role === "Nirmaan Admin Profile" ? adminDispatchedPOCount : dispatchedPOCount}
                    </span>
                </div>
            ),
            value: "Dispatched PO",
        },
        {
            label: (
                <div className="flex items-center">
                    <span>Delivered PO</span>
                    <span className="ml-2 rounded text-xs font-bold">
                        {role === "Nirmaan Admin Profile" ? adminOtherPOCount : otherPOCount}
                    </span>
                </div>
            ),
            value: "Delivered PO",
        },
    ], [role, adminNewPOCount, newPOCount, adminDispatchedPOCount, dispatchedPOCount, adminOtherPOCount, otherPOCount])

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
                    const id = data?.name
                    const poId = id?.replaceAll("/", "&=")
                    const isNew = notifications.find(
                        (item) => tab === "Approved PO" && item.docname === id && item.seen === "false" && item.event_id === "po:new"
                    )
                    return (
                        <div onClick={() => handleNewPRSeen(isNew)} className="font-medium relative min-w-[150px] flex flex-col">
                            {isNew && (
                                <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-8 animate-pulse" />
                            )}
                                <div className="flex gap-1 items-center">
                                    <Link
                                      className="underline hover:underline-offset-2"
                                      to={`${poId}?tab=${tab}`}
                                      onClick={() => handleNewPRSeen(isNew)}
                                    >
                                      {id?.toUpperCase()}
                                    </Link>
                                    <ItemsHoverCard order_list={data?.order_list?.list} />
                                </div>
                            
                                    {data?.custom === "true" && (
                                        <Badge className="w-[100px] flex items-center justify-center">Custom</Badge>
                                    )}
                        </div>
                        )
                    }
            },
            {
                accessorKey: "procurement_request",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="PR No" />
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
                accessorKey: "status",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Status" />
                    )
                },
                cell: ({ row }) => {
                    return (
                        <Badge variant={row.getValue("status") === "PO Approved" ? "default" : row.getValue("status") === "PO Sent" ? "yellow" : row.getValue("status") === "Dispatched" ? "orange" : "green"}>{row.getValue("status") === "Partially Delivered" ? "Delivered" : row.getValue("status")}</Badge>
                    )
                }
            },
            {
                id: "totalWithoutGST",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Amt (exc. GST)" />
                    )
                },
                cell: ({ row }) => {
                    const data = row.original;
                    return (
                        <div className="font-medium">
                            {formatToIndianRupee(getPOTotal(data,  parseNumber(data?.loading_charges), parseNumber(data?.freight_charges))?.total)}
                        </div>
                    )
                }
            },
            {
                id: "totalWithGST",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Amt (inc. GST)" />
                    )
                },
                cell: ({ row }) => {
                    const data = row.original;
                    return (
                        <div className="font-medium">
                            {formatToIndianRupee(getPOTotal(data,  parseNumber(data?.loading_charges), parseNumber(data?.freight_charges))?.totalAmt)}
                        </div>
                    )
                }
            },
            {
                id: "Amount_paid",
                header: "Amt Paid",
                cell: ({ row }) => {
                    const data = row.original
                    return <div className="font-medium">
                        {formatToIndianRupee(getAmountPaid(data?.name))}
                    </div>
                },
            },
            {
                accessorKey: 'order_list',
                header: ({ column }) => {
                    return <h1 className="hidden">:</h1>
                },
                cell: ({ row }) => <span className="hidden">hh</span>
            }
        ],
        [project_values, procurement_order_list, projectPayments, tab, notifications]
    )

    const { toast } = useToast()

    if (procurement_order_list_error || projects_error || vendorsError || projectPaymentsError) {
        console.log("Error in release-po-select.tsx", procurement_order_list_error?.message, projects_error?.message, vendorsError?.message)
        toast({
            title: "Error!",
            description: `Error ${procurement_order_list_error?.message || projects_error?.message || vendorsError?.message}`,
            variant: "destructive"
        })
    }

    return (
        <>
            <div className="flex-1 space-y-4">
                {role !== "Nirmaan Estimates Executive Profile" && (
                    <div className="flex items-center max-md:items-start gap-4 max-md:flex-col">
                        {
                            adminTabs && (
                                <Radio.Group
                                    options={adminTabs}
                                    optionType="button"
                                    buttonStyle="solid"
                                    value={tab}
                                    onChange={(e) => onClick(e.target.value)}
                                />
                            )
                        }
                        {
                            items && (
                                <Radio.Group
                                    options={items}
                                    defaultValue="Approved PO"
                                    optionType="button"
                                    buttonStyle="solid"
                                    value={tab}
                                    onChange={(e) => onClick(e.target.value)}
                                />
                            )
                        }

                    </div>
                )}

                <Suspense fallback={
                    <div className="flex items-center h-[90vh] w-full justify-center">
                        <TailSpin color={"red"} />{" "}
                    </div>
                }>
                    {tab === "Approve PO" ? (
                        <ApproveSelectVendor />
                    ) : tab === "Approve Amended PO" ? (
                        <ApproveSelectAmendPO />
                    ) : 
                    tab === "Approve Sent Back PO" ? (
                        <ApproveSelectSentBack />
                    ) :
                    (procurement_order_list_loading || projects_loading || vendorsListLoading || projectPaymentsLoading) ? (<TableSkeleton />) : (
                        <DataTable columns={columns} data={procurement_order_list || []} project_values={project_values} vendorOptions={vendorOptions} itemSearch={true} />
                    )}
                </Suspense>

                
                {/* {["Approve PO", "Approve Amended PO", "Approve Sent Back PO"].includes(tab) ? (
                    tab === "Approve PO" ? (
                        <ApproveSelectVendor />
                    ) : tab === "Approve Amended PO" ? (
                        <ApproveSelectAmendPO />
                    ) : (
                        <ApproveSelectSentBack />
                    )
                ) : (
                    (procurement_order_list_loading || projects_loading || vendorsListLoading || projectPaymentsLoading) ? (<TableSkeleton />) : (
                        <DataTable columns={columns} data={filtered_po_list} project_values={project_values} vendorOptions={vendorOptions} itemSearch={true} />
                    )
                )} */}

            </div>

        </>
    )
}

