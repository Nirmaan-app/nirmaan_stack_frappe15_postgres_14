/**
 * BulkSelectTable — the selectable table behind the PO / WO / DN steps.
 *
 * A client-side TanStack table wearing the app's standard column controls (the in-header facet
 * filter and date filter every list uses), so filtering here reads like filtering anywhere else.
 *
 * Selection is deliberately NOT TanStack row selection: it stays the wizard's `selectedIds`, which
 * is exactly what the download posts. The header checkbox acts on the FILTERED rows only.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
    ColumnDef,
    ColumnFiltersState,
    SortingState,
    flexRender,
    getCoreRowModel,
    getFacetedRowModel,
    getFacetedUniqueValues,
    getFilteredRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, CaretSortIcon } from "@radix-ui/react-icons";
import { Search, X } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTableFacetedFilter } from "@/components/data-table/data-table-faceted-filter";
import { DataTableDateFilter } from "@/components/data-table/data-table-date-filter";
import { cn } from "@/lib/utils";

interface BulkSelectTableProps<T extends { name: string }> {
    data: T[];
    columns: ColumnDef<T, any>[];
    isLoading: boolean;
    selectedIds: string[];
    onSelectedIdsChange: (ids: string[]) => void;
    /** Column id -> facet title. Options are built from the rows, so they follow the other filters. */
    facetColumns?: Record<string, string>;
    /** Column ids that get the standard date filter. */
    dateFilterColumns?: string[];
    searchPlaceholder?: string;
    emptyMessage?: string;
}

export function BulkSelectTable<T extends { name: string }>({
    data,
    columns,
    isLoading,
    selectedIds,
    onSelectedIdsChange,
    facetColumns = {},
    dateFilterColumns = [],
    searchPlaceholder = "Search...",
    emptyMessage = "No items found.",
}: BulkSelectTableProps<T>) {
    const [sorting, setSorting] = useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [globalFilter, setGlobalFilter] = useState("");

    const table = useReactTable({
        data,
        columns,
        state: { sorting, columnFilters, globalFilter },
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onGlobalFilterChange: setGlobalFilter,
        globalFilterFn: "includesString",
        getRowId: (row) => row.name,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFacetedRowModel: getFacetedRowModel(),
        getFacetedUniqueValues: getFacetedUniqueValues(),
    });

    const rows = table.getRowModel().rows;
    const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
    const selectedVisibleCount = visibleIds.filter((id) => selected.has(id)).length;
    const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
    const isFiltered = columnFilters.length > 0 || globalFilter.trim() !== "";

    // The wizard's standing rule: changing a filter clears the selection, so a download never
    // carries a row the filters have hidden. Keyed on the filter VALUE (not a first-run flag) so a
    // StrictMode double-run on mount does not count as a change.
    const filterKey = JSON.stringify([columnFilters, globalFilter]);
    const lastFilterKey = useRef(filterKey);
    useEffect(() => {
        if (lastFilterKey.current === filterKey) return;
        lastFilterKey.current = filterKey;
        onSelectedIdsChange([]);
    }, [filterKey, onSelectedIdsChange]);

    const toggleRow = (id: string) =>
        onSelectedIdsChange(selected.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);

    const toggleAllVisible = () => {
        if (allVisibleSelected) {
            const visible = new Set(visibleIds);
            onSelectedIdsChange(selectedIds.filter((id) => !visible.has(id)));
        } else {
            onSelectedIdsChange(Array.from(new Set([...selectedIds, ...visibleIds])));
        }
    };

    const clearFilters = () => {
        table.resetColumnFilters();
        setGlobalFilter("");
    };

    const facetOptions = (columnId: string) => {
        const counts = table.getColumn(columnId)?.getFacetedUniqueValues() ?? new Map();
        return Array.from(counts.entries())
            .filter(([value]) => value != null && value !== "")
            .map(([value, count]) => ({ value: String(value), label: `${value} (${count})` }))
            .sort((a, b) => a.value.localeCompare(b.value));
    };

    return (
        <div className="flex flex-col gap-3">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="relative w-full sm:w-80">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={searchPlaceholder}
                        value={globalFilter}
                        onChange={(e) => setGlobalFilter(e.target.value)}
                        className="h-9 pl-9 pr-8 text-sm border-gray-300"
                    />
                    {globalFilter && (
                        <button
                            onClick={() => setGlobalFilter("")}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    {isFiltered && (
                        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
                            <X className="h-3.5 w-3.5 mr-1" />Clear filters
                        </Button>
                    )}
                    <p className="text-sm text-slate-500 font-medium whitespace-nowrap">
                        {selectedVisibleCount}/{rows.length} Selected
                    </p>
                </div>
            </div>

            {/* Table */}
            {isLoading ? (
                <div className="flex items-center justify-center h-48 border rounded-md">
                    <TailSpin color="red" width={32} height={32} />
                </div>
            ) : (
                <div className="rounded-md border max-h-[55vh] overflow-auto">
                    <Table>
                        <TableHeader className="sticky top-0 z-10 bg-red-50 shadow-sm">
                            {table.getHeaderGroups().map((hg) => (
                                <TableRow key={hg.id}>
                                    <TableHead className="w-10 px-3">
                                        <Checkbox
                                            aria-label="Select all filtered rows"
                                            disabled={rows.length === 0}
                                            checked={allVisibleSelected ? true : selectedVisibleCount > 0 ? "indeterminate" : false}
                                            onCheckedChange={toggleAllVisible}
                                        />
                                    </TableHead>
                                    {hg.headers.map((h) => {
                                        const column = h.column;
                                        const sorted = column.getIsSorted();
                                        return (
                                            <TableHead key={h.id} className="whitespace-nowrap">
                                                <div className="flex items-center gap-1">
                                                    {facetColumns[column.id] && (
                                                        <DataTableFacetedFilter
                                                            column={column}
                                                            title={facetColumns[column.id]}
                                                            options={facetOptions(column.id)}
                                                        />
                                                    )}
                                                    {dateFilterColumns.includes(column.id) && (
                                                        <DataTableDateFilter column={column} />
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={column.getToggleSortingHandler()}
                                                        className="flex items-center gap-1 font-medium hover:text-foreground"
                                                    >
                                                        {flexRender(column.columnDef.header, h.getContext())}
                                                        {sorted === "asc" ? (
                                                            <ArrowUpIcon className="h-3.5 w-3.5" />
                                                        ) : sorted === "desc" ? (
                                                            <ArrowDownIcon className="h-3.5 w-3.5" />
                                                        ) : (
                                                            <CaretSortIcon className="h-3.5 w-3.5 opacity-50" />
                                                        )}
                                                    </button>
                                                </div>
                                            </TableHead>
                                        );
                                    })}
                                </TableRow>
                            ))}
                        </TableHeader>
                        <TableBody>
                            {rows.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={table.getVisibleLeafColumns().length + 1} className="h-32 text-center">
                                        <p className="text-sm text-muted-foreground">
                                            {isFiltered ? "No rows match the current filters." : emptyMessage}
                                        </p>
                                        {isFiltered && (
                                            <Button variant="link" size="sm" className="text-xs" onClick={clearFilters}>
                                                Clear filters
                                            </Button>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ) : (
                                rows.map((row) => {
                                    const isSelected = selected.has(row.id);
                                    return (
                                        <TableRow
                                            key={row.id}
                                            data-state={isSelected ? "selected" : undefined}
                                            onClick={() => toggleRow(row.id)}
                                            className={cn("cursor-pointer", isSelected && "bg-red-50/60 hover:bg-red-50")}
                                        >
                                            <TableCell className="w-10 px-3 py-2" onClick={(e) => e.stopPropagation()}>
                                                <Checkbox
                                                    aria-label={`Select ${row.id}`}
                                                    checked={isSelected}
                                                    onCheckedChange={() => toggleRow(row.id)}
                                                    className="data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
                                                />
                                            </TableCell>
                                            {row.getVisibleCells().map((cell) => (
                                                <TableCell key={cell.id} className="py-2">
                                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                </TableCell>
                                            ))}
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}
