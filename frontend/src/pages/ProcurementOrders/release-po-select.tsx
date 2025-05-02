import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { useStateSyncedWithParams } from "@/hooks/useSearchParamsManager";
import { useUserData } from "@/hooks/useUserData";
import { ProcurementOrder as ProcurementOrdersType } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { getPOTotal, getTotalAmountPaid, getTotalInvoiceAmount } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { ColumnDef } from "@tanstack/react-table";
import { Radio } from "antd";
import { FrappeConfig, FrappeContext, useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import memoize from 'lodash/memoize';
import React, { Suspense, useCallback, useContext, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/badge";
import { TableSkeleton } from "../../components/ui/skeleton";
import { useToast } from "../../components/ui/use-toast";
import { PaymentsDataDialog } from "../ProjectPayments/PaymentsDataDialog";
import { InvoiceDataDialog } from "./InvoiceDataDialog";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";

const ApproveSelectVendor = React.lazy(() => import("../ProcurementRequests/ApproveVendorQuotes/approve-select-vendor"));
const ApproveSelectSentBack = React.lazy(() => import("../Sent Back Requests/approve-select-sent-back"));
const ApproveSelectAmendPO = React.lazy(() => import("./approve-select-amend-po"));

export const ReleasePOSelect: React.FC = () => {

    const { role } = useUserData()

    const [tab, setTab] = useStateSyncedWithParams<string>("tab", (["Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role) ? "Approve PO" : "Approved PO"));
    const [selectedInvoice, setSelectedInvoice] = useState<ProcurementOrdersType>();
    const [currentPaymentsDialog, setCurrentPaymentsDialog] = useState()

    // --- Helper function to determine filters based on tab ---
    const getStatusFilters = useCallback((currentTab: string) => {
        const isEstimatesExec = role === "Nirmaan Estimates Executive Profile";
        const isAdminOrLead = ["Nirmaan Admin Profile", "Nirmaan Project Lead Profile"].includes(role);

        // Handle special roles first
        if (isEstimatesExec) {
            return [["status", "in", ["PO Approved", "Dispatched", "Partially Delivered", "Delivered"]]];
        }

        // Handle Approve tabs for Admin/Lead
        if (isAdminOrLead) {
            if (currentTab === "Approve PO") return [["status", "=", "PR Approved"]]; // Assuming this is the status before PO Approved
            if (currentTab === "Approve Amended PO") return [["status", "=", "PO Amendment"]];
            if (currentTab === "Approve Sent Back PO") return [["status", "=", "Sent Back Request"]]; // Assuming this status
        }

        // Handle regular PO status tabs
        switch (currentTab) {
            case "Approved PO":
                return [["status", "=", "PO Approved"]];
            case "Dispatched PO":
                return [["status", "=", "Dispatched"]];
            case "Partially Delivered PO": // New Tab
                return [["status", "=", "Partially Delivered"]];
            case "Delivered PO": // Updated Tab
                return [["status", "=", "Delivered"]];
            default:
                // Fallback or default filter if needed, maybe show approved?
                return [["status", "=", "Approved PO"]];
        }
    }, [role]);
    // --- End Helper Function ---

    const { data: procurement_order_list, isLoading: procurement_order_list_loading, error: procurement_order_list_error, mutate: mutate } = useFrappeGetDocList<ProcurementOrdersType>("Procurement Orders",
        {
            fields: ["*"],
            filters: getStatusFilters(tab),
            limit: 10000,
            orderBy: { field: "modified", order: "desc" }
        },
        `po_list_${tab}` // Add tab to query key for better caching/refetching on tab change
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
    }, "Projects")

    const { data: vendorsList, isLoading: vendorsListLoading, error: vendorsError } = useFrappeGetDocList<Vendors>("Vendors", {
        fields: ["vendor_name", 'vendor_type'],
        filters: [["vendor_type", "in", ["Material", "Material & Service"]]],
        limit: 10000
    },
        "Material Vendors"
    )

    const { data: userList, isLoading: userListLoading, error: userError } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
        fields: ["name", 'full_name'],
        limit: 1000
    },
        "Nirmaan Users"
    )

    const vendorOptions = useMemo(() => vendorsList?.map((ven) => ({ label: ven.vendor_name, value: ven.vendor_name })), [vendorsList])
    const project_values = useMemo(() => projects?.map((item) => ({ label: `${item.project_name}`, value: `${item.name}` })) || [], [projects])

    const getAmountPaid = useMemo(() => memoize((id: string) => {
        const payments = projectPayments?.filter((payment) => payment?.document_name === id && payment?.status === "Paid") || [];
        return getTotalAmountPaid(payments);
    }, (id: string) => id), [projectPayments])

    const { newPOCount, adminNewPOCount, adminDispatchedPOCount, dispatchedPOCount, adminPrCounts, prCounts, adminAmendPOCount, amendPOCount, adminNewApproveSBCount, newSBApproveCount, partiallyDeliveredPOCount, adminPartiallyDeliveredPOCount, deliveredPOCount, adminDeliveredPOCount } = useDocCountStore()
    const { notifications, mark_seen_notification } = useNotificationStore()

    const { db } = useContext(FrappeContext) as FrappeConfig

    const handleNewPRSeen = useCallback((notification: NotificationType | undefined) => {
        if (notification) {
            mark_seen_notification(db, notification)
        }
    }, [db, mark_seen_notification])

    const onClick = useCallback((value: string) => {
        if (tab === value) return; // Prevent redundant updates
        setTab(value);
    }, [tab, setTab]);

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
        { // Use the new state variable here
            label: (
                <div className="flex items-center">
                    <span>Partially Delivered PO</span>
                    <span className="ml-2 rounded text-xs font-bold">
                        {role === "Nirmaan Admin Profile" ? adminPartiallyDeliveredPOCount : partiallyDeliveredPOCount}
                    </span>
                </div>
            ),
            value: "Partially Delivered PO",
        },
        { // Use the renamed state variable here
            label: (
                <div className="flex items-center">
                    <span>Delivered PO</span>
                    <span className="ml-2 rounded text-xs font-bold">
                        {role === "Nirmaan Admin Profile" ? adminDeliveredPOCount : deliveredPOCount}
                    </span>
                </div>
            ),
            value: "Delivered PO",
        },
    ], [role, adminNewPOCount, newPOCount, adminDispatchedPOCount, dispatchedPOCount, adminPartiallyDeliveredPOCount, partiallyDeliveredPOCount, adminDeliveredPOCount, deliveredPOCount])


    const columns: ColumnDef<ProcurementOrdersType>[] = useMemo(
        () => [
            {
                accessorKey: "name",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="#PO" />
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
            // {
            //     accessorKey: "procurement_request",
            //     header: ({ column }) => {
            //         return (
            //             <DataTableColumnHeader column={column} title="#PR" />
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
                        <DataTableColumnHeader column={column} title="PO Date Created" />
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
            // {
            //     accessorKey: "status",
            //     header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
            //     cell: ({ row }) => {
            //         const status = row.getValue("status") as string;
            //         let variant: "default" | "orange" | "green" | "blue" = "default"; // Use 'blue' for Partially Delivered
            //         if (status === "Dispatched") variant = "orange";
            //         else if (status === "Delivered") variant = "green";
            //         else if (status === "Partially Delivered") variant = "blue";

            //         return <Badge variant={variant}>{status}</Badge>;
            //     }
            // },
            ...(tab === "Approved PO" ? [
                {
                    accessorKey: "owner",
                    header: ({ column }) => <DataTableColumnHeader column={column} title="Approved By" />,
                    cell: ({ row }) => {
                        const data = row.original
                        const ownerUser = userList?.data?.find((entry) => data?.owner === entry.name)
                        return (
                            <div className="font-medium">
                                {ownerUser?.full_name || data?.owner || "--"}
                            </div>
                        );
                    }
                }
            ] : []),
            // "Modified By" Column - Conditional
            ...(tab !== "Approved PO" ? [ // Show on all tabs *except* Approved PO
                {
                    accessorKey: "modified_by",
                    header: ({ column }) => <DataTableColumnHeader column={column} title="Last Modified By" />,
                    cell: ({ row }) => {
                        const data = row.original;
                        // Safely find the user
                        const modifierUser = userList?.data?.find(user => user.name === data?.modified_by);
                        return (
                            <div className="font-medium">
                                {/* Display full name, fallback to modifier ID, then to '--' */}
                                {modifierUser?.full_name || data?.modified_by || '--'}
                            </div>
                        );
                    }
                }
            ] : []),
            // {
            //     id: "totalWithoutGST",
            //     header: ({ column }) => {
            //         return (
            //             <DataTableColumnHeader column={column} title="Amt (exc. GST)" />
            //         )
            //     },
            //     cell: ({ row }) => {
            //         const data = row.original;
            //         return (
            //             <div className="font-medium">
            //                 {formatToIndianRupee(getPOTotal(data,  parseNumber(data?.loading_charges), parseNumber(data?.freight_charges))?.total)}
            //             </div>
            //         )
            //     }
            // },
            {
                id: "totalWithGST",
                header: ({ column }) => {
                    return (
                        <DataTableColumnHeader column={column} title="Total PO Amt" />
                    )
                },
                cell: ({ row }) => {
                    const data = row.original;
                    return (
                        <div className="font-medium">
                            {formatToRoundedIndianRupee(getPOTotal(data, parseNumber(data?.loading_charges), parseNumber(data?.freight_charges))?.totalAmt)}
                        </div>
                    )
                }
            },
            ...(["Dispatched PO", "Partially Delivered PO", "Delivered PO"].includes(tab) ? [
                {
                    id: "invoices_amount",
                    header: ({ column }) => {
                        return (
                            <DataTableColumnHeader column={column} title="Total Invoice Amt" />
                        )
                    },
                    cell: ({ row }) => {
                        const data = row.original;
                        const invoiceAmount = getTotalInvoiceAmount(data?.invoice_data)
                        return (
                            <div
                                className={`font-medium ${invoiceAmount ? "underline cursor-pointer" : ""}`}
                                onClick={() => invoiceAmount && setSelectedInvoice(data)}
                            >
                                {formatToRoundedIndianRupee(invoiceAmount || "N/A")}
                            </div>
                        )
                    }
                },
            ] : []),
            {
                id: "Amount_paid",
                header: "Amt Paid",
                cell: ({ row }) => {
                    const data = row.original
                    const amountPaid = getAmountPaid(data?.name)
                    return <div className={`font-medium ${amountPaid ? "cursor-pointer underline" : ""}`} onClick={() => amountPaid && setCurrentPaymentsDialog(data)}>
                        {formatToRoundedIndianRupee(amountPaid || "N/A")}
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
        [project_values, procurement_order_list, projectPayments, tab, notifications, getAmountPaid, getPOTotal, handleNewPRSeen]
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

    // --- Determine which view to render based on tab ---
    const renderTabView = () => {
        // Render specific components for approval tabs
        if (tab === "Approve PO") return <ApproveSelectVendor />;
        if (tab === "Approve Amended PO") return <ApproveSelectAmendPO />;
        if (tab === "Approve Sent Back PO") return <ApproveSelectSentBack />;

        // Render DataTable for PO status tabs
        if (procurement_order_list_loading || projects_loading || vendorsListLoading || userListLoading || projectPaymentsLoading) {
            return <TableSkeleton />;
        }
        if (procurement_order_list_error || projects_error || vendorsError || userError || projectPaymentsError) {
            // Optionally show an error message within the table area
            return <div className="text-red-600 text-center p-4">Failed to load purchase orders for this tab.</div>;
        }
        return <DataTable columns={columns} data={procurement_order_list || []} project_values={project_values} vendorOptions={vendorOptions} itemSearch={true} />;
    };
    // --- End Render View Logic ---

    return (
        <>
            <InvoiceDataDialog
                open={!!selectedInvoice}
                onOpenChange={(open) => !open && setSelectedInvoice(undefined)}
                invoiceData={selectedInvoice?.invoice_data}
                project={selectedInvoice?.project_name}
                poNumber={selectedInvoice?.name}
                vendor={selectedInvoice?.vendor_name}
            />

            <PaymentsDataDialog
                open={!!currentPaymentsDialog}
                onOpenChange={(open) => !open && setCurrentPaymentsDialog(undefined)}
                payments={projectPayments}
                data={currentPaymentsDialog}
                projects={projects}
                vendors={vendorsList}
                isPO
            />
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

                <Suspense fallback={<LoadingFallback />}>
                    {renderTabView()} {/* Use the render function */}
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

