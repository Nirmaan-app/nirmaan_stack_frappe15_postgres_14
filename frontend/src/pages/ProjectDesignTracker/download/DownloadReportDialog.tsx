// frontend/src/pages/ProjectDesignTracker/download/DownloadReportDialog.tsx
//
// The picker: Phase -> Zone -> Category, with a live count of the tasks the PDF
// will contain. Presentational only -- it builds no URLs and performs no fetch;
// it hands a resolved selection back to useDownloadReport.
//
// The three steps CASCADE (zones depend on the chosen phases, categories on the
// chosen zones), so they are numbered and arrowed rather than presented as three
// independent filters -- otherwise an emptying Category list reads as a bug.
//
// The page mounts this ONLY while open, so the selection initialises once per
// open from the seed and no effect is needed to reset it.

import React, { useCallback, useMemo, useState } from "react";
import { ChevronRight, Download, Search } from "lucide-react";
import { TailSpin } from "react-loader-spinner";

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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
    countMatchingTasks,
    describeSelection,
    getCategoryOptions,
    getPhaseOptions,
    getZoneOptions,
    isSelectionComplete,
    pruneSelection,
    resolveSeed,
} from "./downloadSelection";
import type {
    DesignPhase,
    DownloadOption,
    DownloadSeed,
    DownloadSelection,
    DownloadableTask,
} from "./downloadTypes";
import type { DownloadAvailability } from "./useDownloadReport";

/** A list longer than this gets a filter box. */
const SEARCH_THRESHOLD = 8;

/* ------------------------------------------------------------------ *
 * Tri-state "select all" box
 * ------------------------------------------------------------------ */

/**
 * Checked / dash / empty, so a PARTIAL selection is visible at a glance.
 *
 * Hand-rolled rather than using the shadcn <Checkbox> because that component
 * renders a tick for Radix's `indeterminate` state too, which would show "all
 * selected" when only some are. `components/ui/` is generated and must not be
 * hand-edited, so the tri-state lives here instead.
 */
const SelectAllBox: React.FC<{ state: "all" | "some" | "none" }> = ({ state }) => (
    <span
        aria-hidden
        className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border shadow-sm",
            state === "none"
                ? "border-gray-300 bg-white"
                : "border-primary bg-primary text-primary-foreground",
        )}
    >
        {state === "all" && (
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        )}
        {state === "some" && <span className="h-0.5 w-2 rounded-full bg-current" />}
    </span>
);

/* ------------------------------------------------------------------ *
 * One numbered step
 * ------------------------------------------------------------------ */

interface FilterStepProps {
    step: number;
    title: string;
    /** What this step narrows, shown under the title. */
    hint: string;
    options: DownloadOption[];
    selected: string[];
    onChange: (next: string[]) => void;
    emptyHint: string;
}

const FilterStep: React.FC<FilterStepProps> = ({
    step,
    title,
    hint,
    options,
    selected,
    onChange,
    emptyHint,
}) => {
    const [query, setQuery] = useState("");
    const selectedSet = useMemo(() => new Set(selected), [selected]);
    const allValues = useMemo(() => options.map((o) => o.value), [options]);

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    }, [options, query]);

    const allState: "all" | "some" | "none" =
        options.length > 0 && selected.length === options.length
            ? "all"
            : selected.length > 0
              ? "some"
              : "none";

    const toggle = (value: string, checked: boolean) =>
        onChange(
            checked
                ? allValues.filter((v) => selectedSet.has(v) || v === value)
                : selected.filter((v) => v !== value),
        );

    return (
        <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
            {/* Step header */}
            <div className="border-b border-gray-200 bg-gray-50/80 px-3 py-2">
                <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white">
                        {step}
                    </span>
                    <span className="truncate text-xs font-semibold text-gray-900">{title}</span>
                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-gray-500">
                        {selected.length}/{options.length}
                    </span>
                </div>
                <p className="mt-1 pl-7 text-[10px] leading-tight text-gray-500">{hint}</p>
            </div>

            {options.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-gray-400">{emptyHint}</p>
            ) : (
                <>
                    {/* Select all */}
                    <button
                        type="button"
                        onClick={() => onChange(allState === "all" ? [] : allValues)}
                        className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 text-left hover:bg-gray-50"
                    >
                        <SelectAllBox state={allState} />
                        <span className="text-xs font-medium text-gray-700">
                            {allState === "all" ? "Clear all" : "Select all"}
                        </span>
                    </button>

                    {options.length > SEARCH_THRESHOLD && (
                        <div className="relative border-b border-gray-100 px-2 py-1.5">
                            <Search className="pointer-events-none absolute left-4 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
                            <Input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={`Find ${title.toLowerCase()}...`}
                                className="h-7 pl-7 text-xs"
                            />
                        </div>
                    )}

                    <div className="max-h-52 overflow-y-auto p-1">
                        {visible.length === 0 ? (
                            <p className="px-2 py-4 text-center text-xs text-gray-400">
                                Nothing matches "{query}"
                            </p>
                        ) : (
                            visible.map((option) => {
                                const checked = selectedSet.has(option.value);
                                return (
                                    <label
                                        key={option.value || "__uncategorized__"}
                                        className={cn(
                                            "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5",
                                            checked ? "bg-blue-50/60" : "hover:bg-gray-50",
                                        )}
                                    >
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={(next) =>
                                                toggle(option.value, next === true)
                                            }
                                        />
                                        <span
                                            className={cn(
                                                "min-w-0 flex-1 truncate text-xs",
                                                checked
                                                    ? "font-medium text-gray-900"
                                                    : "text-gray-600",
                                            )}
                                        >
                                            {option.label}
                                        </span>
                                        <span className="shrink-0 rounded bg-gray-100 px-1.5 text-[10px] tabular-nums text-gray-500">
                                            {option.count}
                                        </span>
                                    </label>
                                );
                            })
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

/** The "→" between steps -- rotates to point down when the columns stack. */
const StepArrow: React.FC = () => (
    <div className="flex items-center justify-center sm:px-0.5">
        <ChevronRight className="h-4 w-4 rotate-90 text-gray-300 sm:rotate-0" />
    </div>
);

/* ------------------------------------------------------------------ *
 * The dialog
 * ------------------------------------------------------------------ */

export interface DownloadReportDialogProps {
    onOpenChange: (open: boolean) => void;
    /** Every task on the tracker -- filtering happens here, not upstream. */
    tasks: DownloadableTask[];
    /** The tracker's own zone order, so the picker matches the PDF's order. */
    zoneOrder: string[];
    hasHandover: boolean;
    seed: DownloadSeed;
    isDownloading: boolean;
    onDownload: (
        selection: DownloadSelection,
        available: DownloadAvailability,
    ) => void | Promise<void>;
}

export const DownloadReportDialog: React.FC<DownloadReportDialogProps> = ({
    onOpenChange,
    tasks,
    zoneOrder,
    hasHandover,
    seed,
    isDownloading,
    onDownload,
}) => {
    const phaseOptions = useMemo(
        () => getPhaseOptions(tasks, hasHandover),
        [tasks, hasHandover],
    );

    // Initialised once per open (the page mounts this component only while open).
    const [selection, setSelection] = useState<DownloadSelection>(() => {
        const seededPhases = (
            seed.phases?.length ? seed.phases : phaseOptions.map((o) => o.value)
        ) as DesignPhase[];
        const zones = getZoneOptions(tasks, seededPhases, zoneOrder);
        const categories = getCategoryOptions(
            tasks,
            seededPhases,
            zones.map((o) => o.value),
        );
        return resolveSeed(seed, phaseOptions, zones, categories);
    });

    const zoneOptions = useMemo(
        () => getZoneOptions(tasks, selection.phases, zoneOrder),
        [tasks, selection.phases, zoneOrder],
    );
    const categoryOptions = useMemo(
        () => getCategoryOptions(tasks, selection.phases, selection.zones),
        [tasks, selection.phases, selection.zones],
    );

    /**
     * Changing phase changes which zones and categories exist. Cascade through
     * resolveSeed so a still-valid narrowing survives and a vanished one falls
     * back to "all" instead of leaving a dead-end empty axis. Phases themselves
     * are taken exactly as clicked -- unticking them all must stay possible.
     */
    const applyPhases = useCallback(
        (nextPhases: string[]) => {
            const phases = nextPhases as DesignPhase[];
            const nextZoneOptions = getZoneOptions(tasks, phases, zoneOrder);
            const nextCategoryOptions = getCategoryOptions(
                tasks,
                phases,
                nextZoneOptions.map((o) => o.value),
            );
            setSelection((prev) => ({
                ...resolveSeed(
                    { phases, zones: prev.zones, categories: prev.categories },
                    phaseOptions,
                    nextZoneOptions,
                    nextCategoryOptions,
                ),
                phases,
            }));
        },
        [tasks, zoneOrder, phaseOptions],
    );

    /** Narrowing zones can retire a category; drop it rather than leave a tick that adds nothing. */
    const applyZones = useCallback(
        (nextZones: string[]) => {
            setSelection((prev) => {
                const nextCategoryOptions = getCategoryOptions(
                    tasks,
                    prev.phases,
                    nextZones,
                );
                return pruneSelection(
                    { ...prev, zones: nextZones },
                    nextZones.map((value) => ({ value, label: value, count: 0 })),
                    nextCategoryOptions,
                );
            });
        },
        [tasks],
    );

    const applyCategories = useCallback((nextCategories: string[]) => {
        setSelection((prev) => ({ ...prev, categories: nextCategories }));
    }, []);

    const available = useMemo(
        () => ({ phases: phaseOptions, zones: zoneOptions, categories: categoryOptions }),
        [phaseOptions, zoneOptions, categoryOptions],
    );

    const matchingCount = useMemo(
        () => countMatchingTasks(tasks, selection),
        [tasks, selection],
    );
    const summary = useMemo(
        () => describeSelection(selection, available),
        [selection, available],
    );

    const complete = isSelectionComplete(selection);
    const canDownload = complete && matchingCount > 0 && !isDownloading;

    const handleDownload = () => {
        if (!canDownload) return;
        void onDownload(selection, available);
    };

    return (
        <Dialog open onOpenChange={(open) => !isDownloading && onOpenChange(open)}>
            <DialogContent className="max-w-3xl gap-4">
                <DialogHeader className="space-y-1">
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <Download className="h-4 w-4 text-red-600" />
                        Download Design Tracker
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        Tick what goes in the PDF. Each step narrows the next, and
                        "Not Applicable" tasks are always left out.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-1 sm:flex-row sm:items-stretch sm:gap-1.5">
                    <div className="min-w-0 flex-1">
                        <FilterStep
                            step={1}
                            title="Phase"
                            hint="Which stage of the project"
                            options={phaseOptions}
                            selected={selection.phases}
                            onChange={applyPhases}
                            emptyHint="No phases available."
                        />
                    </div>
                    <StepArrow />
                    <div className="min-w-0 flex-1">
                        <FilterStep
                            step={2}
                            title="Zone"
                            hint="Zones within the chosen phases"
                            options={zoneOptions}
                            selected={selection.zones}
                            onChange={applyZones}
                            emptyHint="Pick a phase first."
                        />
                    </div>
                    <StepArrow />
                    <div className="min-w-0 flex-1">
                        <FilterStep
                            step={3}
                            title="Category"
                            hint="Drawing types in the chosen zones"
                            options={categoryOptions}
                            selected={selection.categories}
                            onChange={applyCategories}
                            emptyHint="Pick a zone first."
                        />
                    </div>
                </div>

                {/* Result line -- what the PDF will actually contain */}
                <div
                    className={cn(
                        "rounded-md border px-3 py-2 text-xs",
                        !complete || matchingCount === 0
                            ? "border-amber-200 bg-amber-50 text-amber-800"
                            : "border-gray-200 bg-gray-50 text-gray-700",
                    )}
                >
                    {!complete ? (
                        <span>Tick at least one option in every step above.</span>
                    ) : matchingCount === 0 ? (
                        <span>No tasks match this combination — try widening a step.</span>
                    ) : (
                        <span>
                            <span className="font-semibold text-gray-900">
                                {matchingCount} task{matchingCount === 1 ? "" : "s"}
                            </span>
                            {summary.length > 0 && (
                                <span className="text-gray-500"> · {summary.join(" · ")}</span>
                            )}
                        </span>
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        disabled={isDownloading}
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        className="h-8 gap-1 bg-red-600 text-xs hover:bg-red-700"
                        disabled={!canDownload}
                        onClick={handleDownload}
                    >
                        {isDownloading ? (
                            <>
                                <TailSpin color="#fff" height={14} width={14} />
                                Generating...
                            </>
                        ) : (
                            <>
                                <Download className="h-3 w-3" /> Download PDF
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
