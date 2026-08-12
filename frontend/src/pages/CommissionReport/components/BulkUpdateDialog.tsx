// Bulk update over the tracker table's selected rows.
//
// SHAPE + PERMISSIONS FOLLOW THE DESIGN TRACKER (ProjectDesignTracker/components/
// BulkUpdateDialog.tsx): one dialog opened from the DataTable's `toolbarActions`,
// sections applied together, and the SPLIT gate -- the dialog and the deadline open
// for the edit-structure roles, while the STATUS section is Admin-only, hidden for
// everyone else and refused by the server.
//
// It deliberately DOES keep two things that twin does not, because they mirror
// commission's OWN per-row rules: eligibility (Not Applicable is offered only from
// Pending/Rejected, exactly as ReportActionCell does) and a per-row skip list, so a
// row is never dropped silently.
//
// The two modules are intentionally NOT shared -- same convention as the two
// NewTrackerModals.

import React, { useMemo, useState } from 'react';
import { useFrappePostCall } from 'frappe-react-sdk';
import ReactSelect from 'react-select';
import { AlertCircle, AlertTriangle, Edit3, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { getSelectStyles } from '@/config/selectTheme';
import { toast } from '@/components/ui/use-toast';

import type { CommissionReportTask } from '../types';
import {
    partitionForBulk, isValidDeadlineInput, BULK_STATUS_OPTIONS,
    statusesNeedingCheck, totalNeedingCheck, formatStatusCheckCounts,
    type BulkAction, type BulkPartition,
} from '../commissionBulk';

type StatusOption = { label: string; value: BulkAction };

const ENDPOINT = 'nirmaan_stack.api.commission_report.bulk_update_tasks.bulk_update_tasks';

interface Props {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    trackerId: string;
    /** Rows currently ticked in the table, in display order. */
    selectedTasks: CommissionReportTask[];
    /** Admin-only sections (status). Server-enforced regardless. */
    isAdmin: boolean;
    /** Refetch the tracker + clear the selection after a successful apply. */
    onApplied: () => void;
}

export const BulkUpdateDialog: React.FC<Props> = ({
    isOpen, onOpenChange, trackerId, selectedTasks, isAdmin, onApplied,
}) => {
    const [selectedStatus, setSelectedStatus] = useState<StatusOption | null>(null);
    const [deadlineDate, setDeadlineDate] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const { call } = useFrappePostCall(ENDPOINT);

    const deadlinePartition = useMemo(
        () => partitionForBulk(selectedTasks, 'set_deadline'),
        [selectedTasks],
    );
    const statusPartition = useMemo(
        () => (selectedStatus ? partitionForBulk(selectedTasks, selectedStatus.value) : null),
        [selectedTasks, selectedStatus],
    );

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setSelectedStatus(null);
            setDeadlineDate('');
        }
        onOpenChange(open);
    };

    const isNotApplicable = selectedStatus?.value === 'mark_not_applicable';
    const isPending = selectedStatus?.value === 'mark_pending';

    const wantsDeadline = isValidDeadlineInput(deadlineDate) && deadlinePartition.eligible.length > 0;
    const wantsStatus = isAdmin && !!statusPartition && statusPartition.eligible.length > 0;
    const isFormValid = wantsDeadline || wantsStatus;

    // Selected statuses that are neither Pending nor Not Applicable. WARNING ONLY —
    // those rows ARE changed; the note exists so the change is not made unnoticed.
    const statusesToCheck = useMemo(
        () => statusesNeedingCheck(selectedTasks),
        [selectedTasks],
    );

    const runAction = async (action: BulkAction, partition: BulkPartition<CommissionReportTask>) => {
        const res = await call({
            tracker: trackerId,
            task_rows: partition.eligible.map((t) => t.name),
            action,
            ...(action === 'set_deadline' ? { deadline: deadlineDate } : {}),
        });
        return {
            updated: (res?.message?.updated ?? []) as string[],
            // The server re-applies the same rules and may skip more than the client
            // predicted (a row someone else changed, or one open in the edit wizard).
            skipped: (res?.message?.skipped ?? []) as { reason: string }[],
        };
    };

    const handleApply = async () => {
        setIsSaving(true);
        try {
            const done: string[] = [];
            let serverSkipped = 0;
            let firstServerReason = '';

            const applyDeadline = async () => {
                if (!wantsDeadline) return;
                const r = await runAction('set_deadline', deadlinePartition);
                if (r.updated.length) done.push(`deadline on ${r.updated.length}`);
                serverSkipped += r.skipped.length;
                firstServerReason ||= r.skipped[0]?.reason ?? '';
            };

            const applyStatus = async () => {
                if (!wantsStatus || !statusPartition || !selectedStatus) return;
                const r = await runAction(selectedStatus.value, statusPartition);
                if (r.updated.length) done.push(`${selectedStatus.label} on ${r.updated.length}`);
                serverSkipped += r.skipped.length;
                firstServerReason ||= r.skipped[0]?.reason ?? '';
            };

            // ORDER IS LOAD-BEARING, because BOTH status actions touch the deadline.
            // Not Applicable CLEARS it, so it must run LAST (its clear is the intended
            // end state). Pending RESTORES a computed one, so it must run FIRST -- an
            // explicitly typed deadline then wins over the recomputed one.
            if (isPending) {
                await applyStatus();
                await applyDeadline();
            } else {
                await applyDeadline();
                await applyStatus();
            }

            const clientSkipped =
                (wantsDeadline ? deadlinePartition.skipped.length : 0)
                + (wantsStatus && statusPartition ? statusPartition.skipped.length : 0);
            const skippedTotal = clientSkipped + serverSkipped;

            toast({
                title: done.length ? `Updated ${done.join(', ')}` : 'Nothing was updated',
                description: skippedTotal > 0
                    ? `${skippedTotal} skipped.${firstServerReason ? ` ${firstServerReason}` : ''}`
                    : undefined,
                variant: done.length ? 'success' : 'destructive',
            });

            handleOpenChange(false);
            onApplied();
        } catch (error: any) {
            toast({
                title: 'Bulk update failed',
                description: error?.message || 'Could not apply the change.',
                variant: 'destructive',
            });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-lg overflow-visible max-h-[90vh] flex flex-col p-0">
                <DialogHeader className="p-6 pb-4 border-b shrink-0">
                    <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                        <Edit3 className="h-4 w-4" />
                        Bulk Update
                        <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px] font-medium">
                            {selectedTasks.length} report{selectedTasks.length !== 1 ? 's' : ''}
                        </Badge>
                    </DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-6 space-y-8 min-h-0">
                    {/* Selected Reports Overview */}
                    <div className="space-y-3">
                        <p className="text-sm font-semibold text-gray-900 border-b pb-1">
                            Selected Reports Overview
                        </p>
                        <div className="max-h-32 overflow-y-auto rounded border border-gray-200 divide-y divide-gray-100 bg-gray-50/50">
                            {selectedTasks.map((task) => (
                                <div key={task.name} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                                    <span className="text-xs font-medium text-gray-800 truncate">
                                        {task.task_name}
                                    </span>
                                    <Badge
                                        variant="outline"
                                        className="px-1 py-0 text-[9px] font-normal text-gray-500 border-gray-300 shrink-0"
                                    >
                                        {task.task_status}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Status Section (1st) — ADMIN ONLY, mirroring the Design Tracker */}
                    {isAdmin && (
                        <div className="space-y-3">
                            <p className="text-sm font-semibold text-gray-900 border-b pb-1">
                                Update Status
                            </p>
                            <div className="space-y-1">
                                <Label htmlFor="bulk_status" className="text-xs text-gray-600">Status</Label>
                                <ReactSelect
                                    inputId="bulk_status"
                                    options={BULK_STATUS_OPTIONS as StatusOption[]}
                                    value={selectedStatus}
                                    onChange={(opt) => setSelectedStatus(opt as StatusOption | null)}
                                    placeholder="Select status..."
                                    classNamePrefix="react-select"
                                    styles={getSelectStyles()}
                                    menuPortalTarget={document.body}
                                    menuPosition="fixed"
                                    closeMenuOnScroll={true}
                                    isDisabled={isSaving}
                                    isClearable
                                />
                            </div>

                            {statusPartition && (
                                <>
                                    <div className={`flex items-start gap-2 p-2.5 rounded-md border ${
                                        isNotApplicable
                                            ? 'bg-amber-50 border-amber-200'
                                            : 'bg-blue-50 border-blue-200'
                                    }`}>
                                        {isNotApplicable
                                            ? <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                                            : <AlertCircle className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />}
                                        <p className={`text-xs leading-snug ${isNotApplicable ? 'text-amber-700' : 'text-blue-700'}`}>
                                            {isNotApplicable
                                                ? 'Deadlines will be cleared for these reports. Only Pending and Rejected reports can be marked Not Applicable.'
                                                : 'Deadlines will be recalculated from each report’s deadline offset. Only Not Applicable reports can be moved back to Pending.'}
                                        </p>
                                    </div>
                                    {statusesToCheck.length > 0 && (
                                        <div className="flex items-start gap-2 p-2.5 rounded-md bg-red-50 border border-red-200">
                                            <AlertTriangle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                                            <div className="text-xs text-red-700 leading-snug">
                                                <p className="font-semibold mb-0.5">Make sure before you change the status</p>
                                                <p>
                                                    <span className="font-semibold">
                                                        {totalNeedingCheck(statusesToCheck)}
                                                    </span>{' '}
                                                    of the selected reports {totalNeedingCheck(statusesToCheck) !== 1 ? 'are' : 'is'} neither
                                                    Pending nor Not Applicable —{' '}
                                                    <span className="font-semibold">{formatStatusCheckCounts(statusesToCheck)}</span>.
                                                    {' '}Their status<span className="font-semibold"> will be changed</span> to {selectedStatus?.label}.
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                    <p className="text-[11px] text-gray-500">
                                        Will update{' '}
                                        <span className="font-medium text-gray-700">{statusPartition.eligible.length}</span>
                                        {' '}report{statusPartition.eligible.length !== 1 ? 's' : ''}
                                    </p>
                                </>
                            )}
                        </div>
                    )}

                    {/* Deadline Section (2nd) */}
                    <div className="space-y-3">
                        <p className="text-sm font-semibold text-gray-900 border-b pb-1">
                            Update Deadline
                        </p>
                        <Input
                            id="bulk_deadline"
                            type="date"
                            value={deadlineDate}
                            onChange={(e) => setDeadlineDate(e.target.value)}
                            disabled={isSaving}
                        />
                        {deadlineDate && (
                            <div className="flex items-start gap-2 p-2.5 rounded-md bg-blue-50 border border-blue-200">
                                <AlertCircle className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-blue-700 leading-snug">
                                    This will override the existing deadline for{' '}
                                    <span className="font-semibold">{deadlinePartition.eligible.length}</span>{' '}
                                    selected report(s).
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter className="p-6 pt-4 border-t shrink-0 gap-2 sm:gap-0 mt-0 bg-gray-50/50">
                    <DialogClose asChild>
                        <Button variant="outline" size="sm" disabled={isSaving}>Cancel</Button>
                    </DialogClose>
                    <Button
                        size="sm"
                        onClick={handleApply}
                        disabled={!isFormValid || isSaving}
                        className="bg-blue-600 hover:bg-blue-700"
                    >
                        {isSaving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <>Apply Updates to {selectedTasks.length} Report{selectedTasks.length === 1 ? '' : 's'}</>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
