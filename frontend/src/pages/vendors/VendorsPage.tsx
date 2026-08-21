import { useCallback, useMemo } from "react";
import { ColumnDef, Row } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Ellipsis } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { exportToCsv } from "@/utils/exportToCsv";

import { useServerDataTable } from "@/hooks/useServerDataTable";
import { FacetDeclaration } from "@/components/data-table/facetConfig";
import { useVendorHoldVendors } from "@/hooks/useVendorHoldVendors";
import { Vendors as VendorsType } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";
import { VENDOR_HOLD_ROW_CLASSES } from "@/utils/vendorHoldRowStyles";

import {
  VENDOR_DOCTYPE,
  VENDOR_LIST_FIELDS_TO_FETCH,
  VENDOR_SEARCHABLE_FIELDS,
  VENDOR_DATE_COLUMNS,
  VENDOR_HIDDEN_COLUMNS,
} from "./vendors.constants";
import { VendorsOverallSummaryCard } from "./components/VendorsOverallSummaryCard"; // Optional component

export default function VendorsPage() {
  // --- Data fetching handled by hooks ---
  const { onHoldVendorIds } = useVendorHoldVendors();

  const getRowClassName = useCallback((row: Row<VendorsType>) => {
    if (onHoldVendorIds.has(row.original.name)) return VENDOR_HOLD_ROW_CLASSES;
    return undefined;
  }, [onHoldVendorIds]);

  const columns = useMemo<ColumnDef<VendorsType>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Vendor ID" />
        ),
        cell: ({ row }) => {
          const vendor = row.original;
          const typePrefix =
            vendor.vendor_type === "Material"
              ? "M"
              : vendor.vendor_type === "Service"
              ? "S"
              : vendor.vendor_type === "Material & Service"
              ? "MS"
              : "V";
          return (
            <Link
              className="text-blue-600 hover:underline font-medium whitespace-nowrap"
              to={`/vendors/${vendor.name}`}
            >
              {typePrefix}-{vendor.name.slice(-4)}
            </Link>
          );
        },
        size: 120,
        meta: { columnLabel: "Vendor ID" },
      },
      {
        accessorKey: "vendor_name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Vendor Name" />
        ),
        cell: ({ row }) => (
          <Link
            className="hover:underline font-medium whitespace-normal leading-tight block"
            to={`/vendors/${row.original.name}`}
          >
            {row.getValue("vendor_name")}
          </Link>
        ),
        size: 250,
        meta: { columnLabel: "Vendor Name" },
      },
      {
        accessorKey: "vendor_nickname",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Nickname" />
        ),
        cell: ({ row }) => (
          <span className="font-medium text-primary/80">
            {row.getValue("vendor_nickname") || "--"}
          </span>
        ),
        size: 150,
        meta: {
          exportHeaderName: "Nickname",
          exportValue: (row: VendorsType) => row.vendor_nickname,
        },
      },
      {
        accessorKey: "vendor_type",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Type" />
        ),
        cell: ({ row }) => (
          <Badge variant="outline">{row.getValue("vendor_type")}</Badge>
        ),
        size: 180,
        enableColumnFilter: true,
        meta: {
          columnLabel: "Vendor Type",
          facet: {
            field: "vendor_type",
            title: "Vendor Type",
          } satisfies FacetDeclaration,
        },
      },
      {
        accessorKey: "vendor_status",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => {
          const status = row.getValue("vendor_status") as string;
          const isOnHold = status === "On-Hold";
          return (
            <Badge
              variant="outline"
              className={cn(
                "text-xs font-medium",
                isOnHold
                  ? "bg-amber-50 text-amber-700 border-amber-300"
                  : "bg-green-50 text-green-700 border-green-300"
              )}
            >
              {status || "Active"}
            </Badge>
          );
        },
        size: 120,
        enableColumnFilter: true,
        meta: {
          columnLabel: "Status",
          facet: {
            field: "vendor_status",
            title: "Status",
          } satisfies FacetDeclaration,
        },
      },
      {
        accessorKey: "vendor_category",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Categories" />
        ),
        cell: ({ row }) => {
          const categories = row.original.vendor_category?.categories || [];
          if (categories.length === 0)
            return <span className="text-xs text-muted-foreground">N/A</span>;
          const displayCategories = categories.slice(0, 2);
          const remainingCount = categories.length - displayCategories.length;
          return (
            <div className="flex flex-wrap gap-1 items-center">
              {displayCategories.map((cat) => (
                <Badge key={cat} variant="secondary" className="text-xs">
                  {cat}
                </Badge>
              ))}
              {remainingCount > 0 && (
                <HoverCard>
                  <HoverCardTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6 p-0">
                      <Ellipsis className="h-4 w-4" />
                    </Button>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-auto max-w-xs p-2">
                    <div className="flex flex-wrap gap-1">
                      {categories.slice(2).map((cat) => (
                        <Badge
                          key={cat}
                          variant="secondary"
                          className="text-xs"
                        >
                          {cat}
                        </Badge>
                      ))}
                    </div>
                  </HoverCardContent>
                </HoverCard>
              )}
            </div>
          );
        },
        size: 250,
        enableSorting: false,
        meta: {
          exportHeaderName: "Categories",
          exportValue: (row: VendorsType) =>
            row.vendor_category?.categories?.join(", ") || "",
        },
      },
      {
        // Keyed on `vendor_state`, not `vendor_address`, so the State facet below
        // actually filters: `convertTanstackFiltersToFrappe` builds the Frappe filter
        // from the COLUMN ID, never from `meta.facet.field`. Filtering on
        // `vendor_address` (a Link to the Address doctype) would match nothing.
        // A separate State column was the alternative, but it would only repeat what
        // this column already shows — and hidden columns render no header, so a facet
        // on one would be invisible until toggled on.
        id: "vendor_state",
        // accessorFn (not just `id`) so the column also shows up in the
        // "Toggle columns" menu — without it TanStack has no accessor and the
        // menu skips it, leaving Address as the one column that can't be hidden.
        accessorFn: (row: VendorsType) =>
          [row.vendor_city, row.vendor_state].filter(Boolean).join(", "),
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Address" />
        ),
        cell: ({ row }) => {
          const { vendor_city, vendor_state } = row.original;
          if (!vendor_city && !vendor_state)
            return <span className="text-xs text-muted-foreground">N/A</span>;
          return (
            <div className="font-medium text-sm">{`${vendor_city || ""}${
              vendor_city && vendor_state ? ", " : ""
            }${vendor_state || ""}`}</div>
          );
        },
        size: 200,
        enableSorting: false,
        enableColumnFilter: true,
        meta: {
          columnLabel: "Address",
          // The cell is DERIVED from vendor_city + vendor_state; with no accessorKey
          // and no exportValue the CSV column came out empty on every row.
          exportHeaderName: "Address",
          exportValue: (row: VendorsType) =>
            [row.vendor_city, row.vendor_state].filter(Boolean).join(", "),
          facet: {
            field: "vendor_state",
            title: "State",
          } satisfies FacetDeclaration,
        },
      },
      {
        accessorKey: "creation",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Date Created" />
        ),
        cell: ({ row }) => (
          <div className="font-medium whitespace-nowrap">
            {formatDate(row.getValue("creation"))}
          </div>
        ),
        size: 120,
        meta: { columnLabel: "Date Created" },
      },
      // --- Optional columns: hidden by default, opt-in via the "Toggle columns" menu.
      // Whatever is visible here is exactly what the CSV export contains.
      {
        accessorKey: "account_name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Account Holder Name" />
        ),
        cell: ({ row }) => (
          <div className="font-medium text-sm whitespace-normal leading-tight">
            {row.original.account_name || "--"}
          </div>
        ),
        size: 220,
        enableSorting: false,
        meta: { exportHeaderName: "Account Holder Name" },
      },
      {
        accessorKey: "account_number",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Account Number" />
        ),
        cell: ({ row }) => (
          <div className="font-medium text-sm whitespace-nowrap">
            {row.original.account_number || "--"}
          </div>
        ),
        size: 180,
        enableSorting: false,
        meta: { exportHeaderName: "Account Number" },
      },
      {
        accessorKey: "ifsc",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="IFSC Code" />
        ),
        cell: ({ row }) => (
          <div className="font-medium text-sm whitespace-nowrap">
            {row.original.ifsc || "--"}
          </div>
        ),
        size: 140,
        enableSorting: false,
        meta: { exportHeaderName: "IFSC Code" },
      },
      {
        accessorKey: "bank_name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Bank Name" />
        ),
        cell: ({ row }) => (
          <div className="font-medium text-sm whitespace-normal leading-tight">
            {row.original.bank_name || "--"}
          </div>
        ),
        size: 220,
        enableSorting: false,
        meta: { exportHeaderName: "Bank Name" },
      },
      {
        accessorKey: "bank_branch",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Branch" />
        ),
        cell: ({ row }) => (
          <div className="font-medium text-sm whitespace-normal leading-tight">
            {row.original.bank_branch || "--"}
          </div>
        ),
        size: 200,
        enableSorting: false,
        meta: { exportHeaderName: "Branch" },
      },
      {
        accessorKey: "vendor_gst",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="GST Number" />
        ),
        cell: ({ row }) => (
          <div className="font-medium text-sm whitespace-nowrap">
            {row.original.vendor_gst || "--"}
          </div>
        ),
        size: 180,
        enableSorting: false,
        meta: { exportHeaderName: "GST Number" },
      },
      {
        accessorKey: "vendor_contact_person_name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Contact Person" />
        ),
        cell: ({ row }) => (
          <div className="font-medium text-sm whitespace-normal leading-tight">
            {row.original.vendor_contact_person_name || "--"}
          </div>
        ),
        size: 200,
        enableSorting: false,
        meta: { exportHeaderName: "Contact Person" },
      },
      {
        accessorKey: "vendor_mobile",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Contact Number" />
        ),
        cell: ({ row }) => (
          <div className="font-medium text-sm whitespace-nowrap">
            {row.original.vendor_mobile || "--"}
          </div>
        ),
        size: 150,
        enableSorting: false,
        meta: { exportHeaderName: "Contact Number" },
      },
    ],
    []
  );

  const {
    table,
    totalCount,
    isLoading: tableIsLoading,
    error: tableError,
    exportAllRows,
    isExporting,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
  } = useServerDataTable<VendorsType>({
    doctype: VENDOR_DOCTYPE,
    columns: columns,
    fetchFields: VENDOR_LIST_FIELDS_TO_FETCH as string[],
    searchableFields: VENDOR_SEARCHABLE_FIELDS,
    defaultSort: "creation desc",
    urlSyncKey: `vendors_list`,
    enableRowSelection: false,
    shouldCache: true,
    initialState: { columnVisibility: VENDOR_HIDDEN_COLUMNS },
  });

  const exportFileName = "vendors_list";

  // Export mirrors the "Toggle columns" menu: only the columns visible right now
  // land in the CSV. The shared default export handler ignores visibility, so this
  // page supplies its own.
  const handleExport = useCallback(async () => {
    try {
      const visibleIds = new Set(
        table.getVisibleLeafColumns().map((col) => col.id)
      );
      const exportableColumns = columns.filter((col) => {
        const id = (col as { id?: string; accessorKey?: string }).id ??
          (col as { accessorKey?: string }).accessorKey;
        return !!id && visibleIds.has(id);
      });

      if (exportableColumns.length === 0) {
        toast({
          title: "Export",
          description: "No columns are visible to export.",
        });
        return;
      }

      if (totalCount > 5000) {
        const confirmed = window.confirm(
          `This will export ${totalCount.toLocaleString()} rows. This may take a moment. Continue?`
        );
        if (!confirmed) return;
      }

      const rowsToExport = await exportAllRows();
      if (!rowsToExport || rowsToExport.length === 0) {
        toast({ title: "Export", description: "No data to export." });
        return;
      }

      exportToCsv(exportFileName, rowsToExport, exportableColumns);
      toast({
        title: "Export Successful",
        description: `${rowsToExport.length} rows exported.`,
        variant: "success",
      });
    } catch (error) {
      console.error("Vendor export failed:", error);
      toast({
        title: "Export Error",
        description: "Could not generate CSV file.",
        variant: "destructive",
      });
    }
  }, [table, columns, exportAllRows, totalCount, exportFileName]);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 overflow-hidden",
        totalCount > 10
          ? "h-[calc(100vh-80px)]"
          : totalCount > 0
          ? "h-auto"
          : ""
      )}
    >
      <VendorsOverallSummaryCard />

      <DataTable<VendorsType>
        table={table}
        columns={columns}
        isLoading={tableIsLoading}
        error={tableError as Error}
        totalCount={totalCount}
        searchFieldOptions={VENDOR_SEARCHABLE_FIELDS}
        selectedSearchField={selectedSearchField}
        onSelectedSearchFieldChange={setSelectedSearchField}
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        facetDoctype={VENDOR_DOCTYPE}
        dateFilterColumns={VENDOR_DATE_COLUMNS}
        showExportButton={true}
        onExport={handleExport}
        isExporting={isExporting}
        exportFileName={exportFileName}
        showRowSelection={false}
        getRowClassName={getRowClassName}
      />
    </div>
  );
}
