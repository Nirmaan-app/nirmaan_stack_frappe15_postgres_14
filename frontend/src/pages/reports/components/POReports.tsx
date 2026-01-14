import { useMemo, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/data-table/new-data-table";
import { POReportRowData, usePOReportsData } from "../hooks/usePOReportsData";
import { getPOReportColumns } from "./columns/poColumns";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { POReportOption, useReportStore } from "../store/useReportStore";
import { parseNumber } from "@/utils/parseNumber";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { useVendorsList } from "@/pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { Projects } from "@/types/NirmaanStack/Projects";
import {
  FrappeDoc,
  GetDocListArgs,
  useFrappeGetDocList,
} from "frappe-react-sdk";
import { differenceInDays, parseISO, startOfToday } from "date-fns";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import {
  PO_REPORTS_SEARCHABLE_FIELDS,
  PO_REPORTS_DATE_COLUMNS,
} from "../config/poReportsTable.config";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "@/components/ui/use-toast";
import { exportToCsv } from "@/utils/exportToCsv";
import { formatDate } from "@/utils/FormatDate";
import {
  formatForReport,
  formatToRoundedIndianRupee,
} from "@/utils/FormatPrice";
import { format } from "path";
import { useUserData } from "@/hooks/useUserData";
import { late } from "zod";
import PO2BReconcileReport from "./PO2BReconcileReport";
import POAttachmentReconcileReport from "./POAttachmentReconcileReport";

interface SelectOption {
  label: string;
  value: string;
}

export default function POReports() {
  const { role } = useUserData();
  // 1. Fetch the superset of data. `usePOReportsData` should return POReportRowData[]
  // which already contains calculated totalAmount, invoiceAmount, amountPaid, and originalDoc.
  const {
    reportData: allPOsForReports, // This is POReportRowData[] | null
    isLoading: isLoadingInitialData,
    error: initialDataError,
  } = usePOReportsData();

  const selectedReportType = useReportStore(
    (state) => state.selectedReportType as POReportOption | null
  );

  // 2. Dynamically determine columns based on selectedReportType
  const tableColumnsToDisplay = useMemo(
    () => getPOReportColumns(selectedReportType, role),
    [selectedReportType]
  );
  const payment_delta = 100;
  const invoice_delta = 100;

  // 3. Perform the report-specific dynamic filtering on the client side.
  // This `currentDisplayData` is what will be shown in the table.
  const currentDisplayData = useMemo(() => {
    if (!allPOsForReports) {
      // console.log("POReports: No initial data (allPOsForReports is null/undefined)");
      return [];
    }
    if (
      !selectedReportType ||
      ![
        "Pending Invoices",
        "PO with Excess Payments",
        "Dispatched for 1 days",
      ].includes(selectedReportType)
    ) {
      // console.log(`POReports: Invalid or non-PO report type selected: ${selectedReportType}`);
      return [];
    }

    // console.log(`POReports: Filtering for report type: ${selectedReportType} with ${allPOsForReports.length} initial items.`);
    const today = startOfToday();
    let filtered: POReportRowData[];

    switch (selectedReportType) {
      case "Pending Invoices":
        filtered = allPOsForReports.filter((row) => {
          const poDoc = row.originalDoc;

          if (
            poDoc.status === "Partially Delivered" ||
            poDoc.status === "Delivered"
          ) {
            return (
              parseNumber(poDoc.amount_paid) - parseNumber(row.invoiceAmount) >=
              invoice_delta
            );
          }
          return false;
        });
        break;
      case "PO with Excess Payments":
        filtered = allPOsForReports.filter((row) => {
          const poDoc = row.originalDoc;
          if (
            poDoc.status === "Partially Delivered" ||
            poDoc.status === "Delivered"
          ) {
            return (
              parseNumber(row.amountPaid) >
              parseNumber(row.totalAmount) + payment_delta
            );
          }
          return false;
        });
        break;
      case "Dispatched for 1 days":
        filtered = allPOsForReports.filter((row) => {
          const poDoc = row.originalDoc;

          // 1. Guard against missing or invalid data
          if (poDoc.status !== "Dispatched" || !poDoc.dispatch_date) {
            return false;
          }

          try {
            const dispatchDate = parseISO(poDoc.dispatch_date);

            // This check prevents errors if parseISO results in an invalid date
            if (isNaN(dispatchDate.getTime())) {
              return false;
            }

            // 2. The corrected logic using ">="
            const dayDifference = differenceInDays(today, dispatchDate);
            // console.log(`PO ${poDoc.name} dispatched on ${poDoc.dispatch_date}, dayDifference: ${dayDifference}`);
            // CHANGE: DISPATCHED FOR 1+ DAYS
            return dayDifference >= 1;
          } catch (e) {
            // This will catch any unexpected errors during date parsing
            console.error(
              `Could not parse dispatch_date: ${poDoc.dispatch_date}`,
              e
            );
            return false;
          }
        });
        break;
      default:
        filtered = []; // Should not reach here due to initial check
    }
    return filtered;
  }, [allPOsForReports, selectedReportType, payment_delta, invoice_delta]);

  // 4. Initialize useServerDataTable in clientData mode

  const {
    table,
    isLoading: isTableHookLoading,
    error: tableHookError,
    totalCount, // This will be currentDisplayData.length
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
  } = useServerDataTable<POReportRowData>({
    doctype: `POReportsClientFilteredVirtual_${selectedReportType || "none"}`, // Unique virtual doctype per report
    columns: tableColumnsToDisplay,
    fetchFields: [], // Not used in clientData mode
    searchableFields: PO_REPORTS_SEARCHABLE_FIELDS,
    clientData: currentDisplayData,
    clientTotalCount: currentDisplayData.length,
    urlSyncKey: `po_reports_table_client_${
      selectedReportType?.toString().replace(/\s+/g, "_") || "all"
    }`,
    defaultSort:
      selectedReportType === "Dispatched for 1 days"
        ? "originalDoc.dispatch_date asc"
        : "creation desc",
    enableRowSelection: false,
    // No `meta` needed here as POReportRowData contains all display fields,
    // and poColumns directly accesses them.
  });
  const fullyFilteredData = table
    .getFilteredRowModel()
    .rows.map((row) => row.original);

  const filteredRowCount = table.getFilteredRowModel().rows.length;
  // This effect synchronizes the table's pageCount with the client-side filtered data.
  useEffect(() => {
    const { pageSize } = table.getState().pagination;
    const newPageCount =
      pageSize > 0 ? Math.ceil(filteredRowCount / pageSize) : 1;

    // Prevent infinite loops by only setting options if the page count has changed.
    if (table.getPageCount() !== newPageCount) {
      table.setOptions((prev) => ({
        ...prev,
        pageCount: newPageCount,
      }));
    }
  }, [table, filteredRowCount]); // Rerun when the table instance or filtered data count changes
  // =================================================================================
  // Supporting data for faceted filters (Projects & Vendors)
  const projectsFetchOptions = getProjectListOptions();
  const {
    data: projects,
    isLoading: projectsUiLoading,
    error: projectsUiError,
  } = useFrappeGetDocList<Projects>(
    "Projects",
    projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>,
    queryKeys.projects.list(projectsFetchOptions)
  );
  const {
    data: vendors,
    isLoading: vendorsUiLoading,
    error: vendorsUiError,
  } = useVendorsList({
    vendorTypes: ["Service", "Material", "Material & Service"],
  });

  // Ensure `value` in facet options matches the data in POReportRowData's `projectName` and `vendorName`
  const projectFacetOptions = useMemo<SelectOption[]>(
    () =>
      projects?.map((p) => ({
        label: p.project_name,
        value: p.project_name,
      })) || [],
    [projects]
  );
  const vendorFacetOptions = useMemo<SelectOption[]>(
    () =>
      vendors?.map((v) => ({ label: v.vendor_name, value: v.vendor_name })) ||
      [],
    [vendors]
  );

  const facetOptionsConfig = useMemo(
    () => ({
      project_name: { title: "Project", options: projectFacetOptions },
      vendor_name: { title: "Vendor", options: vendorFacetOptions },
    }),
    [projectFacetOptions, vendorFacetOptions]
  );

  const exportFileName = useMemo(() => {
    const prefix = "po_report";
    return `${prefix}${
      selectedReportType ? `_${selectedReportType.replace(/\s+/g, "_")}` : ""
    }`;
  }, [selectedReportType]);

  const handleCustomExport = useCallback(() => {
    if (!fullyFilteredData || fullyFilteredData.length === 0) {
      toast({
        title: "Export",
        description:
          "No data available to export for the selected report type.",
        variant: "default",
      });
      return;
    }
    const dataToExport = fullyFilteredData.map((row) => ({
      po_id: row.name,
      creation: formatDate(row.creation),
      project_name: row.projectName || row.project,
      vendor_name: row.vendorName || row.vendor,
      total_po_amt: formatForReport(row.totalAmount),
      total_invoice_amt: formatForReport(row.invoiceAmount),
      amt_paid: formatForReport(row.amountPaid),
      dispatch_date: row.originalDoc.dispatch_date
        ? formatDate(row.originalDoc.dispatch_date)
        : "N/A",
      latest_delivery_date: row.originalDoc.latest_delivery_date
        ? formatDate(row.originalDoc.latest_delivery_date)
        : "N/A",
      latest_payment_date: row.originalDoc.latest_payment_date
        ? formatDate(row.originalDoc.latest_payment_date)
        : "N/A",
      status: row.originalDoc.status,
    }));

    const exportColumnsConfig: ColumnDef<any, any>[] = [
      { header: "#PO", accessorKey: "po_id" },
      { header: "Date Created", accessorKey: "creation" },
      { header: "Project", accessorKey: "project_name" },
      { header: "Vendor", accessorKey: "vendor_name" },
      { header: "Total PO Amt", accessorKey: "total_po_amt" }, // Matches export data key
      { header: "Total Invoice Amt", accessorKey: "total_invoice_amt" },
      { header: "Amt Paid", accessorKey: "amt_paid" },
      { header: "PO Status", accessorKey: "status" }, // Moved before conditional dispatch date
      { header: "Latest Delivery Date", accessorKey: "latest_delivery_date" },
      { header: "Latest Payment Date", accessorKey: "latest_payment_date" },
    ];
    if (selectedReportType === "Dispatched for 1 days") {
      exportColumnsConfig.push({
        header: "Dispatched Date",
        accessorKey: "dispatch_date",
      });
    }

    try {
      exportToCsv(exportFileName, dataToExport, exportColumnsConfig);
      toast({
        title: "Export Successful",
        description: `${dataToExport.length} rows exported.`,
        variant: "success",
      });
    } catch (e) {
      console.error("Export failed:", e);
      toast({
        title: "Export Error",
        description: "Could not generate CSV file.",
        variant: "destructive",
      });
    }
  }, [fullyFilteredData, exportFileName, selectedReportType]);

  const isLoadingOverall =
    isLoadingInitialData ||
    projectsUiLoading ||
    vendorsUiLoading ||
    isTableHookLoading;
  const overallError =
    initialDataError || projectsUiError || vendorsUiError || tableHookError;

  // If 2B Reconcile Report is selected, render the dedicated component
  if (selectedReportType === '2B Reconcile Report') {
    return <PO2BReconcileReport />;
  }

  // If PO Attachment Reconciliation Report is selected, render the dedicated component
  if (selectedReportType === 'PO Attachment Reconciliation Report') {
    return <POAttachmentReconcileReport />;
  }

  if (overallError) {
    return <AlertDestructive error={overallError as Error} />;
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 overflow-hidden",
        totalCount > 10
          ? "h-[calc(100vh-130px)]"
          : totalCount > 0
          ? "h-auto"
          : ""
      )}
    >
      {isLoadingInitialData && !allPOsForReports ? (
        <LoadingFallback />
      ) : (
        <DataTable<POReportRowData>
          table={table}
          columns={tableColumnsToDisplay}
          isLoading={isLoadingOverall}
          error={overallError as Error | null}
          // totalCount={totalCount} // From useServerDataTable, now reflects currentDisplayData.length
          totalCount={filteredRowCount}
          searchFieldOptions={PO_REPORTS_SEARCHABLE_FIELDS}
          selectedSearchField={selectedSearchField}
          onSelectedSearchFieldChange={setSelectedSearchField}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          facetFilterOptions={facetOptionsConfig}
          dateFilterColumns={PO_REPORTS_DATE_COLUMNS}
          showExportButton={true}
          onExport={handleCustomExport}
          exportFileName={exportFileName}
          showRowSelection={false}
        />
      )}
    </div>
  );
}
