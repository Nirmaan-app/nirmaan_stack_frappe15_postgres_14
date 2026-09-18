// frontend/src/pages/reports/components/VendorReports.tsx

import { useMemo, useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";
import { DataTable } from "@/components/data-table/new-data-table";
import { VendorCalculatedFields, useVendorLedgerCalculations } from "../hooks/useVendorLedgerCalculations";
import { VendorReportRow, getVendorColumns } from "./columns/vendorColumns";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { SearchFieldOption } from "@/components/data-table/new-data-table";
import { StandaloneDateFilter } from "@/components/ui/StandaloneDateFilter";
import { urlStateManager } from "@/utils/urlStateManager";
import { parse, formatISO, startOfDay, format } from "date-fns";
import { toast } from "@/components/ui/use-toast"; // 👈 Import toast for feedback
import { exportToCsv } from "@/utils/exportToCsv"; // 👈 Import the CSV utility
import { ColumnDef } from "@tanstack/react-table"; //
import { formatForReport } from "@/utils/FormatPrice";

// Configuration for this specific table
const VENDOR_REPORTS_SEARCHABLE_FIELDS: SearchFieldOption[] = [
  {
    value: "vendor_name",
    label: "Vendor Name",
    placeholder: "Search by Name...",
    default: true,
  },
  { value: "name", label: "Vendor ID", placeholder: "Search by ID..." },
  { value: "vendor_type", label: "Type", placeholder: "Search by Type..." },
];

const URL_SYNC_KEY = "vendor_ledger_report"; // Use a specific key for URL state

type VendorSearchField = "vendor_name" | "name" | "vendor_type";

// Same separators the server data-table search splits on (api/data_table/token_search.py);
// every token must appear in the field, case-insensitively.
const SEARCH_TOKEN_SEPARATOR = /[\s\-_/()]+/;

const EMPTY_TOTALS: VendorCalculatedFields = { totalPO: 0, totalSR: 0, totalInvoiced: 0, totalPaid: 0, balance: 0 };

export default function VendorReports() {
  // 1. Manage date range state, initialized from URL or with a default
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const fromParam = urlStateManager.getParam(`${URL_SYNC_KEY}_from`);
    const toParam = urlStateManager.getParam(`${URL_SYNC_KEY}_to`);
    if (fromParam && toParam) {
      try {
        return {
          from: parse(fromParam, "yyyy-MM-dd", new Date()),
          to: parse(toParam, "yyyy-MM-dd", new Date()),
        };
      } catch (e) {
        console.error("Error parsing date from URL:", e);
        // Fall through to default if parsing fails
      }
    }
    return undefined; // Default to "ALL" (no date filtering)
  });

  // 2. Pass the date range state into the calculation hook.
  const { vendors, getVendorCalculatedFields, isLoadingGlobalDeps, globalDepsError } =
    useVendorLedgerCalculations({
      startDate: dateRange?.from,
      endDate: dateRange?.to,
    });

  // 3. Effect to sync state changes back to the URL
  useEffect(() => {
    const fromISO = dateRange?.from
      ? formatISO(dateRange.from, { representation: "date" })
      : null;
    const toISO = dateRange?.to
      ? formatISO(dateRange.to, { representation: "date" })
      : null;

    urlStateManager.updateParam(`${URL_SYNC_KEY}_from`, fromISO);
    urlStateManager.updateParam(`${URL_SYNC_KEY}_to`, toISO);
  }, [dateRange]);

  const tableColumns = useMemo(() => getVendorColumns(), []);

  // Every vendor with its totals. The calculation hook already loads all vendors and their
  // POs/SRs/invoices/payments, so the table runs client-side and can sort on the totals.
  const reportRows = useMemo<VendorReportRow[]>(() => {
    if (isLoadingGlobalDeps || !vendors) return [];
    return vendors.map((vendor) => ({
      ...vendor,
      ...(getVendorCalculatedFields(vendor.name) ?? EMPTY_TOTALS),
    }));
  }, [vendors, getVendorCalculatedFields, isLoadingGlobalDeps]);

  // The table hook owns the search box state and its URL sync, but it must be handed rows
  // that are already searched. So the search is applied from the hook's values, copied in
  // by the effect below (one render behind).
  const [appliedSearch, setAppliedSearch] = useState({ term: "", field: "vendor_name" });

  const searchedRows = useMemo(() => {
    const tokens = appliedSearch.term.toLowerCase().split(SEARCH_TOKEN_SEPARATOR).filter(Boolean);
    if (!tokens.length) return reportRows;
    const field = appliedSearch.field as VendorSearchField;
    return reportRows.filter((row) => {
      const value = String(row[field] ?? "").toLowerCase();
      return tokens.every((token) => value.includes(token));
    });
  }, [reportRows, appliedSearch]);

  const {
    table,
    data: vendorsData,
    isLoading: isVendorsLoading,
    error: vendorsError,
    totalCount,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
    exportAllRows,
    isExporting,
  } = useServerDataTable<VendorReportRow>({
    doctype: "Vendors",
    columns: tableColumns,
    fetchFields: [],
    searchableFields: VENDOR_REPORTS_SEARCHABLE_FIELDS,
    urlSyncKey: URL_SYNC_KEY,
    clientData: searchedRows,
    clientTotalCount: searchedRows.length,
    initialState: { sorting: [{ id: "vendor_name", desc: false }] },
  });

  useEffect(() => {
    setAppliedSearch({ term: searchTerm, field: selectedSearchField });
  }, [searchTerm, selectedSearchField]);

  const isLoading = isLoadingGlobalDeps || isVendorsLoading;
  const error = globalDepsError || vendorsError;
  // --- 👇 THIS IS THE NEW CUSTOM EXPORT HANDLER ---
  const handleCustomExport = useCallback(async () => {
    if (isLoadingGlobalDeps) {
      toast({
        title: "Export Canceled",
        description: "Please wait for calculations to finish before exporting.",
        variant: "default",
      });
      return;
    }

    // Client-side mode: the searched rows, in the order currently sorted on screen.
    const allRows = await exportAllRows();
    if (!allRows || allRows.length === 0) {
      toast({
        title: "Export Canceled",
        description: "No data available to export.",
        variant: "default",
      });
      return;
    }

    // 1. Manually construct the data array for the CSV
    const dataToExport = allRows.map((vendor) => ({
      vendor_name: vendor.vendor_name || vendor.name,
      vendor_type: vendor.vendor_type || "N/A",
      total_po: formatForReport(vendor.totalPO),
      total_sr: formatForReport(vendor.totalSR),
      total_invoiced: formatForReport(vendor.totalInvoiced),
      total_paid: formatForReport(vendor.totalPaid),
      balance: formatForReport(vendor.balance),
    }));

    // 2. Define the columns for the CSV export
    const exportColumns: ColumnDef<any, any>[] = [
      { header: "Vendor Name", accessorKey: "vendor_name" },
      { header: "Type", accessorKey: "vendor_type" },
      { header: "Total PO Value", accessorKey: "total_po" },
      { header: "Total SR Value", accessorKey: "total_sr" },
      { header: "Total Invoiced", accessorKey: "total_invoiced" },
      { header: "Total Paid", accessorKey: "total_paid" },
      { header: "Balance Payable", accessorKey: "balance" },
    ];

    // --- 👇 THIS IS THE FIX ---
    // 1. Define a base name for the report.
    const baseName = "Vendor_Ledger_Report";
    let exportFileName = `${baseName}.csv`; // Default filename

    // 2. Check if a date range exists and format it into a string.
    if (dateRange?.from && dateRange?.to) {
      const fromStr = format(dateRange.from, "ddMMMyyyy");
      const toStr = format(dateRange.to, "ddMMMyyyy");
      exportFileName = `${baseName}_${fromStr}_to_${toStr}.csv`;
    }
    // --- END OF FIX ---
    // 3. Call the exporter utility
    try {
      exportToCsv(exportFileName, dataToExport, exportColumns);
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
  }, [exportAllRows, isLoadingGlobalDeps, dateRange]);

  console.log("dateRange", dateRange);

  const handleClearDateFilter = useCallback(() => {
    setDateRange(undefined); // Reset to "ALL" (no date filtering)
  }, []);

  if (error) {
    return <AlertDestructive error={error as Error} />;
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
      {/* 4. The external controls section */}
      <div className="flex items-center gap-4">
        <StandaloneDateFilter
          value={dateRange}
          onChange={setDateRange}
          onClear={handleClearDateFilter}
        />
        {/* You can add more global controls here later */}
      </div>

      {isLoading && !vendorsData?.length ? (
        <LoadingFallback />
      ) : (
        <DataTable<VendorReportRow>
          table={table}
          columns={tableColumns}
          isLoading={isLoading}
          isExporting={isExporting}
          error={error as Error | null}
          totalCount={totalCount}
          searchFieldOptions={VENDOR_REPORTS_SEARCHABLE_FIELDS}
          selectedSearchField={selectedSearchField}
          onSelectedSearchFieldChange={setSelectedSearchField}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          showExportButton={true}
          onExport={handleCustomExport} // 👈 Use the custom handler instead of 'default'
          exportFileName={"Vendor_Ledger_Report"}
          showRowSelection={false}
        />
      )}
    </div>
  );
}
