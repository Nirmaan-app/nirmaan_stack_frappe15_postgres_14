// Bulk task actions on the commission tracker — the PURE eligibility rules.
//
// These rules MIRROR the per-row actions and must never drift from them:
//   - "Mark as Not Applicable" is offered per row only from Pending / Rejected,
//     and it WIPES the deadline (ReportActionCell.tsx, the `Ban` menu item).
//   - The deadline is edited per row from the Configure modal, which allows it at
//     ANY status (only report_type is status-gated there) — so bulk allows every
//     status except Not Applicable, whose deadline is intentionally empty.
//
// Kept free of React/IO on purpose: this is the only part of the bulk feature that
// is testable (vitest runs with environment "node" — there is no DOM env), and the
// server re-applies the same rules in bulk_update_tasks.py, which is the real gate.

export type BulkAction = 'set_deadline' | 'mark_not_applicable' | 'mark_pending';

export const NOT_APPLICABLE = 'Not Applicable';
export const PENDING = 'Pending';

/**
 * The statuses a bulk status change is UNREMARKABLE on. Anything else in the
 * selection raises the check-first warning -- it is the ONE rule behind that
 * banner: "this report is neither Pending nor Not Applicable, make sure before
 * you change its status."
 */
export const UNREMARKABLE_STATUSES: readonly string[] = [PENDING, NOT_APPLICABLE];

/** The status a bulk action moves rows TO; null for the deadline action. */
export const targetStatusFor = (action: BulkAction): string | null => {
    if (action === 'mark_not_applicable') return NOT_APPLICABLE;
    if (action === 'mark_pending') return PENDING;
    return null;
};

/** The two values the bulk STATUS field offers, in display order. */
export const BULK_STATUS_OPTIONS: readonly { label: string; value: BulkAction }[] = [
    { label: PENDING, value: 'mark_pending' },
    { label: NOT_APPLICABLE, value: 'mark_not_applicable' },
];

export interface BulkTaskLike {
    name: string;
    task_name?: string;
    task_status?: string;
}

export interface BulkSkip<T> {
    task: T;
    /** Human-readable, shown verbatim in the confirm dialog. */
    reason: string;
}

export interface BulkPartition<T> {
    eligible: T[];
    skipped: BulkSkip<T>[];
}

/**
 * Why a single task cannot take `action`, or null when it can.
 * Exported so the reason strings have one definition.
 */
export const bulkSkipReason = (task: BulkTaskLike, action: BulkAction): string | null => {
    const status = (task.task_status || '').trim();

    // A status action has NO from-status restriction (owner ruling) -- the ONLY
    // rows it declines are the ones already AT the target, where there is nothing
    // to write and counting them would inflate the result. Everything else moves,
    // Submitted and Client Accepted included; the dialog WARNS instead of refusing.
    const target = targetStatusFor(action);
    if (target) {
        return status === target ? `Already ${target}` : null;
    }

    if (action === 'set_deadline') {
        if (status === NOT_APPLICABLE) return 'Not Applicable reports carry no deadline';
        return null;
    }

    return `Unknown action: ${action}`;
};

/** Split a selection into what the action will touch and what it will skip (with reasons). */
export const partitionForBulk = <T extends BulkTaskLike>(
    tasks: readonly T[],
    action: BulkAction,
): BulkPartition<T> => {
    const eligible: T[] = [];
    const skipped: BulkSkip<T>[] = [];

    for (const task of tasks) {
        const reason = bulkSkipReason(task, action);
        if (reason) skipped.push({ task, reason });
        else eligible.push(task);
    }

    return { eligible, skipped };
};

/**
 * A deadline the bulk endpoint will accept: a plain YYYY-MM-DD calendar date.
 * Blank is INVALID here — clearing a deadline is what "Mark Not Applicable" does,
 * never a side effect of the deadline dialog.
 */
export const isValidDeadlineInput = (value: string | undefined | null): boolean => {
    const raw = (value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;

    const [y, m, d] = raw.split('-').map(Number);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    // Rejects impossible calendar dates that still match the shape (e.g. 2026-02-31).
    return parsed.getUTCFullYear() === y
        && parsed.getUTCMonth() === m - 1
        && parsed.getUTCDate() === d;
};

export interface StatusCheckCount {
    status: string;
    /** How many selected reports are in it — the number about to be changed. */
    count: number;
}

/**
 * Statuses in the selection that deserve a second look before a status change,
 * WITH how many reports sit in each -- distinct, in first-seen order. The rule is
 * simply "neither Pending nor Not Applicable", so a Submitted or Client Accepted
 * report is named.
 *
 * PURELY INFORMATIONAL: nothing is blocked and nothing is skipped. It reads the
 * WHOLE selection, not a partition, precisely because those rows are no longer
 * excluded from the write.
 */
export const statusesNeedingCheck = <T extends BulkTaskLike>(
    tasks: readonly T[],
): StatusCheckCount[] => {
    const counts: StatusCheckCount[] = [];
    for (const task of tasks) {
        const status = (task.task_status || '').trim() || 'unknown';
        if (UNREMARKABLE_STATUSES.includes(status)) continue;
        const existing = counts.find((c) => c.status === status);
        if (existing) existing.count += 1;
        else counts.push({ status, count: 1 });
    }
    return counts;
};

/** Total reports covered by the warning — the headline number. */
export const totalNeedingCheck = (counts: readonly StatusCheckCount[]): number =>
    counts.reduce((sum, c) => sum + c.count, 0);

/** "Submitted (12), Client Accepted (5)" */
export const formatStatusCheckCounts = (counts: readonly StatusCheckCount[]): string =>
    counts.map((c) => `${c.status} (${c.count})`).join(', ');

/** "12 of 15 selected" summary for the confirm dialogs. */
export const summarizeBulk = <T extends BulkTaskLike>(partition: BulkPartition<T>): string => {
    const total = partition.eligible.length + partition.skipped.length;
    return `${partition.eligible.length} of ${total} selected`;
};

// ── approval queue (Pending Approval tab) ────────────────────────────────

export const PENDING_APPROVAL = 'Pending Approval';
export const SUBMITTED = 'Submitted';
export const CLIENT_ACCEPTED = 'Client Accepted';
export const REJECTED = 'Rejected';

export interface ApprovalTaskLike extends BulkTaskLike {
    report_type?: string;
    approval_proof?: string;
}

/** Blank counts as Field — the same normalisation the whole app uses. */
export const isVendorReport = (reportType?: string | null): boolean =>
    (reportType || 'Field').trim() === 'Vendor';

/**
 * What APPROVING a row means. Vendor -> Client Accepted (TERMINAL; the uploaded
 * PDF is the signed artifact). Field -> Submitted (still awaiting the client
 * signature). Mirrors ApprovalActionDialog.doApprove.
 */
export const approvalTargetFor = (reportType?: string | null): string =>
    isVendorReport(reportType) ? CLIENT_ACCEPTED : SUBMITTED;

export interface ApprovalSplit<T> {
    /** → Submitted. A midpoint; an admin can still send these back. */
    field: T[];
    /** → Client Accepted. TERMINAL, and the row menu offers no way back. */
    vendor: T[];
    skipped: BulkSkip<T>[];
}

/**
 * Split an approval selection three ways. The two buckets exist because ONE button
 * produces TWO different outcomes, and the dialog has to say so before the click.
 */
export const splitForApproval = <T extends ApprovalTaskLike>(
    tasks: readonly T[],
): ApprovalSplit<T> => {
    const split: ApprovalSplit<T> = { field: [], vendor: [], skipped: [] };

    for (const task of tasks) {
        if ((task.task_status || '').trim() !== PENDING_APPROVAL) {
            split.skipped.push({ task, reason: 'Not awaiting approval' });
        } else if (!isVendorReport(task.report_type)) {
            split.field.push(task);
        } else if (!(task.approval_proof || '').trim()) {
            // Client Accepted is terminal — never write it with no artifact behind it.
            split.skipped.push({ task, reason: 'Vendor report has no uploaded file' });
        } else {
            split.vendor.push(task);
        }
    }

    return split;
};

/** Rows a bulk APPROVE will actually write. */
export const approvableTasks = <T extends ApprovalTaskLike>(split: ApprovalSplit<T>): T[] =>
    [...split.field, ...split.vendor];

/** Rows a bulk REJECT will write — uniform across both types. */
export const rejectableTasks = <T extends ApprovalTaskLike>(tasks: readonly T[]): T[] =>
    tasks.filter((t) => (t.task_status || '').trim() === PENDING_APPROVAL);

// ── access ───────────────────────────────────────────────────────────────
//
// MIRRORS the Design Tracker's split (BulkUpdateDialog + bulk_update_task_status):
// the dialog itself opens for the edit-structure roles, but the STATUS section is
// Admin-only, hidden for everyone else and refused by the server. "Mark Not
// Applicable" is a status change, so it takes the Admin gate; the deadline takes
// the wider one. Convenience only -- bulk_update_tasks.py is the boundary.

/**
 * Roles that may open Bulk Update and set a deadline -- ADMIN + PMO ONLY
 * (owner ruling). Deliberately NARROWER than the page's `hasEditStructureAccess`,
 * which also carries Design Lead: a Design Lead keeps the row checkboxes (they
 * drive the selected-rows CSV export) but gets no Bulk Update button.
 */
export const BULK_EDIT_PROFILES: readonly string[] = [
    'Nirmaan Admin Profile',
    'Nirmaan PMO Executive Profile',
];

export const canBulkEdit = (role?: string | null, userId?: string | null): boolean =>
    userId === 'Administrator' || (!!role && BULK_EDIT_PROFILES.includes(role));

/** Marking Not Applicable is a STATUS change -> Admin only, as in the Design Tracker. */
export const canBulkMarkNotApplicable = (role?: string | null, userId?: string | null): boolean =>
    userId === 'Administrator' || role === 'Nirmaan Admin Profile';

/** Both status actions take the Admin gate; the deadline takes the wider one. */
export const isBulkStatusAction = (action: BulkAction): boolean =>
    action === 'mark_not_applicable' || action === 'mark_pending';

export const canPerformBulkAction = (
    action: BulkAction,
    role?: string | null,
    userId?: string | null,
): boolean =>
    isBulkStatusAction(action)
        ? canBulkMarkNotApplicable(role, userId)
        : canBulkEdit(role, userId);
