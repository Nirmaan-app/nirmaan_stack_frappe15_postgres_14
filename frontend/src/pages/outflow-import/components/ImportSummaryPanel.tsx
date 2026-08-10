// src/pages/outflow-import/components/ImportSummaryPanel.tsx

import { CheckCircle2, ChevronDown, FileSpreadsheet, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
    /** Clicking a figure scopes the table below to exactly those rows. */
    onFocusStatuses: (statuses: string[]) => void;
    onConfirmAllMatched: () => void;
    onRunMatch: () => void;
}

/**
 * The summary of ONE import, above the master table (slices X2 + X3).
 *
 * ⚠️ IT SUMMARISES AN IMPORT WHILE THE TABLE BELOW SPANS ALL OF THEM, and the mismatch is the
 * design, not an oversight. "How did that statement go?" is a question about one upload; "what do
 * I still owe a decision on?" is a question about the ledger. Putting the first above the second is
 * what lets one screen answer both -- and every figure here is a BUTTON that scopes the table to
 * itself, which is what stops the panel being a poster.
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
    onFocusStatuses,
    onConfirmAllMatched,
    onRunMatch,
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
                            <Figure
                                label="Statement total"
                                value={formatToRoundedIndianRupee(totals.total_value)}
                                sub={`${totals.total_rows} transfer${totals.total_rows === 1 ? "" : "s"}`}
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
                                    onClick={() => onFocusStatuses(tile.statuses)}
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
                            <span>
                                {summary.auto_skipped_rows} auto-skipped ·{" "}
                                {summary.manually_skipped_rows} skipped by hand
                            </span>
                            {summary.import.closed_at && (
                                <Badge variant="outline" className="border-0 bg-muted">
                                    Closed {formatDate(summary.import.closed_at.split(/[ T]/)[0])}
                                </Badge>
                            )}
                        </div>

                        {totals.ambiguous_rows > 0 && (
                            <p className="text-xs text-muted-foreground">
                                {totals.ambiguous_rows} matched{" "}
                                {totals.ambiguous_rows === 1 ? "transfer" : "transfers"} found more
                                than one approved record, so nothing was pre-selected — those need a
                                choice and are not part of “Confirm {totals.confirmable_rows}
                                &nbsp;matched”.
                            </p>
                        )}
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

const StatusChip = ({ tile, onClick }: { tile: SummaryTile; onClick: () => void }) => (
    <button
        type="button"
        onClick={onClick}
        title={`Show only ${tile.label.toLowerCase()} rows`}
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-muted ${tile.tone}`}
    >
        <span className="font-medium tabular-nums">{tile.count}</span>
        <span>{tile.label}</span>
        <ChevronDown className="h-3 w-3 -rotate-90 opacity-50" />
    </button>
);
