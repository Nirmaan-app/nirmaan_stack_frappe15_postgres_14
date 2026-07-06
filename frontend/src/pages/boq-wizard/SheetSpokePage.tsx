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
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  FrappeConfig,
  FrappeContext,
  useFrappeGetCall,
  useFrappeGetDoc,
  useFrappePostCall,
} from "frappe-react-sdk";
import { useUserData } from "@/hooks/useUserData";
import { BoqPresence } from "./BoqPresence";
import { DownstreamBanner } from "./DownstreamBanner";
import { ArrowLeft, Loader2, Lock, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getFrappeError } from "@/utils/frappeErrors";
import type {
  BOQsDoc,
  ColumnRoleEntry,
  LockInfo,
  SheetPreviewResponse,
  SheetPreviewRow,
  WorkPackageMap,
} from "./boqTypes";
import { SheetDataGrid } from "./SheetDataGrid";
import { SheetConfigPanel } from "./SheetConfigPanel";

// B1 (draft-tier lock): the PURE-read get_draft_lock_info shape (mirrors the pricing tier's
// editable/lock_info payload with a DRAFT sentinel committed_version=0). Typed locally so no
// shared file is touched -- reuses the exported LockInfo type.
interface DraftLockInfoResponse {
  lock_info: LockInfo | null;
  editable: boolean;
}

// B1 reject marker: a failed acquire / write throws a message CONTAINING this when the draft is
// held FRESH by another user. Distinct from the pricing tier's BOQ_PRICING_LOCKED so a draft
// reject is never confused with a pricing reject (detect with .includes, per the A2 convention).
const DRAFT_LOCK_MARKER = "BOQ_DRAFT_LOCKED";

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

  // Whole-BoQ work-package map (Slice 3f-readback). Frappe get_doc does not
  // hydrate grandchild rows, so draft.work_packages is always undefined on the
  // client. This endpoint is the authoritative read path. SWR key follows
  // useFrappeGetDoc convention: null disables until boqId is present.
  const { data: wpMapData, mutate: mutateWpMap } = useFrappeGetCall<{ message: WorkPackageMap }>(
    "nirmaan_stack.api.boq.wizard.update_sheet_draft.get_boq_work_packages",
    { boq_name: boqId ?? "" },
    boqId ? undefined : null
  );

  // ── Draft-tier single-editor lock -- realtime layer (B1 / ADR-0011) ──────────
  // Mirrors the A2 pricing lock (SheetPricingPage) adapted to the DRAFT tier: acquire on FIRST
  // edit-intent (the config panel's onEditIntent), heartbeat ~30s while holding, release on
  // leave (sendBeacon + unmount), and listen for boq:lock_changed to flip read-only the instant
  // ANOTHER user acquires / releases this sheet's draft. committed_version is the fixed sentinel
  // 0 everywhere. The server throw (BOQ_DRAFT_LOCKED in every draft WRITE endpoint) stays the
  // durable enforcement; this is only the UX accelerator.
  const { socket } = useContext(FrappeContext) as FrappeConfig;
  const { user_id: currentUser } = useUserData();
  const { call: acquireDraftLock } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.draft_lock.acquire_draft_lock",
  );
  // PURE read of the draft lock state (editable + holder). Disabled until boqId + sheetName are
  // present (swrKey gotcha: null, not {enabled}). Refetched on boq:lock_changed / reconnect.
  const { data: draftLockData, mutate: mutateLock } = useFrappeGetCall<{ message: DraftLockInfoResponse }>(
    "nirmaan_stack.api.boq.wizard.draft_lock.get_draft_lock_info",
    { boq_name: boqId ?? "", sheet_name: sheetName ?? "" }, // sheet_name VERBATIM (#152)
    boqId && sheetName ? undefined : null,
  );
  // Whether THIS client currently holds the draft lock (draft version is the fixed sentinel 0, so
  // a boolean suffices -- there is no version axis). A ref so the heartbeat + socket handler read
  // the latest without re-registering.
  const heldRef = useRef(false);
  // Mid-edit takeover: a save/acquire rejected with BOQ_DRAFT_LOCKED, OR a socket acquire by
  // another user while we were holding -> read-only + the takeover banner until a fresh editable
  // payload arrives (the [draftLockData] effect clears it).
  const [takenOver, setTakenOver] = useState(false);
  // Break-glass CLIENT override (dev/testing) -- skip all lock calls.
  const locksDisabledClient =
    typeof window !== "undefined" &&
    window.localStorage.getItem("nirmaan-boq-locks-disabled") === "true";
  // Latest lock identity, read by the [socket]-scoped handler + the heartbeat/release effects
  // WITHOUT recreating them (the A2 ref-for-changing-values pattern). Updated each render.
  const lockCtxRef = useRef<{
    boqId?: string; sheetName?: string; currentUser: string; disabled: boolean;
  }>({ boqId, sheetName, currentUser, disabled: locksDisabledClient });
  lockCtxRef.current = { boqId, sheetName, currentUser, disabled: locksDisabledClient };

  // Derived values -- computed BEFORE guards so the effects below can reference `draft`.
  // Uses optional chaining since boq may be undefined during the initial loading phase.
  const decodedSheetName = sheetName ?? "";
  const displaySheetName = decodedSheetName.trim() || decodedSheetName;
  const draft = boq?.sheet_drafts?.find((d) => d.sheet_name === decodedSheetName);
  // #164: this sheet is under active parse/re-parse -> lock the config panel.
  const isSheetParsing = draft?.parse_in_progress === 1;

  // Work-header list for the current sheet (Slice 3f-readback).
  // Pass undefined while wpMapData is still loading so SheetConfigPanel's
  // wpInitialized seed guard waits. Once loaded, use [] for sheets with no
  // assignments (so the seed locks and survives subsequent mutateWpMap calls).
  const wpMapLoaded = wpMapData !== undefined;
  const sheetWorkHeaders: string[] | undefined = wpMapLoaded
    ? (wpMapData?.message?.[decodedSheetName] ?? [])
    : undefined;

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

  // ── columnRoleMap state (Slice 3d-i; read-back fix 3d-ii) ──────────────────
  // Shared between SheetConfigPanel (includes it in the saved blob) and
  // SheetDataGrid (will annotate columns in Slice 3d-iii). Seeded once from
  // draft.sheet_config when the doc first arrives. setRoleMapInitialized(true)
  // fires only after rawCfg is successfully parsed (draft absent → early return;
  // JSON fail → rawCfg null → early return). A later mutate() re-fetch does NOT
  // overwrite in-progress user edits.
  // Seed loop handles both the current {role,area} object shape (3d-ii onward)
  // and the legacy role-only string shape defensively.
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
      for (const [col, val] of Object.entries(rawRoleMap as Record<string, unknown>)) {
        if (typeof val === "string") {
          // Legacy pre-3d-ii shape: role-only string.
          entries[col] = { role: val, area: null };
        } else if (
          val !== null &&
          typeof val === "object" &&
          "role" in val &&
          typeof (val as { role: unknown }).role === "string"
        ) {
          // Current 3d-ii shape: { role, area } object.
          const v = val as { role: string; area?: string | null };
          entries[col] = { role: v.role, area: v.area ?? null };
        }
        // Null / malformed values are silently skipped.
      }
      setColumnRoleMap(entries);
    }
    // Lock after rawCfg parsed successfully. draft absent → early-returned above;
    // JSON fail → rawCfg null → early-returned above. A legitimately empty
    // column_role_map (key absent, or no parseable entries) is valid "no roles
    // configured" state -- still locks so mutate() re-fetches don't clobber edits.
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

  // ── Saved-config derived values for grid display (Slice 3d-iii) ──────────────
  // These are plain derived values from the saved draft.sheet_config (not editable
  // state). They track the saved doc and update automatically on mutate(). Used by
  // SheetDataGrid for area tinting and header-row freeze. The asymmetry vs
  // columnRoleMap is intentional: color/badge/dim are driven by live columnRoleMap
  // (update as user edits Section 3 before Save); freeze + area colors are driven by
  // the last-saved config (update only after Save triggers mutate()).
  const parsedSavedCfg = useMemo<Record<string, unknown> | null>(() => {
    const cfg = draft?.sheet_config;
    if (!cfg) return null;
    if (typeof cfg === "string") {
      try { return JSON.parse(cfg) as Record<string, unknown>; } catch { return null; }
    }
    return cfg as Record<string, unknown>;
  }, [draft?.sheet_config]);

  const savedHeaderRow: number | null =
    typeof parsedSavedCfg?.header_row === "number" ? parsedSavedCfg.header_row : null;
  const savedHrc: 1 | 2 =
    parsedSavedCfg?.header_row_count === 2 ? 2 : 1;
  const areaList: string[] =
    Array.isArray(parsedSavedCfg?.area_dimensions)
      ? (parsedSavedCfg.area_dimensions as string[])
      : [];

  // B1: clear takenOver whenever a FRESH get_draft_lock_info payload reports the sheet editable
  // (a Reload re-read found it free / mine / stale). Keyed on the payload identity so it fires on
  // EVERY refetch -- an [editable] dep would miss a true->true no-change.
  useEffect(() => {
    if (draftLockData?.message && (draftLockData.message.editable ?? true)) {
      setTakenOver(false);
    }
  }, [draftLockData]);

  // B1 defensive: the page element is shared across the spoke route, so a :sheetName change must
  // not carry stale lock state into the new sheet. In practice the config spoke has no in-page
  // sheet switcher (Back returns to the hub -> the page remounts), but reset the transient flags
  // for correctness parity with the A2 tab-based page. The draft-lock read refetches on the new
  // SWR key; the config panel remounts via key=.
  useEffect(() => {
    setTakenOver(false);
    heldRef.current = false;
  }, [sheetName]);

  // B1 realtime: flip read-only / free the instant ANOTHER user acquires or releases this sheet's
  // DRAFT lock. Screen-scoped listener (BoqHubPage pattern): register on the stable FrappeContext
  // socket, read changing identity from lockCtxRef, off() on cleanup, + a reconnect self-heal
  // (re-fetch authoritative lock_info on (re)connect). GUARD: boq + sheet_name VERBATIM (#152) +
  // committed_version===0 (the draft sentinel) + suppress our own events.
  useEffect(() => {
    if (!socket) return;
    const handler = (payload: {
      boq?: string; sheet_name?: string; committed_version?: number | string;
      action?: string; locked_by?: string | null;
    }) => {
      const ctx = lockCtxRef.current;
      if (ctx.disabled) return;
      if (!payload || payload.boq !== ctx.boqId) return;
      if (payload.sheet_name !== ctx.sheetName) return; // VERBATIM (#152)
      if (Number(payload.committed_version) !== 0) return; // draft sentinel only
      if (payload.locked_by && payload.locked_by === ctx.currentUser) return; // suppress own
      if (payload.action === "acquired" || payload.action === "took_over") {
        // Another user now holds this sheet's draft -> we no longer do; flip to read-only.
        const wasHolding = heldRef.current;
        heldRef.current = false;
        if (wasHolding) {
          // We were the editor and got displaced -> the takeover banner (the panel keeps any
          // in-progress local edits; they just can't be saved).
          setTakenOver(true);
        } else {
          // We were only viewing -> re-read authoritative state so the precise "being edited by
          // <name>" holder banner shows (editable=false + lock_info).
          void mutateLock();
        }
      } else if (payload.action === "released") {
        // Freed by another -> re-read authoritative editable/lock_info (the [draftLockData]
        // effect clears takenOver when the fresh payload reports the sheet editable).
        void mutateLock();
      }
    };
    const onReconnect = () => { void mutateLock(); };
    socket.on("boq:lock_changed", handler);
    socket.on("connect", onReconnect);
    return () => {
      socket.off("boq:lock_changed", handler);
      socket.off("connect", onReconnect);
    };
  }, [socket, mutateLock]);

  // B1 heartbeat: while we HOLD the lock, refresh it every ~30s so an active editor is never taken
  // over mid-session (the edit-driven TTL would otherwise lapse without saves). A rejected refresh
  // (another user took over) flips us to read-only.
  useEffect(() => {
    const id = window.setInterval(() => {
      const ctx = lockCtxRef.current;
      if (ctx.disabled || !heldRef.current) return;
      if (!ctx.boqId || !ctx.sheetName) return;
      void acquireDraftLock({ boq_name: ctx.boqId, sheet_name: ctx.sheetName }).catch((e) => {
        if (getFrappeError(e).includes(DRAFT_LOCK_MARKER)) {
          heldRef.current = false;
          setTakenOver(true);
        }
      });
    }, 30_000);
    return () => window.clearInterval(id);
  }, [acquireDraftLock]);

  // B1 release-on-leave: free the lock the INSTANT the editor closes, so no colleague waits out
  // the TTL. beforeunload + unmount both fire navigator.sendBeacon (a normal POST would be
  // cancelled on unload). Guarded on actually holding the lock; idempotent + tolerant server-side.
  useEffect(() => {
    const beacon = () => {
      const ctx = lockCtxRef.current;
      if (ctx.disabled || !heldRef.current) return;
      if (!ctx.boqId || !ctx.sheetName) return;
      try {
        const fd = new FormData();
        fd.append("boq_name", ctx.boqId);
        fd.append("sheet_name", ctx.sheetName); // VERBATIM (#152)
        const csrf = (window as unknown as { frappe?: { csrf_token?: string } })?.frappe?.csrf_token;
        if (csrf) fd.append("csrf_token", csrf);
        navigator.sendBeacon(
          "/api/method/nirmaan_stack.api.boq.wizard.draft_lock.release_draft_lock", fd,
        );
      } catch {
        /* best-effort: the lock ages out via the TTL if this fails */
      }
    };
    window.addEventListener("beforeunload", beacon);
    return () => {
      window.removeEventListener("beforeunload", beacon);
      beacon(); // release on unmount (SPA navigate-away, e.g. Back to hub) too
      heldRef.current = false;
    };
  }, []);

  const handleBack = () => navigate(`/upload-boq/hub/${boqId ?? ""}`);
  // B1: the lock banners' Reload re-reads get_draft_lock_info IN PLACE (refreshes editable/
  // lock_info + resets takenOver via the effect above).
  const handleReload = () => { void mutateLock(); };

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

  // ── B1 draft-lock derived state (after the guards -- plain consts) ──────────
  // editable=false ONLY when held FRESH by ANOTHER user (server computation). HARD READ-ONLY on
  // that OR a mid-edit takeover; folded into the config panel's <fieldset disabled> via `locked`.
  const draftEditable = draftLockData?.message?.editable ?? true;
  const draftLockInfo = draftLockData?.message?.lock_info ?? null;
  const locked = draftEditable === false || takenOver;

  // Acquire the draft lock on FIRST edit-intent (the panel's onEditIntent, fired on the first
  // genuine value-change BEFORE any save), so a second viewer flips read-only within a socket
  // round-trip -- not on a failed save. Idempotent (heldRef). A rejected acquire (someone else
  // holds it fresh) flips us to read-only via the same takeover banner. The draft WRITE endpoints
  // still enforce server-side.
  const ensureLockAcquired = () => {
    if (locksDisabledClient) return;
    if (locked) return; // already read-only (held by another / taken over)
    if (!boqId || !sheetName) return;
    if (heldRef.current) return; // already hold it
    heldRef.current = true; // optimistic (prevents a double-fire)
    void acquireDraftLock({ boq_name: boqId, sheet_name: sheetName }).catch((e) => {
      const msg = getFrappeError(e);
      heldRef.current = false; // failed -> we do NOT hold it
      if (msg.includes(DRAFT_LOCK_MARKER)) setTakenOver(true); // someone else holds it fresh
      // else: transient error -> a retry on the next edit will re-attempt.
    });
  };

  return (
    <div className="flex-1 space-y-4 max-w-6xl mx-auto pt-6 pb-10">

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

        {/* B2: BoQ-level "who else is here" presence (soft awareness; the draft lock owns correctness). */}
        <BoqPresence boqId={boqId} className="ml-auto shrink-0 self-start mt-0.5" />
      </div>

      {/* ── B1 draft-lock banners -- takeover > holder-held. The config panel itself renders
          read-only via the `locked` prop (folded into its <fieldset disabled>); this is the
          holder-naming surface. Reload re-reads get_draft_lock_info in place. ── */}
      {takenOver ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <p className="text-amber-900 dark:text-amber-100 flex-1">
            This sheet was taken over by another user. Your latest change may not be saved.
            Reload to continue.
          </p>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleReload}>
            <RefreshCw className="h-3.5 w-3.5" /> Reload
          </Button>
        </div>
      ) : draftEditable === false ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-sm">
          <Lock className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <p className="text-amber-900 dark:text-amber-100 flex-1">
            This sheet is being edited by{" "}
            <span className="font-medium">{draftLockInfo?.locked_by_name ?? "another user"}</span>.
            It is read-only until they finish.
          </p>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleReload}>
            <RefreshCw className="h-3.5 w-3.5" /> Reload
          </Button>
        </div>
      ) : null}

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
      {/* Amendment A1: on-entry directional banner (this sheet is committed + priced; a config
          change + re-parse/re-commit here will orphan that pricing). Warn-only. */}
      <DownstreamBanner boqId={boqId} sheetName={sheetName} />

      {draft && (
        <SheetConfigPanel
          key={decodedSheetName}
          boqName={boq.name}
          sheetName={decodedSheetName}
          draftConfig={draft.sheet_config}
          columnRoleMap={columnRoleMap}
          setColumnRoleMap={setColumnRoleMap}
          rows={previewRows}
          wizardStatus={draft.wizard_status}
          workPackages={sheetWorkHeaders}
          isParsing={isSheetParsing}
          locked={locked}
          onEditIntent={ensureLockAcquired}
          onSaveSuccess={() => { void mutate(); void mutateWpMap(); }}
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
        headerRow={savedHeaderRow}
        headerRowCount={savedHrc}
        areaList={areaList}
      />
    </div>
  );
};

export default SheetSpokePage;
export { SheetSpokePage as Component };
