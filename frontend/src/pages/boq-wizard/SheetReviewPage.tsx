/**
 * SheetReviewPage -- read-only review screen for a parsed BoQ sheet (Slice B1).
 *
 * Shell structure mirrors SheetSpokePage:
 *   - useParams for boqId + sheetName (React Router v6 auto-decodes).
 *   - useFrappeGetDoc for the BOQs header (boq_name, version).
 *   - useFrappeGetCall for get_review_rows (all parsed rows for this sheet).
 *   - Full-page spinner while BOQs doc loads; inline loading/error for rows.
 *   - Back nav to /upload-boq/hub/:boqId (entity-id convention, never navigate(-1)).
 *
 * B1 scope (read-only spine):
 *   - Renders ReviewTree (nesting tree from effective_parent_index chain walk).
 *   - No flag overlays, no row-detail panel (B2).
 *   - No editing affordances, no mark-as-done wiring (C/D).
 */
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDoc } from "frappe-react-sdk";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BOQsDoc, GetReviewRowsResponse } from "./boqTypes";
import { ReviewTree } from "./ReviewTree";

// C-v2: format the save-anchor timestamp. edited_at is the server-local naive
// string from frappe.utils.now() ("YYYY-MM-DD HH:MM:SS.ffffff"); parse as local.
function fmtSavedTime(iso: string): string {
  try {
    const d = new Date(iso.replace(" ", "T"));
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

const SheetReviewPage = () => {
  const { boqId, sheetName } = useParams<{ boqId: string; sheetName: string }>();
  const navigate = useNavigate();

  // BOQs doc: header info (boq_name, version). Same pattern as SheetSpokePage.
  // Third arg null disables until boqId is present (useFrappeGetDoc swrKey gotcha).
  const { data: boq, isLoading } = useFrappeGetDoc<BOQsDoc>(
    "BOQs",
    boqId ?? "",
    boqId ? undefined : null,
  );

  // Review rows: all parsed BoQ Review Rows for (boqId, sheetName).
  // useFrappeGetCall -- GET-capable endpoint, SWR-managed, no accumulation needed.
  // Loading: data === undefined (key enabled). Error: data === null.
  const { data: reviewData, mutate } = useFrappeGetCall<{ message: GetReviewRowsResponse }>(
    "nirmaan_stack.api.boq.wizard.review_screen.get_review_rows",
    { boq_name: boqId ?? "", sheet_name: sheetName ?? "" },
    // Disable until both params are present (routing guarantees them, but be defensive).
    boqId && sheetName ? undefined : null,
  );

  // C-v2: sheet-level save-status anchor. Set from each resolved save's returned
  // edited_at for an instant update (does not wait for the get_review_rows refetch).
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  // C-v2: after a value edit saves, advance the anchor + refresh the grid so the
  // row flips to "Edited" (green tint) and its edit history gains an entry.
  const handleSaved = (editedAt: string) => {
    setLastSavedAt(editedAt);
    void mutate();
  };

  // RR v6 auto-decodes path params -- sheetName is the verbatim DB-stored string.
  const decodedSheetName = sheetName ?? "";
  const displaySheetName = decodedSheetName.trim() || decodedSheetName;

  // Back nav: semantic entity-id route -- never navigate(-1) (survives hard refresh).
  const handleBack = () => navigate(`/upload-boq/hub/${boqId ?? ""}`);

  // ── Full-page spinner while BOQs doc loads ──────────────────────────────────
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
    return (
      <p className="p-6 text-sm text-destructive">Missing sheet identifier in URL.</p>
    );
  }

  // Row data derived from the review-rows fetch.
  const rows = reviewData?.message?.rows ?? [];
  const columnDescriptors = reviewData?.message?.column_descriptors ?? [];
  const flags = reviewData?.message?.flags ?? [];
  const reviewLoading = reviewData === undefined;
  const reviewError = reviewData === null;

  // OBS-2: per-category flag counts for the summary strip.
  const FLAG_LABELS: Record<string, string> = {
    zero_amount_line_item: "zero-amount",
    orphan: "orphan",
    parser: "needs-review",
    priced_preamble_no_children: "priced-preamble",
  };
  const FLAG_ORDER = ["zero_amount_line_item", "orphan", "parser", "priced_preamble_no_children"];
  const flagCounts: Record<string, number> = {};
  for (const f of flags) flagCounts[f.type] = (flagCounts[f.type] ?? 0) + 1;
  // C-flag-dismissal: per-category "cleared" count = flags of this type whose row was
  // dismissed ("Looks OK") AND whose flag STILL computes (it's in the live flags array,
  // which already auto-excludes resolved conditions). Derived frontend-side from the row
  // payload's flags_dismissed -- no new backend data.
  const dismissedRowIdx = new Set(
    rows.filter(r => !!r.flags_dismissed).map(r => r.row_index),
  );
  const clearedCounts: Record<string, number> = {};
  for (const f of flags) {
    if (dismissedRowIdx.has(f.row_index)) {
      clearedCounts[f.type] = (clearedCounts[f.type] ?? 0) + 1;
    }
  }
  const flagSummaryParts = FLAG_ORDER
    .filter(t => (flagCounts[t] ?? 0) > 0)
    .map(t => {
      const cleared = clearedCounts[t] ?? 0;
      const base = `${flagCounts[t]} ${FLAG_LABELS[t]}`;
      return cleared > 0 ? `${base} – ${cleared} cleared` : base;
    });

  // C-v2c: sheet-level remarks count -- number of rows carrying a non-empty remark.
  // Single count (remarks have no sub-types); strip omitted when zero (mirrors flags).
  const remarkCount = rows.filter(
    r => typeof r.remarks === "string" && r.remarks.trim() !== "",
  ).length;

  return (
    <div className="flex-1 space-y-4 max-w-5xl mx-auto pt-6 pb-10 px-4">

      {/* ── Header strip (mirrors SheetSpokePage layout) ──────────────────── */}
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
            {boq.boq_name} &middot; V{boq.version ?? 1} &middot; Review &amp; edit
          </p>
          <h1 className="text-lg font-semibold text-foreground truncate leading-tight">
            {displaySheetName}
          </h1>
        </div>

        {/* C-v2: sheet-level save-status anchor -- reports the last auto-saved edit.
            Every confirmed edit already saved (one call = one commit); this is a
            status indicator, not a batch-save trigger. Shown once a save has landed. */}
        {lastSavedAt && (
          <div className="ml-auto shrink-0 flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
            <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
            <span>
              All changes saved
              <span className="text-muted-foreground/70"> &middot; {fmtSavedTime(lastSavedAt)}</span>
            </span>
          </div>
        )}
      </div>

      {/* ── OBS-2: Advisory flag summary strip -- shown only when flags exist ── */}
      {!reviewLoading && !reviewError && flagSummaryParts.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/30 border border-border text-xs text-muted-foreground flex-wrap">
          <span className="font-medium text-foreground">Flags:</span>
          <span>{flagSummaryParts.join(" · ")}</span>
        </div>
      )}

      {/* ── C-v2c: Remarks count strip -- mirrors the flags strip; shown only when
          at least one row carries a remark (single count, no sub-types). ── */}
      {!reviewLoading && !reviewError && remarkCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/30 border border-border text-xs text-muted-foreground flex-wrap">
          <span className="font-medium text-foreground">Remarks:</span>
          <span>{remarkCount}</span>
        </div>
      )}

      {/* ── Review rows tree ──────────────────────────────────────────────── */}
      {reviewLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {reviewError && (
        <p className="text-sm text-destructive">
          Failed to load review rows. Check that this sheet has been parsed and try again.
        </p>
      )}

      {!reviewLoading && !reviewError && (
        <ReviewTree
          rows={rows}
          columnDescriptors={columnDescriptors}
          flags={flags}
          boqName={boqId ?? ""}
          sheetName={sheetName}
          onSaved={handleSaved}
          onRemarkSaved={() => void mutate()}
          // Slice 1b-beta: a restructure IS a real edit -- reuse handleSaved (advances the
          // save anchor + mutates) via the SAME SWR revalidate path as value/text edits.
          onRestructured={handleSaved}
        />
      )}
    </div>
  );
};

export default SheetReviewPage;
export { SheetReviewPage as Component };
