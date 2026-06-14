import { useCallback, useContext, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  FrappeConfig,
  FrappeContext,
  useFrappeGetCall,
  useFrappeGetDoc,
} from "frappe-react-sdk";
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
import { useBoqWizardStore, type GstChoice } from "@/zustand/useBoqWizardStore";
import { BoqDropZone } from "./BoqDropZone";
import { BoqMasterPanel } from "./BoqMasterPanel";

interface ProjectDoc {
  name: string;
  project_name: string;
  customer?: string | null;
}

// BOQsDoc is now the shared type from boqTypes.ts -- imported above.

interface ParseDonePayload {
  status: string;
  boq_name?: string;
  error_code?: string;
}

// Response shape of get_upload_status (the polling fallback). Mirrors the
// realtime payload (status/boq_name/error_code) so one handler serves both paths.
interface UploadStatusResponse {
  state: "pending" | "done";
  status?: string;
  boq_name?: string;
  error_code?: string;
}

interface BoqUploadScreenProps {
  projectId: string;
}

/**
 * Two-pane upload screen (M1.4, M1.7):
 *   Left  -- BoQ file drop zone (custom file-input, M1.65).
 *   Right -- Master BoQ details panel: 6 fields (M1.17).
 *   Footer -- Back-to-project + Continue (gated by 3-part AND per M1.33-M1.36).
 *
 * Renders in-place inside BoqPickerPage when ?project=<id> is present.
 *
 * Socket listener: subscribes to boq:wizard_parse_done on mount via FrappeContext.
 * The event is screen-scoped; it is NOT registered in the global socketListeners.ts.
 * Cleanup runs on unmount (socket.off). Guard: only acts when uploadStatus === "parsing"
 * to avoid reacting to events from concurrent uploads by other users.
 */
export function BoqUploadScreen({ projectId }: BoqUploadScreenProps) {
  const navigate = useNavigate();
  const { socket } = useContext(FrappeContext) as FrappeConfig;

  const { data: project } = useFrappeGetDoc<ProjectDoc>("Projects", projectId);

  const {
    reset,
    setSelectedProject,
    uploadStatus,
    droppedFile,
    confirmedFields,
    boqDocName,
    jobId,
    setUploadStatus,
    setBoqDocName,
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

  // Apply a parse outcome from EITHER the realtime event or the polling fallback.
  // Guards on uploadStatus === "parsing" so whichever path resolves first wins and
  // the other becomes a no-op. setUploadStatus/setBoqDocName are stable Zustand refs.
  const applyParseOutcome = useCallback(
    (status?: string, boqName?: string | null, errorCode?: string | null) => {
      if (useBoqWizardStore.getState().uploadStatus !== "parsing") return;
      if (status === "success" && boqName) {
        setBoqDocName(boqName);
        setUploadStatus("done");
      } else if (status === "error") {
        if (errorCode === "corrupted") setUploadStatus("error-E");
        else if (errorCode === "zero_sheets") setUploadStatus("error-F");
        else setUploadStatus("error-internal");
      }
    },
    // store actions are stable Zustand refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Fast path: realtime boq:wizard_parse_done socket event.
  // Registered on mount, cleaned up on unmount (screen-scoped, not global).
  useEffect(() => {
    if (!socket) return;
    const handler = (payload: ParseDonePayload) =>
      applyParseOutcome(payload.status, payload.boq_name, payload.error_code);
    socket.on("boq:wizard_parse_done", handler);
    return () => {
      socket.off("boq:wizard_parse_done", handler);
    };
  }, [socket, applyParseOutcome]);

  // Fallback path: poll get_upload_status by job id while waiting. The realtime
  // event is room-targeted and NOT replayed, so a client that wasn't connected/
  // joined when the worker finished (e.g. right after login) would otherwise hang
  // on "parsing" forever. Socket or poll -- first to resolve wins (both gate on
  // uploadStatus === "parsing"). swrKey null + refreshInterval 0 stop the poll
  // once we leave "parsing".
  const shouldPoll = uploadStatus === "parsing" && !!jobId;
  const { data: pollData } = useFrappeGetCall<{ message: UploadStatusResponse }>(
    "nirmaan_stack.api.boq.wizard.upload_file.get_upload_status",
    { job_id: jobId },
    shouldPoll ? `boq-upload-status::${jobId}` : null,
    { refreshInterval: shouldPoll ? 3000 : 0 }
  );

  useEffect(() => {
    const msg = pollData?.message;
    if (!msg || msg.state !== "done") return;
    applyParseOutcome(msg.status, msg.boq_name, msg.error_code);
  }, [pollData, applyParseOutcome]);

  // Fetch the BOQs doc once boqDocName is set (i.e. after socket success).
  // Third arg null disables SWR fetch until boqDocName is available (per sdk gotcha in CLAUDE.md).
  const { data: boqDoc } = useFrappeGetDoc<BOQsDoc>(
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

  // ── Continue gate (M1.33-M1.36) ──────────────────────────────────────────
  const allConfirmed =
    confirmedFields.boqName && confirmedFields.version && confirmedFields.gst;
  const canContinue = droppedFile !== null && uploadStatus === "done" && allConfirmed;

  const missingItems: string[] = [];
  if (!droppedFile) {
    missingItems.push("upload a BoQ file");
  } else if (uploadStatus !== "done") {
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
    <div className="flex-1 space-y-6 max-w-4xl mx-auto pt-6 pb-10">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Upload BoQ</h1>
        {project?.project_name && (
          <p className="mt-1 text-sm text-muted-foreground">{project.project_name}</p>
        )}
      </div>

      {/* ── Two-pane body ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Left -- drop zone */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">BoQ File</CardTitle>
          </CardHeader>
          <CardContent>
            <BoqDropZone />
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
            />
          </CardContent>
        </Card>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button variant="ghost" onClick={() => navigate(`/projects/${projectId}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to project
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
