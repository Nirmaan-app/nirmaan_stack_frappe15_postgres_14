import React, { useCallback, useContext, useMemo, useState } from "react";
import { Row } from "@tanstack/react-table";
import { FrappeConfig, FrappeContext, useFrappeGetDocList, Filter, FrappeDoc, useFrappeDocTypeEventListener, useFrappeDeleteDoc, useFrappePostCall } from "frappe-react-sdk";
import { useNavigate } from "react-router-dom";
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
    TYPE_LABEL,
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
import { Projects } from "@/types/NirmaanStack/Projects";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { DOC_TYPES } from "./approve-payments/constants";
import { useUsersList } from "../ProcurementRequests/ApproveNewPR/hooks/useUsersList";

// --- Helper Components ---
import { useVendorsList } from "../ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { buildPaymentsUrlSyncKey, getProjectPaymentsStaticFilters } from "./config/projectPaymentsTable.config";
import { PP_ACCOUNTANT_ROLES, PP_TABS } from "./config/ppTabs.constants";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { QueueRowEditDialog } from "./components/QueueRowEditDialog";
import { canEditQueueRow, canRevertQueueRow, canWorkQueueRows } from "./config/queueRowActions";
import { useUserData } from "@/hooks/useUserData";
import { useDialogStore } from "@/zustand/useDialogStore";


import PaymentSummaryCards from "./PaymentSummaryCards"
import { useRefreshApprovalCounts } from "./hooks/useRefreshApprovalCounts"
import { canViewPaymentSummary } from "@/constants/roles"
import { useToast } from "@/components/ui/use-toast"
import { getFrappeError } from "@/utils/frappeErrors"
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice"
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"

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
    // The two identities the server's `is_nirmaan_admin` accepts. Drives "Payment By Me":
    // an Admin sees every row there, so the "Raised by" column is added for them.
    const isNirmaanAdmin = isAdmin || user_id === "Administrator";
    const { toast } = useToast();

    // --- "Payment By Me" delete (Rejected rows only; the column shows "--" otherwise) ---
    // The Trash icon opens ONE dialog, which branches on the ledger (owner, 17 Sep 2026):
    //   expense           -> "are you sure?" -> the same `deleteDoc` the expense pages use
    //   PO / SR payment   -> NOT deleted here; the dialog links to its PO / SR page, whose
    //                        payment table already deletes a Rejected payment
    const navigate = useNavigate();
    const [deleteRow, setDeleteRow] = useState<ApprovalQueueRow | null>(null);
    const { deleteDoc, loading: deleting } = useFrappeDeleteDoc();
    const deleteIsPayment = deleteRow?.doctype === "Project Payments";
    const deleteParentLabel = deleteRow?.document_type === "Service Requests" ? "SR" : "PO";
    const openDeleteParent = useCallback(() => {
        if (!deleteRow?.document_name) return;
        const id = deleteRow.document_name.replace(/\//g, "&=");
        setDeleteRow(null);
        // `Dispatched PO`, not the page's `Approved PO` default: that one shows a "Heads Up"
        // screen instead of the PO for any PO already past `PO Approved`.
        navigate(deleteRow.document_type === "Service Requests"
            ? `/service-requests/${id}?tab=approved-sr`
            : `/purchase-orders/${id}?tab=Dispatched PO`);
    }, [deleteRow, navigate]);

    // --- Expense Edit pencil + payment "Revert to Approved" (owner, 2026-09-21) ---
    // Who may press either is ONE rule, `queueRowActions`; the old admin payment-edit pencil
    // (retired 17 Sep, and it saved blanks over UTR / date / proof) is gone for good.
    const canWork = canWorkQueueRows(role);
    const [editRow, setEditRow] = useState<ApprovalQueueRow | null>(null);
    const closeEdit = useCallback(() => setEditRow(null), []);
    const [revertRow, setRevertRow] = useState<ApprovalQueueRow | null>(null);
    const { call: revertCall, loading: reverting } = useFrappePostCall(
        "nirmaan_stack.api.payments.revert_to_approved.revert_payment_to_approved"
    );

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
                cheque_no: row.cheque_no || undefined,
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
        onEdit: canWork ? setEditRow : undefined,
        canEdit: (row) => canEditQueueRow(row, role),
        onRevert: canWork ? setRevertRow : undefined,
        canRevert: (row) => canRevertQueueRow(row, role),
        onMarkReconciled: openPayDialog,
        onDelete: tab === PP_TABS.PAYMENT_BY_ME ? setDeleteRow : undefined,
        isUnseen: (row) => !!notifications.find(
            (n) => n.docname === row.name && n.seen === "false"
                && n.event_id === (tab === "Payments Done" ? "payment:fulfilled" : null)
        ),
        onSeen: (row) => handleSeenNotification(
            notifications.find((n) => n.docname === row.name && n.seen === "false")
        ),
    }), [
        tab, projectMap, vendorLabelMap, userLabelMap, getDocumentTotal,
        getPoAmountDelivered, canWork, role, notifications,
        handleSeenNotification, openPayDialog,
    ]);

    const columns = useMemo(() => {
        const ids = TAB_COLUMNS[tab as ApprovalTab];
        // On the settled and mixed-status tabs the Actions column holds ONLY the expense Edit
        // pencil, so for anyone who cannot edit it would be an empty column with a header. Drop it
        // outright rather than render it blank — keyed on the SAME `canWork` that wires `onEdit`,
        // so the header and the pencil can never disagree.
        // Reconciliation Pending likewise: its Actions column is Mark Reconciled / Revert / Edit,
        // all for the settle roles (Admin / Accountants). HR can open the tab, view-only (owner, 17
        // Sep 2026) -- same rule as RenderProjectPaymentsComponent's `canSettlePayments`.
        const canSettle = isAdmin || PP_ACCOUNTANT_ROLES.includes(role);
        const pencilOnlyTab = tab === PP_TABS.PAYMENTS_DONE
            || tab === PP_TABS.PAYMENTS_PENDING
            || tab === PP_TABS.ALL_PAYMENTS;
        const hideActions = (pencilOnlyTab && !canWork)
            || (tab === PP_TABS.RECONCILIATION_PENDING && !canSettle);
        const visibleIds = hideActions
            ? ids.filter((id) => id !== "actions")
            : ids;
        // "Payment By Me" lists EVERY row for an Admin (server-side, `CURRENT_USER_TOKEN`),
        // so the rows are no longer all the viewer's own and "Raised by" earns its column.
        // Same two identities as the server's `is_nirmaan_admin`.
        const byMeShowsAll = tab === PP_TABS.PAYMENT_BY_ME && isNirmaanAdmin;
        return buildApprovalColumns(byMeShowsAll ? [...visibleIds, "raised_by"] : visibleIds, columnCtx);
    }, [tab, isAdmin, role, canWork, isNirmaanAdmin, columnCtx]);


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
        columnFilters,
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

    // Status varies only on the mixed-status tabs, so the facet is offered there. Called AFTER
    // the table hook: facet counts follow the table's live column filters and search.
    const approvalFacets = useApprovalFacets({
        filters: staticFilters as Array<[string, string, unknown]>,
        columnFilters,
        searchTerm,
        selectedSearchField,
        projectLabels: projectMap,
        vendorLabels: vendorLabelMap,
        userLabels: userLabelMap,
        includeStatus: ([PP_TABS.PAYMENTS_PENDING, PP_TABS.ALL_PAYMENTS, PP_TABS.PAYMENT_BY_ME] as string[]).includes(tab),
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

    const handleConfirmDelete = useCallback(async () => {
        if (!deleteRow) return;
        try {
            await deleteDoc(deleteRow.doctype, deleteRow.name);
            toast({
                title: "Deleted",
                description: `Expense ${deleteRow.against_primary || deleteRow.name} was deleted.`,
                variant: "success",
            });
            setDeleteRow(null);
            refetch();
            refreshTabCounts();
        } catch (error) {
            toast({ title: "Couldn't delete", description: getFrappeError(error), variant: "destructive" });
        }
    }, [deleteRow, deleteDoc, toast, refetch, refreshTabCounts]);

    // "Revert to Approved": the server re-checks the status, the role and any bank-line match
    // (`api/payments/revert_to_approved.py`); this only asks and reports.
    const handleConfirmRevert = useCallback(async () => {
        if (!revertRow) return;
        try {
            await revertCall({ name: revertRow.name });
            toast({
                title: "Reverted to Approved",
                description: `${revertRow.name} is back in "Payment need to paid".`,
                variant: "success",
            });
            setRevertRow(null);
            refetch();
            refreshTabCounts();
        } catch (error) {
            toast({ title: "Couldn't revert", description: getFrappeError(error), variant: "destructive" });
        }
    }, [revertRow, revertCall, toast, refetch, refreshTabCounts]);

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
                    facetFilterOptions={approvalFacets.facetOptions}
                    onFacetOpen={approvalFacets.onFacetOpen}
                    dateFilterColumns={dateColumns}
                    showExportButton={true}
                    // Selection is OFF on these tabs, so the built-in button is never
                    // disabled — only the HANDLER needed replacing, not the control.
                    onExport={exportAll}
                    isExporting={isExporting || isExportingAll}
                    exportFileName={exportFileName}
                    // Hidden on "Payment By Me": the card summarises ALL payments, not the viewer's own.
                    summaryCard={projectId || customerId || tab === PP_TABS.PAYMENT_BY_ME || !canViewPaymentSummary(role, user_id) ? null : <PaymentSummaryCards totalCount={totalCount} />}
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

            <AlertDialog
                open={!!deleteRow}
                onOpenChange={(open) => { if (!open && !deleting) setDeleteRow(null); }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {deleteIsPayment
                                ? `Delete this payment from its ${deleteParentLabel}`
                                : `Are you sure you want to delete this ${deleteRow ? (TYPE_LABEL[deleteRow.source_type] ?? deleteRow.source_type) : "expense"}?`}
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-2 text-sm">
                                <p>
                                    {deleteIsPayment
                                        ? `A ${deleteParentLabel} payment is deleted from the ${deleteParentLabel} page. Open ${deleteRow?.document_name} and delete it from its payments.`
                                        : "It will be permanently deleted. This can't be undone."}
                                </p>
                                {deleteRow && (
                                    <div className="rounded border bg-muted/40 p-2">
                                        <div className="font-medium text-foreground">
                                            {deleteRow.against_primary || deleteRow.name}
                                        </div>
                                        <div className="text-muted-foreground">
                                            {formatToRoundedIndianRupee(deleteRow.amount)} · {deleteRow.status}
                                            {deleteRow.vendor ? ` · ${vendorLabelMap.get(deleteRow.vendor) || deleteRow.vendor}` : ""}
                                        </div>
                                        {deleteRow.raised_by !== user_id && (
                                            <div className="text-muted-foreground">
                                                Created by {userLabelMap.get(deleteRow.raised_by) || deleteRow.raised_by}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        {deleteIsPayment ? (
                            <>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={openDeleteParent} disabled={!deleteRow?.document_name}>
                                    Go to {deleteRow?.document_name || deleteParentLabel}
                                </AlertDialogAction>
                            </>
                        ) : (
                            <>
                                <AlertDialogCancel disabled={deleting}>No</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={(e) => { e.preventDefault(); handleConfirmDelete(); }}
                                    disabled={deleting}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                    {deleting ? "Deleting…" : "Yes, delete"}
                                </AlertDialogAction>
                            </>
                        )}
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <QueueRowEditDialog
                row={editRow}
                onClose={closeEdit}
                onSaved={() => { refetch(); refreshTabCounts(); }}
            />

            <AlertDialog
                open={!!revertRow}
                onOpenChange={(open) => { if (!open && !reverting) setRevertRow(null); }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Revert this payment to Approved?</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-2 text-sm">
                                <p>
                                    It moves back to "Payment need to paid". From there it can be marked
                                    paid again, or deleted.
                                </p>
                                {revertRow && (
                                    <div className="rounded border bg-muted/40 p-2">
                                        <div className="font-medium text-foreground">
                                            {revertRow.name} · {revertRow.against_primary || revertRow.document_name}
                                        </div>
                                        <div className="text-muted-foreground">
                                            {formatToRoundedIndianRupee(revertRow.amount)}
                                            {revertRow.vendor ? ` · ${vendorLabelMap.get(revertRow.vendor) || revertRow.vendor}` : ""}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={reverting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => { e.preventDefault(); handleConfirmRevert(); }}
                            disabled={reverting}
                        >
                            {reverting ? "Reverting…" : "Revert to Approved"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default AllPayments;