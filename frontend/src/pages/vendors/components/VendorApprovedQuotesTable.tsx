import React, { useMemo } from "react";
import { useFacetValues } from "@/hooks/useFacetValues";
import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { formatDate } from "@/utils/FormatDate";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations";
import { Items } from "@/types/NirmaanStack/Items";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { useNirmaanUnitOptions } from "@/components/helpers/SelectUnit";

interface VendorApprovedQuotesTableProps {
  vendorId: string;
  // Pass necessary lookup data as props to avoid re-fetching or prop drilling deeply
}

export const VendorApprovedQuotesTable: React.FC<
  VendorApprovedQuotesTableProps
> = ({ vendorId }) => {
  // Fetches items list
  const {
    data: itemsList,
    isLoading: itemsLoading,
    error: itemsError,
  } = useFrappeGetDocList<Items>(
    "Items",
    { fields: ["name", "item_name"], limit: 0 },
    "items_for_aq_page"
  );

  const staticFilters = useMemo(() => {
    if (!vendorId) return [];
    return [["vendor", "=", vendorId]];
  }, [vendorId]);

  // --- Dynamic Facet Values ---
  const { facetOptions: itemFacetOptions, isLoading: isItemFacetLoading } =
    useFacetValues({
      doctype: "Approved Quotations",
      field: "item_name",
      currentFilters: [], // We initially don't have access to table state here easily with this pattern, usually useServerDataTable provides it
      // Note: For now, assuming no cross-filtering dependency for the first render or using a simplified approach
      // To strictly follow the pattern, we'd need to lift `columnFilters` out or move this after useServerDataTable is called (but useServerDataTable needs options)
      searchTerm: "",
      selectedSearchField: "name",
      additionalFilters: staticFilters,
      enabled: true,
    });

  const { facetOptions: unitFacetOptions, isLoading: isUnitFacetLoading } =
    useFacetValues({
      doctype: "Approved Quotations",
      field: "unit",
      currentFilters: [],
      searchTerm: "",
      selectedSearchField: "name",
      additionalFilters: staticFilters,
      enabled: true,
    });

  const facetFilterOptions = useMemo(
    () => ({
      item_name: {
        title: "Item Name",
        options: itemFacetOptions,
        isLoading: isItemFacetLoading,
      },
      unit: {
        title: "Unit",
        options: unitFacetOptions,
        isLoading: isUnitFacetLoading,
      },
    }),
    [itemFacetOptions, isItemFacetLoading, unitFacetOptions, isUnitFacetLoading]
  );

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
          exportValue: (row) => {
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
          exportHeaderName: "Item Name",
          exportValue: (row) => {
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
          exportValue: (row) => {
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
          exportValue: (row) => {
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
          exportHeaderName: "Unit",
          exportValue: (row) => {
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
          exportValue: (row) => {
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
              to={`${poId.replaceAll("/", "&=")}`}
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
          exportValue: (row) => {
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
          exportValue: (row) => {
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
      facetFilterOptions={facetFilterOptions}
      dateFilterColumns={["modified", "creation"]}
      showExportButton={true}
      onExport={"default"}
    />
  );
};

export default VendorApprovedQuotesTable;
