import { useMemo } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { SelectionState, ItemSelection } from "./types";

interface PreviewGroup {
  source_project: string;
  source_project_name: string;
  items: ItemSelection[];
}

interface TransferRequestPreviewDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  targetProjectName: string;
  selection: SelectionState;
  onConfirm: () => void;
  isSubmitting: boolean;
}

export function TransferRequestPreviewDialog({
  open,
  onOpenChange,
  targetProjectName,
  selection,
  onConfirm,
  isSubmitting,
}: TransferRequestPreviewDialogProps) {
  const groups = useMemo<PreviewGroup[]>(() => {
    return Object.entries(selection).map(([source_project, items]) => {
      const values = Object.values(items);
      return {
        source_project,
        source_project_name: values[0]?.source_project_name ?? source_project,
        items: values,
      };
    });
  }, [selection]);

  const docCount = groups.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        disableCloseIcon={false}
      >
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Transfer Request Preview
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Review the transfer requests grouped by source project before
                creating formal transfer documents.
              </p>
            </div>
            <div className="text-right shrink-0">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Target Destination
              </span>
              <p className="font-bold text-sm text-primary">
                {targetProjectName || "—"}
              </p>
            </div>
          </div>
        </DialogHeader>

        <Separator />

        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {groups.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              No selections made.
            </p>
          ) : (
            groups.map((grp, idx) => (
              <div
                key={grp.source_project}
                className="rounded-md border bg-card p-4 space-y-2"
              >
                <Badge variant="secondary" className="text-[10px]">
                  Transfer Request {idx + 1}
                </Badge>
                <p className="font-bold text-sm flex items-center gap-2 flex-wrap">
                  <span>{grp.source_project_name}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{targetProjectName}</span>
                </p>
                <ul className="space-y-1 pt-1">
                  {grp.items.map((it) => (
                    <li
                      key={it.item_id}
                      className="flex items-center justify-between text-sm border-b last:border-b-0 py-1"
                    >
                      <span className="truncate pr-2">{it.item_name}:</span>
                      <span className="tabular-nums font-medium whitespace-nowrap">
                        {it.qty.toLocaleString("en-IN")} {it.unit || "Units"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>

        <DialogFooter className="sm:flex-row sm:items-center sm:justify-between gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Inventory
          </Button>
          <p className="text-center text-xs text-muted-foreground flex-1">
            This will generate{" "}
            <span className="font-semibold">{docCount}</span> formal transfer
            document{docCount === 1 ? "" : "s"}
          </p>
          <Button
            onClick={onConfirm}
            disabled={isSubmitting || docCount === 0}
            className="gap-2"
          >
            {isSubmitting ? "Creating..." : "Create Transfer Request"}
            {!isSubmitting && <ArrowRight className="h-4 w-4" />}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
