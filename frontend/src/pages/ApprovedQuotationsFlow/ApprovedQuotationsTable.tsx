/**
 * @file ApprovedQuotationsTable.tsx
 * @description Final, robust version with a fully client-side filtering and pagination model.
 */

import { useMemo, useState, useCallback, useRef,useEffect } from "react";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  ALL_ITEMS_CACHE_KEY
} from "./approvedQuotations.constants";

interface ApprovedQuotationsTableProps {
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

const tokenize = (text: string): string[] => {
  if (!text) return [];
  return text.toLowerCase().split(/[\s-_/()]+/).filter(Boolean);
};


const calculateTotalAmount = (row: ApprovedQuotationsType): number => {
  const quote = parseFloat(row.quote || "0");
  const quantity = parseFloat(row.quantity || "1");
  // const tax = parseFloat(row.tax || "0");
  return quote * quantity;
};

export default function ApprovedQuotationsTable({
  productId,
  item_name,
}: ApprovedQuotationsTableProps) {
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [itemSearchInput, setItemSearchInput] = useState("");
  const [isPopoverOpen, setPopoverOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "creation", desc: true },
  ]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 50,
  });
  const [globalFilter, setGlobalFilter] = useState("");

    // --- THIS IS THE FIX (1/3): Debounced State ---
  // This state holds the search term that will actually be used for the expensive calculation.
  const [debouncedSearchInput, setDebouncedSearchInput] = useState("");

  // --- Data fetching for UI elements and enrichment ---
  const { data: allItems, isLoading: allItemsLoading } =
    useFrappeGetDocList<ItemsType>(
      ITEM_DOCTYPE,
      { fields: ["name", "item_name"], limit: 0 },
      {
        key: ALL_ITEMS_CACHE_KEY, // Use the dedicated, global key
        revalidateOnFocus: false, // Don't refetch when the window is refocused
        revalidateOnReconnect: false, // Don't refetch on network reconnection
      }
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

 useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchInput(itemSearchInput);
    }, 300); // 300ms delay

    // Cleanup function: Resets the timer if the user types again before the delay is over.
    return () => {
      clearTimeout(handler);
    };
  }, [itemSearchInput]);

    const itemSuggestions = useMemo(() => {
    if (!debouncedSearchInput.trim() || !allItems) return [];

    const query = debouncedSearchInput.toLowerCase();
    const searchTerms = tokenize(query);
    const scoredCandidates = allItems.map(item => {
      const itemNameLower = item.item_name.toLowerCase();
      const itemNameWords = tokenize(item.item_name);
      let score = 0;

      if (itemNameLower.includes(query)) score += 1000;
      
      let termsFoundCount = 0;
      searchTerms.forEach(term => {
        if (itemNameLower.includes(term)) {
          termsFoundCount++;
          score += 50;
          if (itemNameWords.some(word => word.startsWith(term))) {
            score += 10;
          }
        }
      });

      if (termsFoundCount === searchTerms.length && searchTerms.length > 1) {
        score += 200;
      }
      
      return { item, score };
    });

    return scoredCandidates
      .filter(candidate => candidate.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(result => result.item);

  }, [debouncedSearchInput, allItems]); // Depends on the debounced value


    // --- THIS IS THE DEFINITIVE "BEST OF BOTH WORLDS" SEARCH LOGIC ---
  // const itemSuggestions = useMemo(() => {
  //   if (!itemSearchInput.trim() || !allItems) return [];

  //   const query = itemSearchInput.toLowerCase();
  //   const searchTerms = tokenize(query);
  //   console.log("allItems", allItems);
  //   const scoredCandidates = allItems.map(item => {
  //     const itemNameLower = item.item_name.toLowerCase();
  //     const normalizedItemName = itemNameLower.replace(/\s+/g, '');
  //     const itemNameWords = tokenize(item.item_name);
  //     let score = 0;

  //     // Rule 1: Exact Phrase Bonus
  //     if (itemNameLower.includes(query)) {
  //       score += 1000;
  //     }

  //     let termsFoundCount = 0;

  //     // Rule 3 & 4: Term Match and Word Start Bonuses
  //     searchTerms.forEach(term => {
  //       if (normalizedItemName.includes(term.replace(/\s+/g, ''))) {
  //         termsFoundCount++;
  //         score += 50;

  //         if (itemNameWords.some(word => word.startsWith(term))) {
  //           score += 10;
  //         }
  //       }
  //     });

  //     // Rule 2: All Terms Present Bonus
  //     if (termsFoundCount === searchTerms.length && searchTerms.length > 1) {
  //       score += 200;
  //     }
      
  //     return { item, score };
  //   });

  //   return scoredCandidates
  //     .filter(candidate => candidate.score > 0)
  //     .sort((a, b) => b.score - a.score)
  //     // .slice(0, 10)
  //     .map(result => result.item);

  // }, [itemSearchInput, allItems]);
  
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

  const handleItemSelect = useCallback(
    (item: ItemsType) => {
    // setItemSearchInput(""); // Clear the immediate input

      if (!selectedItems.some((selected) => selected.value === item.name)) {
        setSelectedItems((prev) => [
          ...prev,
          { value: item.name, label: item.item_name },
        ]);
      }
      inputRef.current?.focus();
    },
    [selectedItems]
  );

  const handleItemRemove = useCallback((itemId: string) => {
    setSelectedItems((prev) => prev.filter((item) => item.value !== itemId));
  }, []);

  const overallIsLoading =
    aqTableLoading || vendorsLoading || allItemsLoading || poListLoading;
  const overallError = aqTableError;

  return (
    <div className="flex-1 space-y-4 p-4 md:p-6">
      {!productId ? (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium text-muted-foreground">
              Filter by Products
            </label>
            {selectedItems.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setSelectedItems([])}
              >
                Clear All
              </Button>
            )}
          </div>
          <Popover open={isPopoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                className="w-full justify-between font-normal h-auto min-h-10"
              >
                <div className="flex flex-wrap gap-1">
                  {selectedItems.length > 0 ? (
                    selectedItems.map((item) => (
                      <Badge
                        key={item.value}
                        variant="secondary"
                        className="flex items-center gap-1.5 text-sm font-normal py-1"
                      >
                        <span className="text-blue-600 font-medium">
                          {item.label}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleItemRemove(item.value);
                          }}
                          className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                          aria-label={`Remove ${item.label}`}
                        >
                          <XIcon className="h-3.5 w-3.5 text-red-500 hover:text-red-700" />
                        </button>
                      </Badge>
                    ))
                  ) : (
                    <span className="text-muted-foreground">
                      Search for products to filter...
                    </span>
                  )}
                </div>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[--radix-popover-trigger-width] p-0"
              align="start"
            >
              <Command>
                <div className="flex items-center border-b px-3">
                  <CommandInput
                    ref={inputRef}
                    placeholder="Search for a product..."
                    value={itemSearchInput}
                    onValueChange={setItemSearchInput}
                    className="h-10 border-0 shadow-none pl-0 focus-visible:ring-0"
                  />
                  {itemSearchInput.length > 0 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => {
                        setItemSearchInput("");
                        inputRef.current?.focus();
                      }}
                      aria-label="Clear search"
                    >
                      <XIcon className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <CommandList>
                  <CommandEmpty>
                    {allItemsLoading
                      ? "Loading products..."
                      : "No matching products found."}
                  </CommandEmpty>
                  <CommandGroup>
                    {itemSuggestions
                      .filter(
                        (suggestion) =>
                          !selectedItems.some(
                            (item) => item.value === suggestion.name
                          )
                      )
                      .map((suggestion) => (
                        <CommandItem
                          key={suggestion.name}
                          value={suggestion.item_name}
                          className="flex justify-between items-center"
                        >
                          <span>{suggestion.item_name}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleItemSelect(suggestion);
                            }}
                            aria-label={`Add ${suggestion.item_name}`}
                          >
                            <PlusCircleIcon className="h-5 w-5 text-muted-foreground hover:text-primary" />
                          </Button>
                        </CommandItem>
                      ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">
            Approved Quotations for {item_name}{" "}
          </h1>{" "}
        </div>
      )}

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
        showSearchBar={productId ? true : false}
        facetFilterOptions={facetFilterOptions}
        dateFilterColumns={AQ_DATE_COLUMNS}
        showExportButton={true}
        onExport={"default"}
        exportFileName="approved_quotations_data"
      />
    </div>
  );
}




// /**
//  * @file ApprovedQuotationsTable.tsx
//  * @description Final, robust version with a fully client-side filtering and pagination model.
//  */

// import { useMemo, useState, useCallback, useRef } from "react";
// import Fuse from "fuse.js";
// import {
//   ColumnDef,
//   useReactTable,
//   getCoreRowModel,
//   getPaginationRowModel,
//   getSortedRowModel,
//   getFilteredRowModel,
//   ColumnFiltersState,
//   PaginationState,
//   SortingState,
// } from "@tanstack/react-table";
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
// interface AQWithProject extends ApprovedQuotationsType {
//   project_name: string;
// }

// const calculateTotalAmount = (row: ApprovedQuotationsType): number => {
//   const quote = parseFloat(row.quote || "0");
//   const quantity = parseFloat(row.quantity || "1");
//   // const tax = parseFloat(row.tax || "0");
//   return quote * quantity;
// };

// export default function ApprovedQuotationsTable({
//   productId,
//   item_name,
// }: ApprovedQuotationsTableProps) {
//   const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
//   const [itemSearchInput, setItemSearchInput] = useState("");
//   const [isPopoverOpen, setPopoverOpen] = useState(false);
//   const inputRef = useRef<HTMLInputElement>(null);

//   const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
//   const [sorting, setSorting] = useState<SortingState>([
//     { id: "creation", desc: true },
//   ]);
//   const [pagination, setPagination] = useState<PaginationState>({
//     pageIndex: 0,
//     pageSize: 50,
//   });
//   const [globalFilter, setGlobalFilter] = useState("");

//   // --- Data fetching for UI elements and enrichment ---
//   const { data: allItems, isLoading: allItemsLoading } =
//     useFrappeGetDocList<ItemsType>(
//       ITEM_DOCTYPE,
//       { fields: ["name", "item_name"], limit: 0 },
//       "all_items_for_fuzzy_search"
//     );
//   const {
//     data: vendorsList,
//     vendorOptionsForSelect,
//     isLoading: vendorsLoading,
//   } = useVendorsList({
//     vendorTypes: ["Service", "Material & Service", "Material"],
//   });
//   const { data: poList, isLoading: poListLoading } =
//     useFrappeGetDocList<ProcurementOrderType>(
//       "Procurement Orders",
//       { fields: ["name", "project_name"], limit: 0 },
//       "po_list_for_project_name_lookup"
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
//       // .slice(0, 10)
//       .map((result) => result.item);
//   }, [itemSearchInput, fuse]);

//   const vendorMap = useMemo(() => {
//     const map = new Map<string, string>();
//     vendorsList?.forEach((vendor) => map.set(vendor.name, vendor.vendor_name));
//     return map;
//   }, [vendorsList]);
//   const poProjectMap = useMemo(() => {
//     const map: { [key: string]: string } = {};
//     poList?.forEach((po) => {
//       if (po.name && po.project_name) map[po.name] = po.project_name;
//     });
//     return map;
//   }, [poList]);

//   // --- FIX: This is now the ONLY server-side filter logic ---
//   const serverSideFilters = useMemo(() => {
//     // If we are on a specific product page, apply a server filter.
//     if (productId) {
//       return getSingleItemStaticFilters(productId);
//     }
//     // Otherwise, on the main page, apply NO filters. Fetch everything.
//     return [];
//   }, [productId]);

//   // --- This hook now fetches data based on the simplified server filters ---
//   const {
//     data: serverData,
//     isLoading: aqTableLoading,
//     error: aqTableError,
//   } = useFrappeGetDocList<ApprovedQuotationsType>(
//     APPROVED_QUOTATION_DOCTYPE,
//     {
//       fields: AQ_LIST_FIELDS_TO_FETCH,
//       filters: serverSideFilters,
//       limit: 0, // Fetch all that match the (minimal) server filter
//     },
//     `aq_data_client_table_${productId}` // SWR key is now simpler
//   );

//   // The multi-select item filter is now applied on the CLIENT side
//   const filteredData = useMemo(() => {
//     if (!serverData) return [];
//     // If we are on the main page AND items are selected, filter the server data.
//     if (!productId && selectedItems.length > 0) {
//       const selectedItemValues = new Set(
//         selectedItems.map((item) => item.value)
//       );
//       return serverData.filter((aq) => selectedItemValues.has(aq.item_id));
//     }
//     // Otherwise, return the full dataset fetched from the server.
//     return serverData;
//   }, [serverData, selectedItems, productId]);

//   const columns = useMemo<ColumnDef<ApprovedQuotationsType>[]>(
//     () => [
//       {
//         accessorKey: "item_name",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Item" />
//         ),
//         filterFn: facetedFilterFn,
//         cell: ({ row }) => (
//           <Link
//             className="text-blue-600 hover:underline font-medium"
//             to={`/products/${row.original.item_id}`}
//           >
//             {row.getValue("item_name")}
//           </Link>
//         ),
//       },
//       {
//         id: "project_name",
//         accessorFn: (row) => poProjectMap[row.procurement_order] || "N/A",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Project" />
//         ),
//         cell: ({ row }) => (
//           <div className="font-medium truncate">
//             {row.getValue("project_name")}
//           </div>
//         ),
//         filterFn: facetedFilterFn,
//       },
//       {
//         accessorKey: "vendor",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Vendor" />
//         ),
//         cell: ({ row }) => {
//           const vendorId = row.getValue<string>("vendor");
//           const vendorName = vendorMap.get(vendorId) || vendorId;
//           return (
//             <Link
//               className="text-blue-600 hover:underline font-medium"
//               to={`/vendors/${vendorId}`}
//             >
//               {vendorName}
//             </Link>
//           );
//         },
//         filterFn: facetedFilterFn,
//       },
//        {
//         accessorKey: "unit",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Unit" />
//         ),
//         cell: ({ row }) => (
//           <div className="font-medium text-left">{row.getValue("unit")}</div>
//         ),
//         filterFn: facetedFilterFn,
//       },
//        {
//         accessorKey: "quantity",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Qty" />
//         ),
//         cell: ({ row }) => (
//           <div className="font-medium text-left">
//             {row.getValue("quantity") || "1"}
//           </div>
//         ),
//         enableColumnFilter: false,
//       },
//       {
//         accessorKey: "quote",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Rate" />
//         ),
//         cell: ({ row }) => (
//           <div className="font-medium text-left pr-2">
//             {formatToRoundedIndianRupee(row.getValue("quote"))}
//           </div>
//         ),
//         enableColumnFilter: false,
//       },
     
     
//       {
//         id: "amount",
//         accessorFn: (row) => calculateTotalAmount(row),
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Amount (excl. GST)" />
//         ),
//         cell: ({ row }) => (
//           <div className="font-medium text-center pr-2">
//             {formatToRoundedIndianRupee(row.getValue("amount"))}
//           </div>
//         ),
//         enableColumnFilter: false,
//       },
//       {
//         accessorKey: "make",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Make" />
//         ),
//         cell: ({ row }) => (
//           <div className="font-medium">{row.getValue("make") || "--"}</div>
//         ),
//         enableColumnFilter: false,
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
//         enableColumnFilter: false,
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
//         filterFn: dateFilterFn,
//       },
//     ],
//     [vendorMap, poProjectMap]
//   );

//   // A single, fully client-controlled table instance using the client-filtered data
//   const table = useReactTable({
//     data: filteredData,
//     columns,
//     state: {
//       columnFilters,
//       pagination,
//       sorting,
//       globalFilter,
//     },
//     onColumnFiltersChange: setColumnFilters,
//     onPaginationChange: setPagination,
//     onSortingChange: setSorting,
//     onGlobalFilterChange: setGlobalFilter,
//     getCoreRowModel: getCoreRowModel(),
//     getPaginationRowModel: getPaginationRowModel(),
//     getSortedRowModel: getSortedRowModel(),
//     getFilteredRowModel: getFilteredRowModel(),
//   });

//   const itemFacetOptions = useMemo(() => {
//     if (!allItems) return [];
//     return allItems.map((item) => ({
//       label: item.item_name,
//       value: item.item_name,
//     }));
//   }, [allItems]);

//   const projectFacetOptions = useMemo(() => {
//     if (!poList) return [];
//     const projectNames = new Set(
//       poList.map((po) => po.project_name).filter(Boolean)
//     );
//     return Array.from(projectNames).map((name) => ({
//       label: name!,
//       value: name!,
//     }));
//   }, [poList]);

//   const facetFilterOptions = useMemo(
//     () => ({
//       // item_name: { title: "Item", options: itemFacetOptions },
//       project_name: { title: "Project", options: projectFacetOptions },
//       vendor: { title: "Vendor", options: vendorOptionsForSelect },
//       unit: { title: "Unit", options: UnitOptions },
//     }),
//     [itemFacetOptions, projectFacetOptions, vendorOptionsForSelect]
//   );

//   const handleItemSelect = useCallback(
//     (item: ItemsType) => {
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

//   const overallIsLoading =
//     aqTableLoading || vendorsLoading || allItemsLoading || poListLoading;
//   const overallError = aqTableError;

//   return (
//     <div className="flex-1 space-y-4 p-4 md:p-6">
//       {!productId ? (
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
//           <Popover open={isPopoverOpen} onOpenChange={setPopoverOpen}>
//             <PopoverTrigger asChild>
//               <Button
//                 variant="outline"
//                 role="combobox"
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
//       ) : (
//         <div className="flex items-center justify-between">
//           <h1 className="text-2xl font-semibold">
//             Approved Quotations for {item_name}{" "}
//           </h1>{" "}
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
//         onSelectedSearchFieldChange={() => {}} // No longer needed
//         searchTerm={globalFilter}
//         onSearchTermChange={setGlobalFilter}
//         showSearchBar={productId ? true : false}
//         facetFilterOptions={facetFilterOptions}
//         dateFilterColumns={AQ_DATE_COLUMNS}
//         showExportButton={true}
//         onExport={"default"}
//         exportFileName="approved_quotations_data"
//       />
//     </div>
//   );
// }

