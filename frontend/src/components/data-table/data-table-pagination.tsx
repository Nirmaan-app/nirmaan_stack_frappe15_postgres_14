// import {
//   ChevronLeftIcon,
//   ChevronRightIcon,
//   DoubleArrowLeftIcon,
//   DoubleArrowRightIcon,
// } from "@radix-ui/react-icons";
// import { Table } from "@tanstack/react-table";

// import { Button } from "@/components/ui/button";
// import {
//   Select,
//   SelectContent,
//   SelectItem,
//   SelectTrigger,
//   SelectValue,
// } from "@/components/ui/select";
// import { useUrlParam } from "@/hooks/useUrlParam";
// import { useMemo } from "react";

// interface DataTablePaginationProps<TData> {
//   table: Table<TData>;
//   onPageSizeChange: any;
//   onPageChange: any;
//   totalItems: number;
//   loading: boolean;
// }

// export function DataTablePagination<TData>({
//   table,
//   onPageChange,
//   onPageSizeChange,
//   totalItems,
//   loading
// }: DataTablePaginationProps<TData>) {
//   // // Initialize pagination state from URL
//   // useEffect(() => {
//   //   const urlParams = new URLSearchParams(window.location.search);
//   //   const pageIndex = Number(urlParams.get("pageIdx") || "0");
//   //   const pageSize = Number(urlParams.get("rows") || "10");

//   //   table.setPageIndex(pageIndex);
//   //   table.setPageSize(pageSize);
//   // }, [table]);

//   // // Update URL search params
//   // const updateURL = (key: string, value: string | number) => {
//   //   const url = new URL(window.location.href);
//   //   url.searchParams.set(key, value.toString());
//   //   window.history.pushState({}, "", url);
//   // };

//   // const [pageSize] = useStateSyncedWithParams("rows", "10");
//   // const [pageIndex] = useStateSyncedWithParams("pageIdx", "0");

//   const pageSize = useUrlParam("rows") || "10";
//   const pageIndex = useUrlParam("pageIdx") || "0";
//   // const pageCount = Math.ceil(totalItems / table.getState().pagination.pageSize);
//   const pageCount = useMemo(() => Math.ceil(totalItems / parseInt(pageSize)), [totalItems, pageSize]);

//   return (
//     <div className="flex max-md:flex-col space-y-2 items-center md:justify-between">
//       <div className="flex-1 text-sm text-muted-foreground">
//       {loading ? (
//           <div className="animate-pulse w-40 h-4 bg-gray-200 rounded" />
//         ) : (
//           `${table.getFilteredSelectedRowModel().rows.length} of ${totalItems} row(s) selected.`
//         )}
//       </div>

//       {/* Pagination Controls */}
//       <div className="flex max-md:justify-between max-md:w-full">
//         <div className="flex items-center space-x-6 lg:space-x-8">
//           <div className="flex items-center space-x-2">
//             <p className="text-sm font-medium">Rows per page</p>
//             {loading ? (
//               <div className="animate-pulse w-[70px] h-8 bg-gray-200 rounded" />
//             ) : (
//               <Select
//               value={`${parseInt(pageSize)}`}
//               onValueChange={(value) => {
//                 // table.setPageSize(Number(value));
//                 // updateURL("rows", value);
//                 onPageSizeChange(value)
//               }}
//             >
//               <SelectTrigger className="h-8 w-[70px]">
//                 <SelectValue placeholder={parseInt(pageSize)} />
//               </SelectTrigger>
//               <SelectContent side="top">
//                 {[10, 50, 100, 200, 500].map((pageSize) => (
//                   <SelectItem key={pageSize} value={`${pageSize}`}>
//                     {pageSize}
//                   </SelectItem>
//                 ))}
//               </SelectContent>
//             </Select>
//             )}
//           </div>
//         </div>


//         <div className="flex">
//           <div className="flex w-[100px] items-center justify-center text-sm font-medium">
//           {loading ? (
//               <div className="animate-pulse w-full h-4 bg-gray-200 rounded" />
//             ) : (
//               `Page ${parseInt(pageIndex) + 1} of ${pageCount}`
//             )}
//           </div>

//           {/* Pagination Buttons */}
//           <div className="flex items-center space-x-2">
//           {loading ? (
//               [...Array(4)].map((_, i) => (
//                 <div key={i} className="animate-pulse w-8 h-8 bg-gray-200 rounded" />
//               ))
//             ) : (
//               <>
//               <Button
//               variant="outline"
//               className="hidden h-8 w-8 p-0 lg:flex"
//               onClick={() => {
//                 // table.setPageIndex(0);
//                 // updateURL("pageIdx", 0);
//                 onPageChange(0)
//               }}
//               // disabled={!table.getCanPreviousPage()}
//               // disabled={table.getState().pagination.pageIndex === 0}
//               disabled={parseInt(pageIndex) === 0}
//             >
//               <span className="sr-only">Go to first page</span>
//               <DoubleArrowLeftIcon className="h-4 w-4" />
//             </Button>
//             <Button
//               variant="outline"
//               className="h-8 w-8 p-0"
//               onClick={() => {
//                 // table.previousPage();
//                 // updateURL("pageIdx", table.getState().pagination.pageIndex - 1);
//                 // onPageChange(table.getState().pagination.pageIndex - 1)
//                 onPageChange(parseInt(pageIndex) - 1)
//               }}
//               // disabled={!table.getCanPreviousPage()}
//               // disabled={table.getState().pagination.pageIndex === 0}
//               disabled={parseInt(pageIndex) === 0}
//             >
//               <span className="sr-only">Go to previous page</span>
//               <ChevronLeftIcon className="h-4 w-4" />
//             </Button>
//             <Button
//               variant="outline"
//               className="h-8 w-8 p-0"
//               onClick={() => {
//                 // table.nextPage();
//                 // updateURL("pageIdx", table.getState().pagination.pageIndex + 1);
//                 // onPageChange(table.getState().pagination.pageIndex + 1)
//                 onPageChange(parseInt(pageIndex) + 1)
//               }}
//               // disabled={!table.getCanNextPage()}
//               // disabled={table.getState().pagination.pageIndex >= pageCount - 1}
//               disabled={parseInt(pageIndex) >= pageCount - 1}
//             >
//               <span className="sr-only">Go to next page</span>
//               <ChevronRightIcon className="h-4 w-4" />
//             </Button>
//             <Button
//               variant="outline"
//               className="hidden h-8 w-8 p-0 lg:flex"
//               onClick={() => {
//                 // const lastPage = table.getPageCount() - 1;
//                 const lastPage = pageCount - 1;
//                 // table.setPageIndex(lastPage);
//                 // updateURL("pageIdx", lastPage);
//                 onPageChange(lastPage)
//               }}
//               // disabled={!table.getCanNextPage()}
//               // disabled={table.getState().pagination.pageIndex >= pageCount - 1}
//               disabled={parseInt(pageIndex) >= pageCount - 1}
//             >
//               <span className="sr-only">Go to last page</span>
//               <DoubleArrowRightIcon className="h-4 w-4" />
//             </Button>
//             </>
//             )}
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// }


// src/components/data-table/data-table-pagination.tsx
import { Table } from '@tanstack/react-table';
import {
    ChevronLeftIcon,
    ChevronRightIcon,
    DoubleArrowLeftIcon,
    DoubleArrowRightIcon,
} from '@radix-ui/react-icons';

import { Button } from '@/components/ui/button'; // Adjust path
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'; // Adjust path

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
    pageSizeOptions = [10, 20, 30, 40, 50, 500], // Default options
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
