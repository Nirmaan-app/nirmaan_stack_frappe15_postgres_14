// frontend/src/pages/ProjectDesignTracker/download/downloadSelection.ts
//
// PURE logic for the design-tracker download. No React, no fetch, no toast --
// everything here is in/out so it can be unit-tested (see downloadSelection.test.ts;
// the repo's vitest env is node-only, so pure modules are the only testable layer).
//
// ⚠️ THIS FILE MIRRORS THE PRINT FORMAT'S INCLUSION RULES. The three normalizers
// below (taskPhase / taskZone / taskCategory) and isPrintableTask exist because
// the "Project Design Tracker" Jinja applies exactly the same four rules before
// it renders a row:
//
//     {% set t_phase = t.task_phase or "Onboarding" %}
//     {% set t_zone  = t.task_zone | string | trim %}
//     {% if t.task_status != "Not Applicable" and ... %}
//     {{ category or "Uncategorized" }}
//
// If a rule changes on either side it MUST change on both, or the dialog's
// "N tasks will be included" preview starts lying about the PDF.

import { format } from "date-fns";

import {
    ALL_PHASES,
    DEFAULT_PHASE,
    EXCLUDED_TASK_STATUS,
    PRINT_PARAM,
    UNCATEGORIZED_LABEL,
    UNCATEGORIZED_VALUE,
    DOWNLOAD_DOCTYPE,
    PRINT_FORMAT_NAME,
} from "./downloadConstants";
import type {
    DesignPhase,
    DownloadOption,
    DownloadSeed,
    DownloadSelection,
    DownloadableTask,
} from "./downloadTypes";

/* ------------------------------------------------------------------ *
 * 1. Normalizers -- the four rules shared with the Jinja
 * ------------------------------------------------------------------ */

/** A task with no phase is an Onboarding task. */
export function taskPhase(task: DownloadableTask): DesignPhase {
    return (task.task_phase || DEFAULT_PHASE) as DesignPhase;
}

/** Zones are compared trimmed -- real zone names have picked up stray spaces. */
export function taskZone(task: DownloadableTask): string {
    return (task.task_zone || "").trim();
}

/** A blank category is the "Uncategorized" bucket, keyed by the empty string. */
export function taskCategory(task: DownloadableTask): string {
    return (task.design_category || "").trim();
}

/** "Not Applicable" tasks never reach the PDF, so they never reach a count either. */
export function isPrintableTask(task: DownloadableTask): boolean {
    return task.task_status !== EXCLUDED_TASK_STATUS;
}

/* ------------------------------------------------------------------ *
 * 2. Option lists -- what the dialog offers, and how many tasks each carries
 * ------------------------------------------------------------------ */

/**
 * Phases that actually carry a printable task.
 *
 * `hasHandover` gates the Handover option the same way the page's phase tabs do:
 * a tracker whose handover was never generated must not offer the phase even if
 * a stray row claims it.
 */
export function getPhaseOptions(
    tasks: DownloadableTask[],
    hasHandover: boolean,
): DownloadOption[] {
    const counts = new Map<string, number>();
    for (const task of tasks) {
        if (!isPrintableTask(task)) continue;
        const phase = taskPhase(task);
        counts.set(phase, (counts.get(phase) ?? 0) + 1);
    }

    return ALL_PHASES.filter(
        (phase) => phase !== "Handover" || hasHandover,
    ).map((phase) => ({
        value: phase,
        label: phase,
        count: counts.get(phase) ?? 0,
    }));
}

/**
 * Zones carrying a printable task in the selected phases.
 *
 * `zoneOrder` is the tracker's own zone order (the `zone` child table, which the
 * page already resolves as `uniqueZones`) so the picker lists zones in the same
 * sequence the PDF prints them. A zone that only exists on task rows is appended
 * at the end rather than dropped.
 *
 * ⚠️ A task with a BLANK zone is skipped, because the print format skips it too:
 * the Jinja only ever loops named zones, so a zone-less task matches nothing and
 * is silently absent from the PDF. Offering a "(no zone)" tick here would put a
 * count on screen that the document does not honour.
 */
export function getZoneOptions(
    tasks: DownloadableTask[],
    phases: DesignPhase[],
    zoneOrder: string[],
): DownloadOption[] {
    const phaseSet = new Set<string>(phases);
    const counts = new Map<string, number>();

    for (const task of tasks) {
        if (!isPrintableTask(task)) continue;
        if (!phaseSet.has(taskPhase(task))) continue;
        const zone = taskZone(task);
        if (!zone) continue;
        counts.set(zone, (counts.get(zone) ?? 0) + 1);
    }

    const ordered: string[] = [];
    for (const zone of zoneOrder) {
        const trimmed = (zone || "").trim();
        if (counts.has(trimmed) && !ordered.includes(trimmed)) ordered.push(trimmed);
    }
    for (const zone of counts.keys()) {
        if (!ordered.includes(zone)) ordered.push(zone);
    }

    return ordered.map((zone) => ({
        value: zone,
        label: zone,
        count: counts.get(zone) ?? 0,
    }));
}

/**
 * Categories carrying a printable task in the selected phases AND zones.
 *
 * Sorted alphabetically because the Jinja groups with `groupby('design_category')`,
 * which sorts -- so the picker order matches the PDF's section order. The
 * "Uncategorized" bucket (empty string) sorts to the front, which is where the
 * PDF puts it too.
 */
export function getCategoryOptions(
    tasks: DownloadableTask[],
    phases: DesignPhase[],
    zones: string[],
): DownloadOption[] {
    const phaseSet = new Set<string>(phases);
    const zoneSet = new Set(zones.map((zone) => (zone || "").trim()));
    const counts = new Map<string, number>();

    for (const task of tasks) {
        if (!isPrintableTask(task)) continue;
        if (!phaseSet.has(taskPhase(task))) continue;
        if (!zoneSet.has(taskZone(task))) continue;
        const category = taskCategory(task);
        counts.set(category, (counts.get(category) ?? 0) + 1);
    }

    return [...counts.keys()]
        .sort((a, b) => a.localeCompare(b))
        .map((category) => ({
            value: category,
            label: category === UNCATEGORIZED_VALUE ? UNCATEGORIZED_LABEL : category,
            count: counts.get(category) ?? 0,
        }));
}

/* ------------------------------------------------------------------ *
 * 3. Counting + pruning
 * ------------------------------------------------------------------ */

/**
 * How many tasks the PDF will actually contain for this selection. This is the
 * number the dialog shows, and the reason the normalizers above exist.
 */
export function countMatchingTasks(
    tasks: DownloadableTask[],
    selection: DownloadSelection,
): number {
    const phaseSet = new Set<string>(selection.phases);
    const zoneSet = new Set(selection.zones.map((zone) => (zone || "").trim()));
    const categorySet = new Set(
        selection.categories.map((category) => (category || "").trim()),
    );

    let count = 0;
    for (const task of tasks) {
        if (!isPrintableTask(task)) continue;
        if (!phaseSet.has(taskPhase(task))) continue;
        if (!zoneSet.has(taskZone(task))) continue;
        if (!categorySet.has(taskCategory(task))) continue;
        count += 1;
    }
    return count;
}

/**
 * Drop selected values that are no longer on offer.
 *
 * Switching phase changes which zones and categories exist, so a selection made
 * under the old phase can hold values that now match nothing -- which would show
 * a ticked box that contributes zero rows. Pruning keeps the picker honest.
 */
export function pruneSelection(
    selection: DownloadSelection,
    zoneOptions: DownloadOption[],
    categoryOptions: DownloadOption[],
): DownloadSelection {
    const zoneValues = new Set(zoneOptions.map((option) => option.value));
    const categoryValues = new Set(categoryOptions.map((option) => option.value));

    return {
        phases: selection.phases,
        zones: selection.zones.filter((zone) => zoneValues.has(zone)),
        categories: selection.categories.filter((category) =>
            categoryValues.has(category),
        ),
    };
}

/** Every axis needs at least one tick before a download makes sense. */
export function isSelectionComplete(selection: DownloadSelection): boolean {
    return (
        selection.phases.length > 0 &&
        selection.zones.length > 0 &&
        selection.categories.length > 0
    );
}

/**
 * Resolve a button's seed into a full selection, defaulting each unspecified
 * axis to everything available. A seeded value that is no longer on offer is
 * dropped, so a stale seed degrades to "all" rather than to "nothing".
 */
export function resolveSeed(
    seed: DownloadSeed,
    phaseOptions: DownloadOption[],
    zoneOptions: DownloadOption[],
    categoryOptions: DownloadOption[],
): DownloadSelection {
    const pick = (
        seeded: string[] | undefined,
        options: DownloadOption[],
    ): string[] => {
        const available = options.map((option) => option.value);
        if (!seeded) return available;
        const kept = seeded.filter((value) => available.includes(value));
        return kept.length > 0 ? kept : available;
    };

    return {
        phases: pick(seed.phases, phaseOptions) as DesignPhase[],
        zones: pick(seed.zones, zoneOptions),
        categories: pick(seed.categories, categoryOptions),
    };
}

/* ------------------------------------------------------------------ *
 * 4. Plain-language summary
 * ------------------------------------------------------------------ */

/** The option's human label, falling back to the raw value. */
function labelFor(value: string, options: DownloadOption[]): string {
    return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * One readable segment per axis, e.g. ["All phases", "Zone A", "2 of 5 categories"].
 *
 * The dialog joins these into the footer sentence. A raw "12 tasks" says how
 * MANY but not WHAT; this says what, so the two together describe the document
 * about to be produced without the reader re-scanning three checkbox lists.
 */
export function describeSelection(
    selection: DownloadSelection,
    available: {
        phases: DownloadOption[];
        zones: DownloadOption[];
        categories: DownloadOption[];
    },
): string[] {
    const segment = (
        picked: string[],
        options: DownloadOption[],
        plural: string,
    ): string | null => {
        if (options.length === 0) return null;
        if (picked.length === 0) return `No ${plural}`;
        if (picked.length === options.length) return `All ${plural}`;
        if (picked.length === 1) return labelFor(picked[0], options);
        return `${picked.length} of ${options.length} ${plural}`;
    };

    return [
        segment(selection.phases, available.phases, "phases"),
        segment(selection.zones, available.zones, "zones"),
        segment(selection.categories, available.categories, "categories"),
    ].filter((part): part is string => part !== null);
}

/* ------------------------------------------------------------------ *
 * 5. Query params + filename
 * ------------------------------------------------------------------ */

/**
 * Build the download_pdf query string.
 *
 * A filter param is OMITTED when its axis is fully selected -- the Jinja reads an
 * absent `zones`/`categories` as "all", which keeps the URL short on the common
 * path. `phases` is ALWAYS sent, because an absent `phase` means "Onboarding
 * only" to the print format's legacy default, not "all".
 */
export function buildDownloadParams(
    trackerId: string,
    selection: DownloadSelection,
    available: {
        phases: DownloadOption[];
        zones: DownloadOption[];
        categories: DownloadOption[];
    },
): URLSearchParams {
    const params = new URLSearchParams({
        doctype: DOWNLOAD_DOCTYPE,
        name: trackerId,
        format: PRINT_FORMAT_NAME,
        no_letterhead: "0",
        _lang: "en",
    });

    params.append(PRINT_PARAM.phases, JSON.stringify(selection.phases));

    if (selection.zones.length < available.zones.length) {
        params.append(PRINT_PARAM.zones, JSON.stringify(selection.zones));
    }
    if (selection.categories.length < available.categories.length) {
        params.append(PRINT_PARAM.categories, JSON.stringify(selection.categories));
    }

    return params;
}

/** Strip anything a filesystem would rather not see. */
function sanitizeFilenamePart(value: string): string {
    return (value || "").replace(/[^a-zA-Z0-9-_]/g, "_");
}

/**
 * Name the file after the selection: exact names while a single value is picked,
 * counts once several are, so a 12-zone export does not produce a 400-char name.
 */
export function buildDownloadFilename(
    projectName: string,
    selection: DownloadSelection,
    available: {
        phases: DownloadOption[];
        zones: DownloadOption[];
        categories: DownloadOption[];
    },
    now: Date,
): string {
    const describe = (
        picked: string[],
        total: number,
        allLabel: string,
        pluralLabel: string,
    ): string | null => {
        if (total > 0 && picked.length === total) return allLabel;
        if (picked.length === 1) {
            return sanitizeFilenamePart(picked[0]) || UNCATEGORIZED_LABEL;
        }
        return `${picked.length}${pluralLabel}`;
    };

    const parts = [
        sanitizeFilenamePart(projectName) || "Project",
        describe(selection.phases, available.phases.length, "AllPhases", "Phases"),
        describe(selection.zones, available.zones.length, "AllZones", "Zones"),
    ];

    // Categories only earn a slot when they are actually narrowed.
    if (selection.categories.length < available.categories.length) {
        parts.push(
            describe(
                selection.categories,
                available.categories.length,
                "AllCategories",
                "Categories",
            ) as string,
        );
    }

    parts.push(format(now, "dd_MMM_yyyy"), "DesignTracker");

    return `${parts.filter(Boolean).join("-")}.pdf`;
}
