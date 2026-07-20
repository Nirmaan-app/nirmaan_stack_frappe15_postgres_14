import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";

interface DefineAreasDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Controlled area-name list (raw, may contain blank rows while editing). */
  value: string[];
  /** Whole-array replace. */
  onChange: (next: string[]) => void;
}

/**
 * A2 multi-area (Create-from-Template only): a lean area-name editor. Mirrors SheetConfigPanel's
 * Multi-area name list MINUS every per-sheet config side-effect (no sparkle / dropIfConfigDone).
 * Areas are defined ONCE for the WHOLE BoQ (all data sheets share the set) and are locked at
 * create time -- each becomes a per-area Quantity column; the Total Quantity is their sum.
 */
export function DefineAreasDialog({
  open,
  onOpenChange,
  value,
  onChange,
}: DefineAreasDialogProps) {
  const boxes = value.length ? value : [""];

  const setAt = (i: number, v: string) => {
    const next = [...boxes];
    next[i] = v;
    onChange(next);
  };
  const addBox = () => onChange([...boxes, ""]);
  const removeAt = (i: number) => onChange(boxes.filter((_, idx) => idx !== i));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Define areas</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Name the physical areas this BoQ&apos;s quantities are split across (floors, blocks,
            towers). Each becomes a per-area Quantity column; the Total Quantity is their sum.
          </p>

          <div className="space-y-2">
            {boxes.map((box, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={box}
                  onChange={(e) => setAt(i, e.target.value)}
                  placeholder={`Area ${i + 1}`}
                />
                {boxes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={`Remove area ${i + 1}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <Button type="button" variant="outline" size="sm" onClick={addBox}>
            <Plus className="mr-2 h-4 w-4" />
            Add area
          </Button>
        </div>

        <div className="flex justify-end border-t border-border pt-3">
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
