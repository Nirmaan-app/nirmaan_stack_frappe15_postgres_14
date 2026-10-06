// What "Download binder" is about to build, shown BEFORE the build starts (owner 2026-10-06): the Done
// documents that go in -- each behind its cover page and the logo page -- and the ones skipped because
// they are not Done (no cover page, no pages; they stay on the checklist as YES). The list is
// `hodRules.binderContents`, which mirrors the server's own selection, so the dialog and the PDF agree.
//
// The build's progress shows HERE and nowhere else (owner 2026-10-06): the dialog stays open while the
// server builds, and the card's button stays a plain "Download binder". Closing it does not stop the
// build -- the PDF still downloads -- and opening it again shows the progress.

import { BookOpenText, CheckCircle2, Loader2, MinusCircle } from "lucide-react";
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
import { cn } from "@/lib/utils";

import { binderContents, STATUS_STYLE, type BinderEntry } from "./hodRules";
import type { HodDocumentMeta, HodRow } from "./types";
import type { BinderProgress } from "./useHodBinder";

const Entry: React.FC<{ entry: BinderEntry }> = ({ entry }) => (
  <li className="flex items-center gap-2 py-1 text-sm">
    <span className="w-6 shrink-0 text-right text-xs tabular-nums text-gray-500">
      {entry.sno}
    </span>
    <span className="flex-1 truncate text-gray-900" title={entry.meta.title}>
      {entry.meta.title}
    </span>
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        STATUS_STYLE[entry.row.status] ?? STATUS_STYLE["Not Started"],
      )}
    >
      {entry.row.status}
    </span>
  </li>
);

export const BinderDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "HVAC SYSTEM" -- the package the binder is for. */
  displayName: string;
  rows: HodRow[];
  documents: HodDocumentMeta[];
  /** THIS package's binder is being built. */
  building: boolean;
  progress: BinderProgress | null;
  onDownload: () => void;
}> = ({
  open,
  onOpenChange,
  displayName,
  rows,
  documents,
  building,
  progress,
  onDownload,
}) => {
  const { included, skipped, off } = React.useMemo(
    () => binderContents(rows, documents),
    [rows, documents],
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A flex column, so only the lists scroll (when they need to): the title, the progress and the
          buttons stay in view however many documents a package has. */}
      <DialogContent className="flex max-h-[88vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>Download binder — {displayName}</DialogTitle>
          <DialogDescription>
            Cover, logo page and checklist first. Then every Done document, each
            behind its own cover page and the logo page.
          </DialogDescription>
        </DialogHeader>

        <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
          {building ? (
            // While the binder builds, its progress TAKES THE PLACE of the lists (owner 2026-10-06).
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-semibold text-gray-900">
                {progress
                  ? `Building ${progress.done} of ${progress.total}`
                  : "Starting…"}
              </p>
              <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{
                    width: `${progress && progress.total ? (progress.done / progress.total) * 100 : 3}%`,
                  }}
                />
              </div>
              {progress?.label && (
                <p className="max-w-xs truncate text-xs text-gray-600">
                  {progress.label}
                </p>
              )}
              <p className="text-[11px] text-gray-500">
                You can close this — the PDF downloads by itself when it is
                ready.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <section>
                <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-green-700">
                  <CheckCircle2 className="h-4 w-4" />
                  Goes into the binder ({included.length})
                </p>
                {included.length ? (
                  <ul className="divide-y rounded-md border px-3">
                    {included.map((e) => (
                      <Entry key={e.row.name} entry={e} />
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-md border border-dashed px-3 py-2 text-xs text-gray-500">
                    No document is Done yet — the binder holds the cover, the
                    logo page and the checklist only.
                  </p>
                )}
              </section>

              {skipped.length > 0 && (
                <section>
                  <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-600">
                    <MinusCircle className="h-4 w-4" />
                    Skipped — not Done ({skipped.length})
                  </p>
                  <p className="mb-1 text-xs text-gray-500">
                    No cover page and no pages. They stay on the checklist as
                    YES.
                  </p>
                  <ul className="divide-y rounded-md border bg-gray-50/60 px-3">
                    {skipped.map((e) => (
                      <Entry key={e.row.name} entry={e} />
                    ))}
                  </ul>
                </section>
              )}

              {off > 0 && (
                <p className="text-xs text-gray-500">
                  {off} disabled document{off === 1 ? " is" : "s are"} left off
                  the checklist and the binder.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {building ? "Close" : "Cancel"}
          </Button>
          <Button onClick={onDownload} disabled={building}>
            {building ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <BookOpenText className="mr-1 h-4 w-4" />
            )}
            {building ? "Building…" : "Download binder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
