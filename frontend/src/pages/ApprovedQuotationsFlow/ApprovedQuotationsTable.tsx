/**
 * @file ApprovedQuotationsTable.tsx
 * @description Final, robust version with a fully client-side filtering and pagination model.
 */

import { useMemo, useState, useCallback, useRef } from "react";
import Fuse from "fuse.js";
import { ColumnDef, useReactTable, getCoreRowModel, getPaginationRowModel, getSortedRowModel, getFilteredRowModel, ColumnFiltersState, PaginationState, SortingState } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList } from "frappe-react-sdk";

// UI Components
import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X as XIcon, ChevronsUpDown, PlusCircleIcon } from "lucide-react";

// Hooks, Utils, and Types
import { ApprovedQuotations as ApprovedQuotationsType } from "@/types/NirmaanStack/ApprovedQuotations";
import { Items as ItemsType } from "@/types/NirmaanStack/Items";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { useVendorsList } from "../ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { UnitOptions } from "@/components/helpers/SelectUnit";
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

interface ApprovedQuotationsTableProps { productId?: string; item_name?: string; }
interface ProcurementOrderType { name: string; project_name?: string; }
interface AQWithProject extends ApprovedQuotationsType { project_name: string; }

const calculateTotalAmount = (row: ApprovedQuotationsType): number => {
    const quote = parseFloat(row.quote || "0");
    const quantity = parseFloat(row.quantity || "1");
    const tax = parseFloat(row.tax || "0");
    return quote * quantity * (1 + tax / 100);
};

export default function ApprovedQuotationsTable({ productId, item_name }: ApprovedQuotationsTableProps) {
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [itemSearchInput, setItemSearchInput] = useState("");
  const [isPopoverOpen, setPopoverOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = useState<SortingState>([{ id: "creation", desc: true }]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });
  const [globalFilter, setGlobalFilter] = useState('');

  // --- Data fetching for UI elements and enrichment ---
  const { data: allItems, isLoading: allItemsLoading } = useFrappeGetDocList<ItemsType>(ITEM_DOCTYPE, { fields: ["name", "item_name"], limit: 0 }, "all_items_for_fuzzy_search");
  const { data: vendorsList, vendorOptionsForSelect, isLoading: vendorsLoading } = useVendorsList({ vendorTypes: ["Service", "Material & Service", "Material"] });
  const { data: poList, isLoading: poListLoading } = useFrappeGetDocList<ProcurementOrderType>("Procurement Orders", { fields: ["name", "project_name"], limit: 0 }, "po_list_for_project_name_lookup");
  
  const fuse = useMemo(() => allItems ? new Fuse(allItems, { keys: ["item_name"], threshold: 0.4 }) : null, [allItems]);
  const itemSuggestions = useMemo(() => {
    if (!itemSearchInput.trim() || !fuse) return [];
    return fuse.search(itemSearchInput).slice(0, 10).map((result) => result.item);
  }, [itemSearchInput, fuse]);
  const vendorMap = useMemo(() => {
    const map = new Map<string, string>();
    vendorsList?.forEach((vendor) => map.set(vendor.name, vendor.vendor_name));
    return map;
  }, [vendorsList]);
  const poProjectMap = useMemo(() => {
      const map: { [key: string]: string } = {};
      poList?.forEach(po => {
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
  const { data: serverData, isLoading: aqTableLoading, error: aqTableError } = useFrappeGetDocList<ApprovedQuotationsType>(
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
          const selectedItemValues = new Set(selectedItems.map(item => item.value));
          return serverData.filter(aq => selectedItemValues.has(aq.item_id));
      }
      // Otherwise, return the full dataset fetched from the server.
      return serverData;
  }, [serverData, selectedItems, productId]);
  
  const columns = useMemo<ColumnDef<ApprovedQuotationsType>[]>(() => [
    { accessorKey: "item_name", header: ({ column }) => <DataTableColumnHeader column={column} title="Item" />, filterFn: facetedFilterFn, cell: ({ row }) => <Link className="text-blue-600 hover:underline font-medium" to={`/products/${row.original.item_id}`}>{row.getValue("item_name")}</Link> },
    { id: "project_name", accessorFn: (row) => poProjectMap[row.procurement_order] || 'N/A', header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />, cell: ({ row }) => <div className="font-medium truncate">{row.getValue("project_name")}</div>, filterFn: facetedFilterFn },
    { accessorKey: "vendor", header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />, cell: ({ row }) => { const vendorId = row.getValue<string>("vendor"); const vendorName = vendorMap.get(vendorId) || vendorId; return <Link className="text-blue-600 hover:underline font-medium" to={`/vendors/${vendorId}`}>{vendorName}</Link>; }, filterFn: facetedFilterFn },
    { accessorKey: "quote", header: ({ column }) => <DataTableColumnHeader column={column} title="Quoted Price" />, cell: ({ row }) => <div className="font-medium text-right pr-2">{formatToRoundedIndianRupee(row.getValue("quote"))}</div>, enableColumnFilter: false },
    { accessorKey: "quantity", header: ({ column }) => <DataTableColumnHeader column={column} title="Qty" />, cell: ({ row }) => <div className="font-medium text-center">{row.getValue("quantity") || "1"}</div>, enableColumnFilter: false },
    { accessorKey: "unit", header: ({ column }) => <DataTableColumnHeader column={column} title="Unit" />, cell: ({ row }) => <div className="font-medium text-center">{row.getValue("unit")}</div>, filterFn: facetedFilterFn },
    { id: "amount", accessorFn: (row) => calculateTotalAmount(row), header: ({ column }) => <DataTableColumnHeader column={column} title="Amount (incl. Tax)" />, cell: ({ row }) => <div className="font-medium text-center pr-2">{formatToRoundedIndianRupee(row.getValue("amount"))}</div>, enableColumnFilter: false },
    { accessorKey: "make", header: ({ column }) => <DataTableColumnHeader column={column} title="Make" />, cell: ({ row }) => <div className="font-medium">{row.getValue("make") || "--"}</div>, enableColumnFilter: false },
    { accessorKey: "procurement_order", header: ({ column }) => <DataTableColumnHeader column={column} title="PO #" />, cell: ({ row }) => { const poId = row.getValue<string>("procurement_order"); return poId ? <Link className="text-blue-600 hover:underline font-medium" to={`/project-payments/${poId.replaceAll("/", "&=")}`}>{poId}</Link> : <span className="text-xs text-muted-foreground">N/A</span>; }, enableColumnFilter: false },
    { accessorKey: "creation", header: ({ column }) => <DataTableColumnHeader column={column} title="Date Approved" />, cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>, filterFn: dateFilterFn },
  ], [vendorMap, poProjectMap]);

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
    return allItems.map(item => ({ label: item.item_name, value: item.item_name }));
  },[allItems])

  const projectFacetOptions = useMemo(() => {
    if (!poList) return [];
    const projectNames = new Set(poList.map(po => po.project_name).filter(Boolean));
    return Array.from(projectNames).map(name => ({ label: name!, value: name! }));
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
  
  const handleItemSelect = useCallback((item: ItemsType) => {
    if (!selectedItems.some((selected) => selected.value === item.name)) {
      setSelectedItems((prev) => [...prev, { value: item.name, label: item.item_name }]);
    }
    inputRef.current?.focus();
  }, [selectedItems]);
  
  const handleItemRemove = useCallback((itemId: string) => {
    setSelectedItems((prev) => prev.filter((item) => item.value !== itemId));
  }, []);
  
  const overallIsLoading = aqTableLoading || vendorsLoading || allItemsLoading || poListLoading;
  const overallError = aqTableError;

  return (
    <div className="flex-1 space-y-4 p-4 md:p-6">
      {!productId ? (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium text-muted-foreground">Filter by Products</label>
            {selectedItems.length > 0 && (<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedItems([])}>Clear All</Button>)}
          </div>
          <Popover open={isPopoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-auto min-h-10">
                <div className="flex flex-wrap gap-1">
                  {selectedItems.length > 0 ? (
                    selectedItems.map((item) => (
                      <Badge key={item.value} variant="secondary" className="flex items-center gap-1.5 text-sm font-normal py-1">
                        <span className="text-blue-600 font-medium">{item.label}</span>
                        <button onClick={(e) => { e.stopPropagation(); handleItemRemove(item.value); }} className="rounded-full hover:bg-muted-foreground/20 p-0.5" aria-label={`Remove ${item.label}`}><XIcon className="h-3.5 w-3.5 text-red-500 hover:text-red-700" /></button>
                      </Badge>
                    ))
                  ) : (<span className="text-muted-foreground">Search for products to filter...</span>)}
                </div>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <div className="flex items-center border-b px-3">
                  <CommandInput ref={inputRef} placeholder="Search for a product..." value={itemSearchInput} onValueChange={setItemSearchInput} className="h-10 border-0 shadow-none pl-0 focus-visible:ring-0" />
                  {itemSearchInput.length > 0 && (<Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => { setItemSearchInput(""); inputRef.current?.focus(); }} aria-label="Clear search"><XIcon className="h-4 w-4" /></Button>)}
                </div>
                <CommandList>
                  <CommandEmpty>{allItemsLoading ? "Loading products..." : "No matching products found."}</CommandEmpty>
                  <CommandGroup>
                    {itemSuggestions.filter((suggestion) => !selectedItems.some((item) => item.value === suggestion.name)).map((suggestion) => (
                        <CommandItem key={suggestion.name} value={suggestion.item_name} className="flex justify-between items-center">
                          <span>{suggestion.item_name}</span>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); handleItemSelect(suggestion); }} aria-label={`Add ${suggestion.item_name}`}><PlusCircleIcon className="h-5 w-5 text-muted-foreground hover:text-primary" /></Button>
                        </CommandItem>
                      ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      ):(
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">
            Approved Quotations for {item_name}           </h1>         </div>
      )
      }
      
      <DataTable
        table={table}
        columns={columns}
        isLoading={overallIsLoading}
        error={overallError}
        totalCount={table.getFilteredRowModel().rows.length}
        searchFieldOptions={AQ_SEARCHABLE_FIELDS}
        selectedSearchField={AQ_SEARCHABLE_FIELDS[0].value}
        onSelectedSearchFieldChange={()=>{}} // No longer needed
        searchTerm={globalFilter}
        onSearchTermChange={setGlobalFilter}
        showSearchBar={productId?true:false}
        facetFilterOptions={facetFilterOptions}
        dateFilterColumns={AQ_DATE_COLUMNS}
        showExportButton={true}
        onExport={"default"}
        exportFileName="approved_quotations_data"
      />
    </div>
  );
}



// client Side Table

// import { useMemo, useState, useCallback, useRef } from "react";
// import Fuse from "fuse.js";
// import { ColumnDef, useReactTable, getCoreRowModel, getPaginationRowModel, getSortedRowModel, getFilteredRowModel, ColumnFiltersState, PaginationState, SortingState } from "@tanstack/react-table";
// import { Link } from "react-router-dom";
// import { useFrappeGetDocList } from "frappe-react-sdk";

// // UI Components
// import { DataTable } from "@/components/data-table/new-data-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
// import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
// import { Badge } from "@/components/ui/badge";
// import { Button } from "@/components/ui/button";
// import { X as XIcon, ChevronsUpDown, PlusCircleIcon } from "lucide-react";

// // Hooks, Utils, and Types
// import { ApprovedQuotations as ApprovedQuotationsType } from "@/types/NirmaanStack/ApprovedQuotations";
// import { Items as ItemsType } from "@/types/NirmaanStack/Items";
// import { formatDate } from "@/utils/FormatDate";
// import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
// import { useVendorsList } from "../ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
// import { UnitOptions } from "@/components/helpers/SelectUnit";
// import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";

// // Constants
// import {
//   APPROVED_QUOTATION_DOCTYPE,
//   AQ_LIST_FIELDS_TO_FETCH,
//   AQ_SEARCHABLE_FIELDS,
//   AQ_DATE_COLUMNS,
//   ITEM_DOCTYPE,
//   getSingleItemStaticFilters, // We only need this one now
//   SelectedItem,
// } from "./approvedQuotations.constants";

// interface ApprovedQuotationsTableProps { productId?: string; item_name?: string; }
// interface ProcurementOrderType { name: string; project_name?: string; }

// const calculateTotalAmount = (row: ApprovedQuotationsType): number => {
//     const quote = parseFloat(row.quote || "0");
//     const quantity = parseFloat(row.quantity || "1");
//     const tax = parseFloat(row.tax || "0");
//     return quote * quantity * (1 + tax / 100);
// };

// export default function ApprovedQuotationsTable({ productId, item_name }: ApprovedQuotationsTableProps) {
//   const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
//   const [itemSearchInput, setItemSearchInput] = useState("");
//   const [isPopoverOpen, setPopoverOpen] = useState(false);
//   const inputRef = useRef<HTMLInputElement>(null);
  
//   // --- Local state for the fully client-controlled table ---
//   const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
//   const [sorting, setSorting] = useState<SortingState>([{ id: "creation", desc: true }]);
//   const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });
//   const [globalFilter, setGlobalFilter] = useState('');

//   // --- Data fetching for UI elements and enrichment ---
//   const { data: allItems, isLoading: allItemsLoading } = useFrappeGetDocList<ItemsType>(ITEM_DOCTYPE, { fields: ["name", "item_name"], limit: 0 }, "all_items_for_fuzzy_search");
//   const { data: vendorsList, vendorOptionsForSelect, isLoading: vendorsLoading } = useVendorsList({ vendorTypes: ["Service", "Material & Service", "Material"] });
//   const { data: poList, isLoading: poListLoading } = useFrappeGetDocList<ProcurementOrderType>("Procurement Orders", { fields: ["name", "project_name"], limit: 0 }, "po_list_for_project_name_lookup");
  
//   const fuse = useMemo(() => allItems ? new Fuse(allItems, { keys: ["item_name"], threshold: 0.4 }) : null, [allItems]);
//   const itemSuggestions = useMemo(() => {
//     if (!itemSearchInput.trim() || !fuse) return [];
//     return fuse.search(itemSearchInput).slice(0, 10).map((result) => result.item);
//   }, [itemSearchInput, fuse]);
//   const vendorMap = useMemo(() => {
//     const map = new Map<string, string>();
//     vendorsList?.forEach((vendor) => map.set(vendor.name, vendor.vendor_name));
//     return map;
//   }, [vendorsList]);
//   const poProjectMap = useMemo(() => {
//       const map: { [key: string]: string } = {};
//       poList?.forEach(po => {
//           if (po.name && po.project_name) map[po.name] = po.project_name;
//       });
//       return map;
//   }, [poList]);
  
//   // If a specific product page, apply a server-side filter. Otherwise, fetch all.
//   const serverSideFilters = useMemo(() => {
//     return productId ? getSingleItemStaticFilters(productId) : [];
//   }, [productId]);
  
//   // --- This is now the ONLY server data fetching hook ---
//   const { data: serverData, isLoading: aqTableLoading, error: aqTableError } = useFrappeGetDocList<ApprovedQuotationsType>(
//     APPROVED_QUOTATION_DOCTYPE,
//     {
//         fields: AQ_LIST_FIELDS_TO_FETCH,
//         filters: serverSideFilters,
//         limit: 0, // Fetch all matching results
//     },
//     `aq_data_client_side_table_${productId}`
//   );

//   // The multi-select item filter now happens entirely on the client
//   const filteredData = useMemo(() => {
//       if (!serverData) return [];
//       if (selectedItems.length === 0) {
//           return serverData; // If no items are selected, show all fetched data
//       }
//       const selectedItemValues = new Set(selectedItems.map(item => item.value));
//       return serverData.filter(aq => selectedItemValues.has(aq.item_id));
//   }, [serverData, selectedItems]);
  
//   // Column definitions now use accessorFn for derived data, which is robust
//   const columns = useMemo<ColumnDef<ApprovedQuotationsType>[]>(() => [
//     { accessorKey: "item_name", header: ({ column }) => <DataTableColumnHeader column={column} title="Item" />, filterFn: facetedFilterFn, cell: ({ row }) => <Link className="text-blue-600 hover:underline font-medium" to={`/products/${row.original.item_id}`}>{row.getValue("item_name")}</Link> },
//     { id: "project_name", accessorFn: (row) => poProjectMap[row.procurement_order] || 'N/A', header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />, cell: ({ row }) => <div className="font-medium truncate">{row.getValue("project_name")}</div>, filterFn: facetedFilterFn },
//     { accessorKey: "vendor", header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />, cell: ({ row }) => { const vendorId = row.getValue<string>("vendor"); const vendorName = vendorMap.get(vendorId) || vendorId; return <Link className="text-blue-600 hover:underline font-medium" to={`/vendors/${vendorId}`}>{vendorName}</Link>; }, filterFn: facetedFilterFn },
//     { accessorKey: "quote", header: ({ column }) => <DataTableColumnHeader column={column} title="Quoted Price" />, cell: ({ row }) => <div className="font-medium text-right pr-2">{formatToRoundedIndianRupee(row.getValue("quote"))}</div>, enableColumnFilter: false },
//     { accessorKey: "quantity", header: ({ column }) => <DataTableColumnHeader column={column} title="Qty" />, cell: ({ row }) => <div className="font-medium text-center">{row.getValue("quantity") || "1"}</div>, enableColumnFilter: false },
//     { accessorKey: "unit", header: ({ column }) => <DataTableColumnHeader column={column} title="Unit" />, cell: ({ row }) => <div className="font-medium text-center">{row.getValue("unit")}</div>, filterFn: facetedFilterFn },
//     { id: "amount", accessorFn: (row) => calculateTotalAmount(row), header: ({ column }) => <DataTableColumnHeader column={column} title="Amount (incl. Tax)" />, cell: ({ row }) => <div className="font-medium text-center pr-2">{formatToRoundedIndianRupee(row.getValue("amount"))}</div>, enableColumnFilter: false },
//     { accessorKey: "make", header: ({ column }) => <DataTableColumnHeader column={column} title="Make" />, cell: ({ row }) => <div className="font-medium">{row.getValue("make") || "--"}</div>, enableColumnFilter: false },
//     { accessorKey: "procurement_order", header: ({ column }) => <DataTableColumnHeader column={column} title="PO #" />, cell: ({ row }) => { const poId = row.getValue<string>("procurement_order"); return poId ? <Link className="text-blue-600 hover:underline font-medium" to={`/project-payments/${poId.replaceAll("/", "&=")}`}>{poId}</Link> : <span className="text-xs text-muted-foreground">N/A</span>; }, enableColumnFilter: false },
//     { accessorKey: "creation", header: ({ column }) => <DataTableColumnHeader column={column} title="Date Approved" />, cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>, filterFn: dateFilterFn },
//   ], [vendorMap, poProjectMap]);

//   // A single, fully client-controlled table instance using the client-filtered data
//   const table = useReactTable({
//       data: filteredData,
//       columns,
//       state: {
//           columnFilters,
//           pagination,
//           sorting,
//           globalFilter,
//       },
//       onColumnFiltersChange: setColumnFilters,
//       onPaginationChange: setPagination,
//       onSortingChange: setSorting,
//       onGlobalFilterChange: setGlobalFilter,
//       getCoreRowModel: getCoreRowModel(),
//       getPaginationRowModel: getPaginationRowModel(),
//       getSortedRowModel: getSortedRowModel(),
//       getFilteredRowModel: getFilteredRowModel(),
//   });
  
//   const itemFacetOptions = useMemo(() => {
//     if (!allItems) return [];
//     return allItems.map(item => ({ label: item.item_name, value: item.item_name }));
//   },[allItems])

//   const projectFacetOptions = useMemo(() => {
//     if (!poList) return [];
//     const projectNames = new Set(poList.map(po => po.project_name).filter(Boolean));
//     return Array.from(projectNames).map(name => ({ label: name!, value: name! }));
//   }, [poList]);

//   const facetFilterOptions = useMemo(
//     () => ({
//       item_name: { title: "Item", options: itemFacetOptions },
//       project_name: { title: "Project", options: projectFacetOptions },
//       vendor: { title: "Vendor", options: vendorOptionsForSelect },
//       unit: { title: "Unit", options: UnitOptions },
//     }),
//     [itemFacetOptions, projectFacetOptions, vendorOptionsForSelect]
//   );
  
//   const handleItemSelect = useCallback((item: ItemsType) => {
//     if (!selectedItems.some((selected) => selected.value === item.name)) {
//       setSelectedItems((prev) => [...prev, { value: item.name, label: item.item_name }]);
//     }
//     inputRef.current?.focus();
//   }, [selectedItems]);
  
//   const handleItemRemove = useCallback((itemId: string) => {
//     setSelectedItems((prev) => prev.filter((item) => item.value !== itemId));
//   }, []);
  
//   const overallIsLoading = aqTableLoading || vendorsLoading || allItemsLoading || poListLoading;
//   const overallError = aqTableError;

//   return (
//     <div className="flex-1 space-y-4 p-4 md:p-6">
//       {!productId && (
//         <div className="space-y-3">
//           <div className="flex justify-between items-center">
//             <label className="text-sm font-medium text-muted-foreground">Filter by Products</label>
//             {selectedItems.length > 0 && (<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedItems([])}>Clear All</Button>)}
//           </div>
//           <Popover open={isPopoverOpen} onOpenChange={setPopoverOpen}>
//             <PopoverTrigger asChild>
//               <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-auto min-h-10">
//                 <div className="flex flex-wrap gap-1">
//                   {selectedItems.length > 0 ? (
//                     selectedItems.map((item) => (
//                       <Badge key={item.value} variant="secondary" className="flex items-center gap-1.5 text-sm font-normal py-1">
//                         <span className="text-blue-600 font-medium">{item.label}</span>
//                         <button onClick={(e) => { e.stopPropagation(); handleItemRemove(item.value); }} className="rounded-full hover:bg-muted-foreground/20 p-0.5" aria-label={`Remove ${item.label}`}><XIcon className="h-3.5 w-3.5 text-red-500 hover:text-red-700" /></button>
//                       </Badge>
//                     ))
//                   ) : (<span className="text-muted-foreground">Search for products to filter...</span>)}
//                 </div>
//                 <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
//               </Button>
//             </PopoverTrigger>
//             <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
//               <Command>
//                 <div className="flex items-center border-b px-3">
//                   <CommandInput ref={inputRef} placeholder="Search for a product..." value={itemSearchInput} onValueChange={setItemSearchInput} className="h-10 border-0 shadow-none pl-0 focus-visible:ring-0" />
//                   {itemSearchInput.length > 0 && (<Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => { setItemSearchInput(""); inputRef.current?.focus(); }} aria-label="Clear search"><XIcon className="h-4 w-4" /></Button>)}
//                 </div>
//                 <CommandList>
//                   <CommandEmpty>{allItemsLoading ? "Loading products..." : "No matching products found."}</CommandEmpty>
//                   <CommandGroup>
//                     {itemSuggestions.filter((suggestion) => !selectedItems.some((item) => item.value === suggestion.name)).map((suggestion) => (
//                         <CommandItem key={suggestion.name} value={suggestion.item_name} className="flex justify-between items-center">
//                           <span>{suggestion.item_name}</span>
//                           <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); handleItemSelect(suggestion); }} aria-label={`Add ${suggestion.item_name}`}><PlusCircleIcon className="h-5 w-5 text-muted-foreground hover:text-primary" /></Button>
//                         </CommandItem>
//                       ))}
//                   </CommandGroup>
//                 </CommandList>
//               </Command>
//             </PopoverContent>
//           </Popover>
//         </div>
//       )}
      
//       <DataTable
//         table={table}
//         columns={columns}
//         isLoading={overallIsLoading}
//         error={overallError}
//         totalCount={table.getFilteredRowModel().rows.length}
//         searchFieldOptions={AQ_SEARCHABLE_FIELDS}
//         selectedSearchField={AQ_SEARCHABLE_FIELDS[0].value}
//         onSelectedSearchFieldChange={() => {}}
//         searchTerm={globalFilter}
//         onSearchTermChange={setGlobalFilter}
//         showSearchBar={!productId}
//         facetFilterOptions={facetFilterOptions}
//         dateFilterColumns={AQ_DATE_COLUMNS}
//         showExportButton={true}
//         onExport={"default"}
//         exportFileName="approved_quotations_data"
//       />
//     </div>
//   );
// }


//-----------SERVER DATA Table-----------------

// import { useMemo, useState, useCallback, useRef } from "react";
// import Fuse from "fuse.js";
// import { ColumnDef } from "@tanstack/react-table";
// import { Link } from "react-router-dom";
// import { useFrappeGetDocList } from "frappe-react-sdk";

// // UI Components
// import { DataTable } from "@/components/data-table/new-data-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import {
//   Command,
//   CommandEmpty,
//   CommandGroup,
//   CommandInput,
//   CommandItem,
//   CommandList,
// } from "@/components/ui/command";
// import {
//   Popover,
//   PopoverContent,
//   PopoverTrigger,
// } from "@/components/ui/popover";
// import { Badge } from "@/components/ui/badge";
// import { Button } from "@/components/ui/button";
// import { X as XIcon, ChevronsUpDown, PlusCircleIcon } from "lucide-react";

// // Hooks, Utils, and Types
// import { useServerDataTable } from "@/hooks/useServerDataTable";
// import { ApprovedQuotations as ApprovedQuotationsType } from "@/types/NirmaanStack/ApprovedQuotations";
// import { Items as ItemsType } from "@/types/NirmaanStack/Items";
// import { formatDate } from "@/utils/FormatDate";
// import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
// import { useVendorsList } from "../ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
// import { UnitOptions } from "@/components/helpers/SelectUnit";

// // Constants and Filters
// import {
//   APPROVED_QUOTATION_DOCTYPE,
//   AQ_LIST_FIELDS_TO_FETCH,
//   AQ_SEARCHABLE_FIELDS,
//   AQ_DATE_COLUMNS,
//   ITEM_DOCTYPE,
//   getItemsStaticFilters,
//   getSingleItemStaticFilters,
//   SelectedItem,
// } from "./approvedQuotations.constants";

// interface ApprovedQuotationsTableProps {
//   productId?: string;
//   item_name?: string;
// }

// interface ProcurementOrderType {
//   name: string;
//   project_name?: string;
// }

// // Helper function to calculate the amount, used by both cell and export
// const calculateTotalAmount = (row: ApprovedQuotationsType): number => {
//   const quote = parseFloat(row.quote || "0");
//   const quantity = parseFloat(row.quantity || "1");
//   const tax = parseFloat(row.tax || "0");
//   return quote * quantity * (1 + tax / 100);
// };

// export default function ApprovedQuotationsTable({
//   productId,
//   item_name,
// }: ApprovedQuotationsTableProps) {
//   const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
//   const [itemSearchInput, setItemSearchInput] = useState("");
//   const [isPopoverOpen, setPopoverOpen] = useState(false);
//   const inputRef = useRef<HTMLInputElement>(null);

//   const { data: allItems, isLoading: allItemsLoading } =
//     useFrappeGetDocList<ItemsType>(
//       ITEM_DOCTYPE,
//       { fields: ["name", "item_name"], limit: 0 },
//       "all_items_for_fuzzy_search"
//     );

//   const fuse = useMemo(
//     () =>
//       allItems
//         ? new Fuse(allItems, { keys: ["item_name"], threshold: 0.4 })
//         : null,
//     [allItems]
//   );

//   const itemSuggestions = useMemo(() => {
//     if (!itemSearchInput.trim() || !fuse) return [];
//     return fuse
//       .search(itemSearchInput)
//       .slice(0, 10)
//       .map((result) => result.item);
//   }, [itemSearchInput, fuse]);

//   const {
//     data: vendorsList,
//     vendorOptionsForSelect,
//     isLoading: vendorsLoading,
//   } = useVendorsList({
//     vendorTypes: ["Service", "Material & Service", "Material"],
//   });

//   const vendorMap = useMemo(() => {
//     const map = new Map<string, string>();
//     vendorsList?.forEach((vendor) => map.set(vendor.name, vendor.vendor_name));
//     return map;
//   }, [vendorsList]);
//   // --- NEW: Fetch Procurement Orders for Project Name lookup ---
//   const { data: poList, isLoading: poListLoading } =
//     useFrappeGetDocList<ProcurementOrderType>(
//       "Procurement Orders",
//       { fields: ["name", "project_name"],limit:0 },
//       "po_list_for_project_name_lookup"
//     );

//    // --- THIS IS THE FIX 1: Using a plain object for the lookup map ---
//     const poProjectMap = useMemo(() => {
//         const map: { [key: string]: string } = {}; // Explicitly type the object
//         // console.log("poList", poList);
//         poList?.forEach(po => {
//             if (po.name && po.project_name) {
//                 map[po.name] = po.project_name;
//             }
//         });
//         return map;
//     }, [poList]);

// //   console.log("poProjectMap", poProjectMap);

//   const handleItemSelect = useCallback(
//     (item: ItemsType) => {
//       // setItemSearchInput("");
//       if (!selectedItems.some((selected) => selected.value === item.name)) {
//         setSelectedItems((prev) => [
//           ...prev,
//           { value: item.name, label: item.item_name },
//         ]);
//       }
//       inputRef.current?.focus();
//     },
//     [selectedItems]
//   );

//   const handleItemRemove = useCallback((itemId: string) => {
//     setSelectedItems((prev) => prev.filter((item) => item.value !== itemId));
//   }, []);

//   const staticFilters = useMemo(() => {
//     return productId
//       ? getSingleItemStaticFilters(productId)
//       : getItemsStaticFilters(selectedItems);
//   }, [productId, selectedItems]);

//   const columns = useMemo<ColumnDef<ApprovedQuotationsType>[]>(
//     () => [
//       // Full column definitions
//     //   {
//     //     accessorKey: "name",
//     //     header: ({ column }) => (
//     //       <DataTableColumnHeader column={column} title="Quote ID" />
//     //     ),
//     //     cell: ({ row }) => (
//     //       <div className="font-medium whitespace-nowrap">
//     //         {row.getValue("name")}
//     //       </div>
//     //     ),
//     //     size: 180,
//     //     meta: { exportHeaderName: "Quote ID", exportValue: (row) => row.name },
//     //   },
//       {
//         accessorKey: "item_name",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Item" />
//         ),
//         cell: ({ row }) => {
//           const itemId = row.original.item_id;
//           return itemId ? (
//             <Link
//               className="text-blue-600 hover:underline font-medium"
//               to={`/products/${itemId}`}
//             >
//               {row.getValue("item_name")}
//             </Link>
//           ) : (
//             <div className="font-medium">{row.getValue("item_name")}</div>
//           );
//         },
//         size: 250,
//         meta: {
//           exportHeaderName: "Item Name",
//           exportValue: (row) => row.item_name,
//         },
//       },
//             { 
//             id: "project",
//             header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
//             cell: ({ row }) => {
//                 const poId = row.original.procurement_order;
//                 // --- CORRECTED ACCESSOR ---
//                 const projectName = poId ? poProjectMap[poId] : undefined;

//                 return <div className="font-medium truncate">{projectName || '--'}</div>;
//             },
//             size: 200,
//             meta: { 
//                 exportHeaderName: "Project", 
//                 exportValue: (row) => {
//                     const poId = row.original.procurement_order;
//                     return poId ? poProjectMap[poId]: '--';
//                 }
//             }
//         },


//       {
//         accessorKey: "vendor",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Vendor" />
//         ),
//         cell: ({ row }) => {
//           const vendorId = row.getValue<string>("vendor");
//           const vendorName = vendorMap.get(vendorId) || vendorId;
//           return vendorId ? (
//             <Link
//               className="text-blue-600 hover:underline font-medium"
//               to={`/vendors/${vendorId}`}
//             >
//               {vendorName}
//             </Link>
//           ) : (
//             <div className="font-medium">{"--"}</div>
//           );
//         },
//         size: 220,
//         meta: {
//           exportHeaderName: "Vendor Name",
//           exportValue: (row) => vendorMap.get(row.vendor) || row.vendor,
//         },
//       },
//       {
//         accessorKey: "quote",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Quoted Price" />
//         ),
//         cell: ({ row }) => (
//           <div className="font-medium text-right pr-2">
//             {formatToRoundedIndianRupee(row.getValue("quote"))}
//           </div>
//         ),
//         meta: {
//           isNumeric: true,
//           exportHeaderName: "Quoted Price",
//           exportValue: (row) => formatToRoundedIndianRupee(row.quote),
//         },
//         size: 150,
//       },
//       {
//         accessorKey: "quantity",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Qty" />
//         ),
//         cell: ({ row }) => (
//           <div className="font-medium text-center">
//             {row.getValue("quantity") || "1"}
//           </div>
//         ),
//         meta: {
//           isNumeric: true,
//           exportHeaderName: "Quantity",
//           exportValue: (row) => row.quantity || 1,
//         },
//         size: 80,
//       },
//       {
//         accessorKey: "unit",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Unit" />
//         ),
//         cell: ({ row }) => (
//           <div className="font-medium text-center">{row.getValue("unit")}</div>
//         ),
//         size: 100,
//         meta: { exportHeaderName: "Unit", exportValue: (row) => row.unit },
//       },
//       {
//         id: "amount",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Amount (incl. Tax)" />
//         ),
//         cell: ({ row }) => (
//           <div className="font-medium text-center pr-2">
//             {formatToRoundedIndianRupee(calculateTotalAmount(row.original))}
//           </div>
//         ),
//         size: 160,
//         meta: {
//           isNumeric: true,
//           exportHeaderName: "Amount (incl. Tax)",
//           exportValue: (row) =>
//             formatToRoundedIndianRupee(calculateTotalAmount(row.original)),
//         },
//       },
//       {
//         accessorKey: "make",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Make" />
//         ),
//         cell: ({ row }) => (
//           <div className="font-medium">{row.getValue("make") || "--"}</div>
//         ),
//         size: 120,
//         meta: {
//           exportHeaderName: "Make",
//           exportValue: (row) => row.make || "--",
//         },
//       },
//       {
//         accessorKey: "procurement_order",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="PO #" />
//         ),
//         cell: ({ row }) => {
//           const poId = row.getValue<string>("procurement_order");
//           return poId ? (
//             <Link
//               className="text-blue-600 hover:underline font-medium"
//               to={`/project-payments/${poId.replaceAll("/", "&=")}`}
//             >
//               {poId}
//             </Link>
//           ) : (
//             <span className="text-xs text-muted-foreground">N/A</span>
//           );
//         },
//         size: 180,
//         meta: {
//           exportHeaderName: "PO #",
//           exportValue: (row) => row.procurement_order,
//         },
//       },
//       {
//         accessorKey: "creation",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Date Approved" />
//         ),
//         cell: ({ row }) => (
//           <div className="font-medium whitespace-nowrap">
//             {formatDate(row.getValue("creation"))}
//           </div>
//         ),
//         size: 150,
//         meta: {
//           isDate: true,
//           exportHeaderName: "Date Approved",
//           exportValue: (row) => formatDate(row.creation),
//         },
//       },
//     ],
//     [vendorMap]
//   );

//   const {
//     table,
//     totalCount,
//     isLoading: aqTableLoading,
//     error: aqTableError,
//     searchTerm,
//     setSearchTerm,
//     selectedSearchField,
//     setSelectedSearchField,
//   } = useServerDataTable<ApprovedQuotationsType>({
//     doctype: APPROVED_QUOTATION_DOCTYPE,
//     columns,
//     fetchFields: AQ_LIST_FIELDS_TO_FETCH as string[],
//     searchableFields: AQ_SEARCHABLE_FIELDS,
//     // searchableFields: AQ_SEARCHABLE_FIELDS,

//     defaultSort: "creation desc",
//     urlSyncKey: `approved_quotations_${productId || "all"}`,
//     additionalFilters: staticFilters,
//   });

//   const facetFilterOptions = useMemo(
//     () => ({
//       vendor: { title: "Vendor", options: vendorOptionsForSelect },
//       unit: { title: "Unit", options: UnitOptions },
//     }),
//     [vendorOptionsForSelect]
//   );

//   const overallIsLoading = aqTableLoading || vendorsLoading || allItemsLoading;
//   const overallError = aqTableError;

//   return (
//     <div className="flex-1 space-y-4 p-4 md:p-6">
//       {productId ? (
//         <div className="flex items-center justify-between">
//           <h1 className="text-2xl font-semibold">
//             Approved Quotations for {item_name}
//           </h1>
//         </div>
//       ) : (
//         <div className="space-y-3">
//           <div className="flex justify-between items-center">
//             <label className="text-sm font-medium text-muted-foreground">
//               Filter by Products
//             </label>
//             {selectedItems.length > 0 && (
//               <Button
//                 variant="ghost"
//                 size="sm"
//                 className="h-7 text-xs"
//                 onClick={() => setSelectedItems([])}
//               >
//                 Clear All
//               </Button>
//             )}
//           </div>

//           {/* --- THIS IS THE NEW UI STRUCTURE --- */}
//           <Popover open={isPopoverOpen} onOpenChange={setPopoverOpen}>
//             <PopoverTrigger asChild>
//               <Button
//                 variant="outline"
//                 role="combobox"
//                 aria-expanded={isPopoverOpen}
//                 className="w-full justify-between font-normal h-auto min-h-10"
//               >
//                 <div className="flex flex-wrap gap-1">
//                   {selectedItems.length > 0 ? (
//                     selectedItems.map((item) => (
//                       <Badge
//                         key={item.value}
//                         variant="secondary"
//                         className="flex items-center gap-1.5 text-sm font-normal py-1"
//                       >
//                         <span className="text-blue-600 font-medium">
//                           {item.label}
//                         </span>
//                         <button
//                           onClick={(e) => {
//                             e.stopPropagation();
//                             handleItemRemove(item.value);
//                           }}
//                           className="rounded-full hover:bg-muted-foreground/20 p-0.5"
//                           aria-label={`Remove ${item.label}`}
//                         >
//                           <XIcon className="h-3.5 w-3.5 text-red-500 hover:text-red-700" />
//                         </button>
//                       </Badge>
//                     ))
//                   ) : (
//                     <span className="text-muted-foreground">
//                       Search for products to filter...
//                     </span>
//                   )}
//                 </div>
//                 <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
//               </Button>
//             </PopoverTrigger>
//             <PopoverContent
//               className="w-[--radix-popover-trigger-width] p-0"
//               align="start"
//             >
//               <Command>
//                 {/* --- THIS IS THE FIX --- */}
//                 <div className="flex items-center border-b px-3">
//                   <CommandInput
//                     ref={inputRef}
//                     placeholder="Search for a product..."
//                     value={itemSearchInput}
//                     onValueChange={setItemSearchInput}
//                     className="h-10 border-0 shadow-none pl-0 focus-visible:ring-0"
//                   />
//                   {itemSearchInput.length > 0 && (
//                     <Button
//                       variant="ghost"
//                       size="icon"
//                       className="h-8 w-8 shrink-0"
//                       onClick={() => {
//                         setItemSearchInput("");
//                         inputRef.current?.focus();
//                       }}
//                       aria-label="Clear search"
//                     >
//                       <XIcon className="h-4 w-4" />
//                     </Button>
//                   )}
//                 </div>
//                 <CommandList>
//                   <CommandEmpty>
//                     {allItemsLoading
//                       ? "Loading products..."
//                       : "No matching products found."}
//                   </CommandEmpty>
//                   <CommandGroup>
//                     {itemSuggestions
//                       .filter(
//                         (suggestion) =>
//                           !selectedItems.some(
//                             (item) => item.value === suggestion.name
//                           )
//                       )
//                       .map((suggestion) => (
//                         <CommandItem
//                           key={suggestion.name}
//                           value={suggestion.item_name}
//                           className="flex justify-between items-center"
//                         >
//                           <span>{suggestion.item_name}</span>
//                           <Button
//                             variant="ghost"
//                             size="icon"
//                             className="h-8 w-8"
//                             onClick={(e) => {
//                               e.stopPropagation();
//                               handleItemSelect(suggestion);
//                             }}
//                             aria-label={`Add ${suggestion.item_name}`}
//                           >
//                             <PlusCircleIcon className="h-5 w-5 text-muted-foreground hover:text-primary" />
//                           </Button>
//                         </CommandItem>
//                       ))}
//                   </CommandGroup>
//                 </CommandList>
//               </Command>
//             </PopoverContent>
//           </Popover>
//         </div>
//       )}

//       <DataTable<ApprovedQuotationsType>
//         table={table}
//         columns={columns}
//         isLoading={overallIsLoading}
//         error={overallError}
//         totalCount={totalCount}
//         searchFieldOptions={AQ_SEARCHABLE_FIELDS}
//         selectedSearchField={selectedSearchField}
//         onSelectedSearchFieldChange={setSelectedSearchField}
//         searchTerm={searchTerm}
//          showSearchBar={false}
//         onSearchTermChange={setSearchTerm}
//         facetFilterOptions={facetFilterOptions}
//         dateFilterColumns={AQ_DATE_COLUMNS}
//         showExportButton={true}
//         onExport={"default"}
//         exportFileName="approved_quotations_data"
//       />
//     </div>
//   );
// }