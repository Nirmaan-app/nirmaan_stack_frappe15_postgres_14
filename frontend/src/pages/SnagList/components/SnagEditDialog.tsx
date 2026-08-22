import * as React from "react";
import { Loader2 } from "lucide-react";

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

import { SnagListRow } from "../config/snagTable.config";
import { UpdateSnagDetailsPayload } from "../types";

export interface SnagEditDialogProps {
  /** The row being edited. `null` closes the dialog. */
  snag: SnagListRow | null;
  /**
   * The HUMAN batch name for `snag.batch`, resolved by the page against the
   * already-loaded batch list. `null` = a manually added snag (no batch).
   */
  batchName: string | null;
  /** Free-text SUGGESTIONS, never a closed set — ADR-0016 amendment. */
  areaSuggestions: string[];
  categorySuggestions: string[];
  isSaving?: boolean;
  onCancel: () => void;
  onSubmit: (payload: UpdateSnagDetailsPayload) => Promise<boolean>;
}

/**
 * Edit ONE snag's Area, Category and Description — AND NOTHING ELSE (owner Q3).
 *
 * What is deliberately absent, and why each absence is load-bearing:
 *
 *  - **NOT status, NOT remark** (owner Q4). Both are owned by the status change
 *    (`SnagStatusChangeDialog`, ADR-0018), whose "Not Applicable takes no remark"
 *    carve-out would have to be reimplemented here and would then be free to drift.
 *    One field, one write path.
 *  - **NOT `batch` / `source_row` / `project`.** These are PROVENANCE: they answer
 *    "where did this come from", and an editable answer is worth nothing. The batch
 *    is SHOWN, read-only — with the Batch column and the Batch filter both gone
 *    (Revision 3), this dialog is the ONLY remaining surface that answers it.
 *
 * ⚠️ THE DESCRIPTION MAY BE BLANK. ADR-0019 dropped `reqd` from the field, so a
 * required check here would refuse what the server accepts. Do not add one.
 *
 * ⚠️ Area and Category are FREE TEXT with `<datalist>` SUGGESTIONS (ADR-0016 and its
 * 2026-08-21 amendment), never a `Select`: a closed list cannot express the first
 * snag in a new area, and it would make the system, not the author, the authority
 * on how a place is spelled.
 *
 * Mounted only while a row is being edited (`snag !== null`), so the three drafts
 * are seeded by `useState` on mount and no background refetch can clobber typing.
 * The `key` the caller supplies is what re-seeds them for a different row.
 */
export const SnagEditDialog: React.FC<SnagEditDialogProps> = ({
  snag,
  batchName,
  areaSuggestions,
  categorySuggestions,
  isSaving = false,
  onCancel,
  onSubmit,
}) => {
  const [area, setArea] = React.useState(snag?.area ?? "");
  const [category, setCategory] = React.useState(snag?.category ?? "");
  const [description, setDescription] = React.useState(snag?.description ?? "");

  if (!snag) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    const ok = await onSubmit({
      snag: snag.name,
      area: area.trim(),
      category: category.trim(),
      description: description.trim(),
    });
    if (ok) onCancel();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isSaving) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit snag</DialogTitle>
          <DialogDescription>
            Area, Category and Description only. Status and Remarks are changed
            from the status control on the row.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="snag-edit-area">Area / Location</Label>
              <Input
                id="snag-edit-area"
                list="snag-edit-area-options"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="e.g. Ground Floor Lobby"
                autoFocus
              />
              <datalist id="snag-edit-area-options">
                {areaSuggestions.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="snag-edit-category">Category</Label>
              <Input
                id="snag-edit-category"
                list="snag-edit-category-options"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Electrical"
              />
              <datalist id="snag-edit-category-options">
                {categorySuggestions.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="snag-edit-description">Snag description</Label>
            <Textarea
              id="snag-edit-description"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is wrong, and where exactly…"
            />
          </div>

          {/* PROVENANCE — read-only, and the only place it is still shown. */}
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="font-medium">Imported from:</span>{" "}
            {batchName ? (
              <span>
                {batchName}
                {snag.source_row ? ` · Excel row ${snag.source_row}` : ""}
              </span>
            ) : (
              // `source_row` is a Frappe Int, so an unset one reads back as 0, never
              // null — falsiness is the test (see `ProjectSnag` in `types.ts`).
              <span>Added manually (no import batch)</span>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
