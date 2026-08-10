// src/pages/outflow-import/components/ImportSummaryPanel.tsx

import { CheckCircle2, FileSpreadsheet, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type {
    OutflowImportOption,
    OutflowImportSummary,
} from "@/types/NirmaanStack/OutflowImportBatch";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { importOptionLabel, summaryTiles, type SummaryTile } from "../outflowTableModel";

interface Props {
    summary?: OutflowImportSummary;
    imports: OutflowImportOption[];
    selected?: string;
    loading?: boolean;
    matching?: boolean;
    onSelect: (batch: string) => void;
    onConfirmAllMatched: () => void;
    onRunMatch: () => void;
    /** Open the Skipped dialog. Absent for a panel with nothing to open. */
    onShowSkipped?: () => void;
}

/**
 * The summary of ONE import, above the master table (slices X2 + X3).
 *
 * ⚠️ IT SUMMARISES AN IMPORT WHILE THE TABLE BELOW SPANS ALL OF THEM, and the mismatch is the
 * design, not an oversight. "How did that statement go?" is a question about one upload; "what do
 * I still owe a decision on?" is a question about the ledger. Putting the first above the second is
 * what lets one screen answer both.
 *
 * ⚠️ THE STATUS FIGURES ARE READ-ONLY (owner ruling 2026-08-10). They used to be buttons that
 * re-scoped the table to themselves. That coupling made a panel about ONE import silently rewrite
 * the filters of a table spanning ALL of them -- and it moved the tab as a side effect, so a click
 * meant to answer "how did that statement go?" navigated away from the work in progress. The
 * figures now report; the Status column's own filter is where scoping belongs, and it is the only
 * place it happens.
 *
 * ⚠️ EVERY NUMBER COMES FROM THE SERVER (`get_import_summary`). Nothing here counts anything.
 * `status.py` is the only deriver in this feature, and a panel that added up its own rows could
 * disagree with the table directly beneath it -- which is worse than showing no panel at all.
 */
export const ImportSummaryPanel = ({
    summary,
    imports,
    selected,
    loading,
    matching,
    onSelect,
    onConfirmAllMatched,
    onRunMatch,
    onShowSkipped,
}: Props) => {
    const totals = summary?.totals;

    return (
        <Card>
            <CardContent className="space-y-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {/* The picker defaults to the newest import and labels every option by file
                            and period -- never the batch id, which means nothing to an accountant. */}
                        <Select value={selected} onValueChange={onSelect}>
                            <SelectTrigger className="h-8 w-[320px] max-w-full">
                                <SelectValue placeholder="Choose an import" />
                            </SelectTrigger>
                            <SelectContent>
                                {imports.map((option) => (
                                    <SelectItem key={option.name} value={option.name}>
                                        {importOptionLabel(option)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {loading && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={!summary || matching}
                            onClick={onRunMatch}
                        >
                            {matching ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            Re-run match
                        </Button>
                        {/* ⚠️ "CONFIRM", NEVER "APPROVE" (owner ruling 2026-08-09). This feature
                            never approves anything -- it records that already-approved money left
                            the bank. A button here saying Approve would tell an accountant they are
                            approving payments, which is false. */}
                        <Button
                            size="sm"
                            disabled={!totals?.confirmable_rows}
                            onClick={onConfirmAllMatched}
                        >
                            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                            Confirm {totals?.confirmable_rows ?? 0} matched
                        </Button>
                    </div>
                </div>

                {summary && totals && (
                    <>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {/* The sub-label says "successful" only when some transfer was not,
                                so the word earns its place instead of being noise on the ~95% of
                                imports where the bank moved everything. */}
                            <Figure
                                label="Statement total"
                                value={formatToRoundedIndianRupee(totals.total_value)}
                                sub={`${totals.total_rows} ${
                                    totals.failed_rows > 0 ? "successful " : ""
                                }transfer${totals.total_rows === 1 ? "" : "s"}`}
                            />
                            <Figure
                                label="Settled"
                                value={formatToRoundedIndianRupee(totals.settled_value)}
                                sub={`${totals.settled_rows} recorded`}
                                tone="emerald"
                            />
                            {/* ⚠️ THE ONE FIGURE THAT SAYS WHETHER THE IMPORT IS FINISHED. Counts
                                tell you how much is left to click; this tells you how much money is
                                still unaccounted for, which is the question being asked. */}
                            <Figure
                                label="Still open"
                                value={formatToRoundedIndianRupee(totals.open_value)}
                                sub={`${totals.open_rows} undecided`}
                                tone={totals.open_rows ? "amber" : undefined}
                            />
                            <Figure
                                label="Decided"
                                value={`${totals.decided_percent}%`}
                                sub={`${totals.decided_rows} of ${totals.total_rows}`}
                            />
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            {summaryTiles(totals).map((tile) => (
                                <StatusChip
                                    key={tile.id}
                                    tile={tile}
                                    // ⚠️ ONE CHIP OPENS SOMETHING, AND ONLY ONE. The figures went
                                    // read-only on 2026-08-10 because clicking one re-scoped a table
                                    // spanning every import and moved the tab as a side effect. This
                                    // is not that: Skipped rows have no tab at all, so the chip is
                                    // the only route to them, and it opens a DIALOG rather than
                                    // rewriting the filters behind it.
                                    onOpen={
                                        tile.id === "skipped" && tile.count > 0
                                            ? onShowSkipped
                                            : undefined
                                    }
                                />
                            ))}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>
                                Period{" "}
                                {summary.import.period_from
                                    ? formatDate(summary.import.period_from)
                                    : "—"}{" "}
                                – {summary.import.period_to ? formatDate(summary.import.period_to) : "—"}
                            </span>
                            <span>
                                Uploaded{" "}
                                {summary.import.uploaded_at
                                    ? formatDate(summary.import.uploaded_at.split(/[ T]/)[0])
                                    : "—"}{" "}
                                by {summary.import.uploaded_by || "—"}
                            </span>
                            {/* Auto vs manual skips mean different things: one is bookkeeping (a
                                duplicate, a failed transfer), the other is somebody's decision. */}
                            {/* ⚠️ THE ONLY PLACE SKIPPED ROWS ARE REPORTED (owner ruling
                                2026-08-10). They are filtered out of the master table's three
                                tabs entirely, so if this line goes, a skipped transfer becomes
                                invisible rather than merely out of the way. */}
                            {/* ⚠️ THE SKIPPED SPLIT AND THE FAILED-MONEY LINE WERE REMOVED HERE
                                (owner, 2026-08-11), AND THE INVARIANT THEY SERVED IS INTACT.

                                Invariant 13 said of the failed footnote: "If that line goes, option
                                B silently becomes option A" — because it was the ONLY place a
                                bank-refused transfer surfaced after import. That stopped being true
                                earlier the same day: the Skipped chip now counts all 47 rather than
                                20, and opens a dialog whose first control splits them into
                                `All / Already paid / Bank refused` with the counts on it. The rows
                                are reported in a place you can act on, not merely mentioned in a
                                place you cannot.

                                So this is a removal of DUPLICATION, not of the report. Anything that
                                reverts the chip to 20 or drops the Skipped dialog must bring these
                                lines back in the same change. */}
                        </div>

                        {/* ⚠️ THE AMBIGUITY LINE MOVED, IT DID NOT VANISH (owner, 2026-08-11).
                            It explained why the Confirm button's number is smaller than the Matched
                            chip. The confirm dialog now states that funnel itself — "19 matched in
                            this import · 5 ready to confirm · 14 matched more than one record" — at
                            the moment somebody is about to act on it, which is where an explanation
                            for a number belongs. Saying it twice made the panel longer without
                            making it clearer. */}
                    </>
                )}

                {!summary && !loading && (
                    <p className="text-sm text-muted-foreground">
                        No imports yet. Upload a bank statement to get started.
                    </p>
                )}
            </CardContent>
        </Card>
    );
};

const Figure = ({
    label,
    value,
    sub,
    tone,
}: {
    label: string;
    value: string;
    sub: string;
    tone?: "emerald" | "amber";
}) => (
    <div
        className={`rounded-md border p-3 ${
            tone === "emerald"
                ? "border-emerald-200 bg-emerald-50/50"
                : tone === "amber"
                  ? "border-amber-200 bg-amber-50/50"
                  : ""
        }`}
    >
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
);

/**
 * A figure. See the panel docstring for why these stopped being filters.
 *
 * ⚠️ `onOpen` IS NOT A RETURN OF THE OLD CLICK. That one re-scoped the table below to the chip's
 * status — a panel about ONE import silently rewriting the filters of a table spanning all of them,
 * and moving the tab while it did. This opens a dialog and changes nothing behind it. A chip without
 * `onOpen` renders exactly as it always has, as a `<span>`, so the read-only ones cannot acquire a
 * focus ring or a pointer cursor by accident.
 */
const StatusChip = ({ tile, onOpen }: { tile: SummaryTile; onOpen?: () => void }) => {
    const className = `flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${tile.tone}`;
    // The split behind a count that is not simply its own status figure. See `summaryTiles`.
    const title = tile.hint;
    const body = (
        <>
            <span className="font-medium tabular-nums">{tile.count}</span>
            <span>{tile.label}</span>
        </>
    );
    if (!onOpen)
        return (
            <span className={className} title={title}>
                {body}
            </span>
        );
    return (
        <button
            type="button"
            onClick={onOpen}
            title={title ? `${title} — click to see them` : "Show the skipped transfers"}
            className={`${className} underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        >
            {body}
        </button>
    );
};
