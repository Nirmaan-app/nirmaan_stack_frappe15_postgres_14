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

import {
  SNAG_NO_REMARK_STATUS,
  SnagListRow,
} from "../config/snagTable.config";
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
 * Edit ONE snag's Area, Category, Description — and its Remark (owner 2026-09-04,
 * REVERSING Q4's "remark is only ever written as part of a status change").
 *
 * ⚠️ THE REMARK BOX IS OPTIONAL AND THREE-STATE, NOT A FOURTH ALWAYS-WRITTEN FIELD.
 * Untouched, it sends NOTHING (`undefined`), so the server leaves the stored text
 * exactly as it is — the same rule `SnagStatusChangeDialog` follows, and for the same
 * reason: an imported remark is destroyed by an overwrite and the source workbook on
 * the batch is the only surviving copy. Emptying the box IS a deliberate clear (`""`).
 *
 * ⚠️ `Not Applicable` STILL TAKES NO REMARK (owner Q2a). This dialog shows no editable
 * box for such a snag — the rule is REUSED from `SNAG_NO_REMARK_STATUS` rather than
 * re-expressed, and the server refuses a remark on that status whichever dialog sent
 * it, so the two surfaces cannot drift apart. Any remark such a snag already carries
 * is shown READ-ONLY: hiding it would make it look deleted when it is not.
 *
 * What is still deliberately absent:
 *
 *  - **NOT status.** It stays owned by the status change (`SnagStatusChangeDialog`,
 *    ADR-0018), which is what stamps `status_changed_by` / `status_changed_on`. Note
 *    the consequence of the remark now being editable here: a remark saved from THIS
 *    dialog does not move that stamp — correctly, since nobody moved the snag — so
 *    the row does not name who wrote it. The Version log does.
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
  const storedRemark = snag?.remark ?? "";

  const [area, setArea] = React.useState(snag?.area ?? "");
  const [category, setCategory] = React.useState(snag?.category ?? "");
  const [description, setDescription] = React.useState(snag?.description ?? "");
  const [remark, setRemark] = React.useState(storedRemark);

  if (!snag) return null;

  const takesNoRemark = snag.status === SNAG_NO_REMARK_STATUS;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    const ok = await onSubmit({
      snag: snag.name,
      area: area.trim(),
      category: category.trim(),
      description: description.trim(),
      // Untouched -> send NOTHING, so the stored text is left alone; a status that
      // takes no remark sends nothing either, since there is no box to touch. NOT
      // trimmed: `update_snag_status` does not trim a remark, and one remark-write
      // rule means the same text stores the same way from either dialog.
      remark:
        takesNoRemark || remark === storedRemark ? undefined : remark,
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
            Area, Category, Description and Remark. The status itself is changed
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

          {/* OPTIONAL, and only when the status allows one at all. */}
          {takesNoRemark ? (
            <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-800">
              A snag marked <span className="font-medium">{SNAG_NO_REMARK_STATUS}</span>{" "}
              takes no remark. Change its status from the row if you need to record a
              note.
              {storedRemark.trim() ? (
                <div className="mt-1.5 whitespace-pre-wrap border-t border-amber-200 pt-1.5 text-amber-900">
                  <span className="font-medium">Existing remark:</span> {storedRemark}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="snag-edit-remark">
                Remark{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="snag-edit-remark"
                rows={3}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="A note about this snag — what was done, or what is blocking it…"
              />
              <p className="text-[11px] text-muted-foreground">
                {storedRemark.trim()
                  ? "This replaces the existing remark. Clearing the box removes it."
                  : "Leave blank if there is nothing to record."}
              </p>
            </div>
          )}

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
