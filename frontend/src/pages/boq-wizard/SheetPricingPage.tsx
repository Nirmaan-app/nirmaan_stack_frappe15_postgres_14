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
import { AlertTriangle, ArrowLeft, Check, Loader2, Lock, RefreshCw, Save, Sigma } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getFrappeError } from "@/utils/frappeErrors";
import type { BOQsDoc, GetPricedRowsResponse, RateCellSaveArgs } from "./boqTypes";
import { PricingGrid, deriveSaveStatus, isTakeoverError, type PricingGridHandle } from "./PricingGrid";
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

  // Slice 3b: save one rate cell (save_cell_price) + an inline save-error surface.
  const { call: saveCellPrice } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.pricing.save_cell_price",
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  // Slice 3c: force-save handle (the grid's flush), in-flight count (drives "Saving..."),
  // last-saved time (client clock), and the grid's "has unsaved drafts" signal.
  const gridRef = useRef<PricingGridHandle>(null);
  const [inFlight, setInFlight] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  // Summary panel (parent-tree amount rollups) -- pull-in, computed page-side.
  const [summaryOpen, setSummaryOpen] = useState(false);
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

  // Data derived from the priced-rows fetch.
  const rows = pricedData?.message?.rows ?? [];
  const columnDescriptors = pricedData?.message?.column_descriptors ?? [];
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

        {/* ── Slice 3c: save-status chip + force-save ───────────────────────── */}
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
      </div>

      {/* ── Single-editor lock banners (slice B) ──────────────────────────────
          Mid-edit takeover takes precedence over the load-time holder banner. A STALE
          lock returns editable===true -> NEITHER shows (silent auto-takeover on first
          save). The holder banner shows ONLY when editable===false (truly blocked). */}
      {takenOver ? (
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

      {/* ── Editor note ───────────────────────────────────────────────────────
          Muted-strip convention (mirrors the review screen). Slice 3b: rates are
          editable; amounts shown are qty x rate (display-only). */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/30 border border-border text-xs text-muted-foreground flex-wrap">
        <span>
          Enter a rate in any rate cell. It auto-saves a second after you stop typing (or on
          Enter / click away / arrow-move) -- or press &ldquo;Save now&rdquo;. Amounts shown
          are qty x rate (display-only); priced cells are marked. Rates only are editable.
        </span>
      </div>

      {/* ── Inline save error (a save throw surfaces here; the cell keeps your input). */}
      {saveError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-destructive/40 bg-destructive/10 text-xs text-destructive flex-wrap">
          <span>{saveError}</span>
        </div>
      )}

      {/* ── Summary panel (top-down, grid-aligned, fixed-height, internal scroll) ──
          Opens ABOVE the grid; computed page-side from the same rows + descriptors the
          grid renders (no new backend call). The grid stays usable below. */}
      {summaryOpen && !pricedLoading && !pricedError && (
        <SummaryPanel
          rows={rows}
          columnDescriptors={columnDescriptors}
          sheetName={displaySheetName}
          onClose={() => setSummaryOpen(false)}
        />
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

      {!pricedLoading && !pricedError && (
        <PricingGrid
          ref={gridRef}
          rows={rows}
          columnDescriptors={columnDescriptors}
          // Hard read-only: withhold the save fn when locked -> every grid edit gate (the
          // single onSaveRate root gate) collapses to the read-only render.
          onSaveRate={locked ? undefined : handleSaveRate}
          onDirtyChange={setHasUnsaved}
          editable={editable}
          lockInfo={lockInfo}
        />
      )}
    </div>
  );
};

export default SheetPricingPage;
export { SheetPricingPage as Component };
