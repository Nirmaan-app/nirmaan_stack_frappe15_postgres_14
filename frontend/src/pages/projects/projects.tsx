import React, { useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, useFrappeGetDocCount, useFrappePostCall } from "frappe-react-sdk";
import memoize from 'lodash/memoize';
import { CircleCheckBig, CirclePlus, HardHat, OctagonMinus } from "lucide-react";
import { TailSpin } from "react-loader-spinner";

// --- UI Components ---
import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/skeleton";

// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { getTotalInflowAmount, getPOSTotals, getPOTotal, getSRTotal, getTotalAmountPaid, getTotalExpensePaid } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";

// --- Types ---
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { ProjectTypes } from "@/types/NirmaanStack/ProjectTypes";

// --- Config ---
import {
  DEFAULT_PROJECT_FIELDS_TO_FETCH,
  PROJECT_SEARCHABLE_FIELDS,
  PROJECT_DATE_COLUMNS,
  getProjectStaticFilters
} from './config/projectTable.config';
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses";
import { useCredits } from "../credits/hooks/useCredits";
// --- Constants ---
const DOCTYPE = 'Projects';

interface ProjectsProps {
  customersView?: boolean; // To hide summary card
  customerId?: string;    // To filter projects by customer
  urlContext?: string;    // For unique URL state if multiple instances
}

// ProcessedProject type for the table, including calculated financials
export interface ProcessedProjectForTable extends ProjectsType {
  calculatedTotalInvoiced: number;
  calculatedTotalInflow: number;
  calculatedTotalOutflow: number;
  relatedTotalBalanceCredit: number;
  relatedTotalDue: number;
  // prStatusCounts?: Record<string, number>; // For the status count badge display
}

interface ProjectStatusCount {
  label: string;
  value: string;
  count: number | undefined;
  isLoading: boolean;
}

// --- Component ---
export const Projects: React.FC<ProjectsProps> = ({
  customersView = false,
  customerId,
  urlContext = "main" // Default context for URL key
}) => {
  const urlSyncKey = useMemo(() => `projects_list_${urlContext}${customerId ? `_cust_${customerId}` : ''}`, [urlContext, customerId]);

  const [statusCounts, setStatusCounts] = useState<ProjectStatusCount[]>([]);

  const { call } = useFrappePostCall("frappe.client.get_count")

  const { data: all_projects_count } = useFrappeGetDocCount("Projects",
    undefined,
    true, false, "all_projects_count")

  const statusOptions = useMemo(() => ["Created", "WIP", "Completed", "Halted"].map(s => ({ label: s, value: s })), []); // Example static status options

  const getColor = useMemo(() => (status: string) => {
    switch (status) {
      case "Created": return "bg-blue-100";
      case "WIP": return "bg-yellow-100";
      case "Completed": return "bg-green-100";
      case "Halted": return "bg-red-100";
      default: return "bg-blue-100";
    }
  }, [])

  useEffect(() => {
    const fetchCounts = async () => {
      const countsPromises = statusOptions.map(status =>
        call({
          doctype: DOCTYPE,
          filters: { status: status.value },
          cache: true
        },
        ).then(res => ({
          ...status,
          count: res.message,
          isLoading: false,
        })).catch(() => ({
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

  // --- Supporting Data Fetches (for calculations in columns) ---
  // These fetch broader data sets, then we'll map them to projects client-side.
  const { data: projectTypesList, isLoading: projectTypesLoading, error: projectTypesError } = useFrappeGetDocList<ProjectTypes>(
    "Project Types", { fields: ["name"], limit: 1000 }, "ProjectTypes_For_ProjectsList"
  );


  // const { data: prData, isLoading: prDataLoading, error: prDataError } = useFrappeGetDocList<ProcurementRequest>(
  //     "Procurement Requests", { fields: ["name", "project", "workflow_state", "procurement_list"], limit: 100000 }, "PRs_For_ProjectsList" // Fetch all for counts
  // );

  const { data: CreditData } = useCredits()


  // console.log("CreditData", CreditData);

  const { data: poData, isLoading: poDataLoading, error: poDataError } = useFrappeGetDocList<ProcurementOrder>(
    "Procurement Orders", { fields: ["name", "project", "status", "amount", "tax_amount", "total_amount", "invoice_data", "amount_paid", "po_amount_delivered"], filters: [["status", "not in", ["Merged", "Inactive", "PO Amendment"]],], limit: 100000 }, "POs_For_ProjectsList"
  );




  const { data: srData, isLoading: srDataLoading, error: srDataError } = useFrappeGetDocList<ServiceRequests>(
    "Service Requests", { fields: ["name", "project", "status", "service_order_list", "gst"], filters: [["status", "=", "Approved"]], limit: 100000 }, "SRs_For_ProjectsList"
  );
  const { data: projectInflows, isLoading: projectInflowsLoading, error: projectInflowsError } = useFrappeGetDocList<ProjectInflows>(
    "Project Inflows", { fields: ["project", "amount"], limit: 100000 }, "Inflows_For_ProjectsList"
  );
  const { data: projectPayments, isLoading: projectPaymentsLoading, error: projectPaymentsError } = useFrappeGetDocList<ProjectPayments>(
    "Project Payments", { fields: ["project", "amount", "status"], filters: [["status", "=", "Paid"]], limit: 100000 }, "Payments_For_ProjectsList"
  );
  const { data: projectExpenses, isLoading: projectExpensesLoading, error: projectExpensesError } = useFrappeGetDocList<ProjectExpenses>(
    "Project Expenses", { fields: ["projects", "amount"], limit: 100000 }, "ProjectExpenses_For_ProjectsList"
  );

  // --- Memoized Lookups & Pre-processing for Column Calculations ---
  const projectTypeOptions = useMemo(() => projectTypesList?.map(pt => ({ label: pt.name, value: pt.name })) || [], [projectTypesList]);

  const getProjectFinancials = useMemo(() => {
    if (!poData || !srData || !projectInflows || !projectPayments || !projectExpenses || !CreditData) return () => ({ calculatedTotalInvoiced: 0, calculatedTotalInflow: 0, calculatedTotalOutflow: 0, relatedTotalBalanceCredit: 0, relatedTotalCreditPaid: 0, totalLiabilities: 0 });

    // Pre-group data for efficiency
    const posByProject = memoize((projId: string) => poData.filter(po => po.project === projId));
    const srsByProject = memoize((projId: string) => srData.filter(sr => sr.project === projId));
    const inflowsByProject = memoize((projId: string) => projectInflows.filter(pi => pi.project === projId));
    const paymentsByProject = memoize((projId: string) => projectPayments.filter(pp => pp.project === projId));
    const expensesByProject = memoize((projId: string) => projectExpenses.filter(pe => pe.projects === projId));
    const creditsByProject = memoize((projId: string) => CreditData.filter(cr => cr.project == projId));
    const dueByProject = memoize((projId: string) => CreditData.filter(cr => cr.project == projId && cr.term_status == "Paid"));

    return memoize((projectId: string) => {
      // console.log("projectId",projectId);
      const relatedPOs = posByProject(projectId);
      const relatedSRs = srsByProject(projectId);
      const relatedInflows = inflowsByProject(projectId);
      const relatedPayments = paymentsByProject(projectId);
      const relatedExpenses = expensesByProject(projectId);
      const relatedTotalBalanceCredit = creditsByProject(projectId).reduce((sum, term) => sum + parseNumber(term.amount), 0);
      const relatedTotalCreditPaid = dueByProject(projectId).reduce((sum, term) => sum + parseNumber(term.amount), 0);

      // let totalInvoiced = 0;

      // console.log("DueByProject",relatedTotalBalanceCredit,relatedTotalDue);


      // relatedPOs.forEach(po => totalInvoiced += getPOTotal(po)?.totalAmt || 0);
      let totalInvoiced = getPOSTotals(relatedPOs)?.totalWithTax || 0;
      // console.log("totalInvoiced",totalInvoiced)

      relatedSRs.forEach(sr => {
        const srVal = getSRTotal(sr); // Assuming getSRTotal returns value without GST
        totalInvoiced += sr.gst === "true" ? srVal * 1.18 : srVal;
      });
      // console.log("realatedPOSR", totalInvoiced);

      const totalInflow = getTotalInflowAmount(relatedInflows);
      const totalOutflow = getTotalAmountPaid(relatedPayments) + getTotalExpensePaid(relatedExpenses); // Already filtered for "Paid"

      // Calculate Total Liabilities (Payable Amount Against Delivered - Amount Paid Against Delivered)
      const totalPayableAgainstDelivered = relatedPOs.reduce((sum, po) => sum + parseNumber(po.po_amount_delivered || 0), 0);
      const totalPaidAgainstDelivered = relatedPOs.reduce((sum, po) => {
        const amountPaid = parseNumber(po.amount_paid || 0);
        const poAmountDelivered = parseNumber(po.po_amount_delivered || 0);
        return sum + Math.min(amountPaid, poAmountDelivered);
      }, 0);
      const totalLiabilities = totalPayableAgainstDelivered - totalPaidAgainstDelivered;

      return {
        calculatedTotalInvoiced: totalInvoiced,
        calculatedTotalInflow: totalInflow,
        calculatedTotalOutflow: totalOutflow,
        relatedTotalBalanceCredit,
        relatedTotalCreditPaid,
        totalLiabilities
      };
    });
  }, [poData, srData, projectInflows, projectPayments, projectExpenses, CreditData]);


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
  const columns = useMemo<ColumnDef<ProjectsType>[]>(() => [
    {
      accessorKey: "name", header: "ID",
      cell: ({ row }) => <Link to={`/projects/${row.original.name}`} className="text-blue-600 hover:underline font-medium">{row.original.name?.slice(-5)}</Link>,
      size: 100,
      meta: {
        exportHeaderName: "Project ID",
      }
    },
    {
      accessorKey: "project_name", header: "Project Name",
      cell: ({ row }) => <Link to={`/projects/${row.original.name}`} className="text-blue-600 hover:underline font-medium">{row.original.project_name || row.original.name}</Link>,
      size: 200,
    },
    {
      accessorKey: "creation", header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
      cell: ({ row }) => formatDate(row.original.creation),
      meta: {
        exportHeaderName: "Project Creation Date",
      }
    },
    {
      accessorKey: "status", header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <Badge variant={row.original.status === "Completed" ? "default" : (row.original.status === "Halted" ? "destructive" : "secondary")}>{row.original.status}</Badge>,
      enableColumnFilter: true,
    },
    {
      accessorKey: "project_type", header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
      cell: ({ row }) => <div>{row.original.project_type || "--"}</div>,
      enableColumnFilter: true,
      meta: {
        exportHeaderName: "Project Type",
      }
    },
    {
      id: "location", header: "Location",
      accessorFn: row => `${row.project_city || ''}, ${row.project_state || ''}`.replace(/^, |, $/g, ''), // Clean leading/trailing commas
      meta: {
        exportHeaderName: "Project Location",
        exportValue: (row) => `${row.project_city || ''}, ${row.project_state || ''}`.replace(/^, |, $/g, ''), // Clean leading/trailing commas
      }
    },
    // {
    //     id: "pr_status_counts", header: "PR Status",
    //     cell: ({ row }) => {
    //         const counts = row.original.prStatusCounts;
    //         return (
    //             <div className="font-medium flex flex-col gap-1 text-xs">
    //                 {counts && Object.entries(counts).map(([status, count]) => (
    //                     count > 0 && <Badge key={status} variant={status === "New PR" ? "default" : (status === "Open PR" ? "warning" : "success")} className="flex justify-between w-full max-w-[120px]"><span>{status}:</span> <span>{count}</span></Badge>
    //                 ))}
    //             </div>
    //         );
    //     },
    // },

    // Remove the existing "project_financials" column and replace with these six columns:

    {
      accessorKey: "project_value", header: "Value (excl.GST)",
      cell: ({ row }) => (<span className="tabular-nums">{formatToRoundedIndianRupee(row.original.project_value / 100000)} L</span>),
      size: 100,
      meta: {
        exportHeaderName: "Value ",
      }
    },
    {
      id: "po_amount",
      header: ({ column }) => <DataTableColumnHeader column={column} title="PO Amount (incl.GST)" />,
      cell: ({ row }) => {
        const financials = getProjectFinancials(row.original.name);
        return (
          <span className="tabular-nums">
            {formatToRoundedIndianRupee(financials.calculatedTotalInvoiced / 100000)} L
          </span>
        );
      },
      size: 100,
      meta: {
        exportHeaderName: "PO Amount (Lakhs)",
        exportValue: (row) => {
          const financials = getProjectFinancials(row.name);
          return formatToRoundedIndianRupee(financials.calculatedTotalInvoiced / 100000) + " L";
        }
      }
    },
    {
      id: "inflow",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Inflow" />,
      cell: ({ row }) => {
        const financials = getProjectFinancials(row.original.name);
        return (
          <span className="text-green-600 tabular-nums">
            {formatToRoundedIndianRupee(financials.calculatedTotalInflow / 100000)} L
          </span>
        );
      },
      size: 100,
      meta: {
        exportHeaderName: "Inflow (Lakhs)",
        exportValue: (row) => {
          const financials = getProjectFinancials(row.name);
          return formatToRoundedIndianRupee(financials.calculatedTotalInflow / 100000) + " L";
        }
      }
    },
    {
      id: "outflow",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Outflow (PO+SR)" />,
      cell: ({ row }) => {
        const financials = getProjectFinancials(row.original.name);
        return (
          <span className="text-red-600 tabular-nums">
            {formatToRoundedIndianRupee(financials.calculatedTotalOutflow / 100000)} L
          </span>
        );
      },
      size: 100,
      meta: {
        exportHeaderName: "Outflow (Lakhs)",
        exportValue: (row) => {
          const financials = getProjectFinancials(row.name);
          return formatToRoundedIndianRupee(financials.calculatedTotalOutflow / 100000) + " L";
        }
      }
    },

    {
      id: "total_liabilities",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total Liabilities" />,
      cell: ({ row }) => {
        const financials = getProjectFinancials(row.original.name);
        return (
          <span className="text-red-600 tabular-nums">
            {formatToRoundedIndianRupee(financials.totalLiabilities / 100000)} L
          </span>
        );
      },
      size: 100,
      meta: {
        exportHeaderName: "Total Liabilities",
        exportValue: (row) => {
          const financials = getProjectFinancials(row.name);
          return formatToRoundedIndianRupee(financials.totalLiabilities / 100000) + " L";
        }
      }
    },
    {
      id: "TotalCreditAmt",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total Purchase Over Credit" />,
      cell: ({ row }) => {
        const financials = getProjectFinancials(row.original.name);
        return (
          <span className="tabular-nums">
            {formatToRoundedIndianRupee(parseNumber(financials.relatedTotalBalanceCredit) / 100000)} L
          </span>
        );
      },
      size: 100,
      meta: {
        exportHeaderName: "Total Purchase Over Credit",
        exportValue: (row) => {
          const financials = getProjectFinancials(row.name);
          return formatToRoundedIndianRupee(parseNumber(financials.relatedTotalBalanceCredit) / 100000) + " L";
        }
      }
    },
    // {
    //   id: "creditAmtPaid",
    //   header: ({ column }) => <DataTableColumnHeader column={column} title="Total Credit Amt Paid" />,
    //   cell: ({ row }) => {
    //     const financials = getProjectFinancials(row.original.name);
    //     return (
    //       <span className="tabular-nums">
    //         {formatToRoundedIndianRupee(parseNumber(financials.relatedTotalCreditPaid) / 100000)} L
    //       </span>
    //     );
    //   },
    //   size: 100,
    //   meta: {
    //     exportHeaderName: "Total Credit Amt Paid",
    //     exportValue: (row) => {
    //       const financials = getProjectFinancials(row.name);
    //       return formatToRoundedIndianRupee(parseNumber(financials.relatedTotalCreditPaid) / 100000) + " L";
    //     }
    //   }
    // }
    //    {
    //    id: "Value", // Unique ID
    //    header: "Value of Project",
    //    cell: ({ row }) => {
    //      const financials = getProjectFinancials(row.original.name);
    //      return (
    //        <div className="font-medium flex flex-col gap-1 text-xs min-w-[120px]">
    //         <div className="flex justify-between"><span>Value (excl. GST):</span> <span className="tabular-nums">{formatToRoundedIndianRupee(parseNumber(row.original.project_value) / 100000)} L</span></div>
    //            <div className="flex justify-between"><span>PO Amt:</span> <span className="tabular-nums">{formatToRoundedIndianRupee(financials.calculatedTotalInvoiced / 100000)} L</span></div>

    //        </div>
    //      );
    //    },
    //    size: 150, // Adjust size as needed
    //    meta: {
    //      excludeFromExport: true
    //    }
    //  },
    //   {
    //    id: "project_flow_amounts_col", // Unique ID
    //    header: "Flow Amounts (Lakhs)",
    //    cell: ({ row }) => {
    //      const financials = getProjectFinancials(row.original.name);
    //      return (
    //        <div className="font-medium flex flex-col gap-1 text-xs min-w-[120px]">

    //          <div className="flex justify-between">
    //            <span>Inflow:</span> <span className="text-green-600 tabular-nums">{formatToRoundedIndianRupee(financials.calculatedTotalInflow / 100000)} L</span>
    //          </div>
    //          <div className="flex justify-between">
    //            <span>Outflow:</span> <span className="text-red-600 tabular-nums">{formatToRoundedIndianRupee(financials.calculatedTotalOutflow / 100000)} L</span>
    //          </div>
    //        </div>
    //      );
    //    },
    //    size: 150, // Adjust size as needed
    //    meta: {
    //      excludeFromExport: true
    //    }
    //  },
    //  {
    //    id: "project_liabilities_due_col", // Unique ID
    //    header: "Liabilities & Due (Lakhs)",
    //    cell: ({ row }) => {
    //      const financials = getProjectFinancials(row.original.name);
    //      return (
    //        <div className="font-medium flex flex-col gap-1 text-xs min-w-[120px]">
    //          <div className="flex justify-between">
    //            <span>Total Liabilities:</span> <span className="tabular-nums">{formatToRoundedIndianRupee(parseNumber(financials.relatedTotalBalanceCredit) / 100000)} L</span>
    //          </div>
    //          <div className="flex justify-between">
    //            <span>Total Due Not Paid:</span> <span className="tabular-nums">{formatToRoundedIndianRupee(parseNumber(financials.relatedTotalDue) / 100000)} L</span>
    //          </div>
    //        </div>
    //      );
    //    },
    //    size: 170, // Adjust size as needed
    //    meta: {
    //      excludeFromExport: true
    //    }
    //  },
    // {
    //   id: "project_financials", header: "Financials (Lakhs)",
    //   cell: ({ row }) => {
    //     const financials = getProjectFinancials(row.original.name); // Calculate for current project row
    //     // console.log("financials", row.original.name);
    //     return (
    //       <div className="font-medium flex flex-col gap-1 text-xs min-w-[180px]">
    //         <div className="flex justify-between"><span>Value (excl. GST):</span> <span className="tabular-nums">{formatToRoundedIndianRupee(parseNumber(row.original.project_value) / 100000)} L</span></div>
    //         <div className="flex justify-between"><span>PO Amt:</span> <span className="tabular-nums">{formatToRoundedIndianRupee(financials.calculatedTotalInvoiced / 100000)} L</span></div>
    //         <div className="flex justify-between"><span>Inflow:</span> <span className="text-green-600 tabular-nums">{formatToRoundedIndianRupee(financials.calculatedTotalInflow / 100000)} L</span></div>
    //         <div className="flex justify-between"><span>Outflow:</span> <span className="text-red-600 tabular-nums">{formatToRoundedIndianRupee(financials.calculatedTotalOutflow / 100000)} L</span></div>
    //         <div className="flex justify-between"><span>Total Liabilities:</span> <span className="tabular-nums">{formatToRoundedIndianRupee(parseNumber(financials.relatedTotalBalanceCredit) / 100000)} L</span></div>
    //         <div className="flex justify-between"><span>Total Due Not Paid:</span> <span className="tabular-nums">{formatToRoundedIndianRupee(parseNumber(financials.relatedTotalDue) / 100000)} L</span></div>
    //       </div>
    //     );
    //   },
    //   size: 200,
    //   meta: {
    //     excludeFromExport: true
    //   }
    // },
  ], [getProjectFinancials,
    // processedTableData
    // prStatusCountsByProject
  ]); // Dependencies for columns


  // --- Static Filters for `useServerDataTable` ---
  const staticFilters = useMemo(() => getProjectStaticFilters(customerId), [customerId]);

  // --- useServerDataTable Hook for the main Projects list ---
  const {
    table, data: projectsDataForTable, totalCount, isLoading: listIsLoading, error: listError,
    searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
    isRowSelectionActive, refetch,
  } = useServerDataTable<ProjectsType>({ // Fetches ProjectsType
    doctype: DOCTYPE,
    columns: columns, // Columns defined below and passed to DataTable component
    fetchFields: DEFAULT_PROJECT_FIELDS_TO_FETCH,
    searchableFields: PROJECT_SEARCHABLE_FIELDS,
    urlSyncKey: urlSyncKey,
    defaultSort: 'creation desc',
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



  // --- Faceted Filter Options ---
  const facetFilterOptions = useMemo(() => ({
    status: { title: "Status", options: statusOptions },
    project_type: { title: "Project Type", options: projectTypeOptions },
    // customer: { title: "Customer", options: customerOptions }, // If customer is a direct field on Project and searchable
  }), [statusOptions, projectTypeOptions]);

  // --- Combined Loading & Error States ---
  const isLoadingOverall = poDataLoading || srDataLoading || projectInflowsLoading || projectPaymentsLoading || projectExpensesLoading || projectTypesLoading;

  const combinedErrorOverall = poDataError || srDataError || projectInflowsError || projectPaymentsError || projectExpensesError || projectTypesError || listError;

  if (combinedErrorOverall && !projectsDataForTable?.length) {
    // Display prominent error from data fetching/processing
    return (
      <AlertDestructive error={combinedErrorOverall} />
    );
  }

  return (
    <div className="flex-1 space-y-4">
      {!customersView && (
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
                <div key={`${item.value}_${index}`} className={`min-w-[100px] flex items-center justify-between px-2 py-0.5 ${getColor(item.value)} rounded-md`}>
                  <span className="">{item.label}</span>
                  <i>{item.count ?? 0}</i>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
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
          onExport={'default'}
          exportFileName="Projects_Report"
        />
      )}
    </div>
  );
};

export default Projects;