import { useCallback, useMemo } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import { DataTable } from "@/components/data-table/new-data-table";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";

import { useServerDataTable } from "@/hooks/useServerDataTable";
import type { SearchFieldOption } from "@/components/data-table/new-data-table";

import type { ITMListRow } from "@/pages/InternalTransferMemos/config/itmList.config";
import { formatDate } from "@/utils/FormatDate";
import { formatForReport } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { exportToCsv } from "@/utils/exportToCsv";
import { toast } from "@/components/ui/use-toast";

import { itmDispatchedColumns } from "./columns/itmDispatchedColumns";
import { cn } from "@/lib/utils";

/**
 * "Dispatched (ITM)" report — every ITM currently in ``status =
 * "Dispatched"``. No day-threshold: as soon as an ITM is dispatched it
 * shows here, and as soon as any DN is filed (status flips to
 * ``Partially Delivered``) it drops off.
 */

const ITM_LIST_ENDPOINT =
  "nirmaan_stack.api.internal_transfers.get_itms_list.get_itms_list";

const ITM_DISPATCHED_SEARCHABLE_FIELDS: SearchFieldOption[] = [
  {
    value: "name",
    label: "ITM ID / From / To",
    placeholder: "Search by ITM ID or project name...",
    default: true,
  },
];

const ITM_DISPATCHED_DATE_COLUMNS: string[] = ["dispatched_on"];

interface ITMListResponse {
  message: {
    data: ITMListRow[];
    total_count: number;
  };
}

export default function ITMDispatchedReport() {
  // Fetch every ITM currently in `Dispatched` status. Server filter does
  // all the work — no client-side date threshold.
  //
  // NOTE: ``limit_page_length: 0`` doesn't mean "no limit" on the backend —
  // it gets serialised as the string "0" which is Python-truthy, so the
  // backend's ``cint(limit_page_length or DEFAULT)`` falls through to
  // ``cint("0") = 0`` and you get LIMIT 0 (empty result). Pass an explicit
  // large cap instead (matches ``MAX_PAGE_LENGTH``).
  const { data, isLoading, error } = useFrappeGetCall<ITMListResponse>(
    ITM_LIST_ENDPOINT,
    {
      filters: JSON.stringify([["status", "=", "Dispatched"]]),
      order_by: "dispatched_on asc",
      limit_page_length: 10000,
    }
  );

  const currentDisplayData: ITMListRow[] = useMemo(
    () => data?.message?.data || [],
    [data]
  );

  // 3. Wire useServerDataTable in clientData mode (mirrors POReports).
  const {
    table,
    isLoading: isTableHookLoading,
    error: tableHookError,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
    exportAllRows,
    isExporting,
  } = useServerDataTable<ITMListRow>({
    doctype: "ITMDispatchedReportClientFilteredVirtual",
    columns: itmDispatchedColumns,
    fetchFields: [],
    searchableFields: ITM_DISPATCHED_SEARCHABLE_FIELDS,
    clientData: currentDisplayData,
    clientTotalCount: currentDisplayData.length,
    urlSyncKey: "itm_dispatched_report_table",
    defaultSort: "dispatched_on asc",
    enableRowSelection: false,
  });

  const filteredRowCount = table.getFilteredRowModel().rows.length;

  // 4. Facets for From / To project columns.
  const fromFacetOptions = useMemo(() => {
    const counts: Record<string, number> = {};
    currentDisplayData.forEach((row) => {
      const val = row.source_type === "Warehouse"
        ? "Warehouse"
        : (row.source_project_name || row.source_project || "");
      if (val) counts[val] = (counts[val] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([val, count]) => ({ label: `${val} (${count})`, value: val }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [currentDisplayData]);

  const toFacetOptions = useMemo(() => {
    const counts: Record<string, number> = {};
    currentDisplayData.forEach((row) => {
      const val = row.target_type === "Warehouse"
        ? "Warehouse"
        : (row.target_project_name || row.target_project || "");
      if (val) counts[val] = (counts[val] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([val, count]) => ({ label: `${val} (${count})`, value: val }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [currentDisplayData]);

  const facetOptionsConfig = useMemo(
    () => ({
      source_project_name: { title: "From", options: fromFacetOptions },
      target_project_name: { title: "To", options: toFacetOptions },
    }),
    [fromFacetOptions, toFacetOptions]
  );

  const exportFileName = useMemo(
    () => `itm_report_Dispatched_${formatDate(new Date())}`,
    []
  );

  const handleCustomExport = useCallback(async () => {
    const rowsToExport = await exportAllRows();
    if (!rowsToExport || rowsToExport.length === 0) {
      toast({
        title: "Export",
        description: "No data available to export.",
        variant: "default",
      });
      return;
    }

    const dataToExport = rowsToExport.map((row) => ({
      itm_id: row.name,
      dispatched_on: row.dispatched_on
        ? formatDate(row.dispatched_on)
        : "",
      from_project:
        row.source_type === "Warehouse"
          ? "Warehouse"
          : (row.source_project_name || row.source_project || ""),
      to_project:
        row.target_type === "Warehouse"
          ? "Warehouse"
          : (row.target_project_name || row.target_project || ""),
      status: row.status,
      total_items: row.total_items ?? 0,
      total_quantity: parseNumber(row.total_quantity ?? 0) || 0,
      est_value: formatForReport(row.estimated_value ?? 0),
      requested_by:
        row.requested_by_full_name || row.requested_by || row.owner || "",
    }));

    const exportColumns = [
      { header: "ITM ID", accessorKey: "itm_id" },
      { header: "Dispatched On", accessorKey: "dispatched_on" },
      { header: "From", accessorKey: "from_project" },
      { header: "To", accessorKey: "to_project" },
      { header: "Status", accessorKey: "status" },
      { header: "Total Items", accessorKey: "total_items" },
      { header: "Total Qty", accessorKey: "total_quantity" },
      { header: "Est Value", accessorKey: "est_value" },
      { header: "Requested By", accessorKey: "requested_by" },
    ];

    try {
      exportToCsv(exportFileName, dataToExport, exportColumns as any);
      toast({
        title: "Export Successful",
        description: `${dataToExport.length} rows exported.`,
        variant: "default",
      });
    } catch (e) {
      console.error("Export failed:", e);
      toast({
        title: "Export Error",
        description: "Could not generate CSV file.",
        variant: "destructive",
      });
    }
  }, [exportAllRows, exportFileName]);

  const summaryCardNode = useMemo(
    () => (
      <Alert
        variant="default"
        className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30"
      >
        <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <AlertDescription className="text-sm text-blue-800 dark:text-blue-300">
          ITMs currently in "Dispatched" status. Once any DN is filed (status →
          Partially Delivered) the ITM drops off this report.
        </AlertDescription>
      </Alert>
    ),
    []
  );

  const isLoadingOverall = isLoading || isTableHookLoading;
  const overallError = (error as Error | null) || (tableHookError as Error | null);

  if (overallError) {
    return <AlertDestructive error={overallError} />;
  }

  const totalCount = currentDisplayData.length;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 overflow-hidden",
        totalCount > 10 ? "h-[calc(100vh-130px)]" : totalCount > 0 ? "h-auto" : ""
      )}
    >
      {isLoading && !data ? (
        <LoadingFallback />
      ) : (
        <DataTable<ITMListRow>
          table={table}
          columns={itmDispatchedColumns}
          isLoading={isLoadingOverall}
          isExporting={isExporting}
          error={overallError}
          summaryCard={summaryCardNode}
          totalCount={filteredRowCount}
          searchFieldOptions={ITM_DISPATCHED_SEARCHABLE_FIELDS}
          selectedSearchField={selectedSearchField}
          onSelectedSearchFieldChange={setSelectedSearchField}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          facetFilterOptions={facetOptionsConfig}
          dateFilterColumns={ITM_DISPATCHED_DATE_COLUMNS}
          showExportButton={true}
          onExport={handleCustomExport}
          exportFileName={exportFileName}
          showRowSelection={false}
        />
      )}
    </div>
  );
}
