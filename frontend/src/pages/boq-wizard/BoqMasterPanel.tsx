import { useEffect } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import ReactSelect from "react-select";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { getSelectStyles } from "@/config/selectTheme";
import { formatDate } from "@/utils/FormatDate";
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
}

/** react-select option: value = BOQs docname (sent as source_boq). */
interface RevisableOption {
  value: string;
  label: string;
  uploaded_at: string | null;
}

interface BoqMasterPanelProps {
  projectName: string;
  customer?: string | null;
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
export function BoqMasterPanel({ projectName, customer }: BoqMasterPanelProps) {
  const {
    panelValues,
    confirmedFields,
    setPanelValue,
    confirmField,
    selectedProjectId,
    uploadStatus,
    revisionMode,
    sourceBoq,
    setRevisionMode,
    setSourceBoq,
  } = useBoqWizardStore();

  // Once an upload has fired, the entry (mode + original) is baked into the created BOQs doc
  // and must not change under the user -- lock the radio + picker until they reset ("Replace
  // file" returns to idle). Order-independence still holds fully in the idle state.
  const entryLocked = uploadStatus !== "idle";

  function touch(field: keyof typeof confirmedFields) {
    confirmField(field);
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
  }));
  const selectedRevisable =
    revisableOptions.find((o) => o.value === sourceBoq) ?? null;

  // If the list resolves empty while (pre-)selected into Revise, fall back to New so the
  // user is never stranded in a mode with nothing to pick. setRevisionMode is a stable ref.
  useEffect(() => {
    if (noneToRevise && revisionMode === "revise") setRevisionMode("new");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noneToRevise, revisionMode]);

  const formatRevisableOption = (o: RevisableOption) => (
    <div className="flex flex-col">
      <span className="text-sm text-foreground">{o.label}</span>
      {o.uploaded_at && (
        <span className="text-xs text-muted-foreground">
          uploaded {formatDate(o.uploaded_at)}
        </span>
      )}
    </div>
  );

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
          onValueChange={(val) => setRevisionMode(val as RevisionMode)}
          disabled={entryLocked}
          className="flex gap-6"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="new" id="mode-new" />
            <Label htmlFor="mode-new" className="cursor-pointer font-normal">
              New BoQ
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="revise" id="mode-revise" disabled={noneToRevise || entryLocked} />
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

        {/* Inline original picker -- appears directly beneath the radio in Revise mode. */}
        {revisionMode === "revise" && (
          <div className="pt-1">
            <ReactSelect<RevisableOption, false>
              value={selectedRevisable}
              options={revisableOptions}
              onChange={(opt) => setSourceBoq(opt ? opt.value : null)}
              formatOptionLabel={formatRevisableOption}
              isLoading={revisableLoading}
              isDisabled={entryLocked}
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
