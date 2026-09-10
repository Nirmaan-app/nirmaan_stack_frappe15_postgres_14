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
 *  - The controls are split across TWO rows by WHAT THEY ACT ON, and each group is
 *    built ONCE. `headerActions` (import history + Download All + Import) rides the
 *    TAB ROW at both mount points, because every one of those acts on BATCHES and a
 *    tab IS a batch — Download All prints one report per batch and merges them.
 *    `statsRowActions` (Add snag + Download) sits with the tally, because those act on
 *    the list in front of you. Do not merge them back for tidiness — and note that
 *    `Add snag` creates a snag with NO batch, which is exactly why it does not belong
 *    beside Import — the Project
 *    page tab and `/snag-list/:id` render the identical strip. Do not answer a
 *    "put the buttons somewhere else" request by rebuilding them at the other
 *    site: the import dialog's state, the download hook and the permission gates
 *    all live here, and a second copy is how the two mount points start
 *    disagreeing about who may press what. (An earlier revision portaled this
 *    group into the detail page's own header; that was reversed so the two
 *    screens read identically, and the portal seam was removed with it.)
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

import { useSnagDownload, useSnagDownloadAll } from "./download";

import { AddSnagDialog } from "./components/AddSnagDialog";
import { BulkStatusDialog } from "./components/BulkStatusDialog";
import { SnagBatchTabs } from "./components/SnagBatchTabs";
import { SnagBatchesPanel } from "./components/SnagBatchesPanel";
import { SnagEmptyState } from "./components/SnagEmptyState";
import { SnagEditDialog } from "./components/SnagEditDialog";
import { SnagStatsStrip } from "./components/SnagStatsStrip";
import {
  SNAG_INITIAL_COLUMN_VISIBILITY,
  getSnagColumns,
} from "./config/snagColumns";
import {
  ALL_BATCHES,
  MANUAL_BATCH,
  SnagBatchTabValue,
  buildSnagBatchTabs,
  isUnprintableTab,
  printableBatch,
  snagBatchFilter,
  statsForTab,
} from "./config/snagBatchTabs";
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
import { IngestBatchResponse, SnagStatus } from "./types";

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

export function SnagListTab({
  projectId,
  projectName,
}: SnagListTabProps): JSX.Element {
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

  // WHICH IMPORT IS ON SCREEN. `ALL_BATCHES` (the default) narrows nothing.
  // Session-scoped on purpose: it is NOT in `urlSyncKey`'s persisted table state,
  // because that state is `columnFilters` + search, and a batch tab is deliberately
  // neither (`config/snagBatchTabs.ts`). A bookmark therefore always opens on "All".
  const [activeBatch, setActiveBatch] = React.useState<SnagBatchTabValue>(ALL_BATCHES);

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

  // The table's base filters — project, plus the selected batch tab.
  //
  // The tab rides HERE, in `additionalFilters`, and never in `columnFilters`: the
  // Batch funnel was removed in Revision 3 along with its host column and its entry
  // in the persisted-state sanitizer, and routing a tab through that channel would
  // walk straight back into the bookmark defect that removal was for.
  //
  // `facetOverrides` below reads the same array, so the Area / Category / Status
  // funnels list the values present IN THE SELECTED BATCH — which is what a facet
  // over a narrowed table must show.
  const projectFilters = React.useMemo(() => {
    const base: unknown[][] = [["project", "=", projectId]];
    const batchClause = snagBatchFilter(activeBatch);
    return batchClause ? [...base, batchClause] : base;
  }, [projectId, activeBatch]);

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
    setPagination,
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

  // --- Batch tabs ---
  // Counts come from the `by_batch` split of the ONE stats call this screen already
  // makes; there is no per-batch fetch and there must not be one.
  const batchTabs = React.useMemo(
    () => buildSnagBatchTabs(batches, stats.by_batch, stats.total),
    [batches, stats.by_batch, stats.total]
  );

  // Switching tabs MUST reset the page. `useServerDataTable` does not reset
  // `pageIndex` when `additionalFilters` change (its own reset is commented out),
  // so moving from page 3 of a 124-row batch to a 4-row one would land on an empty
  // page with no indication that the rows exist on page 1.
  const handleBatchChange = React.useCallback(
    (next: SnagBatchTabValue) => {
      setActiveBatch(next);
      setPagination((prev) => ({ ...prev, pageIndex: 0 }));
    },
    [setPagination]
  );

  // What the stats strip shows: the whole project on "All", otherwise the selected
  // batch's own slice — the strip has to agree with the table under it.
  const scopedStats = React.useMemo(
    () => statsForTab(stats, activeBatch),
    [stats, activeBatch]
  );

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
    // `undefined` on "All" (absent = every batch, the Jinja's own default) and on
    // the manual tab, which the format cannot express — hence the guard below.
    batch: printableBatch(activeBatch),
  });

  /**
   * "Download All" — every batch's report merged into one PDF.
   *
   * Shown only with MORE THAN ONE batch: with one it would produce byte-for-byte what
   * Download already gives, and two buttons doing the same thing is how a user learns
   * to distrust both.
   */
  const { isDownloading: isDownloadingAll, download: downloadAll } = useSnagDownloadAll({
    projectId,
    projectLabel: projectName,
    columnFilters,
    searchTerm,
    selectedSearchField,
  });

  const batchCount = batches.length;
  const canDownloadAll = batchCount > 1;

  /**
   * How many snags "Download All" will NOT contain.
   *
   * It renders one section PER BATCH, and a manually added snag has no batch — so it
   * lands in no section. The print format cannot express "has no batch" either (its
   * filter is `["batch", "in", [...]]`), which is the same limitation that disables
   * Download on the "Added manually" tab. Surfaced in the tooltip rather than left to
   * be discovered: rows quietly missing from a file called "All" is the bad outcome.
   */
  const unbatchedCount = stats.by_batch?.[""]?.total ?? 0;

  // The ONE view the PDF cannot reproduce: `batches` becomes `["batch", "in", [...]]`
  // on the Jinja side, which has no way to say "has no batch". Downloading anyway
  // would print every batch while the screen shows none of them, so the button is
  // withheld and says why rather than quietly printing something else.
  const downloadUnavailable = isUnprintableTab(activeBatch);

  // --- Bulk selection ---
  // Row ids are ARRAY INDICES (the shared hook does not set `getRowId`), so a
  // selection cannot survive a page / filter / search change without silently
  // re-pointing at different rows. Clear it whenever the visible set moves.
  const tableRef = React.useRef(table);
  tableRef.current = table;
  const viewKey = `${activeBatch}|${pagination.pageIndex}|${pagination.pageSize}|${searchTerm}|${selectedSearchField}|${JSON.stringify(columnFilters)}`;
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

  /**
   * Add a snag INTO THE TAB THE USER IS ON.
   *
   * `activeBatch` is a real batch name on a batch tab, so the new snag joins that
   * import and appears immediately in the list on screen. On the "Added manually" tab
   * it is the sentinel, which maps to `null` — no batch, which is what that tab means.
   *
   * ⚠️ THE JUMP TO "All" THAT USED TO LIVE HERE IS GONE, and its reason with it: a
   * hand-added snag was invisible on whatever batch tab was open, so the screen had to
   * move to show it. It is no longer invisible — it lands in the open tab — and the
   * jump would now be actively wrong, because `Add snag` is hidden on "All" and the
   * user would be thrown somewhere they cannot add a second one.
   */
  const handleAddManual = React.useCallback(
    async (input: Parameters<typeof addManualSnag>[0]) => {
      const target =
        activeBatch === ALL_BATCHES || activeBatch === MANUAL_BATCH ? null : activeBatch;
      return addManualSnag({ ...input, batch: target });
    },
    [addManualSnag, activeBatch]
  );

  const handleImported = React.useCallback(
    (result?: IngestBatchResponse) => {
      handleChanged();

      // Land on the batch that was just created, so the import's own rows are what the
      // user sees next. An import now yields exactly ONE batch however many sheets it
      // combined (owner decision 2026-09-09), so there is no longer an ambiguous case to
      // guard against — the earlier "only when exactly one succeeded" rule existed
      // because a multi-sheet import used to create one batch PER SHEET.
      if (result?.batch) handleBatchChange(result.batch);
    },
    [handleChanged, handleBatchChange]
  );

  /**
   * The STATS-ROW group: `Add snag` and `Download`.
   *
   * NOT RENDERED ON THE "All" TAB — see the render site. The group exists to act on one
   * import; on "All" the download it offers is the whole project, which `Download All`
   * already covers from the tab row in a more useful shape.
   *
   * The split from the tab row is by WHAT A CONTROL ACTS ON, not by read-vs-write.
   * Import, the history popover and Download All act on BATCHES — a tab is a batch, so
   * they sit on the tab row. These two act on the LIST IN FRONT OF YOU: `Add snag` puts
   * one row into it (with no batch at all, which is why it does not belong beside
   * Import), and `Download` prints exactly what it is showing — the selected tab, the
   * facets and the search box all ride into the PDF. Both therefore sit with the tally
   * that describes that same list.
   *
   * ⚠️ `Download` and `Download All` are one row apart on purpose. They produce
   * DIFFERENT documents: this one is the current view as a single report; the other is
   * one report per batch, merged. Putting them side by side made them read as a pair of
   * scopes on one action, which is what the row split now says they are not.
   *
   * `Download` is UNGATED, unlike its neighbour — printing a list is not a write.
   *
   * Its RED-BORDERED OUTLINE is kept from when it sat next to Import: it stays
   * secondary to the solid-red Import even now that they are on different rows. Tokens,
   * not literal reds (`border-primary/…`, not `border-red-300`), so it tracks the
   * theme's primary the way the rest of the app's tinted controls do.
   */
  const statsRowActions = (
    <div className="flex flex-wrap items-center gap-2">
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

      <Button
        size="sm"
        variant="outline"
        className="h-9 border-primary/50 text-primary hover:bg-primary/5 hover:text-primary"
        disabled={isDownloading || totalCount === 0 || downloadUnavailable}
        title={
          downloadUnavailable
            ? "The snag PDF cannot be narrowed to manually added snags yet — switch to All or a batch tab"
            : totalCount === 0
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
  );

  // --- Empty state gate ---
  // Only a genuinely empty project qualifies. A table emptied by a search or a
  // facet must NOT read as "no snags yet" — that would hide the filter that did it.
  const hasActiveNarrowing =
    !!searchTerm || columnFilters.length > 0 || activeBatch !== ALL_BATCHES;
  const showEmptyState =
    !isLoading &&
    !batchesLoading &&
    totalCount === 0 &&
    batches.length === 0 &&
    !hasActiveNarrowing;

  /**
   * The TAB-ROW group: the controls that act on BATCHES.
   *
   * Import creates one, the history popover lists them, and Download All prints every
   * one of them (a report each, merged) — all three belong beside the tabs, because a
   * tab IS a batch. `Add snag` and `Download` deliberately are NOT here; see
   * `statsRowActions`.
   *
   * Gated to Admin / Project Lead / PMO. `useSnagBatches` deliberately keeps fetching
   * for everyone: its `batches.length` feeds the empty-state gate below.
   */
  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      {perms.canViewBatches && (
        <SnagBatchesPanel batches={batches} isLoading={batchesLoading} />
      )}

      {canDownloadAll && (
        <Button
          size="sm"
          variant="outline"
          className="h-9 border-primary/50 text-primary hover:bg-primary/5 hover:text-primary"
          disabled={isDownloadingAll}
          title={
            unbatchedCount > 0
              ? `One PDF holding all ${batchCount} imports, one report each. Does NOT include the ${unbatchedCount} manually added snag${unbatchedCount === 1 ? "" : "s"} — they belong to no import.`
              : `One PDF holding all ${batchCount} imports, one report each`
          }
          onClick={downloadAll}
        >
          {isDownloadingAll ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Merging...
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Download All
            </>
          )}
        </Button>
      )}

      {perms.canImport && (
        <Button size="sm" className="h-9" onClick={() => setImportOpen(true)}>
          <FileUp className="mr-2 h-4 w-4" />
          Import
        </Button>
      )}
    </div>
  );

  if (error) return <AlertDestructive error={error} />;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 overflow-hidden",
        totalCount > 10 ? "h-[calc(100vh-180px)]" : "h-auto"
      )}
    >
      {/* ── Batch tabs ────────────────────────────────────────────
          ABOVE the stats strip, deliberately: the strip is SCOPED to whichever tab
          is selected, so the tab has to be chosen first for the numbers under it to
          mean anything. Reading counts and only then finding the control that moves
          them is the wrong order.

          Renders itself away when there is nothing to choose between (a project with
          no batch and no manual snag), so no gate is needed here. */}
      <SnagBatchTabs
        tabs={batchTabs}
        value={activeBatch}
        onChange={handleBatchChange}
        isLoading={statsLoading || batchesLoading}
        // The action group rides the TAB ROW when it renders here, so it never
        // shares a row with the stats. `undefined` when a mount point offers its own
        // header — the portal below puts them there instead.
        trailing={headerActions}
      />

      {/* ── The selected tab's tally ───────────────────────────────
          A FULL-WIDTH row of its own, with no controls in it. Both mount points
          agree on this: actions → tabs → these numbers → toolbar → table. The row
          says one thing (what is in the tab you picked) and it says it alone.

          `get_snag_stats` is permission-guarded server-side. A refusal must not take
          the tab down with it, and it must not be dressed up as zeros either — the
          strip simply does not render, and the list below (which is what the tab is
          for) is unaffected. */}
      {/* The selected tab's tally, with Download opposite it — both describe THIS view.
          `sm:items-center` also stops the strip stretching: as a bare child of the
          page's `flex-col` its border would run the full width with the five tiles
          bunched at the left. Full width on mobile (the tiles are `flex-1` and fill
          it), hugging its content from `sm` up. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {statsError ? (
          <p className="text-xs text-muted-foreground">
            Snag totals are unavailable for your role.
          </p>
        ) : (
          <SnagStatsStrip stats={scopedStats} isLoading={statsLoading} />
        )}

        {/* HIDDEN ON "All" (owner decision 2026-09-09). Both controls answer a
            question about ONE import: `Download` prints the view, and on "All" that
            is the whole project — which is what `Download All` covers from the tab
            row, one report per batch. Rather than leave two overlapping downloads
            side by side, the pair only appears once a specific tab is chosen. */}
        {activeBatch !== ALL_BATCHES && statsRowActions}
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

      {/* Rendered ONLY while open, exactly like the Edit dialog below: the dialog seeds
          its three drafts in `useState` initialisers, so the MOUNT is what clears them.
          Held permanently mounted it kept the previous snag's text — its own reset sat
          in an `onOpenChange(true)` branch that Radix never fires for a prop-driven
          open. Do not "simplify" this back to an always-mounted dialog. */}
      {perms.canAddManual && addOpen && (
        <AddSnagDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          isSaving={isAdding}
          areaSuggestions={areaSuggestions}
          categorySuggestions={categorySuggestions}
          // Which import the snag joins — resolved to its human name against the batch
          // list this page already loads. `null` on "Added manually".
          batchName={
            activeBatch === ALL_BATCHES || activeBatch === MANUAL_BATCH
              ? null
              : batchNameByName.get(activeBatch) ?? activeBatch
          }
          onSubmit={handleAddManual}
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
