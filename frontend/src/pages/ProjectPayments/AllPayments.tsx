import React, { useCallback, useContext, useMemo } from "react";
import { Link } from "react-router-dom";
import { ColumnDef } from "@tanstack/react-table";
import { FrappeConfig, FrappeContext, useFrappeGetDocList, Filter, FrappeDoc } from "frappe-react-sdk";
import { Download, Info } from "lucide-react";
import memoize from 'lodash/memoize';

// --- UI Components ---
import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";

// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { formatDate } from "@/utils/FormatDate";
import { formatForReport, formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { getPOTotal } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import SITEURL from "@/constants/siteURL";

// --- Types ---
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { DOC_TYPES, PAYMENT_STATUS } from "./approve-payments/constants";
import { useUsersList } from "../ProcurementRequests/ApproveNewPR/hooks/useUsersList";

// --- Helper Components ---
import { AmountPaidHoverCard } from "./AmountPaidHoverCard";
import { useVendorsList } from "../ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { DEFAULT_PP_FIELDS_TO_FETCH, getProjectPaymentsStaticFilters, PP_DATE_COLUMNS, PP_SEARCHABLE_FIELDS } from "./config/projectPaymentsTable.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";

interface SelectOption { label: string; value: string; }

interface AllPaymentsProps {
    tab?: string; // "Payments Pending" or "Payments Done"
    projectId?: string;
    customerId?: string;
    // Additional prop to distinguish URL state contexts if this component is used multiple times
    // on the same page with different projectId/customerId props.
    contextKey?: string;
}

// --- Constants ---
const DOCTYPE = DOC_TYPES.PROJECT_PAYMENTS;

const AllPaymentsTableWrapper: React.FC<{
    tab: string;
    columns: any;
    fieldsToFetch: string[];
    paymentsSearchableFields: SearchFieldOption[];
    staticFiltersForTab: any[];
    facetFilterOptions: any;
    dateColumns: any;
    URL_SYNC_KEY: string;
}> = ({
    tab,
    columns,
    fieldsToFetch,
    paymentsSearchableFields,
    staticFiltersForTab,
    facetFilterOptions,
    dateColumns,
    URL_SYNC_KEY
}) => {

        // --- useServerDataTable Hook Instantiation ---
        const {
            table, totalCount, isLoading: listIsLoading, error: listError,
            selectedSearchField, setSelectedSearchField,
            searchTerm, setSearchTerm,
        } = useServerDataTable<ProjectPayments>({
            doctype: DOCTYPE,
            columns: columns,
            fetchFields: fieldsToFetch,
            searchableFields: paymentsSearchableFields,
            urlSyncKey: URL_SYNC_KEY,
            defaultSort: tab === "Payments Done" ? 'payment_date desc' : 'creation desc',
            enableRowSelection: false, // No bulk actions currently
            additionalFilters: staticFiltersForTab,
        });

        return (
            <DataTable<ProjectPayments>
                table={table}
                columns={columns}
                isLoading={listIsLoading}
                error={listError}
                totalCount={totalCount}
                searchFieldOptions={paymentsSearchableFields}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetFilterOptions={facetFilterOptions}
                dateFilterColumns={dateColumns}
                showExportButton={true}
                onExport={'default'}
            />
        );
    };

export const AllPayments: React.FC<AllPaymentsProps> = ({
    tab = "Payments Pending", // Default tab
    projectId,
    customerId,
    contextKey = "all" // Default context for URL key
}) => {
    const { db } = useContext(FrappeContext) as FrappeConfig;

    // --- Dynamic URL Sync Key based on context and tab ---
    const urlSyncKey = useMemo(() =>
        `all_pay_${contextKey}_${tab.toLowerCase().replace(/\s+/g, '_')}`,
        [contextKey, tab]);


    // --- Supporting Data Fetches (for lookups, calculations, and initial filtering if customerId is present) ---
    const projectFiltersForLookup = useMemo(() =>
        customerId ? [["customer", "=", customerId]] : (projectId ? [["name", "=", projectId]] : []),
        [customerId, projectId]);

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        "Projects", { fields: ["name", "project_name"], filters: projectFiltersForLookup as Filter<FrappeDoc<Projects>>[], limit: 0 },
        `Projects_AllPay_${customerId || projectId || 'all'}`
    );

    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useVendorsList({ vendorTypes: ["Service", "Material", "Material & Service"] });
    // Fetch related POs and SRs for "PO Value" calculation
    const { data: purchaseOrders, isLoading: poLoading, error: poError } = useFrappeGetDocList<ProcurementOrder>(
        DOC_TYPES.PROCUREMENT_ORDERS, { fields: ["name", "order_list", "loading_charges", "freight_charges"], limit: 0 }, 'POs_AllPay'
    );
    const { data: serviceOrders, isLoading: srLoading, error: srError } = useFrappeGetDocList<ServiceRequests>(
        DOC_TYPES.SERVICE_REQUESTS, { fields: ["name", "service_order_list", "gst"], limit: 0 }, 'SRs_AllPay'
    );
    const { data: userList, isLoading: userListLoading, error: userError } = useUsersList();


    // --- Memoized Lookups & Calculations ---
    const projectOptions = useMemo<SelectOption[]>(() => projects?.map(p => ({ label: p.project_name, value: p.name })) || [], [projects]);
    const vendorOptions = useMemo<SelectOption[]>(() => vendors?.map(v => ({ label: v.vendor_name, value: v.name })) || [], [vendors]);
    const getVendorName = useCallback(memoize((vendorId?: string) => vendors?.find(v => v.name === vendorId)?.vendor_name || vendorId || "--"), [vendors]);

    const getDocumentTotal = useMemo(() => memoize((docName?: string, docType?: string): number => {
        if (!docName || !docType) return 0;
        if (docType === DOC_TYPES.PROCUREMENT_ORDERS) {
            const order = purchaseOrders?.find(po => po.name === docName);
            return order ? getPOTotal(order, parseNumber(order.loading_charges), parseNumber(order.freight_charges))?.totalAmt || 0 : 0;
        } else if (docType === DOC_TYPES.SERVICE_REQUESTS) {
            const order = serviceOrders?.find(sr => sr.name === docName);
            if (!order || !order.service_order_list?.list) return 0;
            const srTotal = order.service_order_list.list.reduce((acc, item) => acc + (parseNumber(item.rate) * parseNumber(item.quantity)), 0);
            return order.gst === "true" ? srTotal * 1.18 : srTotal;
        }
        return 0;
    }), [purchaseOrders, serviceOrders]);


    // --- Notification Handling ---
    const { notifications, mark_seen_notification } = useNotificationStore();
    const handleSeenNotification = useCallback((notification: NotificationType | undefined) => {
        if (notification && notification.seen === "false") mark_seen_notification(db, notification);
    }, [db, mark_seen_notification]);


    // --- Static Filters for `useServerDataTable` ---
    const staticFilters = useMemo(() => {
        const filters: Array<[string, string, any]> = [];

        const getTabBasedFilters = getProjectPaymentsStaticFilters(tab)
        filters.push(...getTabBasedFilters);
        // if (tab === "Payments Done") {
        //     filters.push(["status", "=", PAYMENT_STATUS.PAID]);
        // } else if (tab === "Payments Pending") {
        //     filters.push(["status", "in", [PAYMENT_STATUS.REQUESTED, PAYMENT_STATUS.APPROVED]]);
        // }

        if (projectId) {
            filters.push(["project", "=", projectId]);
        } else if (customerId && projects && projects.length > 0) {
            filters.push(["project", "in", projects.map(p => p.name)]);
        } else if (customerId && !projectsLoading && (!projects || projects.length === 0)) {
            // If customerId is provided but no projects found for them, ensure no payments are fetched
            filters.push(["project", "in", ["__NON_EXISTENT_PROJECT__"]]);
        }
        return filters;
    }, [tab, projectId, customerId, projects, projectsLoading]);


    // --- Fields to Fetch for the Main DataTable ---

    const fieldsToFetch = useMemo(() => DEFAULT_PP_FIELDS_TO_FETCH.concat(['creation', 'modified', 'payment_date', 'payment_attachment', 'tds', 'utr']), [])

    const paymentsSearchableFields = useMemo(() => PP_SEARCHABLE_FIELDS.concat(tab === "Payments Done" ? [{ value: "utr", label: "UTR", placeholder: "Search by UTR..." }] : ["Payments Pending", "All Payments"].includes(tab) ? [{ value: "status", label: "Status", placeholder: "Search by Status..." }] : []), [tab]);

    // --- Date Filter Columns ---
    const dateColumns = useMemo(() => PP_DATE_COLUMNS, []);


    // --- Column Definitions ---
    const columns = useMemo<ColumnDef<ProjectPayments>[]>(() => [
        { // Date column varies based on tab
            accessorKey: tab === "Payments Done" ? "payment_date" : "creation",
            header: ({ column }) => <DataTableColumnHeader column={column} title={tab === "Payments Done" ? "Paid On" : "Created On"} />,
            cell: ({ row }) => {
                const payment = row.original;
                const dateValue = tab === "Payments Done" ? payment.payment_date : payment.creation;
                const eventId = tab === "Payments Done" ? "payment:fulfilled" : null;
                const isNew = notifications.find(n => n.docname === payment.name && n.seen === "false" && n.event_id === eventId);
                return (
                    <div role="button" tabIndex={0} onClick={() => handleSeenNotification(isNew)} className="font-medium relative whitespace-nowrap">
                        {isNew && <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-5 animate-pulse" />}
                        {formatDate(dateValue || payment.creation)}
                    </div>
                );
            }, size: 150,
            meta: {
                exportHeaderName: tab === "Payments Done" ? "payment_date" : "creation",
                exportValue: (row: ProjectPayments) => {
                    const payment = row;
                    const dateValue = tab === "Payments Done" ? payment.payment_date : payment.creation;
                    return formatDate(dateValue || payment.creation);
                }
            }
        },
        {
            accessorKey: "document_name", header: "#PO / #SR",
            cell: ({ row }) => { /* ... (Doc # link logic as before) ... */
                const data = row.original;
                const docLink = data.document_name.replaceAll("/", "&=")
                return (<div className="font-medium flex items-center gap-1.5 group min-w-[170px]">
                    <span className="max-w-[150px] truncate" title={data.document_name}>{data.document_name}</span>
                    <HoverCard><HoverCardTrigger asChild><Link to={`/project-payments/${docLink}`}><Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" /></Link></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">View linked {data.document_type === DOC_TYPES.PROCUREMENT_ORDERS ? "PO" : "SR"}</HoverCardContent></HoverCard>
                </div>);
            }, size: 200,
            meta: {
                exportHeaderName: "PO/SR",
                exportValue: (row: ProjectPayments) => {
                    return row.document_name;

                }
            }
        },
        {
            accessorKey: "vendor", header: "Vendor",
            cell: ({ row }) => {
                const vendorName = getVendorName(row.original.vendor);
                return (<div className="font-medium flex items-center gap-1.5 group min-w-[170px]">
                    <span className="max-w-[150px] truncate" title={vendorName}>{vendorName}</span>
                    <HoverCard><HoverCardTrigger asChild><Link to={`/vendors/${row.original.vendor}`}><Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" /></Link></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">View linked vendor</HoverCardContent></HoverCard>
                </div>);
            },
            enableColumnFilter: true, size: 200,
            meta: {
                exportHeaderName: "Vendor",
                exportValue: (row: ProjectPayments) => {
                    return getVendorName(row.vendor);
                }
            }
        },
        ...(!projectId ? [{ // Conditionally show Project column
            accessorKey: "project", header: "Project",
            cell: ({ row }) => {
                const projectLabel = projects?.find(p => p.name === row.original.project)?.project_name;
                return <div className="font-medium truncate max-w-[150px]" title={projectLabel}>{projectLabel || row.original.project}</div>;
            },
            enableColumnFilter: true, size: 180,
            meta: {
                exportHeaderName: "Project",
                exportValue: (row: ProjectPayments) => {
                    const projectLabel = projects?.find(p => p.name === row.project)?.project_name;
                    return projectLabel || row.project;
                }
            }
        } as ColumnDef<ProjectPayments>] : []),
        {
            id: "doc_value_col", header: ({ column }) => <DataTableColumnHeader column={column} title="PO Value" />,
            cell: ({ row }) => <div className="font-medium pr-2">{formatToRoundedIndianRupee(getDocumentTotal(row.original.document_name, row.original.document_type))}</div>,
            size: 130, enableSorting: false,
            meta: {
                exportHeaderName: "PO Value",
                exportValue: (row: ProjectPayments) => {
                    return formatForReport(getDocumentTotal(row.document_name, row.document_type));
                }
            }
        },
        { // Requested/Paid Amount
            accessorKey: "amount",
            header: ({ column }) => <DataTableColumnHeader column={column} title={tab === "Payments Done" ? "Amt. Paid" : "Amt. To Pay"} />,
            cell: ({ row }) => {
                const payment = row.original;
                const displayAmount = parseNumber(payment.amount);
                return tab === "Payments Done" ? <AmountPaidHoverCard paymentInfo={payment} /> : <div className="font-medium pr-2">{formatToRoundedIndianRupee(displayAmount)}</div>;
            },
            size: 130,
            meta: {
                exportHeaderName: tab === "Payments Done" ? "Amt. Paid" : "Amt. To Pay",
                exportValue: (row: ProjectPayments) => {
                    const displayAmount = parseNumber(row.amount);
                    return formatForReport(displayAmount);
                }
            }
        },
        ...(tab === "Payments Done" ? [ // Columns only for "Payments Done"
            {
                accessorKey: "utr", header: "UTR",
                cell: ({ row }) => (row.original.payment_attachment ? (<a href={SITEURL + row.original.payment_attachment} target="_blank" rel="noreferrer" className="font-medium text-blue-600 underline">{row.original.utr || "View Proof"}</a>) : <div className="font-medium">{row.original.utr || '--'}</div>),
                size: 150,
                meta: {
                    exportHeaderName: "UTR",
                    exportValue: (row: ProjectPayments) => {
                        return row.utr || "--";
                    }
                }
            },
            // {
            //     accessorKey: "tds", header: ({ column }) => <DataTableColumnHeader column={column} title="TDS" />,
            //     cell: ({ row }) => <div className="font-medium pr-2">{row.original.tds ? formatToRoundedIndianRupee(parseNumber(row.original.tds)) : "--"}</div>,
            //     size: 100,
            // },
            {
                id: "download_action", header: "Proof",
                cell: ({ row }) => row.original.payment_attachment ? (<a href={SITEURL + row.original.payment_attachment} target="_blank" rel="noreferrer"><Download className="h-4 w-4 text-blue-500" /></a>) : null,
                size: 80,
                meta: {
                    excludeFromExport: true
                }
            }
        ] as ColumnDef<ProjectPayments>[] : []),
        ...(["Payments Pending", "All Payments"].includes(tab) ? [{
            accessorKey: "status", header: "Status",
            cell: ({ row }) => <Badge variant={row.original.status === PAYMENT_STATUS.APPROVED ? "default" : row.original.status === PAYMENT_STATUS.PAID ? "green" : "outline"}>{row.original.status}</Badge>,
            enableColumnFilter: true, size: 120
        } as ColumnDef<ProjectPayments>] : []),
    ], [tab, projectId, notifications, projectOptions, vendorOptions, userList, getVendorName, getDocumentTotal, handleSeenNotification]);

    // --- Faceted Filter Options ---
    const facetFilterOptions = useMemo(() => {
        const opts: any = {
            vendor: { title: "Vendor", options: vendorOptions },
        };
        if (!projectId) { // Only show project facet if not already filtered by a specific project
            opts.project = { title: "Project", options: projectOptions };
        }
        if (["Payments Pending", "All Payments"].includes(tab)) {
            opts.status = { title: "Status", options: [{ value: PAYMENT_STATUS.REQUESTED, label: "Requested" }, { value: PAYMENT_STATUS.APPROVED, label: "Approved" }, ...(tab === "All Payments") ? [{ value: PAYMENT_STATUS.PAID, label: "Paid" }, { value: PAYMENT_STATUS.REJECTED, label: "Rejected" }] : []] };
        }
        return opts;
    }, [projectOptions, vendorOptions, projectId, tab]);


    // --- Combined Loading & Error States ---
    const isLoadingOverall = projectsLoading || vendorsLoading || userListLoading || poLoading || srLoading;
    const combinedErrorOverall = projectsError || vendorsError || poError || srError || userError;

    if (combinedErrorOverall) {
        <AlertDestructive error={combinedErrorOverall} />
    }


    return (
        <div className="flex-1 space-y-4">

            {isLoadingOverall ? (
                <TableSkeleton />
            ) : (
                <AllPaymentsTableWrapper
                    key={urlSyncKey} // Key on wrapper ensures complete remount
                    tab={tab}
                    columns={columns}
                    fieldsToFetch={fieldsToFetch}
                    paymentsSearchableFields={paymentsSearchableFields}
                    staticFiltersForTab={staticFilters}
                    facetFilterOptions={facetFilterOptions}
                    dateColumns={dateColumns}
                    URL_SYNC_KEY={urlSyncKey}
                />
            )}
        </div>
    );
};

export default AllPayments;