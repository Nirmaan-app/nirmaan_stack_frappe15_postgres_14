import * as React from 'react';
import {
    Table as TanstackTableInstance, // Rename to avoid conflict
    flexRender,
    ColumnDef, // Import ColumnDef type
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
import { Checkbox } from '@/components/ui/checkbox'; // Assuming you have this from shadcn/ui
import { Label } from '@/components/ui/label';
import { DataTablePagination } from './data-table-pagination'; // Adjust path
import { DataTableViewOptions } from './data-table-view-options'; // Adjust path
import { DataTableFacetedFilter } from './data-table-faceted-filter'; // Adjust path
import { TableBodySkeleton } from '@/components/ui/skeleton'; // Adjust path
import { Button } from '../ui/button';

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
    /** Current value of the global filter input. */
    globalFilterValue: string;
    /** Callback to update the global filter state in the hook. */
    onGlobalFilterChange: (value: string) => void;
    /** Configuration for the global search toggle. */
    globalSearchConfig: {
        isEnabled: boolean;
        toggle: () => void;
        /** Placeholder text when global search is enabled */
        globalPlaceholder?: string;
         /** Placeholder text when specific field search is enabled */
        specificPlaceholder?: string;
    };
    /** Optional: Options for various faceted filters. Passed down to DataTableFacetedFilter. */
    facetFilterOptions?: {
        [columnId: string]: { title: string; options: { label: string; value: string; icon?: React.ComponentType<{ className?: string }> }[] } | undefined;
    };
    /** Optional: Show export button and related dialog logic */
    showExport?: boolean;
    onExport?: () => void; // Callback to handle export logic
    /** Optional: Show other custom buttons or elements in the toolbar */
    toolbarActions?: React.ReactNode;
    /** Optional: className for the container div */
    className?: string;
}

// --- Component ---
export function DataTable<TData>({
    table,
    columns, // Receive columns to help with rendering structure/colspan
    isLoading,
    error,
    totalCount,
    globalFilterValue,
    onGlobalFilterChange,
    globalSearchConfig,
    facetFilterOptions = {},
    showExport = false,
    onExport,
    toolbarActions,
    className,
}: DataTableProps<TData>) {

    // Use React.useId for accessibility linking if needed
    const globalSearchCheckboxId = React.useId();
    const globalFilterInputId = React.useId();

    // Memoize the placeholder to avoid re-renders on every input change
    const searchPlaceholder = React.useMemo(() => {
        return globalSearchConfig.isEnabled
            ? (globalSearchConfig.globalPlaceholder ?? "Search all fields...")
            : (globalSearchConfig.specificPlaceholder ?? "Search specific field...");
     }, [globalSearchConfig.isEnabled, globalSearchConfig.globalPlaceholder, globalSearchConfig.specificPlaceholder]);


    return (
        <div className={`space-y-4 ${className}`}>
            {/* --- Toolbar --- */}
            <div className="flex flex-wrap items-center justify-between gap-4 py-4">
                {/* Search Input & Global Toggle */}
                <div className="flex items-center gap-2 flex-grow sm:flex-grow-0 sm:w-auto">
                     <Input
                        id={globalFilterInputId}
                        placeholder={searchPlaceholder}
                        value={globalFilterValue}
                        onChange={(e) => onGlobalFilterChange(e.target.value)}
                        className="h-9 w-full sm:w-[250px] lg:w-[300px]" // Responsive width
                        aria-label={searchPlaceholder}
                        aria-describedby={globalSearchCheckboxId} // Link to checkbox description
                    />
                    <div className="flex items-center space-x-2">
                         <Checkbox
                            id={globalSearchCheckboxId}
                            checked={globalSearchConfig.isEnabled}
                            onCheckedChange={globalSearchConfig.toggle} // Use onCheckedChange for Shadcn Checkbox
                        />
                        <Label htmlFor={globalSearchCheckboxId} className="text-sm font-medium cursor-pointer whitespace-nowrap">
                            Global Search
                        </Label>
                    </div>
                </div>

                {/* Faceted Filters (Rendered in Header now) & View Options */}
                 <div className="flex items-center gap-2">
                      {/* Render custom toolbar actions passed via props */}
                     {toolbarActions}

                     {/* Export Button - Simplified */}
                     {showExport && onExport && (
                        <Button
                            onClick={onExport}
                             // Disable if no rows selected? Needs table.getFilteredSelectedRowModel().rows.length > 0
                            disabled={table.getFilteredSelectedRowModel().rows.length === 0}
                            variant="outline"
                            size="sm" // Smaller button
                            className="ml-auto h-9" // Consistent height
                         >
                             Export Selected
                             {/* Add Icon if desired */}
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
            <div className="rounded-md border overflow-x-auto relative"> {/* overflow-x-auto for responsiveness */}
                <Table className="min-w-full">
                    <TableHeader className="sticky top-0 z-10 bg-background shadow-sm"> {/* Sticky header */}
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => (
                                    <TableHead key={header.id} colSpan={header.colSpan} style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}>
                                        {header.isPlaceholder ? null : (
                                            <div className="flex items-center gap-2">
                                                 {/* Render Faceted Filters Here */}
                                                 {facetFilterOptions?.[header.column.id] && table.getColumn(header.column.id) && (
                                                     <DataTableFacetedFilter
                                                         // Pass column instance for potential client-side interactions (like getting unique values)
                                                         // but the actual filtering happens server-side via URL params
                                                         column={table.getColumn(header.column.id)}
                                                         title={facetFilterOptions[header.column.id]!.title}
                                                         options={facetFilterOptions[header.column.id]!.options}
                                                         // Identifier for URL state management
                                                         urlSyncKey={header.column.id} // Use column ID as key for URL param
                                                     />
                                                 )}

                                                 {/* Render Header Content (e.g., DataTableColumnHeader) */}
                                                 {flexRender(
                                                     header.column.columnDef.header,
                                                     header.getContext()
                                                 )}
                                             </div>
                                        )}
                                    </TableHead>
                                ))}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            // Pass column count for accurate skeleton rendering
                            <TableBodySkeleton colSpan={table.getAllColumns().length} rows={table.getState().pagination.pageSize} />
                        ) : table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    data-state={row.getIsSelected() && 'selected'}
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id} style={{ width: cell.column.getSize() !== 150 ? cell.column.getSize() : undefined }}>
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext()
                                            )}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell
                                    // Use table.getAllColumns().length for correct colspan
                                    colSpan={table.getAllColumns().length}
                                    className="h-24 text-center"
                                >
                                    No results found.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* --- Pagination --- */}
            <DataTablePagination
                table={table}
                totalCount={totalCount}
                isLoading={isLoading} // Pass loading state to potentially disable controls
            />
        </div>
    );
}