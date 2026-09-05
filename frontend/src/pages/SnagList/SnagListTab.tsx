/**
 * Snag List — the project tab (tracking half).
 *
 * Design of record: `frontend/.claude/plans/snag-list-plan.md` § 5 (the tab),
 * § 6 (permissions) and § "Revision 2". The import half lives in
 * `./import/SnagImportDialog`.
 *
 * Load-bearing rules this file must keep:
 *  - Permissions come from ONE place (`config/snagPermissions.ts`). No role
 *    strings are inlined here (ADR-0010 F1).
 *  - `remark` (SINGULAR) is the ONE free-text field, and it is written as part of
 *    a status change — never on its own. There is no standalone remark editor.
 *    ADR-0018 reversed the old two-field split; `comments` no longer exists.
 *  - There is deliberately NO single-row delete. A wrong row is set to
 *    "Not Applicable".
 *  - Facets use the self-fetching `meta.facet` + `facetDoctype` path; do not
 *    hand-roll `useFacetValues` + `facetFilterOptions`.
 *  - The Batch FILTER is GONE (Revision 3, owner Q6) along with its hidden host
 *    column and its id in `SNAG_FILTERABLE_COLUMN_IDS`. Batch provenance now lives
 *    in the Edit dialog, read-only. Do not reinstate half of that removal.
 *  - Two row-level gates, NOT one: `canEditStatus` (includes the Project Manager)
 *    and `canEditRow` (excludes them). See `config/snagPermissions.ts`.
 */

import * as React from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Download, FileUp, Info, Loader2, Plus, Tags } from "lucide-react";

import { DataTable } from "@/components/data-table/new-data-table";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Button } from "@/components/ui/button";
import { useUserData } from "@/hooks/useUserData";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { cn } from "@/lib/utils";

import { SnagImportDialog } from "@/pages/SnagList/import/SnagImportDialog";

import { useSnagDownload } from "./download";

import { AddSnagDialog } from "./components/AddSnagDialog";
import { BulkStatusDialog } from "./components/BulkStatusDialog";
import { SnagBatchesPanel } from "./components/SnagBatchesPanel";
import { SnagEmptyState } from "./components/SnagEmptyState";
import { SnagEditDialog } from "./components/SnagEditDialog";
import { SnagStatsStrip } from "./components/SnagStatsStrip";
import {
  SNAG_INITIAL_COLUMN_VISIBILITY,
  getSnagColumns,
} from "./config/snagColumns";
import { resolveSnagPermissions } from "./config/snagPermissions";
import {
  SNAG_DEFAULT_SORT,
  SNAG_DOCTYPE,
  SNAG_FIELDS_TO_FETCH,
  SNAG_SEARCHABLE_FIELDS,
  SnagListRow,
  sanitizePersistedSnagTableState,
} from "./config/snagTable.config";
import { useSnagBatches } from "./hooks/useSnagBatches";
import { useSnagFieldValues } from "./hooks/useSnagFieldValues";
import { useSnagMutations } from "./hooks/useSnagMutations";
import { useSnagStats } from "./hooks/useSnagStats";
import { IngestBatchesResponse, SnagStatus } from "./types";

export interface SnagListTabProps {
  projectId: string;
  /**
   * Display name of the project. Used for the downloaded PDF's FILENAME only —
   * the PDF itself reads the name off the Projects doc it prints. Both mount
   * points already hold the project doc, so this is a prop rather than a third
   * fetch of the same document; it falls back to `projectId` when absent.
   */
  projectName?: string;
}

export function SnagListTab({ projectId, projectName }: SnagListTabProps): JSX.Element {
  const { role, user_id } = useUserData();
  const perms = React.useMemo(
    () => resolveSnagPermissions({ role, userId: user_id }),
    [role, user_id]
  );

  const urlSyncKey = `snags_${projectId}`;

  // A bookmark outlives a schema change. Drop URL-persisted table state naming
  // something this screen no longer has — `_searchBy=comments` (the field was
  // DELETED, so the query would hard-error) or a `_filters` entry for a column id
  // this table does not define (it would still be converted into a server filter,
  // narrowing the table invisibly and with no funnel anywhere to clear it).
  //
  // Runs in a `useState` initialiser, NOT an effect: `useServerDataTable` reads
  // these params in its OWN initialiser a few lines below, so an effect would land
  // one fetch too late. Idempotent, so StrictMode's double-invoke is harmless.
  React.useState(() => {
    sanitizePersistedSnagTableState(urlSyncKey);
    return null;
  });

  const [importOpen, setImportOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  // The row whose Area / Category / Description is being edited. `null` = closed.
  const [editRow, setEditRow] = React.useState<SnagListRow | null>(null);

  const {
    stats,
    isLoading: statsLoading,
    error: statsError,
    mutate: mutateStats,
  } = useSnagStats(projectId);
  const {
    batches,
    isLoading: batchesLoading,
    mutate: mutateBatches,
  } = useSnagBatches(projectId);

  // `refetch` is produced by the table hook further down, so writes reach it
  // through a ref rather than a forward reference.
  const refetchTableRef = React.useRef<(() => void) | null>(null);
  const handleChanged = React.useCallback(() => {
    refetchTableRef.current?.();
    mutateStats();
    mutateBatches();
  }, [mutateStats, mutateBatches]);

  // Area / Category SUGGESTIONS for the two free-text dialogs (ADR-0016 amendment).
  // Fetched when one of them OPENS, never on an ordinary table render.
  const { areas: areaSuggestions, categories: categorySuggestions } =
    useSnagFieldValues(projectId, addOpen || !!editRow);

  const mutations = useSnagMutations(projectId, handleChanged);
  const {
    savingStatusFor,
    updateStatus,
    bulkUpdateStatus,
    addManualSnag,
    updateSnagDetails,
    isBulkSaving,
    isAdding,
    isSavingDetails,
  } = mutations;

  // --- Row-level write handler (withheld entirely when not permitted) ---
  // The remark rides the status change (ADR-0018). `undefined` means "leave the
  // stored text alone" and must NOT be turned into `""` on the way past — that
  // would clear the imported remark on every ordinary status change.
  const handleStatusChange = React.useCallback(
    (snag: SnagListRow, next: SnagStatus, remark: string | undefined) =>
      updateStatus(snag.name, next, remark),
    [updateStatus]
  );

  const handleEditRow = React.useCallback(
    (snag: SnagListRow) => setEditRow(snag),
    []
  );

  const columns = React.useMemo<ColumnDef<SnagListRow>[]>(
    () =>
      getSnagColumns({
        // Presence of the callback IS the edit gate — there is no second signal.
        // TWO DIFFERENT gates: a Project Manager records work done (`canEditStatus`)
        // but does not rewrite what the consultant reported (`canEditRow`).
        onStatusChange: perms.canEditStatus ? handleStatusChange : undefined,
        onEditRow: perms.canEditRow ? handleEditRow : undefined,
        savingStatusFor,
      }),
    [
      perms.canEditStatus,
      perms.canEditRow,
      handleStatusChange,
      handleEditRow,
      savingStatusFor,
    ]
  );

  // The batch's HUMAN name for the Edit dialog's read-only provenance line, resolved
  // against the batch list this page ALREADY loads. Deliberately not a per-row
  // link-fetch on the table query — that JOIN was removed in Revision 2 and buying
  // it back for one dialog would be a regression.
  const batchNameByName = React.useMemo(
    () => new Map(batches.map((b) => [b.name, b.batch_name])),
    [batches]
  );

  const projectFilters = React.useMemo(
    () => [["project", "=", projectId]],
    [projectId]
  );

  // Render-scope context per column id. One entry per column that DECLARES a facet
  // — no more. The `batch` entry went with the Batch funnel in Revision 3: with no
  // column and no filter left to read it, it would have been a live-looking line
  // wiring up nothing.
  const facetOverrides = React.useMemo(
    () => ({
      area: { additionalFilters: projectFilters },
      category: { additionalFilters: projectFilters },
      status: { additionalFilters: projectFilters },
    }),
    [projectFilters]
  );

  const {
    table,
    totalCount,
    isLoading,
    error,
    refetch,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
    columnFilters,
    pagination,
    exportAllRows,
    isExporting,
  } = useServerDataTable<SnagListRow>({
    doctype: SNAG_DOCTYPE,
    columns,
    fetchFields: SNAG_FIELDS_TO_FETCH,
    searchableFields: SNAG_SEARCHABLE_FIELDS,
    defaultSort: SNAG_DEFAULT_SORT,
    additionalFilters: projectFilters,
    urlSyncKey,
    enableRowSelection: perms.canBulkEdit,
    initialState: { columnVisibility: SNAG_INITIAL_COLUMN_VISIBILITY },
  });

  refetchTableRef.current = refetch;

  // --- Download (PDF) ---
  // Prints the "Project Snag" format off the PROJECT doc, narrowed by whatever is
  // on screen right now: the facets, the Batch funnel and the search box all ride
  // along as query params. There is no picker dialog on purpose — the toolbar IS
  // the picker, so the PDF cannot disagree with the table above it.
  const { isDownloading, download } = useSnagDownload({
    projectId,
    projectLabel: projectName,
    columnFilters,
    searchTerm,
    selectedSearchField,
  });

  // --- Bulk selection ---
  // Row ids are ARRAY INDICES (the shared hook does not set `getRowId`), so a
  // selection cannot survive a page / filter / search change without silently
  // re-pointing at different rows. Clear it whenever the visible set moves.
  const tableRef = React.useRef(table);
  tableRef.current = table;
  const viewKey = `${pagination.pageIndex}|${pagination.pageSize}|${searchTerm}|${selectedSearchField}|${JSON.stringify(columnFilters)}`;
  React.useEffect(() => {
    tableRef.current.resetRowSelection();
  }, [viewKey]);

  const selectedSnagNames = perms.canBulkEdit
    ? table.getSelectedRowModel().rows.map((r) => r.original.name)
    : [];

  const handleBulkConfirm = React.useCallback(
    async (status: SnagStatus) => {
      const names = tableRef.current
        .getSelectedRowModel()
        .rows.map((r) => r.original.name);
      const ok = await bulkUpdateStatus(names, status);
      if (ok) tableRef.current.resetRowSelection();
      return ok;
    },
    [bulkUpdateStatus]
  );

  const handleImported = React.useCallback(
    (_result?: IngestBatchesResponse) => {
      handleChanged();
    },
    [handleChanged]
  );

  // --- Empty state gate ---
  // Only a genuinely empty project qualifies. A table emptied by a search or a
  // facet must NOT read as "no snags yet" — that would hide the filter that did it.
  const hasActiveNarrowing = !!searchTerm || columnFilters.length > 0;
  const showEmptyState =
    !isLoading &&
    !batchesLoading &&
    totalCount === 0 &&
    batches.length === 0 &&
    !hasActiveNarrowing;

  if (error) return <AlertDestructive error={error} />;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 overflow-hidden",
        totalCount > 10 ? "h-[calc(100vh-180px)]" : "h-auto"
      )}
    >
      {/* ── Header: stats + actions ───────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* `get_snag_stats` is permission-guarded server-side. A refusal must not
            take the tab down with it, and it must not be dressed up as zeros
            either — the strip simply does not render, and the list below (which
            is what the tab is for) is unaffected. */}
        {statsError ? (
          <p className="text-xs text-muted-foreground">
            Snag totals are unavailable for your role.
          </p>
        ) : (
          <SnagStatsStrip stats={stats} isLoading={statsLoading} />
        )}

        <div className="flex flex-wrap items-center gap-2">
          {/* Gated to Admin / Project Lead / PMO — `Add snag` and `Import` already
              were, so this was the one ungated control in the group.
              `useSnagBatches` deliberately keeps fetching for everyone: its
              `batches.length` feeds the empty-state gate below. */}
          {perms.canViewBatches && (
            <SnagBatchesPanel batches={batches} isLoading={batchesLoading} />
          )}

          {perms.canAddManual && (
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add snag
            </Button>
          )}

          {perms.canImport && (
            <Button size="sm" className="h-9" onClick={() => setImportOpen(true)}>
              <FileUp className="mr-2 h-4 w-4" />
              Import
            </Button>
          )}

          {/* Ungated, unlike its neighbours — printing the list is not a write.
              It lives up here rather than in the table toolbar, but it still prints
              WHAT IS ON SCREEN: the facets, the Batch funnel and the search box all
              ride along, so the PDF cannot disagree with the table below it.

              RED-BORDERED OUTLINE, deliberately — it sits beside Import and the two
              must not read as the same weight. Import is the one action that CHANGES
              the project's data, so it keeps the SOLID red; taking a copy out is
              secondary, so it carries the red only on its border. Tokens, not literal
              reds (`border-primary/…`, not `border-red-300`), so it tracks the theme's
              primary the way the rest of the app's tinted controls do. */}
          <Button
            size="sm"
            variant="outline"
            className="h-9 border-primary/50 text-primary hover:bg-primary/5 hover:text-primary"
            disabled={isDownloading || totalCount === 0}
            title={
              totalCount === 0
                ? "Nothing to print in this view"
                : "Download this view as a PDF"
            }
            onClick={download}
          >
            {isDownloading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Preparing...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Download
              </>
            )}
          </Button>
        </div>
      </div>

      {perms.isReadOnly && (
        <div className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            You can view this project's snag list, but not change it. Ask an
            Admin, Project Lead or PMO to make updates.
          </span>
        </div>
      )}

      {showEmptyState ? (
        <SnagEmptyState
          onImport={perms.canImport ? () => setImportOpen(true) : undefined}
          onAddManual={perms.canAddManual ? () => setAddOpen(true) : undefined}
        />
      ) : (
        <DataTable<SnagListRow>
          table={table}
          columns={columns}
          isLoading={isLoading}
          error={error}
          totalCount={totalCount}
          searchFieldOptions={SNAG_SEARCHABLE_FIELDS}
          selectedSearchField={selectedSearchField}
          onSelectedSearchFieldChange={setSelectedSearchField}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          facetDoctype={SNAG_DOCTYPE}
          facetOverrides={facetOverrides}
          showExportButton
          onExport="default"
          onExportAll={exportAllRows}
          isExporting={isExporting}
          exportFileName={`Snag_List_${projectId}`}
          showRowSelection={perms.canBulkEdit}
          toolbarActions={
            <>
              {perms.canBulkEdit && (
                <Button
                  size="sm"
                  variant={selectedSnagNames.length ? "default" : "outline"}
                  disabled={selectedSnagNames.length === 0}
                  title={
                    selectedSnagNames.length === 0
                      ? "Tick one or more rows to set their status together"
                      : undefined
                  }
                  onClick={() => setBulkOpen(true)}
                >
                  <Tags className="mr-2 h-3.5 w-3.5" />
                  Set status
                  {selectedSnagNames.length > 0
                    ? ` (${selectedSnagNames.length})`
                    : ""}
                </Button>
              )}
            </>
          }
        />
      )}

      {/* ── Dialogs ───────────────────────────────────────────────── */}
      <SnagImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        projectId={projectId}
        onImported={handleImported}
      />

      {perms.canAddManual && (
        <AddSnagDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          isSaving={isAdding}
          areaSuggestions={areaSuggestions}
          categorySuggestions={categorySuggestions}
          onSubmit={addManualSnag}
        />
      )}

      {/* Rendered only while a row is being edited, and KEYED on that row: the
          dialog seeds its three drafts in a `useState` initialiser, so the key is
          what re-seeds them when a different row is opened. */}
      {perms.canEditRow && editRow && (
        <SnagEditDialog
          key={editRow.name}
          snag={editRow}
          batchName={
            editRow.batch ? batchNameByName.get(editRow.batch) ?? editRow.batch : null
          }
          areaSuggestions={areaSuggestions}
          categorySuggestions={categorySuggestions}
          isSaving={isSavingDetails}
          onCancel={() => setEditRow(null)}
          onSubmit={updateSnagDetails}
        />
      )}

      {perms.canBulkEdit && (
        /* BULK takes NO remark, deliberately (owner decision Q12a): one sentence
           would overwrite N different remarks, and a remark overwrite destroys the
           imported text. The dialog is unchanged from Revision 1 for that reason. */
        <BulkStatusDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          selectedCount={selectedSnagNames.length}
          isSaving={isBulkSaving}
          onConfirm={handleBulkConfirm}
        />
      )}
    </div>
  );
}
