import { describe, it, expect } from 'vitest';
import {
    partitionForBulk,
    bulkSkipReason,
    isValidDeadlineInput,
    summarizeBulk,
    canBulkEdit,
    canBulkMarkNotApplicable,
    canPerformBulkAction,
    isBulkStatusAction,
    statusesNeedingCheck,
    totalNeedingCheck,
    formatStatusCheckCounts,
    BULK_STATUS_OPTIONS,
    splitForApproval,
    approvableTasks,
    rejectableTasks,
    approvalTargetFor,
    type BulkTaskLike,
    type ApprovalTaskLike,
} from './commissionBulk';

const task = (name: string, task_status: string): BulkTaskLike => ({
    name,
    task_name: `Task ${name}`,
    task_status,
});

const ALL_STATUSES = [
    'Pending',
    'Rejected',
    'Pending Approval',
    'Submitted',
    'Client Accepted',
    'Not Applicable',
];

describe('bulkSkipReason — status actions carry NO from-status restriction', () => {
    it('marks Not Applicable from EVERY status except one already there', () => {
        const allowed = ALL_STATUSES.filter(
            (s) => bulkSkipReason(task('t', s), 'mark_not_applicable') === null,
        );
        expect(allowed).toEqual([
            'Pending',
            'Rejected',
            'Pending Approval',
            'Submitted',
            'Client Accepted',
        ]);
    });

    it('moves to Pending from EVERY status except one already there', () => {
        const allowed = ALL_STATUSES.filter(
            (s) => bulkSkipReason(task('t', s), 'mark_pending') === null,
        );
        expect(allowed).toEqual([
            'Rejected',
            'Pending Approval',
            'Submitted',
            'Client Accepted',
            'Not Applicable',
        ]);
    });

    it('reaches an accepted report — the deliberate cost of warning instead of refusing', () => {
        for (const s of ['Submitted', 'Client Accepted', 'Pending Approval']) {
            expect(bulkSkipReason(task('t', s), 'mark_not_applicable')).toBeNull();
            expect(bulkSkipReason(task('t', s), 'mark_pending')).toBeNull();
        }
    });

    it('declines ONLY a row already at the target, so counts stay honest', () => {
        expect(bulkSkipReason(task('t', 'Not Applicable'), 'mark_not_applicable'))
            .toBe('Already Not Applicable');
        expect(bulkSkipReason(task('t', 'Pending'), 'mark_pending')).toBe('Already Pending');
    });

    it('moves a blank-status row rather than treating it as ineligible', () => {
        expect(bulkSkipReason({ name: 't' }, 'mark_not_applicable')).toBeNull();
    });
});

describe('BULK_STATUS_OPTIONS', () => {
    it('offers exactly Pending and Not Applicable', () => {
        expect(BULK_STATUS_OPTIONS.map((o) => o.label)).toEqual(['Pending', 'Not Applicable']);
    });

    it('every option maps to a status action, so all take the Admin gate', () => {
        for (const opt of BULK_STATUS_OPTIONS) {
            expect(isBulkStatusAction(opt.value)).toBe(true);
            expect(canPerformBulkAction(opt.value, 'Nirmaan PMO Executive Profile', 'a@b.com')).toBe(false);
            expect(canPerformBulkAction(opt.value, 'Nirmaan Admin Profile', 'a@b.com')).toBe(true);
        }
    });
});

describe('statusesNeedingCheck — the warning note', () => {
    const countsFor = (statuses: string[]) =>
        statusesNeedingCheck(statuses.map((s, i) => task(`t${i}`, s)));

    it('names every selected status that is neither Pending nor Not Applicable', () => {
        expect(countsFor(['Pending', 'Submitted', 'Client Accepted'])).toEqual([
            { status: 'Submitted', count: 1 },
            { status: 'Client Accepted', count: 1 },
        ]);
        expect(countsFor(ALL_STATUSES).map((c) => c.status))
            .toEqual(['Rejected', 'Pending Approval', 'Submitted', 'Client Accepted']);
    });

    it('COUNTS how many reports sit in each status', () => {
        expect(countsFor(['Submitted', 'Submitted', 'Rejected', 'Submitted'])).toEqual([
            { status: 'Submitted', count: 3 },
            { status: 'Rejected', count: 1 },
        ]);
    });

    it('stays silent when the selection is only Pending / Not Applicable', () => {
        expect(countsFor(['Pending', 'Not Applicable', 'Pending'])).toEqual([]);
        expect(countsFor([])).toEqual([]);
    });

    it('does NOT depend on which status was picked — it describes the selection', () => {
        // The rule is about what you ticked, not where it is going.
        expect(countsFor(['Submitted'])).toEqual([{ status: 'Submitted', count: 1 }]);
    });

    it('names a blank status rather than hiding it', () => {
        expect(statusesNeedingCheck([{ name: 't' }])).toEqual([{ status: 'unknown', count: 1 }]);
    });

    it('totals the affected reports and never counts a Pending / N-A row', () => {
        const counts = countsFor(['Pending', 'Submitted', 'Submitted', 'Not Applicable', 'Rejected']);
        expect(totalNeedingCheck(counts)).toBe(3);
        expect(totalNeedingCheck([])).toBe(0);
    });

    it('formats each status with its count', () => {
        expect(formatStatusCheckCounts(countsFor(['Submitted', 'Submitted', 'Client Accepted'])))
            .toBe('Submitted (2), Client Accepted (1)');
        expect(formatStatusCheckCounts([])).toBe('');
    });
});

describe('bulkSkipReason — set_deadline', () => {
    it('allows every status except Not Applicable', () => {
        const allowed = ALL_STATUSES.filter(
            (s) => bulkSkipReason(task('t', s), 'set_deadline') === null,
        );
        expect(allowed).toEqual([
            'Pending',
            'Rejected',
            'Pending Approval',
            'Submitted',
            'Client Accepted',
        ]);
    });

    it('explains why a Not Applicable row is skipped', () => {
        expect(bulkSkipReason(task('t', 'Not Applicable'), 'set_deadline'))
            .toBe('Not Applicable reports carry no deadline');
    });
});

describe('partitionForBulk', () => {
    const mixed = [
        task('a', 'Pending'),
        task('b', 'Submitted'),
        task('c', 'Rejected'),
        task('d', 'Not Applicable'),
    ];

    it('splits a mixed selection and keeps a reason for every skip', () => {
        // Only the already-Not-Applicable row ('d') is declined; the Submitted row
        // ('b') moves, because a status action no longer restricts the from-status.
        const { eligible, skipped } = partitionForBulk(mixed, 'mark_not_applicable');
        expect(eligible.map((t) => t.name)).toEqual(['a', 'b', 'c']);
        expect(skipped.map((s) => s.task.name)).toEqual(['d']);
        expect(skipped.every((s) => s.reason.length > 0)).toBe(true);
    });

    it('never loses or duplicates a row', () => {
        for (const action of ['set_deadline', 'mark_not_applicable'] as const) {
            const { eligible, skipped } = partitionForBulk(mixed, action);
            const seen = [...eligible.map((t) => t.name), ...skipped.map((s) => s.task.name)];
            expect(seen.sort()).toEqual(['a', 'b', 'c', 'd']);
        }
    });

    it('preserves selection order within each bucket', () => {
        const { eligible } = partitionForBulk(
            [task('z', 'Pending'), task('y', 'Pending'), task('x', 'Pending')],
            'mark_not_applicable',
        );
        expect(eligible.map((t) => t.name)).toEqual(['z', 'y', 'x']);
    });

    it('returns empty buckets for an empty selection', () => {
        expect(partitionForBulk([], 'set_deadline')).toEqual({ eligible: [], skipped: [] });
    });
});

describe('splitForApproval — approve is TWO outcomes, not one', () => {
    const queued = (
        name: string, report_type?: string, approval_proof?: string,
    ): ApprovalTaskLike => ({
        name,
        task_name: `Task ${name}`,
        task_status: 'Pending Approval',
        report_type,
        approval_proof,
    });

    it('sends Field to one bucket and Vendor to the other', () => {
        const split = splitForApproval([
            queued('a', 'Field'),
            queued('b', 'Vendor', '/files/v.pdf'),
            queued('c', 'Field'),
        ]);
        expect(split.field.map((t) => t.name)).toEqual(['a', 'c']);
        expect(split.vendor.map((t) => t.name)).toEqual(['b']);
        expect(split.skipped).toEqual([]);
    });

    it('treats a blank report_type as Field', () => {
        expect(splitForApproval([queued('a'), queued('b', '')]).field).toHaveLength(2);
    });

    it('refuses a Vendor row with no uploaded file — Client Accepted is terminal', () => {
        const split = splitForApproval([queued('a', 'Vendor'), queued('b', 'Vendor', '   ')]);
        expect(split.vendor).toEqual([]);
        expect(split.skipped).toHaveLength(2);
        expect(split.skipped[0].reason).toContain('no uploaded file');
    });

    it('refuses a row that is not awaiting approval', () => {
        const split = splitForApproval([
            { name: 'x', task_status: 'Submitted', report_type: 'Field' },
            { name: 'y', task_status: 'Client Accepted', report_type: 'Vendor', approval_proof: '/f.pdf' },
        ]);
        expect(approvableTasks(split)).toEqual([]);
        expect(split.skipped.map((s) => s.reason)).toEqual([
            'Not awaiting approval',
            'Not awaiting approval',
        ]);
    });

    it('never loses a row across the three buckets', () => {
        const tasks = [
            queued('a', 'Field'),
            queued('b', 'Vendor', '/f.pdf'),
            queued('c', 'Vendor'),
            { name: 'd', task_status: 'Rejected' },
        ];
        const split = splitForApproval(tasks);
        const seen = [
            ...split.field.map((t) => t.name),
            ...split.vendor.map((t) => t.name),
            ...split.skipped.map((s) => s.task.name),
        ];
        expect(seen.sort()).toEqual(['a', 'b', 'c', 'd']);
    });

    it('maps each type to the status it will land in', () => {
        expect(approvalTargetFor('Field')).toBe('Submitted');
        expect(approvalTargetFor(undefined)).toBe('Submitted');
        expect(approvalTargetFor('Vendor')).toBe('Client Accepted');
    });

    it('rejects uniformly — both types, no split, queue-only', () => {
        const tasks = [
            queued('a', 'Field'),
            queued('b', 'Vendor'),               // no file: still rejectable
            { name: 'c', task_status: 'Submitted' },
        ];
        expect(rejectableTasks(tasks).map((t) => t.name)).toEqual(['a', 'b']);
    });
});

describe('isValidDeadlineInput', () => {
    it('accepts a plain calendar date', () => {
        expect(isValidDeadlineInput('2026-08-11')).toBe(true);
        expect(isValidDeadlineInput(' 2026-12-31 ')).toBe(true);
    });

    it('rejects blank — clearing a deadline is Mark Not Applicable, not this dialog', () => {
        expect(isValidDeadlineInput('')).toBe(false);
        expect(isValidDeadlineInput('   ')).toBe(false);
        expect(isValidDeadlineInput(undefined)).toBe(false);
        expect(isValidDeadlineInput(null)).toBe(false);
    });

    it('rejects a well-shaped but impossible date', () => {
        expect(isValidDeadlineInput('2026-02-31')).toBe(false);
        expect(isValidDeadlineInput('2026-13-01')).toBe(false);
        expect(isValidDeadlineInput('2026-00-10')).toBe(false);
    });

    it('rejects other formats', () => {
        expect(isValidDeadlineInput('11-08-2026')).toBe(false);
        expect(isValidDeadlineInput('2026-8-1')).toBe(false);
        expect(isValidDeadlineInput('2026-08-11T00:00:00')).toBe(false);
    });
});

describe('bulk access — Admin + PMO, status Admin-only', () => {
    const EDIT_ROLES = ['Nirmaan Admin Profile', 'Nirmaan PMO Executive Profile'];

    it('opens Bulk Update for Admin and PMO only', () => {
        for (const role of EDIT_ROLES) expect(canBulkEdit(role, 'a@b.com')).toBe(true);
        expect(canBulkEdit(null, 'Administrator')).toBe(true);
    });

    it('refuses Design Lead — narrower than the page hasEditStructureAccess', () => {
        expect(canBulkEdit('Nirmaan Design Lead Profile', 'a@b.com')).toBe(false);
        expect(canBulkMarkNotApplicable('Nirmaan Design Lead Profile', 'a@b.com')).toBe(false);
    });

    it('refuses the restricted assignee roles outright', () => {
        for (const role of ['Nirmaan Design Executive Profile', 'Nirmaan Project Manager Profile']) {
            expect(canBulkEdit(role, 'a@b.com')).toBe(false);
            expect(canBulkMarkNotApplicable(role, 'a@b.com')).toBe(false);
        }
        expect(canBulkEdit(undefined, undefined)).toBe(false);
    });

    it('restricts status changes to Admin — PMO may set a deadline but not status', () => {
        expect(canBulkMarkNotApplicable('Nirmaan Admin Profile', 'a@b.com')).toBe(true);
        expect(canBulkMarkNotApplicable(null, 'Administrator')).toBe(true);
        expect(canBulkEdit('Nirmaan PMO Executive Profile', 'a@b.com')).toBe(true);
        expect(canBulkMarkNotApplicable('Nirmaan PMO Executive Profile', 'a@b.com')).toBe(false);
    });

    it('never lets status access exceed dialog access', () => {
        const roles = [
            ...EDIT_ROLES,
            'Nirmaan Design Lead Profile',
            'Nirmaan Project Manager Profile',
            null,
        ];
        for (const role of roles) {
            if (canBulkMarkNotApplicable(role, 'a@b.com')) {
                expect(canBulkEdit(role, 'a@b.com')).toBe(true);
            }
        }
    });

    it('routes each action to the right gate', () => {
        expect(canPerformBulkAction('set_deadline', 'Nirmaan PMO Executive Profile', 'a@b.com')).toBe(true);
        expect(canPerformBulkAction('mark_not_applicable', 'Nirmaan PMO Executive Profile', 'a@b.com')).toBe(false);
        expect(canPerformBulkAction('mark_pending', 'Nirmaan PMO Executive Profile', 'a@b.com')).toBe(false);
        expect(canPerformBulkAction('mark_not_applicable', 'Nirmaan Admin Profile', 'a@b.com')).toBe(true);
        expect(canPerformBulkAction('set_deadline', 'Nirmaan Design Lead Profile', 'a@b.com')).toBe(false);
    });
});

describe('summarizeBulk', () => {
    it('counts eligible against the whole selection', () => {
        // The Not Applicable row is the only one declined (already there).
        const partition = partitionForBulk(
            [task('a', 'Pending'), task('b', 'Not Applicable'), task('c', 'Pending')],
            'mark_not_applicable',
        );
        expect(summarizeBulk(partition)).toBe('2 of 3 selected');
    });
});
