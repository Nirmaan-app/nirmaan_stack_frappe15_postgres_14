import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
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
import * as React from "react";
import { DataTablePagination } from "./data-table-pagination";
import { DataTableToolbar } from "./data-table-toolbar";
import { fuzzyFilter } from "./data-table-models";
import DebouncedInput from "./debounced-input";
import { DataTableViewOptions } from "./data-table-view-options";
import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import { useFilterStore } from "@/zustand/useFilterStore";
import { useSearchParams } from "react-router-dom";
import { Input } from "../ui/input";
import { debounce } from "lodash";

type ProjectOptions = {
  label: string;
  value: string;
};

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  project_values?: ProjectOptions[];
  category_options?: ProjectOptions[];
  loading?: boolean;
  error?: any;
  vendorOptions?: any;
  projectTypeOptions?: any;
  roleTypeOptions?: any;
  statusOptions?: any;
  totalPOsRaised?: any;
  itemSearch?: boolean;
  approvedQuotesVendors?: any;
  itemOptions?: any;
  wpOptions?: any;
}

export function DataTable<TData, TValue>({
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
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([
    {
      id: "creation",
      desc: true,
    },
  ]);

  const [searchParams, setSearchParams] = useSearchParams();
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({ type: false, });

  const [rowSelection, setRowSelection] = React.useState({});

  const [pageIndex, setPageIndex] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(10);

  // const currentRoute = window.location.pathname;

  // const globalSearch = useFilterStore((state) => state.getTextSearch(currentRoute));
  // const [globalFilter, setGlobalFilter] = React.useState(globalSearch || '')

  // React.useEffect(() => {
  //     if (globalSearch) {
  //         setGlobalFilter(globalSearch);
  //     }
  // }, [globalSearch]);

  // const handleGlobalFilterChange = (value: string) => {
  //     setGlobalFilter(value);
  //     useFilterStore.getState().setTextSearch(currentRoute, value);
  // };

  // const customGlobalFilter = (row, columnId, filterValue) => {
  //     const name = row.getValue("name");
  //     const vendorName = row.getValue("vendor_name");
  //     const orderList = row.getValue("order_list");

  //     // Combine all fields into a single string for searching
  //     const combinedString = `${name || ""} ${vendorName || ""} ${JSON.stringify(orderList) || ""
  //         }`.toLowerCase();

  //     return combinedString.includes(filterValue.toLowerCase());
  // };

  const [globalFilter, setGlobalFilter] = React.useState(searchParams.get("search") || "");

  React.useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);

    const initialPageIndex = Number(urlParams.get("pageIdx") || "0");
    const initialPageSize = Number(urlParams.get("rows") || "10");

    setPageIndex(initialPageIndex);
    setPageSize(initialPageSize);

    // Initialize global search filter
    const initialSearch = urlParams.get("search") || "";
    setGlobalFilter(initialSearch);
  }, []);

  const updateURL = (key, value) => {
    const url = new URL(window.location);
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
    window.history.pushState({}, "", url);
  };

  const handleGlobalFilterChange = React.useCallback(
    debounce((value: string) => {
      // setGlobalFilter(value);

      setGlobalFilter(value);
      updateURL("search", value);
    }, 1000),
    []
  );

  const customGlobalFilter = (row, columnId, filterValue) => {
    const name = row.getValue("name");
    const vendorName = row.getValue("vendor_name");
    const orderList = row.getValue("order_list");

    const combinedString = `${name || ""} ${vendorName || ""} ${JSON.stringify(orderList) || ""
      }`.toLowerCase();

    return combinedString.includes(filterValue.toLowerCase());
  };

  const handlePageChange = (newPageIndex: number) => {
    setPageIndex(newPageIndex);
    updateURL("pageIdx", newPageIndex);
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    updateURL("rows", newPageSize);
  };

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
      pagination: { pageIndex, pageSize },
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter,
    },
  });

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
        <div className="flex gap-2 items-center py-4 sm:w-full">
          <Input
            id="globalFilter"
            placeholder="Search..."
            //value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
            value={globalFilter ?? ""}
            onChange={(e) => {
              setGlobalFilter(e.target.value); // Update local state
              handleGlobalFilterChange(e.target.value); // Debounced update
            }}
            className="max-w-sm"
          />
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
                    <TableHead key={header.id} colSpan={header.colSpan}>
                      {header.isPlaceholder ? null : (
                        <div className="flex items-center gap-2">
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

                          {wpOptions &&
                            header.id === table.getColumn("wp")?.id &&
                            (table.getColumn("wp") ? (
                              <DataTableFacetedFilter
                                column={table.getColumn("wp")}
                                title={"Work Package"}
                                options={wpOptions || []}
                              />
                            ) : null)}

                          {project_values &&
                            header.id === table.getColumn("project")?.id &&
                            (table.getColumn("project") ? (
                              <DataTableFacetedFilter
                                column={table.getColumn("project")}
                                title={"Project"}
                                options={project_values || []}
                              />
                            ) : null)}

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

                          {vendorOptions &&
                            header.id === table.getColumn("vendor_name")?.id &&
                            (table.getColumn("vendor_name") ? (
                              <DataTableFacetedFilter
                                column={table.getColumn("vendor_name")}
                                title={"Vendor"}
                                options={vendorOptions || []}
                              />
                            ) : null)}

                          {approvedQuotesVendors &&
                            header.id === table.getColumn("vendor")?.id &&
                            (table.getColumn("vendor") ? (
                              <DataTableFacetedFilter
                                column={table.getColumn("vendor")}
                                title={"Vendor"}
                                options={approvedQuotesVendors || []}
                              />
                            ) : null)}

                          {itemOptions &&
                            header.id === table.getColumn("item_name")?.id &&
                            (table.getColumn("item_name") ? (
                              <DataTableFacetedFilter
                                column={table.getColumn("item_name")}
                                title={"Item"}
                                options={itemOptions || []}
                              />
                            ) : null)}

                          {projectTypeOptions &&
                            header.id === table.getColumn("project_type")?.id &&
                            (table.getColumn("project_type") ? (
                              <DataTableFacetedFilter
                                column={table.getColumn("project_type")}
                                title={"Project Type"}
                                options={projectTypeOptions || []}
                              />
                            ) : null)}

                          {roleTypeOptions &&
                            header.id === table.getColumn("role_profile")?.id &&
                            (table.getColumn("role_profile") ? (
                              <DataTableFacetedFilter
                                column={table.getColumn("role_profile")}
                                title={"Role"}
                                options={roleTypeOptions || []}
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
          {/* <TableBody>
                        {table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    data-state={row.getIsSelected() && "selected"}
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell className="py-6 px-4" key={cell.id}>
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={columns.length} className="h-24 text-center">
                                    No results.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody> */}

          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  <TableCell />
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      data-label={cell.column.columnDef.header}
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
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange} table={table} />
    </div>
  );
}