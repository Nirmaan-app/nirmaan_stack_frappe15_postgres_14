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
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/FormatDate";

import { ProjectSnagBatch } from "../types";

/**
 * Longest batch name the server accepts. `Project Snag Batch.batch_name` is a Data field
 * (varchar 140); mirrors `tracking.BATCH_NAME_MAX_LEN`, which is the real boundary.
 */
const BATCH_NAME_MAX_LENGTH = 140;

/**
 * How two batch names are compared for "the same name": case and spacing ignored.
 * Mirrors `tracking._batch_name_key`, which is the real boundary — this only lets the
 * dialog say so while the user types, instead of after they press Rename.
 */
const batchNameKey = (name: string): string =>
  name.trim().split(/\s+/).join(" ").toLowerCase();

export interface RenameBatchDialogProps {
  /** The batch being renamed. The page resolves it against the loaded batch list. */
  batch: ProjectSnagBatch;
  /** The names of the project's OTHER batches — a new name may not match any of them. */
  otherBatchNames: string[];
  isSaving?: boolean;
  onCancel: () => void;
  /** `useSnagMutations().renameBatch` — resolves `true` once the server accepted it. */
  onSubmit: (batch: string, batchName: string) => Promise<boolean>;
}

/**
 * Rename ONE batch — the label its tab, Import History and the downloaded PDF show.
 * Opened from the pencil on a batch tab or on an Import History row.
 *
 * The CURRENT name is shown in full because the tab truncates it (the whole reason a
 * rename is wanted is usually that the upload's file name is long and unreadable).
 *
 * Only the label moves: the snags link to the batch by its document `name`, and the
 * original workbook keeps its own file name — the note under the field says so, because
 * "rename" next to an imported file can otherwise read as touching the file.
 *
 * Mounted only while open and KEYED on the batch by the caller, so the draft is seeded by
 * `useState` on mount — the same shape as `SnagEditDialog`.
 */
export const RenameBatchDialog: React.FC<RenameBatchDialogProps> = ({
  batch,
  otherBatchNames,
  isSaving = false,
  onCancel,
  onSubmit,
}) => {
  const currentName = batch.batch_name || batch.name;
  const [name, setName] = React.useState(currentName);

  const takenKeys = React.useMemo(
    () => new Set(otherBatchNames.map(batchNameKey)),
    [otherBatchNames]
  );

  const next = name.trim();
  const isChanged = !!next && next !== currentName;
  // Only a CHANGED name is checked: leaving the current one alone is never an error, even
  // on a batch that already shares its name (imports do not apply this rule).
  const isDuplicate = isChanged && takenKeys.has(batchNameKey(next));
  const canSave = isChanged && !isDuplicate && !isSaving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    const ok = await onSubmit(batch.name, next);
    if (ok) onCancel();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isSaving) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename batch</DialogTitle>
          <DialogDescription>
            The name shown on this batch's tab, in Import history and on the downloaded
            PDF.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-md border bg-muted/40 px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Current name
            </p>
            <p className="mt-0.5 break-all text-sm">{currentName}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {batch.snag_count} snag{batch.snag_count === 1 ? "" : "s"}
              {batch.uploaded_on ? ` · Imported ${formatDate(batch.uploaded_on)}` : ""}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="snag-batch-rename">New name</Label>
            <Input
              id="snag-batch-rename"
              autoFocus
              value={name}
              maxLength={BATCH_NAME_MAX_LENGTH}
              disabled={isSaving}
              onChange={(e) => setName(e.target.value)}
              // Seeded with the current name and selected, so typing replaces it outright
              // while a small fix is still one click away.
              onFocus={(e) => e.currentTarget.select()}
              placeholder="e.g. Block A – Round 2"
              aria-invalid={isDuplicate}
              aria-describedby="snag-batch-rename-hint"
              className={cn(
                isDuplicate && "border-destructive focus-visible:ring-destructive"
              )}
            />
            <div
              id="snag-batch-rename-hint"
              className="flex items-start justify-between gap-3 text-[11px]"
            >
              {isDuplicate ? (
                <span className="text-destructive">
                  Another batch in this project is already called this. Choose a
                  different name.
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Only the name changes — the snags in this batch and the original file
                  stay as they are.
                </span>
              )}
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {name.length}/{BATCH_NAME_MAX_LENGTH}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                "Rename"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
