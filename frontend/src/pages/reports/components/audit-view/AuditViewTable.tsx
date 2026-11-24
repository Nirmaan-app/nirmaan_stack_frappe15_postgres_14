/** Audit View: the rows table (client mode of the shared data table). */
import { useEffect, useMemo, useRef } from "react";

import { DataTable, SearchFieldOption } from "@/components/data-table/new-data-table";
import { useServerDataTable } from "@/hooks/useServerDataTable";

import { getAuditViewColumns } from "../columns/auditViewColumns";
import { AUDIT_TAB_META, AuditTab, AuditTableRow, AuditView, auditFacetOptions } from "../../utils/auditView";

const SEARCH_FIELDS: SearchFieldOption[] = [
  { value: "id", label: "ID", placeholder: "Search by ID, invoice no., project, vendor...", default: true },
];

// ---------------------------------------------------------------------------------------------
// The table (client-side, the SRReports / outflow wiring). Keyed by view + tab by its parent, so a
// switch starts on a fresh table with that tab's own URL-synced filters.
// ---------------------------------------------------------------------------------------------

interface AuditViewTableProps {
  view: AuditView;
  tab: AuditTab;
  rows: AuditTableRow[];
}

/** Typical row height (names clamp to 2 lines): the row virtualizer's estimate, so the scrollbar tracks the rows. */
const AUDIT_ROW_HEIGHT = 57;

export function AuditViewTable({ view, tab, rows }: AuditViewTableProps) {
  const columns = useMemo(() => getAuditViewColumns(view, tab), [view, tab]);

  const {
    table,
    isLoading,
    error,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
    exportAllRows,
    isExporting,
  } = useServerDataTable<AuditTableRow>({
    doctype: `AuditViewClientVirtual_${view}_${tab}`,
    columns,
    fetchFields: [],
    searchableFields: SEARCH_FIELDS,
    clientData: rows,
    clientTotalCount: rows.length,
    urlSyncKey: `audit_view_${view}_${tab}`,
    initialState: { sorting: [{ id: "date", desc: false }] },
    enableRowSelection: false,
  });

  // TanStack resets the page index by queueing a React state update from INSIDE its row-model calculation.
  // This table renders in the deferred (background) tab render, so that update could land before the
  // table mounted ("Can't perform a React state update on a component that hasn't mounted yet"). The
  // auto-reset is off (set before any row model is read below, and kept: useReactTable merges its options
  // over these) and the page is reset after mount instead: on a search or sort change here; the hook
  // already resets it on a column-filter change; a tab or date change remounts the table.
  table.setOptions((prev) => (prev.autoResetPageIndex === false ? prev : { ...prev, autoResetPageIndex: false }));
  const { sorting } = table.getState();
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false; // keep the page restored from the URL on mount
      return;
    }
    table.setPageIndex(0);
  }, [searchTerm, sorting, table]);

  // The page count follows the FILTERED rows: useServerDataTable sets it from the unfiltered count on
  // every render, so it is set again here, in render, before the pager reads it (as outflowReportTable does).
  const filteredRowCount = table.getFilteredRowModel().rows.length;
  const { pageSize } = table.getState().pagination;
  const pageCount = pageSize > 0 ? Math.ceil(filteredRowCount / pageSize) : 1;
  if (table.getPageCount() !== pageCount) {
    table.setOptions((prev) => ({ ...prev, pageCount }));
  }

  const facetFilterOptions = useMemo(() => {
    const anyRow = (r: AuditTableRow) => r as AuditTableRow & Partial<Record<string, string | null>>;
    // The Type column's filter: PO / WO / Project Expense, or in Non Project View (every row a Non-Project
    // Expense, and no Expense type column) the expense type.
    const facets: Record<string, { title: string; options: { label: string; value: string }[] }> = {
      against: view === "project"
        ? { title: "Type", options: auditFacetOptions(rows, (r) => r.against) }
        : { title: "Expense type", options: auditFacetOptions(rows, (r) => anyRow(r).expense_type) },
    };
    if (view === "project") {
      facets.project = {
        title: "Project",
        options: auditFacetOptions(rows, (r) => anyRow(r).project_name || anyRow(r).project),
      };
      facets.vendor = {
        title: "Vendor",
        options: auditFacetOptions(rows, (r) => anyRow(r).vendor_name || anyRow(r).vendor),
      };
    }
    return facets;
  }, [rows, view]);

  const viewLabel = view === "project" ? "All_Project" : "Non_Project";

  return (
    <DataTable<AuditTableRow>
      table={table}
      columns={columns}
      isLoading={isLoading}
      isExporting={isExporting}
      error={error}
      totalCount={filteredRowCount}
      searchFieldOptions={SEARCH_FIELDS}
      selectedSearchField={selectedSearchField}
      onSelectedSearchFieldChange={setSelectedSearchField}
      searchTerm={searchTerm}
      onSearchTermChange={setSearchTerm}
      facetFilterOptions={facetFilterOptions}
      showExportButton={true}
      onExport={"default"}
      onExportAll={exportAllRows}
      exportFileName={`Audit_View_${viewLabel}_${AUDIT_TAB_META[tab].title}`}
      showRowSelection={false}
      // Fills the capped box above (shrinks to it), so its own body scrolls: h-auto overrides its h-full.
      className="h-auto min-h-0 flex-1"
      estimatedRowHeight={AUDIT_ROW_HEIGHT}
    />
  );
}
