import { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
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

import { useServerDataTable } from "@/hooks/useServerDataTable";
import { useFacetValues } from "@/hooks/useFacetValues";
import { Vendors as VendorsType } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";

import {
  VENDOR_DOCTYPE,
  VENDOR_LIST_FIELDS_TO_FETCH,
  VENDOR_SEARCHABLE_FIELDS,
  VENDOR_DATE_COLUMNS,
} from "./vendors.constants";
import { VendorsOverallSummaryCard } from "./components/VendorsOverallSummaryCard"; // Optional component

interface VendorTypeCount {
  type: string;
  count: number | undefined;
  isLoading: boolean;
}

export default function VendorsPage() {
  // --- Data fetching handled by hooks ---

  // --- Data fetching handled by hooks ---

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
      },
      {
        accessorKey: "vendor_name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Vendor Name" />
        ),
        cell: ({ row }) => (
          <Link
            className="hover:underline font-medium whitespace-nowrap"
            to={`/vendors/${row.original.name}`}
          >
            {row.getValue("vendor_name")}
          </Link>
        ),
        size: 250,
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
      },
      {
        id: "vendor_address",
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
      },
    ],
    []
  );

  const {
    table,
    totalCount,
    isLoading: tableIsLoading,
    error: tableError,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
    columnFilters,
  } = useServerDataTable<VendorsType>({
    doctype: VENDOR_DOCTYPE,
    columns: columns,
    fetchFields: VENDOR_LIST_FIELDS_TO_FETCH as string[],
    searchableFields: VENDOR_SEARCHABLE_FIELDS,
    defaultSort: "creation desc",
    urlSyncKey: `vendors_list`,
    enableRowSelection: false,
    shouldCache: true,
  });

  // --- Dynamic Facet Values ---
  const {
    facetOptions: vendorTypeFacetOptions,
    isLoading: isVendorTypeFacetLoading,
  } = useFacetValues({
    doctype: VENDOR_DOCTYPE,
    field: "vendor_type",
    currentFilters: columnFilters,
    searchTerm,
    selectedSearchField,
    enabled: true,
  });

  const facetFilterOptions = useMemo(
    () => ({
      vendor_type: {
        title: "Vendor Type",
        options: vendorTypeFacetOptions,
        isLoading: isVendorTypeFacetLoading,
      },
    }),
    [vendorTypeFacetOptions, isVendorTypeFacetLoading]
  );

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
        facetFilterOptions={facetFilterOptions}
        dateFilterColumns={VENDOR_DATE_COLUMNS}
        showExportButton={true}
        onExport={"default"}
        exportFileName={`vendors_list`}
        showRowSelection={false}
      />
    </div>
  );
}
