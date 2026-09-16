import React, { useCallback, useContext, useMemo, useState } from "react";
import { Row } from "@tanstack/react-table";
import { FrappeConfig, FrappeContext, useFrappeGetDocList, Filter, FrappeDoc, useFrappeDocTypeEventListener } from "frappe-react-sdk";
import memoize from 'lodash/memoize';

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table';
import { useCEOHoldProjects } from "@/hooks/useCEOHoldProjects";
import { CEO_HOLD_ROW_CLASSES } from "@/utils/ceoHoldRowStyles";

import { TableSkeleton } from "@/components/ui/skeleton";

// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import {
    APPROVAL_QUEUE_API,
    APPROVAL_FETCH_FIELDS,
    APPROVAL_DATE_COLUMNS,
    APPROVAL_SEARCHABLE_FIELDS,
    ApprovalQueueRow,
    ApprovalTab,
    TAB_COLUMNS,
    TAB_DEFAULT_SORT,
} from "./config/approvalsTable.config";
import { buildApprovalColumns, ApprovalColumnCtx } from "./config/approvalColumns";
import { useApprovalQueueExport } from "./hooks/useApprovalQueueExport";
import UpdatePaymentRequestDialog, { ProjectPaymentUpdateFields } from "./update-payment/UpdatePaymentDialog";
import { UpdatePaymentDetailsDialog as ProjectExpensePayDialog } from "../ProjectExpenses/components/UpdatePaymentDetailsDialog";
import { UpdatePaymentDetailsDialog as NonProjectExpensePayDialog } from "../NonProjectExpenses/components/UpdatePaymentDetailsDialog";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { useApprovalFacets } from "./config/useApprovalFacets";
import { formatDate } from "@/utils/FormatDate";
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";

// --- Types ---
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { DOC_TYPES } from "./approve-payments/constants";
import { useUsersList } from "../ProcurementRequests/ApproveNewPR/hooks/useUsersList";

// --- Helper Components ---
import { useVendorsList } from "../ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { buildPaymentsUrlSyncKey, getProjectPaymentsStaticFilters } from "./config/projectPaymentsTable.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { EditFulfilledPaymentDialog } from "./update-payment/EditFulfilledPaymentDialog"; // Import the new dialog
import { useUserData } from "@/hooks/useUserData";
import { useDialogStore } from "@/zustand/useDialogStore";


import PaymentSummaryCards from "./PaymentSummaryCards"
import { useRefreshApprovalCounts } from "./hooks/useRefreshApprovalCounts"
import { canViewPaymentSummary } from "@/constants/roles"

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

// const AllPaymentsTableWrapper: React.FC<{
//     tab: string;
//     columns: any;
//     fieldsToFetch: string[];
//     paymentsSearchableFields: SearchFieldOption[];
//     staticFiltersForTab: any[];
//     facetFilterOptions: any;
//     dateColumns: any;
//     URL_SYNC_KEY: string;
// }> = ({
//     tab,
//     columns,
//     fieldsToFetch,
//     paymentsSearchableFields,
//     staticFiltersForTab,
//     facetFilterOptions,
//     dateColumns,
//     URL_SYNC_KEY
// }) => {

//         // --- useServerDataTable Hook Instantiation ---
//         const {
//             table, totalCount, isLoading: listIsLoading, error: listError,
//             selectedSearchField, setSelectedSearchField,
//             searchTerm, setSearchTerm, refetch,
//         } = useServerDataTable<ProjectPayments>({
//             doctype: DOCTYPE,
//             columns: columns,
//             fetchFields: fieldsToFetch,
//             searchableFields: paymentsSearchableFields,
//             urlSyncKey: URL_SYNC_KEY,
//             defaultSort: TAB_DEFAULT_SORT[tab as ApprovalTab],
//             enableRowSelection: false, // No bulk actions currently
//             additionalFilters: staticFiltersForTab,
//         });

//         return (
//             <DataTable<ApprovalQueueRow>
//                 table={table}
//                 columns={columns}
//                 isLoading={listIsLoading}
//                 error={listError}
//                 totalCount={totalCount}
//                 searchFieldOptions={APPROVAL_SEARCHABLE_FIELDS}
//                 selectedSearchField={selectedSearchField}
//                 onSelectedSearchFieldChange={setSelectedSearchField}
//                 searchTerm={searchTerm}
//                 onSearchTermChange={setSearchTerm}
//                 facetFilterOptions={facetFilterOptions}
//                 dateFilterColumns={dateColumns}
//                 showExportButton={true}
//                 onExport={'default'}
//             />
//         );
//     };

export const AllPayments: React.FC<AllPaymentsProps> = ({
    tab = "Payments Pending", // Default tab
    projectId,
    customerId,
    contextKey = "all" // Default context for URL key
}) => {
    const { db } = useContext(FrappeContext) as FrappeConfig;
    const { role, user_id } = useUserData(); // Get user role
    const refreshTabCounts = useRefreshApprovalCounts();

    // --- CEO Hold Highlighting ---
    const { ceoHoldProjectIds } = useCEOHoldProjects();
    const isAdmin = role === "Nirmaan Admin Profile"; // Check for admin role

    const { setEditFulfilledPaymentDialog } = useDialogStore(); // Get the setter for the new dialog
    const [paymentToEdit, setPaymentToEdit] = useState<ProjectPayments | null>(null); // State to hold the payment for the dialog

    const handleOpenEditDialog = useCallback((payment: ProjectPayments) => {
        setPaymentToEdit(payment);
        setEditFulfilledPaymentDialog(true);
    }, [setEditFulfilledPaymentDialog]);

    // --- Dynamic URL Sync Key based on context and tab ---
    // ⚠️ Built by the SHARED helper, not inline. Outside screens deep-link into these tables by
    // constructing `<key>_q` / `<key>_searchBy`, so the format has to have one owner -- a second
    // copy would fail silently (an unfiltered table) rather than error.
    const urlSyncKey = useMemo(() => buildPaymentsUrlSyncKey(contextKey, tab), [contextKey, tab]);


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
        DOC_TYPES.PROCUREMENT_ORDERS, { fields: ["name", "total_amount", "loading_charges", "freight_charges", "po_amount_delivered"], limit: 0 }, 'POs_AllPay'
    );
    const { data: serviceOrders, isLoading: srLoading, error: srError } = useFrappeGetDocList<ServiceRequests>(
        DOC_TYPES.SERVICE_REQUESTS,
        { fields: ["name", "total_amount", "gst"], limit: 0 },
        'SRs_AllPay'
    );
    const { data: userList, isLoading: userListLoading, error: userError } = useUsersList();


    // --- Memoized Lookups & Calculations ---
    const projectMap = useMemo(() => {
        const map = new Map<string, string>();
        projects?.forEach(p => map.set(p.name, p.project_name));
        return map;
    }, [projects]);
    const vendorOptions = useMemo<SelectOption[]>(() => vendors?.map(v => ({ label: v.vendor_name, value: v.name })) || [], [vendors]);

    const getDocumentTotal = useMemo(() => memoize((docName?: string, docType?: string): number => {
        if (!docName || !docType) return 0;
        if (docType === DOC_TYPES.PROCUREMENT_ORDERS) {
            const order = purchaseOrders?.find(po => po.name === docName);
            return order?.total_amount || 0;
        } else if (docType === DOC_TYPES.SERVICE_REQUESTS) {
            const order = serviceOrders?.find(sr => sr.name === docName);
            // `total_amount` is computed on every save (validate) and already
            // includes GST when sr.gst === "true". Read it directly.
            return parseNumber(order?.total_amount);
        }
        return 0;
    }), [purchaseOrders, serviceOrders]);

    const getPoAmountDelivered = useMemo(() => memoize((docName?: string, docType?: string): number => {
        if (!docName || docType !== DOC_TYPES.PROCUREMENT_ORDERS) return 0;
        const order = purchaseOrders?.find(po => po.name === docName);
        return parseNumber(order?.po_amount_delivered);
    }, (docName?: string, docType?: string) => `${docName}-${docType}`), [purchaseOrders]);


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

    // --- Date Filter Columns ---
    const dateColumns = useMemo(() => APPROVAL_DATE_COLUMNS, []);


    // --- Column Definitions ---
    // --- Column Definitions ---
    //
    // Was a 179-line inline block threaded with `tab === "Payments Done"` ternaries.
    // Now a registry + a per-tab id array, so a column has ONE definition and the
    // array is the order. See config/approvalsTable.config.ts (TAB_COLUMNS).
    const userLabelMap = useMemo(() => {
        const m = new Map<string, string>();
        for (const u of userList ?? []) m.set(u.name, (u as any).full_name || u.name);
        return m;
    }, [userList]);

    const vendorLabelMap = useMemo(() => {
        const m = new Map<string, string>();
        for (const o of vendorOptions) m.set(o.value, o.label);
        return m;
    }, [vendorOptions]);

    // ── "Mark Reconciled" → the ACTUAL payment dialog, routed by LEDGER ──────
    //
    // Each ledger settles through its own dialog and its own write path; there is
    // no shared one, and inventing one would mean reimplementing three sets of
    // validation. So the row's `doctype` picks the dialog:
    //   Project Payments     → UpdatePaymentRequestDialog (fulfil) → update_payment_request
    //   Project Expenses     → ProjectExpensePayDialog  (markAsPaid) → updateDoc
    //   Non Project Expenses → NonProjectExpensePayDialog (markAsPaid) → updateDoc
    const [payRow, setPayRow] = useState<ApprovalQueueRow | null>(null);
    const [payPayment, setPayPayment] = useState<ProjectPaymentUpdateFields | null>(null);
    const { togglePaymentDialog } = useDialogStore();

    // The two expense dialogs want the WHOLE stored document, not the normalized
    // queue row — they render invoice fields and existing attachments the union
    // does not carry. Fetched only while one is open.
    const isExpenseRow = !!payRow && payRow.doctype !== "Project Payments";
    const { data: payExpenseDoc } = useFrappeGetDoc<any>(
        payRow?.doctype as string,
        payRow?.name as string,
        isExpenseRow && payRow ? undefined : null
    );

    const openPayDialog = useCallback((row: ApprovalQueueRow) => {
        if (row.doctype === "Project Payments") {
            setPayPayment({
                name: row.name,
                project: row.project,
                project_label: projectMap.get(row.project) || row.project,
                vendor_label: vendorLabelMap.get(row.vendor) || row.vendor,
                document_name: row.document_name,
                document_type: row.document_type,
                amount: row.amount,
                status: row.status,
            });
            togglePaymentDialog();
            return;
        }
        setPayRow(row);
    }, [projectMap, vendorLabelMap, togglePaymentDialog]);

    const columnCtx = useMemo<ApprovalColumnCtx>(() => ({
        tab: tab as ApprovalTab,
        projectLabels: projectMap,
        vendorLabels: vendorLabelMap,
        userLabels: userLabelMap,
        getDocumentTotal,
        getPoAmountDelivered,
        // The settled tab keeps its admin Edit — see the note in TAB_COLUMNS.
        onEdit: isAdmin
            ? (row) => handleOpenEditDialog(row as unknown as ProjectPayments)
            : undefined,
        onMarkReconciled: openPayDialog,
        isUnseen: (row) => !!notifications.find(
            (n) => n.docname === row.name && n.seen === "false"
                && n.event_id === (tab === "Payments Done" ? "payment:fulfilled" : null)
        ),
        onSeen: (row) => handleSeenNotification(
            notifications.find((n) => n.docname === row.name && n.seen === "false")
        ),
    }), [
        tab, projectMap, vendorLabelMap, userLabelMap, getDocumentTotal,
        getPoAmountDelivered, isAdmin, handleOpenEditDialog, notifications,
        handleSeenNotification, openPayDialog,
    ]);

    const columns = useMemo(() => {
        const ids = TAB_COLUMNS[tab as ApprovalTab];
        // On the settled tab the Actions column holds ONLY the admin Edit pencil, so for
        // anyone else it was an empty column with a header. Drop it outright rather than
        // render it blank — keyed on the SAME `isAdmin` that wires `onEdit`, so the header
        // and the pencil can never disagree.
        const visibleIds = tab === "Payments Done" && !isAdmin
            ? ids.filter((id) => id !== "actions")
            : ids;
        return buildApprovalColumns(visibleIds, columnCtx);
    }, [tab, isAdmin, columnCtx]);

    // Status varies only on the mixed-status tabs, so the facet is offered there.
    const approvalFacets = useApprovalFacets({
        filters: staticFilters as Array<[string, string, unknown]>,
        projectLabels: projectMap,
        vendorLabels: vendorLabelMap,
        includeStatus: ["Payments Pending", "All Payments"].includes(tab),
    });

    // --- (Indicator) FIX: Move useServerDataTable hook here, into the parent component ---
    const {
        table,
        totalCount,
        isLoading: listIsLoading,
        error: listError,
        refetch, // `refetch` is now available in this scope!
        selectedSearchField,
        setSelectedSearchField,
        searchTerm,
        setSearchTerm,
        exportAllRows,
        isExporting,
    } = useServerDataTable<ApprovalQueueRow>({
        // Nominal: the endpoint below unions all three money-out ledgers.
        doctype: DOCTYPE,
        apiEndpoint: APPROVAL_QUEUE_API,
        columns: columns,
        fetchFields: APPROVAL_FETCH_FIELDS,
        searchableFields: APPROVAL_SEARCHABLE_FIELDS,
        urlSyncKey: urlSyncKey,
        defaultSort: TAB_DEFAULT_SORT[tab as ApprovalTab],
        enableRowSelection: false,
        additionalFilters: staticFilters,
    });

    // Full-table CSV. Replaces the table's built-in `'default'` handler rather than
    // extending it: the default exports only the RENDER columns, three of which carry
    // no `exportValue` and so came out blank. See `approvalExportColumns.ts`.
    const exportFileName = `${tab.replace(/\s+/g, '_')}_${formatDate(new Date())}`;
    const { exportAll, isExportingAll } = useApprovalQueueExport({
        exportAllRows,
        columnCtx,
        fileName: exportFileName,
    });

    // --- CEO Hold Row Highlighting ---

    // ⚠️ THE TABLE ONLY SELF-REFRESHES FOR ITS NOMINAL DOCTYPE.
    //
    // `useServerDataTable` ends with `useFrappeDocTypeEventListener(doctype, ...)`
    // (hooks/useServerDataTable.ts:795) and we pass "Project Payments" — so a new or
    // changed EXPENSE never reaches it, even though expense rows are in this table.
    // These two listeners close that gap for both expense ledgers.
    //
    // (An earlier attempt invalidated by SWR key instead. That was dead code: this
    // table fetches through `useFrappePostCall`, which registers no SWR entry at all,
    // and every mutate() in the hook is commented out.)
    useFrappeDocTypeEventListener("Project Expenses", () => refetch());
    useFrappeDocTypeEventListener("Non Project Expenses", () => refetch());

    const getRowClassName = useCallback(
        (row: Row<ApprovalQueueRow>) => {
            const projectId = row.original.project;
            if (projectId && ceoHoldProjectIds.has(projectId)) {
                return CEO_HOLD_ROW_CLASSES;
            }
            return undefined;
        },
        [ceoHoldProjectIds]
    );

    // --- Combined Loading & Error States ---
    const isLoadingOverall = projectsLoading || vendorsLoading || userListLoading || poLoading || srLoading || listIsLoading;
    const combinedErrorOverall = projectsError || vendorsError || poError || srError || userError || listError;

    if (combinedErrorOverall) {
        <AlertDestructive error={combinedErrorOverall} />
    }


    return (
        <div className="flex-1 space-y-4">

            {isLoadingOverall ? (
                <TableSkeleton />
            ) : (
                // --- (Indicator) Render DataTable directly, removing the wrapper ---
                <DataTable<ApprovalQueueRow>
                    table={table}
                    columns={columns}
                    isLoading={listIsLoading}
                    error={listError}
                    totalCount={totalCount}
                    searchFieldOptions={APPROVAL_SEARCHABLE_FIELDS}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    facetFilterOptions={approvalFacets}
                    dateFilterColumns={dateColumns}
                    showExportButton={true}
                    // Selection is OFF on these tabs, so the built-in button is never
                    // disabled — only the HANDLER needed replacing, not the control.
                    onExport={exportAll}
                    isExporting={isExporting || isExportingAll}
                    exportFileName={exportFileName}
                    summaryCard={projectId || customerId || !canViewPaymentSummary(role, user_id) ? null : <PaymentSummaryCards totalCount={totalCount} />}
                    getRowClassName={getRowClassName}

                // toolbarActions={
                //     (!projectId && !customerId) && (
                //         <Button onClick={toggleNewInflowDialog} size="sm">
                //             <PlusCircle className="mr-2 h-4 w-4" /> Add New Inflow
                //         </Button>
                //     )
                // }
                />
            )}
            {payPayment && (
                <UpdatePaymentRequestDialog
                    mode="fulfil"
                    payment={payPayment}
                    onSuccess={() => { setPayPayment(null); refetch(); refreshTabCounts(); }}
                />
            )}

            {payRow?.doctype === "Project Expenses" && payExpenseDoc && (
                <ProjectExpensePayDialog
                    isOpen
                    setIsOpen={(open) => { if (!open) setPayRow(null); }}
                    expense={payExpenseDoc}
                    markAsPaid
                    onSuccess={() => { setPayRow(null); refetch(); refreshTabCounts(); }}
                    getProjectName={(id) => projectMap.get(id || "") || id || ""}
                    getVendorName={(id) => vendorLabelMap.get(id || "") || id || ""}
                />
            )}

            {payRow?.doctype === "Non Project Expenses" && payExpenseDoc && (
                <NonProjectExpensePayDialog
                    isOpen
                    setIsOpen={(open) => { if (!open) setPayRow(null); }}
                    expense={payExpenseDoc}
                    markAsPaid
                    onSuccess={() => { setPayRow(null); refetch(); refreshTabCounts(); }}
                />
            )}

            {/* --- (Indicator) NEW: Render the EditFulfilledPaymentDialog --- */}
            {paymentToEdit && (
                <EditFulfilledPaymentDialog
                    payment={paymentToEdit}
                    onSuccess={() => {
                        refetch(); // Refetch the table data after a successful edit
                        refreshTabCounts();
                        setPaymentToEdit(null); // Clear the state
                        // The dialog will close itself by calling its store setter.
                    }}
                />
            )}
        </div>
    );
};

export default AllPayments;