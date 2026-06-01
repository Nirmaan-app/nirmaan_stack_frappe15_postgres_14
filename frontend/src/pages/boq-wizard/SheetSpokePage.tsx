/**
 * SheetSpokePage -- per-sheet spoke shell (Module 3 Slice 3b-ii).
 *
 * State ownership (Slice 3d-i lift-up):
 *   - Preview rows (initial + load-more) are fetched here and passed down to
 *     SheetDataGrid as props. SheetDataGrid is now a pure render component.
 *   - columnRoleMap is owned here and passed to BOTH SheetConfigPanel (which
 *     includes it verbatim in the saved blob) and SheetDataGrid (which will
 *     annotate columns in Slice 3d-iii). This shared ownership is required so
 *     both children see the same live role-map without prop-drilling back up.
 *
 * encode/decode: the hub navigates using encodeURIComponent(sheet_name).
 * React Router v6 useParams() auto-decodes URL params, so `sheetName` from
 * useParams is the verbatim original string -- passed to the endpoint as-is
 * (the backend does VERBATIM sheet_name matching with no trim).
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useFrappeGetDoc, useFrappePostCall } from "frappe-react-sdk";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  BOQsDoc,
  ColumnRoleEntry,
  SheetPreviewResponse,
  SheetPreviewRow,
} from "./boqTypes";
import { SheetDataGrid } from "./SheetDataGrid";
import { SheetConfigPanel } from "./SheetConfigPanel";

const SheetSpokePage = () => {
  const { boqId, sheetName } = useParams<{ boqId: string; sheetName: string }>();
  const navigate = useNavigate();

  // useFrappeGetDoc third-arg gotcha: pass null (not {enabled:false}) to disable.
  // Same pattern as BoqHubPage -- server is the source of truth for boq_name + label.
  const { data: boq, isLoading, mutate } = useFrappeGetDoc<BOQsDoc>(
    "BOQs",
    boqId ?? "",
    boqId ? undefined : null
  );

  // Derived values -- computed BEFORE guards so the effects below can reference `draft`.
  // Uses optional chaining since boq may be undefined during the initial loading phase.
  const decodedSheetName = sheetName ?? "";
  const displaySheetName = decodedSheetName.trim() || decodedSheetName;
  const draft = boq?.sheet_drafts?.find((d) => d.sheet_name === decodedSheetName);

  // ── Preview fetch (lifted from SheetDataGrid, Slice 3d-i) ──────────────────
  // useFrappePostCall is used for ALL fetches (initial + load-more) so accumulated
  // rows are fully controlled by local state without SWR replace-on-fetch interference.
  const { call: fetchPreview } = useFrappePostCall<{ message: SheetPreviewResponse }>(
    "nirmaan_stack.api.boq.wizard.sheet_preview.get_sheet_preview"
  );

  const [previewRows, setPreviewRows] = useState<SheetPreviewRow[]>([]);
  const [previewHasMore, setPreviewHasMore] = useState(false);
  const [isPreviewInitLoading, setIsPreviewInitLoading] = useState(true);
  const [previewInitError, setPreviewInitError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  // Stable ref so the initial-load useEffect never adds fetchPreview to its deps.
  const fetchRef = useRef(fetchPreview);
  useEffect(() => { fetchRef.current = fetchPreview; });

  // Initial load -- reruns when boqId or sheetName changes.
  useEffect(() => {
    if (!boqId || !sheetName) return;
    let cancelled = false;

    setIsPreviewInitLoading(true);
    setPreviewInitError(null);
    setPreviewRows([]);
    setPreviewHasMore(false);
    setLoadMoreError(null);

    fetchRef.current({
      boq_name: boqId,
      sheet_name: sheetName,
      start_row: 1,
      end_row: 40,
    })
      .then((result) => {
        if (cancelled) return;
        const preview = result?.message;
        setPreviewRows(preview?.rows ?? []);
        setPreviewHasMore(preview?.has_more ?? false);
        setIsPreviewInitLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPreviewInitError(
          "Failed to load sheet preview. Check that the source file is accessible and try again."
        );
        setIsPreviewInitLoading(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boqId, sheetName]);

  // ── columnRoleMap state (Slice 3d-i) ───────────────────────────────────────
  // Shared between SheetConfigPanel (includes it in the saved blob) and
  // SheetDataGrid (will annotate columns in Slice 3d-iii). Seeded once from
  // draft.sheet_config when the doc first arrives; setRoleMapInitialized(true)
  // is INSIDE the non-null guard (mirrors SheetConfigPanel's initialized pattern)
  // so a later mutate() re-fetch does NOT overwrite in-progress user edits.
  const [columnRoleMap, setColumnRoleMap] = useState<Record<string, ColumnRoleEntry>>({});
  const [roleMapInitialized, setRoleMapInitialized] = useState(false);

  useEffect(() => {
    if (roleMapInitialized) return;
    if (!draft?.sheet_config) return;

    const rawCfg: Record<string, unknown> | null =
      typeof draft.sheet_config === "string"
        ? (() => {
            try {
              return JSON.parse(draft.sheet_config as string) as Record<string, unknown>;
            } catch {
              return null;
            }
          })()
        : (draft.sheet_config as Record<string, unknown>);

    if (!rawCfg) return;

    const rawRoleMap = rawCfg.column_role_map;
    if (rawRoleMap && typeof rawRoleMap === "object" && !Array.isArray(rawRoleMap)) {
      const entries: Record<string, ColumnRoleEntry> = {};
      for (const [col, role] of Object.entries(rawRoleMap as Record<string, unknown>)) {
        if (typeof role === "string") {
          entries[col] = { role, area: null };
        }
      }
      setColumnRoleMap(entries);
    }
    setRoleMapInitialized(true);
  }, [draft, roleMapInitialized]);

  // ── Load-more handler (lifted from SheetDataGrid, Slice 3d-i) ──────────────
  // Single-flight: onLoadMore is passed to SheetDataGrid which disables its
  // button while isLoadingMore is true -- no queue, no debounce needed.
  const handleLoadMore = async () => {
    if (isLoadingMore || !previewHasMore) return;
    const lastRowNum =
      previewRows.length > 0 ? previewRows[previewRows.length - 1].row_number : 40;
    const nextStart = lastRowNum + 1;
    const nextEnd = nextStart + 39;
    setIsLoadingMore(true);
    setLoadMoreError(null);
    try {
      const result = await fetchPreview({
        boq_name: boqId ?? "",
        sheet_name: sheetName ?? "",
        start_row: nextStart,
        end_row: nextEnd,
      });
      const preview = result?.message;
      if (preview) {
        setPreviewRows((prev) => [...prev, ...preview.rows]);
        setPreviewHasMore(preview.has_more);
      }
    } catch {
      setLoadMoreError("Failed to load more rows. Try again.");
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleBack = () => navigate(`/upload-boq/hub/${boqId ?? ""}`);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── Not-found state ────────────────────────────────────────────────────────
  if (!boq) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
        <p className="font-medium text-foreground">BoQ not found</p>
        <p className="text-sm text-muted-foreground">
          No record found for &ldquo;{boqId}&rdquo;.
        </p>
        <Button variant="outline" className="mt-4" onClick={handleBack}>
          Back to hub
        </Button>
      </div>
    );
  }

  // React Router v6.22.1 useParams() auto-decodes path params (calls
  // decodeURIComponent internally). sheetName is already the verbatim DB-stored
  // value -- the hub encoded it with encodeURIComponent and RR undoes that here.
  // No manual decode is needed; a redundant decodeURIComponent would double-decode
  // names containing a literal %xx sequence. (§9 #128 correction.)

  // Guard: sheetName must be present (routing guarantees it, but be defensive).
  if (!sheetName) {
    return (
      <p className="p-6 text-sm text-destructive">
        Missing sheet identifier in URL.
      </p>
    );
  }

  return (
    <div className="flex-1 space-y-4 max-w-5xl mx-auto pt-6 pb-10 px-4">

      {/* ── Header strip ──────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1.5 text-muted-foreground mt-0.5"
          onClick={handleBack}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">
            {boq.boq_name} &middot; V{boq.version ?? 1}
          </p>
          <h1 className="text-lg font-semibold text-foreground truncate leading-tight">
            {/* Display-trimmed for readability; sheetName exact for data. */}
            {displaySheetName}
            {draft?.sheet_label && (
              <span className="ml-2 font-normal text-muted-foreground text-sm">
                ({draft.sheet_label})
              </span>
            )}
          </h1>
        </div>
      </div>

      {/* ── Config panel (Slice 3c) ────────────────────────────────────────── */}
      {/*
        Keyed by decodedSheetName so the component remounts fresh on sheet
        navigation, resetting all local field/confirm state. draft?.sheet_config
        is the existing config blob (may be null for a sheet not yet configured).
        onSaveSuccess calls mutate() to re-fetch the BOQs doc after a save.
        columnRoleMap + setColumnRoleMap are lifted here (Slice 3d-i) so the
        saved blob always includes the current role-map. rows is passed for the
        future Section 3 column list (Slice 3d-ii).
      */}
      {draft && (
        <SheetConfigPanel
          key={decodedSheetName}
          boqName={boq.name}
          sheetName={decodedSheetName}
          draftConfig={draft.sheet_config}
          columnRoleMap={columnRoleMap}
          setColumnRoleMap={setColumnRoleMap}
          rows={previewRows}
          onSaveSuccess={() => void mutate()}
        />
      )}

      {/* ── Data grid ─────────────────────────────────────────────────────── */}
      {/*
        SheetDataGrid is now a pure render component (Slice 3d-i lift-up).
        All fetch state and the load-more handler are owned here and passed
        as props. columnRoleMap is threaded for Slice 3d-iii column annotation.
      */}
      <SheetDataGrid
        rows={previewRows}
        hasMore={previewHasMore}
        isInitLoading={isPreviewInitLoading}
        initError={previewInitError}
        isLoadingMore={isLoadingMore}
        loadMoreError={loadMoreError}
        onLoadMore={() => void handleLoadMore()}
        columnRoleMap={columnRoleMap}
      />
    </div>
  );
};

export default SheetSpokePage;
export { SheetSpokePage as Component };
