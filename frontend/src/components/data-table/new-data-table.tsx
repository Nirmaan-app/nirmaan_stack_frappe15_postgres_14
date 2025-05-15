import * as React from 'react';
import {
    Table as TanstackTableInstance,
    flexRender,
    ColumnDef,
    HeaderGroup,
} from '@tanstack/react-table';

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTablePagination } from './data-table-pagination';
import { DataTableViewOptions } from './data-table-view-options';
import { DataTableFacetedFilter } from './data-table-faceted-filter';
import { TableBodySkeleton } from '@/components/ui/skeleton';
import { Button } from '../ui/button';
import { DataTableDateFilter } from './data-table-date-filter';

// --- NEW: Select component for search field ---
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { toast } from '../ui/use-toast';
import { exportToCsv } from '@/utils/exportToCsv';
import { FileUp } from 'lucide-react';

export interface SearchFieldOption {
    value: string;
    label: string;
    placeholder?: string; // Optional placeholder specific to this field
    default?: boolean; // Default search field
    is_json?: boolean; // Is JSON field
}

// --- Types ---
interface DataTableProps<TData> {
    /** The TanStack Table instance returned from the useServerDataTable hook. */
    table: TanstackTableInstance<TData>;
    /** The definition of columns for the table. */
    columns: ColumnDef<TData, any>[]; // Pass columns for header/cell rendering info
    /** Loading state from the hook. */
    isLoading: boolean;
    /** Error object from the hook. */
    error?: Error | null;
    /** Total number of items matching filters (for pagination). */
    totalCount: number;
    /** Options for the search field selector. */
    searchFieldOptions: SearchFieldOption[];
    /** Currently selected search field value. */
    selectedSearchField: string;
    /** Callback to update the selected search field. */
    onSelectedSearchFieldChange: (fieldValue: string) => void;
    /** Current search term. */
    searchTerm: string;
    /** Callback to update the search term. */
    onSearchTermChange: (term: string) => void;
    /** Optional: Options for various faceted filters. Passed down to DataTableFacetedFilter. */
    facetFilterOptions?: {
        [columnId: string]: { title: string; options: { label: string; value: string; icon?: React.ComponentType<{ className?: string }> }[] };
    };

    /** Array of column IDs that should use the Date Filter */
    dateFilterColumns?: string[];
    /** Optional: Show export button and related dialog logic */
    showExportButton?: boolean;
    onExport?: (() => void) | 'default'; // Callback to handle export logic
    exportFileName?: string;
    /** Optional: Show other custom buttons or elements in the toolbar */
    toolbarActions?: React.ReactNode;
    /** Optional: className for the container div */
    className?: string;
    /**
     * Optional: Show row selection column and related logic
     */
    showRowSelection?: boolean;
}

// --- Component ---
export function DataTable<TData>({
    table,
    columns: userDefinedColumns, // Receive columns to help with rendering structure/colspan
    isLoading,
    error,
    totalCount,
    // --- New Search Props ---
    searchFieldOptions,
    selectedSearchField,
    onSelectedSearchFieldChange,
    searchTerm,
    onSearchTermChange,
    // --- End New Search Props ---
    // --- END MODIFICATION ---
    facetFilterOptions = {},
    // --- NEW ---
    dateFilterColumns = [], // Default to empty array
    // -----------
    showExportButton = false,
    onExport,
    exportFileName = 'data_export',
    toolbarActions,
    className,
    showRowSelection = false,

}: DataTableProps<TData>) {

    const searchInputId = React.useId();

    const currentSearchFieldConfig = React.useMemo(
        () => searchFieldOptions?.find(opt => opt.value === selectedSearchField) || searchFieldOptions?.[0],
        [selectedSearchField, searchFieldOptions]
    );

    const currentSearchPlaceholder = React.useMemo(
        () => currentSearchFieldConfig?.placeholder || `Search by ${currentSearchFieldConfig?.label || '...'}`,
        [currentSearchFieldConfig]
    );


    // --- Default Export Handler ---
    const handleDefaultExport = React.useCallback(() => {
        if (isLoading || table.getRowModel().rows.length === 0) {
            toast({ title: "Export", description: "No data available or still loading.", variant: "default" });
            return;
        }

        let dataToExport: TData[];
        const selectedRows = table.getSelectedRowModel().rows;

        if (showRowSelection) {
            dataToExport = selectedRows.map(row => row.original);
        } else {
            // Export all currently rendered rows in the table (respects client-side pagination if any, or all fetched if server-paginated)
            dataToExport = table.getRowModel().rows.map(row => row.original);
        }

        if (!dataToExport || dataToExport.length === 0) {
            toast({ title: "Export", description: `No data to export.`, variant: "default" });
            return;
        }

        try {
            // Use userDefinedColumns for export to respect what the user configured for display
            const exportableColumns = userDefinedColumns.filter(col =>
                (col.header || (col as any).accessorKey) && !(col.meta as any)?.excludeFromExport
            );
            exportToCsv(exportFileName, dataToExport, exportableColumns); // Use your generic utility
            toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.`, variant: "success"});
            if (showRowSelection) {
                table.resetRowSelection(true); // Clear selection after export
            }
        } catch (error) {
            console.error("Default export failed:", error);
            toast({ title: "Export Error", description: "Could not generate CSV file.", variant: "destructive"});
        }
    }, [isLoading, table, showRowSelection, userDefinedColumns, exportFileName, toast]);

    // --- Determine actual onExport handler ---
    const effectiveOnExport = React.useMemo(() => {
        if (onExport === 'default') return handleDefaultExport;
        return onExport; // Could be undefined or a custom function
    }, [onExport, handleDefaultExport]);


    // --- Prepare columns for rendering, conditionally adding selection column ---
    // const tableColumns = React.useMemo(() => {
    //     if (showRowSelection) {
    //         const selectionColumn: ColumnDef<TData, any> = {
    //             id: 'select',
    //             header: ({ table: currentTable }) => {
    //                 // Enhanced select-all logic (from your AccountantTabs)
    //                 const WritableRows = currentTable.getCoreRowModel().rows.filter(row => {
    //                     const isRowSelectable = typeof table.options.enableRowSelection === 'function'
    //                         // @ts-ignore // TODO: type row.original properly if needed
    //                         ? table.options.enableRowSelection(row as Row<TData>)
    //                         : true;
    //                     return isRowSelectable;
    //                 });
    //                 const isAllWritableSelected = WritableRows.length > 0 && WritableRows.every(row => row.getIsSelected());
    //                 const isSomeWritableSelected = WritableRows.some(row => row.getIsSelected());

    //                 return (
    //                     <Checkbox
    //                         checked={isAllWritableSelected ? true : (isSomeWritableSelected ? "indeterminate" : false)}
    //                         onCheckedChange={(value) => WritableRows.forEach(row => row.toggleSelected(!!value))}
    //                         aria-label="Select all writable rows"
    //                         disabled={WritableRows.length === 0}
    //                     />
    //                 );
    //             },
    //             cell: ({ row }) => {
    //                 const isRowSelectable = typeof table.options.enableRowSelection === 'function'
    //                      // @ts-ignore // TODO: type row.original properly if needed
    //                     ? table.options.enableRowSelection(row as Row<TData>)
    //                     : true;
    //                 return (
    //                     <Checkbox
    //                         checked={row.getIsSelected()}
    //                         onCheckedChange={(value) => row.toggleSelected(!!value)}
    //                         aria-label="Select row"
    //                         disabled={!isRowSelectable}
    //                     />
    //                 );
    //             },
    //             enableSorting: false, enableHiding: false, size: 40,
    //         };
    //         return [selectionColumn, ...columns];
    //     }
    //     return columns;
    // }, [showRowSelection, columns, table.options.enableRowSelection]);


    // --- Conditionally add selection column ---
    // const tableColumns = React.useMemo(() => {
    //     if (showRowSelection) {
    //         const selectionColumn: ColumnDef<TData, any> = {
    //             id: 'select',
    //             header: ({ table: currentTableInstance }) => {
    //                 // Filter rows based on the `enableRowSelection` function if provided by table options
    //                 const selectableRows = currentTableInstance.getCoreRowModel().rows.filter(row =>
    //                     typeof currentTableInstance.options.enableRowSelection === 'function'
    //                         ? currentTableInstance.options.enableRowSelection(row)
    //                         : true
    //                 );
    //                 const isAllSelectableSelected = selectableRows.length > 0 && selectableRows.every(row => row.getIsSelected());
    //                 // Check if some, but not all, of the selectable rows are selected
    //                 const isSomeSelectableSelected = selectableRows.some(row => row.getIsSelected()) && !isAllSelectableSelected;

    //                 return (
    //                     <Checkbox
    //                         checked={isAllSelectableSelected ? true : (isSomeSelectableSelected ? "indeterminate" : false)}
    //                         onCheckedChange={(value) => {
    //                             // Only toggle the selection state of rows that are actually selectable
    //                             selectableRows.forEach(row => row.toggleSelected(!!value));
    //                         }}
    //                         aria-label="Select all selectable rows"
    //                         disabled={selectableRows.length === 0} // Disable if no rows can be selected
    //                     />
    //                 );
    //             },
    //             cell: ({ row }) => {
    //                 // Determine if this specific row can be selected based on table options
    //                 const canSelectRow = typeof table.options.enableRowSelection === 'function'
    //                     ? table.options.enableRowSelection(row)
    //                     : true; // Default to true if no function provided

    //                 return (
    //                     <Checkbox
    //                         checked={row.getIsSelected()}
    //                         onCheckedChange={(value) => row.toggleSelected(!!value)}
    //                         aria-label="Select row"
    //                         disabled={!canSelectRow} // Disable checkbox if row cannot be selected
    //                     />
    //                 );
    //             },
    //             enableSorting: false, enableHiding: false, size: 40, meta : {
    //                 excludeFromExport: true
    //             }
    //         };
    //         return [selectionColumn, ...userDefinedColumns];
    //     }
    //     return userDefinedColumns;
    // }, [showRowSelection, userDefinedColumns, table.options.enableRowSelection]);

    // Determine if the selection column should actually be rendered
    // based on the prop AND if the table instance has selection enabled.
    const shouldRenderSelectionColumn = showRowSelection && table.options.enableRowSelection;

    return (
        <div className={`space-y-4 ${className}`}>
            {/* --- Toolbar --- */}
            <div className="flex flex-wrap items-center justify-between gap-4 py-4">
                {/* Targeted Search */}
                <div className="flex items-center gap-2 flex-grow sm:flex-grow-0 sm:w-auto">
                     {/* <Input
                        id={globalFilterInputId}
                        placeholder={searchPlaceholder}
                        value={globalFilterValue}
                        onChange={(e) => onGlobalFilterChange(e.target.value)}
                        className="h-9 w-full sm:w-[250px] lg:w-[300px]" // Responsive width
                        aria-label={searchPlaceholder}
                        aria-describedby={globalSearchCheckboxId} // Link to checkbox description
                    /> */}
                    {searchFieldOptions && searchFieldOptions.length > 0 && (
                        <Select value={selectedSearchField} onValueChange={onSelectedSearchFieldChange}>
                            <SelectTrigger className="w-auto min-w-[150px] h-9 data_table_search_field_select">
                                <SelectValue placeholder="Select field" />
                            </SelectTrigger>
                            <SelectContent>
                                {searchFieldOptions.map(option => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                    <Input
                        id={searchInputId}
                        placeholder={currentSearchPlaceholder}
                        value={searchTerm}
                        onChange={(e) => onSearchTermChange(e.target.value)}
                        className="h-9 w-full sm:w-[250px] lg:w-[300px]"
                        aria-label={currentSearchPlaceholder}
                    />
                    {/* <div className="flex items-center space-x-2">
                         <Checkbox
                            id={globalSearchCheckboxId}
                            checked={globalSearchConfig.isEnabled}
                            onCheckedChange={globalSearchConfig.toggle} // Use onCheckedChange for Shadcn Checkbox
                        />
                        <Label htmlFor={globalSearchCheckboxId} className="text-sm font-medium cursor-pointer whitespace-nowrap">
                            Global Search
                        </Label>
                    </div> */}

                    {/* Conditionally render Item Search Toggle */}
                    {/* {showItemSearchToggle && (
                         <div className="flex items-center space-x-2">
                            <Checkbox
                                id={itemSearchCheckboxId}
                                checked={itemSearchConfig.isEnabled}
                                onCheckedChange={itemSearchConfig.toggle}
                            />
                            <Label htmlFor={itemSearchCheckboxId} className="text-sm font-medium cursor-pointer whitespace-nowrap">
                                {itemSearchConfig.label ?? "Item Search"} 
                            </Label>
                        </div>
                     )} */}
                </div>

                {/* Faceted Filters (Rendered in Header now) & View Options */}
                 <div className="flex items-center gap-2">
                      {/* Render custom toolbar actions passed via props */}
                     {toolbarActions}

                     {/* Export Button - Simplified */}
                     {showExportButton && onExport && (
                        <Button
                            onClick={effectiveOnExport}
                             // Disable if no rows selected? Needs table.getFilteredSelectedRowModel().rows.length > 0
                            // disabled={isLoading || table.getCoreRowModel().rows.length === 0}
                            disabled={
                                isLoading ||
                                table.getRowModel().rows.length === 0 || // No data at all
                                (showRowSelection && table.getSelectedRowModel().rows.length === 0) // If custom export AND selection shown AND nothing selected
                            }

                            variant="outline"
                            size="sm" // Smaller button
                            className="data_table_export_button h-9" // Consistent height
                         >
                            <FileUp className="mr-2 h-4 w-4" />
                             Export {showRowSelection ? "Selected" : ""}
                         </Button>
                     )}

                     {/* Keep View Options */}
                    <DataTableViewOptions table={table} />
                 </div>
            </div>

             {/* --- Error Display --- */}
             {error && (
                 <div className="p-4 text-center text-red-600 bg-red-100 border border-red-300 rounded-md">
                     Error fetching data: {error.message}
                 </div>
             )}

            {/* --- Table --- */}
            <div className="rounded-md border overflow-x-auto relative max-h-[70vh] overflow-y-auto"> {/* overflow-x-auto for responsiveness */}

                <Table className="min-w-full">
                    <TableHeader className="sticky top-0 z-10 bg-red-50 shadow-sm">
                        {table.getHeaderGroups().map((headerGroup: HeaderGroup<TData>) => (
                            <TableRow key={headerGroup.id}>
                                {/* --- Render Selection Header Conditionally --- */}
                                {shouldRenderSelectionColumn && (
                                    <TableHead className="w-[40px] px-2">
                                        <Checkbox
                                            checked={
                                                table.getIsAllPageRowsSelected()
                                                    ? true
                                                    : table.getIsSomePageRowsSelected()
                                                        ? "indeterminate"
                                                        : false
                                            }
                                            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                                            aria-label="Select all rows on current page"
                                            // Select all should respect individual row selectability if `enableRowSelection` was a function
                                            // TanStack Table handles this internally if `enableRowSelection` is a function.
                                            // If you need more custom logic for "select all writable", it needs to be here.
                                        />
                                    </TableHead>
                                )}
                                {/* --- Render User-Defined Column Headers --- */}
                                {headerGroup.headers.map((header) => {
                                    // Skip rendering the 'select' header again if we manually added it
                                    if (shouldRenderSelectionColumn && header.id === 'select') return null;

                                    const columnInstance = header.column;
                                    const canShowFacetedFilter = facetFilterOptions?.[columnInstance.id];
                                    const canShowDateFilter = dateFilterColumns.includes(columnInstance.id);
                                    return (
                                        <TableHead key={header.id} colSpan={header.colSpan} style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}>
                                            {!header.isPlaceholder && ( 
                                                <div className="flex items-center gap-1">
                                                {canShowFacetedFilter && ( <DataTableFacetedFilter column={columnInstance!} title={facetFilterOptions[header.column.id]!.title} options={facetFilterOptions[header.column.id]!.options} /> )}
                                                {canShowDateFilter && ( <DataTableDateFilter column={columnInstance!} title={header.column.columnDef.header as string || header.column.id} /> )}
                                                {flexRender(header.column.columnDef.header, header.getContext())}
                                            </div>
                                             )}
                                        </TableHead>
                                    );
                                })}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {isLoading ? ( <TableBodySkeleton shouldRenderSelectionColumn={shouldRenderSelectionColumn} colSpan={table.getAllFlatColumns().length} rows={table.getState().pagination.pageSize} />
                        ) : table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow key={(row.original as any)?.name || row.id} data-state={row.getIsSelected() && 'selected'}>
                                    {/* --- Render Selection Cell Conditionally --- */}
                                    {shouldRenderSelectionColumn && (
                                        <TableCell className="px-2">
                                            <Checkbox
                                                checked={row.getIsSelected()}
                                                onCheckedChange={(value) => row.toggleSelected(!!value)}
                                                aria-label="Select row"
                                                // Respect if row is individually disabled by enableRowSelection function
                                                disabled={!row.getCanSelect()}
                                            />
                                        </TableCell>
                                    )}
                                    {/* --- Render User-Defined Column Cells --- */}
                                    {row.getVisibleCells().map((cell) => {
                                        // Skip rendering the 'select' cell again if we manually added it
                                        if (shouldRenderSelectionColumn && cell.column.id === 'select') return null;
                                        return (
                                            <TableCell className="p-2" key={cell.id} style={{ 
                                                // width: cell.column.getSize() !== 150 ? cell.column.getSize() : undefined 
                                                width: cell.column.getSize()
                                                
                                            }}
                                            >
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </TableCell>
                                        );
                                    })}
                                </TableRow>
                            ))
                        ) : ( <TableRow><TableCell colSpan={table.getAllFlatColumns().length} className="h-24 text-center">No results found.</TableCell></TableRow> )}
                    </TableBody>
                </Table>
            </div>

            {/* --- Pagination --- */}
            <DataTablePagination
                table={table}
                totalCount={totalCount}
                isLoading={isLoading}
            />
        </div>
    );
}