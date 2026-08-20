// src/pages/outflow-import/components/OutflowPeriodFilter.tsx

import { useMemo, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
    formatDateForFilterValue,
    parseFilterDate,
    timespanOptions,
    type DateFilterValue,
} from "@/components/data-table/date-filter-popover";

import { periodLabel, PERIOD_PRESETS } from "../outflowPeriod";

/**
 * The period selector above the summary -- the control that scopes the WHOLE screen (slice P1).
 *
 * It is laid out like the reports' `StandaloneDateFilter` (a button showing the current window; a
 * popover with a preset rail on the left and a range calendar on the right) because that is the
 * date control people on this application already know.
 *
 * ⚠️ IT SPEAKS `DateFilterValue`, NOT `DateRange`, AND THAT IS NOT A DETAIL. This screen has TWO
 * editors for ONE value -- this control and the `Payment Date` column funnel, which is the app's
 * standard `DateFilterPopover`. They must round-trip through each other losslessly, so they have to
 * store the same shape.
 *
 * ⚠️ ITS PRESETS ARE THE APP'S `timespanOptions`, DELIBERATELY NOT THE REPORTS' `datePresets`. The
 * two vocabularies define the SAME WORDS differently: `datePresets`' "Last 30 days" is
 * `today-29 -> today` while the timespan "last 30 days" is `today-30 -> today`, and its "This
 * month" runs to the END of the month where the timespan runs to TODAY. Mapping between them would
 * silently move the window by a day (or by half a month) every time a value passed from one control
 * to the other. One vocabulary is the only version of this that cannot drift -- and it is the one
 * Frappe already resolves server-side everywhere else in the app.
 *
 * ⚠️ A PRESET IS STORED AS THE WORD, NEVER AS DATES, which is what keeps a relative window
 * relative. "Last 30 days" bookmarked today still means the last 30 days next week; it is resolved
 * against a live `new Date()` on every read (`utils/dateFilterRange.ts`). Only the fixed financial
 * years and a hand-picked calendar range are stored as dates, because those are meant to stay put.
 */

interface Props {
    value?: DateFilterValue | null;
    onChange: (value: DateFilterValue | undefined) => void;
    /** Rendered to the right of the trigger — how many transfers the window selects. */
    caption?: string;
    /**
     * Greyed out because the period does not apply.
     *
     * ⚠️ DISABLED, NOT UNMOUNTED, AND THE DIFFERENCE IS THE WHOLE POINT (owner ruling 2026-08-12).
     * Selecting an import IGNORES the period rather than ANDing with it, so the control genuinely
     * has no effect — but a control that VANISHES leaves the reader unable to tell "no period
     * applies" from "a period is applied and I cannot see it". That second state is the
     * invisible-filter defect the deep-linked screen actually shipped with, where a stale window
     * silently reported 274 transfers out of 1,043. Greyed, with the caption saying "whole
     * statement", the absence is stated rather than inferred.
     */
    disabled?: boolean;
    className?: string;
}

export const OutflowPeriodFilter = ({
    value,
    onChange,
    caption,
    disabled,
    className,
}: Props) => {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<DateRange | undefined>();

    // The calendar is a DRAFT until Apply. Seeded from the current value when the popover opens, so
    // reopening shows what is actually in force rather than whatever was last half-typed.
    const handleOpenChange = (next: boolean) => {
        if (next) setDraft(valueToDraftRange(value));
        setOpen(next);
    };

    // ⚠️ A DISABLED CONTROL MUST NOT NAME A WINDOW. Showing "Last 30 days" greyed out would read as
    // "this period IS applied, you just cannot change it" — the opposite of the truth, and precisely
    // the ambiguity disabling-rather-than-hiding exists to remove.
    const label = useMemo(
        () => (disabled ? "Not applied" : periodLabel(value)),
        [value, disabled]
    );

    const applyDraft = () => {
        const from = formatDateForFilterValue(draft?.from);
        const to = formatDateForFilterValue(draft?.to);
        if (from && to) onChange({ operator: "Between", value: [from, to] });
        // A half-picked range (a start with no end) applies nothing rather than guessing an end.
        // The Apply button is disabled in that state; this is the backstop.
        setOpen(false);
    };

    return (
        <div className={cn("flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2", className)}>
            <span className="whitespace-nowrap text-sm font-medium">Period</span>
            <Popover open={open && !disabled} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        className={cn(
                            "h-8 w-[260px] max-w-full justify-start text-left font-normal",
                            !value && "text-muted-foreground"
                        )}
                    >
                        <CalendarIcon className="mr-2 h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{label}</span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="flex w-auto p-0" align="start">
                    <div className="flex max-h-[420px] w-[190px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-2">
                        {PERIOD_PRESETS.map((preset) => (
                            <Button
                                key={preset.label}
                                variant="ghost"
                                size="sm"
                                className={cn(
                                    "h-8 justify-start text-xs font-normal",
                                    isChosen(value, preset.value) && "bg-muted font-medium"
                                )}
                                onClick={() => {
                                    onChange(preset.value ?? undefined);
                                    setOpen(false);
                                }}
                            >
                                {preset.label}
                            </Button>
                        ))}
                    </div>
                    <div className="flex flex-col">
                        <div className="flex items-center justify-between gap-3 border-b p-3">
                            <span className="text-sm font-semibold">
                                {draft?.from
                                    ? `${format(draft.from, "dd-MMM-yyyy")} – ${
                                          draft.to ? format(draft.to, "dd-MMM-yyyy") : "…"
                                      }`
                                    : "Pick a custom range"}
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={!draft?.from && !draft?.to}
                                onClick={() => setDraft(undefined)}
                            >
                                Reset
                            </Button>
                        </div>
                        <Calendar
                            initialFocus
                            mode="range"
                            defaultMonth={draft?.from}
                            selected={draft}
                            onSelect={setDraft}
                            numberOfMonths={2}
                        />
                        <div className="flex justify-end gap-2 border-t p-2">
                            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                disabled={!draft?.from || !draft?.to}
                                onClick={applyDraft}
                            >
                                Apply range
                            </Button>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
            {caption && (
                <span className="whitespace-nowrap text-xs text-muted-foreground">{caption}</span>
            )}
        </div>
    );
};

/** Is this preset the one currently in force? Compared by VALUE, so the word and the dates both work. */
const isChosen = (value: DateFilterValue | null | undefined, preset: DateFilterValue | null) => {
    if (!preset) return !value;
    if (!value) return false;
    if (value.operator !== preset.operator) return false;
    return JSON.stringify(value.value) === JSON.stringify(preset.value);
};

/**
 * The current value as a calendar range to seed the draft with.
 *
 * A `Timespan` seeds NOTHING on purpose: resolving it into the calendar would show two fixed dates
 * for a window that is not fixed, and applying them would quietly convert a relative period into an
 * absolute one. Picking dates is how you leave a timespan, not a thing that happens by opening the
 * popover.
 */
const valueToDraftRange = (value?: DateFilterValue | null): DateRange | undefined => {
    if (!value || value.operator !== "Between" || !Array.isArray(value.value)) return undefined;
    const from = parseFilterDate(value.value[0]);
    const to = parseFilterDate(value.value[1]);
    return from ? { from, to } : undefined;
};

// Re-exported so the timespan list has one importer path on this screen.
export { timespanOptions };
