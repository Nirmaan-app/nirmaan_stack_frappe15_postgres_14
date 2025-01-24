import React, { useEffect } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
} from "@radix-ui/react-icons";
import { Table } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  onPageSizeChange: any;
  onPageChange: any;
}

export function DataTablePagination<TData>({
  table,
  onPageChange,
  onPageSizeChange
}: DataTablePaginationProps<TData>) {
  // // Initialize pagination state from URL
  // useEffect(() => {
  //   const urlParams = new URLSearchParams(window.location.search);
  //   const pageIndex = Number(urlParams.get("pageIdx") || "0");
  //   const pageSize = Number(urlParams.get("rows") || "10");

  //   table.setPageIndex(pageIndex);
  //   table.setPageSize(pageSize);
  // }, [table]);

  // // Update URL search params
  // const updateURL = (key: string, value: string | number) => {
  //   const url = new URL(window.location.href);
  //   url.searchParams.set(key, value.toString());
  //   window.history.pushState({}, "", url);
  // };

  return (
    <div className="flex max-md:flex-col space-y-2 items-center md:justify-between">
      <div className="flex-1 text-sm text-muted-foreground">
        {table.getFilteredSelectedRowModel().rows.length} of{" "}
        {table.getFilteredRowModel().rows.length} row(s) selected.
      </div>
      <div className="flex max-md:justify-between max-md:w-full">
        <div className="flex items-center space-x-6 lg:space-x-8">
          <div className="flex items-center space-x-2">
            <p className="text-sm font-medium">Rows per page</p>
            <Select
              value={`${table.getState().pagination.pageSize}`}
              onValueChange={(value) => {
                table.setPageSize(Number(value));
                // updateURL("rows", value);
                onPageSizeChange(value)
              }}
            >
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue placeholder={table.getState().pagination.pageSize} />
              </SelectTrigger>
              <SelectContent side="top">
                {[10, 50, 100, 200, 500].map((pageSize) => (
                  <SelectItem key={pageSize} value={`${pageSize}`}>
                    {pageSize}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex">
          <div className="flex w-[100px] items-center justify-center text-sm font-medium">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              className="hidden h-8 w-8 p-0 lg:flex"
              onClick={() => {
                table.setPageIndex(0);
                // updateURL("pageIdx", 0);
                onPageChange(0)
              }}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Go to first page</span>
              <DoubleArrowLeftIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={() => {
                table.previousPage();
                // updateURL("pageIdx", table.getState().pagination.pageIndex - 1);
                onPageChange(table.getState().pagination.pageIndex - 1)
              }}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Go to previous page</span>
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={() => {
                table.nextPage();
                // updateURL("pageIdx", table.getState().pagination.pageIndex + 1);
                onPageChange(table.getState().pagination.pageIndex + 1)
              }}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Go to next page</span>
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="hidden h-8 w-8 p-0 lg:flex"
              onClick={() => {
                const lastPage = table.getPageCount() - 1;
                table.setPageIndex(lastPage);
                // updateURL("pageIdx", lastPage);
                onPageChange(lastPage)
              }}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Go to last page</span>
              <DoubleArrowRightIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
