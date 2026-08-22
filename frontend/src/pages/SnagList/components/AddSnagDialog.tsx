import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { AddManualSnagInput } from "../hooks/useSnagMutations";

export interface AddSnagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSaving?: boolean;
  /** Values this project's snags already use. SUGGESTIONS, never a closed set. */
  areaSuggestions?: string[];
  categorySuggestions?: string[];
  onSubmit: (input: AddManualSnagInput) => Promise<boolean>;
}

/**
 * Manual snag entry: area, category, description. No batch, no status picker —
 * a new snag always starts at `Pending`, exactly like an imported one.
 *
 * Area and Category are FREE TEXT by decision of record (ADR-0016). Since the
 * amendment of 2026-08-21 they ALSO offer the values already present in this
 * project as `<datalist>` suggestions — which does not reverse anything: a value
 * absent from the list is still typeable, and it must be, because the first snag in
 * a new area has no existing value to pick. ⚠️ Never promote this to a `Select`;
 * a closed list would reverse the ADR outright, and with it "correcting a typo is
 * the author's call, never the system's".
 */
export const AddSnagDialog: React.FC<AddSnagDialogProps> = ({
  open,
  onOpenChange,
  isSaving = false,
  areaSuggestions = [],
  categorySuggestions = [],
  onSubmit,
}) => {
  const [area, setArea] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [description, setDescription] = React.useState("");

  // Reset on OPEN (a user action), never in an effect keyed on `open` alone —
  // this keeps the fields from being wiped under a save in flight.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setArea("");
      setCategory("");
      setDescription("");
    }
    onOpenChange(next);
  };

  const canSubmit = description.trim().length > 0 && !isSaving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const ok = await onSubmit({
      area: area.trim(),
      category: category.trim(),
      description: description.trim(),
    });
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a snag</DialogTitle>
          <DialogDescription>
            A manually added snag belongs to no batch and starts at{" "}
            <span className="font-medium">Pending</span>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="snag-area">Area / Location</Label>
              <Input
                id="snag-area"
                list="snag-add-area-options"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="e.g. Ground Floor Lobby"
                autoFocus
              />
              <datalist id="snag-add-area-options">
                {areaSuggestions.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="snag-category">Category</Label>
              <Input
                id="snag-category"
                list="snag-add-category-options"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Electrical"
              />
              <datalist id="snag-add-category-options">
                {categorySuggestions.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="snag-description">
              Snag description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="snag-description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is wrong, and where exactly…"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSaving ? "Adding…" : "Add snag"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
