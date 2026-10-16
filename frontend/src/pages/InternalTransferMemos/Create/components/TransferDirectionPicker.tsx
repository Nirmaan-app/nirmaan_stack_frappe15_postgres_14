import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { TRANSFER_DIRECTIONS, type TransferDirection } from "@/utils/itmTransfer";

const OPTIONS: Record<TransferDirection, { label: string; description: string }> = {
  "project-to-project": {
    label: "Project → Project",
    description: "Move stock from one project to another.",
  },
  "project-to-warehouse": {
    label: "Project → Warehouse",
    description: "Send a project's stock back to the warehouse.",
  },
  "warehouse-to-project": {
    label: "Warehouse → Project",
    description: "Send warehouse stock to a project.",
  },
};

const isDirection = (v: string): v is TransferDirection =>
  (TRANSFER_DIRECTIONS as readonly string[]).includes(v);

interface TransferDirectionPickerProps {
  /** Directions this user may start, in display order. */
  allowed: TransferDirection[];
  value: TransferDirection | null;
  onChange: (direction: TransferDirection) => void;
  disabled?: boolean;
}

/** The New Transfer page's direction choice: one row of radio buttons. */
export function TransferDirectionPicker({
  allowed,
  value,
  onChange,
  disabled,
}: TransferDirectionPickerProps) {
  return (
    <RadioGroup
      // "" keeps the group controlled while nothing is chosen yet.
      value={value ?? ""}
      onValueChange={(v) => isDirection(v) && onChange(v)}
      disabled={disabled}
      className="flex flex-wrap items-center gap-x-6 gap-y-2"
    >
      {allowed.map((direction) => (
        <div key={direction} className="flex items-center gap-2" title={OPTIONS[direction].description}>
          <RadioGroupItem value={direction} id={`transfer-${direction}`} />
          <Label htmlFor={`transfer-${direction}`} className="cursor-pointer text-sm font-normal">
            {OPTIONS[direction].label}
          </Label>
        </div>
      ))}
    </RadioGroup>
  );
}
