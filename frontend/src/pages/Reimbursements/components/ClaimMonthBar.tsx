/**
 * The month picker and its totals on the Paid and All tabs (owner, 2026-11-19). Paid counts claims by the month their
 * expense was paid, All by the month they were raised (`queue.get_claims`, `month`).
 *
 * The picker is a month button that opens a calendar of months (owner, 2026-11-19: stepping ‹ › month by month was too
 * slow): the year is picked with ‹ › (a whole year per click), then the month -- any month is two clicks away. Each
 * tile shows that month's total and claim count (`queue.get_claim_month_summary`, read when the picker opens and when
 * the year changes); a month with nothing, or still to come, is greyed out. Quick picks: This month, Last month, All
 * months.
 *
 * The totals under it come from the same call as the rows (the data table's aggregates), so they cover every claim the
 * tab's filters and search match, not only the page. Paid breaks the total down by type, All by status.
 */

import { useState } from "react";
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
    monthTitle,
    monthVerb,
    splitMonth,
} from "@/utils/reimbursements/claimMonth";
import { TAB_PAID, type ReimbursementTab } from "@/utils/reimbursements/rules";

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
    const verb = monthVerb(tab);
    const label = all ? `${verb}, all months` : `${verb} in ${monthTitle(month)}`;
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
        <div className="flex flex-col gap-2 rounded-md border bg-muted/30 px-3 py-2" role="region" aria-label="Month">
            <div className="flex flex-wrap items-center gap-2">
                <MonthPicker tab={tab} month={month} onPick={onMonthChange} />
                {quick(thisMonth, "This month")}
                {quick(last, "Last month")}
                {quick(ALL_MONTHS, "All months")}
            </div>
            <div className={cn("flex flex-wrap items-center gap-1.5 text-xs", loading && "opacity-60")} aria-live="polite">
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                    {label}: {formatToRoundedIndianRupee(total)}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                    {count} {count === 1 ? "claim" : "claims"}
                </span>
                {(groupByResult ?? []).map((g) => (
                    <span key={g.group_key || "none"}
                        className={cn("rounded-full px-2 py-0.5", STATUS_BADGE[g.group_key] ?? "bg-muted text-muted-foreground")}>
                        {g.group_key || "No type"} {formatToRoundedIndianRupee(Number(g.aggregate_value))}
                    </span>
                ))}
            </div>
        </div>
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
                    {picked ? monthTitle(month) : "All months"}
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
                <p className="mt-2 text-[11px] text-muted-foreground">
                    {tab === TAB_PAID ? "Each tile: paid in that month." : "Each tile: raised in that month."} Greyed: nothing that month, or still to come.
                </p>
            </PopoverContent>
        </Popover>
    );
}
