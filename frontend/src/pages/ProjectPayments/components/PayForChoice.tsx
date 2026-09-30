import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { formatToIndianRupeeOrZero } from "@/utils/FormatPrice";
import { gstLeftNote, PayFor, WorkOrderLimit } from "./paymentSummaryView";

interface PayForChoiceProps {
  limit: WorkOrderLimit;
  value: PayFor;
  onChange: (value: PayFor) => void;
  /** Keeps the radio ids unique when two dialogs on one page both render the choice. */
  idPrefix?: string;
}

/**
 * Pay for: Base / GST on a GST-on Work Order (ADR-0030), each with its own "left" from the server's
 * Work Order payment limit. Shared by Request Payment and the Accountant's paid entry, so both
 * offer the same choice with the same figures.
 */
export const PayForChoice = ({ limit, value, onChange, idPrefix = "pay-for" }: PayForChoiceProps) => (
  <div className="space-y-1.5">
    <Label className="text-sm font-medium">Pay for</Label>
    <RadioGroup value={value} onValueChange={v => onChange(v as PayFor)} className="grid-cols-2 gap-2">
      {([
        ["base", "Base", limit.base_left, null],
        ["gst", "GST", limit.gst_left, gstLeftNote(limit)],
      ] as const).map(([part, label, left, note]) => {
        // Total left can bind below a part's own left (an old WO paid past its base value); the
        // server says when it does.
        const totalNote = left > 0 && limit.caps[part].binds === "total"
          ? `Only ${formatToIndianRupeeOrZero(limit.caps[part].cap)} left in the WO total`
          : null;
        return (
          <Label key={part} htmlFor={`${idPrefix}-${part}`}
                 className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 ${value === part ? "border-primary bg-primary/5" : ""}`}>
            <RadioGroupItem value={part} id={`${idPrefix}-${part}`} className="mt-0.5" />
            <span className="space-y-0.5">
              <span className="block font-medium">{label}</span>
              <span className="block text-xs text-muted-foreground tabular-nums">
                {formatToIndianRupeeOrZero(Math.max(0, left))} left
              </span>
              {(note || totalNote) &&
                <span className="block text-[11px] text-amber-700 dark:text-amber-400">{note || totalNote}</span>}
            </span>
          </Label>
        );
      })}
    </RadioGroup>
  </div>
);
