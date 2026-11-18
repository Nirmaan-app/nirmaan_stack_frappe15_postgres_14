import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDoc } from "frappe-react-sdk";
import { AlertTriangle, ArrowLeft, Layers, Loader2, X } from "lucide-react";
import type { MasterTemplateResponse, MasterTemplateSheet } from "./boqTypes";
import { useBackgroundOperation } from "@/hooks/useBackgroundOperation";
import {
  CLONE_METHOD,
  cloneOutcome,
  cloneSheetCountOf,
  type CloneContext,
} from "./templateCloneOperation";
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

interface TemplateCreateFlowProps {
  projectId: string;
  /** Return to the picker (in-place mode flip; NO route change). Optional. */
  onBack?: () => void;
  /** ADR-0013 D2: hosted inside BoqPickerPage's one-screen mode toggle -> suppress this
   *  component's own <h1> header + outer max-width wrapper (the host owns one header + width).
   *  Absent = renders byte-identically to the standalone screen. */
  embedded?: boolean;
  /** ADR-0013 D2 dirty-guard: report whether the user has entered work (typed name/notes,
   *  non-default GST, multi-area, defined areas, or an in-flight clone) so the host can confirm
   *  before discarding on a mode switch. */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * A-T7: Create-from-Template flow (ADR-0013 A1). Rendered IN-PLACE by BoqPickerPage
 * (a mode flip -- NO new route) when the user picks a project and chooses "Create from
 * Template". Steps:
 *   1. get_master_template -> if {active:false} show an empty state; else a checkbox picker
 *      of every master sheet + an editable BoQ name (default `${project}_BOQ`).
 *   2. create_from_template({project, boq_name, sheet_names, op_id}) makes the BoQ shell and starts the
 *      clone as a background operation (#1669, ADR 0047).
 *   3. "Building your BoQ…" -- the shared useBackgroundOperation hook follows the operation's status record
 *      ("Waiting in the queue…" until it starts). On success navigate to the hub; on error show why (incl. a
 *      master sheet removed meanwhile, or the server's words for a failed or lost clone).
 */
export function TemplateCreateFlow({
  projectId,
  onBack,
  embedded,
  onDirtyChange,
}: TemplateCreateFlowProps) {
  const navigate = useNavigate();

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
  // Index-safe removal: rebuild from cleanAreas (never index into areaBoxes, which may hold
  // blank rows). Areas stay fully controlled by areaBoxes -> DefineAreasDialog needs no rewiring.
  const removeArea = (idx: number) =>
    setAreaBoxes(cleanAreas.filter((_, i) => i !== idx));

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

  // ── Clone lifecycle (a background operation, followed by the shared hook) ───
  const cloneOp = useBackgroundOperation({
    storageKey: `boq_template_clone:${projectId}`,
    onFinished: (result, _context, opId) => {
      const done = cloneOutcome({ phase: "finished", opId, result });
      if (done.status === "done" && done.boqName) navigate(`/upload-boq/hub/${done.boqName}`);
    },
  });
  const clone = cloneOutcome(cloneOp.view);
  const cloneSheetCount = cloneSheetCountOf(cloneOp.context) ?? selectedSheets.size;

  // ── Dirty-guard (ADR-0013 D2) ───────────────────────────────────────────────
  // Any entered work makes this mode "dirty" so the host's mode toggle can confirm before
  // discarding. boqName === null means the name field is still the untouched default.
  const isDirty =
    boqName !== null ||
    notes.trim().length > 0 ||
    taxTreatment !== "Pre-tax" ||
    isMultiArea ||
    cleanAreas.length > 0 ||
    // sheet curation: any deselection from the all-selected default is in-progress work that a
    // silent mode-switch would discard (remount re-seeds ALL sheets). activeSheets.length > 0
    // avoids a spurious dirty flag in the one render before the seed effect runs.
    (activeSheets.length > 0 && selectedSheets.size !== activeSheets.length) ||
    clone.status !== "idle";
  useEffect(() => {
    // onDirtyChange is a stable setState ref from the host (or absent for standalone use).
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const isBusy = clone.status === "creating" || clone.status === "queued" || clone.status === "building";

  const handleCreate = () => {
    if (selectedSheets.size === 0 || !effectiveBoqName.trim() || isBusy) return;
    // Preserve master sheet_order in the payload (sheet_name matched VERBATIM, #152).
    const orderedNames = activeSheets
      .filter((s) => selectedSheets.has(s.sheet_name))
      .map((s) => s.sheet_name);
    const context: CloneContext = { sheetCount: orderedNames.length };
    void cloneOp.start(
      CLONE_METHOD,
      {
        project: projectId,
        boq_name: effectiveBoqName.trim(),
        sheet_names: orderedNames,
        tax_treatment: taxTreatment,
        notes: notes.trim() || undefined,
        // A2: [] == single-area (Slice-1 clone, byte-identical); N names == multi-area.
        areas: isMultiArea ? cleanAreas : [],
      },
      context,
    );
  };

  const handleBack = () => {
    if (onBack) onBack();
    else navigate(`/projects/${projectId}`);
  };

  // ── Header (shared across states; suppressed when embedded -- host owns the one header) ──
  const header = embedded ? null : (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Create BoQ from Template</h1>
      {projectName && (
        <p className="mt-1 text-sm text-muted-foreground">{projectName}</p>
      )}
    </div>
  );

  const wrapperClass = embedded
    ? "space-y-6"
    : "flex-1 space-y-6 max-w-2xl mx-auto pt-6 pb-10";

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

  // ── Building state (creating POST, waiting in the queue, or cloning) ────────
  // "done" stays here for the one render before the hub navigation.
  if (isBusy || clone.status === "done") {
    return (
      <div className={wrapperClass}>
        {header}
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {clone.status === "queued" ? "Waiting in the queue…" : "Building your BoQ…"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Cloning {cloneSheetCount}{" "}
                {cloneSheetCount === 1 ? "sheet" : "sheets"} from{" "}
                {template.template_name}. This usually takes a few seconds.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────────────
  if (clone.status === "error") {
    return (
      <div className={wrapperClass}>
        {header}
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <AlertTriangle className="h-10 w-10 text-destructive" />
            <p className="max-w-md text-sm text-muted-foreground">
              {clone.message}
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => cloneOp.reset()}
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
                  Edit areas{cleanAreas.length ? ` (${cleanAreas.length})` : ""}
                </Button>
              )}
            </div>
            {isMultiArea && (
              <div className="space-y-1.5">
                {cleanAreas.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {cleanAreas.map((area, idx) => (
                      <Badge
                        key={`${area}-${idx}`}
                        variant="secondary"
                        className="gap-1 pl-2 pr-1 text-xs font-normal"
                      >
                        <span className="max-w-[10rem] truncate">{area}</span>
                        <button
                          type="button"
                          onClick={() => removeArea(idx)}
                          aria-label={`Remove area ${area}`}
                          className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {cleanAreas.length >= 2
                    ? "Each area becomes a per-area Quantity column; Total = their sum."
                    : "Add at least 2 areas — each becomes a per-area Quantity column; Total = their sum."}
                </p>
              </div>
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
