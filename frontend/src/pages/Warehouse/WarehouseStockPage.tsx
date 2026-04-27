import { useMemo } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowUpFromLine, Package } from "lucide-react";

import { DataTable } from "@/components/data-table/new-data-table";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { TableSkeleton } from "@/components/ui/skeleton";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
  WAREHOUSE_STOCK_DATE_COLUMNS,
  WAREHOUSE_STOCK_SEARCHABLE_FIELDS,
  warehouseStockColumns,
  type WarehouseStockRow,
} from "./config/warehouseStockTable.config";
import {
  WAREHOUSE_LEDGER_DATE_COLUMNS,
  WAREHOUSE_LEDGER_IMPACT_OPTIONS,
  WAREHOUSE_LEDGER_SEARCHABLE_FIELDS,
  warehouseLedgerColumns,
  type WarehouseLedgerRow,
} from "./config/warehouseLedgerTable.config";
import { useWarehouseStockList } from "./hooks/useWarehouseStockList";
import { useWarehouseLedgerList } from "./hooks/useWarehouseLedgerList";

export default function WarehouseStockPage() {
  return (
    <div className="flex-1 space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">Warehouse</h2>
        <div className="flex gap-2">
          <Link to="/warehouse/request">
            <Button size="sm" variant="outline">
              <ArrowUpFromLine className="mr-2 h-4 w-4" />
              Request from Warehouse
            </Button>
          </Link>
        </div>
      </div>

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">Current Stock</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="space-y-4">
          <StockTabBody />
        </TabsContent>

        <TabsContent value="ledger" className="space-y-4">
          <LedgerTabBody />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stock tab
// ---------------------------------------------------------------------------

function StockTabBody() {
  const {
    table,
    totalCount,
    data,
    isLoading,
    error,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
    exportAllRows,
    isExporting,
  } = useWarehouseStockList();

  // Summary cards: totals come from the currently loaded page only; for a true
  // warehouse-wide total we'd need an aggregates endpoint — acceptable tradeoff
  // for now given there are rarely more items than a single page shows.
  const currentPageValue = useMemo(
    () => (data ?? []).reduce((sum, r) => sum + (r.estimated_value || 0), 0),
    [data]
  );

  const facetFilterOptions = useMemo(() => {
    const rows = data ?? [];
    const toOptions = (key: "category" | "unit" | "make") => {
      const values = new Set<string>();
      for (const r of rows) {
        const v = r[key];
        if (v && typeof v === "string") values.add(v);
      }
      return Array.from(values)
        .sort((a, b) => a.localeCompare(b))
        .map((v) => ({ label: v, value: v }));
    };
    return {
      category: { title: "Category", options: toOptions("category") },
      unit: { title: "Unit", options: toOptions("unit") },
      make: { title: "Make", options: toOptions("make") },
    };
  }, [data]);

  if (error) return <AlertDestructive error={error} />;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Estimated Value (this page)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatToRoundedIndianRupee(currentPageValue)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-2 overflow-hidden h-[calc(100vh-320px)] min-h-[360px]">
        {isLoading && totalCount === 0 ? (
          <TableSkeleton />
        ) : (
          <DataTable<WarehouseStockRow>
            table={table}
            columns={warehouseStockColumns}
            isLoading={isLoading}
            error={error}
            totalCount={totalCount}
            searchFieldOptions={WAREHOUSE_STOCK_SEARCHABLE_FIELDS}
            selectedSearchField={selectedSearchField}
            onSelectedSearchFieldChange={setSelectedSearchField}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            dateFilterColumns={WAREHOUSE_STOCK_DATE_COLUMNS}
            facetFilterOptions={facetFilterOptions}
            showExportButton={true}
            onExport={"default"}
            onExportAll={exportAllRows}
            isExporting={isExporting}
            exportFileName={`Warehouse_Stock_${new Date()
              .toLocaleDateString("en-GB")
              .replace(/\//g, "-")}`}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ledger tab
// ---------------------------------------------------------------------------

function LedgerTabBody() {
  const {
    table,
    totalCount,
    isLoading,
    error,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
    exportAllRows,
    isExporting,
  } = useWarehouseLedgerList();

  const facetFilterOptions = useMemo(
    () => ({
      impact: {
        title: "Impact",
        options: WAREHOUSE_LEDGER_IMPACT_OPTIONS,
      },
    }),
    []
  );

  if (error) return <AlertDestructive error={error} />;

  return (
    <div className="flex flex-col gap-2 overflow-hidden h-[calc(100vh-230px)] min-h-[360px]">
      {isLoading && totalCount === 0 ? (
        <TableSkeleton />
      ) : (
        <DataTable<WarehouseLedgerRow>
          table={table}
          columns={warehouseLedgerColumns}
          isLoading={isLoading}
          error={error}
          totalCount={totalCount}
          searchFieldOptions={WAREHOUSE_LEDGER_SEARCHABLE_FIELDS}
          selectedSearchField={selectedSearchField}
          onSelectedSearchFieldChange={setSelectedSearchField}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          dateFilterColumns={WAREHOUSE_LEDGER_DATE_COLUMNS}
          facetFilterOptions={facetFilterOptions}
          showExportButton={true}
          onExport={"default"}
          onExportAll={exportAllRows}
          isExporting={isExporting}
          exportFileName={`Warehouse_Ledger_${new Date()
            .toLocaleDateString("en-GB")
            .replace(/\//g, "-")}`}
        />
      )}
    </div>
  );
}
