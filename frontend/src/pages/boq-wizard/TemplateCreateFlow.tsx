import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FrappeConfig,
  FrappeContext,
  useFrappeGetCall,
  useFrappeGetDoc,
  useFrappePostCall,
} from "frappe-react-sdk";
import { AlertTriangle, ArrowLeft, Layers, Loader2 } from "lucide-react";
import type {
  MasterTemplateResponse,
  MasterTemplateSheet,
  TemplateCloneDonePayload,
} from "./boqTypes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DefineAreasDialog } from "./DefineAreasDialog";

interface ProjectDoc {
  name: string;
  project_name: string;
}

/**
 * Mirror of get_clone_status (the polling fallback for the socket). Shape matches the
 * realtime TemplateCloneDonePayload (status / error_code) so one outcome handler serves both.
 */
interface CloneStatusResponse {
  state: "pending" | "done";
  status?: string;
  boq_name?: string;
  error_code?: string;
}

interface TemplateCreateFlowProps {
  projectId: string;
  /** Return to the picker (in-place mode flip; NO route change). Optional. */
  onBack?: () => void;
}

/** Local clone lifecycle. "building" = job enqueued, awaiting socket/poll. */
type CloneState = "idle" | "creating" | "building" | "error";

/** Friendly copy per TemplateCloneDonePayload.error_code. */
const CLONE_ERROR_MSGS: Record<string, string> = {
  template_changed:
    "The master template changed while your BoQ was being built (a sheet you picked was removed). Please try again.",
  internal: "Something went wrong while building your BoQ. Please try again.",
};
const CLONE_ERROR_FALLBACK =
  "Something went wrong while building your BoQ. Please try again.";

/**
 * A-T7: Create-from-Template flow (ADR-0013 A1). Rendered IN-PLACE by BoqPickerPage
 * (a mode flip -- NO new route) when the user picks a project and chooses "Create from
 * Template". Steps:
 *   1. get_master_template -> if {active:false} show an empty state; else a checkbox picker
 *      of every master sheet + an editable BoQ name (default `${project}_BOQ`).
 *   2. create_from_template({project, boq_name, sheet_names}) -> {job_id, boq_id}.
 *   3. "Building your BoQ…" -- driven by the screen-scoped "boq:template_clone_done" socket
 *      + a get_clone_status(job_id) poll (first-to-resolve-wins, mirroring BoqUploadScreen).
 *      On success navigate to the hub; on error surface error_code (incl. "template_changed").
 *
 * Socket is screen-scoped (FrappeContext), NOT registered in socketListeners.ts.
 */
export function TemplateCreateFlow({ projectId, onBack }: TemplateCreateFlowProps) {
  const navigate = useNavigate();
  const { socket } = useContext(FrappeContext) as FrappeConfig;

  const { data: project } = useFrappeGetDoc<ProjectDoc>("Projects", projectId);
  const projectName = project?.project_name ?? "";

  // The ONE active master template + its sheets (or {active:false}). No template-selection
  // step -- there is exactly one active master (ADR-0013 A1).
  const {
    data: templateData,
    isLoading: templateLoading,
    error: templateError,
  } = useFrappeGetCall<{ message: MasterTemplateResponse }>(
    "nirmaan_stack.api.boq.wizard.create_from_template.get_master_template",
    undefined,
    "boq-master-template"
  );
  const template = templateData?.message;

  // Master sheets sorted by sheet_order (the workbook tab order carried into the clone).
  const activeSheets: MasterTemplateSheet[] = useMemo(
    () =>
      template && template.active
        ? [...template.sheets].sort((a, b) => a.sheet_order - b.sheet_order)
        : [],
    [template]
  );

  // ── Picker state ──────────────────────────────────────────────────────────
  const [selectedSheets, setSelectedSheets] = useState<Set<string>>(new Set());
  // null = untouched -> fall back to the derived default; a string = user-typed value.
  const [boqName, setBoqName] = useState<string | null>(null);
  const defaultBoqName = projectName ? `${projectName}_BOQ` : "";
  const effectiveBoqName = boqName ?? defaultBoqName;
  // A2: GST Treatment (-> BOQs.tax_treatment) + Notes carried from this form. Version is
  // system-assigned by BOQs.before_insert (shown read-only), so it is NOT collected here.
  const [taxTreatment, setTaxTreatment] = useState<"Pre-tax" | "Post-tax">("Pre-tax");
  const [notes, setNotes] = useState("");
  // A2 multi-area: default Single (Slice-1 clone, byte-identical). Multi opens a define-areas
  // dialog; areas are defined ONCE for the whole BoQ and locked at create.
  const [isMultiArea, setIsMultiArea] = useState(false);
  const [areaBoxes, setAreaBoxes] = useState<string[]>([""]);
  const [areasDialogOpen, setAreasDialogOpen] = useState(false);
  const cleanAreas = useMemo(
    () => areaBoxes.map((s) => s.trim()).filter(Boolean),
    [areaBoxes],
  );

  // Pre-select ALL sheets once, the first time the master arrives (most users clone the whole
  // template). A one-time seed -- a later clear-all must NOT be re-seeded.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!seededRef.current && activeSheets.length > 0) {
      seededRef.current = true;
      setSelectedSheets(new Set(activeSheets.map((s) => s.sheet_name)));
    }
  }, [activeSheets]);

  const toggleSheet = (name: string) => {
    setSelectedSheets((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const selectAll = () =>
    setSelectedSheets(new Set(activeSheets.map((s) => s.sheet_name)));
  const clearAll = () => setSelectedSheets(new Set());

  // ── Clone lifecycle ───────────────────────────────────────────────────────
  const [cloneState, setCloneState] = useState<CloneState>("idle");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const { call: callCreate } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.create_from_template.create_from_template"
  );

  // Ref mirrors so the stable (empty-dep) outcome handler reads current values without a
  // stale closure -- mirrors BoqUploadScreen / BoqHubPage.
  const stateRef = useRef<CloneState>("idle");
  useEffect(() => {
    stateRef.current = cloneState;
  }, [cloneState]);
  // boq_id from the CREATE response is the authoritative hub target (the socket payload does
  // NOT carry it). Held in a ref for the stable handler.
  const boqIdRef = useRef<string | null>(null);

  // Apply a clone outcome from EITHER the realtime event or the poll. Guards on
  // stateRef === "building" so whichever resolves first wins and the other no-ops.
  const applyCloneOutcome = useCallback(
    (status?: string, cloneErr?: string | null) => {
      if (stateRef.current !== "building") return;
      if (status === "success") {
        const dest = boqIdRef.current;
        setCloneState("idle");
        if (dest) navigate(`/upload-boq/hub/${dest}`);
      } else if (status === "error") {
        setErrorCode(cloneErr ?? "internal");
        setCloneState("error");
      }
    },
    // navigate is stable; store setters are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Fast path: realtime "boq:template_clone_done". Screen-scoped; cleaned up on unmount.
  // Guard on payload.boq_name === our new boq id so a concurrent clone by another user (the
  // event is broadcast to all clients) can't falsely resolve ours.
  useEffect(() => {
    if (!socket) return;
    const handler = (payload: TemplateCloneDonePayload) => {
      if (boqIdRef.current && payload.boq_name !== boqIdRef.current) return;
      applyCloneOutcome(payload.status, payload.error_code ?? null);
    };
    socket.on("boq:template_clone_done", handler);
    return () => {
      socket.off("boq:template_clone_done", handler);
    };
  }, [socket, applyCloneOutcome]);

  // Fallback path: poll get_clone_status by job id (job-scoped, so no boq guard needed). The
  // realtime event is room-targeted + not replayed, so a client that wasn't joined when the
  // worker finished would otherwise hang. swrKey null + refreshInterval 0 stop it once done.
  const shouldPoll = cloneState === "building" && !!jobId;
  const { data: pollData } = useFrappeGetCall<{ message: CloneStatusResponse }>(
    "nirmaan_stack.api.boq.wizard.create_from_template.get_clone_status",
    { job_id: jobId },
    shouldPoll ? `boq-clone-status::${jobId}` : null,
    { refreshInterval: shouldPoll ? 3000 : 0 }
  );
  useEffect(() => {
    const msg = pollData?.message;
    if (!msg || msg.state !== "done") return;
    applyCloneOutcome(msg.status, msg.error_code ?? null);
  }, [pollData, applyCloneOutcome]);

  const handleCreate = async () => {
    if (
      selectedSheets.size === 0 ||
      !effectiveBoqName.trim() ||
      cloneState === "creating" ||
      cloneState === "building"
    )
      return;
    setCloneState("creating");
    setErrorCode(null);
    // Preserve master sheet_order in the payload (sheet_name matched VERBATIM, #152).
    const orderedNames = activeSheets
      .filter((s) => selectedSheets.has(s.sheet_name))
      .map((s) => s.sheet_name);
    try {
      const res = await callCreate({
        project: projectId,
        boq_name: effectiveBoqName.trim(),
        sheet_names: orderedNames,
        tax_treatment: taxTreatment,
        notes: notes.trim() || undefined,
        // A2: [] == single-area (Slice-1 clone, byte-identical); N names == multi-area.
        areas: isMultiArea ? cleanAreas : [],
      });
      const msg = res?.message as
        | { job_id?: string; boq_id?: string }
        | undefined;
      const newJobId = msg?.job_id ?? null;
      const newBoqId = msg?.boq_id ?? null;
      if (!newJobId || !newBoqId) {
        setErrorCode("internal");
        setCloneState("error");
        return;
      }
      boqIdRef.current = newBoqId;
      setJobId(newJobId);
      setCloneState("building");
    } catch {
      setErrorCode("internal");
      setCloneState("error");
    }
  };

  const handleBack = () => {
    if (onBack) onBack();
    else navigate(`/projects/${projectId}`);
  };

  const isBusy = cloneState === "creating" || cloneState === "building";

  // ── Header (shared across states) ───────────────────────────────────────────
  const header = (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Create BoQ from Template</h1>
      {projectName && (
        <p className="mt-1 text-sm text-muted-foreground">{projectName}</p>
      )}
    </div>
  );

  const wrapperClass = "flex-1 space-y-6 max-w-2xl mx-auto pt-6 pb-10";

  // ── Loading the master template ─────────────────────────────────────────────
  if (templateLoading) {
    return (
      <div className={wrapperClass}>
        {header}
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (templateError) {
    return (
      <div className={wrapperClass}>
        {header}
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <AlertTriangle className="h-10 w-10 text-destructive" />
            <p className="text-sm text-muted-foreground">
              Couldn&apos;t load the master template. Please try again.
            </p>
            <Button variant="outline" onClick={handleBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── No active master template ───────────────────────────────────────────────
  if (!template || template.active === false) {
    return (
      <div className={wrapperClass}>
        {header}
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <Layers className="h-12 w-12 text-muted-foreground opacity-40" />
            <div>
              <p className="text-sm font-medium text-foreground">
                No active master template
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ask an admin to publish one, or upload a BoQ file instead.
              </p>
            </div>
            <Button variant="outline" onClick={handleBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Building state (creating POST or awaiting clone) ────────────────────────
  if (isBusy) {
    return (
      <div className={wrapperClass}>
        {header}
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Building your BoQ…
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Cloning {selectedSheets.size}{" "}
                {selectedSheets.size === 1 ? "sheet" : "sheets"} from{" "}
                {template.template_name}. This usually takes a few seconds.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────────────
  if (cloneState === "error") {
    return (
      <div className={wrapperClass}>
        {header}
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <AlertTriangle className="h-10 w-10 text-destructive" />
            <p className="max-w-md text-sm text-muted-foreground">
              {CLONE_ERROR_MSGS[errorCode ?? ""] ?? CLONE_ERROR_FALLBACK}
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setCloneState("idle");
                  setErrorCode(null);
                  setJobId(null);
                  boqIdRef.current = null;
                }}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to sheets
              </Button>
              <Button onClick={handleCreate}>Try again</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Picker (idle) ───────────────────────────────────────────────────────────
  // A2: a multi-area BoQ needs >= 2 defined areas (a single "area" is just Single).
  const areasReady = !isMultiArea || cleanAreas.length >= 2;
  const canCreate =
    selectedSheets.size > 0 && effectiveBoqName.trim().length > 0 && areasReady;

  return (
    <div className={wrapperClass}>
      {header}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">BoQ details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="template-boq-name" className="text-xs font-medium text-foreground">
              BoQ name
            </Label>
            <Input
              id="template-boq-name"
              value={effectiveBoqName}
              onChange={(e) => setBoqName(e.target.value)}
              placeholder="BoQ name"
            />
            <p className="text-xs text-muted-foreground">
              Created from the{" "}
              <span className="font-medium text-foreground">{template.template_name}</span>{" "}
              template.
            </p>
          </div>

          {/* Version (read-only, system-assigned) + GST Treatment */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground">Version</Label>
              <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                Auto-assigned on create
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="template-gst" className="text-xs font-medium text-foreground">
                GST Treatment
              </Label>
              <Select
                value={taxTreatment}
                onValueChange={(v) => setTaxTreatment(v as "Pre-tax" | "Post-tax")}
              >
                <SelectTrigger id="template-gst" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Pre-tax">Pre-tax</SelectItem>
                  <SelectItem value="Post-tax">Post-tax</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Notes (optional) */}
          <div className="space-y-1.5">
            <Label htmlFor="template-notes" className="text-xs font-medium text-foreground">
              Notes <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="template-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes for this BoQ…"
              rows={2}
            />
          </div>

          {/* Area configuration (A2 multi-area) */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground">Area configuration</Label>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-md border border-input p-0.5">
                <button
                  type="button"
                  onClick={() => setIsMultiArea(false)}
                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                    !isMultiArea
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Single area
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMultiArea(true);
                    if (cleanAreas.length === 0) setAreaBoxes(["", ""]);
                    setAreasDialogOpen(true);
                  }}
                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                    isMultiArea
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Multi area
                </button>
              </div>
              {isMultiArea && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAreasDialogOpen(true)}
                >
                  Define areas{cleanAreas.length ? ` (${cleanAreas.length})` : ""}
                </Button>
              )}
            </div>
            {isMultiArea && (
              <p className="text-xs text-muted-foreground">
                {cleanAreas.length >= 2
                  ? `Quantities split across: ${cleanAreas.join(", ")}. Total = their sum.`
                  : "Add at least 2 areas — each becomes a per-area Quantity column; Total = their sum."}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">
              Sheets to include
            </CardTitle>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">
                {selectedSheets.size} of {activeSheets.length}
              </span>
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={selectAll}
              >
                Select all
              </button>
              <button
                type="button"
                className="text-muted-foreground hover:underline"
                onClick={clearAll}
              >
                Clear
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {activeSheets.map((sheet) => {
            const checked = selectedSheets.has(sheet.sheet_name);
            const displayName =
              sheet.sheet_label?.trim() || sheet.sheet_name.trim();
            return (
              <label
                key={sheet.sheet_name}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggleSheet(sheet.sheet_name)}
                />
                <span className="flex-1 truncate text-sm text-foreground">
                  {displayName}
                </span>
                {sheet.disposition === "general_specs" && (
                  <Badge variant="secondary" className="shrink-0 text-xs">
                    General specs
                  </Badge>
                )}
              </label>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button variant="ghost" onClick={handleBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button
          disabled={!canCreate}
          onClick={handleCreate}
          title={!areasReady ? "Add at least 2 areas for a multi-area BoQ" : undefined}
        >
          <Layers className="mr-2 h-4 w-4" />
          Create BoQ
        </Button>
      </div>

      <DefineAreasDialog
        open={areasDialogOpen}
        onOpenChange={setAreasDialogOpen}
        value={areaBoxes}
        onChange={setAreaBoxes}
      />
    </div>
  );
}
