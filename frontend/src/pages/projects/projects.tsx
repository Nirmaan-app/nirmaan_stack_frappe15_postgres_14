import React, { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { TailSpin } from "react-loader-spinner";

// --- UI Components ---
import {
  DataTable,
  SearchFieldOption,
} from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/skeleton";

// --- Hooks & Utils ---
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useFacetValues } from "@/hooks/useFacetValues";
import { useUserData } from "@/hooks/useUserData";
import { formatDate } from "@/utils/FormatDate";
import { formatToApproxLakhs } from "@/utils/FormatPrice";
import {
  getTotalInflowAmount,
  getPOSTotals,
  getPOTotal,
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
      ["Created", "WIP", "Completed", "Halted"].map((s) => ({
        label: s,
        value: s,
      })),
    []
  ); // Example static status options

  const getColor = useMemo(
    () => (status: string) => {
      switch (status) {
        case "Created":
          return "bg-blue-100";
        case "WIP":
          return "bg-yellow-100";
        case "Completed":
          return "bg-green-100";
        case "Halted":
          return "bg-red-100";
        default:
          return "bg-blue-100";
      }
    },
    []
  );

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

  console.log("CreditData", CreditData);

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
      filters: [["status", "not in", ["Merged", "Inactive", "PO Amendment"]]],
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
      let totalInvoiced = getPOSTotals(relatedPOs as any)?.totalWithTax || 0;

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
          exportHeaderName: "Value (incl. GST)",
        },
      },
      {
        id: "po_amount",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="PO Amount (incl.GST)" />
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
          exportHeaderName: "PO Amount (Lakhs)",
          exportValue: (row) => {
            const financials = getProjectFinancials(row.name);
            return formatToApproxLakhs(financials.calculatedTotalInvoiced);
          },
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
          exportHeaderName: "Inflow (Lakhs)",
          exportValue: (row) => {
            const financials = getProjectFinancials(row.name);
            return formatToApproxLakhs(financials.calculatedTotalInflow);
          },
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
          exportHeaderName: "Outflow (Lakhs)",
          exportValue: (row) => {
            const financials = getProjectFinancials(row.name);
            return formatToApproxLakhs(financials.calculatedTotalOutflow);
          },
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
          exportHeaderName: "Current Liabilities",
          exportValue: (row) => {
            const financials = getProjectFinancials(row.name);
            return formatToApproxLakhs(financials.totalLiabilities);
          },
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
          exportHeaderName: "Cashflow Gap (Lakhs)",
          exportValue: (row) => {
            const financials = getProjectFinancials(row.name);
            const cashflowGap =
              financials.calculatedTotalOutflow +
              financials.totalLiabilities -
              financials.calculatedTotalInflow;
            return formatToApproxLakhs(cashflowGap);
          },
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
          exportHeaderName: "Total Purchase Over Credit",
          exportValue: (row) => {
            const financials = getProjectFinancials(row.name);
            return formatToApproxLakhs(
              parseNumber(financials.totalCreditPurchase)
            );
          },
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
        <Card className="hover:animate-shadow-drop-center max-md:w-full my-2 w-[60%]">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">
              Total Projects
            </CardTitle>
            <HardHat className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="flex justify-between items-center">
            <div className="text-2xl font-bold">
              {listIsLoading ? (
                <TailSpin
                  visible={true}
                  height="30"
                  width="30"
                  color="#D03B45"
                  ariaLabel="tail-spin-loading"
                  radius="1"
                  wrapperStyle={{}}
                  wrapperClass=""
                />
              ) : (
                all_projects_count
              )}
            </div>
            <div className="flex flex-col gap-1 text-xs font-semibold">
              {statusCounts.map((item, index) => (
                <div
                  key={`${item.value}_${index}`}
                  className={`min-w-[100px] flex items-center justify-between px-2 py-0.5 ${getColor(
                    item.value
                  )} rounded-md`}
                >
                  <span className="">{item.label}</span>
                  <i>{item.count ?? 0}</i>
                </div>
              ))}
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
            exportFileName="Projects_Report"
          />
        )}
      </div>
    </div>
  );
};

export default Projects;
