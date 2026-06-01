/**
 * SheetSpokePage -- per-sheet spoke shell (Module 3 Slice 3b-ii).
 *
 * Scope (this slice): minimal shell only.
 *   - Back button → hub
 *   - Header: sheet name + BoQ name/version for context
 *   - SheetDataGrid (the raw-cell preview)
 *
 * Not in this slice: config sections (Section 1 rows / Section 2 areas -- Slice 3c),
 * work-package picker (Slice 3d), parse gate or mark-reviewed control.
 *
 * encode/decode: the hub navigates using encodeURIComponent(sheet_name).
 * React Router v6 useParams() auto-decodes URL params, so `sheetName` from
 * useParams is the verbatim original string -- passed to the endpoint as-is
 * (the backend does VERBATIM sheet_name matching with no trim).
 */
import { useNavigate, useParams } from "react-router-dom";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BOQsDoc } from "./boqTypes";
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
  const decodedSheetName = sheetName ?? "";

  // Display-trimmed for readability; endpoint calls use decodedSheetName directly.
  const displaySheetName = decodedSheetName.trim() || decodedSheetName;

  // Sheet label (optional) -- lookup by decoded name to match DB storage.
  const draft = boq.sheet_drafts?.find((d) => d.sheet_name === decodedSheetName);

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
      */}
      {draft && (
        <SheetConfigPanel
          key={decodedSheetName}
          boqName={boq.name}
          sheetName={decodedSheetName}
          draftConfig={draft.sheet_config}
          onSaveSuccess={() => void mutate()}
        />
      )}

      {/* ── Data grid ─────────────────────────────────────────────────────── */}
      {/*
        boq.name is the docname (e.g. "BOQ-26-00133"); decodedSheetName is the
        verbatim DB-stored name (RR auto-decoded; VERBATIM matching required).
      */}
      <SheetDataGrid boqName={boq.name} sheetName={decodedSheetName} />
    </div>
  );
};

export default SheetSpokePage;
export { SheetSpokePage as Component };
