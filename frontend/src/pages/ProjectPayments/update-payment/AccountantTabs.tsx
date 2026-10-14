import React, { useCallback, useContext, useMemo, useState } from "react";
import { Row } from "@tanstack/react-table";
import { FrappeConfig, FrappeContext, FrappeDoc, GetDocListArgs, useFrappeGetDocList, useFrappeDocTypeEventListener } from "frappe-react-sdk";
import { useCEOHoldProjects } from "@/hooks/useCEOHoldProjects";
import { CEO_HOLD_ROW_CLASSES } from "@/utils/ceoHoldRowStyles";

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";

// --- Types and Constants ---
import { Projects } from "@/types/NirmaanStack/Projects";


// --- Hooks & Utils ---
import { useFrappeUpdateDoc, useFrappeDeleteDoc, useFrappePostCall } from 'frappe-react-sdk';
import { useUpdatePaymentRequest } from "../hooks/useUpdatePaymentRequests";
import { getFrappeError } from "@/utils/frappeErrors";
import { GstPaymentTag } from "../components/GstPaymentTag";
import { SETTLED_STATUSES } from '@/utils/settlement';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import {
    APPROVAL_QUEUE_API,
    APPROVAL_FETCH_FIELDS,
    APPROVAL_DATE_COLUMNS,
    APPROVAL_STATUS,
    APPROVAL_SEARCHABLE_FIELDS,
    ApprovalQueueRow,
    ApprovalTab,
    TAB_COLUMNS,
    TAB_DEFAULT_SORT,
    TYPE_LABEL,
} from "../config/approvalsTable.config";
import { buildApprovalColumns, ApprovalColumnCtx } from "../config/approvalColumns";
import { useApprovalQueueExport, ApprovalExportButton } from "../hooks/useApprovalQueueExport";
import { useApprovalFacets } from "../config/useApprovalFacets";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { FacetOverrides } from '@/components/data-table/facetConfig';
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { DOC_TYPES } from "../approve-payments/constants";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getProjectPaymentsStaticFilters } from "../config/projectPaymentsTable.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { useOrderPayments } from "@/hooks/useOrderPayments";
import { useOrderTotals } from "@/hooks/useOrderTotals";

import PaymentSummaryCards from "../PaymentSummaryCards"
import { useUserData } from "@/hooks/useUserData"
import { canViewPaymentSummary } from "@/constants/roles"
import { invalidateSidebarCounts } from "@/hooks/useSidebarCounts"
import { useRefreshApprovalCounts } from "../hooks/useRefreshApprovalCounts"
import { countLabel, selectionTotal, summarizeSelection } from "../bulkSelectionSummary"
import { SelectionTotalPill } from "../components/SelectionTotalPill"
import { IndianRupee } from "lucide-react"
import { QueueRowEditDialog } from "../components/QueueRowEditDialog"
import { canEditQueueRow, canHoldQueueRow, canWorkQueueRows, isHeldQueueRow } from "../config/queueRowActions"
import { PAYMENT_HOLD_ROW_CLASSES, PaymentHoldNotice } from "../components/PaymentHoldNotice"
import { useHasLoadedOnce } from "@/hooks/useHasLoadedOnce";
import { buildBankFile, describeLeftOut, type BankFileRow } from "../bankUploadFile";
import { PAID_TO_API, type PaidTo, type PaidToKey } from "@/components/payees/expensePayeeApi";

// --- Constants ---
const DOCTYPE = DOC_TYPES.PROJECT_PAYMENTS;

interface AccountantTabsProps {
    tab?: string; // "New Payments" or "Fulfilled Payments"
}

interface SelectOption { label: string; value: string; }

/**
 * AccountantTabs component for handling payments for a project.
 * For now, only supports "New Payments" tab.
 * tab prop is optional, defaulting to "New Payments".
 */
const ICICI_DEBIT_ACCOUNT = "093705003327";

export const AccountantTabs: React.FC<AccountantTabsProps> = ({ tab = "New Payments" }) => {
    const { toast } = useToast();
    const { db } = useContext(FrappeContext) as FrappeConfig;
    const { role, user_id } = useUserData();

    // --- CEO Hold Highlighting ---
    const { ceoHoldProjectIds } = useCEOHoldProjects();

    const { getAmount: getTotalAmountPaidForPO } = useOrderPayments()
    const { getTotalAmount, getDeliveredAmount } = useOrderTotals()

    // "Mark as Paid" — a plain confirmation, NOT the payment-details dialog.
    // ONE dialog for both entry points: the row button confirms `[row]`, the bulk
    // toolbar button confirms the ticked rows. The rows are SNAPSHOT at click time, so a
    // realtime refetch while the dialog is open cannot change what gets written.
    const [confirmPaidRows, setConfirmPaidRows] = useState<ApprovalQueueRow[] | null>(null);
    // How many rows have been written so far; null when idle.
    const [markingProgress, setMarkingProgress] = useState<number | null>(null);
    const markingPaid = markingProgress !== null;
    // The payment-details dialog no longer lives on this tab. "Mark as Paid" is a
    // plain confirmation; the UTR / date / proof are captured on the Reconciliation
    // Pending tab, which is what actually settles the row.
    const { updateDoc } = useFrappeUpdateDoc();
    const refreshTabCounts = useRefreshApprovalCounts();

    // Trash beside "Mark as Paid" (owner, 18 Sep — reverses the 15 Sep removal). Everyone who
    // can open this tab gets it: Admin, Accountant, Accountant Lead. Each ledger deletes through
    // the call it already used: a vendor payment through `update_payment_request` (what this tab
    // and the PO / SR pages call), an expense through the `deleteDoc` the expense pages use.
    const [deleteRow, setDeleteRow] = useState<ApprovalQueueRow | null>(null);
    const { trigger: deletePayment, isMutating: deletingPayment } = useUpdatePaymentRequest();
    const { deleteDoc, loading: deletingExpense } = useFrappeDeleteDoc();
    const deleting = deletingPayment || deletingExpense;

    // The expense Edit pencil beside Mark as Paid (owner, 2026-09-21) -- `queueRowActions`.
    const canWork = canWorkQueueRows(role);
    const [editRow, setEditRow] = useState<ApprovalQueueRow | null>(null);
    const closeEdit = useCallback(() => setEditRow(null), []);

    // Hold / release a PO / WO payment (owner, 2026-09-22) -- same three roles as `canWork`.
    // The row whose confirmation is open; whether it holds or releases is read off the row.
    const [holdRow, setHoldRow] = useState<ApprovalQueueRow | null>(null);
    const { call: setPaymentHold, loading: savingHold } = useFrappePostCall(
        "nirmaan_stack.api.payments.payment_hold.set_payment_hold"
    );


    // --- State for Export Dialog ---
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const [debitAccountNumber, setDebitAccountNumber] = useState(ICICI_DEBIT_ACCOUNT); // Default
    const [paymentMode, setPaymentMode] = useState("IMPS");
    // Which bulk-transfer file to emit. "icici" is the original ICICI PAB_VENDOR layout;
    // "cashfree" is Cashfree's payout template. `bankUploadFile.ts` builds both.
    const [exportTarget, setExportTarget] = useState<"icici" | "cashfree">("icici");

    // --- Supporting Data Fetches ---
    const projectsFetchOptions = getProjectListOptions();

    // --- Generate Query Keys ---
    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        DOC_TYPES.PROJECTS, projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, projectQueryKey
    );


    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useFrappeGetDocList<Vendors>(
        "Vendors",
        {
            fields: ["name", "vendor_name"],
            limit: 10000
        },
        "Vendors_For_Accountant"
    );

    // Re-enabled: without this the "Raised by" column falls back to the raw owner
    // email, because the column registry resolves names through `ctx.userLabels`.
    const { data: userList } = useUsersList();


    // --- Zustand Store & Memoized Lookups ---
    const { notifications, mark_seen_notification } = useNotificationStore();
    const projectOptions = useMemo<SelectOption[]>(() => projects?.map(p => ({ label: p.project_name, value: p.name })) || [], [projects]);
    const vendorOptions = useMemo<SelectOption[]>(() => vendors?.map(v => ({ label: v.vendor_name, value: v.name })) || [], [vendors]);


    // The bank file pays each row into its Payee, read when the file is built.
    const { call: fetchPaidTo } = useFrappePostCall<{ message: PaidTo[] }>(PAID_TO_API);

    // --- Notification Handling ---
    const handleNewPaymentSeen = useCallback((notification: NotificationType | undefined) => {
        if (notification && notification.seen === "false") {
            mark_seen_notification(db, notification);
        }
    }, [db, mark_seen_notification]);


    // --- Table Configuration for `useServerDataTable` ---
    const urlSyncKey = useMemo(() => `acct_pay_${tab.toLowerCase().replace(/\s+/g, '_')}`, [tab]);

    // const staticFilters = useMemo(() => {
    //     if (tab === "New Payments") return [["status", "=", PAYMENT_STATUS.APPROVED]];
    //     if (tab === "Fulfilled Payments") return [["status", "=", PAYMENT_STATUS.PAID]];
    //     return []; // Default if tab is unrecognized
    // }, [tab]);

    const staticFilters = useMemo(() => getProjectPaymentsStaticFilters(tab), [tab]);


    const dateColumns = useMemo(() => APPROVAL_DATE_COLUMNS, []);

    // --- Column Definitions --- (registry + per-tab id array; see config/approvalsTable.config.ts)
    const projectLabelMap = useMemo(() => {
        const m = new Map<string, string>();
        for (const o of projectOptions) m.set(o.value, o.label);
        return m;
    }, [projectOptions]);

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

    const columnCtx = useMemo<ApprovalColumnCtx>(() => ({
        tab: tab as ApprovalTab,
        projectLabels: projectLabelMap,
        vendorLabels: vendorLabelMap,
        userLabels: userLabelMap,
        // Adapters: these three helpers have this screen's own shapes.
        getDocumentTotal: (docName, docType) => getTotalAmount(docName, docType).totalWithTax,
        getPoAmountDelivered: (docName, docType) => parseNumber(getDeliveredAmount(docName, docType)),
        // ⚠️ A SETTLED-SPEND SITE (audit D1), done here because the call had to be
        // written anyway. It read `['Paid']`; settled spend is now Paid AND
        // Reconciliation Pending. Provably a no-op TODAY — zero rows carry the new
        // status — so the audit's DIFF = 0 proof is unaffected; without it this
        // figure would silently under-report the moment the fulfil path switches over.
        getAmountPaid: (docName) => getTotalAmountPaidForPO(docName, [...SETTLED_STATUSES]),
        onRecordPayment: (row) => setConfirmPaidRows([row]),
        onDelete: setDeleteRow,
        onEdit: canWork ? setEditRow : undefined,
        canEdit: (row) => canEditQueueRow(row, role),
        onToggleHold: canWork ? setHoldRow : undefined,
        canHold: (row) => canHoldQueueRow(row, role),
        isUnseen: (row) => !!notifications.find(
            (n) => n.docname === row.name && n.seen === "false"
        ),
        onSeen: (row) => handleNewPaymentSeen(
            notifications.find((n) => n.docname === row.name && n.seen === "false")
        ),
    }), [
        tab, projectLabelMap, vendorLabelMap, userLabelMap, getTotalAmount, getDeliveredAmount,
        getTotalAmountPaidForPO, notifications, handleNewPaymentSeen, canWork, role,
    ]);

    const columns = useMemo(
        () => buildApprovalColumns(TAB_COLUMNS[tab as ApprovalTab], columnCtx),
        [tab, columnCtx]
    );


    // ⚠️ SELECTABLE ≠ EXPORTABLE. Every row on this tab can be ticked — rows with no Payee
    // included — because the ticks also drive bulk Mark as Paid. The bank-transfer CSV
    // leaves the unpayable ones back out (see exportSelectedToCSV).
    //
    // A HELD payment cannot be ticked: the ticks drive bulk Mark as Paid AND the bank payout
    // file, and a held payment must reach neither. `PaymentHoldNotice` says why.
    const canPaymentRowBeSelected = useCallback(
        (row: Row<ApprovalQueueRow>): boolean => tab === "New Payments" && !isHeldQueueRow(row.original),
        [tab]
    );

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
            // A payment hold first: on this tab it is the one that blocks Mark as Paid.
            if (isHeldQueueRow(row.original)) {
                return PAYMENT_HOLD_ROW_CLASSES;
            }
            const projectId = row.original.project;
            if (projectId && ceoHoldProjectIds.has(projectId)) {
                return CEO_HOLD_ROW_CLASSES;
            }
            return undefined;
        },
        [ceoHoldProjectIds]
    );

    // --- useServerDataTable Hook Instantiation (moved up for columnFilters access) ---
    const {
        table, data, totalCount, isLoading: listIsLoading, error: listError,
        selectedSearchField, setSelectedSearchField,
        searchTerm, setSearchTerm,
        columnFilters,
        isRowSelectionActive,
        refetch,
        exportAllRows,
        isExporting,
    } = useServerDataTable<ApprovalQueueRow>({
        // Nominal: the endpoint unions all three money-out ledgers.
        doctype: DOCTYPE,
        apiEndpoint: APPROVAL_QUEUE_API,
        columns: columns,
        searchableFields: APPROVAL_SEARCHABLE_FIELDS,
        fetchFields: APPROVAL_FETCH_FIELDS,
        urlSyncKey: urlSyncKey,
        defaultSort: TAB_DEFAULT_SORT[tab as ApprovalTab],
        enableRowSelection: canPaymentRowBeSelected,
        additionalFilters: staticFilters,
    });

    // Type / Vendor / Project / Raised by facets, counted over the same union the table reads,
    // under the table's live column filters and search -- hence AFTER the table hook.
    const approvalFacets = useApprovalFacets({
        filters: staticFilters as Array<[string, string, unknown]>,
        columnFilters,
        searchTerm,
        selectedSearchField,
        projectLabels: projectLabelMap,
        vendorLabels: vendorLabelMap,
        userLabels: userLabelMap,
    });

    // ⚠️ TWO EXPORTS ON THIS TAB, AND THEY ARE NOT VARIANTS OF EACH OTHER.
    // The built-in "Export for Payment" button emits the BANK PAYOUT FILE (ICICI PAB_VENDOR or the
    // Cashfree template) from the ticked rows — a file you upload to a bank, whose
    // columns are the bank's, not the table's. It is selection-driven by design.
    // This second button emits the TABLE as a CSV: every column, every filtered row,
    // no selection needed. Labelled plain "Export" (owner, 2026-10-07) while the bank file
    // is "Export for Payment", so the two are never confused —
    // uploading the wrong one of these to a bank is not a recoverable mistake.
    const { exportAll, isExportingAll } = useApprovalQueueExport({
        exportAllRows,
        columnCtx,
        fileName: `Payments_To_Be_Paid_${formatDate(new Date())}`,
    });

    /**
     * Approved → Reconciliation Pending.
     *
     * ⚠️ Writes to the ROW'S OWN doctype, never a hard-coded one: this queue holds
     * Project Payments, Project Expenses and Non Project Expenses, and `row.doctype`
     * is the only thing that says which. The status string is identical on all three.
     *
     * This is the MONEY-OUT event — the moment the system says the cash has left.
     * The UTR, date and proof are captured afterwards on the Reconciliation Pending
     * tab, which is what moves it to Paid.
     *
     * ⚠️ SEQUENTIAL ON PURPOSE, one write per row through the same `updateDoc` the row
     * button always used, so each row runs its own doctype hooks exactly as before.
     * Two payments on the SAME PO both recompute that PO in their hooks; firing them in
     * parallel races those parent writes. Each row commits on its own, so one failure
     * never rolls back the others — it is reported, and the rest still move.
     */
    const handleMarkPaid = useCallback(async () => {
        if (!confirmPaidRows?.length) return;
        const rows = confirmPaidRows;
        const failed: { row: ApprovalQueueRow; reason: string }[] = [];
        setMarkingProgress(0);
        for (let i = 0; i < rows.length; i++) {
            try {
                await updateDoc(rows[i].doctype, rows[i].name, {
                    status: APPROVAL_STATUS.RECONCILIATION_PENDING,
                });
            } catch (e: any) {
                failed.push({ row: rows[i], reason: e?.message || "Please try again." });
            }
            setMarkingProgress(i + 1);
        }
        setMarkingProgress(null);

        const movedCount = rows.length - failed.length;
        if (failed.length === 0) {
            toast({
                title: "Marked as Paid",
                description: rows.length === 1
                    ? `${rows[0].against_primary} moved to Reconciliation Pending.`
                    : `${countLabel(summarizeSelection(rows))} moved to Reconciliation Pending.`,
                variant: "success",
            });
        } else {
            const failedList = failed
                .slice(0, 3)
                .map((f) => `${f.row.against_primary}: ${f.reason}`)
                .join(" · ");
            toast({
                title: movedCount > 0
                    ? `${movedCount} marked as Paid, ${failed.length} failed`
                    : "Could not mark as Paid",
                description: failed.length > 3 ? `${failedList} · +${failed.length - 3} more` : failedList,
                variant: "destructive",
            });
        }

        // Nothing written → keep the dialog open so the accountant can retry, as the row
        // button always did.
        if (movedCount === 0) return;
        setConfirmPaidRows(null);
        // ⚠️ RESET, EVEN AFTER A SINGLE ROW. Selection is keyed by row INDEX (the table
        // has no getRowId), so once moved rows drop out of the list every tick shifts
        // onto a different payment — and the bulk button and the bank-file export both
        // act on those ticks.
        table.resetRowSelection();
        invalidateSidebarCounts();
        refreshTabCounts();
        await refetch();
    }, [confirmPaidRows, updateDoc, toast, refetch, table, refreshTabCounts]);

    const handleConfirmDelete = useCallback(async () => {
        if (!deleteRow) return;
        try {
            if (deleteRow.doctype === "Project Payments") {
                await deletePayment({ action: "delete", name: deleteRow.name });
            } else {
                await deleteDoc(deleteRow.doctype, deleteRow.name);
            }
            toast({
                title: "Deleted",
                description: `${deleteRow.against_primary || deleteRow.name} was deleted.`,
                variant: "success",
            });
            setDeleteRow(null);
            // Same reason as after Mark as Paid: ticks are keyed by row index.
            table.resetRowSelection();
            invalidateSidebarCounts();
            refreshTabCounts();
            await refetch();
        } catch (error) {
            toast({ title: "Couldn't delete", description: getFrappeError(error), variant: "destructive" });
        }
    }, [deleteRow, deletePayment, deleteDoc, toast, table, refreshTabCounts, refetch]);

    const handleConfirmHold = useCallback(async () => {
        if (!holdRow) return;
        const hold = !isHeldQueueRow(holdRow);
        const label = holdRow.against_primary || holdRow.name;
        try {
            await setPaymentHold({ name: holdRow.name, hold });
            toast({
                title: hold ? "Payment on hold" : "Hold released",
                description: hold
                    ? `${label} can't be marked as paid until the hold is released.`
                    : `${label} can be marked as paid again.`,
                variant: "success",
            });
            setHoldRow(null);
            // A newly held row loses its checkbox, so a tick on it must not survive.
            table.resetRowSelection();
            await refetch();
        } catch (error) {
            toast({
                title: hold ? "Couldn't hold the payment" : "Couldn't release the hold",
                description: getFrappeError(error),
                variant: "destructive",
            });
        }
    }, [holdRow, setPaymentHold, toast, table, refetch]);

    const heldRowsOnPage = useMemo(
        () => (tab === "New Payments" ? (data ?? []).filter(isHeldQueueRow).length : 0),
        [tab, data]
    );

    const selectedRows = table.getSelectedRowModel().rows;
    const confirmPaidTotal = useMemo(
        () => selectionTotal(confirmPaidRows ?? []),
        [confirmPaidRows]
    );

    // --- CSV Export Logic using papaparse ---
    const handlePrepareExport = () => {
        // This function is called when the custom "Export" button (outside DataTable) is clicked
        // It will open the dialog for selecting account number and payment mode.
        // Actual CSV generation happens in `exportSelectedToCSV`.
        if (!table.getSelectedRowModel().rows.length && tab === "New Payments") {
            toast({ title: "Export", description: "Please select payments to export.", variant: "default" });
            return;
        }
        setIsExportDialogOpen(true);
    };

    const exportSelectedToCSV = async () => {
        const selectedRows = table.getSelectedRowModel().rows;
        if (selectedRows.length === 0 && tab === "New Payments") {
            toast({ title: "No Data", description: "No payments selected for export.", variant: "default" });
            setIsExportDialogOpen(false);
            return;
        }

        // Use all rows if not "New Payments" tab or if no rows are selected but still want to export all visible
        const rowsToExport = (tab === "New Payments" && selectedRows.length > 0)
            ? selectedRows
            : table.getCoreRowModel().rows; // Or table.getFilteredRowModel().rows for visible after table filters

        if (rowsToExport.length === 0) {
            toast({ title: "No Data", description: "No data available to export.", variant: "default" });
            setIsExportDialogOpen(false);
            return;
        }

        // Each row is paid into its Payee as it is NOW: a vendor payment into its vendor's (ADR-0033:
        // the payment stores none), an expense into its own. So the accounts are read at export, not
        // from the list loaded earlier. The server's Payee module resolves both.
        const payments = rowsToExport.map(({ original }) => original);
        let paidTo: PaidTo[];
        try {
            paidTo = (await fetchPaidTo({
                rows: payments.map((p): PaidToKey => ({ doctype: p.doctype, name: p.name })),
            })).message;
        } catch (error) {
            toast({ title: "Export failed", description: getFrappeError(error), variant: "destructive" });
            return;
        }

        // ⚠️ THE BANK FILE IS NOT THE SELECTION. `buildBankFile` leaves out every ticked row
        // that has no Payee to pay into, and the toast names them: the accountant must
        // know the file is shorter than their selection.
        const bankFile = buildBankFile(
            payments.map((payment, i): BankFileRow => {
                const isVendorPayment = payment.doctype === "Project Payments";
                return {
                    kind: isVendorPayment ? "vendor_payment" : "expense",
                    // An expense has no PO / SR: its own ID is the remark.
                    documentName: isVendorPayment ? payment.document_name : payment.name,
                    amount: payment.amount,
                    projectLabel: projectLabelMap.get(payment.project) ?? (payment.project || "Non Project"),
                    payee: paidTo[i]?.account ?? undefined,
                };
            }),
            { format: exportTarget, paymentMode, debitAccountNumber, now: new Date() },
        );
        const skippedParts = describeLeftOut(bankFile.leftOut);

        if (bankFile.rows.length === 0) {
            toast({
                title: "Nothing to export",
                description: `No selected row has a payee to pay into: ${skippedParts.join("; ")}. Pay these by hand, or give them a payee first.`,
                variant: "destructive",
            });
            setIsExportDialogOpen(false);
            return;
        }

        const blob = new Blob([bankFile.csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', bankFile.fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast({
            title: "Export Successful",
            description: skippedParts.length > 0
                ? `${bankFile.rows.length} payments exported. Left out, to pay by hand: ${skippedParts.join("; ")}.`
                : `${bankFile.rows.length} payments exported.`,
            variant: bankFile.leftOut.length > 0 ? "default" : "success",
        });
        setIsExportDialogOpen(false); // Close dialog
        table.resetRowSelection(); // Clear selection
    };


    const isLoadingOverall = projectsLoading || vendorsLoading;
    const hasLoadedOnce = useHasLoadedOnce(isLoadingOverall);
    const combinedErrorOverall = projectsError || vendorsError || listError;

    if (combinedErrorOverall && !data?.length) { // Show prominent error if main list fails
        <AlertDestructive error={combinedErrorOverall} />
    }

    return (
        <div className="flex-1 space-y-4">
            {!hasLoadedOnce && isLoadingOverall && !data?.length ? ( // Show skeleton on initial full load
                <TableSkeleton />
            ) : (
                <DataTable<ApprovalQueueRow>
                    table={table}
                    columns={columns}
                    isLoading={listIsLoading} // Pass specific loading state for table
                    error={listError}
                    totalCount={totalCount}
                    searchFieldOptions={APPROVAL_SEARCHABLE_FIELDS}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    // The hold notice rides the summary slot, so it sits directly above the table.
                    summaryCard={
                        canViewPaymentSummary(role, user_id) || heldRowsOnPage > 0 ? (
                            <div className="space-y-2">
                                {canViewPaymentSummary(role, user_id) && <PaymentSummaryCards totalCount={totalCount} />}
                                <PaymentHoldNotice heldRowsOnPage={heldRowsOnPage} />
                            </div>
                        ) : null
                    }
                    // globalFilterValue={globalFilter}
                    // onGlobalFilterChange={setGlobalFilter}
                    // searchPlaceholder={`Search ${tab}...`}
                    // showItemSearchToggle={showItemSearchToggle} // Will be false
                    // itemSearchConfig={{
                    //     isEnabled: isItemSearchEnabled,
                    //     toggle: toggleItemSearch,
                    //     label: "Item Search"
                    // }}
                    facetDoctype={DOCTYPE}
                    facetOverrides={{
                        project: { additionalFilters: staticFilters },
                        vendor: { additionalFilters: staticFilters },
                    } satisfies FacetOverrides}
                    dateFilterColumns={dateColumns}
                    facetFilterOptions={approvalFacets.facetOptions}
                    onFacetOpen={approvalFacets.onFacetOpen}
                    // `exportIgnoresSelection` used to sit here. `DataTable` declares
                    // no such prop and never read it — it was a silent no-op stating an
                    // intent the code did not implement. Removed rather than honoured:
                    // this button's selection-scoping is correct (it builds a payout
                    // file), and the export that genuinely ignores selection is the
                    // plain "Export" button in `toolbarActions` below.
                    showExportButton={true}
                    onExport={tab === "New Payments" ? handlePrepareExport : 'default'}
                    exportButtonLabel={tab === "New Payments" ? "Export for Payment" : "Export"}
                    onExportAll={exportAllRows}
                    isExporting={isExporting}
                    exportFileName={`${tab.replace(/\s+/g, '_')}_${formatDate(new Date())}`}
                    showRowSelection={isRowSelectionActive}
                    getRowClassName={getRowClassName}
                    toolbarActions={
                        <>
                            {/* Bulk "Mark as Paid": the ticked rows → Reconciliation Pending.
                                Same checkboxes as the bank-file export — but the export
                                clears them when it finishes, so tick again before this. */}
                            {tab === "New Payments" && selectedRows.length > 0 && (
                                <>
                                    <SelectionTotalPill rows={selectedRows.map((r) => r.original)} />
                                    <Button
                                        size="sm"
                                        className="h-8 gap-1 bg-green-600 hover:bg-green-700 text-white"
                                        disabled={markingPaid}
                                        onClick={() => setConfirmPaidRows(selectedRows.map((r) => r.original))}
                                    >
                                        <IndianRupee className="h-4 w-4" />
                                        Mark as Paid ({selectedRows.length})
                                    </Button>
                                </>
                            )}
                            <ApprovalExportButton
                                onClick={exportAll}
                                isExporting={isExportingAll}
                                label="Export"
                            />
                        </>
                    }
                />
            )}

            <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="text-center">Export Payments to CSV</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <h2 className="font-semibold text-primary text-sm">Debit Account Details</h2>
                        <RadioGroup
                            value={exportTarget}
                            onValueChange={(v) => {
                                const target = v as "icici" | "cashfree";
                                setExportTarget(target);
                                // Picking ICICI re-seeds the debit account, matching what the
                                // radio did before it also selected the file format.
                                if (target === "icici") setDebitAccountNumber(ICICI_DEBIT_ACCOUNT);
                            }}
                            className="space-y-2"
                        >
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="icici" id="icici_0937" />
                                <Label htmlFor="icici_0937">ICICI - XXXX3327</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="cashfree" id="cashfree" />
                                <Label htmlFor="cashfree">Cashfree</Label>
                            </div>
                            {/* Add more accounts if needed */}
                        </RadioGroup>
                        {/* Cashfree's template has no debit-account column -- the source account
                            is fixed on the Cashfree side -- so this input only applies to ICICI. */}
                        {exportTarget === "icici" && (
                            <div className="grid grid-cols-3 items-center gap-4">
                                <Label htmlFor="debitAccNo" className="col-span-1">Custom Acc No:</Label>
                                <Input id="debitAccNo" value={debitAccountNumber} onChange={(e) => setDebitAccountNumber(e.target.value)} className="col-span-2 h-8" />
                            </div>
                        )}
                        <div className="grid grid-cols-3 items-center gap-4">
                            <Label htmlFor="paymentMode" className="col-span-1">Payment Mode:</Label>
                            <Select value={paymentMode} onValueChange={setPaymentMode}>
                                <SelectTrigger className="col-span-2 h-8"> <SelectValue placeholder="Select mode" /> </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="IMPS">IMPS</SelectItem>
                                    <SelectItem value="NEFT">NEFT</SelectItem>
                                    {/* <SelectItem value="RTGS">RTGS</SelectItem> */}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="mt-2 flex items-center justify-end space-x-2">
                        <DialogClose asChild><Button variant={"outline"} onClick={() => setIsExportDialogOpen(false)}>Cancel</Button></DialogClose>
                        <Button onClick={exportSelectedToCSV} disabled={table.getSelectedRowModel().rows.length === 0}>Confirm & Export</Button>
                    </div>
                </DialogContent>
            </Dialog>

            <AlertDialog
                open={!!confirmPaidRows}
                onOpenChange={(open) => { if (!open && !markingPaid) setConfirmPaidRows(null); }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {confirmPaidRows && confirmPaidRows.length > 1
                                ? `Mark ${countLabel(summarizeSelection(confirmPaidRows))} as Paid?`
                                : "Mark this payment as Paid?"}
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-2 text-sm">
                                <p>
                                    This records that the money has gone out.{" "}
                                    {confirmPaidRows && confirmPaidRows.length > 1 ? "They move" : "It moves"} to{" "}
                                    <span className="font-medium text-foreground">Reconciliation Pending</span>,
                                    where you add the UTR and proof to finish {confirmPaidRows && confirmPaidRows.length > 1 ? "them" : "it"}.
                                </p>
                                {confirmPaidRows && confirmPaidRows.length > 1 && (
                                    <div className="flex items-center justify-between rounded border bg-muted/40 px-2 py-1.5">
                                        <span className="text-muted-foreground">Total</span>
                                        <span className="font-semibold tabular-nums text-foreground">
                                            {formatToRoundedIndianRupee(confirmPaidTotal)}
                                        </span>
                                    </div>
                                )}
                                {/* Every row is listed, not just counted: this is the last look
                                    before money is recorded as gone for all of them. */}
                                <div className="max-h-60 space-y-1.5 overflow-y-auto">
                                    {confirmPaidRows?.map((row) => (
                                        <div key={`${row.doctype}:${row.name}`} className="rounded border bg-muted/40 p-2">
                                            <div className="font-medium text-foreground">
                                                {row.against_primary}
                                            </div>
                                            <div className="text-muted-foreground">
                                                {formatToRoundedIndianRupee(row.amount)}
                                                <GstPaymentTag payment={row} />
                                                {row.vendor
                                                    ? ` · ${vendorLabelMap.get(row.vendor) || row.vendor}`
                                                    : ""}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={markingPaid}>No</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => { e.preventDefault(); handleMarkPaid(); }}
                            disabled={markingPaid}
                            className="bg-green-600 hover:bg-green-700"
                        >
                            {markingPaid
                                ? (confirmPaidRows && confirmPaidRows.length > 1
                                    ? `Marking ${markingProgress}/${confirmPaidRows.length}…`
                                    : "Marking…")
                                : "Yes, mark as Paid"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
                open={!!holdRow}
                onOpenChange={(open) => { if (!open && !savingHold) setHoldRow(null); }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {holdRow && isHeldQueueRow(holdRow) ? "Release this hold?" : "Put this payment on hold?"}
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-2 text-sm">
                                <p>
                                    {holdRow && isHeldQueueRow(holdRow)
                                        ? "It can be marked as paid again, and ticked for the bank file."
                                        : "It stays approved, but it can't be marked as paid or ticked for the bank file until an Admin, Accountant or Accountant Lead releases it."}
                                </p>
                                {holdRow && (
                                    <div className="rounded border bg-muted/40 p-2">
                                        <div className="font-medium text-foreground">
                                            {holdRow.against_primary || holdRow.name}
                                        </div>
                                        <div className="text-muted-foreground">
                                            {formatToRoundedIndianRupee(holdRow.amount)}
                                            <GstPaymentTag payment={holdRow} />
                                            {holdRow.vendor
                                                ? ` · ${vendorLabelMap.get(holdRow.vendor) || holdRow.vendor}`
                                                : ""}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={savingHold}>No</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => { e.preventDefault(); handleConfirmHold(); }}
                            disabled={savingHold}
                            className={holdRow && isHeldQueueRow(holdRow)
                                ? "bg-green-600 hover:bg-green-700"
                                : "bg-orange-600 hover:bg-orange-700"}
                        >
                            {savingHold
                                ? "Saving…"
                                : holdRow && isHeldQueueRow(holdRow) ? "Yes, release" : "Yes, hold"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <QueueRowEditDialog
                row={editRow}
                onClose={closeEdit}
                onSaved={() => { refetch(); refreshTabCounts(); }}
            />

            <AlertDialog
                open={!!deleteRow}
                onOpenChange={(open) => { if (!open && !deleting) setDeleteRow(null); }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {`Are you sure you want to delete this ${deleteRow ? (TYPE_LABEL[deleteRow.source_type] ?? deleteRow.source_type) : "payment"}?`}
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-2 text-sm">
                                <p>It will be permanently deleted. This can't be undone.</p>
                                {/* The server does this, not the page: the expense doctypes'
                                    `after_delete` deletes the request (expense_request_status.py). */}
                                {deleteRow && deleteRow.doctype !== "Project Payments" && (
                                    <p>If it came from an Expense Request, that request is deleted too.</p>
                                )}
                                {deleteRow && (
                                    <div className="rounded border bg-muted/40 p-2">
                                        <div className="font-medium text-foreground">
                                            {deleteRow.against_primary || deleteRow.name}
                                        </div>
                                        <div className="text-muted-foreground">
                                            {formatToRoundedIndianRupee(deleteRow.amount)}
                                            <GstPaymentTag payment={deleteRow} />
                                            {deleteRow.vendor
                                                ? ` · ${vendorLabelMap.get(deleteRow.vendor) || deleteRow.vendor}`
                                                : ""}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>No</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => { e.preventDefault(); handleConfirmDelete(); }}
                            disabled={deleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {deleting ? "Deleting…" : "Yes, delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

        </div>
    );
};

export default AccountantTabs;