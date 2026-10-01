/**
 * "Download All Batches" — the dialog the tab-row Download All button opens.
 *
 * Two choices and nothing else:
 *  - REPORT TYPE: `full` (master summary + every snag, one page per category — the
 *    DEFAULT, and the file Download All produced before this dialog existed, now with
 *    the master page in front) or `summary` (the master summary alone).
 *  - "Include Not Applicable" (DEFAULT ON). It can only NARROW the list's own Status
 *    filter — never add a status the list hides. The rule is the pure
 *    `resolveDownloadAllStatuses` in `download/snagDownloadParams.ts`; this component
 *    only renders its verdict, so the rule has one home.
 *
 * Everything ELSE that narrows the file (Status / Area / Category / search) is the
 * list's own toolbar, and is quoted back here as a read-only note rather than
 * re-offered — a second set of filter controls would only be a chance to disagree
 * with the screen behind the dialog.
 *
 * COUNTS COME ONLY FROM DATA ALREADY LOADED (the page's one `get_snag_stats` call —
 * no new request). That call counts by batch × status and nothing else, so:
 *  - the snag count is shown only when no Area / Category / search narrowing is
 *    active — with one, the stats cannot say how many rows survive it, and a
 *    project-wide number over a filtered file would be confidently wrong. It is
 *    OMITTED, never approximated.
 *  - it sums BATCHED snags only: the file's sections are one per batch, so a manually
 *    added snag (no batch) lands in none of them.
 *  - it follows the checkbox live (the N/A rows leave the count when unticked).
 *
 * MOUNTED ONLY WHILE OPEN (the caller renders it conditionally, like the Add / Edit
 * dialogs on this tab) so every open starts from the defaults — a download is a
 * one-off choice, not a preference to remember.
 */

import * as React from "react";
import { Download, Info, Loader2 } from "lucide-react";
import { ColumnFiltersState } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { cn } from "@/lib/utils";

import {
  DEFAULT_DOWNLOAD_ALL_OPTIONS,
  DEFAULT_PRINTED_STATUSES,
  NOT_APPLICABLE_STATUS,
  SnagDownloadAllMode,
  SnagDownloadAllOptions,
  describeDownloadAllFilters,
  hasUncountableNarrowing,
  listStatusFilter,
  resolveDownloadAllStatuses,
} from "../download";
import { SnagStatsSummary, SnagStatus } from "../types";

export interface SnagDownloadAllDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display name for the subtitle; falls back to the id. */
  projectLabel: string;
  /** `Project Snag Batch.name` of every batch — the file's sections, one each. */
  batchIds: readonly string[];
  /**
   * The page's already-loaded stats, or `null` when they are not usable (still
   * loading, or refused for this role) — counts are then omitted, never shown as 0.
   */
  stats: SnagStatsSummary | null;
  /** The list's live toolbar state — the same values the download URL is built from. */
  columnFilters: ColumnFiltersState;
  searchTerm?: string;
  selectedSearchField?: string;
  isDownloading: boolean;
  /** Resolves `true` once the file is saved; the dialog closes only then. */
  onDownload: (options: SnagDownloadAllOptions) => Promise<boolean>;
}

const REPORT_TYPES: Array<{
  value: SnagDownloadAllMode;
  title: string;
  description: string;
}> = [
  {
    value: "full",
    title: "Full report",
    description: "Master summary + every snag, one page per category",
  },
  {
    value: "summary",
    title: "Summary only",
    description: "Master summary: per-file status and category counts",
  },
];

const batchCountLabel = (n: number): string => `${n} batch${n === 1 ? "" : "es"}`;

export const SnagDownloadAllDialog: React.FC<SnagDownloadAllDialogProps> = ({
  open,
  onOpenChange,
  projectLabel,
  batchIds,
  stats,
  columnFilters,
  searchTerm,
  selectedSearchField,
  isDownloading,
  onDownload,
}) => {
  const [mode, setMode] = React.useState<SnagDownloadAllMode>(
    DEFAULT_DOWNLOAD_ALL_OPTIONS.mode
  );
  const [includeNotApplicable, setIncludeNotApplicable] = React.useState(
    DEFAULT_DOWNLOAD_ALL_OPTIONS.includeNotApplicable
  );

  const listStatuses = React.useMemo(() => listStatusFilter(columnFilters), [columnFilters]);

  // The ONE statuses rule, shared with the URL builder. `empty` = the list is filtered
  // to N/A alone and the box is unticked — nothing left to print.
  const { statuses, empty: nothingToDownload } = resolveDownloadAllStatuses(
    listStatuses,
    includeNotApplicable
  );

  // Whether the checkbox can matter at all: with the list filtered to statuses that
  // exclude N/A, there are no N/A rows for it to add or remove.
  const listAdmitsNotApplicable =
    listStatuses.length === 0 || listStatuses.includes(NOT_APPLICABLE_STATUS);

  // --- Counts (from loaded stats only; see the header on when they are omitted) ---
  const countable =
    !!stats &&
    !hasUncountableNarrowing({ columnFilters, searchTerm, selectedSearchField });

  const sumOverBatches = React.useCallback(
    (wanted: readonly string[]): number => {
      if (!stats) return 0;
      let total = 0;
      for (const id of batchIds) {
        const slice = stats.by_batch[id];
        if (!slice) continue;
        for (const s of wanted) total += slice.by_status[s as SnagStatus] ?? 0;
      }
      return total;
    },
    [stats, batchIds]
  );

  const snagCount = countable
    ? sumOverBatches(statuses ?? [...DEFAULT_PRINTED_STATUSES])
    : null;
  const notApplicableCount =
    countable && listAdmitsNotApplicable ? sumOverBatches([NOT_APPLICABLE_STATUS]) : null;

  const filterNotes = describeDownloadAllFilters({
    columnFilters,
    searchTerm,
    selectedSearchField,
  });

  const subtitle = [
    projectLabel,
    batchCountLabel(batchIds.length),
    snagCount === null ? null : `${snagCount} snag${snagCount === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const naHelper = includeNotApplicable
    ? `Snags marked N/A are listed and counted${
        notApplicableCount ? ` (${notApplicableCount} in this file)` : ""
      }.`
    : `N/A snags will be left out${
        notApplicableCount ? ` (${notApplicableCount} snag${notApplicableCount === 1 ? "" : "s"})` : ""
      }.`;

  const handleDownload = async () => {
    const ok = await onDownload({ mode, includeNotApplicable });
    // Closed ONLY on success: a failure has already been toasted by the hook, and
    // leaving the dialog up keeps the user's choices on screen for a retry.
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      // A download in flight cannot be dismissed (Escape / overlay / ✕) — the fetch
      // would carry on and save a file with no dialog left to say it was coming.
      onOpenChange={(next) => {
        if (!isDownloading) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            Download All Batches
          </DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* ── Report type ─────────────────────────────────────────── */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Report type
            </p>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as SnagDownloadAllMode)}
              // One column on a phone, side by side from `sm` up.
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              disabled={isDownloading}
            >
              {REPORT_TYPES.map((t) => {
                const id = `snag-download-all-${t.value}`;
                const selected = mode === t.value;
                return (
                  // The whole card is the label, so a click anywhere on it selects.
                  <Label
                    key={t.value}
                    htmlFor={id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-gray-200 hover:bg-gray-50",
                      isDownloading && "cursor-not-allowed opacity-70"
                    )}
                  >
                    <RadioGroupItem id={id} value={t.value} className="mt-0.5" />
                    <span className="space-y-1">
                      <span className="block text-sm font-semibold leading-none">
                        {t.title}
                      </span>
                      <span className="block text-xs font-normal leading-snug text-muted-foreground">
                        {t.description}
                      </span>
                    </span>
                  </Label>
                );
              })}
            </RadioGroup>
          </div>

          {/* ── Options ─────────────────────────────────────────────── */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Options
            </p>
            <div className="flex items-start gap-3">
              <Checkbox
                id="snag-download-all-include-na"
                checked={includeNotApplicable}
                onCheckedChange={(v) => setIncludeNotApplicable(v === true)}
                disabled={isDownloading}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label htmlFor="snag-download-all-include-na" className="cursor-pointer">
                  Include Not Applicable
                </Label>
                <p className="text-xs text-muted-foreground">{naHelper}</p>
              </div>
            </div>
          </div>

          {/* ── The list's own filters, quoted back (read-only) ──────── */}
          {filterNotes.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Filters from the list apply: {filterNotes.join(" · ")}</span>
            </div>
          )}

          {nothingToDownload && (
            <p className="text-xs font-medium text-destructive">
              No snags to download — the list is filtered to Not Applicable only.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isDownloading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDownload}
            disabled={isDownloading || nothingToDownload}
            title={nothingToDownload ? "No snags to download" : undefined}
          >
            {isDownloading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Preparing PDF…
              </>
            ) : nothingToDownload ? (
              "No snags to download"
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Download
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
