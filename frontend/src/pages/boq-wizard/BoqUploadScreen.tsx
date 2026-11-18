import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeGetDoc } from "@/lib/frappe";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { BOQsDoc } from "./boqTypes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBackgroundOperation } from "@/hooks/useBackgroundOperation";
import { useBoqWizardStore, type GstChoice } from "@/zustand/useBoqWizardStore";
import { UPLOAD_METHOD, uploadOutcome, uploadedFileOf, type UploadedFile } from "./boqUploadOperation";
import { BoqDropZone } from "./BoqDropZone";
import { BoqMasterPanel } from "./BoqMasterPanel";

interface ProjectDoc {
  name: string;
  project_name: string;
  customer?: string | null;
}

// BOQsDoc is now the shared type from boqTypes.ts -- imported above.

interface BoqUploadScreenProps {
  projectId: string;
  /** A2: return to the mode chooser (in-place; no route change). When absent the footer Back
   *  navigates to the project page as before -- upload flow byte-identical for old callers. */
  onBack?: () => void;
  /** ADR-0013 D2: hosted inside BoqPickerPage's one-screen mode toggle -> suppress this
   *  component's own <h1> header + outer max-width wrapper (the host owns one header + width).
   *  Absent = renders byte-identically to the standalone screen. */
  embedded?: boolean;
}

/**
 * Two-pane upload screen (M1.4, M1.7):
 *   Left  -- BoQ file drop zone (custom file-input, M1.65).
 *   Right -- Master BoQ details panel: 6 fields (M1.17).
 *   Footer -- Back-to-project + Continue (gated by 3-part AND per M1.33-M1.36).
 *
 * Renders in-place inside BoqPickerPage when ?project=<id> is present.
 *
 * The upload's parse is a background operation (#1665, ADR 0047): this screen starts it and follows
 * its own status record through useBackgroundOperation, so each tab shows only its own upload's
 * outcome, and a reload picks a running upload up again.
 */
export function BoqUploadScreen({ projectId, onBack, embedded }: BoqUploadScreenProps) {
  const navigate = useNavigate();

  const { data: project } = useFrappeGetDoc<ProjectDoc>("Projects", projectId);

  const {
    reset,
    setSelectedProject,
    droppedFile,
    confirmedFields,
    revisionMode,
    sourceBoq,
    setDroppedFile,
    fillFromParse,
  } = useBoqWizardStore();

  // Reset transient store whenever the project changes, then register the project.
  // reset/setSelectedProject are stable Zustand action refs -- omitted from deps intentionally.
  useEffect(() => {
    reset();
    setSelectedProject(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // NOTE: 1b-ii-a boqName pre-fill from project_name intentionally removed.
  // Per §4.1 clarification: pre-parse = blank; post-parse = pre-filled-unconfirmed.

  // Declared after the reset effect above, so a reload's resume runs after that reset.
  const upload = useBackgroundOperation({
    storageKey: `boq_upload:${projectId}`,
    // The outcome is read from `upload.view` below; nothing more to do when it finishes.
    onFinished: () => undefined,
  });
  const { status: uploadStatus, boqName: boqDocName, error: uploadError } = uploadOutcome(upload.view);

  // A resumed upload (after a reload) names its file through the operation's context.
  useEffect(() => {
    const file = uploadedFileOf(upload.context);
    if (file && !useBoqWizardStore.getState().droppedFile) setDroppedFile(file);
    // setDroppedFile is a stable Zustand action ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upload.context]);

  const startUpload = useCallback(
    (form: FormData, file: UploadedFile) => void upload.start(UPLOAD_METHOD, form, file),
    [upload.start]
  );

  // Fetch the BOQs doc once boqDocName is set (i.e. once the parse is done).
  // Third arg null disables SWR fetch until boqDocName is available (per sdk gotcha in CLAUDE.md).
  // mutate is the W3 re-read after an entry conversion: convert_revision_entry recomputes
  // boq_name + version server-side, and the fill effect below re-runs off the fresh doc.
  const { data: boqDoc, mutate: mutateBoqDoc } = useFrappeGetDoc<BOQsDoc>(
    "BOQs",
    boqDocName ?? "",
    boqDocName ? undefined : null
  );

  // Fill panel with real parsed values once the BOQs doc arrives post-parse.
  // fillFromParse also resets confirmedFields to false so user sees sparkle treatment.
  useEffect(() => {
    if (!boqDoc || uploadStatus !== "done") return;
    const versionStr = boqDoc.version != null ? `V${boqDoc.version}` : "V1";
    const gst: GstChoice = boqDoc.tax_treatment === "Post-tax" ? "post" : "pre";
    fillFromParse({
      boqName: boqDoc.boq_name ?? "",
      version: versionStr,
      gst,
      notes: boqDoc.notes ?? "",
    });
    // fillFromParse is a stable Zustand action ref -- omitted from deps intentionally
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boqDoc, uploadStatus]);

  // ── Continue gate (M1.33-M1.36; ADR-0014 D1 adds "original selected" in Revise mode) ──
  const allConfirmed =
    confirmedFields.boqName && confirmedFields.version && confirmedFields.gst;
  // A revision must have its original picked before Continue (source_boq rides the upload).
  const needsOriginal = revisionMode === "revise" && !sourceBoq;
  const canContinue =
    droppedFile !== null && uploadStatus === "done" && allConfirmed && !needsOriginal;

  const missingItems: string[] = [];
  if (needsOriginal) missingItems.push("select the original BoQ to revise");
  if (!droppedFile) {
    missingItems.push("upload a BoQ file");
  } else if (uploadStatus !== "done" && !needsOriginal) {
    // In Revise mode the upload is held until the original is picked -- don't mislabel that
    // wait as "parsing"; the needsOriginal item already tells the user what to do.
    missingItems.push("wait for parsing to complete");
  }
  if (!confirmedFields.boqName) missingItems.push("confirm BoQ name");
  if (!confirmedFields.version) missingItems.push("confirm version");
  if (!confirmedFields.gst) missingItems.push("confirm GST treatment");

  const tooltipText =
    missingItems.length > 0
      ? `Still needed: ${missingItems.join("; ")}`
      : "All set -- click to continue";

  return (
    <div
      className={
        embedded ? "space-y-6" : "flex-1 space-y-6 max-w-4xl mx-auto pt-6 pb-10"
      }
    >
      {/* ── Header (suppressed when embedded -- host owns the one header) ──── */}
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Upload BoQ</h1>
          {project?.project_name && (
            <p className="mt-1 text-sm text-muted-foreground">{project.project_name}</p>
          )}
        </div>
      )}

      {/* ── Two-pane body ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Left -- drop zone */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">BoQ File</CardTitle>
          </CardHeader>
          <CardContent>
            <BoqDropZone
              status={uploadStatus}
              error={uploadError}
              onUpload={startUpload}
              onReset={upload.reset}
            />
          </CardContent>
        </Card>

        {/* Right -- Master BoQ details */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Master BoQ Details</CardTitle>
          </CardHeader>
          <CardContent>
            <BoqMasterPanel
              projectName={project?.project_name ?? ""}
              customer={project?.customer}
              boqDocName={boqDocName}
              // W3 entry un-lock: the panel needs the SERVER's current entry to decide
              // whether a radio/picker change is a real conversion or a no-op.
              boqOrigin={boqDoc?.origin}
              boqSourceBoq={boqDoc?.source_boq ?? null}
              onEntryConverted={mutateBoqDoc}
            />
          </CardContent>
        </Card>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button
          variant="ghost"
          onClick={() => (onBack ? onBack() : navigate(`/projects/${projectId}`))}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {onBack ? "Back" : "Back to project"}
        </Button>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              {/*
                Disabled buttons don't fire mouse events so can't trigger Tooltip.
                The wrapping <span tabIndex={0}> lets Tooltip fire on hover.
              */}
              <span tabIndex={0}>
                <Button
                  disabled={!canContinue}
                  onClick={() => { if (boqDocName) navigate(`/upload-boq/hub/${boqDocName}`); }}
                >
                  Continue
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{tooltipText}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
