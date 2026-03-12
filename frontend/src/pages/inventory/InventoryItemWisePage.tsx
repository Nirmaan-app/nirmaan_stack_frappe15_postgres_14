import { useState, useMemo, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link } from "react-router-dom";
import {
  ChevronRight,
  ChevronDown,
  Search,
  Download,
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ListX,
  Warehouse,
} from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { SimpleFacetedFilter } from "@/pages/projects/components/SimpleFacetedFilter";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { unparse } from "papaparse";
import { formatDate as formatDateFns } from "date-fns";
import { useInventoryItemWise } from "./hooks/useInventoryItemWise";
import type { AggregatedItemRow } from "./inventory.types";

// =============================================================================
// SORT
// =============================================================================

type SortKey = "item_name" | "totalRemainingQty" | "totalEstimatedCost" | "projectCount";

interface SortableHeaderProps {
  sortableKey: SortKey;
  children: React.ReactNode;
  className?: string;
  currentSortKey: SortKey | null;
  currentSortDirection: "asc" | "desc";
  onSetSort: (key: SortKey, direction: "asc" | "desc") => void;
  onClearSort: () => void;
}

function SortableHeader({
  sortableKey,
  children,
  className,
  currentSortKey,
  currentSortDirection,
  onSetSort,
  onClearSort,
}: SortableHeaderProps) {
  const isSorted = currentSortKey === sortableKey;
  const alignmentClass = className?.includes("text-right")
    ? "justify-end"
    : "justify-start";
  return (
    <TableHead className={className}>
      <div className={`flex items-center gap-1 ${alignmentClass}`}>
        <span>{children}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
              {isSorted ? (
                currentSortDirection === "asc" ? (
                  <ArrowUp className="h-3.5 w-3.5" />
                ) : (
                  <ArrowDown className="h-3.5 w-3.5" />
                )
              ) : (
                <ChevronsUpDown className="h-3.5 w-3.5" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onSetSort(sortableKey, "asc")}>
              <ArrowUp className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />
              Asc
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSetSort(sortableKey, "desc")}>
              <ArrowDown className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />
              Desc
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onClearSort} disabled={!isSorted}>
              <ListX className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />
              Clear
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TableHead>
  );
}

// =============================================================================
// FLAT ROW TYPE (for virtualization)
// =============================================================================

type FlatRow =
  | { type: "item"; data: AggregatedItemRow }
  | {
      type: "project";
      data: {
        project: string;
        project_name: string;
        report_date: string;
        remaining_quantity: number;
        estimated_cost: number;
      };
    };

// =============================================================================
// CSV EXPORT
// =============================================================================

function exportInventoryCsv(items: AggregatedItemRow[]) {
  if (!items.length) return;

  const headers = [
    "Item Name",
    "Item ID",
    "Category",
    "Unit",
    "Total Remaining Qty",
    "Total Estimated Cost",
    "Project Count",
  ];

  const rows = items.map((item) => [
    item.item_name,
    item.item_id,
    item.category,
    item.unit,
    item.totalRemainingQty,
    Math.ceil(item.totalEstimatedCost),
    item.projectCount,
  ]);

  const csvString = unparse([headers, ...rows], { skipEmptyLines: true });
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = formatDateFns(new Date(), "yyyyMMdd_HHmmss");
  link.href = url;
  link.setAttribute("download", `Inventory_Item_Wise_${timestamp}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function InventoryItemWisePage() {
  const { data: items, isLoading, error } = useInventoryItemWise();

  // Search
  const [search, setSearch] = useState("");

  // Faceted filters
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set()
  );
  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(new Set());

  // Sort
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Expand
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((itemId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  // Filter options
  const categoryOptions = useMemo(() => {
    const cats = new Set(items.map((i) => i.category).filter(Boolean));
    return Array.from(cats)
      .sort()
      .map((c) => ({ label: c, value: c }));
  }, [items]);

  const unitOptions = useMemo(() => {
    const units = new Set(items.map((i) => i.unit).filter(Boolean));
    return Array.from(units)
      .sort()
      .map((u) => ({ label: u, value: u }));
  }, [items]);

  // Filtered + sorted items
  const filteredItems = useMemo(() => {
    let result = items;

    // Search
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(
        (item) =>
          item.item_name.toLowerCase().includes(q) ||
          item.item_id.toLowerCase().includes(q)
      );
    }

    // Category filter
    if (selectedCategories.size > 0) {
      result = result.filter((item) => selectedCategories.has(item.category));
    }

    // Unit filter
    if (selectedUnits.size > 0) {
      result = result.filter((item) => selectedUnits.has(item.unit));
    }

    // Sort
    if (sortKey) {
      result = [...result].sort((a, b) => {
        let cmp = 0;
        if (sortKey === "item_name") {
          cmp = a.item_name.localeCompare(b.item_name);
        } else {
          cmp = (a[sortKey] as number) - (b[sortKey] as number);
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return result;
  }, [items, search, selectedCategories, selectedUnits, sortKey, sortDir]);

  // Flatten for virtualization
  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    for (const item of filteredItems) {
      rows.push({ type: "item", data: item });
      if (expanded.has(item.item_id)) {
        for (const proj of item.projects) {
          rows.push({
            type: "project",
            data: {
              project: proj.project,
              project_name: proj.project_name,
              report_date: proj.report_date,
              remaining_quantity: proj.remaining_quantity,
              estimated_cost: proj.estimated_cost,
            },
          });
        }
      }
    }
    return rows;
  }, [filteredItems, expanded]);

  // Virtualizer
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (flatRows[index].type === "item" ? 48 : 40),
    overscan: 20,
  });

  const handleSetSort = useCallback(
    (key: SortKey, dir: "asc" | "desc") => {
      setSortKey(key);
      setSortDir(dir);
    },
    []
  );

  const handleClearSort = useCallback(() => {
    setSortKey(null);
    setSortDir("asc");
  }, []);

  // Summary stats
  const totalItems = filteredItems.length;
  const totalQty = useMemo(
    () => filteredItems.reduce((s, i) => s + i.totalRemainingQty, 0),
    [filteredItems]
  );
  const totalCost = useMemo(
    () => filteredItems.reduce((s, i) => s + i.totalEstimatedCost, 0),
    [filteredItems]
  );

  if (isLoading) return <LoadingFallback />;
  if (error) return <AlertDestructive error={error} />;

  return (
    <div className="flex-1 space-y-4 px-4 pt-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Warehouse className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold tracking-tight">
            Inventory — Item-Wise Summary
          </h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportInventoryCsv(filteredItems)}
          disabled={!filteredItems.length}
        >
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Unique Items</p>
          <p className="text-2xl font-bold">{totalItems.toLocaleString("en-IN")}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total Remaining Qty</p>
          <p className="text-2xl font-bold">{totalQty.toLocaleString("en-IN")}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total Estimated Cost</p>
          <p className="text-2xl font-bold">
            {formatToIndianRupee(totalCost)}
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search item name or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Category</span>
          <SimpleFacetedFilter
            title="Category"
            options={categoryOptions}
            selectedValues={selectedCategories}
            onSelectedValuesChange={setSelectedCategories}
          />
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Unit</span>
          <SimpleFacetedFilter
            title="Unit"
            options={unitOptions}
            selectedValues={selectedUnits}
            onSelectedValuesChange={setSelectedUnits}
          />
        </div>
        <span className="ml-auto text-sm text-muted-foreground">
          {filteredItems.length} item{filteredItems.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div
        ref={parentRef}
        className="rounded-md border overflow-auto"
        style={{ height: "calc(100vh - 320px)" }}
      >
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-10" />
              <SortableHeader
                sortableKey="item_name"
                currentSortKey={sortKey}
                currentSortDirection={sortDir}
                onSetSort={handleSetSort}
                onClearSort={handleClearSort}
              >
                Item Name
              </SortableHeader>
              <TableHead>Item ID</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Unit</TableHead>
              <SortableHeader
                sortableKey="totalRemainingQty"
                className="text-right"
                currentSortKey={sortKey}
                currentSortDirection={sortDir}
                onSetSort={handleSetSort}
                onClearSort={handleClearSort}
              >
                Remaining Qty
              </SortableHeader>
              <SortableHeader
                sortableKey="totalEstimatedCost"
                className="text-right"
                currentSortKey={sortKey}
                currentSortDirection={sortDir}
                onSetSort={handleSetSort}
                onClearSort={handleClearSort}
              >
                Est. Cost
              </SortableHeader>
              <SortableHeader
                sortableKey="projectCount"
                className="text-right"
                currentSortKey={sortKey}
                currentSortDirection={sortDir}
                onSetSort={handleSetSort}
                onClearSort={handleClearSort}
              >
                Projects
              </SortableHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {virtualizer.getVirtualItems().length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No inventory items found.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {/* spacer top */}
                {virtualizer.getVirtualItems()[0]?.start > 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      style={{
                        height: virtualizer.getVirtualItems()[0].start,
                      }}
                    />
                  </tr>
                )}
                {virtualizer.getVirtualItems().map((vRow) => {
                  const row = flatRows[vRow.index];
                  if (row.type === "item") {
                    const item = row.data;
                    const isExpanded = expanded.has(item.item_id);
                    return (
                      <TableRow
                        key={`item-${item.item_id}`}
                        data-index={vRow.index}
                        ref={virtualizer.measureElement}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleExpand(item.item_id)}
                      >
                        <TableCell className="w-10">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium max-w-[250px] truncate">
                          {item.item_name}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {item.item_id}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {item.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{item.unit}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {item.totalRemainingQty.toLocaleString("en-IN")}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatToIndianRupee(item.totalEstimatedCost)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className="text-xs">
                            {item.projectCount}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  } else {
                    // Project sub-row
                    const proj = row.data;
                    return (
                      <TableRow
                        key={`proj-${proj.project}-${vRow.index}`}
                        data-index={vRow.index}
                        ref={virtualizer.measureElement}
                        className="bg-muted/30"
                      >
                        <TableCell />
                        <TableCell colSpan={2} className="pl-8">
                          <Link
                            to={`/projects/${proj.project}`}
                            className="text-blue-600 hover:underline text-sm"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {proj.project_name}
                          </Link>
                          <span className="ml-2 text-xs text-muted-foreground">
                            ({proj.project})
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(proj.report_date)}
                        </TableCell>
                        <TableCell />
                        <TableCell className="text-right tabular-nums text-sm">
                          {proj.remaining_quantity.toLocaleString("en-IN")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {formatToIndianRupee(proj.estimated_cost)}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    );
                  }
                })}
                {/* spacer bottom */}
                {virtualizer.getVirtualItems().length > 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      style={{
                        height:
                          virtualizer.getTotalSize() -
                          (virtualizer.getVirtualItems().at(-1)?.end ?? 0),
                      }}
                    />
                  </tr>
                )}
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
