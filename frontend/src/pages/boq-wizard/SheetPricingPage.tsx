/**
 * SheetPricingPage -- committed-pricing page for one BoQ sheet (Phase 5 Slice 3a -> 3b -> 3c).
 *
 * Shell mirrors SheetReviewPage:
 *   - useParams for boqId + sheetName (React Router v6 auto-decodes -> verbatim sheet_name).
 *   - useFrappeGetDoc for the BOQs header (boq_name, version).
 *   - useFrappeGetCall for get_priced_rows (committed rows + merged saved prices) + its mutate.
 *   - Full-page spinner while the BOQs doc loads; inline loading/error for the grid.
 *   - Back nav to /upload-boq/hub/:boqId (entity-id convention, never navigate(-1)).
 *
 * Slice 3b: owns onSaveRate -- the grid hands up a rate cell's identity, the page fills
 * boq/sheet/committed_version + the rate, POSTs save_cell_price, then mutate()-refetches
 * (priced_* markers re-derive authoritatively). RATES ONLY are editable; amounts are
 * display-only (qty x rate, never persisted).
 *
 * Slice 3c: onSaveRate also tracks an IN-FLIGHT count (drives "Saving...") + a client-clock
 * lastSavedAt ("Saved as of HH:MM"); the grid debounce-auto-saves (1s) + exposes an
 * imperative flush() the header "Save now" button calls, and an onDirtyChange signal driving
 * "Unsaved changes". The save MECHANISM is unchanged. The single-editor lock is a later slice
 * (editable / lock_info stay INERT -- read from the payload, threaded into the grid, no lock).
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDoc, useFrappePostCall } from "frappe-react-sdk";
import { AlertTriangle, ArrowLeft, Check, ClipboardList, Loader2, Lock, RefreshCw, Save, Sigma, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { getFrappeError } from "@/utils/frappeErrors";
import type {
  AmountFormulaSaveArgs,
  BOQsDoc,
  ColorSaveArgs,
  CommittedSheetGridResponse,
  GetCommittedStateResponse,
  GetPricedRowsResponse,
  RateCellSaveArgs,
  RemarkSaveArgs,
} from "./boqTypes";
import {
  PricingGrid,
  deriveSaveStatus,
  isGridOnlySheet,
  isTakeoverError,
  orderCommittedSheets,
  type PricingGridHandle,
} from "./PricingGrid";
import { SheetDataGrid } from "./SheetDataGrid";
import { SummaryPanel } from "./SummaryPanel";

// Slice 3c: "saved as of" uses the CLIENT clock at save-success (save_cell_price returns no
// timestamp). HH:MM, mirroring SheetReviewPage's fmtSavedTime shape (client-clock seeded).
function fmtSavedTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const SheetPricingPage = () => {
  const { boqId, sheetName } = useParams<{ boqId: string; sheetName: string }>();
  const navigate = useNavigate();

  // BOQs doc: header info (boq_name, version). Third arg null disables until boqId is
  // present (useFrappeGetDoc swrKey gotcha).
  const { data: boq, isLoading } = useFrappeGetDoc<BOQsDoc>(
    "BOQs",
    boqId ?? "",
    boqId ? undefined : null,
  );

  // Priced rows: committed rows + merged saved prices for (boqId, sheetName).
  // GET-capable endpoint, SWR-managed. Loading: data === undefined. Error: data === null.
  // mutate() refetches after a rate save -> the priced_* markers re-derive authoritatively.
  const { data: pricedData, mutate } = useFrappeGetCall<{ message: GetPricedRowsResponse }>(
    "nirmaan_stack.api.boq.wizard.pricing.get_priced_rows",
    { boq_name: boqId ?? "", sheet_name: sheetName ?? "" },
    boqId && sheetName ? undefined : null,
  );

  // In-editor sheet tabs (slice 3d): the SAME BoQ's committed sheets for the tab strip.
  // Fetched in the page (a light single get_all read -- the SAME endpoint the hub uses);
  // disabled until boqId is present (swrKey gotcha). Ordered by sheet_order (workbook
  // order) below via the pure orderCommittedSheets helper.
  const { data: committedStateData } = useFrappeGetCall<{ message: GetCommittedStateResponse }>(
    "nirmaan_stack.api.boq.wizard.commit_gate.get_committed_state",
    { boq_name: boqId ?? "" },
    boqId ? undefined : null,
  );

  // General-specs faithful-grid fork: a GRID-ONLY (general-specs) committed sheet commits a
  // faithful grid with ZERO nodes, so the node-based get_priced_rows renders it empty. Detect
  // it via the EXPLICIT sheet_disposition discriminator (NOT by inferring "empty rows"). The
  // lookup fails to FALSE in the indeterminate (committed-state still loading) window, so a
  // data sheet never briefly renders as grid-only -- it stays on the normal pricing path until
  // the disposition is positively known.
  const isGridOnly = isGridOnlySheet(
    committedStateData?.message?.committed_state ?? [],
    sheetName ?? "",
  );
  // commit_version comes from get_priced_rows (it carries it for BOTH dispositions -- a
  // grid-only sheet still has a current committed BoQ Sheet). The faithful-grid fetch is
  // disabled until it's a known grid-only sheet WITH a version.
  const commitVersionForGrid = pricedData?.message?.commit_version ?? null;
  const { data: gridData } = useFrappeGetCall<{ message: CommittedSheetGridResponse }>(
    "nirmaan_stack.api.boq.wizard.pricing.get_committed_sheet_grid",
    {
      boq_name: boqId ?? "",
      sheet_name: sheetName ?? "", // VERBATIM (#152)
      committed_version: commitVersionForGrid ?? 0,
    },
    isGridOnly && boqId && sheetName && commitVersionForGrid !== null ? undefined : null,
  );

  // Slice 3b: save one rate cell (save_cell_price) + an inline save-error surface.
  const { call: saveCellPrice } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.pricing.save_cell_price",
  );
  // Slice 4a: the annotation saves (parallel to the rate save -- a separate write path).
  const { call: saveRowRemark } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.pricing.save_row_remark",
  );
  const { call: saveCellColor } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.pricing.save_cell_color",
  );
  // Formula Builder F3: save one amount-column formula (save_amount_formula). A SEPARATE
  // write path (parallel to rates/annotations); withheld when locked so headers render
  // read-only. Does NOT touch the amount-cell compute path (that is F4).
  const { call: saveAmountFormula } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.pricing.save_amount_formula",
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  // Slice 4a: the minimal review-list strip (rows with a remark), opened above the grid.
  const [reviewOpen, setReviewOpen] = useState(false);

  // Slice 3c: force-save handle (the grid's flush), in-flight count (drives "Saving..."),
  // last-saved time (client clock), and the grid's "has unsaved drafts" signal.
  const gridRef = useRef<PricingGridHandle>(null);
  const [inFlight, setInFlight] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  // Summary panel (parent-tree amount rollups) -- pull-in, computed page-side.
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Priceability override (Slice 3e, per-sheet per-session). Default OFF: a rate cell is
  // editable ONLY on a priceable row (node_type Preamble / Line Item). When ON, it unlocks
  // editing on non-priceable rows for THIS sheet THIS session AND sends allow_non_priceable
  // to save_cell_price so the server accepts those writes. Resets per sheet (below).
  const [override, setOverride] = useState(false);
  // Single-editor lock (slice B): a mid-edit takeover (a save rejected with the
  // BOQ_PRICING_LOCKED marker -- another user acquired the lock) flips this true; the page
  // becomes read-only + shows the takeover banner until a fresh editable payload arrives.
  const [takenOver, setTakenOver] = useState(false);

  // Reset the takeover flag whenever a FRESH get_priced_rows payload reports the sheet
  // editable (a Reload re-read found it free / mine / stale). Keyed on the payload identity
  // so it fires on EVERY refetch -- an [editable] dep would miss a true->true no-change.
  useEffect(() => {
    if (pricedData?.message && (pricedData.message.editable ?? true)) {
      setTakenOver(false);
    }
  }, [pricedData]);

  // Slice 3d: page per-sheet state reset on a tab switch. The PAGE does NOT remount on a
  // pricing->pricing route change (same route element), so its sheet-specific state would
  // carry stale into the new sheet. Reset it when :sheetName changes. The grid itself is
  // key-remounted on sheetName (drafts flush-on-unmount to the OLD sheet, the new grid
  // starts clean), and hasUnsaved re-derives from the remounted grid's onDirtyChange.
  // inFlight is DELIBERATELY NOT reset: a flush-on-unmount save from the old grid
  // increments/decrements it in a pair, so a hard reset to 0 would underflow when that
  // in-flight save's finally runs (and "Saving..." on the new sheet during the flush is
  // honest -- a save IS in flight).
  useEffect(() => {
    setSaveError(null);
    setLastSavedAt(null);
    setTakenOver(false);
    setSummaryOpen(false);
    setOverride(false); // Slice 3e: the override is per-sheet per-session -- reset on switch
    setReviewOpen(false); // Slice 4a: the review-list strip is per-sheet
  }, [sheetName]);

  // RR v6 auto-decodes path params -- sheetName is the verbatim DB-stored string.
  const decodedSheetName = sheetName ?? "";
  const displaySheetName = decodedSheetName.trim() || decodedSheetName;

  // Back nav: semantic entity-id route (survives hard refresh -- never navigate(-1)).
  const handleBack = () => navigate(`/upload-boq/hub/${boqId ?? ""}`);
  // Lock banners' Reload: re-read get_priced_rows IN PLACE (refreshes editable/lock_info +
  // resets takenOver via the effect above) -- preferred over a full window reload.
  const handleReload = () => {
    void mutate();
  };

  // ── Full-page spinner while the BOQs doc loads ──────────────────────────────
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── Not-found state ─────────────────────────────────────────────────────────
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

  // ── Missing sheet name in URL (routing guarantees it, but be defensive) ─────
  if (!sheetName) {
    return <p className="p-6 text-sm text-destructive">Missing sheet identifier in URL.</p>;
  }

  // Slice 3d: the BoQ's committed sheets in workbook order (sheet_order), for the tab
  // strip. Empty while the list loads -> the strip renders nothing (the grid never waits
  // on it). The active tab is the current :sheetName (matched VERBATIM, #152).
  const committedSheets = orderCommittedSheets(committedStateData?.message?.committed_state ?? []);

  // Data derived from the priced-rows fetch.
  const rows = pricedData?.message?.rows ?? [];
  const columnDescriptors = pricedData?.message?.column_descriptors ?? [];
  const columnFormulas = pricedData?.message?.column_formulas ?? []; // F3: per-column amount formulas
  const commitVersion = pricedData?.message?.commit_version ?? null;
  // RESERVED for the future single-editor-lock slice (3b) -- inert in 3a. Threaded into the
  // grid so 3b can gate inline edit on them without reshaping the contract.
  const editable = pricedData?.message?.editable ?? true;
  const lockInfo = pricedData?.message?.lock_info ?? null;
  const pricedLoading = pricedData === undefined;
  const pricedError = pricedData === null;
  // HARD READ-ONLY when held FRESH by another user (backend editable===false) OR after a
  // mid-edit takeover. Withholding onSaveRate collapses ALL of the grid's edit gates (the
  // single onSaveRate root gate) to the read-only render -- no per-cell editable check.
  const locked = editable === false || takenOver;

  // Slice 3b: the page-owned save. The grid hands up the cell identity; the page fills
  // boq / sheet / committed_version + the rate, POSTs save_cell_price, then mutate()-refetches
  // so the priced_* markers re-derive (no client-side marker logic). On throw it surfaces the
  // error inline AND re-throws so the grid keeps the optimistic draft (the user's input).
  const handleSaveRate = async (cell: RateCellSaveArgs, rate: number) => {
    if (commitVersion === null) {
      setSaveError("This sheet has no committed version to price.");
      throw new Error("no committed version");
    }
    setSaveError(null);
    setInFlight((n) => n + 1); // Slice 3c: drives the "Saving..." status
    try {
      await saveCellPrice({
        boq_name: boqId, // VERBATIM
        sheet_name: sheetName, // VERBATIM -- trailing spaces intact (#152)
        excel_row: cell.excelRow,
        col_letter: cell.colLetter,
        committed_version: commitVersion,
        rate,
        area: cell.area, // omitted by the SDK when undefined (scalar path)
        rate_kind: cell.rateKind,
        description: cell.description, // copy-forward MATCH GUARD
        allow_non_priceable: override, // Slice 3e: the asserted per-sheet override
      });
      await mutate();
      setLastSavedAt(new Date()); // Slice 3c: client-clock "saved as of"
    } catch (e: unknown) {
      const msg = getFrappeError(e);
      if (isTakeoverError(msg)) {
        // Mid-edit takeover (next-save-only): another user acquired the lock. Flip to
        // read-only via the takeover banner (the grid keeps the draft -- it just can't be
        // saved). The banner is the surface, so we do NOT also raise the generic error strip.
        setTakenOver(true);
      } else {
        setSaveError(msg || "Could not save the rate. Please try again.");
      }
      throw e; // let the grid keep the optimistic draft
    } finally {
      setInFlight((n) => n - 1);
    }
  };

  // Slice 4a: save one row's remark (save_row_remark) -- a SEPARATE write path from rates,
  // mirroring handleSaveRate (in-flight count, takeover detection, mutate refresh). Blank
  // remark clears (backend). The grid renders read-only when this is withheld (locked).
  const handleSaveRemark = async (args: RemarkSaveArgs) => {
    if (commitVersion === null) {
      setSaveError("This sheet has no committed version to annotate.");
      throw new Error("no committed version");
    }
    setSaveError(null);
    setInFlight((n) => n + 1);
    try {
      await saveRowRemark({
        boq_name: boqId, // VERBATIM
        sheet_name: sheetName, // VERBATIM (#152)
        excel_row: args.excelRow,
        committed_version: commitVersion,
        remark: args.remark,
        description: args.description,
      });
      await mutate();
      setLastSavedAt(new Date());
    } catch (e: unknown) {
      const msg = getFrappeError(e);
      if (isTakeoverError(msg)) setTakenOver(true);
      else setSaveError(msg || "Could not save the remark. Please try again.");
      throw e;
    } finally {
      setInFlight((n) => n - 1);
    }
  };

  // Slice 4a: save N color cells (a single pick = 1, an apply-to-row = N) then ONE mutate.
  // The grid builds the cell list; the page owns the POSTs + the refetch. Blank color clears.
  const handleSaveColor = async (argsList: ColorSaveArgs[]) => {
    if (commitVersion === null) {
      setSaveError("This sheet has no committed version to annotate.");
      throw new Error("no committed version");
    }
    if (argsList.length === 0) return;
    setSaveError(null);
    setInFlight((n) => n + 1);
    try {
      for (const args of argsList) {
        await saveCellColor({
          boq_name: boqId, // VERBATIM
          sheet_name: sheetName, // VERBATIM (#152)
          excel_row: args.excelRow,
          col_letter: args.colLetter,
          committed_version: commitVersion,
          color: args.color,
          description: args.description,
        });
      }
      await mutate();
      setLastSavedAt(new Date());
    } catch (e: unknown) {
      const msg = getFrappeError(e);
      if (isTakeoverError(msg)) setTakenOver(true);
      else setSaveError(msg || "Could not save the color. Please try again.");
      throw e;
    } finally {
      setInFlight((n) => n - 1);
    }
  };

  // Formula Builder F3: save one amount-column formula (save_amount_formula) then mutate so
  // column_formulas refetches + the header label updates. Mirrors handleSaveColor (in-flight,
  // takeover, mutate). The tree is sent as a JSON string; a null formula -> "" (the F1 clear
  // path). Withheld when locked (the grid then renders the header label read-only).
  const handleSaveFormula = async (args: AmountFormulaSaveArgs) => {
    if (commitVersion === null) {
      setSaveError("This sheet has no committed version to add a formula to.");
      throw new Error("no committed version");
    }
    setSaveError(null);
    setInFlight((n) => n + 1);
    try {
      await saveAmountFormula({
        boq_name: boqId, // VERBATIM
        sheet_name: sheetName, // VERBATIM (#152)
        committed_version: commitVersion,
        target_value_field: args.targetValueField,
        target_value_key: args.targetValueKey, // null = the area-wildcard default / scalar
        target_rate_subkey: args.targetRateSubkey,
        formula: args.formula === null ? "" : JSON.stringify(args.formula), // "" = clear
        target_col: args.targetCol,
        description: args.description,
      });
      await mutate();
      setLastSavedAt(new Date());
    } catch (e: unknown) {
      const msg = getFrappeError(e);
      if (isTakeoverError(msg)) setTakenOver(true);
      else setSaveError(msg || "Could not save the formula. Please try again.");
      throw e;
    } finally {
      setInFlight((n) => n - 1);
    }
  };

  // Slice 4a: the review-list feed -- rows that carry a remark, derived page-side from the
  // rows already in hand (no new fetch). A GENERIC review-entry shape ({kind, excelRow,
  // description, text}) so the 4b flag layer can push computed flags into the SAME list.
  const remarkEntries = rows
    .filter((r) => r.remark && r.remark.trim())
    .map((r) => ({
      kind: "remark" as const,
      excelRow: r.source_row_number,
      description: r.description ?? "",
      text: (r.remark as string).trim(),
    }));

  // Slice 3c: the save-status chip state (pure derive) + force-save flush.
  const saveStatus = deriveSaveStatus({
    inFlight,
    hasUnsaved,
    hasSaved: lastSavedAt !== null,
    hasError: saveError !== null,
  });

  return (
    <div className="flex-1 space-y-4 max-w-5xl mx-auto pt-6 pb-10 px-4">
      {/* ── Header strip (Back + title + Slice-3c save status + Save now) ─────── */}
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
            {boq.boq_name} &middot; V{boq.version ?? 1} &middot; Pricing
            {commitVersion !== null && (
              <span className="text-muted-foreground/70"> &middot; committed v{commitVersion}</span>
            )}
          </p>
          <h1 className="text-lg font-semibold text-foreground truncate leading-tight">
            {displaySheetName}
          </h1>
        </div>

        {/* ── Slice 3c: save-status chip + force-save ─────────────────────────
            SUPPRESSED for a grid-only (general-specs) sheet -- it is read-only
            reference, nothing to save, summarize, or flush. */}
        {!isGridOnly && (
        <div className="ml-auto shrink-0 flex items-center gap-3 mt-0.5">
          <div className="flex items-center gap-1.5 text-xs">
            {saveStatus === "saving" && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving&hellip;
              </span>
            )}
            {saveStatus === "saved" && lastSavedAt && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                Saved as of {fmtSavedTime(lastSavedAt)}
              </span>
            )}
            {saveStatus === "unsaved" && (
              <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                Unsaved changes
              </span>
            )}
            {saveStatus === "failed" && (
              <span className="flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                Save failed
              </span>
            )}
            {saveStatus === "idle" && (
              <span className="text-muted-foreground">All changes saved</span>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setSummaryOpen((o) => !o)}
            disabled={pricedLoading || pricedError || rows.length === 0}
            title="Toggle the parent-tree amount summary"
          >
            <Sigma className="h-4 w-4" />
            Summary
          </Button>
          {/* Slice 4a: the review-list toggle (rows with a remark). */}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setReviewOpen((o) => !o)}
            disabled={pricedLoading || pricedError}
            title="Rows flagged for review (rows with a remark)"
          >
            <ClipboardList className="h-4 w-4" />
            Review{remarkEntries.length > 0 ? ` (${remarkEntries.length})` : ""}
          </Button>
          {/* Slice 3e: the priceability OVERRIDE toggle (per-sheet, per-session). A loaded
              gun -- its ON state is loudly amber so the user always sees it is on. Default
              off. Suppressed for grid-only (handled by the !isGridOnly cluster gate). */}
          <Button
            size="sm"
            variant={override ? "default" : "outline"}
            className={cn(
              "gap-1.5",
              override &&
                "bg-amber-500 text-white hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700",
            )}
            aria-pressed={override}
            onClick={() => setOverride((o) => !o)}
            title={
              override
                ? "Pricing any row is ON -- non-line-item cells are editable; priced ones are flagged for review. Click to turn off."
                : "Allow pricing rows that aren't line items (notes, spacers). Off by default."
            }
          >
            {override ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            {override ? "Pricing any row" : "Price any row"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => gridRef.current?.flush()}
            title="Flush any pending edits and save now"
          >
            <Save className="h-4 w-4" />
            Save now
          </Button>
        </div>
        )}
      </div>

      {/* ── Single-editor lock banners (slice B) ──────────────────────────────
          Mid-edit takeover takes precedence over the load-time holder banner. A STALE
          lock returns editable===true -> NEITHER shows (silent auto-takeover on first
          save). The holder banner shows ONLY when editable===false (truly blocked).
          SUPPRESSED entirely for a grid-only sheet (no editing -> no lock). */}
      {isGridOnly ? null : takenOver ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <p className="text-amber-900 dark:text-amber-100 flex-1">
            This sheet was taken over by another user. Your latest change was not saved.
            Reload to continue.
          </p>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleReload}>
            <RefreshCw className="h-3.5 w-3.5" /> Reload
          </Button>
          <Button size="sm" variant="ghost" onClick={handleBack}>
            Go to hub
          </Button>
        </div>
      ) : editable === false ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-sm">
          <Lock className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <p className="text-amber-900 dark:text-amber-100 flex-1">
            This sheet is being priced by{" "}
            <span className="font-medium">{lockInfo?.locked_by_name ?? "another user"}</span>.
            It is read-only until they finish.
          </p>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleReload}>
            <RefreshCw className="h-3.5 w-3.5" /> Reload
          </Button>
          <Button size="sm" variant="ghost" onClick={handleBack}>
            Go to hub
          </Button>
        </div>
      ) : null}

      {/* ── In-editor sheet tabs (slice 3d) ───────────────────────────────────
          Switch to another COMMITTED sheet of the SAME BoQ without going out to the
          hub. Workbook order (sheet_order); active tab = the current :sheetName
          (VERBATIM, #152); label = the trimmed display name. A tab change navigates to
          that sheet's editor (the hub's exact nav target) -> the route re-runs + the
          key-remounted grid (below) flushes the old drafts and starts clean. The list
          loads independently -- the strip simply doesn't render until it arrives. */}
      {committedSheets.length > 0 && (
        <Tabs
          value={decodedSheetName}
          onValueChange={(val) => {
            if (val !== decodedSheetName) {
              navigate(`/upload-boq/hub/${boqId ?? ""}/pricing/${encodeURIComponent(val)}`);
            }
          }}
        >
          <TabsList className="flex flex-wrap h-auto justify-start gap-1">
            {committedSheets.map((s) => (
              <TabsTrigger key={s.sheet_name} value={s.sheet_name} className="max-w-[16rem] truncate">
                {s.sheet_name.trim() || s.sheet_name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {/* ── Editor note ───────────────────────────────────────────────────────
          Muted-strip convention (mirrors the review screen). For a grid-only
          general-specs sheet it is a read-only reference note; otherwise the Slice-3b
          rate-editing note. */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/30 border border-border text-xs text-muted-foreground flex-wrap">
        {isGridOnly ? (
          <span>
            This is a general-specifications sheet -- read-only reference. There is nothing to
            price here.
          </span>
        ) : (
          <span>
            Enter a rate in any rate cell. It auto-saves a second after you stop typing (or on
            Enter / click away / arrow-move) -- or press &ldquo;Save now&rdquo;. Amounts shown
            are qty x rate (display-only); priced cells are marked. Rates only are editable.
          </span>
        )}
      </div>

      {/* ── Slice 3e: override-on banner (loud, amber -- the override is a loaded gun). */}
      {!isGridOnly && override && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-900 dark:text-amber-100 flex-wrap">
          <Unlock className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-300" />
          <span>
            Pricing any row is on: non-line-item rows (notes / spacers) are editable. A rate
            saved on one is flagged amber for review.
          </span>
        </div>
      )}

      {/* ── Inline save error (a save throw surfaces here; the cell keeps your input). */}
      {!isGridOnly && saveError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-destructive/40 bg-destructive/10 text-xs text-destructive flex-wrap">
          <span>{saveError}</span>
        </div>
      )}

      {/* ── Summary panel (top-down, grid-aligned, fixed-height, internal scroll) ──
          Opens ABOVE the grid; computed page-side from the same rows + descriptors the
          grid renders (no new backend call). The grid stays usable below. */}
      {!isGridOnly && summaryOpen && !pricedLoading && !pricedError && (
        <SummaryPanel
          rows={rows}
          columnDescriptors={columnDescriptors}
          columnFormulas={columnFormulas}
          sheetName={displaySheetName}
          onClose={() => setSummaryOpen(false)}
        />
      )}

      {/* ── Slice 4a: review-list strip (rows with a remark) ─────────────────────
          Opened ABOVE the grid (mirrors the Summary panel mount). A GENERIC review-entry
          list -- 4a's feed is "rows with a remark"; 4b adds computed flags to the SAME
          list. Each entry click-jumps to the row via the grid's scrollToRow handle. */}
      {!isGridOnly && reviewOpen && !pricedLoading && !pricedError && (
        <div className="rounded-md border border-border bg-muted/20">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-medium text-foreground">
              Review list &middot; rows with a remark ({remarkEntries.length})
            </p>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setReviewOpen(false)}>
              Close
            </Button>
          </div>
          {remarkEntries.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              No remarks yet. Add a note on any row to flag it for review.
            </p>
          ) : (
            <ul className="max-h-[30vh] divide-y divide-border overflow-auto">
              {remarkEntries.map((e) => (
                <li key={`${e.kind}:${e.excelRow}`}>
                  <button
                    type="button"
                    onClick={() => gridRef.current?.scrollToRow(e.excelRow)}
                    className="w-full px-3 py-2 text-left hover:bg-muted/40"
                  >
                    <span className="mr-2 font-mono text-xs text-muted-foreground">Row {e.excelRow}</span>
                    <span className="text-xs text-foreground">{e.description || "(no description)"}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-amber-700 dark:text-amber-400">
                      {e.text}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Grid ──────────────────────────────────────────────────────────────── */}
      {pricedLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {pricedError && (
        <p className="text-sm text-destructive">
          Failed to load pricing rows. Check that this sheet has been committed and try again.
        </p>
      )}

      {/* ── Render fork: grid-only -> faithful read-only grid; else the pricing grid.
          We wait for pricedData (it carries commit_version, which the faithful-grid fetch
          needs) before either render. */}
      {!pricedLoading && !pricedError && (
        isGridOnly ? (
          <SheetDataGrid
            // Faithful committed grid (general specs) -- READ-ONLY reference, all rows at
            // once (pagination stubbed). Reuses SheetDataGrid as-is; falls back to raw Excel
            // column letters when the config maps are empty (a general-specs sheet has none).
            rows={gridData?.message?.rows ?? []}
            hasMore={false}
            isInitLoading={gridData === undefined}
            initError={gridData === null ? "Failed to load the sheet grid." : null}
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
            // Slice 3d: key on the VERBATIM sheetName so a tab switch UNMOUNTS+REMOUNTS the
            // grid -- the existing flush-on-unmount commits the OLD sheet's pending drafts to
            // the OLD sheet, and the NEW sheet gets a clean grid (empty draftRates/proposed).
            key={sheetName}
            ref={gridRef}
            rows={rows}
            columnDescriptors={columnDescriptors}
            // Hard read-only: withhold the save fn when locked -> every grid edit gate (the
            // single onSaveRate root gate) collapses to the read-only render.
            onSaveRate={locked ? undefined : handleSaveRate}
            // Slice 4a: annotation saves gated on the SAME editability signal as rates --
            // withheld when locked/taken-over so the grid renders remarks/colors read-only.
            onSaveRemark={locked ? undefined : handleSaveRemark}
            onSaveColor={locked ? undefined : handleSaveColor}
            // F3: the amount-column formula header label + builder. columnFormulas drives the
            // `f = ...` label; onSaveFormula is withheld when locked (header renders read-only).
            columnFormulas={columnFormulas}
            onSaveFormula={locked ? undefined : handleSaveFormula}
            onDirtyChange={setHasUnsaved}
            override={override}
            editable={editable}
            lockInfo={lockInfo}
          />
        )
      )}
    </div>
  );
};

export default SheetPricingPage;
export { SheetPricingPage as Component };
