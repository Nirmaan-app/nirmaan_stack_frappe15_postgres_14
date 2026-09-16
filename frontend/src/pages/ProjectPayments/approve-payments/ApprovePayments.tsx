import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  FrappeConfig,
  FrappeContext,
  useFrappeGetDocList,
  useFrappeUpdateDoc,
  useFrappePostCall,
  FrappeDoc,
  GetDocListArgs,
  useFrappeDocTypeEventListener,
} from "frappe-react-sdk";

// --- UI Components ---
import { DataTable } from "@/components/data-table/new-data-table";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";

// --- Dialog Component ---
import { PaymentActionDialog } from "./components/PaymentActionDialog";
import { BulkActionBar } from "./components/BulkActionBar";

// --- Types and Constants ---
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses";
import {
  BULK_MAX_SELECTION,
  DOC_TYPES,
  PAYMENT_STATUS,
  DIALOG_ACTION_TYPES,
  DialogActionType,
} from "./constants";
import PaymentSummaryCards from "../PaymentSummaryCards";
import { useUserData } from "@/hooks/useUserData";
import { canViewPaymentSummary } from "@/constants/roles";

// --- Hooks & Utils ---
import { Row } from "@tanstack/react-table";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { PP_TABS } from "../config/ppTabs.constants";
import {
  APPROVAL_QUEUE_API,
  APPROVAL_FETCH_FIELDS,
  APPROVAL_DATE_COLUMNS,
  APPROVAL_SEARCHABLE_FIELDS,
  ApprovalQueueRow,
  TAB_COLUMNS,
  TAB_DEFAULT_SORT,
} from "../config/approvalsTable.config";
import { buildApprovalColumns, ApprovalColumnCtx } from "../config/approvalColumns";
import { statusAfterL1, TIER_L2_ABOVE_EXPENSES } from "@/utils/approvalTiers";
import { useApprovalQueueExport, ApprovalExportButton } from "../hooks/useApprovalQueueExport";
import { useApprovalFacets } from "../config/useApprovalFacets";
import { useVendorTdsRates, VendorTdsRateContext } from "../hooks/useVendorTdsRates";
// import { getPOTotal, getSRTotal, getTotalAmountPaid } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";
import {
  NotificationType,
  useNotificationStore,
} from "@/zustand/useNotificationStore";
import { formatDate } from "@/utils/FormatDate";
import { memoize } from "lodash";
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { useVendorsList } from "@/pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import {
} from "../config/projectPaymentsTable.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import { useCEOHoldProjects } from "@/hooks/useCEOHoldProjects";
import { CEO_HOLD_ROW_CLASSES } from "@/utils/ceoHoldRowStyles";

import { invalidateSidebarCounts } from "@/hooks/useSidebarCounts";

// --- Constants ---
const DOCTYPE = DOC_TYPES.PROJECT_PAYMENTS;
const URL_SYNC_KEY_LEAD = "approve_pay";
const URL_SYNC_KEY_CEO = "ceo_pending_pay";

interface SelectOption {
  label: string;
  value: string;
}

// --- Component ---
type ApprovePaymentsMode = "lead" | "ceo";

interface ApprovePaymentsProps {
  readOnly?: boolean;
  /**
   * "lead" (default): Project Lead approving "Requested" payments → "CEO Pending".
   *                   Approve uses generic doctype PATCH; Reject sets status = "Rejected".
   * "ceo":            CEO promoting "CEO Pending" payments → "Approved".
   *                   Approve uses ceo_approve_payment whitelisted API (stamps
   *                   ceo_approval_date). Reject sets status = "Rejected" via PATCH.
   */
  mode?: ApprovePaymentsMode;
}

export const ApprovePayments: React.FC<ApprovePaymentsProps> = ({ readOnly = false, mode = "lead" }) => {
  const isCEOMode = mode === "ceo";
  const { toast } = useToast();
  const { db } = useContext(FrappeContext) as FrappeConfig;
  const { role, user_id } = useUserData();
  // const { mutate } = useSWRConfig();
  // --- State for Dialogs ---
  const [selectedPayment, setSelectedPayment] =
    useState<ProjectPayments | null>(null);
  const [dialogActionType, setDialogActionType] = useState<DialogActionType>(
    DIALOG_ACTION_TYPES.APPROVE
  );
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);

  // --- CEO Hold Guard ---
  const { isCEOHold, showBlockedToast } = useCEOHoldGuard(selectedPayment?.project);

  // --- CEO Hold Highlighting ---
  const { ceoHoldProjectIds } = useCEOHoldProjects();

  // --- Supporting Data Fetches (Keep these for lookups/calculations) ---
  // CEO Pending tab also surfaces Project Value; request that field only in
  // CEO mode so the regular Approve Payments tab keeps its minimal projects
  // fetch (and its existing shared SWR cache).
  const projectsFetchOptions = useMemo(
    () =>
      getProjectListOptions(
        isCEOMode
          ? { fields: ["name", "project_name", "creation", "project_value_gst"] }
          : undefined
      ),
    [isCEOMode]
  );

  // --- Generate Query Keys ---
  const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

  const {
    data: projects,
    isLoading: projectsLoading,
    error: projectsError,
  } = useFrappeGetDocList<Projects>(
    DOC_TYPES.PROJECTS,
    projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>,
    projectQueryKey
  );
  const {
    data: vendors,
    isLoading: vendorsLoading,
    error: vendorsError,
  } = useVendorsList({
    vendorTypes: ["Service", "Material", "Material & Service"],
  });

  const {
    data: userList,
    isLoading: userListLoading,
    error: userError,
  } = useUsersList();

  const {
    data: purchaseOrders,
    isLoading: poLoading,
    error: poError,
  } = useFrappeGetDocList<ProcurementOrder>(
    DOC_TYPES.PROCUREMENT_ORDERS,
    {
      fields: [
        "name",
        "project",
        "status",
        "total_amount",
        "loading_charges",
        "freight_charges",
        "po_amount_delivered",
        "amount_paid",
      ],
      limit: 100000,
    },
    "POs_ApprovePay"
  );
  const {
    data: serviceOrders,
    isLoading: srLoading,
    error: srError,
  } = useFrappeGetDocList<ServiceRequests>(
    DOC_TYPES.SERVICE_REQUESTS,
    {
      fields: ["name", "status", "gst", "total_amount"],
      filters: [["status", "in", ["Approved", "Amendment"]]],
      limit: 10000,
    },
    "SRs_ApprovePay"
  );
  // For "Amt Paid" - fetch all paid payments for relevant documents.
  // `project` is also needed in CEO mode to compute per-project outflow for
  // the Cashflow Gap column.
  const {
    data: allPaidPayments,
    isLoading: paidPaymentsLoading,
    error: paidPaymentsError,
  } = useFrappeGetDocList<ProjectPayments>(
    DOC_TYPES.PROJECT_PAYMENTS,
    {
      fields: ["name", "document_name", "amount", "project"],
      filters: [["status", "=", PAYMENT_STATUS.PAID]],
      limit: 100000,
    },
    "AllPaidPayments_ApprovePay"
  );

  // --- CEO-Only Fetches for Cashflow Gap ---
  // Match the formula on the master Projects list (projects.tsx):
  //   cashflow_gap = (paid payments + expenses) + liabilities − inflow
  // Liabilities are derived from `purchaseOrders` (po_amount_delivered vs
  // amount_paid). Expenses and inflows are project-wide rollups, so we fetch
  // them here gated to CEO mode only — the regular Approve Payments tab
  // makes zero extra requests.
  const { data: projectExpenses } = useFrappeGetDocList<ProjectExpenses>(
    "Project Expenses",
    // Only Paid expenses count toward the cashflow gap (mirrors projects.tsx +
    // the backend _compute_cashflow_gap); Requested/Approved-but-unpaid don't.
    { fields: ["projects", "amount"], filters: [["status", "=", "Paid"]], limit: 100000 },
    isCEOMode ? "ProjectExpenses_CEOPending" : null
  );
  const { data: projectInflows } = useFrappeGetDocList<ProjectInflows>(
    "Project Inflows",
    { fields: ["project", "amount"], limit: 100000 },
    isCEOMode ? "ProjectInflows_CEOPending" : null
  );

  // --- Zustand Store & Memoized Lookups ---
  const { notifications, mark_seen_notification } = useNotificationStore();

  const projectOptions = useMemo<SelectOption[]>(
    () =>
      projects?.map((p) => ({ label: p.project_name, value: p.name })) || [],
    [projects]
  );
  const vendorOptions = useMemo<SelectOption[]>(
    () => vendors?.map((v) => ({ label: v.vendor_name, value: v.name })) || [],
    [vendors]
  );

  const projectLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of projectOptions) m.set(o.value, o.label);
    return m;
  }, [projectOptions]);

  const vendorLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of vendorOptions) m.set(o.value, o.label);
    return m;
  }, [vendorOptions]);

  const projectLabelFor = useCallback(
    (projectId?: string) =>
      (projectId && projectLabelMap.get(projectId)) || projectId || "—",
    [projectLabelMap]
  );

  const vendorLabelFor = useCallback(
    (vendorId?: string) =>
      (vendorId && vendorLabelMap.get(vendorId)) || vendorId || "—",
    [vendorLabelMap]
  );

  const getAmountPaid = useMemo(() => {
    if (!allPaidPayments) return () => 0;
    const paymentsMap = new Map<string, number>();
    allPaidPayments.forEach((p) => {
      if (p.document_name) {
        paymentsMap.set(
          p.document_name,
          (paymentsMap.get(p.document_name) || 0) + parseNumber(p.amount)
        );
      }
    });
    return memoize(
      (documentName: string) => paymentsMap.get(documentName) || 0
    );
  }, [allPaidPayments]);

  const getDocumentTotal = useMemo(
    () =>
      memoize((docName: string, docType: string) => {
        if (docType === DOC_TYPES.PROCUREMENT_ORDERS) {
          const order = purchaseOrders?.find((po) => po.name === docName);
          return order?.total_amount || 0;
        } else if (docType === DOC_TYPES.SERVICE_REQUESTS) {
          const order = serviceOrders?.find((sr) => sr.name === docName);
          // `total_amount` is fresh on every save (validate) and already
          // includes GST when sr.gst === "true". No need to recompute.
          return parseNumber(order?.total_amount);
        }
        return 0;
      }),
    [purchaseOrders, serviceOrders]
  );

  const getPoAmountDelivered = useMemo(
    () =>
      memoize((docName: string, docType: string) => {
        if (docType !== DOC_TYPES.PROCUREMENT_ORDERS) return 0;
        const order = purchaseOrders?.find((po) => po.name === docName);
        return parseNumber(order?.po_amount_delivered);
      }, (docName: string, docType: string) => `${docName}-${docType}`),
    [purchaseOrders]
  );

  // --- CEO Pending: Project Value + Cashflow Gap lookups ---
  const getProjectValue = useMemo(() => {
    const map = new Map<string, number>();
    projects?.forEach((p) =>
      map.set(p.name, parseNumber((p as Projects).project_value_gst))
    );
    return (projectId?: string) =>
      (projectId && map.get(projectId)) || 0;
  }, [projects]);

  const getProjectCashflowGap = useMemo(() => {
    if (!isCEOMode) return () => 0;
    const outflow = new Map<string, number>();
    const liabilities = new Map<string, number>();
    const inflow = new Map<string, number>();

    allPaidPayments?.forEach((p) => {
      if (!p.project) return;
      outflow.set(p.project, (outflow.get(p.project) || 0) + parseNumber(p.amount));
    });
    projectExpenses?.forEach((e) => {
      const proj = (e as any).projects;
      if (!proj) return;
      outflow.set(proj, (outflow.get(proj) || 0) + parseNumber(e.amount));
    });
    purchaseOrders?.forEach((po) => {
      const proj = (po as any).project;
      if (!proj) return;
      const delivered = parseNumber(po.po_amount_delivered);
      const paid = parseNumber((po as any).amount_paid);
      const liability = Math.max(0, delivered - Math.min(paid, delivered));
      if (liability) liabilities.set(proj, (liabilities.get(proj) || 0) + liability);
    });
    projectInflows?.forEach((i) => {
      if (!i.project) return;
      inflow.set(i.project, (inflow.get(i.project) || 0) + parseNumber(i.amount));
    });

    return (projectId?: string) => {
      if (!projectId) return 0;
      return (
        (outflow.get(projectId) || 0) +
        (liabilities.get(projectId) || 0) -
        (inflow.get(projectId) || 0)
      );
    };
  }, [isCEOMode, allPaidPayments, projectExpenses, purchaseOrders, projectInflows]);

  // --- Callbacks ---
  const handleNewPaymentSeen = useCallback(
    (notification: NotificationType | undefined) => {
      if (notification && notification.seen === "false") {
        mark_seen_notification(db, notification);
      }
    },
    [db, mark_seen_notification]
  );

  const openDialog = useCallback(
    (payment: ProjectPayments, type: DialogActionType) => {
      setSelectedPayment(payment);
      setDialogActionType(type);
      setIsDialogOpen(true);
    },
    []
  );

  const closeDialog = useCallback(() => setIsDialogOpen(false), []);

  // --- Static Filters for This View ---
  const staticFilters = useMemo(
    () => [
      ["status", "=", isCEOMode ? PAYMENT_STATUS.CEO_PENDING : PAYMENT_STATUS.REQUESTED],
      // No source filter: this tab now shows ALL THREE money-out ledgers. Vendor
      // payments, project expenses and non-project expenses land in one queue,
      // sorted by age rather than by ledger.
    ],
    [isCEOMode]
  );

  // --- Date Filter Columns ---
  const dateColumns = useMemo(() => APPROVAL_DATE_COLUMNS, []);

  // --- Column Definitions ---
  // --- Column Definitions ---
  //
  // The 369-line inline block that used to live here — one `useMemo` threaded with
  // `...(tab === "X" ? [...] : [])` spreads — is now a REGISTRY + a per-tab id
  // array (config/approvalColumns.tsx + config/approvalsTable.config.ts).
  //
  // The array IS the order, which is what puts `actions` in position 2 so the
  // approver's hand never travels to the right edge. One definition per column id
  // means a change to `against` cannot drift between tabs, and a new tab is one
  // entry in TAB_COLUMNS rather than another 300-line block.
  const activeTab = isCEOMode ? PP_TABS.CEO_PENDING : PP_TABS.APPROVE_PAYMENTS;

  const userLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of userList ?? []) m.set(u.name, u.full_name || u.name);
    return m;
  }, [userList]);

  const columnCtx = useMemo<ApprovalColumnCtx>(
    () => ({
      tab: activeTab,
      projectLabels: projectLabelMap,
      vendorLabels: vendorLabelMap,
      userLabels: userLabelMap,
      getDocumentTotal,
      getAmountPaid,
      getPoAmountDelivered,
      getProjectValue,
      getProjectCashflowGap,
      isUnseen: (row) =>
        !!notifications.find(
          (n) => n.docname === row.name && n.seen === "false" && n.event_id === "payment:requested"
        ),
      onSeen: (row) =>
        handleNewPaymentSeen(
          notifications.find(
            (n) => n.docname === row.name && n.seen === "false" && n.event_id === "payment:requested"
          )
        ),
      onApprove: readOnly
        ? undefined
        : (row) => openDialog(row as unknown as ProjectPayments, DIALOG_ACTION_TYPES.APPROVE),
      onReject: readOnly
        ? undefined
        : (row) => openDialog(row as unknown as ProjectPayments, DIALOG_ACTION_TYPES.REJECT),
    }),
    [
      activeTab,
      projectLabelMap,
      vendorLabelMap,
      userLabelMap,
      getDocumentTotal,
      getAmountPaid,
      getPoAmountDelivered,
      getProjectValue,
      getProjectCashflowGap,
      notifications,
      handleNewPaymentSeen,
      openDialog,
      readOnly,
    ]
  );

  const columns = useMemo(
    () => buildApprovalColumns(TAB_COLUMNS[activeTab], columnCtx),
    [activeTab, columnCtx]
  );

  const exportFileName = `${isCEOMode ? "CEO_Pending_Payments" : "Approve_Payments"}_${formatDate(new Date())}`;

  // Counted over the same union, under this tab's own filters.
  const approvalFacets = useApprovalFacets({
    filters: staticFilters as Array<[string, string, unknown]>,
    projectLabels: projectLabelMap,
    vendorLabels: vendorLabelMap,
  });

  // Live selected-row count, read by `enableRowSelection` below at CLICK time. Declared
  // ahead of the hook because the config closure captures it; see the cap block under
  // the hook for what it is for.
  const selectedRowCountRef = useRef(0);

  // --- useServerDataTable Hook Instantiation (moved up for columnFilters access) ---
  const {
    table,
    data,
    totalCount,
    isLoading: listIsLoading,
    error: listError,
    selectedSearchField,
    setSelectedSearchField,
    searchTerm,
    setSearchTerm,
    // isRowSelectionActive,
    refetch,
    exportAllRows,
    // `isExporting` is NOT taken: the built-in export button is off on this screen,
    // and the replacement tracks its own flag (`isExportingAll`). tsconfig sets
    // `noUnusedLocals`, so an unused destructure here is a compile error, not lint.
  } = useServerDataTable<ApprovalQueueRow>({
    // `doctype` is nominal here: the endpoint below unions three of them. It is
    // still sent because the hook derives its cache key from it.
    doctype: DOCTYPE,
    apiEndpoint: APPROVAL_QUEUE_API,
    columns: columns,
    fetchFields: APPROVAL_FETCH_FIELDS,
    searchableFields: APPROVAL_SEARCHABLE_FIELDS,
    urlSyncKey: isCEOMode ? URL_SYNC_KEY_CEO : URL_SYNC_KEY_LEAD,
    // Work queues open OLDEST-first. Sorting happens over the UNION, so age order
    // is correct across ledgers rather than within each one.
    defaultSort: TAB_DEFAULT_SORT[activeTab],
    // Two clauses, two different jobs. The CEO-Hold clause is the pre-existing one.
    // The cap clause reads a REF (never state — a state read here would be a render
    // ago, and this runs on click) so an unselected row's checkbox goes disabled once
    // BULK_MAX_SELECTION are ticked; an already-ticked row stays selectable so it can
    // always be UN-ticked. This clause alone does NOT cover "select all on this page" —
    // TanStack evaluates it against one stale count for the whole loop — which is what
    // the effect below is for.
    enableRowSelection: !readOnly
      ? (row) =>
          !ceoHoldProjectIds.has(row.original.project) &&
          (selectedRowCountRef.current < BULK_MAX_SELECTION || row.getIsSelected())
      : false,
    // ONE PAGE = ONE FULL BULK BATCH. The header checkbox is "select all on THIS page",
    // so a page that holds exactly BULK_MAX_SELECTION rows makes select-all land on the
    // cap naturally instead of overshooting into the trim below. Only the DEFAULT — the
    // `_pageSize` URL param still wins, so the Rows-per-page selector works as before.
    initialState: {
      pagination: { pageIndex: 0, pageSize: BULK_MAX_SELECTION },
    },
    additionalFilters: staticFilters,
  });

  // ── Bulk selection cap ────────────────────────────────────────────────────────
  // The bulk endpoints throw the WHOLE batch back above BULK_MAX_SELECTION, before any
  // write — so an over-sized selection approves NOTHING. It is reachable because the
  // page-size selector goes to 10,000: at 500 rows per page the entire CEO-Pending
  // queue is ONE page, and the header checkbox is "select all on this page".
  //
  // `getSelectedRowModel()` only ever holds rows from the current page's data, which is
  // exactly the set BulkActionBar submits — so this counts what would actually be sent.
  const selectedRowCount = table.getSelectedRowModel().rows.length;
  selectedRowCountRef.current = selectedRowCount;

  useEffect(() => {
    if (selectedRowCount <= BULK_MAX_SELECTION) return;
    // Keeps the first N in row-model order and drops the rest. Depends on the COUNT (a
    // number), never on the selection object or on `table` — per the repo's effect rules.
    const kept = table
      .getSelectedRowModel()
      .rows.slice(0, BULK_MAX_SELECTION)
      .map((r) => [r.id, true] as const);
    table.setRowSelection(Object.fromEntries(kept));
    toast({
      title: `Kept the first ${BULK_MAX_SELECTION}`,
      description: `Only ${BULK_MAX_SELECTION} rows can be approved or rejected at once. Action these, then select the rest.`,
      variant: "default",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRowCount]);

  // Full-table CSV, all columns, whole filtered queue. Rendered through
  // `toolbarActions` rather than the built-in export button — see the note on the
  // `showExportButton={false}` prop below for why that swap was necessary here.
  const { exportAll, isExportingAll } = useApprovalQueueExport({
    exportAllRows,
    columnCtx,
    fileName: exportFileName,
  });


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

  // --- Update Logic ---
  const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
  const { call: ceoApproveCall, loading: ceoApproveLoading } = useFrappePostCall(
    "nirmaan_stack.api.payments.project_payments.ceo_approve_payment"
  );
  const handlePaymentUpdate = useCallback(
    async (
      actionType: DialogActionType,
      amount: number,
      payment_details?: any
    ) => {
      if (!selectedPayment) return;
      if (isCEOHold) {
        showBlockedToast();
        return;
      }
      let successMessage: string | undefined;
      try {
        if (isCEOMode) {
          const ceoRow = selectedPayment as unknown as ApprovalQueueRow;
          const ceoDoctype = ceoRow.doctype || DOCTYPE;
          const ceoIsPayment = ceoDoctype === "Project Payments";

          if (actionType === DIALOG_ACTION_TYPES.REJECT) {
            // CEO rejection: no amount edits — flip status to Rejected.
            await updateDoc(ceoDoctype, selectedPayment.name, {
              status: PAYMENT_STATUS.REJECTED,
            });
          } else if (!ceoIsPayment) {
            // ⚠️ `ceo_approve_payment` is PAYMENTS-ONLY -- it loads a Project Payments
            // doc and runs the split machinery. An expense has no PO/SR parent and
            // cannot be split, so a CEO approval on one is a plain status write that
            // stamps the CEO date, mirroring what the endpoint does for a full approve.
            await updateDoc(ceoDoctype, selectedPayment.name, {
              status: PAYMENT_STATUS.APPROVED,
              ceo_approval_date: new Date().toISOString().split("T")[0],
            });
          } else {
            // CEO approval: call the whitelisted API so the backend can enforce
            // the single-user permission gate (Approved + ceo_approval_date stamp).
            //
            // `approved_amount` is sent ONLY for a genuine partial approval. Omitting it takes
            // the endpoint's original full-approve path, byte-identical to before this feature —
            // which is what keeps a plain approval free of any split machinery.
            const isPartial = amount > 0 && amount < parseNumber(selectedPayment.amount);
            const response = await ceoApproveCall({
              payment_id: selectedPayment.name,
              ...(isPartial ? { approved_amount: amount } : {}),
            });
            // The server composes the split message (it names the new payment), so echo it
            // rather than re-deriving a second wording that could drift from what happened.
            successMessage = response?.message?.message;
          }
        } else {
          // ⚠️ THIS QUEUE HOLDS THREE LEDGERS, SO NOTHING HERE MAY BE HARD-CODED.
          //
          // This wrote `DOCTYPE` ("Project Payments") with `status: CEO_PENDING` for
          // every row. Once expenses appeared in this tab that meant approving a
          // Project / Non-Project Expense tried to update a PAYMENT of the same name
          // and failed outright. Three things vary per row:
          //
          //   1. the DOCTYPE            -> `row.doctype`, the only field that says which
          //   2. the CEO line           -> 50,000 on all three ledgers since 16 Sep 2026
          //                                (expenses were briefly 30,000). Still resolved
          //                                per row: the seam is what makes a future split
          //                                a one-line change here
          //   3. `payment_details`      -> exists only on Project Payments; sending it to
          //                                an expense doctype is an unknown-field write
          const row = selectedPayment as unknown as ApprovalQueueRow;
          const targetDoctype = row.doctype || DOCTYPE;
          const isPaymentRow = targetDoctype === "Project Payments";

          // L1 either FINISHES the approval or forwards to the CEO, depending on the
          // amount and on that ledger's own CEO line. Writing CEO_PENDING flat would
          // send a Rs 20,000 row to the CEO that L1 was entitled to finish.
          const newStatus =
            actionType === DIALOG_ACTION_TYPES.APPROVE
              ? statusAfterL1(
                  amount,
                  isPaymentRow ? undefined : TIER_L2_ABOVE_EXPENSES
                )
              : PAYMENT_STATUS.REJECTED;

          await updateDoc(targetDoctype, selectedPayment.name, {
            status: newStatus,
            amount: amount,
            approval_date: new Date().toISOString().split("T")[0],
            ...(isPaymentRow && payment_details
              ? { payment_details: JSON.stringify(payment_details) }
              : {}),
          });
        }
        refetch();
        closeDialog();
        invalidateSidebarCounts();

        toast({
          title: "Success!",
          description:
            successMessage ??
            (isCEOMode && actionType !== DIALOG_ACTION_TYPES.REJECT
              ? "Payment forwarded for fulfilment."
              : `Payment ${actionType} successfully!`),
          variant: "success",
        });
      } catch (error: any) {
        console.error("Failed to update payment:", error);
        toast({
          title: "Update Failed!",
          description: error.message || "Could not update payment.",
          variant: "destructive",
        });
      }
    },
    [selectedPayment, updateDoc, ceoApproveCall, closeDialog, toast, isCEOHold, showBlockedToast, isCEOMode, refetch]
  );

  // Vendor rates for the rows on this page, so the approve dialogs can forecast the deduction.
  // Called AFTER the table hook because it feeds off `data`, and delivered by context because the
  // dialogs are rendered from this component's JSX rather than passed the rate row by row.
  const { rateFor: tdsRateFor } = useVendorTdsRates(data);

  // --- useServerDataTable Hook moved up above facets for columnFilters access ---

  // --- CEO Hold Row Highlighting ---
  const getRowClassName = useCallback(
    (row: Row<ApprovalQueueRow>) => {
      const projectId = row.original.project;
      if (projectId && ceoHoldProjectIds.has(projectId)) {
        return CEO_HOLD_ROW_CLASSES;
      }
      // Override the default bg-muted (gray) selection highlight with green.
      return "data-[state=selected]:bg-emerald-50 data-[state=selected]:hover:bg-emerald-100";
    },
    [ceoHoldProjectIds]
  );

  // --- Combined Loading & Error States ---
  const isPageLoading =
    projectsLoading ||
    vendorsLoading ||
    userListLoading ||
    poLoading ||
    srLoading ||
    paidPaymentsLoading;

  const combinedError =
    projectsError ||
    vendorsError ||
    userError ||
    poError ||
    srError ||
    listError ||
    paidPaymentsError;

  if (combinedError && !data) {
    // Show error prominently if main data fails to load
    <AlertDestructive error={combinedError} />;
  }

  return (
    // Both approve dialogs read the rate from here. Deliberately NOT surfaced in the table
    // columns (owner ruling 2026-09-10) — the figure matters when deciding, not when scanning.
    <VendorTdsRateContext.Provider value={tdsRateFor}>
    <div className="flex-1 space-y-4">
      {isPageLoading && !data?.length ? (
        <TableSkeleton />
      ) : (
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
          // globalFilterValue={globalFilter}
          // onGlobalFilterChange={setGlobalFilter}
          // searchPlaceholder="Search Payment Requests..."
          // showItemSearchToggle={showItemSearchToggle} // Will be false as enableItemSearch is false
          // itemSearchConfig={{
          //     isEnabled: isItemSearchEnabled,
          //     toggle: toggleItemSearch,
          //     label: "Item Search"
          // }}
          summaryCard={canViewPaymentSummary(role, user_id) ? <PaymentSummaryCards totalCount={totalCount} /> : null}
          facetFilterOptions={approvalFacets}
          dateFilterColumns={dateColumns}
          // ⚠️ THE BUILT-IN EXPORT BUTTON IS OFF ON THIS SCREEN, DELIBERATELY.
          // With `showRowSelection` on, the shared table's default handler exports the
          // SELECTED rows and disables the button entirely while nothing is ticked —
          // so the full filtered list could not be exported at all, and `onExportAll`
          // was dead code beside it. The checkboxes here are for BULK APPROVE, not for
          // choosing an export scope. The replacement below is always enabled and
          // always exports the whole filtered queue.
          showExportButton={false}
          getRowClassName={getRowClassName}
          showRowSelection={!readOnly}
          toolbarActions={
            <>
              {!readOnly && (
                <BulkActionBar
                  table={table}
                  mode={isCEOMode ? "ceo" : "lead"}
                  refetch={refetch}
                  projectLabelFor={projectLabelFor}
                  vendorLabelFor={vendorLabelFor}
                />
              )}
              {/* Outside the readOnly guard on purpose: a CEO-Pending VIEWER cannot
                  approve anything but must still be able to pull the list. */}
              <ApprovalExportButton onClick={exportAll} isExporting={isExportingAll} />
            </>
          }
        />
      )}

      {!readOnly && selectedPayment && (
        <PaymentActionDialog
          isOpen={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          type={dialogActionType}
          paymentData={selectedPayment}
          vendorName={
            vendors?.find((v) => v.name === selectedPayment.vendor)?.vendor_name
          }
          onSubmit={handlePaymentUpdate}
          isLoading={updateLoading || ceoApproveLoading}
          // Partial approval is the CEO gate ONLY (owner ruling). The lead tick stays a plain
          // full approve — two split points would let one payment fragment twice on its way up.
          allowPartial={isCEOMode}
          // Tax comes off at the transition INTO `Approved`, which is the CEO's click.
          withholdsTdsNow={isCEOMode}
        />
      )}
    </div>
    </VendorTdsRateContext.Provider>
  );
};

export default ApprovePayments;
