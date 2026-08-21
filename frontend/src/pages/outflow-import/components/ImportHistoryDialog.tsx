// src/pages/outflow-import/components/ImportHistoryDialog.tsx

import { useMemo } from "react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import type { OutflowImportOption } from "@/types/NirmaanStack/OutflowImportBatch";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import {
    importPeriodLabel,
    importStatusTone,
    importUploaderLabel,
    importsForSource,
} from "../outflowTableModel";

/**
 * How many statements the dialog shows. A HARD STOP, with no "show more" (owner ruling).
 *
 * ⚠️ IT IS A GLANCE, NOT AN ARCHIVE BROWSER. The Import selector above the summary already reaches
 * sixty and is the control for finding an old statement. A paging affordance here would be a second
 * way to do the same job, in a dialog whose whole value is being readable in one look.
 */
export const HISTORY_LIMIT = 10;

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Every import, newest first — `list_imports` is ordered for this (slice CF/S3). */
    imports: OutflowImportOption[];
    /**
     * The screen's source scope. The dialog OBEYS it and ignores the period (owner ruling).
     *
     * ⚠️ SOURCE YES, PERIOD NO, AND THE ASYMMETRY IS DELIBERATE. This is a list of FILES, and a
     * file's period is a COLUMN in it — filtering the list by a window would make that column
     * half-true, showing statements whose declared period only partly overlaps. But a reader who has
     * narrowed the screen to petty cash and is offered bank statements is being offered rows they
     * cannot act on: every row here is a way to select an import.
     */
    sources: readonly string[];
    /** The statement currently pinned, if any. Marked rather than hidden. */
    selectedImport?: string;
    /** Select a statement. The dialog closes itself; the caller navigates. */
    onSelectImport: (batch: string) => void;
    loading?: boolean;
}

/**
 * The last ten statements, with what each one brought in (slice CF/S4).
 *
 * ⚠️ IT REPLACED A LINE AT THE FOOT OF THE SUMMARY CARD, and what that line was doing is worth
 * recording. It listed the filenames in scope with their row counts, and its real job was to state
 * the set "Re-run match" acts on — in full, including the transfers outside the period. That job
 * did NOT move here: the caption under the Re-run button carries it now (slice CF/S5). This dialog
 * answers a different question — "what has been imported lately, and did it finish?" — which the
 * card had no room to answer at all.
 *
 * ⚠️ EVERY FIGURE IS THE SERVER'S. Nothing here counts or sums anything; `list_imports` returns
 * `successful_rows` and `gross_amount` already paired to the same population. A dialog that added up
 * its own numbers could disagree with the summary panel behind it, which is worse than showing no
 * dialog at all.
 */
export const ImportHistoryDialog = ({
    open,
    onOpenChange,
    imports,
    sources,
    selectedImport,
    onSelectImport,
    loading,
}: Props) => {
    const shown = useMemo(
        () => importsForSource(imports, sources).slice(0, HISTORY_LIMIT),
        [imports, sources]
    );

    const scoped = sources.length === 1 ? sources[0] : null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Import history</DialogTitle>
                    <DialogDescription>
                        {/* The subtitle states the scope rather than describing the feature. A
                            reader who narrowed the screen needs to know this list is narrowed too;
                            everyone else needs one short sentence and no explanation. */}
                        {scoped
                            ? `The last ${HISTORY_LIMIT} ${scoped} statements. Select one to open it.`
                            : `The last ${HISTORY_LIMIT} statements. Select one to open it.`}
                    </DialogDescription>
                </DialogHeader>

                {loading && !shown.length ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        Loading imports…
                    </p>
                ) : !shown.length ? (
                    /* An empty screen is an invitation to act, not a shrug. The two cases read
                       differently on purpose: nothing imported at all is a different problem from a
                       source scope hiding everything, and only one of them is fixed here. */
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        {scoped
                            ? `No ${scoped} statements yet. Change the Source filter, or import one.`
                            : "No statements yet. Import one to get started."}
                    </p>
                ) : (
                    <ul className="-mx-2 divide-y">
                        {shown.map((option) => (
                            <HistoryRow
                                key={option.name}
                                option={option}
                                current={option.name === selectedImport}
                                onSelect={() => {
                                    onSelectImport(option.name);
                                    onOpenChange(false);
                                }}
                            />
                        ))}
                    </ul>
                )}
            </DialogContent>
        </Dialog>
    );
};

/**
 * One statement.
 *
 * ⚠️ THE COUNT IS `successful_rows`, NEVER `total_rows`, BECAUSE IT SITS BESIDE `gross_amount`.
 * That amount has excluded bank-refused transfers since parse time (invariant 13), so pairing it
 * with a count that includes them would put two figures describing different populations on one
 * line — the same defect as a chip reading 20 that opens a list of 47.
 */
const HistoryRow = ({
    option,
    current,
    onSelect,
}: {
    option: OutflowImportOption;
    current: boolean;
    onSelect: () => void;
}) => {
    const transfers = option.successful_rows ?? 0;
    /**
     * ⚠️ THE UPLOADER READS THE SAME HERE AS IN THE IMPORT PICKER, AND THAT IS THE REASON IT IS
     * HERE AT ALL. Both surfaces are fed by the SAME `list_imports`, and both exist to let a reader
     * identify a statement — so if they disagreed about what one looks like, the reader would have
     * to learn two descriptions of one file. Period first, then the uploader, in both.
     *
     * ⚠️ BLANK DROPS THE SEPARATOR WITH IT. A dangling ` · ` reads as a value that failed to render
     * rather than one that was never recorded. The full user id goes in `title`, which is the
     * display/stored split `importUploaderLabel` documents.
     */
    const uploader = importUploaderLabel(option);

    return (
        <li>
            <button
                type="button"
                onClick={onSelect}
                aria-current={current ? "true" : undefined}
                className={`grid w-full grid-cols-[1fr_auto] items-center gap-4 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    current ? "bg-muted/40" : ""
                }`}
            >
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                            {option.original_filename || option.name}
                        </span>
                        {/* The source is a KIND, not a status — a quiet micro-label rather than a
                            second chip competing with the one that carries the actionable fact. */}
                        {option.source && (
                            <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                                {option.source}
                            </span>
                        )}
                        {current && (
                            <span className="shrink-0 text-[10px] uppercase tracking-wide text-primary">
                                Open
                            </span>
                        )}
                    </div>
                    <div
                        className="truncate text-xs text-muted-foreground"
                        title={option.uploaded_by || undefined}
                    >
                        {importPeriodLabel(option)}
                        {uploader ? ` · ${uploader}` : ""}
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {/* `tabular-nums` on both figures so they align down the list. Ten rows of
                        right-aligned money is the one place proportional digits cost real
                        scanning speed. */}
                    <div className="text-right">
                        <div className="text-sm font-medium tabular-nums">
                            {formatToRoundedIndianRupee(option.gross_amount ?? 0)}
                        </div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                            {transfers} transfer{transfers === 1 ? "" : "s"}
                        </div>
                    </div>
                    <span
                        className={`w-[92px] shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] ${importStatusTone(
                            option.status
                        )}`}
                    >
                        {option.status || "—"}
                    </span>
                </div>
            </button>
        </li>
    );
};
