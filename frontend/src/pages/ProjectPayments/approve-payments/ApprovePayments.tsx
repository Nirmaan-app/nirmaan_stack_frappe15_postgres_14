import React, { useCallback, useContext, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ColumnDef } from "@tanstack/react-table";
import { FrappeConfig, FrappeContext, useFrappeGetDocList, useFrappeUpdateDoc, FrappeDoc, GetDocListArgs } from "frappe-react-sdk";
import { CircleCheck, CircleX, Info, SquarePen } from "lucide-react";

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";

// --- Dialog Component ---
import { PaymentActionDialog } from "./components/PaymentActionDialog";

// --- Types and Constants ---
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { DOC_TYPES, PAYMENT_STATUS, DIALOG_ACTION_TYPES, DialogActionType } from './constants';
import PaymentSummaryCards from "../PaymentSummaryCards";

// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { useFacetValues } from '@/hooks/useFacetValues';
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { getPOTotal, getSRTotal, getTotalAmountPaid } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { formatDate } from "@/utils/FormatDate";
import { memoize } from "lodash";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { useVendorsList } from "@/pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { DEFAULT_PP_FIELDS_TO_FETCH, PP_DATE_COLUMNS, PP_SEARCHABLE_FIELDS } from "../config/projectPaymentsTable.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";

import { useSWRConfig } from 'swr'

// --- Constants ---
const DOCTYPE = DOC_TYPES.PROJECT_PAYMENTS;
const URL_SYNC_KEY = 'approve_pay';

interface SelectOption { label: string; value: string; }

// --- Component ---
export const ApprovePayments: React.FC = () => {
    const { toast } = useToast();
    const { db } = useContext(FrappeContext) as FrappeConfig;
    const { mutate } = useSWRConfig();
    // --- State for Dialogs ---
    const [selectedPayment, setSelectedPayment] = useState<ProjectPayments | null>(null);
    const [dialogActionType, setDialogActionType] = useState<DialogActionType>(DIALOG_ACTION_TYPES.APPROVE);
    const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);

    // --- Supporting Data Fetches (Keep these for lookups/calculations) ---
    const projectsFetchOptions = getProjectListOptions();

    // --- Generate Query Keys ---
    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        DOC_TYPES.PROJECTS, projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, projectQueryKey
    );
    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useVendorsList({ vendorTypes: ["Service", "Material", "Material & Service"] });

    const { data: userList, isLoading: userListLoading, error: userError } = useUsersList();

    const { data: purchaseOrders, isLoading: poLoading, error: poError } = useFrappeGetDocList<ProcurementOrder>(
        DOC_TYPES.PROCUREMENT_ORDERS, { fields: ["name", "status", "total_amount", "loading_charges", "freight_charges"], limit: 100000 }, 'POs_ApprovePay'
    );
    const { data: serviceOrders, isLoading: srLoading, error: srError } = useFrappeGetDocList<ServiceRequests>(
        DOC_TYPES.SERVICE_REQUESTS, { fields: ["name", "status", "service_order_list", "gst"], filters: [["status", "in", ["Approved", "Amendment"]]], limit: 10000 }, 'SRs_ApprovePay'
    );
    // For "Amt Paid" - fetch all paid payments for relevant documents
    const { data: allPaidPayments, isLoading: paidPaymentsLoading, error: paidPaymentsError } = useFrappeGetDocList<ProjectPayments>(
        DOC_TYPES.PROJECT_PAYMENTS, {
        fields: ["name", "document_name", "amount"],
        filters: [["status", "=", PAYMENT_STATUS.PAID]],
        limit: 100000
    }, 'AllPaidPayments_ApprovePay'
    );


    // --- Zustand Store & Memoized Lookups ---
    const { notifications, mark_seen_notification } = useNotificationStore();

    const projectOptions = useMemo<SelectOption[]>(() => projects?.map(p => ({ label: p.project_name, value: p.name })) || [], [projects]);
    const vendorOptions = useMemo<SelectOption[]>(() => vendors?.map(v => ({ label: v.vendor_name, value: v.name })) || [], [vendors]);

    const getAmountPaid = useMemo(() => {
        if (!allPaidPayments) return () => 0;
        const paymentsMap = new Map<string, number>();
        allPaidPayments.forEach(p => {
            if (p.document_name) {
                paymentsMap.set(p.document_name, (paymentsMap.get(p.document_name) || 0) + parseNumber(p.amount));
            }
        });
        return memoize((documentName: string) => paymentsMap.get(documentName) || 0);
    }, [allPaidPayments]);

    const getDocumentTotal = useMemo(() => memoize((docName: string, docType: string) => {
        if (docType === DOC_TYPES.PROCUREMENT_ORDERS) {
            const order = purchaseOrders?.find(po => po.name === docName);
            return order?.total_amount || 0;
        } else if (docType === DOC_TYPES.SERVICE_REQUESTS) {
            const order = serviceOrders?.find(sr => sr.name === docName);
            if (!order || !order.service_order_list?.list) return 0;

            const srTotal = order.service_order_list.list.reduce((acc, item) => acc + (parseNumber(item.rate) * parseNumber(item.quantity)), 0);
            return order.gst === "true" ? srTotal * 1.18 : srTotal;
        }
        return 0;
    }), [purchaseOrders, serviceOrders]);


    // --- Callbacks ---
    const handleNewPaymentSeen = useCallback((notification: NotificationType | undefined) => {
        if (notification && notification.seen === "false") {
            mark_seen_notification(db, notification);
        }
    }, [db, mark_seen_notification]);

    const openDialog = useCallback((payment: ProjectPayments, type: DialogActionType) => {
        setSelectedPayment(payment);
        setDialogActionType(type);
        setIsDialogOpen(true);
    }, []);

    const closeDialog = useCallback(() => setIsDialogOpen(false), []);

    // --- Static Filters for This View ---
    const staticFilters = useMemo(() => [
        ["status", "=", PAYMENT_STATUS.REQUESTED] // Only show payments with status "Requested"
    ], []);

    // --- Fields to Fetch for the Main DataTable ---
    const fieldsToFetchPP = useMemo(() => DEFAULT_PP_FIELDS_TO_FETCH.concat(['creation']), []);

    const ppSearchableFields = useMemo(() => PP_SEARCHABLE_FIELDS, []);

    // --- Date Filter Columns ---
    const dateColumns = useMemo(() => PP_DATE_COLUMNS, []);


    // --- Column Definitions ---
    const columns = useMemo<ColumnDef<ProjectPayments>[]>(() => [
        {
            accessorKey: "document_name", header: ({ column }) => <DataTableColumnHeader column={column} title="#PO / #SR" />,
            cell: ({ row }) => {
                const payment = row.original;
                const isNew = notifications.find(n => n.docname === payment.name && n.seen === "false" && n.event_id === "payment:new");
                const docLink = payment.document_name?.replaceAll("/", "&=");
                return (
                    <div role="button" tabIndex={0} onClick={() => handleNewPaymentSeen(isNew)} className="font-medium relative flex items-center gap-1.5 group">
                        {isNew && <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 animate-pulse" title="New Payment Request" />}
                        <span className="max-w-[150px] truncate" title={payment.document_name}>{payment.document_name}</span>
                        <HoverCard>
                            <HoverCardTrigger asChild>
                                <Link to={docLink}>
                                    <Info className="w-4 h-4 text-blue-600 cursor-pointer flex-shrink-0 opacity-70 group-hover:opacity-100" />
                                </Link>
                            </HoverCardTrigger>
                            <HoverCardContent className="text-xs w-auto p-1.5">View linked {payment.document_type === DOC_TYPES.PROCUREMENT_ORDERS ? "PO" : "SR"}</HoverCardContent>
                        </HoverCard>
                    </div>
                );
            }, size: 200,
            meta: {
                exportHeaderName: "PO/SR ID",
                exportValue: (row: ProjectPayments) => row.document_name,
            }
        },
        {
            accessorKey: "creation", header: ({ column }) => <DataTableColumnHeader column={column} title="Req. On" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>,
            size: 150,
            meta: {
                exportHeaderName: "Requested On",
                exportValue: (row: ProjectPayments) => formatDate(row.creation),
            }
        },
        {
            accessorKey: "vendor", header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
            cell: ({ row }) => {
                const vendor = vendorOptions.find(v => v.value === row.original.vendor);
                return <div className="font-medium truncate" title={vendor?.label}>{vendor?.label || row.original.vendor}</div>;
            },
            enableColumnFilter: true, size: 200,
            meta: {
                exportHeaderName: "Vendor",
                exportValue: (row: ProjectPayments) => vendorOptions.find(v => v.value === row.vendor)?.label || row.vendor,
            }
        },
        {
            accessorKey: "project", header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
            cell: ({ row }) => {
                const project = projectOptions.find(p => p.value === row.original.project);
                return <div className="font-medium truncate" title={project?.label}>{project?.label || row.original.project}</div>;
            },
            enableColumnFilter: true, size: 200,
            meta: {
                exportHeaderName: "Project",
                exportValue: (row: ProjectPayments) => projectOptions.find(p => p.value === row.project)?.label || row.project,
            }
        },
        {
            id: "po_value", header: ({ column }) => <DataTableColumnHeader column={column} title="PO Value" />,
            cell: ({ row }) => {
                const totalValue = getDocumentTotal(row.original.document_name, row.original.document_type);
                return <div className="font-medium pr-2">{formatToRoundedIndianRupee(totalValue)}</div>;
            }, size: 150, enableSorting: false,
            meta: {
                exportHeaderName: "PO Value",
                exportValue: (row: ProjectPayments) => formatToRoundedIndianRupee(getDocumentTotal(row.document_name, row.document_type)),
            }
        },
        {
            id: "total_paid_for_doc", header: ({ column }) => <DataTableColumnHeader column={column} title="Total Paid" />,
            cell: ({ row }) => {
                const amountPaid = getAmountPaid(row.original.document_name);
                return <div className="font-medium pr-2">{formatToRoundedIndianRupee(amountPaid)}</div>;
            }, size: 180, enableSorting: false,
            meta: {
                exportHeaderName: "Total Paid",
                exportValue: (row: ProjectPayments) => formatToRoundedIndianRupee(getAmountPaid(row.document_name)),
            }
        },
        {
            accessorKey: "amount", header: ({ column }) => <DataTableColumnHeader column={column} title="Req. Amt" />,
            cell: ({ row }) => <div className="font-medium pr-2">{formatToRoundedIndianRupee(parseNumber(row.getValue("amount")))}</div>,
            size: 150,
            meta: {
                exportHeaderName: "Requested Amount",
                exportValue: (row: ProjectPayments) => formatToRoundedIndianRupee(parseNumber(row.amount)),
            }
        },
        {
            accessorKey: "owner", header: ({ column }) => <DataTableColumnHeader column={column} title="Requested By" />,
            cell: ({ row }) => {
                const ownerUser = userList?.find((user) => user.name === row.original.owner);
                return <div className="font-medium truncate">{ownerUser?.full_name || row.original.owner}</div>;
            }, size: 180,
            meta: {
                exportHeaderName: "Requested By",
                exportValue: (row: ProjectPayments) => userList?.find((user) => user.name === row.owner)?.full_name || row.owner,
            }
        },
        {
            id: "actions", header: "Actions",
            cell: ({ row }) => (
                <div className="flex items-center gap-1"> {/* Reduced gap */}
                    <HoverCard><HoverCardTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 text-green-600 hover:text-green-700" onClick={() => openDialog(row.original, DIALOG_ACTION_TYPES.APPROVE)}><CircleCheck className="h-5 w-5" /></Button></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">Approve</HoverCardContent></HoverCard>

                    <HoverCard><HoverCardTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700" onClick={() => openDialog(row.original, DIALOG_ACTION_TYPES.REJECT)}><CircleX className="h-5 w-5" /></Button></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">Reject</HoverCardContent></HoverCard>

                    {/* <HoverCard><HoverCardTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:text-blue-700" onClick={() => openDialog(row.original, DIALOG_ACTION_TYPES.EDIT)}><SquarePen className="h-4 w-4" /></Button></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">Edit & Approve</HoverCardContent></HoverCard> */}
                </div>
            ), size: 120,
            meta: {
                excludedFromExport: true, // Exclude from export
            }
        },
    ], [notifications, projectOptions, vendorOptions, userList, handleNewPaymentSeen, openDialog, getDocumentTotal, getAmountPaid, allPaidPayments]);

    // --- useServerDataTable Hook Instantiation (moved up for columnFilters access) ---
    const {
        table, data, totalCount, isLoading: listIsLoading, error: listError,
        selectedSearchField, setSelectedSearchField,
        searchTerm, setSearchTerm,
        isRowSelectionActive,
        refetch,
        columnFilters,
    } = useServerDataTable<ProjectPayments>({
        doctype: DOCTYPE,
        columns: columns,
        fetchFields: fieldsToFetchPP,
        searchableFields: ppSearchableFields,
        urlSyncKey: URL_SYNC_KEY,
        defaultSort: 'creation desc',
        enableRowSelection: false,
        additionalFilters: staticFilters,
    });

    // --- Dynamic Facet Values with Counts ---
    const { facetOptions: projectFacetOptions, isLoading: isProjectFacetLoading } = useFacetValues({
        doctype: DOCTYPE,
        field: 'project',
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        additionalFilters: staticFilters,
    });

    const { facetOptions: vendorFacetOptions, isLoading: isVendorFacetLoading } = useFacetValues({
        doctype: DOCTYPE,
        field: 'vendor',
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        additionalFilters: staticFilters,
    });

    // --- Faceted Filter Options ---
    const facetFilterOptions = useMemo(() => ({
        project: { title: "Project", options: projectFacetOptions, isLoading: isProjectFacetLoading },
        vendor: { title: "Vendor", options: vendorFacetOptions, isLoading: isVendorFacetLoading },
    }), [projectFacetOptions, isProjectFacetLoading, vendorFacetOptions, isVendorFacetLoading]);

    // --- Update Logic using useFrappeUpdateDoc ---
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
    const handlePaymentUpdate = useCallback(async (actionType: DialogActionType, amount: number, payment_details?: any) => {
        if (!selectedPayment) return;
        const newStatus = (actionType === DIALOG_ACTION_TYPES.APPROVE || actionType === DIALOG_ACTION_TYPES.EDIT)
            ? PAYMENT_STATUS.APPROVED : PAYMENT_STATUS.REJECTED;
        try {
            await updateDoc(DOCTYPE, selectedPayment.name, {
                status: newStatus,
                amount: amount, // Already a number
                approval_date: formatDate(new Date(), 'YYYY-MM-DD'),
                ...(payment_details && { payment_details: JSON.stringify(payment_details) }) // Add UTR, Date etc.
            });
            refetch();
            closeDialog();

            //    mutate("payment_dashboard_stats_summary")

            toast({ title: "Success!", description: `Payment ${actionType} successfully!`, variant: "success" });
            // Refetch is handled by useServerDataTable on data change (via useFrappeDocTypeEventListener)
        } catch (error: any) {
            console.error("Failed to update payment:", error);
            toast({ title: "Update Failed!", description: error.message || "Could not update payment.", variant: "destructive" });
        }
    }, [selectedPayment, updateDoc, closeDialog, toast]);


    // --- useServerDataTable Hook moved up above facets for columnFilters access ---

    // --- Combined Loading & Error States ---
    const isPageLoading = projectsLoading || vendorsLoading || userListLoading || poLoading || srLoading || paidPaymentsLoading;

    const combinedError = projectsError || vendorsError || userError || poError || srError || listError || paidPaymentsError;

    if (combinedError && !data) { // Show error prominently if main data fails to load
        <AlertDestructive error={combinedError} />
    }

    return (
        <div className={`flex flex-col gap-2 ${totalCount > 0 ? 'max-h-[calc(100vh-80px)] overflow-hidden' : ''}`}>
            {isPageLoading && !data?.length ? (
                <TableSkeleton />
            ) : (
                <DataTable<ProjectPayments>
                    table={table}
                    columns={columns}
                    isLoading={listIsLoading}
                    error={listError}
                    totalCount={totalCount}
                    searchFieldOptions={ppSearchableFields}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    // globalFilterValue={globalFilter}
                    // onGlobalFilterChange={setGlobalFilter}
                    // searchPlaceholder="Search Payment Requests..."
                    // showItemSearchToggle={showItemSearchToggle} // Will be false as enableItemSearch is false
                    // itemSearchConfig={{
                    //     isEnabled: isItemSearchEnabled,
                    //     toggle: toggleItemSearch,
                    //     label: "Item Search"
                    // }}
                    summaryCard={
                        <PaymentSummaryCards totalCount={totalCount} />
                    }
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={dateColumns}
                    showExportButton={true} // Optional
                    onExport={'default'}
                // toolbarActions={...} // Optional
                />
            )}

            {selectedPayment && (
                <PaymentActionDialog
                    isOpen={isDialogOpen}
                    onOpenChange={setIsDialogOpen}
                    type={dialogActionType}
                    paymentData={selectedPayment}
                    vendorName={vendors?.find(v => v.name === selectedPayment.vendor)?.vendor_name}
                    onSubmit={handlePaymentUpdate}
                    isLoading={updateLoading}
                />
            )}
        </div>
    );
};

export default ApprovePayments;