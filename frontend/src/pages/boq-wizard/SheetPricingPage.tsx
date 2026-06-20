/**
 * SheetPricingPage -- READ-ONLY committed-pricing page for one BoQ sheet (Phase 5 Slice 3a).
 *
 * The first on-screen pricing surface. Shell mirrors SheetReviewPage:
 *   - useParams for boqId + sheetName (React Router v6 auto-decodes -> verbatim sheet_name).
 *   - useFrappeGetDoc for the BOQs header (boq_name, version).
 *   - useFrappeGetCall for get_priced_rows (committed rows + merged saved prices).
 *   - Full-page spinner while the BOQs doc loads; inline loading/error for the grid.
 *   - Back nav to /upload-boq/hub/:boqId (entity-id convention, never navigate(-1)).
 *
 * 3a scope (read-only): renders PricingGrid (committed rows + priced/un-priced markers).
 * NO Save / Export / Finalize (nothing to save read-only -- those arrive at 3c/5). NO
 * inline editing (3b). editable / lock_info are read from the payload and threaded into
 * the grid INERT -- the future single-editor-lock hook (3b); no lock logic exists yet.
 */
import { useNavigate, useParams } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDoc } from "frappe-react-sdk";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BOQsDoc, GetPricedRowsResponse } from "./boqTypes";
import { PricingGrid } from "./PricingGrid";

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
  const { data: pricedData } = useFrappeGetCall<{ message: GetPricedRowsResponse }>(
    "nirmaan_stack.api.boq.wizard.pricing.get_priced_rows",
    { boq_name: boqId ?? "", sheet_name: sheetName ?? "" },
    boqId && sheetName ? undefined : null,
  );

  // RR v6 auto-decodes path params -- sheetName is the verbatim DB-stored string.
  const decodedSheetName = sheetName ?? "";
  const displaySheetName = decodedSheetName.trim() || decodedSheetName;

  // Back nav: semantic entity-id route (survives hard refresh -- never navigate(-1)).
  const handleBack = () => navigate(`/upload-boq/hub/${boqId ?? ""}`);

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

  return (
    <div className="flex-1 space-y-4 max-w-5xl mx-auto pt-6 pb-10 px-4">
      {/* ── Header strip (Back + title only -- read-only, no Save/Export) ─────── */}
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
      </div>

      {/* ── Read-only note ────────────────────────────────────────────────────
          Mirrors the review screen's muted-strip convention; sets the read-only
          expectation (inline rate editing arrives at Slice 3b). */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/30 border border-border text-xs text-muted-foreground flex-wrap">
        <span>
          Read-only view of the committed sheet with current saved rates. Cells with a
          saved price are marked; entering rates is coming next.
        </span>
      </div>

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
          rows={rows}
          columnDescriptors={columnDescriptors}
          editable={editable}
          lockInfo={lockInfo}
        />
      )}
    </div>
  );
};

export default SheetPricingPage;
export { SheetPricingPage as Component };
