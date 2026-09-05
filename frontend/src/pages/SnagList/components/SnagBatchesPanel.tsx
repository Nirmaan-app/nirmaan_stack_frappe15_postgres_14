import * as React from "react";
import { Download, History, Loader2 } from "lucide-react";

import SITEURL from "@/constants/siteURL";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDate } from "@/utils/FormatDate";

import { ProjectSnagBatch } from "../types";

export interface SnagBatchesPanelProps {
  batches: ProjectSnagBatch[];
  isLoading?: boolean;
}

const fileHref = (source_file?: string | null): string | null => {
  if (!source_file) return null;
  return source_file.startsWith("http") ? source_file : `${SITEURL}${source_file}`;
};

/**
 * The project's import batches — "Import History" — in a popover off the action row.
 *
 * THE TRIGGER IS ICON-ONLY, following this feature's existing icon-button
 * convention (`variant="ghost" size="icon"` + a native `title`). It keeps an
 * explicit `aria-label` because the accessible name used to BE the visible word
 * "Batches"; dropping the text without replacing the name would leave a button
 * screen readers can only call "button".
 *
 * The count moved INTO the popover header rather than onto the trigger: a badge on
 * an icon button either changes the button's height as the number gains digits, or
 * needs absolute positioning to avoid it, and neither buys anything the popover's
 * own first line cannot say. The number still rides the `aria-label`, so it is
 * announced without being opened.
 *
 * THE PANEL IS READ-ONLY (owner decision): it lists what was imported and links
 * the original workbook, and offers no way to remove a batch. Deleting one is
 * unguarded server-side (plan § 8.2, ADR-0017) — recovery means a developer reading
 * `Deleted Document` in a bench console — so the action does not belong on a
 * popover a mis-click can reach. `tracking.delete_batch` still exists for Desk and
 * for scripts; do not put it back on this surface without an owner decision.
 */
export const SnagBatchesPanel: React.FC<SnagBatchesPanelProps> = ({
  batches,
  isLoading = false,
}) => {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          title="Import history"
          aria-label={`Import history (${batches.length} batch${
            batches.length === 1 ? "" : "es"
          })`}
        >
          <History className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] p-0">
        <div className="border-b px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium">Import history</p>
            <span className="text-xs font-semibold tabular-nums text-muted-foreground">
              {batches.length}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            One batch per imported worksheet.
          </p>
        </div>

        <div className="max-h-[320px] overflow-y-auto">
          {isLoading && (
            <div className="flex items-center gap-2 px-3 py-6 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading batches…
            </div>
          )}

          {!isLoading && batches.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              Nothing imported yet.
            </p>
          )}

          {!isLoading &&
            batches.map((b) => {
              const href = fileHref(b.source_file);
              return (
                <div
                  key={b.name}
                  className="flex items-start gap-2 border-b px-3 py-2.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-xs font-medium"
                      title={b.batch_name}
                    >
                      {b.batch_name || b.name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {b.snag_count} snag{b.snag_count === 1 ? "" : "s"}
                      {b.uploaded_by ? ` · ${b.uploaded_by}` : ""}
                      {b.uploaded_on ? ` · ${formatDate(b.uploaded_on)}` : ""}
                    </p>
                    {b.source_sheet && (
                      <p
                        className="mt-0.5 truncate text-[11px] text-muted-foreground"
                        title={b.source_sheet}
                      >
                        Sheet: {b.source_sheet}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {href ? (
                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Download the original workbook"
                      >
                        <a href={href} target="_blank" rel="noreferrer">
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled
                        title="No original file was stored for this batch"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </PopoverContent>
    </Popover>
  );
};
