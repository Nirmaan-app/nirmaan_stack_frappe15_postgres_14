import { useMemo, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/data-table/new-data-table";
import { useFrappeGetCall } from "frappe-react-sdk";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { SearchFieldOption } from "@/components/data-table/new-data-table";
import { toast } from "@/components/ui/use-toast";
import { exportToCsv } from "@/utils/exportToCsv";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { ColumnDef } from "@tanstack/react-table";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  SortingState,
  VisibilityState,
  ColumnFiltersState,
} from "@tanstack/react-table";
import { facetedFilterFn } from "@/utils/tableFilters";
import { Link } from "react-router-dom";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";

interface CustomerReceivableData {
  customer: string;
  customer_name: string;
  total_invoices: number;
  total_inflow: number;
  total_receivable: number;
}

const CUSTOMER_REPORTS_SEARCHABLE_FIELDS: SearchFieldOption[] = [
  {
    value: "customer_name",
    label: "Customer Name",
    placeholder: "Search by Customer...",
    default: true,
  },
];

export default function CustomerReports() {
  const { data: apiResponse, isLoading, error } = useFrappeGetCall<{ message: CustomerReceivableData[] }>(
    "nirmaan_stack.api.reports.customer_receivable_report.get_customer_receivables_report",
    {}
  );

  const reportData = apiResponse?.message || [];

  const [sorting, setSorting] = useState<SortingState>([
    { id: "customer_name", desc: false },
  ]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedSearchField, setSelectedSearchField] = useState<string | null>(
    CUSTOMER_REPORTS_SEARCHABLE_FIELDS[0]?.value || "customer_name"
  );

  const tableColumns = useMemo<ColumnDef<CustomerReceivableData>[]>(
    () => [
      {
        accessorKey: "customer_name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Customer" />
        ),
        cell: ({ row }) => (
          <Link
            to={`/customers/${row.original.customer}`}
            className="text-blue-600 hover:underline font-medium"
          >
            {row.original.customer_name}
          </Link>
        ),
        filterFn: facetedFilterFn,
      },
      {
        accessorKey: "total_invoices",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Total Invoices" />
        ),
        cell: ({ row }) => (
          <div className="font-mono">
            {formatToRoundedIndianRupee(row.original.total_invoices)}
          </div>
        ),
        // Values arrive from the API as floats, so TanStack's numeric sort applies
        // directly -- no accessorFn/parse needed.
        sortingFn: "basic",
      },
      {
        accessorKey: "total_inflow",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Total Inflow"/>
        ),
        cell: ({ row }) => (
          <div className="font-mono">
            {formatToRoundedIndianRupee(row.original.total_inflow)}
          </div>
        ),
        sortingFn: "basic",
      },
      {
        accessorKey: "total_receivable",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Total Receivable"
            className="font-semibold"
          />
        ),
        cell: ({ row }) => (
          <div className="font-mono font-semibold">
            {formatToRoundedIndianRupee(row.original.total_receivable)}
          </div>
        ),
        sortingFn: "basic",
      },
    ],
    []
  );

  // Use client-side filtering for search
  const filteredData = useMemo(() => {
    if (!searchTerm || !selectedSearchField) return reportData;
    const lowerSearch = searchTerm.toLowerCase();
    return reportData.filter((row) => {
      const val = row[selectedSearchField as keyof CustomerReceivableData];
      if (typeof val === 'string') {
        return val.toLowerCase().includes(lowerSearch);
      }
      return false;
    });
  }, [reportData, searchTerm, selectedSearchField]);

  const table = useReactTable({
    data: filteredData,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnFiltersChange: setColumnFilters,
    state: {
      sorting,
      columnVisibility,
      columnFilters,
    },
    initialState: {
      pagination: {
        pageSize: 50,
      },
    },
  });

  const customerFacetOptions = useMemo(() => {
    if (!reportData) return [];
    const uniqueCustomers = Array.from(new Set(reportData.map((d) => d.customer_name).filter(Boolean)));
    return uniqueCustomers.map(name => ({ label: name, value: name }));
  }, [reportData]);

  const handleCustomExport = useCallback(() => {
    if (!filteredData || filteredData.length === 0) {
      toast({
        title: "Export Canceled",
        description: "No data available to export.",
        variant: "default",
      });
      return;
    }

    const dataToExport = filteredData.map((row) => ({
      customer_name: row.customer_name,
      total_invoices: Number(row.total_invoices).toFixed(2),
      total_inflow: Number(row.total_inflow).toFixed(2),
      total_receivable: Number(row.total_receivable).toFixed(2),
    }));

    const exportColumnsConfig = [
      { header: "Customer Name", accessorKey: "customer_name" },
      { header: "Total Invoices", accessorKey: "total_invoices" },
      { header: "Total Inflow", accessorKey: "total_inflow" },
      { header: "Total Receivable", accessorKey: "total_receivable" },
    ];

    const exportFileName = `Customer_Receivable_Report_${formatDate(new Date())}.csv`;

    try {
      exportToCsv(exportFileName, dataToExport, exportColumnsConfig);
      toast({
        title: "Export Successful",
        description: `${dataToExport.length} rows exported.`,
        variant: "success", // or "default"
      });
    } catch (e) {
      console.error("Export failed:", e);
      toast({
        title: "Export Error",
        description: "Could not generate CSV file.",
        variant: "destructive",
      });
    }
  }, [filteredData]);

  if (error) {
    return <AlertDestructive error={error} />;
  }

  if (isLoading && !reportData.length) {
    return <LoadingFallback />;
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 overflow-hidden",
        filteredData.length > 10 ? "h-[calc(100vh-130px)]" : "h-auto"
      )}
    >
      <DataTable
        table={table}
        columns={tableColumns}
        isLoading={isLoading}
        error={error as Error | null}
        totalCount={filteredData.length}
        searchFieldOptions={CUSTOMER_REPORTS_SEARCHABLE_FIELDS}
        selectedSearchField={selectedSearchField}
        onSelectedSearchFieldChange={setSelectedSearchField}
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        showExportButton={true}
        onExport={handleCustomExport}
        exportFileName={"Customer_Receivable_Report"}
        showRowSelection={false}
        facetFilterOptions={{
          customer_name: {
            title: "Customer",
            options: customerFacetOptions,
          },
        }}
      />
    </div>
  );
}
