import { useEffect, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import ReactSelect from "react-select";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { getSelectStyles } from "@/config/selectTheme";
import { formatDate } from "@/utils/FormatDate";
import { getFrappeError } from "@/utils/frappeErrors";
import { originBadge } from "./boqOriginBadge";
import { planEntryChange } from "./revisionEntry";
import type { BOQsDoc } from "./boqTypes";
import {
  useBoqWizardStore,
  type GstChoice,
  type RevisionMode,
} from "@/zustand/useBoqWizardStore";

/** One revisable original as returned by revision.list_revisable_boqs (already eligible + ordered). */
interface RevisableBoq {
  name: string;
  boq_name: string;
  version: number;
  uploaded_at: string | null;
  // Raw `BOQs.origin`, widened to a plain string for the same reason BoqProjectTab widens it:
  // live rows carry values outside the doctype's declared Select options. See boqOriginBadge.ts.
  origin?: string | null;
}

/** react-select option: value = BOQs docname (sent as source_boq). */
interface RevisableOption {
  value: string;
  label: string;
  uploaded_at: string | null;
  origin?: string | null;
}

interface BoqMasterPanelProps {
  projectName: string;
  customer?: string | null;
  /** W3: `BOQs.origin` as last read from the server (undefined while the doc is still loading). */
  boqOrigin?: BOQsDoc["origin"] | null;
  /** W3: `BOQs.source_boq` as last read from the server. */
  boqSourceBoq?: string | null;
  /**
   * W3: re-read the BOQs doc after a successful convert. The server recomputes boq_name and
   * version for the new naming scope, so the panel must re-fill from the doc (which also
   * re-arms the unconfirmed treatment -- those two values genuinely changed).
   */
  onEntryConverted?: () => void | Promise<unknown>;
}

/**
 * Six-field Master BoQ details panel (M1.17).
 *
 * Blank-until-parsed (§4.1 clarification for 1b-ii-b):
 *   Fields start blank (empty string, no selection). They are populated only
 *   when fillFromParse() is called after parser success. At that point,
 *   confirmedFields are reset to false.
 *
 * Pre-fill-unconfirmed treatment (§4.1 / M1.34):
 *   Required fields show the sparkle and ~50% opacity ONLY when
 *   the field has a real value AND is not yet confirmed. Pre-parse the
 *   fields are empty, so no sparkle shows.
 *
 * Excluded from unconfirmed treatment per spec (M1.19, M1.32):
 *   Project and Customer (read-only) and Notes (optional).
 */
export function BoqMasterPanel({
  projectName,
  customer,
  boqOrigin,
  boqSourceBoq,
  onEntryConverted,
}: BoqMasterPanelProps) {
  const {
    panelValues,
    confirmedFields,
    setPanelValue,
    confirmField,
    selectedProjectId,
    boqDocName,
    revisionMode,
    sourceBoq,
    setRevisionMode,
    setSourceBoq,
  } = useBoqWizardStore();

  function touch(field: keyof typeof confirmedFields) {
    confirmField(field);
  }

  // ── Entry un-lock (ADR-0014 Amendment B W3) ───────────────────────────────
  // The radio + picker used to freeze the instant a file dropped, because origin/source_boq are
  // baked into the BOQs doc at insert -- a wrong pick meant delete and start over. They stay live
  // now: once the doc exists a change is pushed through convert_revision_entry (the one owner of
  // those fields); before it exists the store value still just rides the upload POST.
  const [convertError, setConvertError] = useState<string | null>(null);
  const { call: callConvert, loading: converting } = useFrappePostCall(
    "nirmaan_stack.api.boq.wizard.revision.convert_revision_entry"
  );

  async function applyEntryChange(next: { mode: RevisionMode; sourceBoq: string | null }) {
    const action = planEntryChange({
      boqDocName,
      mode: next.mode,
      sourceBoq: next.sourceBoq,
      serverOrigin: boqOrigin,
      serverSourceBoq: boqSourceBoq,
    });
    // "convert" implies a doc exists (planEntryChange's first rule); the re-check narrows the type.
    if (action.kind !== "convert" || !boqDocName) return;

    // The store was updated by the caller before this ran, so these render-closure values are
    // still the PRE-change entry -- exactly what a failed convert must be rolled back to.
    const prevMode = revisionMode;
    const prevSource = sourceBoq;

    setConvertError(null);
    try {
      await callConvert({
        boq: boqDocName,
        mode: action.mode,
        source_boq: action.sourceBoq ?? undefined,
      });
      await onEntryConverted?.();
    } catch (e: unknown) {
      // Inline, never a toast (wizard convention). The backend's message is the useful one --
      // it names the reason (already committed / already parsed / mapping confirmed).
      setConvertError(
        getFrappeError(e) || "Could not change the upload type. Please try again."
      );
      // Never leave the controls disagreeing with the server.
      setRevisionMode(prevMode);
      if (prevMode === "revise") setSourceBoq(prevSource);
    }
  }

  // ── Revisable-original picker (ADR-0014 D1) ───────────────────────────────
  // Fetch on mount (project set) regardless of mode: an EMPTY list is the signal to
  // disable the Revise radio. Only eligible BOQs are returned (filter, don't grey),
  // latest-uploaded first. swrKey null until project known (per the SDK gotcha).
  const { data: revisableData, isLoading: revisableLoading } = useFrappeGetCall<{
    message: { revisable: RevisableBoq[] };
  }>(
    "nirmaan_stack.api.boq.wizard.revision.list_revisable_boqs",
    { project: selectedProjectId },
    selectedProjectId ? `revisable-boqs::${selectedProjectId}` : null
  );

  const revisable = revisableData?.message?.revisable ?? [];
  // Only assert "nothing to revise" once we actually have a project AND a settled fetch --
  // otherwise the null-swrKey pre-project tick would briefly disable the radio for no reason.
  const noneToRevise = !!selectedProjectId && !revisableLoading && revisable.length === 0;

  const revisableOptions: RevisableOption[] = revisable.map((b) => ({
    value: b.name,
    label: `${b.boq_name} — v${b.version}`,
    uploaded_at: b.uploaded_at,
    origin: b.origin,
  }));
  const selectedRevisable =
    revisableOptions.find((o) => o.value === sourceBoq) ?? null;

  // If the list resolves empty while (pre-)selected into Revise, fall back to New so the
  // user is never stranded in a mode with nothing to pick. setRevisionMode is a stable ref.
  useEffect(() => {
    if (noneToRevise && revisionMode === "revise") setRevisionMode("new");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noneToRevise, revisionMode]);

  // The Type badge is the SAME one the BoQ list renders -- shared mapping in boqOriginBadge.ts.
  // It matters most here: chains are allowed (a committed revision is itself revisable), so this
  // list mixes originals, revisions and template-born BoQs and the name alone does not say which.
  // react-select runs formatOptionLabel for the menu AND the closed control, so the badge rides
  // the current selection too -- no extra branch on `context` needed.
  const formatRevisableOption = (o: RevisableOption) => {
    const type = originBadge(o.origin);
    return (
      <div className="flex flex-col gap-0.5">
        <span className="truncate text-sm text-foreground">{o.label}</span>
        {/* Meta line: the badge sits BESIDE "uploaded ...", sized to that line's height
            (h-4 = text-xs line-height; border-box, so the border does not add to it). */}
        <div className="flex min-w-0 items-center gap-2">
          {o.uploaded_at && (
            <span className="truncate text-xs text-muted-foreground">
              uploaded {formatDate(o.uploaded_at)}
            </span>
          )}
          <Badge
            variant={type.variant}
            className="h-4 shrink-0 whitespace-nowrap px-1.5 py-0 text-xs font-medium leading-none"
          >
            {type.label}
          </Badge>
        </div>
      </div>
    );
  };

  // Sparkle + opacity only when field has a real value AND is unconfirmed.
  const boqNameUnconfirmed = !confirmedFields.boqName && panelValues.boqName !== "";
  const versionUnconfirmed = !confirmedFields.version && panelValues.version !== "";
  const gstUnconfirmed = !confirmedFields.gst && panelValues.gst !== "";

  return (
    <div className="space-y-5">
      {/* ── Entry mode: New | Revise (ADR-0014 D1) ───────────────────────── */}
      <div className="space-y-2">
        <Label>Upload type</Label>
        <RadioGroup
          value={revisionMode}
          onValueChange={(val) => {
            const mode = val as RevisionMode;
            setRevisionMode(mode);
            // Leaving revise clears the original (store rule), so New converts with no source.
            void applyEntryChange({
              mode,
              sourceBoq: mode === "revise" ? sourceBoq : null,
            });
          }}
          // Disabled only while a convert is in flight, so the entry cannot be double-fired.
          disabled={converting}
          className="flex gap-6"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="new" id="mode-new" />
            <Label htmlFor="mode-new" className="cursor-pointer font-normal">
              New BoQ
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="revise" id="mode-revise" disabled={noneToRevise} />
            <Label
              htmlFor="mode-revise"
              className={cn(
                "font-normal",
                noneToRevise ? "cursor-not-allowed opacity-50" : "cursor-pointer"
              )}
            >
              Revise existing
            </Label>
          </div>
        </RadioGroup>
        {noneToRevise && (
          <p className="text-xs text-muted-foreground">
            No committed BoQ in this project yet — nothing to revise.
          </p>
        )}

        {/* W3: convert in flight / failed. Inline only -- the wizard never toasts. */}
        {converting && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Updating upload type...
          </p>
        )}
        {convertError && <p className="text-sm text-destructive">{convertError}</p>}

        {/* Inline original picker -- appears directly beneath the radio in Revise mode. */}
        {revisionMode === "revise" && (
          <div className="pt-1">
            <ReactSelect<RevisableOption, false>
              value={selectedRevisable}
              options={revisableOptions}
              onChange={(opt) => {
                const next = opt ? opt.value : null;
                setSourceBoq(next);
                // Clearing the picker is not pushed: convert_revision_entry requires a source,
                // and Continue already blocks a revision with no original (needsOriginal).
                void applyEntryChange({ mode: "revise", sourceBoq: next });
              }}
              formatOptionLabel={formatRevisableOption}
              isLoading={revisableLoading}
              isDisabled={converting}
              placeholder="Select the BoQ to revise..."
              classNamePrefix="react-select"
              styles={getSelectStyles<RevisableOption, false>()}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              A revision uploads a new workbook against this BoQ and carries forward
              what still matches.
            </p>
          </div>
        )}
      </div>

      {/* ── Project -- read-only (M1.19) ─────────────────────────────────── */}
      <div className="space-y-1.5">
        <Label>Project</Label>
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          {projectName || "—"}
        </p>
      </div>

      {/* ── Customer -- read-only, can be blank (M1.19, M1.20) ───────────── */}
      <div className="space-y-1.5">
        <Label>Customer</Label>
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          {customer || <span className="italic">None</span>}
        </p>
      </div>

      {/* ── BoQ Name -- required, blank-until-parsed (M1.34) ─────────────── */}
      <div className="space-y-1.5">
        <Label className={cn("flex items-center gap-1")}>
          BoQ Name
          <span className="text-destructive">*</span>
          {boqNameUnconfirmed && (
            <span className="ml-0.5 text-sm" aria-label="Pre-filled -- click to confirm">
              ✨
            </span>
          )}
        </Label>
        <Input
          value={panelValues.boqName}
          placeholder="e.g. Electrical BoQ"
          className={cn(boqNameUnconfirmed && "opacity-50")}
          onFocus={() => touch("boqName")}
          onClick={() => touch("boqName")}
          onChange={(e) => {
            touch("boqName");
            setPanelValue("boqName", e.target.value);
          }}
        />
      </div>

      {/* ── Version -- required, V-prefixed, blank-until-parsed (M1.34) ───── */}
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1">
          Version
          <span className="text-destructive">*</span>
          {versionUnconfirmed && (
            <span className="ml-0.5 text-sm" aria-label="Pre-filled -- click to confirm">
              ✨
            </span>
          )}
        </Label>
        <Input
          value={panelValues.version}
          placeholder="V1"
          className={cn(versionUnconfirmed && "opacity-50")}
          onFocus={() => touch("version")}
          onClick={() => touch("version")}
          onChange={(e) => {
            touch("version");
            setPanelValue("version", e.target.value);
          }}
        />
      </div>

      {/* ── GST Treatment -- radio, required, blank-until-parsed (M1.30 M1.34) */}
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1">
          GST Treatment
          <span className="text-destructive">*</span>
          {gstUnconfirmed && (
            <span className="ml-0.5 text-sm" aria-label="Pre-filled -- click to confirm">
              ✨
            </span>
          )}
        </Label>
        {/*
          onClick on RadioGroup: catches clicks on the pre-selected radio
          (onValueChange only fires when value changes, so clicking the
          already-selected option would not fire it -- M1.30 requires that
          "clicking even the default confirms").
        */}
        <RadioGroup
          value={panelValues.gst}
          onValueChange={(val) => {
            touch("gst");
            setPanelValue("gst", val as GstChoice);
          }}
          onClick={() => touch("gst")}
          className={cn("flex gap-6", gstUnconfirmed && "opacity-50")}
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="pre" id="gst-pre" />
            <Label htmlFor="gst-pre" className="cursor-pointer font-normal">
              Pre-tax (excl. GST)
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="post" id="gst-post" />
            <Label htmlFor="gst-post" className="cursor-pointer font-normal">
              Post-tax (incl. GST)
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* ── Notes -- optional, NO unconfirmed treatment (M1.32) ──────────── */}
      <div className="space-y-1.5">
        <Label>
          Notes{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          value={panelValues.notes}
          placeholder="Any notes about this BoQ version..."
          rows={3}
          onChange={(e) => setPanelValue("notes", e.target.value)}
        />
      </div>
    </div>
  );
}
