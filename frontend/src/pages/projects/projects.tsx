import React, { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import {
  useFrappeGetDocList,
  useFrappeGetDocCount,
  useFrappePostCall,
} from "frappe-react-sdk";
import memoize from "lodash/memoize";
import {
  CircleCheckBig,
  CirclePlus,
  HardHat,
  OctagonMinus,
  ChevronDown,
} from "lucide-react";
import { TailSpin } from "react-loader-spinner";

// --- UI Components ---
import {
  DataTable,
  SearchFieldOption,
} from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/skeleton";

// --- Hooks & Utils ---
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useFacetValues } from "@/hooks/useFacetValues";
import { useUserData } from "@/hooks/useUserData";
import { useCEOHoldProjects } from "@/hooks/useCEOHoldProjects";
import { CEO_HOLD_ROW_CLASSES } from "@/utils/ceoHoldRowStyles";
import { formatDate } from "@/utils/FormatDate";
import { formatToApproxLakhs, formatToLakhsNumber } from "@/utils/FormatPrice";
import {
  getTotalInflowAmount,
  // getPOSTotals,
  // getPOTotal,
  getSRTotal,
  getTotalAmountPaid,
  getTotalExpensePaid,
} from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";

// --- Types ---
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
// import { ProjectTypes } from "@/types/NirmaanStack/ProjectTypes";

// --- Config ---
import {
  DEFAULT_PROJECT_FIELDS_TO_FETCH,
  PROJECT_SEARCHABLE_FIELDS,
  PROJECT_DATE_COLUMNS,
  getProjectStaticFilters,
} from "./config/projectTable.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses";
import { useProjectAllCredits } from "./hooks/useProjectAllCredits";
import { useUsersList } from "../ProcurementRequests/ApproveNewPR/hooks/useUsersList";
// --- Constants ---
const DOCTYPE = "Projects";

interface ProjectsProps {
  customersView?: boolean; // To hide summary card
  customerId?: string; // To filter projects by customer
  urlContext?: string; // For unique URL state if multiple instances
}

// ProcessedProject type for the table, including calculated financials
export interface ProcessedProjectForTable extends ProjectsType {
  calculatedTotalInvoiced: number;
  calculatedTotalInflow: number;
  calculatedTotalOutflow: number;
  totalCreditPurchase: number;
  totalCreditDue: number;
  totalCreditPaid: number;
  totalLiabilities: number;
  // prStatusCounts?: Record<string, number>; // For the status count badge display
}

interface ProjectStatusCount {
  label: string;
  value: string;
  count: number | undefined;
  isLoading: boolean;
}

// --- Helper: StatusCountPill ---
interface StatusCountPillProps {
  statusValue: string;
  statusLabel: string;
  count: number;
  compact?: boolean;
}

const StatusCountPill: React.FC<StatusCountPillProps> = ({
  statusValue,
  statusLabel,
  count,
  compact = false,
}) => {
  const getPillColors = (status: string) => {
    switch (status) {
      case "Created":
        return { bg: "bg-blue-100/50", border: "border-blue-200", text: "text-blue-700", dot: "bg-blue-500" };
      case "WIP":
        return { bg: "bg-yellow-100/50", border: "border-yellow-200", text: "text-yellow-700", dot: "bg-yellow-500" };
      case "Completed":
        return { bg: "bg-green-100/50", border: "border-green-200", text: "text-green-700", dot: "bg-green-500" };
      case "Halted":
        return { bg: "bg-red-100/50", border: "border-red-200", text: "text-red-700", dot: "bg-red-500" };
      default:
        return { bg: "bg-slate-100/50", border: "border-slate-200", text: "text-slate-700", dot: "bg-slate-500" };
    }
  };
  const colors = getPillColors(statusValue);
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border transition-all hover:shadow-sm flex-shrink-0",
        compact ? "px-2 py-1" : "px-3 py-1.5",
        colors.bg,
        colors.border
      )}
    >
      <span
        className={cn(
          "rounded-full flex-shrink-0",
          compact ? "w-1.5 h-1.5" : "w-2 h-2",
          colors.dot
        )}
      />
      <span
        className={cn(
          "font-medium whitespace-nowrap",
          compact ? "text-[10px]" : "text-xs",
          colors.text
        )}
      >
        {statusLabel}
      </span>
      <span
        className={cn(
          "font-bold tabular-nums",
          compact ? "text-[10px]" : "text-xs",
          colors.text
        )}
      >
        {count}
      </span>
    </div>
  );
};

// --- Component ---
// Roles that can see financial columns
const FINANCIAL_COLUMNS_ROLES = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
  "Nirmaan Accountant Profile",
];

// Roles that can see the summary card
const SUMMARY_CARD_ROLES = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
];

export const Projects: React.FC<ProjectsProps> = ({
  customersView = false,
  customerId,
  urlContext = "main", // Default context for URL key
}) => {
  const { role, user_id } = useUserData();
  const canViewFinancials = FINANCIAL_COLUMNS_ROLES.includes(role);
  const canViewSummaryCard = user_id === "Administrator" || SUMMARY_CARD_ROLES.includes(role);

  const [isExpanded, setIsExpanded] = useState(false);

  const { ceoHoldProjectIds } = useCEOHoldProjects();

  const getRowClassName = useCallback(
    (row: any) => {
      const projectId = row.original.name;
      if (projectId && ceoHoldProjectIds.has(projectId)) {
        return CEO_HOLD_ROW_CLASSES;
      }
      return undefined;
    },
    [ceoHoldProjectIds]
  );

  const urlSyncKey = useMemo(
    () =>
      `projects_list_${urlContext}${customerId ? `_cust_${customerId}` : ""}`,
    [urlContext, customerId]
  );

  const [statusCounts, setStatusCounts] = useState<ProjectStatusCount[]>([]);

  const { call } = useFrappePostCall("frappe.client.get_count");

  const { data: all_projects_count } = useFrappeGetDocCount(
    "Projects",
    undefined,
    false,
    "all_projects_count"
  );

  const statusOptions = useMemo(
    () =>
      ["WIP", "Completed", "Halted"].map((s) => ({
        label: s,
        value: s,
      })),
    []
  ); // Example static status options

  useEffect(() => {
    const fetchCounts = async () => {
      const countsPromises = statusOptions.map((status) =>
        call({
          doctype: DOCTYPE,
          filters: { status: status.value },
        })
          .then((res) => ({
            ...status,
            count: res.message,
            isLoading: false,
          }))
          .catch(() => ({
            ...status,
            count: 0, // Default to 0 on error
            isLoading: false,
          }))
      );
      const resolvedCounts = await Promise.all(countsPromises);
      setStatusCounts(resolvedCounts as ProjectStatusCount[]);
    };
    fetchCounts();
  }, []); // Runs once

  // --- Supporting Data & Hooks ---
  const {
    data: userList,
    isLoading: userListLoading,
    error: userError,
  } = useUsersList();

  // const { data: prData, isLoading: prDataLoading, error: prDataError } = useFrappeGetDocList<ProcurementRequest>(
  //     "Procurement Requests", { fields: ["name", "project", "workflow_state", "procurement_list"], limit: 100000 }, "PRs_For_ProjectsList" // Fetch all for counts
  // );

  // const { data: CreditData } = useCredits()
  const { creditTerms: CreditData } = useProjectAllCredits(undefined);

  // console.log("CreditData", CreditData);

  const {
    data: poData,
    isLoading: poDataLoading,
    error: poDataError,
  } = useFrappeGetDocList<ProcurementOrder>(
    "Procurement Orders",
    {
      fields: [
        "name",
        "project",
        "status",
        "amount",
        "tax_amount",
        "total_amount",
        "invoice_data",
        "amount_paid",
        "po_amount_delivered",
      ],
      filters: [["status", "not in", ["Merged", "Inactive"]]],
      limit: 100000,
    },
    "POs_For_ProjectsList"
  );

  const {
    data: srData,
    isLoading: srDataLoading,
    error: srDataError,
  } = useFrappeGetDocList<ServiceRequests>(
    "Service Requests",
    {
      fields: ["name", "project", "status", "service_order_list", "gst"],
      filters: [["status", "=", "Approved"]],
      limit: 100000,
    },
    "SRs_For_ProjectsList"
  );
  const {
    data: projectInflows,
    isLoading: projectInflowsLoading,
    error: projectInflowsError,
  } = useFrappeGetDocList<ProjectInflows>(
    "Project Inflows",
    { fields: ["project", "amount"], limit: 100000 },
    "Inflows_For_ProjectsList"
  );
  const {
    data: projectPayments,
    isLoading: projectPaymentsLoading,
    error: projectPaymentsError,
  } = useFrappeGetDocList<ProjectPayments>(
    "Project Payments",
    {
      fields: ["project", "amount", "status"],
      filters: [["status", "=", "Paid"]],
      limit: 100000,
    },
    "Payments_For_ProjectsList"
  );
  const {
    data: projectExpenses,
    isLoading: projectExpensesLoading,
    error: projectExpensesError,
  } = useFrappeGetDocList<ProjectExpenses>(
    "Project Expenses",
    { fields: ["projects", "amount"], limit: 100000 },
    "ProjectExpenses_For_ProjectsList"
  );

  // --- Memoized Lookups & Pre-processing for Column Calculations ---

  const getProjectFinancials = useMemo(() => {
    if (
      !poData ||
      !srData ||
      !projectInflows ||
      !projectPayments ||
      !projectExpenses ||
      !CreditData
    )
      return () => ({
        calculatedTotalInvoiced: 0,
        calculatedTotalInflow: 0,
        calculatedTotalOutflow: 0,
        totalCreditPurchase: 0,
        totalCreditPaid: 0,
        totalCreditDue: 0,
        totalLiabilities: 0,
      });

    // Pre-group data for efficiency
    const posByProject = memoize((projId: string) =>
      poData.filter((po) => po.project === projId)
    );
    const srsByProject = memoize((projId: string) =>
      srData.filter((sr) => sr.project === projId)
    );
    const inflowsByProject = memoize((projId: string) =>
      projectInflows.filter((pi) => pi.project === projId)
    );
    const paymentsByProject = memoize((projId: string) =>
      projectPayments.filter((pp) => pp.project === projId)
    );
    const expensesByProject = memoize((projId: string) =>
      projectExpenses.filter((pe) => pe.projects === projId)
    );

    // CreditData is now the raw list of all credit terms for all projects
    const creditsByProject = memoize((projId: string) =>
      CreditData.filter((cr) => cr.project == projId)
    );

    return memoize((projectId: string) => {
      const relatedPOs = posByProject(projectId);
      const relatedSRs = srsByProject(projectId);
      const relatedInflows = inflowsByProject(projectId);
      const relatedPayments = paymentsByProject(projectId);
      const relatedExpenses = expensesByProject(projectId);

      const projectCredits = creditsByProject(projectId);

      const totalCreditPurchase = projectCredits.reduce(
        (sum, term) => sum + parseNumber(term.amount),
        0
      );

      const totalCreditDue = projectCredits
        .filter((cr) => cr.term_status === "Scheduled")
        .reduce((sum, term) => sum + parseNumber(term.amount), 0);

      const totalCreditPaid = projectCredits
        .filter((cr) => cr.term_status === "Paid")
        .reduce((sum, term) => sum + parseNumber(term.amount), 0);

      // let totalInvoiced = 0;
      // relatedPOs.forEach(po => totalInvoiced += getPOTotal(po)?.totalAmt || 0);
      let totalInvoiced = relatedPOs.reduce((sum,term)=>sum+parseNumber(term.total_amount),0);
      // let totalInvoiced = getPOSTotals(relatedPOs as any)?.totalWithTax || 0;

      relatedSRs.forEach((sr) => {
        const srVal = getSRTotal(sr); // Assuming getSRTotal returns value without GST
        totalInvoiced += sr.gst === "true" ? srVal * 1.18 : srVal;
      });

      const totalInflow = getTotalInflowAmount(relatedInflows);
      const totalOutflow =
        getTotalAmountPaid(relatedPayments) +
        getTotalExpensePaid(relatedExpenses); // Already filtered for "Paid"

      // Calculate Total Liabilities (Payable Amount Against Delivered - Amount Paid Against Delivered)
      const totalPayableAgainstDelivered = relatedPOs.reduce(
        (sum, po) => sum + parseNumber(po.po_amount_delivered || 0),
        0
      );
      const totalPaidAgainstDelivered = relatedPOs.reduce((sum, po) => {
        const amountPaid = parseNumber(po.amount_paid || 0);
        const poAmountDelivered = parseNumber(po.po_amount_delivered || 0);
        return sum + Math.min(amountPaid, poAmountDelivered);
      }, 0);
      const totalLiabilities =
        totalPayableAgainstDelivered - totalPaidAgainstDelivered;

      return {
        calculatedTotalInvoiced: totalInvoiced,
        calculatedTotalInflow: totalInflow,
        calculatedTotalOutflow: totalOutflow,
        totalCreditPurchase, // Renamed from relatedTotalBalanceCredit
        totalCreditPaid,
        totalCreditDue,
        totalLiabilities,
      };
    });
  }, [
    poData,
    srData,
    projectInflows,
    projectPayments,
    projectExpenses,
    CreditData,
  ]);

  // const prStatusCountsByProject = useMemo(() => {
  //     if (!prData || !poData) return {};
  //     const counts: Record<string, Record<string, number>> = {};
  //     // Simplified status logic - adjust if statusRender was more complex
  //     prData.forEach(pr => {
  //         if (!pr.project) return;
  //         if (!counts[pr.project]) counts[pr.project] = { "New PR": 0, "Open PR": 0, "Approved PO": 0 };

  //         let statusCategory = "New PR"; // Default for "Pending"
  //         if (pr.workflow_state === "Approved") { // Or "Vendor Selected" etc.
  //              // Check if all items have corresponding POs
  //             const prItems = pr.procurement_list?.list || [];
  //             const poForThisPR = poData.filter(po => po.procurement_request === pr.name);
  //             const allItemsInPO = prItems.every(prItem =>
  //                 poForThisPR.some(po =>
  //                     po.order_list?.list.some(poItem => poItem.item === prItem.item) // Assuming item_code links them
  //                 )
  //             );
  //             if (allItemsInPO && poForThisPR.length > 0) statusCategory = "Approved PO";
  //             else if (poForThisPR.length > 0) statusCategory = "Open PR"; // Some items in PO
  //             // else stays "New PR" if no PO created yet from this PR
  //         } else if (pr.workflow_state !== "Pending") { // Other states might be Open PR
  //             statusCategory = "Open PR";
  //         }
  //         counts[pr.project][statusCategory] = (counts[pr.project][statusCategory] || 0) + 1;
  //     });
  //     return counts;
  // }, [prData, poData]);

  // --- Column Definitions for the Combined DataTable ---
  // Base columns visible to all users
  const baseColumns = useMemo<ColumnDef<ProjectsType>[]>(
    () => [
      {
        accessorKey: "name",
        header: "ID",
        cell: ({ row }) => (
          <Link
            to={`/projects/${row.original.name}`}
            className="text-blue-600 hover:underline font-medium"
          >
            {row.original.name?.slice(-5)}
          </Link>
        ),
        size: 100,
        meta: {
          exportHeaderName: "Project ID",
        },
      },
      {
        accessorKey: "project_name",
        header: "Project Name",
        cell: ({ row }) => (
          <Link
            to={`/projects/${row.original.name}`}
            className="text-blue-600 hover:underline font-medium"
          >
            {row.original.project_name || row.original.name}
          </Link>
        ),
        size: 200,
      },
      {
        accessorKey: "creation",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Created" />
        ),
        cell: ({ row }) => formatDate(row.original.creation),
        meta: {
          exportHeaderName: "Project Creation Date",
        },
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.status === "Completed"
                ? "default"
                : row.original.status === "Halted"
                ? "destructive"
                : "secondary"
            }
          >
            {row.original.status}
          </Badge>
        ),
        enableColumnFilter: true,
        meta: {
          enableFacet: true,
          facetTitle: "Status",
        },
      },
      {
        accessorKey: "project_type",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Type" />
        ),
        cell: ({ row }) => <div>{row.original.project_type || "--"}</div>,
        enableColumnFilter: true,
        meta: {
          enableFacet: true,
          facetTitle: "Project Type",
        },
      },
    ],
    []
  );

  // Financial columns only visible to Admin, PMO, and Accountant roles
  const financialColumns = useMemo<ColumnDef<ProjectsType>[]>(
    () => [
      {
        accessorKey: "project_value_gst",
        header: "Value (incl.GST)",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatToApproxLakhs(row.original.project_value_gst)}
          </span>
        ),
        size: 100,
        meta: {
          exportHeaderName: "Value incl. GST (in Lakhs)",
          exportValue: (row) => formatToLakhsNumber(row.project_value_gst),
          isNumeric: true,
        },
      },
      {
        id: "po_amount",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="PO + WO Amount (incl.GST)" />
        ),
        cell: ({ row }) => {
          const financials = getProjectFinancials(row.original.name);
          return (
            <span className="tabular-nums">
              {formatToApproxLakhs(financials.calculatedTotalInvoiced)}
            </span>
          );
        },
        size: 100,
        meta: {
          exportHeaderName: "PO Amount (in Lakhs)",
          exportValue: (row) => {
            const financials = getProjectFinancials(row.name);
            return formatToLakhsNumber(financials.calculatedTotalInvoiced);
          },
          isNumeric: true,
        },
      },
      {
        id: "inflow",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Inflow" />
        ),
        cell: ({ row }) => {
          const financials = getProjectFinancials(row.original.name);
          return (
            <span className="text-green-600 tabular-nums">
              {formatToApproxLakhs(financials.calculatedTotalInflow)}
            </span>
          );
        },
        size: 100,
        meta: {
          exportHeaderName: "Inflow (in Lakhs)",
          exportValue: (row) => {
            const financials = getProjectFinancials(row.name);
            return formatToLakhsNumber(financials.calculatedTotalInflow);
          },
          isNumeric: true,
        },
      },
      {
        id: "outflow",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Outflow" />
        ),
        cell: ({ row }) => {
          const financials = getProjectFinancials(row.original.name);
          return (
            <span className="text-red-600 tabular-nums">
              {formatToApproxLakhs(financials.calculatedTotalOutflow)}
            </span>
          );
        },
        size: 100,
        meta: {
          exportHeaderName: "Outflow (in Lakhs)",
          exportValue: (row) => {
            const financials = getProjectFinancials(row.name);
            return formatToLakhsNumber(financials.calculatedTotalOutflow);
          },
          isNumeric: true,
        },
      },
      {
        id: "total_liabilities",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Current Liabilities" />
        ),
        cell: ({ row }) => {
          const financials = getProjectFinancials(row.original.name);
          return (
            <span className="text-red-600 tabular-nums">
              {formatToApproxLakhs(financials.totalLiabilities)}
            </span>
          );
        },
        size: 100,
        meta: {
          exportHeaderName: "Current Liabilities (in Lakhs)",
          exportValue: (row) => {
            const financials = getProjectFinancials(row.name);
            return formatToLakhsNumber(financials.totalLiabilities);
          },
          isNumeric: true,
        },
      },
      {
        id: "cashflow_gap",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Cashflow Gap" />
        ),
        cell: ({ row }) => {
          const financials = getProjectFinancials(row.original.name);
          const cashflowGap =
            financials.calculatedTotalOutflow +
            financials.totalLiabilities -
            financials.calculatedTotalInflow;
          return (
            <span
              className={`tabular-nums ${
                cashflowGap > 0 ? "text-red-600" : "text-green-600"
              }`}
            >
              {formatToApproxLakhs(cashflowGap)}
            </span>
          );
        },
        size: 100,
        meta: {
          exportHeaderName: "Cashflow Gap (in Lakhs)",
          exportValue: (row) => {
            const financials = getProjectFinancials(row.name);
            const cashflowGap =
              financials.calculatedTotalOutflow +
              financials.totalLiabilities -
              financials.calculatedTotalInflow;
            return formatToLakhsNumber(cashflowGap);
          },
          isNumeric: true,
        },
      },
      {
        id: "TotalCreditAmt",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Total Purchase Over Credit"
          />
        ),
        cell: ({ row }) => {
          const financials = getProjectFinancials(row.original.name);
          return (
            <span className="tabular-nums">
              {formatToApproxLakhs(parseNumber(financials.totalCreditPurchase))}
            </span>
          );
        },
        size: 100,
        meta: {
          exportHeaderName: "Total Purchase Over Credit (in Lakhs)",
          exportValue: (row) => {
            const financials = getProjectFinancials(row.name);
            return formatToLakhsNumber(
              parseNumber(financials.totalCreditPurchase)
            );
          },
          isNumeric: true,
        },
      },
    ],
    [getProjectFinancials]
  );

  // Combine columns based on user role
  const columns = useMemo<ColumnDef<ProjectsType>[]>(
    () => (canViewFinancials ? [...baseColumns, ...financialColumns] : baseColumns),
    [baseColumns, financialColumns, canViewFinancials]
  );

  // --- Static Filters for `useServerDataTable` ---
  const staticFilters = useMemo(
    () => getProjectStaticFilters(customerId),
    [customerId]
  );

  // --- useServerDataTable Hook for the main Projects list ---
  const {
    table,
    data: projectsDataForTable,
    totalCount,
    isLoading: listIsLoading,
    error: listError,
    exportAllRows,
    isExporting,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
    columnFilters, // Destructure columnFilters
    isRowSelectionActive,
    refetch,
  } = useServerDataTable<ProjectsType>({
    // Fetches ProjectsType
    doctype: DOCTYPE,
    columns: columns, // Columns defined below and passed to DataTable component
    fetchFields: DEFAULT_PROJECT_FIELDS_TO_FETCH,
    searchableFields: PROJECT_SEARCHABLE_FIELDS,
    urlSyncKey: urlSyncKey,
    defaultSort: "creation desc",
    enableRowSelection: false, // No selection needed for this overview table
    additionalFilters: staticFilters,
    // shouldCache: true,
  });

  // // --- Transform fetched project data to include calculated financials and PR counts ---
  // const processedTableData = useMemo<ProcessedProjectForTable[]>(() => {
  //     if (!projectsDataForTable) return [];
  //     return projectsDataForTable.map(project => ({
  //         ...project,
  //         // ...getProjectFinancials(project.name),
  //         calculatedTotalInvoiced : getProjectFinancials(project.name).calculatedTotalInvoiced,
  //         calculatedTotalInflow : getProjectFinancials(project.name).calculatedTotalInflow,
  //         calculatedTotalOutflow : getProjectFinancials(project.name).calculatedTotalOutflow,
  //         // prStatusCounts: prStatusCountsByProject[project.name] || { "New PR": 0, "Open PR": 0, "Approved PO": 0 },
  //     }));
  // }, [projectsDataForTable, getProjectFinancials,
  //   // prStatusCountsByProject
  // ]);

  // --- Dynamic Facet Values ---
  const { facetOptions: statusFacetOptions, isLoading: isStatusFacetLoading } =
    useFacetValues({
      doctype: DOCTYPE,
      field: "status",
      currentFilters: columnFilters,
      searchTerm,
      selectedSearchField,
      additionalFilters: staticFilters, // Important: include static filters (like customer restriction)
      enabled: true,
    });

  const {
    facetOptions: projectTypeFacetOptions,
    isLoading: isProjectTypeFacetLoading,
  } = useFacetValues({
    doctype: DOCTYPE,
    field: "project_type",
    currentFilters: columnFilters,
    searchTerm,
    selectedSearchField,
    additionalFilters: staticFilters,
    enabled: true,
  });

  // --- Faceted Filter Options ---
  const facetFilterOptions = useMemo(
    () => ({
      status: {
        title: "Status",
        options: statusFacetOptions,
        isLoading: isStatusFacetLoading,
      },
      project_type: {
        title: "Project Type",
        options: projectTypeFacetOptions,
        isLoading: isProjectTypeFacetLoading,
      },
    }),
    [
      statusFacetOptions,
      isStatusFacetLoading,
      projectTypeFacetOptions,
      isProjectTypeFacetLoading,
    ]
  );

  // --- Combined Loading & Error States ---
  const isLoadingOverall =
    poDataLoading ||
    srDataLoading ||
    projectInflowsLoading ||
    projectPaymentsLoading ||
    projectExpensesLoading ||
    listIsLoading ||
    userListLoading;

  const combinedErrorOverall =
    poDataError ||
    srDataError ||
    projectInflowsError ||
    projectPaymentsError ||
    projectExpensesError ||
    userError ||
    listError;

  if (combinedErrorOverall && !projectsDataForTable?.length) {
    // Display prominent error from data fetching/processing
    return <AlertDestructive error={combinedErrorOverall} />;
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 overflow-hidden",
        totalCount > 10
          ? "max-h-[calc(100vh-80px)]"
          : totalCount > 0
          ? "h-auto"
          : ""
      )}
    >
      {!customersView && canViewSummaryCard && (
        <Card className="my-2 shadow-sm overflow-hidden">
          <CardContent className="p-0">
            {/* Header - Always visible */}
            <div
              className="flex items-center justify-between p-3 md:p-4 cursor-pointer md:cursor-default"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 md:h-10 md:w-10 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0">
                  <HardHat className="h-4 w-4 md:h-5 md:w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    {listIsLoading ? (
                      <TailSpin
                        visible={true}
                        height="18"
                        width="18"
                        color="#D03B45"
                        radius="1"
                      />
                    ) : (
                      <span className="text-lg md:text-2xl font-semibold tabular-nums">
                        {all_projects_count ?? 0}
                      </span>
                    )}
                    <span className="text-sm text-muted-foreground font-normal">
                      Total Projects
                    </span>
                  </div>
                  {/* Mobile: Show compact summary when collapsed */}
                  <div className="md:hidden">
                    {!isExpanded && (
                      <div className="flex items-center gap-2">
                        {statusCounts.map((status) => {
                          const getDotColor = (s: string) => {
                            switch (s) {
                              case "WIP": return "bg-yellow-500";
                              case "Completed": return "bg-green-500";
                              case "Halted": return "bg-red-500";
                              default: return "bg-slate-500";
                            }
                          };
                          return (
                            <div key={status.value} className="flex items-center gap-1">
                              <span className={cn("w-2 h-2 rounded-full", getDotColor(status.value))} />
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {status.count ?? 0}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Mobile expand/collapse button */}
              <button
                className="md:hidden p-1.5 rounded-md hover:bg-muted/50 transition-colors"
                aria-label={
                  isExpanded ? "Collapse details" : "Expand details"
                }
              >
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform duration-200",
                    isExpanded && "rotate-180"
                  )}
                />
              </button>
            </div>

            {/* Pills Section */}
            {/* Desktop & Tablet: Always visible */}
            <div className="hidden md:block px-4 pb-9">
              {/* Tablet: Horizontal scroll | Desktop: Wrap */}
              <div className="lg:flex lg:flex-wrap lg:gap-2 md:flex md:gap-2 md:overflow-x-auto md:pb-1 md:-mb-1 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
                {statusCounts.map((status) => (
                  <StatusCountPill
                    key={status.value}
                    statusValue={status.value}
                    statusLabel={status.label}
                    count={status.count ?? 0}
                  />
                ))}
              </div>
            </div>

            {/* Mobile: Collapsible section */}
            <div
              className={cn(
                "md:hidden overflow-hidden transition-all duration-200 ease-in-out",
                isExpanded ? "max-h-48 opacity-100" : "max-h-0 opacity-0"
              )}
            >
              <div className="px-3 pb-6 pt-1">
                <div className="flex flex-wrap gap-1.5">
                  {statusCounts.map((status) => (
                    <StatusCountPill
                      key={status.value}
                      statusValue={status.value}
                      statusLabel={status.label}
                      count={status.count ?? 0}
                      compact
                    />
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      <div
        className={cn(
          "flex flex-col gap-2 overflow-hidden",
          totalCount > 10
            ? "h-[calc(100vh-80px)]"
            : totalCount > 0
            ? "h-auto"
            : ""
        )}
      >
        {isLoadingOverall && !projectsDataForTable?.length ? (
          <TableSkeleton />
        ) : (
          <DataTable<ProjectsType>
            table={table} // The table instance from useServerDataTable, now operating on clientData
            columns={columns} // Your defined display columns
            isLoading={listIsLoading} //isLoading for the table data itself
            error={listError}
            totalCount={totalCount} // This will be total of processedProjects
            searchFieldOptions={PROJECT_SEARCHABLE_FIELDS}
            selectedSearchField={selectedSearchField}
            onSelectedSearchFieldChange={setSelectedSearchField}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            facetFilterOptions={facetFilterOptions}
            dateFilterColumns={PROJECT_DATE_COLUMNS}
            showExportButton={true}
            onExport={"default"}
            onExportAll={exportAllRows}
            isExporting={isExporting}
            exportFileName="Projects_Report"
            getRowClassName={getRowClassName}
          />
        )}
      </div>
    </div>
  );
};

export default Projects;
