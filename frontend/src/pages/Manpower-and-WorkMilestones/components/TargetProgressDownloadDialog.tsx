import * as React from "react";
import { Download } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";

/**
 * "Download Report" — pick the PDF with or without Target Progress.
 *
 * ONE component for what used to be three near-identical dialogs (DailyReportView,
 * OverallMilestonesReport, PDFDownloadButtons). They had already drifted — different
 * wording, and one of them carried an extra branch nobody else did — which is why
 * the choice now lives here and each caller passes only what genuinely differs.
 *
 * THE CHOICE IS A RADIO, NOT TWO BUTTONS (owner ruling). The old footer offered a
 * RED "Without Target Progress" beside a GREEN "With Target Progress", which reads
 * as destructive-vs-safe. Neither is: both download a PDF, and the only difference
 * is how much detail it carries. Colour was carrying meaning it did not have. A
 * radio states that these are two versions of one action, and the single neutral
 * Download button is then the only thing that acts.
 *
 * Each option carries its REASON, so the choice is legible without knowing the
 * report format: the caller supplies `withReason` (what the Target version adds on
 * that particular screen) and the "without" line is the same everywhere.
 */
export interface TargetProgressDownloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dialog heading — the reports differ, so the caller names its own. */
  title: string;
  /**
   * What the Target Progress version adds on THIS screen. Rendered as the reason
   * under the "With Target Progress" option.
   */
  withReason: React.ReactNode;
  /**
   * False when the actor may not see Target Progress: the radio is withheld and
   * the dialog collapses to Cancel + Download, confirming `false`. The dialog can
   * still be worth showing in that state — PDFDownloadButtons opens it to warn
   * about incomplete zones — so this is NOT the same question as whether to render.
   */
  canChooseTarget: boolean;
  /** Optional block above the choice (e.g. the incomplete-zones warning). */
  notice?: React.ReactNode;
  onConfirm: (includeTarget: boolean) => void;
  onCancel?: () => void;
}

type Choice = "with" | "without";

const WITHOUT_REASON =
  "Actual progress only — the standard report shared with the site team.";

export const TargetProgressDownloadDialog: React.FC<
  TargetProgressDownloadDialogProps
> = ({
  open,
  onOpenChange,
  title,
  withReason,
  canChooseTarget,
  notice,
  onConfirm,
  onCancel,
}) => {
  const [choice, setChoice] = React.useState<Choice>("with");

  // Reset on every open. The dialog is not unmounted between uses, so a previous
  // "without" would otherwise persist into the next download as a silent default.
  React.useEffect(() => {
    if (open) setChoice("with");
  }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-600">
              <Download className="h-4 w-4" />
            </div>
            <AlertDialogTitle className="text-lg">{title}</AlertDialogTitle>
          </div>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm leading-relaxed text-slate-600">
              {notice}
              {canChooseTarget && <p>Choose which version of the PDF to download.</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {canChooseTarget && (
          <RadioGroup
            value={choice}
            onValueChange={(v) => setChoice(v as Choice)}
            className="gap-2"
          >
            {(
              [
                { value: "with", label: "With Target Progress", reason: withReason },
                { value: "without", label: "Without Target Progress", reason: WITHOUT_REASON },
              ] as const
            ).map(({ value, label, reason }) => (
              <Label
                key={value}
                htmlFor={`target-progress-${value}`}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                  choice === value
                    ? "border-slate-400 bg-slate-50"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <RadioGroupItem
                  value={value}
                  id={`target-progress-${value}`}
                  className="mt-0.5"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium text-slate-900">
                    {label}
                  </span>
                  <span className="block text-xs font-normal leading-relaxed text-slate-600">
                    {reason}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        )}

        <AlertDialogFooter className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end">
          <AlertDialogCancel className="mt-0 sm:mt-0" onClick={onCancel}>
            Cancel
          </AlertDialogCancel>
          {/* One neutral action. The variant carries no with/without meaning —
              the radio above already said which version is being downloaded. */}
          <Button
            onClick={() => onConfirm(canChooseTarget ? choice === "with" : false)}
          >
            <Download className="mr-2 h-4 w-4" />
            Download
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default TargetProgressDownloadDialog;
