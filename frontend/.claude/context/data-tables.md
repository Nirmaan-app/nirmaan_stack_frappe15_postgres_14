# DataTable System Reference

The DataTable system is the primary way list pages display data. It has a server-side hook, a reusable component, and a backend API.

---

## Architecture Overview

```
Backend API                    Frontend Hook                  Frontend Component
─────────────                  ──────────────                 ──────────────────
data-table.py                  useServerDataTable.ts          new-data-table.tsx (DataTable)
  └─ search.py                   ├─ pagination, sort, filter    ├─ Toolbar (search, export)
     └─ constants.py             ├─ debounced search            ├─ Virtualized table body
     └─ aggregations.py          ├─ URL state sync              ├─ Faceted/date filters
     └─ utils.py                 ├─ aggregates & group-by       ├─ DataTablePagination
     └─ facets.py                ├─ exportAllRows()             └─ DataTableViewOptions
                                 └─ real-time refresh
```

## Key Files

| File | Purpose |
|------|---------|
| `src/hooks/useServerDataTable.ts` | Central hook — pagination, sorting, filtering, search, export, aggregates |
| `src/components/data-table/new-data-table.tsx` | `DataTable` component — toolbar, virtual rows, export button |
| `src/components/data-table/data-table-pagination.tsx` | Pagination controls |
| `src/components/data-table/data-table-view-options.tsx` | Column visibility toggles |
| `src/components/data-table/data-table-faceted-filter.tsx` | Multi-select faceted filters |
| `src/components/data-table/data-table-date-filter.tsx` | Date range filters |
| `src/components/data-table/data-table-models.ts` | `fuzzyFilter` and shared utilities |
| `nirmaan_stack/api/data-table.py` | Whitelisted API entry point |
| `nirmaan_stack/api/data_table/search.py` | Core query logic (search strategies, pagination, sorting) |
| `nirmaan_stack/api/data_table/constants.py` | `DEFAULT_PAGE_LENGTH=50`, `MAX_PAGE_LENGTH=10000`, `EXPORT_MAX_PAGE_LENGTH=100000` |
| `nirmaan_stack/api/data_table/aggregations.py` | `get_aggregates()`, `get_group_by_results()` |
| `nirmaan_stack/api/data_table/facets.py` | Dynamic facet value calculation |
| `nirmaan_stack/api/data_table/utils.py` | Filter/field parsing helpers |

---

## useServerDataTable Hook

### Config Interface (`ServerDataTableConfig<TData>`)

```typescript
{
  doctype: string;               // Frappe DocType name
  columns: ColumnDef<TData>[];   // TanStack column definitions
  fetchFields: string[];         // Fields to request from API
  searchableFields: SearchFieldOption[];  // Search dropdown options
  defaultSort?: string;          // e.g., "creation desc"
  additionalFilters?: any[];     // Static Frappe filters always applied
  urlSyncKey?: string;           // Enables URL state sync (pagination, sort, search, filters)
  aggregatesConfig?: AggregationConfig[];  // Summary card aggregations
  groupByConfig?: GroupByConfig;           // Group-by for charts/badges
  enableRowSelection?: boolean;
  requirePendingItems?: boolean;  // Backend: filter to docs with pending child items
  clientData?: TData[];           // Bypass server fetch, operate client-side
  clientTotalCount?: number;
  shouldCache?: boolean;
  meta?: TableMeta<TData>;
  apiEndpoint?: string;           // Override default API
  customParams?: Record<string, any>;
}
```

### Result Interface (`ServerDataTableResult<TData>`)

```typescript
{
  table: Table<TData>;          // TanStack table instance
  data: TData[];                // Current page data
  totalCount: number;
  isLoading: boolean;
  error: Error | null;

  // State + setters
  pagination, setPagination,
  sorting, setSorting,
  columnFilters, setColumnFilters,
  searchTerm, setSearchTerm,
  selectedSearchField, setSelectedSearchField,

  // Actions
  refetch: () => void;
  exportAllRows: () => Promise<TData[]>;  // Fetches ALL matching rows (bypasses pagination)
  isExporting: boolean;                    // Export loading state (independent from isLoading)

  // Aggregates
  aggregates: Record<string, number> | null;
  isAggregatesLoading: boolean;
  groupByResult: GroupByResultItem[] | null;

  isRowSelectionActive: boolean;
  isClientSideMode: boolean;
}
```

### Modes

- **Server-side mode** (default): Fetches paginated data from backend API. Sorting, filtering, search all server-side.
- **Client-side mode** (`clientData` provided): All data in memory. TanStack handles pagination/sort/filter client-side. No server fetches.

---

## DataTable Component Props

```typescript
interface DataTableProps<T> {
  table: TanTable<T>;
  columns: ColumnDef<T, any>[];
  isLoading: boolean;
  error?: Error | null;
  totalCount: number;

  // Search
  searchFieldOptions: SearchFieldOption[];
  selectedSearchField: string;
  onSelectedSearchFieldChange: (v: string) => void;
  searchTerm: string;
  onSearchTermChange: (v: string) => void;

  // Filters
  facetFilterOptions?: Record<string, { title: string; options: { label: string, value: string }[]; isLoading?: boolean }>;
  dateFilterColumns?: string[];

  // Export
  showExportButton?: boolean;
  onExport?: (() => void) | "default";   // "default" uses built-in CSV handler
  onExportAll?: () => Promise<T[]>;       // Async fetch-all for server-side tables
  isExporting?: boolean;                   // Shows spinner on export button
  exportFileName?: string;

  // Misc
  toolbarActions?: React.ReactNode;
  summaryCard?: React.ReactNode;
  showRowSelection?: boolean;
  showSearchBar?: boolean;
  enableVirtualization?: boolean;         // Default true; disable for <50 rows
  estimatedRowHeight?: number;
  getRowClassName?: (row: TanRow<T>) => string | undefined;
}
```

---

## Export System

### How Export Works

1. **`onExport="default"` + `onExportAll`**: The built-in `handleDefaultExport` calls `onExportAll()` to fetch all rows, then runs `exportToCsv()`. Shows confirmation dialog if >5000 rows.
2. **Custom `onExport={handler}`**: Page provides its own export logic. Should use `await exportAllRows()` for data sourcing instead of `table.getRowModel().rows` (which only has current page).
3. **`isExporting`**: Separate from `isLoading` — table stays interactive during export.

### Backend Export Support

The `for_export=true` parameter on the API:
- Uses `EXPORT_MAX_PAGE_LENGTH` (100K) instead of `MAX_PAGE_LENGTH` (10K)
- `limit_page_length=0` means "all rows" (capped at 100K)
- Skips aggregate/group-by computation (not needed for CSV export)

### Wiring Pattern (for new pages)

```typescript
// In page component:
const {
  table, totalCount, isLoading,
  exportAllRows, isExporting,       // <-- destructure these
  searchTerm, setSearchTerm,
  selectedSearchField, setSelectedSearchField,
  // ... other fields
} = useServerDataTable<MyType>({ ... });

// For default export:
<DataTable
  onExport="default"
  onExportAll={exportAllRows}       // <-- wire this
  isExporting={isExporting}          // <-- wire this
  showExportButton={true}
  exportFileName="my_export"
  // ... other props
/>

// For custom export:
const handleExport = async () => {
  const allData = await exportAllRows();  // <-- use this instead of table.getRowModel()
  // custom column mapping, formatting, etc.
  exportToCsv("filename", allData, columns);
};
<DataTable onExport={handleExport} isExporting={isExporting} ... />
```

---

## Backend Search Strategies

The `search.py` module selects a strategy based on the request:

| Strategy | When | How |
|----------|------|-----|
| **Child table item search** | `is_item_search=true` + doctype in `CHILD_TABLE_ITEM_SEARCH_MAP` | Searches child table fields (e.g., PR items by item_name) |
| **Child table pending filter** | `require_pending_items=true` + doctype in map | Filters parents with child rows having `status='Pending'` |
| **JSON item search** | `is_item_search=true` + doctype in `JSON_ITEM_SEARCH_DOCTYPE_MAP` | Searches inside JSON array fields (e.g., SR service_order_list) |
| **JSON pending filter** | `require_pending_items=true` + JSON doctype | Filters for JSON items with `status='Pending'` |
| **Standard search** | Default | `LIKE` search on specified field |

All strategies: get matching parent names → paginate within those → fetch full data.

---

## Aggregation Types

### Simple Aggregation
```typescript
{ field: "total_amount", function: "sum" }  // SQL aggregate on a single field
```

### Custom Aggregation (row-level expression)
```typescript
{
  alias: "payable_amount",
  aggregate: "SUM",
  expression: {
    function: "MIN",
    args: ["amount_paid", "po_amount_delivered"]  // MIN of two fields per row, then SUM
  }
}
```

Expressions support: `MIN`, `MAX`, `ADD`, `SUBTRACT`, `MULTIPLY`, `DIVIDE` — can be nested.

---

## URL State Sync

When `urlSyncKey` is provided, these URL params are synced:
- `{key}_pageIdx`, `{key}_pageSize` — pagination
- `{key}_sort` — sorting (JSON)
- `{key}_q` — search term
- `{key}_searchBy` — selected search field
- `{key}_filters` — column filters (base64-encoded JSON)

---

## Usage Across Codebase (~60+ pages)

### Pages with `onExport="default"` + `onExportAll` (~35 pages)
Standard wiring pattern. Examples: PoInvoices, SrInvoices, ProjectExpensesList, TDSRepositoryMaster, all Asset lists, ServiceRequest lists, ProcurementRequests, PO lists, payment pages, user/customer lists, etc.

### Pages with Custom Export Handlers (~15 pages)
Custom column mapping/formatting. Use `await exportAllRows()` for data. Examples: POReports, SRReports, DCMIRReports, VendorReports, ProjectProgressReports, POAttachmentReconcileReport, SR2BReconcileReport, PO2BReconcileReport, vendor tables, project summary tables.

### Pages NOT Using useServerDataTable (~8 pages)
Use `useReactTable` directly or custom hooks. These don't have `exportAllRows`. Examples: TDSApprovalList, CreditsPage, CriticalPOTasksList, InventoryReport, ProjectReports (CashSheet), AdminApprovedQuotationsTable, project-payments-list.

### Old Testing Pages (2 files — pre-broken)
`ProcurementOrdersTesting.tsx`, `ItemsTableTesting.tsx` — use old hook API (`globalFilter`, `defaultSearchField`) that no longer exists.
