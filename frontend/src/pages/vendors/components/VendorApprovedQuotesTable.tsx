import React, { useMemo } from "react";
import { DataTable } from "@/components/data-table/new-data-table";
import { FacetDeclaration } from "@/components/data-table/facetConfig";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { formatDate } from "@/utils/FormatDate";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations";
import { Items } from "@/types/NirmaanStack/Items";
import { useVendorItems } from "../data/useVendorQueries";
import { useNirmaanUnitOptions } from "@/components/helpers/SelectUnit";

interface VendorApprovedQuotesTableProps {
  vendorId: string;
  vendorName?: string;
  // Pass necessary lookup data as props to avoid re-fetching or prop drilling deeply
}

export const VendorApprovedQuotesTable: React.FC<
  VendorApprovedQuotesTableProps
> = ({ vendorId, vendorName }) => {
  // Fetches items list
  const {
    isLoading: itemsLoading,
    error: itemsError,
  } = useVendorItems();

  const staticFilters = useMemo(() => {
    if (!vendorId) return [];
    return [["vendor", "=", vendorId]];
  }, [vendorId]);

  const fetchFields = useMemo(
    () => [
      "name",
      "item_id",
      "quote",
      "creation",
      "procurement_order",
      "unit",
      "item_name",
      "make",
    ],
    []
  );

  const searchableFields = useMemo(
    () => [
      {
        value: "item_name",
        label: "Item Name",
        placeholder: "Search by item name...",
        default: true,
      },
      {
        value: "name",
        label: "Quote ID",
        placeholder: "Search by quote ID...",
      },
      { value: "quote", label: "Quote", placeholder: "Search by quote..." },
      { value: "unit", label: "Unit", placeholder: "Search by unit..." },
      {
        value: "procurement_order",
        label: "PO Number",
        placeholder: "Search by PO number...",
      },
      { value: "make", label: "Make", placeholder: "Search by make..." },
    ],
    []
  );

  const columns = useMemo<ColumnDef<ApprovedQuotations>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Quote ID" />
        ),
        cell: ({ row }) => (
          // Assuming no dedicated detail page for an Approved Quotation,
          // but you might link to the related PO or Item.
          <div className="font-medium whitespace-nowrap">
            {row.getValue("name")}
          </div>
        ),
        size: 180,
        meta: {
          exportHeaderName: "Quote ID",
          exportValue: (row: ApprovedQuotations) => {
            return row.name;
          },
        },
      },
      {
        accessorKey: "item_name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Item" />
        ),
        cell: ({ row }) => {
          const itemId = row.original.item_id;
          return itemId ? (
            <Link
              className="text-blue-600 hover:underline font-medium"
              to={`/products/${itemId}`}
            >
              {row.getValue("item_name")}
            </Link>
          ) : (
            <div className="font-medium">{row.getValue("item_name")}</div>
          );
        },
        size: 250,
        meta: {
          facet: {
            field: "item_name",
            title: "Item Name",
            decoupled: true,
          } satisfies FacetDeclaration,
          exportHeaderName: "Item Name",
          exportValue: (row: ApprovedQuotations) => {
            return row.item_name;
          },
        },
      },
      {
        accessorKey: "quote",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Quoted Price" />
        ),
        cell: ({ row }) => (
          <div className="font-medium pr-2">
            {formatToRoundedIndianRupee(row.getValue("quote"))}
          </div>
        ),
        meta: {
          isNumeric: true,
          exportHeaderName: "Quoted Price",
          exportValue: (row: ApprovedQuotations) => {
            return formatToRoundedIndianRupee(row.quote);
          },
        }, // For styling if needed
        size: 150,
      },
      {
        accessorKey: "quantity",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Qty" />
        ),
        cell: ({ row }) => (
          <div className="font-medium">{row.getValue("quantity") || "1"}</div>
        ), // Default to 1 if not present
        meta: {
          isNumeric: true,
          exportHeaderName: "Quantity",
          exportValue: (row: ApprovedQuotations) => {
            return row.quantity || 1;
          },
        },
        size: 80,
      },
      {
        accessorKey: "unit",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Unit" />
        ),
        cell: ({ row }) => (
          <div className="font-medium">{row.getValue("unit")}</div>
        ),
        size: 100,
        meta: {
          facet: {
            field: "unit",
            title: "Unit",
            decoupled: true,
          } satisfies FacetDeclaration,
          exportHeaderName: "Unit",
          exportValue: (row: ApprovedQuotations) => {
            return row.unit;
          },
        },
      },
      {
        accessorKey: "make",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Make" />
        ),
        cell: ({ row }) => (
          <div className="font-medium">{row.getValue("make") || "--"}</div>
        ),
        size: 120,
        meta: {
          exportHeaderName: "Make",
          exportValue: (row: ApprovedQuotations) => {
            return row.make || "--";
          },
        },
      },
      {
        accessorKey: "procurement_order",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="PO #" />
        ),
        cell: ({ row }) => {
          const poId = row.getValue<string>("procurement_order");
          return poId ? (
            <Link
              className="text-blue-600 hover:underline font-medium"
              to={`${poId.replace(/\//g, "&=")}`}
            >
              {" "}
              {/* Adjust PO link */}
              {poId}
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">N/A</span>
          );
        },
        size: 180,
        meta: {
          exportHeaderName: "PO #",
          exportValue: (row: ApprovedQuotations) => {
            return row.procurement_order;
          },
        },
      },
      {
        accessorKey: "creation",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Date Approved" />
        ),
        cell: ({ row }) => (
          <div className="font-medium whitespace-nowrap">
            {formatDate(row.getValue("creation"))}
          </div>
        ),
        size: 150,
        meta: {
          isDate: true,
          exportHeaderName: "Date Approved",
          exportValue: (row: ApprovedQuotations) => {
            return formatDate(row.creation);
          },
        },
      },
    ],
    []
  ); // itemMap removed dependency

  const {
    table,
    totalCount,
    isLoading: tableLoading,
    error: tableError,
    exportAllRows,
    isExporting,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
  } = useServerDataTable<ApprovedQuotations>({
    doctype: "Approved Quotations",
    columns: columns,
    fetchFields: fetchFields,
    searchableFields: searchableFields,
    defaultSort: "creation desc",
    urlSyncKey: "vendor_quotes_list",
    enableRowSelection: false,
    // shouldCache: true,
    additionalFilters: staticFilters,
  });

  const combinedError = tableError || itemsError;
  const combinedLoading = tableLoading || itemsLoading;

  if (combinedError) return <AlertDestructive error={combinedError} />;

  return (
    <DataTable<ApprovedQuotations>
      table={table}
      columns={columns} // Pass the actual column defs for rendering
      isLoading={combinedLoading}
      totalCount={totalCount}
      searchFieldOptions={searchableFields}
      selectedSearchField={selectedSearchField}
      onSelectedSearchFieldChange={setSelectedSearchField}
      searchTerm={searchTerm}
      onSearchTermChange={setSearchTerm}
      facetDoctype="Approved Quotations"
      facetOverrides={{
        item_name: { additionalFilters: staticFilters },
        unit: { additionalFilters: staticFilters },
      }}
      dateFilterColumns={["modified", "creation"]}
      showExportButton={true}
      onExport={"default"}
      onExportAll={exportAllRows}
      isExporting={isExporting}
      exportFileName={
        vendorName ? `${vendorName}_Approved_Quotes` : "Approved_Quotes"
      }
    />
  );
};

export default VendorApprovedQuotesTable;
