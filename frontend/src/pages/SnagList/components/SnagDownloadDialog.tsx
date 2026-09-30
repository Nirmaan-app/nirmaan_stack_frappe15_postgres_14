/**
 * "Download Snag List" — the dialog the stats-row Download button opens (a file tab).
 *
 * Two choices, mirroring the Download All dialog:
 *  - REPORT TYPE: `full` (the tab's normal report — the DEFAULT) or `summary` (only
 *    this file's summary block: tiles + category table, titled "Snag List — Summary").
 *  - "Include Not Applicable" (DEFAULT ON). It can only NARROW the list's own Status
 *    filter — never add a status the list hides. The rule is the SAME pure
 *    `resolveDownloadAllStatuses` the Download All dialog uses, so the two downloads
 *    can never disagree about what the box means.
 *
 * Everything else that narrows the file (tab / Status / Area / Category / search) is the
 * list's own toolbar, quoted back as a read-only note rather than re-offered.
 *
 * COUNTS COME ONLY FROM THE TAB'S ALREADY-LOADED STATS (no new request). Those count by
 * status and nothing else, so the counts are OMITTED — never approximated — while an
 * Area / Category / search narrowing is active.
 *
 * MOUNTED ONLY WHILE OPEN, so every open starts from the default (N/A included).
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
  DEFAULT_DOWNLOAD_OPTIONS,
  DEFAULT_PRINTED_STATUSES,
  NOT_APPLICABLE_STATUS,
  SnagDownloadAllMode,
  SnagDownloadOptions,
  describeDownloadAllFilters,
  hasUncountableNarrowing,
  listStatusFilter,
  resolveDownloadAllStatuses,
} from "../download";
import { SnagBatchStats, SnagStatus } from "../types";

export interface SnagDownloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display name for the subtitle; falls back to the id. */
  projectLabel: string;
  /**
   * The CURRENT TAB's stats (the same slice the stats strip shows), or `null` while
   * loading / refused — counts are then omitted, never shown as 0.
   */
  tabStats: SnagBatchStats | null;
  /** The list's live toolbar state — the same values the download URL is built from. */
  columnFilters: ColumnFiltersState;
  searchTerm?: string;
  selectedSearchField?: string;
  isDownloading: boolean;
  /** Resolves `true` once the file is saved; the dialog closes only then. */
  onDownload: (options: SnagDownloadOptions) => Promise<boolean>;
}

const REPORT_TYPES: Array<{
  value: SnagDownloadAllMode;
  title: string;
  description: string;
}> = [
  {
    value: "full",
    title: "Full report",
    description: "Summary + every snag, one page per category",
  },
  {
    value: "summary",
    title: "Summary only",
    description: "This file's status and category counts",
  },
];

export const SnagDownloadDialog: React.FC<SnagDownloadDialogProps> = ({
  open,
  onOpenChange,
  projectLabel,
  tabStats,
  columnFilters,
  searchTerm,
  selectedSearchField,
  isDownloading,
  onDownload,
}) => {
  const [mode, setMode] = React.useState<SnagDownloadAllMode>(
    DEFAULT_DOWNLOAD_OPTIONS.mode,
  );
  const [includeNotApplicable, setIncludeNotApplicable] = React.useState(
    DEFAULT_DOWNLOAD_OPTIONS.includeNotApplicable,
  );

  const listStatuses = React.useMemo(
    () => listStatusFilter(columnFilters),
    [columnFilters],
  );

  // `empty` = the list is filtered to N/A alone and the box is unticked.
  const { statuses, empty: nothingToDownload } = resolveDownloadAllStatuses(
    listStatuses,
    includeNotApplicable,
  );

  const listAdmitsNotApplicable =
    listStatuses.length === 0 || listStatuses.includes(NOT_APPLICABLE_STATUS);

  const countable =
    !!tabStats &&
    !hasUncountableNarrowing({
      columnFilters,
      searchTerm,
      selectedSearchField,
    });

  const countOf = (wanted: readonly string[]): number =>
    tabStats
      ? wanted.reduce(
          (sum, s) => sum + (tabStats.by_status[s as SnagStatus] ?? 0),
          0,
        )
      : 0;

  const snagCount = countable
    ? countOf(statuses ?? [...DEFAULT_PRINTED_STATUSES])
    : null;
  const notApplicableCount =
    countable && listAdmitsNotApplicable
      ? countOf([NOT_APPLICABLE_STATUS])
      : null;

  const filterNotes = describeDownloadAllFilters({
    columnFilters,
    searchTerm,
    selectedSearchField,
  });

  const subtitle = [
    projectLabel,
    snagCount === null
      ? null
      : `${snagCount} snag${snagCount === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const naHelper = includeNotApplicable
    ? `Snags marked N/A are listed and counted${
        notApplicableCount ? ` (${notApplicableCount} in this view)` : ""
      }.`
    : `N/A snags will be left out${
        notApplicableCount
          ? ` (${notApplicableCount} snag${notApplicableCount === 1 ? "" : "s"})`
          : ""
      }.`;

  const handleDownload = async () => {
    const ok = await onDownload({ mode, includeNotApplicable });
    // Closed ONLY on success: a failure is already toasted by the hook, and the
    // choice stays on screen for a retry.
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      // A download in flight cannot be dismissed — the fetch would carry on and save a
      // file with no dialog left to say it was coming.
      onOpenChange={(next) => {
        if (!isDownloading) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            Download Snag List
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
                const id = `snag-download-${t.value}`;
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
                      isDownloading && "cursor-not-allowed opacity-70",
                    )}
                  >
                    <RadioGroupItem
                      id={id}
                      value={t.value}
                      className="mt-0.5"
                    />
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
                id="snag-download-include-na"
                checked={includeNotApplicable}
                onCheckedChange={(v) => setIncludeNotApplicable(v === true)}
                disabled={isDownloading}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label
                  htmlFor="snag-download-include-na"
                  className="cursor-pointer"
                >
                  Include Not Applicable
                </Label>
                <p className="text-xs text-muted-foreground">{naHelper}</p>
              </div>
            </div>
          </div>

          {filterNotes.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Filters from the list apply: {filterNotes.join(" · ")}
              </span>
            </div>
          )}

          {nothingToDownload && (
            <p className="text-xs font-medium text-destructive">
              No snags to download — the list is filtered to Not Applicable
              only.
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
