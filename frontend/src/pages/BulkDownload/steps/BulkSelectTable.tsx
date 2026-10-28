/**
 * BulkSelectTable — the selectable table behind the PO / WO / DN steps.
 *
 * A client-side TanStack table wearing the app's standard column controls (the in-header facet
 * filter and date filter every list uses), so filtering here reads like filtering anywhere else.
 *
 * Selection is deliberately NOT TanStack row selection: it stays the wizard's `selectedIds`, which
 * is exactly what the download posts. The header checkbox acts on the FILTERED rows only -- on
 * every page when the table is paged (`pageSize`, the all scope), never just the page in view.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
    ColumnDef,
    ColumnFiltersState,
    PaginationState,
    SortingState,
    flexRender,
    getCoreRowModel,
    getFacetedRowModel,
    getFacetedUniqueValues,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, CaretSortIcon } from "@radix-ui/react-icons";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTableFacetedFilter } from "@/components/data-table/data-table-faceted-filter";
import { DataTableDateFilter } from "@/components/data-table/data-table-date-filter";
import { cn } from "@/lib/utils";
import { SummaryAmount, dateSpan, describeFilters, selectionBlocks } from "@/utils/bulkDownload/bulkSelectionSummary";

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
    /** What a screen reader calls a row's checkbox ("Select …"); defaults to the row's `name`. Pass
     *  it when the name is an id users never see, e.g. an MTC. */
    rowLabel?: (row: T) => string;
    /** Page the rows (the all scope's company-wide lists). Left out, every row renders, as before. */
    pageSize?: number;
    /** The figures the summary totals over the ticked rows (none: the summary shows the count only). */
    summaryAmounts?: readonly SummaryAmount<T>[];
}

// Module-level defaults: a fresh `[]` / `{}` per render would defeat the summary's memos.
const NO_FACETS: Record<string, string> = {};
const NO_DATE_COLUMNS: string[] = [];
const NO_AMOUNTS: readonly never[] = [];

export function BulkSelectTable<T extends { name: string }>({
    data,
    columns,
    isLoading,
    selectedIds,
    onSelectedIdsChange,
    facetColumns = NO_FACETS,
    dateFilterColumns = NO_DATE_COLUMNS,
    searchPlaceholder = "Search...",
    emptyMessage = "No items found.",
    rowLabel,
    pageSize,
    summaryAmounts = NO_AMOUNTS,
}: BulkSelectTableProps<T>) {
    const [sorting, setSorting] = useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [globalFilter, setGlobalFilter] = useState("");
    const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: pageSize ?? 0 });
    // A filter or search change goes back to page 1 at once, in the same render (TanStack's own
    // reset is queued for later, which shows an empty page in between).
    const toFirstPage = () => setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));
    const changeSearch = (value: string) => { setGlobalFilter(value); toFirstPage(); };

    const table = useReactTable({
        data,
        columns,
        state: { sorting, columnFilters, globalFilter, ...(pageSize ? { pagination } : {}) },
        onSortingChange: setSorting,
        onColumnFiltersChange: (updater) => { setColumnFilters(updater); toFirstPage(); },
        onGlobalFilterChange: (updater) => { setGlobalFilter(updater); toFirstPage(); },
        globalFilterFn: "includesString",
        getRowId: (row) => row.name,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFacetedRowModel: getFacetedRowModel(),
        getFacetedUniqueValues: getFacetedUniqueValues(),
        ...(pageSize
            ? { getPaginationRowModel: getPaginationRowModel(), onPaginationChange: setPagination, autoResetPageIndex: false }
            : {}),
    });

    // `rows` = what this page renders; `filteredRows` = every row the filters and search leave, on
    // all pages. Select-all, the counts and the header tick read `filteredRows`.
    const rows = table.getRowModel().rows;
    const filteredRows = table.getPrePaginationRowModel().rows;
    const visibleIds = useMemo(() => filteredRows.map((r) => r.id), [filteredRows]);
    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
    const selectedVisibleIds = useMemo(() => visibleIds.filter((id) => selected.has(id)), [visibleIds, selected]);
    const selectedVisibleCount = selectedVisibleIds.length;
    const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
    const isFiltered = columnFilters.length > 0 || globalFilter.trim() !== "";

    // `autoResetPageIndex` is off, so nothing else pulls the page back when the rows shrink under it
    // (a refetch after POs were merged or cancelled): move to the last page that still exists, in this
    // render, rather than show an empty page reading "Page 6 of 5".
    const pageCount = pageSize ? table.getPageCount() : 0;
    if (pageSize && pagination.pageIndex > 0 && pagination.pageIndex >= pageCount) {
        setPagination((p) => ({ ...p, pageIndex: Math.max(0, pageCount - 1) }));
    }

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

    // The two-line summary: line 1 = what is ticked and its total, line 2 = the filters and date range.
    // Line 1 reads the ticked rows the filters SHOW, the same rows the header's "x/y Selected" counts.
    // Memoised: each figure is a pass over the rows, and the all scope has thousands.
    const dateTitles = useMemo(
        () => Object.fromEntries(
            dateFilterColumns.map((id) => {
                const header = table.getColumn(id)?.columnDef.header;
                return [id, typeof header === "string" ? header : id];
            })
        ),
        // `table` is left out on purpose (a new reference every render); its columns come from `columns`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [dateFilterColumns, columns],
    );
    // The ticked rows' own date range, on the table's main (first) date column -- not the date filter.
    const mainDate = dateFilterColumns[0];
    const blocks = useMemo(() => {
        const ticked = filteredRows.filter((row) => selected.has(row.id));
        const span = mainDate ? dateSpan(ticked.map((row) => row.getValue(mainDate))) : null;
        return selectionBlocks(
            ticked.map((row) => row.original), selectedVisibleIds, filteredRows.length, summaryAmounts,
            mainDate ? { title: dateTitles[mainDate], span } : null,
        );
    }, [filteredRows, selected, selectedVisibleIds, summaryAmounts, mainDate, dateTitles]);
    const filterParts = useMemo(
        () => describeFilters(columnFilters, globalFilter, facetColumns, dateTitles),
        [columnFilters, globalFilter, facetColumns, dateTitles],
    );
    // Shown only once something is ticked or a filter is set (owner, 2026-10-28): an untouched table needs no summary.
    const hasFilters = filterParts[0]?.key !== "none";
    const showSummary = selectedVisibleCount > 0 || hasFilters;

    const clearFilters = () => {
        table.resetColumnFilters();
        changeSearch("");
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
                        onChange={(e) => changeSearch(e.target.value)}
                        className="h-9 pl-9 pr-8 text-sm border-gray-300"
                    />
                    {globalFilter && (
                        <button
                            onClick={() => changeSearch("")}
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
                        {selectedVisibleCount}/{filteredRows.length} Selected
                    </p>
                </div>
            </div>

            {/* Selection summary: above the table, light yellow; every value labelled (owner) */}
            {!isLoading && showSummary && (
                <div aria-label="Selection summary" className="flex flex-col gap-1.5 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {blocks.map((block, i) => (
                            <Fragment key={block.label}>
                                {i > 0 && <span aria-hidden className="h-4 w-px bg-yellow-300" />}
                                <span className="whitespace-nowrap">
                                    <span data-summary-label className="mr-1.5 text-xs text-gray-500">{block.label}</span>
                                    <span data-summary-value className="font-semibold text-gray-900 tabular-nums">{block.value}</span>
                                </span>
                            </Fragment>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="mr-1 text-xs text-gray-500">Filters</span>
                        {!hasFilters ? (
                            <span data-summary-filter className="text-gray-500">No filters</span>
                        ) : (
                            filterParts.map((part) => (
                                <span
                                    key={part.key}
                                    data-summary-filter
                                    title={part.full}
                                    className="inline-flex items-center gap-1 rounded-full border border-yellow-300 bg-white py-0.5 pl-2.5 pr-1 text-xs text-gray-800"
                                >
                                    {part.text}
                                    <button
                                        type="button"
                                        aria-label={`Remove filter ${part.full}`}
                                        onClick={() => (part.key === "search" ? changeSearch("") : table.getColumn(part.key)?.setFilterValue(undefined))}
                                        className="rounded-full p-0.5 text-gray-500 hover:bg-yellow-100 hover:text-gray-900"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </span>
                            ))
                        )}
                    </div>
                </div>
            )}

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
                                            disabled={filteredRows.length === 0}
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
                                                    aria-label={`Select ${rowLabel ? rowLabel(row.original) : row.id}`}
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

            {pageSize && !isLoading && filteredRows.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                    <span className="tabular-nums">
                        {(table.getState().pagination.pageIndex * pageSize + 1).toLocaleString("en-IN")}–
                        {Math.min(filteredRows.length, (table.getState().pagination.pageIndex + 1) * pageSize).toLocaleString("en-IN")} of{" "}
                        {filteredRows.length.toLocaleString("en-IN")}
                    </span>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" className="h-8" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                            <ChevronLeft className="h-4 w-4 mr-1" />Prev
                        </Button>
                        <span className="tabular-nums whitespace-nowrap">
                            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount().toLocaleString("en-IN")}
                        </span>
                        <Button variant="outline" size="sm" className="h-8" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                            Next<ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                    </div>
                </div>
            )}

        </div>
    );
}
