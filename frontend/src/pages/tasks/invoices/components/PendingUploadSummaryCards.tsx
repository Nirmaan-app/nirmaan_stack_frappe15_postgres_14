/**
 * Summary cards for the Pending Invoices Upload sub-tabs: one for PO / WO, one for Credit Card.
 *
 * Each card totals exactly the rows the table under it shows, search and filters included -- the same
 * behaviour as the 2B Reconciliation Summary cards, with the same "Filtered" chip. The figures are worked out
 * by the pure rules in `utils/pendingUploadSummary.ts` and `utils/cardInvoicesView.ts`; these components
 * only lay them out. The visual language echoes the 2B Reconciliation Summary tiles.
 */
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, CheckCircle2, Clock, CreditCard, FileText, FileUp, ListFilter, MousePointerClick, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";

import { percentOf, type PendingUploadOrderSummary } from "../utils/pendingUploadSummary";
import type { CardSpendsSummary, CardSpendTypeTotal } from "../utils/cardInvoicesView";

const CARD_CLASS = "border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800";

const CardHeading: React.FC<{ title: string; isFiltered: boolean; action?: React.ReactNode }> = ({ title, isFiltered, action }) => (
    <CardHeader className="pb-2 pt-3 px-4 sm:px-5">
        <div className="flex items-center gap-2">
            <CardTitle className="text-sm sm:text-base font-semibold tracking-tight text-slate-800 dark:text-slate-200">
                {title}
            </CardTitle>
            {isFiltered && (
                <span className="px-2 py-0.5 text-[10px] font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full">
                    Filtered
                </span>
            )}
            {action && <div className="ml-auto">{action}</div>}
        </div>
    </CardHeader>
);

type Tone = "slate" | "cyan" | "green" | "amber";

const TONES: Record<Tone, { box: string; label: string; value: string }> = {
    slate: {
        box: "from-slate-50 to-blue-50/50 dark:from-slate-950/40 dark:to-blue-950/30 border-slate-200 dark:border-slate-700",
        label: "text-slate-600/80 dark:text-slate-400/80",
        value: "text-slate-700 dark:text-slate-300",
    },
    cyan: {
        box: "from-cyan-50 to-blue-50/50 dark:from-cyan-950/40 dark:to-blue-950/30 border-cyan-100 dark:border-cyan-900/50",
        label: "text-cyan-600/80 dark:text-cyan-400/80",
        value: "text-cyan-700 dark:text-cyan-400",
    },
    green: {
        box: "from-green-50 to-emerald-50/50 dark:from-green-950/40 dark:to-emerald-950/30 border-green-100 dark:border-green-900/50",
        label: "text-green-600/80 dark:text-green-400/80",
        value: "text-green-700 dark:text-green-400",
    },
    amber: {
        box: "from-amber-50 to-orange-50/50 dark:from-amber-950/40 dark:to-orange-950/30 border-amber-200 dark:border-amber-800/60",
        label: "text-amber-600/80 dark:text-amber-400/80",
        value: "text-amber-700 dark:text-amber-400",
    },
};

const Tile: React.FC<{ tone: Tone; icon: React.ReactNode; label: string; amount: number; note: React.ReactNode }> = ({
    tone, icon, label, amount, note,
}) => {
    const t = TONES[tone];
    return (
        <div className={`bg-gradient-to-br rounded-lg p-3 border min-w-0 ${t.box}`}>
            <dt className={`text-[11px] font-medium uppercase tracking-wide mb-1 flex items-center gap-1.5 ${t.label}`}>
                {icon}
                <span className="truncate">{label}</span>
            </dt>
            <dd className={`text-lg font-bold tabular-nums truncate ${t.value}`}>{formatToRoundedIndianRupee(amount)}</dd>
            <dd className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{note}</dd>
        </div>
    );
};

interface PendingUploadOrderSummaryCardProps {
    title: string;
    /** What one row is, singular and plural: ["PO", "POs"]. */
    unit: readonly [string, string];
    totalLabel: string;
    /** "Amt Delivered" (PO) or "Amt Paid" (WO). */
    basisLabel: string;
    summary: PendingUploadOrderSummary;
    isFiltered: boolean;
}

/** PO / WO: what is still owed an invoice FIRST (the figure people act on), then order value with the row
 *  count, invoiced, and delivered-or-paid. */
export const PendingUploadOrderSummaryCard: React.FC<PendingUploadOrderSummaryCardProps> = ({
    title, unit, totalLabel, basisLabel, summary, isFiltered,
}) => (
    <Card className={CARD_CLASS}>
        <CardHeading title={title} isFiltered={isFiltered} />
        <CardContent className="px-4 sm:px-5 pb-3 pt-0">
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile
                    tone="amber"
                    icon={<Clock className="h-3 w-3 shrink-0" />}
                    label="Pending Invoice Amt"
                    amount={summary.pendingAmount}
                    note={`${basisLabel} − Total Invoice Amt`}
                />
                <Tile
                    tone="slate"
                    icon={<FileText className="h-3 w-3 shrink-0" />}
                    label={totalLabel}
                    amount={summary.totalAmount}
                    note={<><span className="font-semibold text-slate-700 dark:text-slate-300">{summary.count}</span> {summary.count === 1 ? unit[0] : unit[1]}</>}
                />
                <Tile
                    tone="cyan"
                    icon={<FileUp className="h-3 w-3 shrink-0" />}
                    label="Total Invoice Amt"
                    amount={summary.invoiceAmount}
                    note={summary.totalAmount > 0 ? `${percentOf(summary.invoiceAmount, summary.totalAmount)} of order value` : " "}
                />
                <Tile
                    tone="green"
                    icon={<CheckCircle2 className="h-3 w-3 shrink-0" />}
                    label={basisLabel}
                    amount={summary.basisAmount}
                    note={summary.totalAmount > 0 ? `${percentOf(summary.basisAmount, summary.totalAmount)} of order value` : " "}
                />
            </dl>
        </CardContent>
    </Card>
);

interface CardSpendsSummaryCardProps {
    /** The spends the table shows: the count and amount in the card's top strip. */
    summary: CardSpendsSummary;
    isFiltered: boolean;
    /** The Expense Type boxes. The page passes the split over every filter but Expense Type, so all types stay
     *  in view while some are picked; without it, the boxes are `summary.byType`. */
    byType?: CardSpendTypeTotal[];
    /** The Expense Types the table is filtered to; their boxes are highlighted, the rest dimmed. */
    selectedTypes?: readonly string[];
    /** Given, each box is a button that picks or drops its type in the table's Expense Type filter. */
    onTypeClick?: (expenseType: string) => void;
    /** Given, a Clear button beside the title drops every picked type (the Expense Type filter only; search and
     *  the other filters stay). Shown only while a type is picked. */
    onClearTypes?: () => void;
}

/** Credit Card: the spends waiting for an invoice, then their amount split by Expense Type. */
export const CardSpendsSummaryCard: React.FC<CardSpendsSummaryCardProps> = ({
    summary, isFiltered, byType = summary.byType, selectedTypes = [], onTypeClick, onClearTypes,
}) => {
    // A box's share is of the boxes' own total, which is the top strip's only when no type is picked.
    const boxesAmount = byType.reduce((sum, t) => sum + t.amount, 0);
    const anyPicked = selectedTypes.length > 0;
    return (
    <Card className={CARD_CLASS}>
        <CardHeading
            title="Card Spends Pending Invoice"
            isFiltered={isFiltered}
            action={
                anyPicked && onClearTypes ? (
                    <button
                        type="button"
                        onClick={onClearTypes}
                        title="Show every Expense Type again"
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-medium text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 bg-white/70 dark:bg-slate-900/60 hover:bg-teal-50 dark:hover:bg-teal-950/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                    >
                        <X className="h-3 w-3" aria-hidden="true" />
                        Clear {selectedTypes.length === 1 ? "type" : `${selectedTypes.length} types`}
                    </button>
                ) : null
            }
        />
        <CardContent className="px-4 sm:px-5 pb-3 pt-0">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-50/70 dark:bg-amber-950/20 border-b border-amber-200/70 dark:border-amber-900/50">
                    <CreditCard className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span className="text-[11px] font-medium text-amber-900 dark:text-amber-200 truncate">
                        Card spends waiting for an invoice
                    </span>
                    <span className="ml-auto flex items-baseline gap-2 shrink-0">
                        <span className="text-sm font-bold tabular-nums text-amber-900 dark:text-amber-200">{summary.count}</span>
                        <span className="text-[10px] text-amber-700/80 dark:text-amber-400/80">
                            {summary.count === 1 ? "spend" : "spends"}
                        </span>
                        <span className="text-amber-300 dark:text-amber-800">|</span>
                        <span className="text-sm font-bold tabular-nums text-amber-900 dark:text-amber-200">
                            {formatToRoundedIndianRupee(summary.amount)}
                        </span>
                    </span>
                </div>

                {/* Expense types in a compact grid -- 3 a row on wide screens, 2 on mid, 1 on phones. Each cell
                    draws its own right and bottom hairline; the -1px margins tuck the outer ones under the box's
                    border, so a part-filled last row leaves white space, not a tinted block. */}
                {/* Says the boxes below are buttons -- a grid of figures otherwise reads as a static report. */}
                {onTypeClick && byType.length > 0 && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                        <MousePointerClick className="h-3 w-3 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                        <span className="truncate">
                            {anyPicked
                                ? `Showing ${selectedTypes.length} of ${byType.length} Expense Types · click a box to add or remove it`
                                : "Click an Expense Type to filter the table"}
                        </span>
                    </div>
                )}
                {byType.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 -mr-px -mb-px">
                        {byType.map((t) => {
                            const share = boxesAmount > 0 ? Math.round((t.amount / boxesAmount) * 100) : 0;
                            const picked = selectedTypes.includes(t.expenseType);
                            // w-full on both rows: inside a <button> the column flex does not stretch its rows, so
                            // without it the share bar collapses to 0 and the amount leaves the right edge.
                            const content = (
                                <>
                                    <div className="w-full flex items-baseline gap-2 min-w-0">
                                        <span
                                            className={cn(
                                                "flex-1 min-w-0 flex items-center gap-1 text-xs",
                                                picked
                                                    ? "font-semibold text-teal-800 dark:text-teal-200"
                                                    : "font-medium text-slate-700 dark:text-slate-300",
                                            )}
                                        >
                                            {picked ? (
                                                <Check className="h-3 w-3 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                                            ) : onTypeClick ? (
                                                <ListFilter
                                                    className="h-3 w-3 shrink-0 text-slate-300 dark:text-slate-600 group-hover:text-teal-500 dark:group-hover:text-teal-400 transition-colors"
                                                    aria-hidden="true"
                                                />
                                            ) : null}
                                            <span className="truncate">{t.expenseType}</span>
                                        </span>
                                        <span className="text-xs font-semibold tabular-nums text-slate-800 dark:text-slate-100 shrink-0">
                                            {formatToRoundedIndianRupee(t.amount)}
                                        </span>
                                        <span className="text-[10px] tabular-nums text-teal-600 dark:text-teal-400 shrink-0">· {t.count}</span>
                                    </div>
                                    <div className="w-full flex items-center gap-2">
                                        <div className="flex-1 h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" aria-hidden="true">
                                            <div
                                                className={cn("h-full rounded-full", picked ? "bg-teal-600 dark:bg-teal-400" : "bg-teal-500")}
                                                style={{ width: `${share}%` }}
                                            />
                                        </div>
                                        <span className="w-8 text-right text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
                                            {percentOf(t.amount, boxesAmount)}
                                        </span>
                                    </div>
                                </>
                            );
                            const cellClass = "border-r border-b border-slate-100 dark:border-slate-800 px-3 py-2 flex flex-col gap-1.5 min-w-0";
                            if (!onTypeClick) {
                                return <div key={t.expenseType} className={cellClass}>{content}</div>;
                            }
                            return (
                                <button
                                    key={t.expenseType}
                                    type="button"
                                    aria-pressed={picked}
                                    title={
                                        picked
                                            ? `Remove ${t.expenseType} from the filter`
                                            : anyPicked
                                                ? `Add ${t.expenseType} to the filter`
                                                : `Show only ${t.expenseType}`
                                    }
                                    onClick={() => onTypeClick(t.expenseType)}
                                    className={cn(
                                        cellClass,
                                        "group cursor-pointer text-left transition-[background-color,box-shadow,opacity] duration-150",
                                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500",
                                        // Picked: a 3px teal bar down the left edge, a soft tint and a hairline teal
                                        // outline -- all inset, so nothing is clipped where an outer cell tucks
                                        // under the box's border (the grid's -1px margins).
                                        picked
                                            ? "bg-teal-50/80 dark:bg-teal-950/30 ring-1 ring-inset ring-teal-500/40 dark:ring-teal-400/30 shadow-[inset_3px_0_0_0_#14b8a6] dark:shadow-[inset_3px_0_0_0_#2dd4bf]"
                                            : "hover:bg-teal-50/60 dark:hover:bg-teal-950/20 active:bg-teal-100/70 dark:active:bg-teal-900/30 hover:shadow-[inset_3px_0_0_0_#5eead4] dark:hover:shadow-[inset_3px_0_0_0_#0f766e]",
                                        anyPicked && !picked && "opacity-60 hover:opacity-100",
                                    )}
                                >
                                    {content}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </CardContent>
    </Card>
    );
};
