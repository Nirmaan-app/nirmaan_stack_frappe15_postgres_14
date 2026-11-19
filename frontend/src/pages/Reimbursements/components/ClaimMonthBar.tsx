/**
 * The month picker and its totals on Payment need to be paid, Paid and All (owner, 2026-11-19). Paid counts claims by the month their
 * expense was paid, All by the month they were raised (`queue.get_claims`, `month`).
 *
 * The picker is a month button that opens a calendar of months (owner, 2026-11-19: stepping ‹ › month by month was too
 * slow): the year is picked with ‹ › (a whole year per click), then the month -- any month is two clicks away. Each
 * tile shows that month's total and claim count (`queue.get_claim_month_summary`, read when the picker opens and when
 * the year changes); a month with nothing, or still to come, is greyed out. Quick picks: This month (Nov), Last month
 * (Oct), All, and Reset; All and Reset both go to all months, and the picker has the same two (owner, 2026-11-19).
 *
 * The totals under it come from the same call as the rows (the data table's aggregates), so they cover every claim the
 * tab's filters and search match, not only the page. Shown as figures (owner, 2026-11-19): the total large, then the
 * claim count and the breakdown -- every step on All (coloured dots and a share bar underneath), Travel / Food /
 * Others on Payment need to be paid and Paid (`claimMonth.monthFigures`).
 */

import { useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { GroupByResultItem } from "@/hooks/useServerDataTable";
import { useFrappeGetCall } from "@/lib/frappe";
import { cn } from "@/lib/utils";
import type { ClaimMonthSummary } from "@/types/NirmaanStack/Reimbursement";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import {
    ALL_MONTHS,
    SHORT_MONTHS,
    currentMonth,
    joinMonth,
    lastMonth,
    monthFigures,
    monthHeading,
    monthTitle,
    shortMonth,
    splitMonth,
} from "@/utils/reimbursements/claimMonth";
import { TAB_ALL, TAB_MINE, TAB_PAID, type ReimbursementTab } from "@/utils/reimbursements/rules";

import { STATUS_BADGE } from "../config/reimbursementColumns";

const SUMMARY_API = "nirmaan_stack.api.reimbursements.queue.get_claim_month_summary";

interface Props {
    tab: ReimbursementTab;
    /** "YYYY-MM" or "all". */
    month: string;
    onMonthChange: (month: string) => void;
    aggregates: Record<string, number> | null;
    groupByResult: GroupByResultItem[] | null;
    loading: boolean;
}

export function ClaimMonthBar({ tab, month, onMonthChange, aggregates, groupByResult, loading }: Props) {
    const all = month === ALL_MONTHS;
    const total = Number(aggregates?.sum_of_amount ?? 0);
    const count = Number(aggregates?.count_of_amount ?? 0);
    const heading = monthHeading(tab, month);
    // The tab's status as a badge, in its Status-column colours; All and Mine (every status) in grey.
    const label = (
        <>
            <span className={cn("rounded px-1.5 py-px text-[11px] font-semibold", STATUS_BADGE[heading.name] ?? "bg-muted text-foreground")}>
                {heading.name}
            </span>
            {heading.when}
        </>
    );
    const figures = monthFigures(tab, groupByResult);
    const shareTotal = figures.reduce((sum, f) => sum + f.value, 0);
    const thisMonth = currentMonth();
    const last = lastMonth();
    const quick = (value: string, text: string) => (
        <button type="button" onClick={() => onMonthChange(value)} aria-pressed={month === value}
            className={cn("rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                month === value ? "bg-sky-500 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-muted dark:text-foreground")}>
            {text}
        </button>
    );

    return (
        <div className="flex flex-col rounded-md border bg-background" role="region" aria-label="Month">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <MonthPicker tab={tab} month={month} onPick={onMonthChange} />
                {quick(thisMonth, `This month (${shortMonth(thisMonth)})`)}
                {quick(last, `Last month (${shortMonth(last)})`)}
                {quick(ALL_MONTHS, "All")}
                <ResetButton disabled={all} onReset={() => onMonthChange(ALL_MONTHS)} />
            </div>
            <div className={cn("flex flex-wrap items-stretch gap-y-2 border-t px-3 py-2.5", loading && "opacity-60")} aria-live="polite">
                <Figure hero label={label} value={formatToRoundedIndianRupee(total)} />
                <Figure label="Claims" value={String(count)} />
                {figures.map((f) => (
                    <Figure key={f.key} label={f.key} value={formatToRoundedIndianRupee(f.value)} color={f.color} />
                ))}
            </div>
            {/* All: how the total splits across the steps, in the same colours as the dots. */}
            {(tab === TAB_ALL || tab === TAB_MINE) && shareTotal > 0 && (
                <div className="mx-3 mb-2.5 flex h-1 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
                    {figures.map((f) => (
                        <span key={f.key} className="h-full" style={{ width: `${(f.value / shareTotal) * 100}%`, backgroundColor: f.color }} />
                    ))}
                </div>
            )}
        </div>
    );
}

/** One labelled figure in the totals row; the first (hero) is the total, larger. A coloured dot marks a step on All. */
function Figure({ label, value, color, hero = false }: { label: ReactNode; value: string; color?: string; hero?: boolean }) {
    return (
        <div className="flex min-w-0 flex-col gap-0.5 border-l px-4 first:border-l-0 first:pl-0">
            <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px]", hero ? "font-medium text-foreground/80" : "text-muted-foreground")}>
                {color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />}
                {label}
            </span>
            <span className={cn("whitespace-nowrap font-semibold tabular-nums", hero ? "text-2xl leading-tight tracking-tight" : "text-[15px]")}>
                {value}
            </span>
        </div>
    );
}

/** Reset: back to all months. A red pill while it can be pressed (a month is picked); muted grey when already on all
 *  months (owner, 2026-11-19). */
function ResetButton({ disabled, onReset }: { disabled: boolean; onReset: () => void }) {
    return (
        <button type="button" onClick={onReset} disabled={disabled}
            className={cn("rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                disabled
                    ? "pointer-events-none bg-gray-100 text-muted-foreground opacity-60 dark:bg-muted"
                    : "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60")}>
            Reset
        </button>
    );
}

/** The month button and its calendar of months. */
function MonthPicker({ tab, month, onPick }: { tab: ReimbursementTab; month: string; onPick: (month: string) => void }) {
    const [open, setOpen] = useState(false);
    const [nowYear, nowMonth] = splitMonth(currentMonth());
    const picked = month === ALL_MONTHS ? null : splitMonth(month);
    const [year, setYear] = useState<number>(picked ? picked[0] : nowYear);
    const { data, isLoading } = useFrappeGetCall<{ message: ClaimMonthSummary }>(
        SUMMARY_API, { tab, year }, open ? `reimb_month_summary:${tab}:${year}` : null,
        { revalidateOnFocus: false },
    );
    const summary = data?.message;
    const firstYear = Math.min(summary?.first_year ?? nowYear, nowYear);

    return (
        <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) setYear(picked ? picked[0] : nowYear); }}>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 font-semibold" aria-label="Pick a month">
                    <CalendarDays className="h-4 w-4" />
                    {picked ? monthTitle(month) : "All"}
                    <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[320px] p-3">
                <div className="mb-2 flex items-center justify-between">
                    <Button variant="outline" size="icon" className="h-7 w-7" aria-label="Previous year"
                        disabled={year <= firstYear} onClick={() => setYear((y) => y - 1)}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-bold tabular-nums">{year}</span>
                    <Button variant="outline" size="icon" className="h-7 w-7" aria-label="Next year"
                        disabled={year >= nowYear} onClick={() => setYear((y) => y + 1)}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
                <div className={cn("grid grid-cols-3 gap-1.5", isLoading && "opacity-60")}>
                    {SHORT_MONTHS.map((name, i) => {
                        const mm = i + 1;
                        const tile = summary?.year === year ? summary.months[String(mm)] : undefined;
                        const future = year > nowYear || (year === nowYear && mm > nowMonth);
                        const isPicked = !!picked && picked[0] === year && picked[1] === mm;
                        const isNow = year === nowYear && mm === nowMonth;
                        return (
                            <button key={name} type="button" disabled={future || (!tile && !isLoading && !isNow)}
                                aria-pressed={isPicked} aria-label={`${name} ${year}`}
                                onClick={() => { onPick(joinMonth(year, mm)); setOpen(false); }}
                                className={cn(
                                    "rounded-md border px-1 py-1.5 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                                    isPicked ? "border-sky-500 bg-sky-50 dark:bg-sky-950/40" : "hover:bg-muted",
                                )}>
                                <span className="block text-sm font-semibold">
                                    {name}{isNow && <span className="text-sky-500"> •</span>}
                                </span>
                                <span className="block text-[10.5px] tabular-nums text-muted-foreground">
                                    {tile ? `${formatToRoundedIndianRupee(tile.total)} · ${tile.count}` : future ? "—" : isLoading ? "…" : "nothing"}
                                </span>
                            </button>
                        );
                    })}
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                    <button type="button" aria-pressed={!picked} onClick={() => { onPick(ALL_MONTHS); setOpen(false); }}
                        className={cn("rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                            !picked ? "bg-sky-500 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-muted dark:text-foreground")}>
                        All months
                    </button>
                    <ResetButton disabled={!picked} onReset={() => { onPick(ALL_MONTHS); setOpen(false); }} />
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                    {tab === TAB_PAID ? "Each tile: paid in that month." : tab === TAB_ALL || tab === TAB_MINE ? "Each tile: raised in that month." : "Each tile: raised in that month, still on this tab."} Greyed: nothing that month, or still to come.
                </p>
            </PopoverContent>
        </Popover>
    );
}
