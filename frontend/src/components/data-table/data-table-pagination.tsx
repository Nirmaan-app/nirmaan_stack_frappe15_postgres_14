import { Table } from '@tanstack/react-table';
import {
    ChevronLeftIcon,
    ChevronRightIcon,
    DoubleArrowLeftIcon,
    DoubleArrowRightIcon,
} from '@radix-ui/react-icons';

import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

interface DataTablePaginationProps<TData> {
    table: Table<TData>;
    totalCount: number; // Receive total count directly
    isLoading?: boolean; // Receive loading state
    pageSizeOptions?: number[]; // Optional: Customize page size options
}

export function DataTablePagination<TData>({
    table,
    totalCount,
    isLoading = false,
    pageSizeOptions = [50, 100, 500, 1000, 2000, 5000, 10000], // Default options
}: DataTablePaginationProps<TData>) {

    const pagination = table.getState().pagination;
    const pageCount = table.getPageCount(); // Calculated by the hook based on totalCount

    // Calculate start and end item numbers
    const startItem = totalCount === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
    const endItem = Math.min((pagination.pageIndex + 1) * pagination.pageSize, totalCount);

    return (
        <div className="flex flex-col sm:flex-row items-center justify-between px-2 gap-4 sm:gap-8">
            {/* Row Selection Info */}
            <div className="flex-1 text-sm text-muted-foreground">
                {table.getFilteredSelectedRowModel().rows.length > 0 && (
                    <span>
                        {table.getFilteredSelectedRowModel().rows.length} of{' '}
                        {totalCount} row(s) selected.
                    </span>
                )}
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6 lg:gap-8">
                {/* Page Size Selector */}
                <div className="flex items-center space-x-2">
                    <p className="text-sm font-medium whitespace-nowrap">Rows per page</p>
                    <Select
                        value={`${pagination.pageSize}`}
                        onValueChange={(value) => {
                            table.setPageSize(Number(value));
                        }}
                        disabled={isLoading} // Disable when loading
                    >
                        <SelectTrigger className="h-8 w-[70px]">
                            <SelectValue placeholder={pagination.pageSize} />
                        </SelectTrigger>
                        <SelectContent side="top">
                            {pageSizeOptions.map((size) => (
                                <SelectItem key={size} value={`${size}`}>
                                    {size}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Page Indicator */}
                <div className="flex w-[130px] items-center justify-center text-sm font-medium whitespace-nowrap">
                    Page {totalCount === 0 ? 0 : pagination.pageIndex + 1} of{' '}
                    {pageCount} ({startItem}-{endItem} of {totalCount})
                </div>

                {/* Navigation Buttons */}
                <div className="flex items-center space-x-2">
                    <Button
                        variant="outline"
                        className="hidden h-8 w-8 p-0 lg:flex"
                        onClick={() => table.setPageIndex(0)}
                        disabled={!table.getCanPreviousPage() || isLoading}
                    >
                        <span className="sr-only">Go to first page</span>
                        <DoubleArrowLeftIcon className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() => table.previousPage()}
                        disabled={!table.getCanPreviousPage() || isLoading}
                    >
                        <span className="sr-only">Go to previous page</span>
                        <ChevronLeftIcon className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage() || isLoading}
                    >
                        <span className="sr-only">Go to next page</span>
                        <ChevronRightIcon className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        className="hidden h-8 w-8 p-0 lg:flex"
                        onClick={() => table.setPageIndex(pageCount - 1)}
                        disabled={!table.getCanNextPage() || isLoading}
                    >
                        <span className="sr-only">Go to last page</span>
                        <DoubleArrowRightIcon className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
