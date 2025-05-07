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
import { formatDateToDDMMYYYY } from "@/utils/FormatDate";
import { useDialogStore } from "@/zustand/useDialogStore";
import { useFrappeDataStore } from "@/zustand/useFrappeDataStore";
import { debounce } from "lodash";
import { Download, FileUp } from "lucide-react";
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radiogroup";
import { toast } from "../ui/use-toast";
import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import { fuzzyFilter } from "./data-table-models";
import { DataTablePagination } from "./data-table-pagination";
import { DataTableViewOptions } from "./data-table-view-options";
import { ReportType, useReportStore } from "@/pages/reports/store/useReportStore";
import { exportToCsv } from "@/utils/exportToCsv";

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
  vendorData?: any;
  totalPOsRaised?: any;
  itemSearch?: boolean;
  isExport?: boolean;
  inFlowButton?: boolean;
  sortColumn?: string;
  // --- New Props for Generic Export ---
    /** Prefix for the downloaded CSV file (e.g., "projects", "po_pending_invoices") */
    exportFileNamePrefix?: string;
    /** Function to filter/prepare data specifically for export based on report type */
    getExportData?: ExportDataGetter<TData>;
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
  isExport = false,
  vendorData = undefined,
  customerOptions = undefined,
  inFlowButton = false,
  sortColumn = undefined,
  exportFileNamePrefix, // New prop
    getExportData,      // New prop
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);

  const [searchParams] = useSearchParams();
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);

  const [rowSelection, setRowSelection] = React.useState({});

  const [pageIndex, setPageIndex] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(10);

  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({ type: false, });

  // Get selectedReportType from the store
  const selectedReportType = useReportStore((state) => state.selectedReportType);

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

  const [globalFilter, setGlobalFilter] = React.useState(searchParams.get("search") || "");

  const { toggleNewInflowDialog } = useDialogStore();
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

  const updateURL = React.useCallback((key: string, value: string) => {
    console.log("key", key, value)
    const url = new URL(window.location.href);
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
    window.history.pushState({}, "", url);
  }, []);

  const handleGlobalFilterChange = React.useCallback(
    debounce((value: string) => {
      // setGlobalFilter(value);

      setGlobalFilter(value);
      updateURL("search", value);
    }, 1000),
    []
  );

  const customGlobalFilter = React.useCallback((row: any, columnId: string, filterValue: string) => {
    const name = row.getValue("name");
    const vendorName = row.getValue("vendor_name");
    const orderList = row.getValue("order_list");

    const combinedString = `${name || ""} ${vendorName || ""} ${JSON.stringify(orderList) || ""
      }`.toLowerCase();

    return combinedString.includes(filterValue.toLowerCase());
  }, []);

  const handlePageChange = React.useCallback((newPageIndex: string) => {
    setPageIndex(parseInt(newPageIndex));
    updateURL("pageIdx", newPageIndex);
  }, [pageIndex, updateURL]);

  const handlePageSizeChange = React.useCallback((newPageSize: string) => {
    setPageSize(parseInt(newPageSize));
    updateURL("rows", newPageSize);
    handlePageChange("0");
  }, [pageSize, updateURL]);

  const { setSelectedData, selectedData } = useFrappeDataStore()

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


  // Get the actual rows being displayed after filtering and pagination
  const currentVisibleRows = table.getRowModel().rows.map(row => row.original);
  // OR If you want to export ALL filtered data regardless of pagination:
  const allFilteredRows = table.getFilteredRowModel().rows.map(row => row.original);
  // Choose which dataset to use for export based on requirements. Let's use ALL filtered data.

  // --- New Export Handler ---
  const handleExport = () => {
      if (!exportFileNamePrefix || !getExportData) {
          console.error("Export configuration (prefix or data getter) is missing.");
          toast({ title: "Export Error", description: "Export functionality not configured.", variant: "destructive" });
          return;
      }
      if (loading || data.length === 0) {
           toast({ title: "Export", description: "No data available to export or still loading.", variant: "default" });
          return;
      }

      try {
          // 1. Get the data specifically prepared for this export type
          //    We pass ALL original data (`data` prop) to the getter,
          //    so it can apply report-type filtering before any table filtering.
          const dataToExportRaw = getExportData(selectedReportType, data);

          // 2. OPTIONAL: Apply table's current filters (search, column filters) to the report-specific data
          //    This is more complex as it requires replicating table filtering logic outside the table.
          //    Easier approach: Export based on Report Type filter applied to the *full* dataset.
          //    Let's stick to the easier approach for now: export data filtered *only* by the report type.
          const dataToExport = dataToExportRaw;

           // OR, if you want to export exactly what's visible *after* table filters:
           // const visibleFilteredData = getExportData(selectedReportType, allFilteredRows); // Apply report type filter to table-filtered data

          if (!dataToExport || dataToExport.length === 0) {
               toast({ title: "Export", description: `No data found matching report type: ${selectedReportType}`, variant: "default" });
               return;
          }

          // 3. Determine filename based on prefix and maybe the report type
           const finalFileName = `${exportFileNamePrefix}${selectedReportType ? `_${selectedReportType.replace(/\s+/g, '_')}` : ''}`;


          // 4. Call the generic export utility
          exportToCsv(finalFileName, dataToExport, columns);

          toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.`, variant: "success"});

      } catch (error) {
           console.error("Export failed:", error);
           toast({ title: "Export Error", description: "Could not generate CSV file.", variant: "destructive"});
      }
  };



  React.useEffect(() => {
    setSelectedData(table.getSelectedRowModel().rows)
  }, [table.getSelectedRowModel().rows])

  const [dialogOpen, setDialogOpen] = React.useState(false);

  const toggleDialog = React.useCallback(() => {
    setDialogOpen((prevState) => !prevState);
  }, [dialogOpen]);
  const [debitAccountNumber, setDebitAccountNumber] = React.useState("093705003327")

  const [paymentMode, setPaymentMode] = React.useState("IMPS")

  const exportToCSV = () => {
    const csvHeaders = ['PYMT_PROD_TYPE_CODE', 'PYMT_MODE', 'DEBIT_ACC_NO', 'BNF_NAME', 'BENE_ACC_NO', 'BENE_IFSC',
      'AMOUNT', 'DEBIT_NARR', 'CREDIT_NARR', 'MOBILE_NUM', 'EMAIL_ID', 'REMARK', 'PYMT_DATE',
      'REF_NO', 'ADDL_INFO1', 'ADDL_INFO2', 'ADDL_INFO3', 'ADDL_INFO4', 'ADDL_INFO5', 'LEI_NUMBER'
    ];

    const csvRows = [];

    const todayDate = formatDateToDDMMYYYY(new Date());

    csvRows.push(csvHeaders.join(','));
    selectedData?.forEach(i => {
      const data = i?.original;
      const vendor = vendorData?.find(v => v.name === data.vendor);
      const row = ['PAB_VENDOR', paymentMode, debitAccountNumber, vendor?.account_name, vendor?.account_number, vendor?.ifsc,
        data?.amount, '', '', '', '', data.document_name, todayDate, '', '', '', '', '', '', ''
      ]
      csvRows.push(row.join(','));
    });

    const csvString = csvRows.join('\n');

    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${formatDateToDDMMYYYY(new Date())}_payments.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Success!",
      description: "Payments CSV Exported Successfully!",
      variant: "success"
    })
    toggleDialog()
  };

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
            id="globalFilter"
            placeholder="Search..."
            //value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
            value={globalFilter ?? ""}
            onChange={(e) => {
              setGlobalFilter(e.target.value); // Update local state
              handleGlobalFilterChange(e.target.value); // Debounced update
            }}
            className="w-[50%] max-sm:w-[60%]"
            // className="max-w-sm w-full sm:w-auto" // Responsive width
          />

          {inFlowButton && (
            <Button onClick={toggleNewInflowDialog}>Add New Entry</Button>
          )}

          {/* Generic Export Button */}
          {exportFileNamePrefix && getExportData && (
                        <Button
                            onClick={handleExport}
                            size="sm"
                            disabled={loading || data.length === 0}
                        >
                            <Download className="mr-2 h-4 w-4" />
                            Export
                        </Button>
                    )}

          {/* {inFlowButton && <NewInflowPayment />} */}

          {isExport && (
            <Button onClick={toggleDialog} disabled={!selectedData?.length} variant={"outline"} className="flex items-center gap-1 h-8 px-2 border-primary text-primary">
              Export
              <FileUp className="w-4 h-4" />
            </Button>
          )}

          <Dialog open={dialogOpen} onOpenChange={toggleDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="text-center">Export to CSV</DialogTitle>
              </DialogHeader>
              <h2 className="font-semibold text-primary">Debit Account</h2>
              <RadioGroup defaultValue="ICICI" className="space-y-2" >
                {/* 1️⃣ Custom Amount */}
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="ICICI" id="icici" />
                  <div className="flex items-center space-x-6">
                    <Label htmlFor="icici">ICICI</Label>
                    <Input
                      className="h-8"
                      value={debitAccountNumber}
                      onChange={(e) => setDebitAccountNumber(e.target.value)}
                    />
                  </div>
                  <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className="border border-gray-300 rounded-md">
                    <option value="IMPS">IMPS</option>
                    <option value="NEFT">NEFT</option>
                  </select>
                </div>
              </RadioGroup>

              <div className="mt-2 flex items-center justify-center space-x-2">
                <DialogClose className="flex-1" asChild>
                  <Button variant={"outline"}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button onClick={exportToCSV} className="flex-1">Confirm</Button>
              </div>
            </DialogContent>
          </Dialog>

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
      <DataTablePagination onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange} table={table} />
    </div>
  );
}