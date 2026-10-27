import { AlertTriangle, Loader2 } from "lucide-react";
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
import type { BoqListRow } from "./BoqListTable";
import { selectionActionLabel, selectionConfirmCopy, type BoqSelectionTarget } from "./boqSelection";

interface BoqSelectionConfirmDialogProps {
  /** The pending action, or null when the dialog is closed. */
  target: BoqSelectionTarget | null;
  boqs: BoqListRow[];
  /** The move would leave the project with no Selected BoQ -- the warning version (ADR-0037 D7). */
  emptiesSelected: boolean;
  saving: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** "Are you sure?" for the Admin's Mark as Selected / Move to Draft, naming every BoQ it moves. */
export function BoqSelectionConfirmDialog({
  target,
  boqs,
  emptiesSelected,
  saving,
  error,
  onConfirm,
  onClose,
}: BoqSelectionConfirmDialogProps) {
  const copy = target ? selectionConfirmCopy(target, boqs.length, emptiesSelected) : null;
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-start gap-2">
            {emptiesSelected && <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />}
            {copy?.title}
          </AlertDialogTitle>
          <AlertDialogDescription className={emptiesSelected ? "text-amber-700" : undefined}>
            {copy?.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="max-h-48 overflow-y-auto rounded-md border px-3 py-2 text-sm space-y-1">
          {boqs.map((boq) => (
            <li key={boq.name}>
              {boq.boq_name || boq.name} <span className="text-muted-foreground">v{boq.version}</span>
            </li>
          ))}
        </ul>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          {/* Plain Button (not AlertDialogAction) so the dialog stays open on a backend error. */}
          <Button
            disabled={saving}
            variant={emptiesSelected ? "destructive" : "default"}
            onClick={onConfirm}
          >
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {target ? selectionActionLabel(target) : ""}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
