import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  Table as TanstackTable,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDialogStore } from "@/zustand/useDialogStore";
import { debounce } from "lodash";
import * as React from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import { fuzzyFilter } from "./data-table-models";
import { DataTableViewOptions } from "./data-table-view-options";
import { ReportType, useReportStore } from "@/pages/reports/store/useReportStore";

type OptionsType = {
  label: string;
  value: string;
};

// Define the type for the new prop
type ExportDataGetter<TData> = (reportType: ReportType, allData: TData[]) => TData[];

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  loading?: boolean;
  error?: any;
  project_values?: OptionsType[];
  category_options?: OptionsType[];
  vendorOptions?: OptionsType[];
  projectTypeOptions?: OptionsType[];
  roleTypeOptions?: OptionsType[];
  statusOptions?: OptionsType[];
  approvedQuotesVendors?: OptionsType[];
  itemOptions?: OptionsType[];
  wpOptions?: OptionsType[];
  projectStatusOptions?: OptionsType[];
  customerOptions?: OptionsType[];
  totalPOsRaised?: any;
  itemSearch?: boolean;
  sortColumn?: string;
  onExport?: () => void; // Callback to handle export logic
}

export function DataTable<TData, TValue>({
  loading = false,
  columns,
  data,
  project_values,
  category_options,
  vendorOptions = undefined,
  projectTypeOptions = undefined,
  roleTypeOptions = undefined,
  statusOptions = undefined,
  totalPOsRaised = undefined,
  itemSearch = false,
  approvedQuotesVendors = undefined,
  itemOptions = undefined,
  wpOptions = undefined,
  projectStatusOptions = undefined,
  customerOptions = undefined,
  sortColumn = undefined,
  onExport
}: DataTableProps<TData, TValue>) {

  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = React.useState({});


  // const [pageIndex, setPageIndex] = React.useState(0);
  // const [pageSize, setPageSize] = React.useState(10);

  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({ type: false, });

  // --- Global Filter State Management with URL Sync ---
  const initialSearchFromUrl = useUrlParam("search") || ""; // Get initial value using your hook
  const [globalFilter, setGlobalFilter] = React.useState<string>(initialSearchFromUrl);

  // Debounced function to update URL
  const debouncedUpdateUrlSearch = React.useCallback(
    debounce((value: string) => {
      urlStateManager.updateParam("search", value || null); // Pass null to delete if empty
    }, 500), // Adjust debounce delay as needed
    []
  );

  // Effect to update URL when local globalFilter changes
  React.useEffect(() => {
    debouncedUpdateUrlSearch(globalFilter);
  }, [globalFilter, debouncedUpdateUrlSearch]);


  // Effect to subscribe to URL changes for "search" and update local state
  React.useEffect(() => {
    const unsubscribe = urlStateManager.subscribe("search", (key, value) => {
      if (globalFilter !== (value || "")) { // Prevent loop if value is already same
        setGlobalFilter(value || "");
      }
    });
    // Ensure initial state is correct if useUrlParam provides initial value after first render
    const currentUrlSearch = urlStateManager.getParam("search");
    if (globalFilter !== (currentUrlSearch || "")) {
        setGlobalFilter(currentUrlSearch || "");
    }
    return unsubscribe;
  }, []); // Add globalFilter to dependencies to re-subscribe if it changes from other means (though unlikely here)
  // --- End Global Filter State Management ---

  React.useEffect(() => {
    if(columns) {
      columns.forEach(c => {
        if(c?.hide) {
          setColumnVisibility(prev => ({...prev, [c?.accessorKey]: false}))
        }
        if(c?.accessorKey === "creation" && (!sortColumn || sortColumn === "creation")) {
          setSorting([{
            id: "creation",
            desc: true,
          },])
        }
      })
      if(sortColumn && sorting.length === 0) {
        setSorting([{
          id: sortColumn,
          desc: true,
        },])
      }
    }
  }, [columns])

  const customGlobalFilter = React.useCallback((row: any, columnId: string, filterValue: string) => {
    const name = row.getValue("name");
    const vendorName = row.getValue("vendor_name");
    const orderList = row.getValue("order_list");

    const combinedString = `${name || ""} ${vendorName || ""} ${JSON.stringify(orderList) || ""
      }`.toLowerCase();

    return combinedString.includes(filterValue.toLowerCase());
  }, []);

  const table = useReactTable({
    data,
    columns,
    enableRowSelection: true,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(), // client-side faceting
    getFacetedRowModel: getFacetedRowModel(), // client-side faceting
    getFacetedUniqueValues: getFacetedUniqueValues(), // generate unique values for select filter/autocomplete
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: itemSearch ? customGlobalFilter : fuzzyFilter,
    state: {
      // pagination: { pageIndex, pageSize },
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter,
    },
    manualPagination: false,
  });



  // React.useEffect(() => {
  //   setSelectedData(table.getSelectedRowModel().rows)
  // }, [table.getSelectedRowModel().rows])

  // Show selected rows
  // ------------------
  // You can show the number of selected rows using the table.getFilteredSelectedRowModel() API.

  // <div className="flex-1 text-sm text-muted-foreground">
  //   {table.getFilteredSelectedRowModel().rows.length} of{" "}
  //   {table.getFilteredRowModel().rows.length} row(s) selected.
  // </div>

  return (
    <div className="space-y-4">
      {/* Look for data-table-toolbar in tasks example */}

      <div className="flex justify-between items-center">
        <div className="flex justify-between items-center py-4 w-full">
          <Input
            id="globalFilterInput"
            placeholder="Search..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)} // Update local state directly, useEffect handles debounced URL update

            className="w-[50%] max-sm:w-[60%]"
            // className="max-w-sm w-full sm:w-auto" // Responsive width
          />


          {/* Generic Export Button */}
          {onExport && (
              <Button
                  onClick={onExport}
                  variant="outline"
                  size="sm" // Smaller button
                  className="data_table_export_button h-9" // Consistent height
                  disabled={loading || data.length === 0}
              >
                  <FileUp className="mr-2 h-4 w-4" />
                  Export
              </Button>
          )}

          {/* <DataTableToolbar table={table} project_values={project_values} category_options={category_options} vendorOptions={vendorOptions} projectTypeOptions={projectTypeOptions} statusOptions={statusOptions} roleTypeOptions={roleTypeOptions}/> */}
        </div>
        
        {totalPOsRaised && (
          <div className="flex max-sm:text-xs max-md:text-sm max-sm:flex-wrap">
            <span className=" whitespace-nowrap">Total PO's raised</span>
            <span>: </span>
            <span className="max-sm:text-end max-sm:w-full text-primary">
              {totalPOsRaised}
            </span>
          </div>
        )}
      </div>

      <div className="rounded-md border max-h-[70vh] overflow-y-auto relative">
        <Table className="min-w-full">
          <TableHeader className="sticky top-0 bg-white z-10 bg-red-50">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                <DataTableViewOptions table={table} />
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead className="pl-4" key={header.id} colSpan={header.colSpan}>
                      {header.isPlaceholder ? null : (
                        <div className="flex items-center gap-2">

                          {/* Status Faceted Filters for PR Summary tab in Project page */}
                          {statusOptions &&
                            header.id ===
                            table.getColumn("workflow_state")?.id &&
                            (table.getColumn("workflow_state") ? (
                              <DataTableFacetedFilter
                                column={table.getColumn("workflow_state")}
                                title={"Status"}
                                options={statusOptions || []}
                              />
                            ) : null)}
                          
                          {/* Work Package Faceted Filters for PO Summary tab in Project page */}
                          {wpOptions &&
                            header.id === table.getColumn("wp")?.id &&
                            (table.getColumn("wp") ? (
                              <DataTableFacetedFilter
                                column={table.getColumn("wp")}
                                title={"Work Package"}
                                options={wpOptions || []}
                              />
                            ) : null)}

                          {/* Projects Faceted Filter */}
                          {project_values &&
                            header.id === table.getColumn("project")?.id &&
                            (table.getColumn("project") ? (
                              <DataTableFacetedFilter
                                column={table.getColumn("project")}
                                title={"Project"}
                                options={project_values || []}
                              />
                            ) : null)}

                          {/* Categories Faceted Filter for both Products table and Vendors table  */}
                          {category_options &&
                            table
                              .getAllColumns()
                              .map((item) => item.id)
                              .find((id) => id === "vendor_category") !==
                            undefined
                            ? header.id ===
                            table.getColumn("vendor_category")?.id && (
                              <DataTableFacetedFilter
                                column={table.getColumn("vendor_category")}
                                title={"Category"}
                                options={category_options || []}
                              />
                            )
                            : category_options &&
                              table
                                .getAllColumns()
                                .map((item) => item.id)
                                .find((id) => id === "category") !== undefined
                              ? header.id === table.getColumn("category")?.id && (
                                <DataTableFacetedFilter
                                  column={table.getColumn("category")}
                                  title={"Category"}
                                  options={category_options || []}
                                />
                              )
                              : null}

                          {/* Vendors Faceted Filter */}
                          {vendorOptions &&
                            header.id === table.getColumn("vendor_name")?.id &&
                            (table.getColumn("vendor_name") ? (
                              <DataTableFacetedFilter
                                column={table.getColumn("vendor_name")}
                                title={"Vendor"}
                                options={vendorOptions || []}
                              />
                            ) : null)}


                          {/* Approved Quotes Vendors Faceted Filter */}
                          {approvedQuotesVendors &&
                            header.id === table.getColumn("vendor")?.id &&
                            (table.getColumn("vendor") ? (
                              <DataTableFacetedFilter
                                column={table.getColumn("vendor")}
                                title={"Vendor"}
                                options={approvedQuotesVendors || []}
                              />
                            ) : null)}

                          
                          {/* Approved Quotes Items Faceted Filter */}
                          {itemOptions &&
                            header.id === table.getColumn("item_name")?.id &&
                            (table.getColumn("item_name") ? (
                              <DataTableFacetedFilter
                                column={table.getColumn("item_name")}
                                title={"Item"}
                                options={itemOptions || []}
                              />
                            ) : null)}


                          {/* Projects Table- Project Types Faceted Filter */}
                          {projectTypeOptions &&
                            header.id === table.getColumn("project_type")?.id &&
                            (table.getColumn("project_type") ? (
                              <DataTableFacetedFilter
                                column={table.getColumn("project_type")}
                                title={"Project Type"}
                                options={projectTypeOptions || []}
                              />
                            ) : null)}

                          {/* Roles Faceted Filter for Users Table */}
                          {roleTypeOptions &&
                            header.id === table.getColumn("role_profile")?.id &&
                            (table.getColumn("role_profile") ? (
                              <DataTableFacetedFilter
                                column={table.getColumn("role_profile")}
                                title={"Role"}
                                options={roleTypeOptions || []}
                              />
                            ) : null)}

                          {/* Statuses Faceted Filter for Projects Table */}
                          {projectStatusOptions &&
                            header.id === table.getColumn("status")?.id &&
                            (table.getColumn("status") ? (
                              <DataTableFacetedFilter
                                column={table.getColumn("status")}
                                title={"Status"}
                                options={projectStatusOptions || []}
                              />
                            ) : null)}
                          
                          {/* Customers Faceted Filter for In-Flow Payments Table */}
                          {customerOptions &&
                            header.id === table.getColumn("customer")?.id &&
                            (table.getColumn("customer") ? (
                              <DataTableFacetedFilter
                                column={table.getColumn("customer")}
                                title={"Customer"}
                                options={customerOptions || []}
                              />
                            ) : null)}


                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                        </div>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {/* Loading State Overlay or Indicator (Optional) */}
            {loading && (
                  <TableRow>
                      <TableCell colSpan={columns.length + 1} className="h-24 text-center"> {/* +1 if view options was in header row */}
                          Loading data... {/* Or use a spinner component */}
                      </TableCell>
                  </TableRow>
              )}
            {!loading && table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  <TableCell />
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      data-label={String(cell.column.columnDef.header || "")}
                      className="py-6 px-4"
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : ( !loading && (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination table={table} />
    </div>
  );
}



import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
} from "@radix-ui/react-icons";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"; // Adjust path
import { urlStateManager } from "@/utils/urlStateManager";
import { useUrlParam } from "@/hooks/useUrlParam";
import { FileUp } from "lucide-react";

interface DataTablePaginationProps<TData> {
  table: TanstackTable<TData>;
  // Remove onPageChange and onPageSizeChange as they will now use urlStateManager
  // totalCount is still needed for pageCount calculation if table.getPageCount() isn't reliable
  // For client-side pagination (which this old component does), table.getPageCount() should be fine.
}

export function DataTablePagination<TData>({
  table,
}: DataTablePaginationProps<TData>) {

  // --- URL State for Pagination ---
  // Use a prefix if multiple tables on one page might conflict, e.g., "myTable_pageIdx"
  // For simplicity, assuming global keys for now.
  const urlPageIndex = useUrlParam("pageIdx"); // Use your hook
  const urlPageSize = useUrlParam("rows");

  // --- Sync Tanstack Table state WITH URL on initial load & URL changes ---
  React.useEffect(() => {
    const newPageIndex = parseInt(urlPageIndex || "0", 10);
    if (table.getState().pagination.pageIndex !== newPageIndex) {
      table.setPageIndex(newPageIndex);
    }
  }, [urlPageIndex, table]);

  React.useEffect(() => {
    const newPageSize = parseInt(urlPageSize || "10", 10);
    if (table.getState().pagination.pageSize !== newPageSize) {
      table.setPageSize(newPageSize);
    }
  }, [urlPageSize, table]);

  // --- Handlers to update URL (and thus trigger table state update via subscription) ---
  const handlePageIndexChange = (newIndex: number) => {
    urlStateManager.updateParam("pageIdx", newIndex.toString());
    // Tanstack table will update via the useEffect subscription to urlPageIndex
  };

  const handlePageSizeChange = (newPageSize: string) => {
    urlStateManager.updateParam("rows", newPageSize);
    urlStateManager.updateParam("pageIdx", "0"); // Reset to first page on size change
    // Tanstack table will update pageIndex and pageSize via useEffect subscriptions
  };

  // Use table.getPageCount() which is calculated based on data and pageSize
  const pageCount = table.getPageCount();
  const currentPageIndex = table.getState().pagination.pageIndex; // Get from table state

  return (
    <div className="flex max-md:flex-col space-y-2 items-center md:justify-between px-2 py-1"> {/* Added padding */}
      <div className="flex-1 text-sm text-muted-foreground">
        {table.getFilteredSelectedRowModel().rows.length} of{" "}
        {table.getFilteredRowModel().rows.length} row(s) selected. {/* Use getFilteredRowModel for total visible after client filter */}
      </div>

      <div className="flex max-md:justify-between max-md:w-full items-center">
        <div className="flex items-center space-x-6 lg:space-x-8">
          <div className="flex items-center space-x-2">
            <p className="text-sm font-medium">Rows per page</p>
            <Select
              value={`${table.getState().pagination.pageSize}`}
              onValueChange={(value) => {
                handlePageSizeChange(value);
              }}
            >
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue placeholder={table.getState().pagination.pageSize} />
              </SelectTrigger>
              <SelectContent side="top">
                {[10, 20, 30, 40, 50, 100].map((size) => ( // Added more options
                  <SelectItem key={size} value={`${size}`}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center"> {/* Group page count and buttons */}
          <div className="flex w-[100px] items-center justify-center text-sm font-medium">
            Page {currentPageIndex + 1} of {pageCount > 0 ? pageCount : 1}
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              className="hidden h-8 w-8 p-0 lg:flex"
              onClick={() => handlePageIndexChange(0)}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Go to first page</span>
              <DoubleArrowLeftIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={() => handlePageIndexChange(currentPageIndex - 1)}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Go to previous page</span>
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={() => handlePageIndexChange(currentPageIndex + 1)}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Go to next page</span>
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="hidden h-8 w-8 p-0 lg:flex"
              onClick={() => handlePageIndexChange(table.getPageCount() - 1)}
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