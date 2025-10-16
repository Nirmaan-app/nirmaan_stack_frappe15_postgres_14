/**
 * @file AdminApprovedQuotationsTable.tsx
 * @description Final, robust version with a fully client-side filtering and pagination model.
 */

import { useMemo, useState, useCallback, useRef } from "react";
import Fuse from "fuse.js";
import {
  ColumnDef,
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  ColumnFiltersState,
  PaginationState,
  SortingState,
} from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList } from "frappe-react-sdk";

// UI Components
import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";

// Hooks, Utils, and Types
import { ApprovedQuotations as ApprovedQuotationsType } from "@/types/NirmaanStack/ApprovedQuotations";
import { Items as ItemsType } from "@/types/NirmaanStack/Items";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { useVendorsList } from "../ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { useNirmaanUnitOptions } from '@/components/helpers/SelectUnit';
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";

// Constants
import {
  APPROVED_QUOTATION_DOCTYPE,
  AQ_LIST_FIELDS_TO_FETCH,
  AQ_SEARCHABLE_FIELDS,
  AQ_DATE_COLUMNS,
  ITEM_DOCTYPE,
  getSingleItemStaticFilters,
  SelectedItem,
} from "./approvedQuotations.constants";

interface AdminApprovedQuotationsTableProps {
  productId?: string;
  item_name?: string;
}
interface ProcurementOrderType {
  name: string;
  project_name?: string;
}
interface AQWithProject extends ApprovedQuotationsType {
  project_name: string;
}

const calculateTotalAmount = (row: ApprovedQuotationsType): number => {
  const quote = parseFloat(row.quote || "0");
  const quantity = parseFloat(row.quantity || "1");
  const tax = parseFloat(row.tax || "0");
  return quote * quantity * (1 + tax / 100);
};

export default function AdminApprovedQuotationsTable({
  productId,
  item_name,
}: AdminApprovedQuotationsTableProps) {
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [itemSearchInput, setItemSearchInput] = useState("");
  const [isPopoverOpen, setPopoverOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);


  const { UnitOptions, isunitOptionsLoading } = useNirmaanUnitOptions();
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "creation", desc: true },
  ]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 50,
  });
  const [globalFilter, setGlobalFilter] = useState("");

  // --- Data fetching for UI elements and enrichment ---
  const { data: allItems, isLoading: allItemsLoading } =
    useFrappeGetDocList<ItemsType>(
      ITEM_DOCTYPE,
      { fields: ["name", "item_name"], limit: 0 },
      "all_items_for_fuzzy_search"
    );
  const {
    data: vendorsList,
    vendorOptionsForSelect,
    isLoading: vendorsLoading,
  } = useVendorsList({
    vendorTypes: ["Service", "Material & Service", "Material"],
  });
  const { data: poList, isLoading: poListLoading } =
    useFrappeGetDocList<ProcurementOrderType>(
      "Procurement Orders",
      { fields: ["name", "project_name"], limit: 0 },
      "po_list_for_project_name_lookup"
    );

  const fuse = useMemo(
    () =>
      allItems
        ? new Fuse(allItems, { keys: ["item_name"], threshold: 0.4 })
        : null,
    [allItems]
  );
  const itemSuggestions = useMemo(() => {
    if (!itemSearchInput.trim() || !fuse) return [];
    return fuse
      .search(itemSearchInput)
      .slice(0, 10)
      .map((result) => result.item);
  }, [itemSearchInput, fuse]);
  const vendorMap = useMemo(() => {
    const map = new Map<string, string>();
    vendorsList?.forEach((vendor) => map.set(vendor.name, vendor.vendor_name));
    return map;
  }, [vendorsList]);
  const poProjectMap = useMemo(() => {
    const map: { [key: string]: string } = {};
    poList?.forEach((po) => {
      if (po.name && po.project_name) map[po.name] = po.project_name;
    });
    return map;
  }, [poList]);

  // --- FIX: This is now the ONLY server-side filter logic ---
  const serverSideFilters = useMemo(() => {
    // If we are on a specific product page, apply a server filter.
    if (productId) {
      return getSingleItemStaticFilters(productId);
    }
    // Otherwise, on the main page, apply NO filters. Fetch everything.
    return [];
  }, [productId]);

  // --- This hook now fetches data based on the simplified server filters ---
  const {
    data: serverData,
    isLoading: aqTableLoading,
    error: aqTableError,
  } = useFrappeGetDocList<ApprovedQuotationsType>(
    APPROVED_QUOTATION_DOCTYPE,
    {
      fields: AQ_LIST_FIELDS_TO_FETCH,
      filters: serverSideFilters,
      limit: 0, // Fetch all that match the (minimal) server filter
    },
    `aq_data_client_table_${productId}` // SWR key is now simpler
  );

  // The multi-select item filter is now applied on the CLIENT side
  const filteredData = useMemo(() => {
    if (!serverData) return [];
    // If we are on the main page AND items are selected, filter the server data.
    if (!productId && selectedItems.length > 0) {
      const selectedItemValues = new Set(
        selectedItems.map((item) => item.value)
      );
      return serverData.filter((aq) => selectedItemValues.has(aq.item_id));
    }
    // Otherwise, return the full dataset fetched from the server.
    return serverData;
  }, [serverData, selectedItems, productId]);

   const columns = useMemo<ColumnDef<ApprovedQuotationsType>[]>(
      () => [
        {
          accessorKey: "item_name",
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Item" />
          ),
          filterFn: facetedFilterFn,
          cell: ({ row }) => (
            <Link
              className="text-blue-600 hover:underline font-medium"
              to={`/products/${row.original.item_id}`}
            >
              {row.getValue("item_name")}
            </Link>
          ),
        },
        {
          id: "project_name",
          accessorFn: (row) => poProjectMap[row.procurement_order] || "N/A",
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Project" />
          ),
          cell: ({ row }) => (
            <div className="font-medium truncate">
              {row.getValue("project_name")}
            </div>
          ),
          filterFn: facetedFilterFn,
        },
        {
          accessorKey: "vendor",
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Vendor" />
          ),
          cell: ({ row }) => {
            const vendorId = row.getValue<string>("vendor");
            const vendorName = vendorMap.get(vendorId) || vendorId;
            return (
              <Link
                className="text-blue-600 hover:underline font-medium"
                to={`/vendors/${vendorId}`}
              >
                {vendorName}
              </Link>
            );
          },
          filterFn: facetedFilterFn,
        },
         {
          accessorKey: "unit",
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Unit" />
          ),
          cell: ({ row }) => (
            <div className="font-medium text-left">{row.getValue("unit")}</div>
          ),
          filterFn: facetedFilterFn,
        },
         {
          accessorKey: "quantity",
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Qty" />
          ),
          cell: ({ row }) => (
            <div className="font-medium text-left">
              {row.getValue("quantity") || "1"}
            </div>
          ),
          enableColumnFilter: false,
        },
        {
          accessorKey: "quote",
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Rate" />
          ),
          cell: ({ row }) => (
            <div className="font-medium text-left pr-2">
              {formatToRoundedIndianRupee(row.getValue("quote"))}
            </div>
          ),
          enableColumnFilter: false,
        },
       
       
        {
          id: "amount",
          accessorFn: (row) => calculateTotalAmount(row),
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Amount (excl. GST)" />
          ),
          cell: ({ row }) => (
            <div className="font-medium text-center pr-2">
              {formatToRoundedIndianRupee(row.getValue("amount"))}
            </div>
          ),
          enableColumnFilter: false,
        },
        {
          accessorKey: "make",
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Make" />
          ),
          cell: ({ row }) => (
            <div className="font-medium">{row.getValue("make") || "--"}</div>
          ),
          enableColumnFilter: false,
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
                to={`/project-payments/${poId.replaceAll("/", "&=")}`}
              >
                {poId}
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">N/A</span>
            );
          },
          enableColumnFilter: false,
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
          filterFn: dateFilterFn,
        },
      ],
      [vendorMap, poProjectMap]
    );
  // A single, fully client-controlled table instance using the client-filtered data
  const table = useReactTable({
    data: filteredData,
    columns,
    state: {
      columnFilters,
      pagination,
      sorting,
      globalFilter,
    },
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const itemFacetOptions = useMemo(() => {
    if (!allItems) return [];
    return allItems.map((item) => ({
      label: item.item_name,
      value: item.item_name,
    }));
  }, [allItems]);

  const projectFacetOptions = useMemo(() => {
    if (!poList) return [];
    const projectNames = new Set(
      poList.map((po) => po.project_name).filter(Boolean)
    );
    return Array.from(projectNames).map((name) => ({
      label: name!,
      value: name!,
    }));
  }, [poList]);

  const facetFilterOptions = useMemo(
    () => ({
      // item_name: { title: "Item", options: itemFacetOptions },
      project_name: { title: "Project", options: projectFacetOptions },
      vendor: { title: "Vendor", options: vendorOptionsForSelect },
      unit: { title: "Unit", options: UnitOptions },
    }),
    [itemFacetOptions, projectFacetOptions, vendorOptionsForSelect]
  );

  
  const overallIsLoading =
    aqTableLoading || vendorsLoading || allItemsLoading || poListLoading;
  const overallError = aqTableError;

  return (
    <div className="flex-1 space-y-4 p-4 md:p-6">
       <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">
            Approved Quotations 
          </h1>{" "}
        </div>
     

      <DataTable
        table={table}
        columns={columns}
        isLoading={overallIsLoading}
        error={overallError}
        totalCount={table.getFilteredRowModel().rows.length}
        searchFieldOptions={AQ_SEARCHABLE_FIELDS}
        selectedSearchField={AQ_SEARCHABLE_FIELDS[0].value}
        onSelectedSearchFieldChange={() => {}} // No longer needed
        searchTerm={globalFilter}
        onSearchTermChange={setGlobalFilter}
        showSearchBar={true}
        facetFilterOptions={facetFilterOptions}
        dateFilterColumns={AQ_DATE_COLUMNS}
        showExportButton={true}
        onExport={"default"}
        exportFileName="approved_quotations_data"
      />
    </div>
  );
}