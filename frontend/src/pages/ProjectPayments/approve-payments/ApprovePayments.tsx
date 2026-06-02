import React, { useCallback, useContext, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import { ColumnDef, Row } from "@tanstack/react-table";
import {
  FrappeConfig,
  FrappeContext,
  useFrappeGetDocList,
  useFrappeUpdateDoc,
  useFrappePostCall,
  FrappeDoc,
  GetDocListArgs,
} from "frappe-react-sdk";
import { CircleCheck, CircleX, Info } from "lucide-react";

// --- UI Components ---
import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
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
  DOC_TYPES,
  PAYMENT_STATUS,
  DIALOG_ACTION_TYPES,
  DialogActionType,
} from "./constants";
import PaymentSummaryCards from "../PaymentSummaryCards";

// --- Hooks & Utils ---
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useFacetValues } from "@/hooks/useFacetValues";
import {
  formatToApproxLakhs,
  formatToLakhsNumber,
  formatToRoundedIndianRupee,
} from "@/utils/FormatPrice";
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
  DEFAULT_PP_FIELDS_TO_FETCH,
  PP_DATE_COLUMNS,
  PP_SEARCHABLE_FIELDS,
} from "../config/projectPaymentsTable.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import { useCEOHoldProjects } from "@/hooks/useCEOHoldProjects";
import { CEO_HOLD_ROW_CLASSES } from "@/utils/ceoHoldRowStyles";

import { useSWRConfig } from "swr";
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
      fields: ["name", "status", "service_order_list", "gst"],
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
    { fields: ["projects", "amount"], limit: 100000 },
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
          if (!order || !order.service_order_list?.list) return 0;

          const srTotal = order.service_order_list.list.reduce(
            (acc, item) =>
              acc + parseNumber(item.rate) * parseNumber(item.quantity),
            0
          );
          return order.gst === "true" ? srTotal * 1.18 : srTotal;
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
    ],
    [isCEOMode]
  );

  // --- Fields to Fetch for the Main DataTable ---
  const fieldsToFetchPP = useMemo(
    () => DEFAULT_PP_FIELDS_TO_FETCH.concat(["creation"]),
    []
  );

  const ppSearchableFields = useMemo(() => PP_SEARCHABLE_FIELDS, []);

  // --- Date Filter Columns ---
  const dateColumns = useMemo(() => PP_DATE_COLUMNS, []);

  // --- Column Definitions ---
  const columns = useMemo<ColumnDef<ProjectPayments>[]>(
    () => [
      {
        accessorKey: "document_name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="#PO / #SR" />
        ),
        cell: ({ row }) => {
          const payment = row.original;
          const newEventId = isCEOMode ? "payment:approved" : "payment:new";
          const isNew = notifications.find(
            (n) =>
              n.docname === payment.name &&
              n.seen === "false" &&
              n.event_id === newEventId
          );
          const docLink = payment.document_name?.replace(/\//g, "&=");
          return (
            <div
              role="button"
              tabIndex={0}
              onClick={() => handleNewPaymentSeen(isNew)}
              className="font-medium relative flex items-center gap-1.5 group"
            >
              {isNew && (
                <div
                  className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 animate-pulse"
                  title="New Payment Request"
                />
              )}
              <span
                className="max-w-[150px] truncate"
                title={payment.document_name}
              >
                {payment.document_name}
              </span>
              <HoverCard>
                <HoverCardTrigger asChild>
                  <Link to={docLink}>
                    <Info className="w-4 h-4 text-blue-600 cursor-pointer flex-shrink-0 opacity-70 group-hover:opacity-100" />
                  </Link>
                </HoverCardTrigger>
                <HoverCardContent className="text-xs w-auto p-1.5">
                  View linked{" "}
                  {payment.document_type === DOC_TYPES.PROCUREMENT_ORDERS
                    ? "PO"
                    : "SR"}
                </HoverCardContent>
              </HoverCard>
            </div>
          );
        },
        size: 200,
        meta: {
          exportHeaderName: "PO/SR ID",
          exportValue: (row: ProjectPayments) => row.document_name,
        },
      },
      {
        accessorKey: "creation",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Req. On" />
        ),
        cell: ({ row }) => (
          <div className="font-medium whitespace-nowrap">
            {formatDate(row.getValue("creation"))}
          </div>
        ),
        size: 100,
        meta: {
          exportHeaderName: "Requested On",
          exportValue: (row: ProjectPayments) => formatDate(row.creation),
        },
      },
      {
        accessorKey: "vendor",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Vendor" />
        ),
        cell: ({ row }) => {
          const vendor = vendorOptions.find(
            (v) => v.value === row.original.vendor
          );
          return (
            <div className="font-medium truncate" title={vendor?.label}>
              {vendor?.label || row.original.vendor}
            </div>
          );
        },
        enableColumnFilter: true,
        size: 200,
        meta: {
          exportHeaderName: "Vendor",
          exportValue: (row: ProjectPayments) =>
            vendorOptions.find((v) => v.value === row.vendor)?.label ||
            row.vendor,
        },
      },
      {
        accessorKey: "project",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Project" />
        ),
        cell: ({ row }) => {
          const project = projectOptions.find(
            (p) => p.value === row.original.project
          );
          return (
            <div className="font-medium truncate" title={project?.label}>
              {project?.label || row.original.project}
            </div>
          );
        },
        enableColumnFilter: true,
        size: 200,
        meta: {
          exportHeaderName: "Project",
          exportValue: (row: ProjectPayments) =>
            projectOptions.find((p) => p.value === row.project)?.label ||
            row.project,
        },
      },
      ...(isCEOMode
        ? ([
            {
              id: "project_value",
              header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Project Value (incl.GST)" />
              ),
              cell: ({ row }) => {
                const value = getProjectValue(row.original.project);
                return (
                  <div className="font-medium pr-2 tabular-nums">
                    {value ? formatToApproxLakhs(value) : "N/A"}
                  </div>
                );
              },
              size: 100,
              enableSorting: false,
              meta: {
                exportHeaderName: "Project Value (incl.GST)",
                exportValue: (row: ProjectPayments) =>
                  formatToLakhsNumber(getProjectValue(row.project)),
              },
            },
            {
              id: "cashflow_gap",
              header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Cashflow Gap" />
              ),
              cell: ({ row }) => {
                const gap = getProjectCashflowGap(row.original.project);
                return (
                  <div
                    className={`font-medium pr-2 tabular-nums ${
                      gap > 0 ? "text-red-600" : "text-green-600"
                    }`}
                  >
                    {formatToApproxLakhs(gap)}
                  </div>
                );
              },
              size: 100,
              enableSorting: false,
              meta: {
                exportHeaderName: "Cashflow Gap (in Lakhs)",
                exportValue: (row: ProjectPayments) =>
                  formatToLakhsNumber(getProjectCashflowGap(row.project)),
              },
            },
          ] as ColumnDef<ProjectPayments>[])
        : []),
      {
        id: "po_value",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="WO/PO Value" />
        ),
        cell: ({ row }) => {
          const totalValue = getDocumentTotal(
            row.original.document_name,
            row.original.document_type
          );
          return (
            <div className="font-medium pr-2">
              {formatToRoundedIndianRupee(totalValue)}
            </div>
          );
        },
        size: 100,
        enableSorting: false,
        meta: {
          exportHeaderName: "WO/PO Value",
          exportValue: (row: ProjectPayments) =>
            formatToRoundedIndianRupee(
              getDocumentTotal(row.document_name, row.document_type)
            ),
        },
      },
      {
        id: "total_paid_for_doc",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Total Paid" />
        ),
        cell: ({ row }) => {
          const amountPaid = getAmountPaid(row.original.document_name);
          return (
            <div className="font-medium pr-2">
              {formatToRoundedIndianRupee(amountPaid)}
            </div>
          );
        },
        size: 100,
        enableSorting: false,
        meta: {
          exportHeaderName: "Total Paid",
          exportValue: (row: ProjectPayments) =>
            formatToRoundedIndianRupee(getAmountPaid(row.document_name)),
        },
      },
      {
        id: "payable_against_delivery",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Payable Against Delivery" />
        ),
        cell: ({ row }) => {
          const delivered = getPoAmountDelivered(
            row.original.document_name,
            row.original.document_type
          );
          return (
            <div className="font-medium pr-2">
              {delivered ? formatToRoundedIndianRupee(delivered) : "N/A"}
            </div>
          );
        },
        size: 100,
        enableSorting: false,
        meta: {
          exportHeaderName: "Payable Against Delivery",
          exportValue: (row: ProjectPayments) =>
            getPoAmountDelivered(row.document_name, row.document_type),
        },
      },
      {
        accessorKey: "amount",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Req. Amt" />
        ),
        cell: ({ row }) => (
          <div className="font-medium pr-2 text-emerald-500 dark:text-emerald-300">
            {formatToRoundedIndianRupee(parseNumber(row.getValue("amount")))}
          </div>
        ),
        size: 100,
        meta: {
          exportHeaderName: "Requested Amount",
          exportValue: (row: ProjectPayments) =>
            formatToRoundedIndianRupee(parseNumber(row.amount)),
        },
      },
      {
        accessorKey: "owner",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Requested By" />
        ),
        cell: ({ row }) => {
          const ownerUser = userList?.find(
            (user) => user.name === row.original.owner
          );
          return (
            <div className="font-medium truncate">
              {ownerUser?.full_name || row.original.owner}
            </div>
          );
        },
        size: 120,
        meta: {
          exportHeaderName: "Requested By",
          exportValue: (row: ProjectPayments) =>
            userList?.find((user) => user.name === row.owner)?.full_name ||
            row.owner,
        },
      },
      ...(!readOnly ? [{
        id: "actions",
        header: "Actions",
        cell: ({ row }: { row: Row<ProjectPayments> }) => (
          <div className="flex items-center gap-1">
            <HoverCard>
              <HoverCardTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-green-600 hover:text-green-700"
                  onClick={() =>
                    openDialog(row.original, DIALOG_ACTION_TYPES.APPROVE)
                  }
                >
                  <CircleCheck className="h-5 w-5" />
                </Button>
              </HoverCardTrigger>
              <HoverCardContent className="text-xs w-auto p-1.5">
                {isCEOMode ? "CEO Approve" : "Approve"}
              </HoverCardContent>
            </HoverCard>
            <HoverCard>
              <HoverCardTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-red-600 hover:text-red-700"
                  onClick={() =>
                    openDialog(row.original, DIALOG_ACTION_TYPES.REJECT)
                  }
                >
                  <CircleX className="h-5 w-5" />
                </Button>
              </HoverCardTrigger>
              <HoverCardContent className="text-xs w-auto p-1.5">
                Reject
              </HoverCardContent>
            </HoverCard>
          </div>
        ),
        size: 80,
        meta: {
          excludedFromExport: true,
        },
      } as ColumnDef<ProjectPayments>] : []),
    ],
    [
      notifications,
      projectOptions,
      vendorOptions,
      userList,
      handleNewPaymentSeen,
      openDialog,
      getDocumentTotal,
      getAmountPaid,
      getPoAmountDelivered,
      getProjectValue,
      getProjectCashflowGap,
      allPaidPayments,
      readOnly,
      isCEOMode,
    ]
  );

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
    columnFilters,
    exportAllRows,
    isExporting,
  } = useServerDataTable<ProjectPayments>({
    doctype: DOCTYPE,
    columns: columns,
    fetchFields: fieldsToFetchPP,
    searchableFields: ppSearchableFields,
    urlSyncKey: isCEOMode ? URL_SYNC_KEY_CEO : URL_SYNC_KEY_LEAD,
    defaultSort: "creation desc",
    enableRowSelection: !readOnly
      ? (row) => !ceoHoldProjectIds.has(row.original.project)
      : false,
    additionalFilters: staticFilters,
  });

  // --- Dynamic Facet Values with Counts ---
  const {
    facetOptions: projectFacetOptions,
    isLoading: isProjectFacetLoading,
  } = useFacetValues({
    doctype: DOCTYPE,
    field: "project",
    currentFilters: columnFilters,
    searchTerm,
    selectedSearchField,
    additionalFilters: staticFilters,
  });

  const { facetOptions: vendorFacetOptions, isLoading: isVendorFacetLoading } =
    useFacetValues({
      doctype: DOCTYPE,
      field: "vendor",
      currentFilters: columnFilters,
      searchTerm,
      selectedSearchField,
      additionalFilters: staticFilters,
    });

  // --- Faceted Filter Options ---
  const facetFilterOptions = useMemo(
    () => ({
      project: {
        title: "Project",
        options: projectFacetOptions,
        isLoading: isProjectFacetLoading,
      },
      vendor: {
        title: "Vendor",
        options: vendorFacetOptions,
        isLoading: isVendorFacetLoading,
      },
    }),
    [
      projectFacetOptions,
      isProjectFacetLoading,
      vendorFacetOptions,
      isVendorFacetLoading,
    ]
  );

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
      try {
        if (isCEOMode) {
          if (actionType === DIALOG_ACTION_TYPES.REJECT) {
            // CEO rejection: no amount edits — flip status to Rejected.
            await updateDoc(DOCTYPE, selectedPayment.name, {
              status: PAYMENT_STATUS.REJECTED,
            });
          } else {
            // CEO approval: call the whitelisted API so the backend can enforce
            // the single-user permission gate (Approved + ceo_approval_date stamp).
            await ceoApproveCall({ payment_id: selectedPayment.name });
          }
        } else {
          const newStatus =
            actionType === DIALOG_ACTION_TYPES.APPROVE ||
              actionType === DIALOG_ACTION_TYPES.EDIT
              ? PAYMENT_STATUS.CEO_PENDING
              : PAYMENT_STATUS.REJECTED;
          await updateDoc(DOCTYPE, selectedPayment.name, {
            status: newStatus,
            amount: amount,
            approval_date: new Date().toISOString().split("T")[0],
            ...(payment_details && {
              payment_details: JSON.stringify(payment_details),
            }),
          });
        }
        refetch();
        closeDialog();
        invalidateSidebarCounts();

        toast({
          title: "Success!",
          description:
            isCEOMode && actionType !== DIALOG_ACTION_TYPES.REJECT
              ? "Payment forwarded for fulfilment."
              : `Payment ${actionType} successfully!`,
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

  // --- useServerDataTable Hook moved up above facets for columnFilters access ---

  // --- CEO Hold Row Highlighting ---
  const getRowClassName = useCallback(
    (row: Row<ProjectPayments>) => {
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
    <div
      className={cn(
        "flex flex-col gap-2 overflow-hidden",
        totalCount > 10
          ? "max-h-[calc(100vh-180px)]"
          : totalCount > 0
            ? "h-auto"
            : ""
      )}
    >
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
          summaryCard={<PaymentSummaryCards totalCount={totalCount} />}
          facetFilterOptions={facetFilterOptions}
          dateFilterColumns={dateColumns}
          showExportButton={true} // Optional
          onExport={"default"}
          onExportAll={exportAllRows}
          isExporting={isExporting}
          exportFileName={`${isCEOMode ? "CEO_Pending_Payments" : "Approve_Payments"}_${formatDate(new Date())}`}
          getRowClassName={getRowClassName}
          showRowSelection={!readOnly}
          toolbarActions={
            !readOnly ? (
              <BulkActionBar
                table={table}
                mode={isCEOMode ? "ceo" : "lead"}
                refetch={refetch}
                projectLabelFor={projectLabelFor}
                vendorLabelFor={vendorLabelFor}
              />
            ) : undefined
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
        />
      )}
    </div>
  );
};

export default ApprovePayments;
