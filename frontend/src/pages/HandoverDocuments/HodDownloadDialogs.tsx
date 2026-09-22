// The two dialogs around a server-built handover PDF: the progress of a running build, and — before a binder
// starts — the switched-on documents that have nothing to include (owner 2026-09-22: don't start; say which
// and let the user switch them off).

import { AlertTriangle, Loader2 } from "lucide-react";
import * as React from "react";

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { BinderProgress, EmptyDocument, HodJob } from "./useHodBinder";

export const DownloadProgressDialog: React.FC<{
  open: boolean;
  job: HodJob | null;
  progress: BinderProgress | null;
  onHide: () => void;
}> = ({ open, job, progress, onHide }) => {
  const pct =
    progress && progress.total
      ? Math.round((progress.done / progress.total) * 100)
      : 0;
  return (
    <Dialog open={open && !!job} onOpenChange={(o) => !o && onHide()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            {job?.document
              ? `Preparing ${job.title}`
              : "Building the handover binder"}
          </DialogTitle>
          <DialogDescription>
            {job?.document ? job.hodSystem : job?.title}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress ? pct : 4}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-gray-600">
            <span className="truncate">
              {progress?.label ? `Adding: ${progress.label}` : "Starting…"}
            </span>
            <span className="shrink-0 font-medium">
              {progress
                ? `${progress.done} of ${progress.total} · ${pct}%`
                : ""}
            </span>
          </div>
          <p className="pt-1 text-xs text-gray-500">
            The PDF downloads by itself when it is ready. You can hide this
            window; the build carries on.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onHide}>
            Hide
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const EmptyDocumentsDialog: React.FC<{
  open: boolean;
  empty: EmptyDocument[];
  canEdit: boolean;
  onCancel: () => void;
  /** Switch these documents off, then build the binder. */
  onSwitchOffAndBuild: () => Promise<void>;
}> = ({ open, empty, canEdit, onCancel, onSwitchOffAndBuild }) => {
  const [busy, setBusy] = React.useState(false);
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Nothing to download for {empty.length} document
            {empty.length !== 1 ? "s" : ""}
          </AlertDialogTitle>
          <AlertDialogDescription>
            These documents are switched on but have nothing to put in the
            binder yet. Switch them off (or add their content) and try again.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border bg-amber-50/60 p-3 text-sm">
          {empty.map((e) => (
            <li key={e.document}>
              <span className="font-medium text-gray-900">{e.title}</span>
              <span className="text-gray-600"> — {e.reason}</span>
            </li>
          ))}
        </ul>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          {canEdit && (
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onSwitchOffAndBuild();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Switch off &amp; download
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
