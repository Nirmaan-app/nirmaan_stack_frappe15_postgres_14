import { useMemo, useState, useCallback } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { ColumnDef } from "@tanstack/react-table";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  SortingState,
  ColumnFiltersState,
} from "@tanstack/react-table";

import ProjectSelect from "@/components/custom-select/project-select";
import { DataTable, SearchFieldOption } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Info, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { exportToCsv } from "@/utils/exportToCsv";
import { toast } from "@/components/ui/use-toast";
import { formatDate } from "@/utils/FormatDate";
import { useMaterialUsageData } from "@/pages/projects/hooks/useMaterialUsageData";

// ── Types ──────────────────────────────────────────────────

interface POEntry {
  po: string;
  status: string;
  amount: number;
  quote?: number;
}

interface InventorySummaryRow {
  itemKey: string;
  itemId: string;
  itemName: string;
  category: string;
  unit: string;
  poNumbers: POEntry[];
  poQuantity: number;
  latestDNQuantity: number;
  remainingQty: number | null;
}

interface LatestRemainingResponse {
  report_date: string | null;
  submitted_by: string | null;
  items: Record<string, { remaining_quantity: number | null; dn_quantity: number }>;
}

// Pivot table types (for History tab)
interface ReportItem {
  item_id: string;
  item_name: string;
  unit: string;
  category: string;
  dn_quantity: number;
  remaining_quantity: number | null;
}

interface ReportEntry {
  name: string;
  report_date: string;
  submitted_by: string;
  items: ReportItem[];
}

interface PivotRow {
  itemKey: string;
  item_name: string;
  unit: string;
  category: string;
  [dateKey: string]: string | number | null | undefined;
}

// ── Search Config ──────────────────────────────────────────

const INVENTORY_SEARCH_FIELDS: SearchFieldOption[] = [
  { value: "itemName", label: "Item Name", placeholder: "Search by item name...", default: true },
  { value: "itemId", label: "Item ID", placeholder: "Search by item ID..." },
  { value: "category", label: "Category", placeholder: "Search by category..." },
];

const RATE_THRESHOLD = 5000;

// -1 is the backend sentinel for "not filled in" on remaining quantity
const NOT_FILLED = -1;

/** Shared formatter for remaining quantity values */
function formatRemainingQty(val: number | null | undefined): string {
  if (val === null || val === undefined || val === NOT_FILLED) return "---";
  if (val === 0) return "All Consumed";
  return val.toFixed(2);
}

// ── Main Component ─────────────────────────────────────────

export default function InventoryReport() {
  const [selectedProject, setSelectedProject] = useState<{ value: string; label: string } | null>(null);

  const handleProjectChange = useCallback((option: { value: string; label: string } | null) => {
    setSelectedProject(option);
  }, []);

  return (
    <div className="space-y-4">
      <div className="max-w-sm">
        <ProjectSelect onChange={handleProjectChange} universal={false} />
      </div>

      <Alert variant="default" className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30">
        <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <AlertDescription className="text-sm text-blue-800 dark:text-blue-300">
          This report only includes items with a per-unit rate exceeding &#8377;{RATE_THRESHOLD.toLocaleString()}.
        </AlertDescription>
      </Alert>

      {selectedProject ? (
        <InventoryReportContent projectId={selectedProject.value} />
      ) : (
        <p className="text-sm text-muted-foreground">Select a project to view the inventory report.</p>
      )}
    </div>
  );
}

// ── Content with Tabs ──────────────────────────────────────

function InventoryReportContent({ projectId }: { projectId: string }) {
  return (
    <Tabs defaultValue="summary" className="space-y-4">
      <TabsList>
        <TabsTrigger value="summary">Summary</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
      <TabsContent value="summary">
        <SummaryTable projectId={projectId} />
      </TabsContent>
      <TabsContent value="history">
        <HistoryTable projectId={projectId} />
      </TabsContent>
    </Tabs>
  );
}

// ── Summary Tab ────────────────────────────────────────────

function SummaryTable({ projectId }: { projectId: string }) {
  // Live PO/DN data
  const { allMaterialUsageItems, isLoading: isLoadingMaterial } = useMaterialUsageData(projectId);

  // Latest remaining quantities from API
  const { data: remainingData, isLoading: isLoadingRemaining, error: remainingError } = useFrappeGetCall<{
    message: LatestRemainingResponse;
  }>(
    "nirmaan_stack.api.remaining_items_report.get_latest_remaining_quantities",
    { project: projectId },
    projectId ? `latest_remaining_${projectId}` : undefined
  );

  const latestRemaining = remainingData?.message;
  const reportDate = latestRemaining?.report_date;
  const remainingItems = latestRemaining?.items ?? {};

  // Merge and filter data
  const summaryData = useMemo((): InventorySummaryRow[] => {
    if (!allMaterialUsageItems?.length) return [];

    return allMaterialUsageItems
      .filter((item) => {
        const maxRate = Math.max(...(item.poNumbers?.map((p) => p.quote ?? 0) ?? [0]));
        return maxRate > RATE_THRESHOLD;
      })
      .map((item) => {
        const key = `${item.categoryName}_${item.itemId}`;
        const remaining = remainingItems[key];
        return {
          itemKey: key,
          itemId: item.itemId ?? "",
          itemName: item.itemName ?? "",
          category: item.categoryName,
          unit: item.unit ?? "",
          poNumbers: (item.poNumbers ?? []) as POEntry[],
          poQuantity: item.orderedQuantity,
          latestDNQuantity: item.deliveredQuantity,
          remainingQty: remaining?.remaining_quantity ?? null,
        };
      })
      .sort((a, b) => {
        const catCmp = a.category.localeCompare(b.category);
        return catCmp !== 0 ? catCmp : a.itemName.localeCompare(b.itemName);
      });
  }, [allMaterialUsageItems, remainingItems]);

  // Category options for faceted filter
  const categoryOptions = useMemo(() => {
    const categories = new Set(summaryData.map((r) => r.category));
    return Array.from(categories)
      .sort()
      .map((c) => ({ label: c, value: c }));
  }, [summaryData]);

  // Search state
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSearchField, setSelectedSearchField] = useState(
    INVENTORY_SEARCH_FIELDS[0].value
  );

  // Filter data by search
  const filteredData = useMemo(() => {
    if (!searchTerm) return summaryData;
    const lower = searchTerm.toLowerCase();
    return summaryData.filter((row) => {
      const fieldValue = row[selectedSearchField as keyof InventorySummaryRow];
      return String(fieldValue ?? "").toLowerCase().includes(lower);
    });
  }, [summaryData, searchTerm, selectedSearchField]);

  // Columns
  const remainingHeader = reportDate
    ? `Remaining Qty as on ${formatDate(reportDate)}`
    : "Remaining Qty";

  const columns = useMemo((): ColumnDef<InventorySummaryRow>[] => [
    {
      accessorKey: "itemName",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Item Name" />,
      cell: ({ row }) => <span className="text-sm font-medium">{row.original.itemName}</span>,
      size: 250,
    },
    {
      id: "poId",
      header: "PO ID",
      cell: ({ row }) => {
        const pos = row.original.poNumbers;
        if (!pos.length) return <span className="text-muted-foreground text-xs">---</span>;
        if (pos.length === 1) {
          return (
            <Link
              to={`/project-payments/${pos[0].po.split("/").join("&=")}`}
              className="text-blue-600 hover:underline text-xs font-mono"
            >
              {pos[0].po}
            </Link>
          );
        }
        return (
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-auto p-1 text-xs text-blue-600 hover:bg-blue-50">
                  <FileText className="h-3.5 w-3.5 mr-1" />
                  {pos.length} POs
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs bg-popover border shadow-lg rounded-md p-0">
                <ul className="list-none p-2 space-y-1">
                  {pos.map((poEntry) => (
                    <li key={poEntry.po} className="text-xs">
                      <Link
                        to={`/project-payments/${poEntry.po.split("/").join("&=")}`}
                        className="text-blue-600 hover:underline font-mono"
                      >
                        {poEntry.po}
                      </Link>
                    </li>
                  ))}
                </ul>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      },
      size: 140,
      enableSorting: false,
    },
    {
      accessorKey: "category",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.category}</span>,
      size: 160,
      filterFn: (row, _columnId, filterValues: string[]) => {
        return filterValues.includes(row.original.category);
      },
    },
    {
      accessorKey: "unit",
      header: "Unit",
      cell: ({ row }) => <span className="text-sm text-center block">{row.original.unit}</span>,
      size: 80,
      enableSorting: false,
    },
    {
      accessorKey: "poQuantity",
      header: ({ column }) => <DataTableColumnHeader column={column} title="PO Quantity" />,
      cell: ({ row }) => (
        <span className="text-sm text-right block font-mono tabular-nums">
          {row.original.poQuantity.toFixed(2)}
        </span>
      ),
      size: 120,
    },
    {
      accessorKey: "latestDNQuantity",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Latest DN Quantity" />,
      cell: ({ row }) => (
        <span className="text-sm text-right block font-mono tabular-nums">
          {row.original.latestDNQuantity.toFixed(2)}
        </span>
      ),
      size: 150,
    },
    {
      accessorKey: "remainingQty",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={<span className="whitespace-normal leading-tight">{remainingHeader}</span>}
        />
      ),
      cell: ({ row }) => {
        const val = row.original.remainingQty;
        const formatted = formatRemainingQty(val);
        if (formatted === "---") {
          return <span className="text-muted-foreground text-right block">---</span>;
        }
        if (formatted === "All Consumed") {
          return <span className="text-red-600 font-medium text-sm text-right block">All Consumed</span>;
        }
        return (
          <span className="text-sm text-right block font-mono tabular-nums">{formatted}</span>
        );
      },
      size: 160,
      sortingFn: (rowA, rowB) => {
        // Nulls sort to bottom (below -1 sentinel)
        const a = rowA.original.remainingQty ?? -2;
        const b = rowB.original.remainingQty ?? -2;
        return a - b;
      },
    },
  ], [remainingHeader]);

  // Table state
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    state: { sorting, columnFilters },
    initialState: {
      pagination: { pageSize: 100 },
    },
  });

  // Export
  const handleExport = useCallback(() => {
    if (filteredData.length === 0) {
      toast({ title: "No Data", description: "No data to export.", variant: "default" });
      return;
    }

    const dataToExport = filteredData.map((row) => ({
      itemName: row.itemName,
      itemId: row.itemId,
      poIds: row.poNumbers.map((p) => p.po).join(", ") || "---",
      category: row.category,
      unit: row.unit,
      poQuantity: row.poQuantity.toFixed(2),
      latestDNQuantity: row.latestDNQuantity.toFixed(2),
      remainingQty: formatRemainingQty(row.remainingQty),
    }));

    const exportColumns = [
      { header: "Item Name", accessorKey: "itemName" },
      { header: "Item ID", accessorKey: "itemId" },
      { header: "PO ID", accessorKey: "poIds" },
      { header: "Category", accessorKey: "category" },
      { header: "Unit", accessorKey: "unit" },
      { header: "PO Quantity", accessorKey: "poQuantity" },
      { header: "Latest DN Quantity", accessorKey: "latestDNQuantity" },
      { header: remainingHeader, accessorKey: "remainingQty" },
    ];

    try {
      exportToCsv(`Inventory_Report_Summary_${formatDate(new Date().toISOString())}`, dataToExport, exportColumns);
      toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.` });
    } catch (e) {
      console.error("Export failed:", e);
      toast({ title: "Export Error", description: "Could not generate CSV file.", variant: "destructive" });
    }
  }, [filteredData, remainingHeader]);

  const isLoading = isLoadingMaterial || isLoadingRemaining;

  if (isLoading) return <LoadingFallback />;

  if (summaryData.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No items with per-unit rate exceeding &#8377;{RATE_THRESHOLD.toLocaleString()} found for this project.
      </p>
    );
  }

  return (
    <DataTable
      table={table}
      columns={columns}
      isLoading={isLoading}
      error={(remainingError as unknown as Error) ?? null}
      totalCount={filteredData.length}
      searchFieldOptions={INVENTORY_SEARCH_FIELDS}
      selectedSearchField={selectedSearchField}
      onSelectedSearchFieldChange={setSelectedSearchField}
      searchTerm={searchTerm}
      onSearchTermChange={setSearchTerm}
      facetFilterOptions={{
        category: { title: "Category", options: categoryOptions },
      }}
      showExportButton={true}
      onExport={handleExport}
      exportFileName={`Inventory_Report_Summary_${formatDate(new Date().toISOString())}`}
      showRowSelection={false}
    />
  );
}

// ── History Tab (existing pivot table) ─────────────────────

const HISTORY_SEARCH_FIELDS: SearchFieldOption[] = [
  { value: "item_name", label: "Item Name" },
];
const noop = () => {};

function HistoryTable({ projectId }: { projectId: string }) {
  const { data: reportsData, isLoading, error: historyError } = useFrappeGetCall<{
    message: ReportEntry[];
  }>(
    "nirmaan_stack.api.remaining_items_report.get_remaining_reports_for_project",
    { project: projectId, limit: 5 },
    projectId ? `remaining_reports_${projectId}` : undefined
  );

  const reports = reportsData?.message ?? [];

  // Build dynamic date columns from report dates
  const dateColumns = useMemo(() => {
    return reports.map((r) => ({
      date: r.report_date,
      key: `remaining_${r.report_date}`,
      label: new Date(r.report_date + "T00:00:00").toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
      }),
    }));
  }, [reports]);

  // Build pivot data
  const pivotData = useMemo((): PivotRow[] => {
    if (reports.length === 0) return [];

    const rowMap = new Map<string, PivotRow>();

    for (const report of reports) {
      const dateKey = `remaining_${report.report_date}`;
      for (const item of report.items) {
        const itemKey = `${item.category}_${item.item_id}`;
        if (!rowMap.has(itemKey)) {
          rowMap.set(itemKey, {
            itemKey,
            item_name: item.item_name,
            unit: item.unit,
            category: item.category,
          });
        }
        const row = rowMap.get(itemKey)!;
        row[dateKey] = item.remaining_quantity;
      }
    }

    return Array.from(rowMap.values()).sort((a, b) => {
      const catCmp = a.category.localeCompare(b.category);
      return catCmp !== 0 ? catCmp : a.item_name.localeCompare(b.item_name);
    });
  }, [reports]);

  // Build columns
  const columns = useMemo((): ColumnDef<PivotRow>[] => {
    const baseCols: ColumnDef<PivotRow>[] = [
      {
        accessorKey: "item_name",
        header: "Item Name",
        cell: ({ row }) => <span className="text-sm font-medium">{row.original.item_name}</span>,
        size: 200,
      },
      {
        accessorKey: "unit",
        header: "Unit",
        cell: ({ row }) => <span className="text-sm text-center block">{row.original.unit}</span>,
        size: 80,
      },
      {
        accessorKey: "category",
        header: "Category",
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.category}</span>,
        size: 140,
      },
    ];

    const dateCols: ColumnDef<PivotRow>[] = dateColumns.map((col) => ({
      id: col.key,
      header: () => <div className="text-xs font-medium text-center">{col.label}</div>,
      cell: ({ row }) => {
        const value = row.original[col.key];
        const numVal = typeof value === "number" ? value : null;
        const formatted = formatRemainingQty(numVal);
        if (formatted === "---") {
          return <span className="text-muted-foreground text-center block">---</span>;
        }
        if (formatted === "All Consumed") {
          return <span className="text-red-600 font-medium text-sm text-right block font-mono tabular-nums">All Consumed</span>;
        }
        return (
          <span className="text-sm text-right block font-mono tabular-nums">{formatted}</span>
        );
      },
      size: 120,
    }));

    return [...baseCols, ...dateCols];
  }, [dateColumns]);

  // Table state
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: pivotData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
    initialState: {
      pagination: { pageSize: 100 },
    },
  });

  // Export
  const handleExport = useCallback(() => {
    if (pivotData.length === 0) {
      toast({ title: "No Data", description: "No data to export.", variant: "default" });
      return;
    }

    const exportColumns = [
      { header: "Item Name", accessorKey: "item_name" },
      { header: "Unit", accessorKey: "unit" },
      { header: "Category", accessorKey: "category" },
      ...dateColumns.map((col) => ({
        header: col.label,
        accessorKey: col.key,
      })),
    ];

    const dataToExport = pivotData.map((row) => {
      const exportRow: Record<string, any> = {
        item_name: row.item_name,
        unit: row.unit,
        category: row.category,
      };
      dateColumns.forEach((col) => {
        const val = row[col.key];
        const numVal = typeof val === "number" ? val : null;
        exportRow[col.key] = formatRemainingQty(numVal);
      });
      return exportRow;
    });

    try {
      exportToCsv(`Inventory_Report_History_${formatDate(new Date().toISOString())}`, dataToExport, exportColumns);
      toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.` });
    } catch (e) {
      console.error("Export failed:", e);
      toast({ title: "Export Error", description: "Could not generate CSV file.", variant: "destructive" });
    }
  }, [pivotData, dateColumns]);

  if (isLoading) return <LoadingFallback />;

  if (reports.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No remaining items reports found for this project.
      </p>
    );
  }

  return (
    <DataTable
      table={table}
      columns={columns}
      isLoading={isLoading}
      error={(historyError as unknown as Error) ?? null}
      totalCount={pivotData.length}
      searchFieldOptions={HISTORY_SEARCH_FIELDS}
      selectedSearchField="item_name"
      onSelectedSearchFieldChange={noop}
      searchTerm=""
      onSearchTermChange={noop}
      showSearchBar={false}
      showExportButton={true}
      onExport={handleExport}
      exportFileName={`Inventory_Report_History_${formatDate(new Date().toISOString())}`}
      showRowSelection={false}
    />
  );
}
