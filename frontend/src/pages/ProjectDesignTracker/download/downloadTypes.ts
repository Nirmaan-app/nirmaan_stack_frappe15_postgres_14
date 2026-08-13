// frontend/src/pages/ProjectDesignTracker/download/downloadTypes.ts
//
// Types shared by the pure logic, the hook and the dialog. Nothing here imports
// React -- keep it that way so downloadSelection.ts stays unit-testable.

import { ALL_PHASES } from "./downloadConstants";

/** "Onboarding" | "Handover" */
export type DesignPhase = (typeof ALL_PHASES)[number];

/**
 * A complete, resolved picker state. This is what gets turned into query params
 * and what the "N tasks" preview is counted against.
 *
 * An empty array on any axis means "nothing selected" -- NOT "everything". The
 * dialog blocks Download in that state; the "absent param means all" shortcut
 * happens later, in buildDownloadParams, and only when the axis is FULLY
 * selected.
 */
export interface DownloadSelection {
    phases: DesignPhase[];
    zones: string[];
    categories: string[];
}

/**
 * What a button pre-fills the dialog with. Any axis left undefined defaults to
 * "everything available" once the dialog opens.
 */
export type DownloadSeed = Partial<DownloadSelection>;

/** One checkbox row: the stored value, what the user reads, and how many tasks it carries. */
export interface DownloadOption {
    value: string;
    label: string;
    count: number;
}

/**
 * The subset of a design-tracker task row this folder reads. Declared
 * structurally (rather than importing DesignTrackerTask) so the pure module has
 * no dependency on the page's type barrel and the tests can pass plain literals.
 */
export interface DownloadableTask {
    task_phase?: string | null;
    task_zone?: string | null;
    design_category?: string | null;
    task_status?: string | null;
}
