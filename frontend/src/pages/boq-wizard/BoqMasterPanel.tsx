import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { useBoqWizardStore, type GstChoice } from "@/zustand/useBoqWizardStore";

interface BoqMasterPanelProps {
  projectName: string;
  customer?: string | null;
}

/**
 * Six-field Master BoQ details panel (M1.17).
 *
 * Pre-fill-unconfirmed treatment (§4.1 / M1.34):
 *   Required fields (BoQ Name, Version, GST) show ✨ sparkle and ~50% opacity
 *   while confirmedFields[field] === false. Any explicit interaction (click,
 *   focus, or change) calls confirmField() and clears the indicators.
 *
 * Excluded from unconfirmed treatment per spec (M1.19, M1.32):
 *   Project and Customer (read-only) and Notes (optional).
 */
export function BoqMasterPanel({ projectName, customer }: BoqMasterPanelProps) {
  const { panelValues, confirmedFields, setPanelValue, confirmField } =
    useBoqWizardStore();

  function touch(field: keyof typeof confirmedFields) {
    confirmField(field);
  }

  return (
    <div className="space-y-5">
      {/* ── Project — read-only (M1.19) ─────────────────────────────── */}
      <div className="space-y-1.5">
        <Label>Project</Label>
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          {projectName || "—"}
        </p>
      </div>

      {/* ── Customer — read-only, can be blank (M1.19, M1.20) ─────────── */}
      <div className="space-y-1.5">
        <Label>Customer</Label>
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          {customer || <span className="italic">None</span>}
        </p>
      </div>

      {/* ── BoQ Name — required, pre-fill-unconfirmed (M1.34) ────────── */}
      <div className="space-y-1.5">
        <Label className={cn("flex items-center gap-1")}>
          BoQ Name
          <span className="text-destructive">*</span>
          {!confirmedFields.boqName && (
            <span className="ml-0.5 text-sm" aria-label="Pre-filled — click to confirm">
              ✨
            </span>
          )}
        </Label>
        <Input
          value={panelValues.boqName}
          placeholder="e.g. Electrical BoQ"
          className={cn(!confirmedFields.boqName && "opacity-50")}
          onFocus={() => touch("boqName")}
          onClick={() => touch("boqName")}
          onChange={(e) => {
            touch("boqName");
            setPanelValue("boqName", e.target.value);
          }}
        />
      </div>

      {/* ── Version — required, V-prefixed, pre-fill-unconfirmed (M1.34) */}
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1">
          Version
          <span className="text-destructive">*</span>
          {!confirmedFields.version && (
            <span className="ml-0.5 text-sm" aria-label="Pre-filled — click to confirm">
              ✨
            </span>
          )}
        </Label>
        <Input
          value={panelValues.version}
          placeholder="V1"
          className={cn(!confirmedFields.version && "opacity-50")}
          onFocus={() => touch("version")}
          onClick={() => touch("version")}
          onChange={(e) => {
            touch("version");
            setPanelValue("version", e.target.value);
          }}
        />
      </div>

      {/* ── GST Treatment — radio, required, pre-fill-unconfirmed (M1.30 M1.34) */}
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1">
          GST Treatment
          <span className="text-destructive">*</span>
          {!confirmedFields.gst && (
            <span className="ml-0.5 text-sm" aria-label="Pre-filled — click to confirm">
              ✨
            </span>
          )}
        </Label>
        {/*
          onClick on RadioGroup: catches clicks on the pre-selected radio
          (onValueChange only fires when value changes, so clicking the
          already-selected option would not fire it — M1.30 requires that
          "clicking even the default confirms").
        */}
        <RadioGroup
          value={panelValues.gst}
          onValueChange={(val) => {
            touch("gst");
            setPanelValue("gst", val as GstChoice);
          }}
          onClick={() => touch("gst")}
          className={cn("flex gap-6", !confirmedFields.gst && "opacity-50")}
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

      {/* ── Notes — optional, NO unconfirmed treatment (M1.32) ──────── */}
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
