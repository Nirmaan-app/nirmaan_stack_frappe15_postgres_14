/**
 * SheetViewPage.tsx -- the READ-ONLY committed-sheet viewer.
 *
 * Route: /upload-boq/hub/:boqId/view/:sheetName
 *
 * WHAT THIS IS AND WHY IT IS NOT SheetPricingPage: the project BoQ tab's row click lands
 * someone who wants to LOOK at a committed sheet, not price it. SheetPricingPage is the
 * editor -- lock acquisition, two ribbons, the rate-helper panel, classify/freeze/BCS, the
 * carry dialog -- and every one of those is an editing affordance. This page renders the
 * two things a reader needs: the sheet TAB STRIP and the TABLE.
 *
 * ⚠️ READ-ONLY IS EXPRESSED BY WITHHOLDING THE SAVE CALLBACKS, which is the grid's OWN
 * convention (frontend/CLAUDE.md: "Read-only gating = PRESENCE of the save callback"). This
 * page passes NONE of them -- no onSaveRate / onBatchWrite / onSaveRemark / onSaveColor /
 * onSaveReconChoice / onSaveFormula / onSaveBcsRates / onCategoryClick -- so every edit gate
 * inside PricingGrid collapses to its read-only render with no new flag to maintain. Do NOT
 * add an `editable`-style boolean here; a second signal is exactly what that convention
 * exists to avoid. It also means this page NEVER acquires the pricing lock, so opening a
 * sheet here can never take it over from someone actually pricing it.
 *
 * Collapse (the chevrons) and the tab strip are VIEW state, not writes, so they stay.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useFrappeGetCall } from "frappe-react-sdk";
import { useUserData } from "@/hooks/useUserData";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PricingGrid,
  isAmountDescriptor,
  isGridOnlySheet,
  isRateDescriptor,
  orderCommittedSheets,
} from "./PricingGrid";
import { canSeeBoqCommercials } from "./boqAccess";
import { SheetDataGrid } from "./SheetDataGrid";
import { buildChildrenByParent, isHiddenByCollapse, type CollapseRow } from "./collapse";
import { bcsLiveRateKinds, bcsToggleState, type BcsRateKind } from "./bcsColumns";
import { bcsRatesLoadState } from "./pricingLoadState";
import { resolvedToSheetCategoryRow } from "./sheetCategoryResolve";
import type {
  BcsRowRate,
  CategoryCatalogEntry,
  CommittedSheetGridResponse,
  GetBcsStateResponse,
  GetCommittedStateResponse,
  GetPricedRowsResponse,
  GetSheetBcsRatesResponse,
  GetSheetCategoriesResolvedResponse,
  ResolvedSheetCategory,
  SheetCategoryRow,
} from "./boqTypes";

// Module-level constants so an "off" render cannot mint a fresh identity per render and churn
// the memoized grid (the EMPTY_FILTER_SET precedent in SheetPricingPage).
const EMPTY_BCS_KINDS: BcsRateKind[] = [];
const EMPTY_BCS_RATES: Map<number, BcsRowRate> = new Map();

/**
 * Fetch ONE discipline's category catalog and report it up -- rendered once per ran-discipline,
 * so the number of catalog fetches is dynamic yet hook-safe (each instance calls exactly one
 * hook). Renders no DOM. N-generic: `discipline` is data, never a hardcoded string.
 *
 * DELIBERATELY a local twin of SheetPricingPage's fetcher rather than an extraction: hoisting it
 * would mean editing the 5.5k-line editor for a 15-line helper this page only needs in order to
 * turn ids into labels. If a third caller appears, THAT is the moment to give it one home.
 */
function EngineCatalogFetcher({
  discipline,
  onLoaded,
}: {
  discipline: string;
  onLoaded: (discipline: string, categories: CategoryCatalogEntry[]) => void;
}) {
  const { data } = useFrappeGetCall<{
    message: { discipline: string; categories: CategoryCatalogEntry[] };
  }>(
    "nirmaan_stack.api.boq.wizard.classify.get_category_catalog",
    { discipline },
    `boq-catalog::${discipline}`,
  );
  const cats = data?.message?.categories;
  useEffect(() => {
    if (cats) onLoaded(discipline, cats);
  }, [cats, discipline, onLoaded]);
  return null;
}

export const SheetViewPage = () => {
  const navigate = useNavigate();
  // RR v6 auto-decodes path params; sheetName is then matched VERBATIM (#152) everywhere.
  const { boqId, sheetName } = useParams<{ boqId: string; sheetName: string }>();
  // Admin + estimation + billing see the commercial columns; everyone else gets the sheet
  // WITHOUT them. One predicate covers Rate, Amount and BCS together -- see its docblock for
  // why they cannot be split (a visible Amount beside a visible Quantity discloses the Rate).
  const { role, user_id } = useUserData();
  const showCommercials = canSeeBoqCommercials(role, user_id);

  // ── Reads ────────────────────────────────────────────────────────────────────
  // The committed rows + their saved prices. Same endpoint the editor reads; this page
  // simply never posts anything back.
  const { data: pricedData, error: pricedError } = useFrappeGetCall<{
    message: GetPricedRowsResponse;
  }>(
    "nirmaan_stack.api.boq.wizard.pricing.get_priced_rows",
    { boq_name: boqId ?? "", sheet_name: sheetName ?? "" },
    boqId && sheetName ? undefined : null,
  );

  // The sheet tab strip: this BoQ's committed sheets, in workbook order.
  const { data: committedStateData } = useFrappeGetCall<{ message: GetCommittedStateResponse }>(
    "nirmaan_stack.api.boq.wizard.commit_gate.get_committed_state",
    { boq_name: boqId ?? "" },
    boqId ? undefined : null,
  );

  // The Category column's verdicts (multi-engine resolved, HV-10). Read-only here: the
  // adapter drops telemetry exactly as it does in the editor, and no picker is wired.
  const { data: catData } = useFrappeGetCall<{ message: GetSheetCategoriesResolvedResponse }>(
    "nirmaan_stack.api.boq.wizard.classify.get_sheet_categories_resolved",
    { boq: boqId ?? "", sheet_name: sheetName ?? "" },
    boqId && sheetName ? undefined : null,
  );

  const committedSheets = useMemo(
    () => orderCommittedSheets(committedStateData?.message?.committed_state ?? []),
    [committedStateData],
  );

  // A GRID-ONLY (general-specs) sheet commits a faithful cell grid and ZERO nodes, so the
  // node-based get_priced_rows renders it empty. Same EXPLICIT disposition discriminator the
  // editor uses -- never inferred from "rows came back empty".
  const isGridOnly = isGridOnlySheet(
    committedStateData?.message?.committed_state ?? [],
    sheetName ?? "",
  );
  const commitVersion = pricedData?.message?.commit_version ?? null;

  // ── The sheet payload's slices ───────────────────────────────────────────────
  // No identity-preserving merge is needed here (rowMerge): nothing on this page edits a row,
  // so the array only ever changes when the fetch does.
  //
  // V0/T2 memo shield: PricingGrid is React.memo'd, so every prop it receives must be
  // identity-stable. `?? []` mints a fresh array on each render while the fetch is in flight,
  // which would churn the props and stop the memo ever bailing -- hence the memos.
  const rows = useMemo(() => pricedData?.message?.rows ?? [], [pricedData]);
  const allColumnDescriptors = useMemo(
    () => pricedData?.message?.column_descriptors ?? [],
    [pricedData],
  );
  // ⚠️ WITHHELD FROM THE DESCRIPTOR LIST, NOT HIDDEN VIA `hiddenCols`. Two reasons, both
  // load-bearing: (1) `PricingGrid.isColumnVisible` forces every AMOUNT column visible even when
  // it is in `hiddenCols` -- that exclusion exists so a formula-status badge can never be hidden,
  // and it means hiddenCols simply CANNOT express this gate; (2) a permission gate should not put
  // the figure in the DOM at all. A column the grid was never handed cannot leak.
  const columnDescriptors = useMemo(
    () =>
      showCommercials
        ? allColumnDescriptors
        : allColumnDescriptors.filter((d) => !isRateDescriptor(d) && !isAmountDescriptor(d)),
    [showCommercials, allColumnDescriptors],
  );
  const columnFormulas = useMemo(() => pricedData?.message?.column_formulas ?? [], [pricedData]);
  const reconChoices = useMemo(
    () => pricedData?.message?.reconciliation_choices ?? [],
    [pricedData],
  );
  const { data: gridData } = useFrappeGetCall<{ message: CommittedSheetGridResponse }>(
    "nirmaan_stack.api.boq.wizard.pricing.get_committed_sheet_grid",
    {
      boq_name: boqId ?? "",
      sheet_name: sheetName ?? "", // VERBATIM (#152)
      committed_version: commitVersion ?? 0,
    },
    isGridOnly && boqId && sheetName && commitVersion !== null ? undefined : null,
  );

  // ── Category labels ──────────────────────────────────────────────────────────
  // The cell shows the human-readable LABEL, never the id -- so one catalog fetch per
  // discipline that actually ran, via the same hook-safe child-fetcher pattern the editor
  // uses. N-generic: no discipline is named here.
  const ranDisciplines = useMemo<string[]>(() => catData?.message?.disciplines ?? [], [catData]);
  const [catalogs, setCatalogs] = useState<Record<string, CategoryCatalogEntry[]>>({});
  const handleCatalogLoaded = useCallback((discipline: string, cats: CategoryCatalogEntry[]) => {
    setCatalogs((prev) => (prev[discipline] ? prev : { ...prev, [discipline]: cats }));
  }, []);
  const categoryLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const cats of Object.values(catalogs)) cats.forEach((c) => m.set(c.id, c.label));
    return m;
  }, [catalogs]);

  const categoriesByExcelRow = useMemo(() => {
    const m = new Map<number, SheetCategoryRow>();
    (catData?.message?.categories ?? []).forEach((c: ResolvedSheetCategory) =>
      m.set(c.excel_row, resolvedToSheetCategoryRow(c)),
    );
    return m;
  }, [catData]);

  // ── BCS: the INTERNAL cost block ─────────────────────────────────────────────
  // Shown here when the sheet has it switched on -- READ-ONLY, like everything else on this
  // page: `onSaveBcsRates` is withheld, so the cost boxes render as figures, not inputs.
  //
  // ⚠️ THE EXPORT-LEAK BOUNDARY IS NOT AT ISSUE HERE and must not be read as relaxed: that
  // rule governs the CLIENT WORKBOOK export, which this page does not offer. What is on
  // screen is the same internal cost the pricing editor already shows to whoever opens the
  // sheet; this page adds no new audience and writes nothing.
  const { data: bcsData, error: bcsFetchError } = useFrappeGetCall<{
    message: GetBcsStateResponse;
  }>(
    "nirmaan_stack.api.boq.wizard.bcs.get_bcs_state",
    {
      boq_name: boqId ?? "",
      sheet_name: sheetName ?? "", // VERBATIM (#152)
      committed_version: commitVersion ?? 0,
    },
    boqId && sheetName && commitVersion !== null ? undefined : null,
  );
  const { data: bcsRatesData, error: bcsRatesFetchError } = useFrappeGetCall<{
    message: GetSheetBcsRatesResponse;
  }>(
    "nirmaan_stack.api.boq.wizard.bcs.get_sheet_bcs_rates",
    {
      boq_name: boqId ?? "",
      sheet_name: sheetName ?? "", // VERBATIM (#152)
      committed_version: commitVersion ?? 0,
    },
    boqId && sheetName && commitVersion !== null ? undefined : null,
  );

  // THREE states, not two: `bcsToggleState` keeps "we have no payload" apart from "BCS is off",
  // so a failed read never renders an enabled sheet as OFF. Never re-derive `bcs_enabled` here.
  const bcsState = bcsData?.message ?? null;
  const bcsToggle = bcsToggleState({
    fetchFailed: !!bcsFetchError,
    enabled: bcsState?.bcs_enabled ?? null,
  });
  // Readiness IS enablement since BCS-S12 (the two column pickers are gone); `is_ready` is read
  // rather than re-derived so this page cannot disagree with the editor about the same sheet.
  const bcsReady = bcsState?.is_ready ?? false;
  const bcsRatesLoad = bcsRatesLoadState({ data: bcsRatesData, error: bcsRatesFetchError });
  // ⚠️ `isUsable`, NOT `!isFailed`: it is false while the first read is in flight too, so the
  // block never flashes empty-then-fills. An empty rate map is not silence -- it is the sentence
  // "nothing on this sheet has been costed", which on a fully costed sheet is a confident
  // falsehood. Absence of knowledge renders as NOTHING here, never as a blank that reads as zero.
  const bcsColumnsVisible =
    showCommercials &&
    bcsToggle === "on" &&
    bcsReady &&
    commitVersion !== null &&
    bcsRatesLoad.isUsable;
  const bcsKinds = useMemo(
    () => (bcsColumnsVisible ? bcsLiveRateKinds(allColumnDescriptors) : EMPTY_BCS_KINDS),
    [bcsColumnsVisible, allColumnDescriptors],
  );
  const bcsRatesByExcelRow = useMemo(() => {
    if (!bcsRatesLoad.isUsable) return EMPTY_BCS_RATES;
    const m = new Map<number, BcsRowRate>();
    // The `?? []` is live null-safety, not leftover defensiveness: a `{message: {}}` envelope
    // classifies as `ready`, and `for (const r of undefined)` would take the page down.
    for (const r of bcsRatesData?.message?.rows ?? []) m.set(r.excel_row, r);
    return m;
  }, [bcsRatesData, bcsRatesLoad]);

  // ── Collapse (a VIEW concern, not a write -- hence it survives on a read-only page) ──
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const byRowIndex = useMemo(
    () => new Map<number, CollapseRow>(rows.map((r) => [r.row_index, r])),
    [rows],
  );
  const childrenByParent = useMemo(() => buildChildrenByParent(rows), [rows]);
  const toggleCollapse = useCallback((rowIndex: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }, []);
  const displayRows = useMemo(
    () =>
      collapsed.size === 0
        ? rows
        : rows.filter((r) => !isHiddenByCollapse(r, collapsed, byRowIndex)),
    [rows, collapsed, byRowIndex],
  );

  const isLoading = !!boqId && !!sheetName && !pricedData && !pricedError;

  return (
    <div className="space-y-4 p-4">
      {/* Header: back to the project's BoQ list is the only navigation this page owns. */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <h1 className="text-lg font-semibold truncate">
          {sheetName?.trim() || sheetName}
        </h1>
        <span className="text-xs text-muted-foreground">{boqId}</span>
      </div>

      {/* One catalog fetch per ran discipline. Renders no DOM. */}
      {ranDisciplines.map((d) => (
        <EngineCatalogFetcher key={d} discipline={d} onLoaded={handleCatalogLoaded} />
      ))}

      {/* Sheet tabs -- switching stays INSIDE the viewer (never hops to the editor). */}
      {committedSheets.length > 0 && (
        <Tabs
          value={sheetName}
          onValueChange={(val) => {
            if (val !== sheetName) {
              navigate(`/upload-boq/hub/${boqId ?? ""}/view/${encodeURIComponent(val)}`);
            }
          }}
        >
          <TabsList className="flex flex-wrap h-auto justify-start gap-1">
            {committedSheets.map((s) => (
              <TabsTrigger
                key={s.sheet_name}
                value={s.sheet_name}
                className="max-w-[16rem] truncate"
              >
                {s.sheet_name.trim() || s.sheet_name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {pricedError ? (
        <p className="text-sm text-destructive py-4">Failed to load this sheet.</p>
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : isGridOnly ? (
        <SheetDataGrid
          rows={gridData?.message?.rows ?? []}
          hasMore={false}
          isInitLoading={!gridData}
          initError={null}
          isLoadingMore={false}
          loadMoreError={null}
          onLoadMore={() => {}}
          columnRoleMap={gridData?.message?.column_role_map ?? {}}
          headerRow={gridData?.message?.header_row ?? null}
          headerRowCount={(gridData?.message?.header_row_count ?? 1) as 1 | 2}
          areaList={gridData?.message?.area_dimensions ?? []}
        />
      ) : (
        <PricingGrid
          // Remount on a tab switch so the new sheet starts clean (the editor's convention).
          key={sheetName}
          rows={displayRows}
          columnDescriptors={columnDescriptors}
          // Amount columns still COMPUTE from their declared formulas -- the figures are what
          // a reader came for. Only the authoring callback (onSaveFormula) is withheld.
          columnFormulas={columnFormulas}
          reconChoices={reconChoices}
          categoriesByExcelRow={categoriesByExcelRow}
          categoryLabelById={categoryLabelById}
          hasRun={categoriesByExcelRow.size > 0}
          collapsed={collapsed}
          childrenByParent={childrenByParent}
          onToggleCollapse={toggleCollapse}
          // BCS cost block. `bcsKinds` EMPTY removes it entirely and every colIndex reverts,
          // so a sheet with BCS off is unchanged. `onSaveBcsRates` is withheld -> read-only.
          bcsKinds={bcsKinds}
          bcsRatesByExcelRow={bcsRatesByExcelRow}
          bcsQtySource={bcsState?.bcs_qty_source ?? null}
          bcsAmountSource={bcsState?.bcs_amount_source ?? null}
          virtualized
        />
      )}
    </div>
  );
};

export default SheetViewPage;
export { SheetViewPage as Component };
