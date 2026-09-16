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
import { useFrappeUpdateDoc } from 'frappe-react-sdk';
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
} from "../config/approvalsTable.config";
import { buildApprovalColumns, ApprovalColumnCtx } from "../config/approvalColumns";
import { useApprovalQueueExport, ApprovalExportButton } from "../hooks/useApprovalQueueExport";
import { useApprovalFacets } from "../config/useApprovalFacets";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { FacetOverrides } from '@/components/data-table/facetConfig';
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { memoize } from "lodash";
import { DOC_TYPES } from "../approve-payments/constants";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDateToDDMMYYYY, formatDate } from "@/utils/FormatDate";
import { unparse } from 'papaparse'; // For CSV export
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
import { countLabel, summarizeSelection } from "../bulkSelectionSummary"
import { IndianRupee } from "lucide-react"

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
// Cashfree's contact columns are the payout-notification address, and Nirmaan wants those
// notifications coming back to its own accounts desk rather than out to each vendor. Fixed
// on every row by design -- the payee is identified by bankAccount + ifsc, not by these.
const CASHFREE_CONTACT_EMAIL = "accounts@nirmaan.app";
const CASHFREE_CONTACT_PHONE = "8904007419";

const ICICI_DEBIT_ACCOUNT = "093705003327";

// A vendor with no bank account / IFSC cannot be paid out at all, so its row is made inert
// rather than merely unselectable: dimmed, and pointer-events stripped so nothing inside it
// responds to a click. canPaymentRowBeSelected already kills the checkbox; this is the
// visual half, so it is obvious WHY the checkbox is dead instead of looking like a bug.
// NOTE: pointer-events-none covers the whole row, so the Pay button, the delete button and
// the PO/SR link on that row are unclickable too. That is the intent -- the row is not
// actionable until someone fills in the vendor's bank details.
const NO_BANK_DETAILS_ROW_CLASSES =
    "opacity-50 bg-muted/40 pointer-events-none select-none";

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


    // --- State for Export Dialog ---
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const [debitAccountNumber, setDebitAccountNumber] = useState(ICICI_DEBIT_ACCOUNT); // Default
    const [paymentMode, setPaymentMode] = useState("IMPS");
    // Which bulk-transfer file to emit. "icici" is the original ICICI PAB_VENDOR layout;
    // "cashfree" is Cashfree's payout template -- a completely different column set, not a
    // variation on the same one, which is why the two builders below stay separate.
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
            fields: ["name", "vendor_name", "account_number", "account_name", "ifsc"],
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


    const getVendorDetails = useCallback(memoize((vendorId: string | undefined): Vendors | undefined => {
        return vendors?.find(vendor => vendor.name === vendorId);
    }), [vendors]);


    // const getRowSelectionDisabled = useCallback((vendorId: string | undefined): boolean => {
    //     const vendor = getVendorDetails(vendorId);
    //     return !vendor?.account_number; // Disable if no account number
    // }, [getVendorDetails]);

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
        // Delete is deliberately NOT offered here (owner, 15 Sep). The registry renders
        // the trash icon only when `onDelete` is supplied, so withholding it is the
        // whole change — the dialog and its "delete" mode stay intact for any caller
        // that wants them back.
        isUnseen: (row) => !!notifications.find(
            (n) => n.docname === row.name && n.seen === "false"
        ),
        onSeen: (row) => handleNewPaymentSeen(
            notifications.find((n) => n.docname === row.name && n.seen === "false")
        ),
    }), [
        tab, projectLabelMap, vendorLabelMap, userLabelMap, getTotalAmount, getDeliveredAmount,
        getTotalAmountPaidForPO, notifications, handleNewPaymentSeen,
    ]);

    const columns = useMemo(
        () => buildApprovalColumns(TAB_COLUMNS[tab as ApprovalTab], columnCtx),
        [tab, columnCtx]
    );

    // Source / Vendor / Project facets, counted over the same union the table reads.
    const approvalFacets = useApprovalFacets({
        filters: staticFilters as Array<[string, string, unknown]>,
        projectLabels: projectLabelMap,
        vendorLabels: vendorLabelMap,
    });

    // Function to determine if a row can be selected (passed to hook)
    //
    // This is the gate that keeps an unpayable vendor out of the export file: the checkbox
    // renders disabled off row.getCanSelect(), so the row cannot be selected and therefore
    // cannot reach either CSV builder.
    //
    // BOTH halves of the bank details are required, not just the account number. An account
    // number on its own still exports a blank `ifsc` -- Cashfree and ICICI both reject a
    // payout row without it, and the failure only surfaces after upload. The beneficiary
    // name needs no check: it falls back to vendor_name, which is mandatory on the doctype.
    const hasBankDetails = useCallback((vendorId?: string): boolean => {
        const vendor = vendors?.find(v => v.name === vendorId);
        const account = String(vendor?.account_number ?? '').trim();
        const ifsc = String(vendor?.ifsc ?? '').trim();
        return !!account && !!ifsc;
    }, [vendors]);

    const canPaymentRowBeSelected = useCallback((row: Row<ApprovalQueueRow>): boolean => {
        if (tab !== "New Payments") return false;
        // ⚠️ SELECTABLE ≠ EXPORTABLE. All three ledgers can be ticked, so "select all"
        // means all the rows on the page — but the bank-transfer CSV is a VENDOR payout
        // file, and an expense has no vendor and no bank row to write. The export filters
        // them back out (see exportSelectedToCSV); this gate must not, or the checkbox
        // silently refuses rows the accountant is looking straight at.
        //
        // Note this is NOT the bank-details rule: an expense is fully actionable here via
        // its own Mark-as-Paid button, so it must never pick up NO_BANK_DETAILS_ROW_CLASSES
        // (those carry pointer-events-none and would kill that button).
        if (row.original.source !== "Vendor Payment") return true;
        return hasBankDetails(row.original.vendor);
    }, [hasBankDetails, tab]);

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
            // CEO hold stays first: it is a safety signal and must not be dimmed away. Such a
            // row is already unpayable, and its checkbox is disabled by the bank-details rule
            // anyway, so nothing is lost by letting the red win.
            const projectId = row.original.project;
            if (projectId && ceoHoldProjectIds.has(projectId)) {
                return CEO_HOLD_ROW_CLASSES;
            }
            // ⚠️ SCOPED TO VENDOR PAYMENTS. These classes carry `pointer-events-none`,
            // so applying them to an expense row would grey it out AND make its own
            // Mark-as-Paid button unclickable — a row the accountant is supposed to
            // act on, rendered dead, for a reason ("no bank details") that does not
            // apply to a ledger with no vendor field at all.
            if (
                tab === "New Payments"
                && row.original.source === "Vendor Payment"
                && !hasBankDetails(row.original.vendor)
            ) {
                return NO_BANK_DETAILS_ROW_CLASSES;
            }
            return undefined;
        },
        [ceoHoldProjectIds, hasBankDetails, tab]
    );

    // --- useServerDataTable Hook Instantiation (moved up for columnFilters access) ---
    const {
        table, data, totalCount, isLoading: listIsLoading, error: listError,
        selectedSearchField, setSelectedSearchField,
        searchTerm, setSearchTerm,
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

    // ⚠️ TWO EXPORTS ON THIS TAB, AND THEY ARE NOT VARIANTS OF EACH OTHER.
    // The built-in Export button emits the BANK PAYOUT FILE (ICICI PAB_VENDOR or the
    // Cashfree template) from the ticked rows — a file you upload to a bank, whose
    // columns are the bank's, not the table's. It is selection-driven by design.
    // This second button emits the TABLE as a CSV: every column, every filtered row,
    // no selection needed. Labelled "Export table" so the two are never confused —
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
        await refetch();
    }, [confirmPaidRows, updateDoc, toast, refetch, table]);

    const selectedRows = table.getSelectedRowModel().rows;
    const confirmPaidTotal = useMemo(
        () => (confirmPaidRows ?? []).reduce((sum, r) => sum + parseNumber(r.amount), 0),
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

    const exportSelectedToCSV = () => {
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

        // ⚠️ THE BANK FILE IS A VENDOR PAYOUT FILE — the selection is not.
        // Expense rows (Project Expenses / Non Project Expenses) are selectable so that
        // "select all" behaves, but they carry no vendor and would export a blank
        // beneficiary account + IFSC. ICICI and Cashfree both accept such a file at upload
        // and only reject the individual rows afterwards, so the filter has to happen HERE,
        // not at the bank. Skipped rows are reported in the toast rather than dropped
        // silently — the accountant must know the file is shorter than their selection.
        const payableRows = rowsToExport.filter(row => row.original.source === "Vendor Payment");
        const skippedCount = rowsToExport.length - payableRows.length;

        if (payableRows.length === 0) {
            toast({
                title: "Nothing to export",
                description: "Expenses have no vendor bank details, so they cannot go in a bank transfer file. Select at least one vendor payment.",
                variant: "destructive",
            });
            setIsExportDialogOpen(false);
            return;
        }

        const buildIciciRows = () => payableRows.map(row => {
            const payment = row.original;
            const vendorDetails = getVendorDetails(payment.vendor); // Use the memoized helper
            return {
                'PYMT_PROD_TYPE_CODE': 'PAB_VENDOR', // Constant
                'PYMT_MODE': paymentMode,
                'DEBIT_ACC_NO': debitAccountNumber,
                'BNF_NAME': vendorDetails?.account_name || '',
                'BENE_ACC_NO': vendorDetails?.account_number || '',
                'BENE_IFSC': vendorDetails?.ifsc || '',
                'AMOUNT': parseNumber(payment.amount),
                'DEBIT_NARR': '', // Optional
                'CREDIT_NARR': '', // Optional
                'MOBILE_NUM': '', // Optional
                'EMAIL_ID': '', // Optional
                'REMARK': payment.document_name, // PO/SR number as remark
                'PYMT_DATE': formatDateToDDMMYYYY(new Date()), // Today's date for payment file
                'REF_NO': '',
                'ADDL_INFO1': '', 'ADDL_INFO2': '', 'ADDL_INFO3': '', 'ADDL_INFO4': '', 'ADDL_INFO5': '',
                'LEI_NUMBER': ''
            };
        });

        // One stamp per export, shared by every row in the file. Cashfree keys a payout on
        // transferId and rejects one it has already processed, so ids must never repeat
        // across files -- the old position-based ids ("transferId12", "transferId22", ...)
        // were identical in every export and would have failed on the second upload.
        //
        // Date.now() rather than Math.random(): guaranteed unique per export, where a random
        // number is only probably unique. Kept to its last 10 digits to hold the id short --
        // that block only repeats every 10^10 ms (~115 days) and would need two exports
        // landing on the same millisecond 115 days apart to collide.
        const batchStamp = String(Date.now()).slice(-10);

        const buildCashfreeRows = () => payableRows.map((row, idx) => {
            const payment = row.original;
            const vendorDetails = getVendorDetails(payment.vendor);
            const projectLabel = projectOptions.find(o => o.value === payment.project)?.label ?? payment.project;

            // The beneficiary name must be the ACCOUNT HOLDER's name, which is why this reads
            // account_name and not vendor_name -- the two legitimately differ (proprietor vs
            // trading name). But some vendor records have the account NUMBER typed into
            // account_name (SAFETYWALA EQUIPMENTS LLP is one), which put a bare number in this
            // column. A name contains at least one letter; if it does not, it is not a name,
            // so fall back to vendor_name rather than send Cashfree a number to match on.
            const accountName = (vendorDetails?.account_name || '').trim();
            const beneficiaryName = /[A-Za-z]/.test(accountName)
                ? accountName
                : (vendorDetails?.vendor_name || '');

            return {
                'transferId': `${batchStamp}${String(idx + 1).padStart(2, '0')}`,
                'bankAccount': vendorDetails?.account_number || '',
                'ifsc': vendorDetails?.ifsc || '',
                'name': beneficiaryName,
                'email': CASHFREE_CONTACT_EMAIL,
                'phone': CASHFREE_CONTACT_PHONE,
                'amount': parseNumber(payment.amount),
                'remarks': `${projectLabel} - ${payment.document_name}`,
                'transferMode': paymentMode.toLowerCase(),
            };
        });

        // Widened to a common row type: the two layouts share no columns, and papaparse's
        // unparse() will not accept a union of two different object shapes.
        // `undefined` is in the value type because formatDateToDDMMYYYY is typed to return
        // `string | undefined`; papaparse writes an empty cell for it either way.
        const csvData: Record<string, string | number | undefined>[] =
            exportTarget === "cashfree" ? buildCashfreeRows() : buildIciciRows();

        const csv = unparse(csvData);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', exportTarget === "cashfree"
            ? `Cashfree_Payments_${formatDate(new Date())}.csv`
            : `New_Payments_${formatDate(new Date())}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast({
            title: "Export Successful",
            description: skippedCount > 0
                ? `${csvData.length} payments exported. ${skippedCount} expense${skippedCount > 1 ? "s" : ""} skipped — no vendor bank details to pay into.`
                : `${csvData.length} payments exported.`,
            variant: "success",
        });
        setIsExportDialogOpen(false); // Close dialog
        table.resetRowSelection(); // Clear selection
    };


    const isLoadingOverall = projectsLoading || vendorsLoading;
    const combinedErrorOverall = projectsError || vendorsError || listError;

    if (combinedErrorOverall && !data?.length) { // Show prominent error if main list fails
        <AlertDestructive error={combinedErrorOverall} />
    }

    return (
        <div className="flex-1 space-y-4">
            {isLoadingOverall && !data?.length ? ( // Show skeleton on initial full load
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
                    summaryCard={
                        canViewPaymentSummary(role, user_id) ? <PaymentSummaryCards totalCount={totalCount} /> : null
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
                    facetFilterOptions={approvalFacets}
                    // `exportIgnoresSelection` used to sit here. `DataTable` declares
                    // no such prop and never read it — it was a silent no-op stating an
                    // intent the code did not implement. Removed rather than honoured:
                    // this button's selection-scoping is correct (it builds a payout
                    // file), and the export that genuinely ignores selection is the
                    // "Export table" button in `toolbarActions` below.
                    showExportButton={true}
                    onExport={tab === "New Payments" ? handlePrepareExport : 'default'}
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
                                <Button
                                    size="sm"
                                    className="h-8 gap-1 bg-green-600 hover:bg-green-700 text-white"
                                    disabled={markingPaid}
                                    onClick={() => setConfirmPaidRows(selectedRows.map((r) => r.original))}
                                >
                                    <IndianRupee className="h-4 w-4" />
                                    Mark as Paid ({selectedRows.length})
                                </Button>
                            )}
                            <ApprovalExportButton
                                onClick={exportAll}
                                isExporting={isExportingAll}
                                label="Export table"
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

        </div>
    );
};

export default AccountantTabs;