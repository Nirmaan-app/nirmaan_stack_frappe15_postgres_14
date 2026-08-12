// Bulk Approve / Reject for the Pending Approval queue.
//
// ⚠️ THE WHOLE POINT OF THIS DIALOG IS THAT "APPROVE" IS NOT ONE OUTCOME.
// Per row, approving means:
//   Field  -> Submitted       (a midpoint; an admin can still send it back)
//   Vendor -> Client Accepted (TERMINAL -- and ReportActionCell's admin
//                              "Send back to Pending" EXCLUDES Vendor rows, so the
//                              row menu offers no way back)
// So the Vendor half gets its own red warning, and the confirmation never
// collapses to a single "Approve N".
//
// Reject is uniform: both types -> Rejected.
//
// The split is computed by the pure `splitForApproval`; the SERVER re-derives every
// target from the row's own stored report_type, so a stale page cannot write the
// wrong terminal status.

import React, { useMemo, useState } from 'react';
import { useFrappePostCall } from 'frappe-react-sdk';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';

import {
    splitForApproval, approvableTasks, rejectableTasks,
    type ApprovalTaskLike,
} from '../commissionBulk';

const ENDPOINT = 'nirmaan_stack.api.commission_report.bulk_update_tasks.bulk_update_tasks';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mode: 'approve' | 'reject' | null;
    trackerId: string;
    /** The ticked rows of the Pending Approval queue. */
    selectedTasks: ApprovalTaskLike[];
    /** Refetch the queue + the parent after a successful run. */
    onApplied: () => void;
}

export const BulkApprovalDialog: React.FC<Props> = ({
    open, onOpenChange, mode, trackerId, selectedTasks, onApplied,
}) => {
    const [busy, setBusy] = useState(false);
    const { call } = useFrappePostCall(ENDPOINT);

    const split = useMemo(() => splitForApproval(selectedTasks), [selectedTasks]);
    const toWrite = mode === 'approve'
        ? approvableTasks(split)
        : rejectableTasks(selectedTasks);

    if (!mode) return null;

    const run = async () => {
        setBusy(true);
        try {
            const res = await call({
                tracker: trackerId,
                task_rows: toWrite.map((t) => t.name),
                action: mode,
            });

            const byStatus: Record<string, number> = res?.message?.updated_by_status ?? {};
            const serverSkipped: { reason: string }[] = res?.message?.skipped ?? [];
            // Report each landing state separately -- they are different events.
            const parts = Object.entries(byStatus).map(([status, n]) => `${n} → ${status}`);
            const skippedTotal = split.skipped.length + serverSkipped.length;

            toast({
                title: parts.length ? parts.join(', ') : 'Nothing was updated',
                description: skippedTotal > 0
                    ? `${skippedTotal} skipped.${serverSkipped.length ? ` ${serverSkipped[0].reason}` : ''}`
                    : undefined,
                variant: parts.length ? 'success' : 'destructive',
            });

            onOpenChange(false);
            onApplied();
        } catch (error: any) {
            toast({
                title: mode === 'approve' ? 'Bulk approve failed' : 'Bulk reject failed',
                description: error?.message || 'Could not apply the change.',
                variant: 'destructive',
            });
        } finally {
            setBusy(false);
        }
    };

    const skipList = split.skipped.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span className="font-semibold">{split.skipped.length} skipped</span>
            {' — '}{split.skipped[0].reason}
            {split.skipped.length > 1 ? ' (and others)' : ''}
        </div>
    );

    // ── REJECT ───────────────────────────────────────────────────────────
    if (mode === 'reject') {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base">
                            <AlertTriangle className="h-4 w-4 text-red-600" />
                            Reject {toWrite.length} report{toWrite.length !== 1 ? 's' : ''}?
                        </DialogTitle>
                        <DialogDescription className="text-sm">
                            They will be marked <strong>Rejected</strong> and sent back to the team —
                            Field reports to <strong>Resolve</strong> (re-edit the submission), Vendor
                            reports to view / replace the file and resend.
                        </DialogDescription>
                    </DialogHeader>

                    {skipList}

                    <DialogFooter className="gap-2 sm:gap-2">
                        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            className="bg-red-600 hover:bg-red-700 gap-1"
                            onClick={run}
                            disabled={busy || toWrite.length === 0}
                        >
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                            Reject {toWrite.length}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    }

    // ── APPROVE ──────────────────────────────────────────────────────────
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <Check className="h-4 w-4 text-green-600" />
                        Approve {toWrite.length} report{toWrite.length !== 1 ? 's' : ''}?
                    </DialogTitle>
                    <DialogDescription className="text-sm">
                        Approving does two different things depending on the report type.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-2">
                    {split.field.length > 0 && (
                        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                            <span className="font-semibold">{split.field.length} Field</span>
                            {' '}report{split.field.length !== 1 ? 's' : ''} → <strong>Submitted</strong>.
                            The team then downloads, gets the client signature and uploads the signed copy.
                        </div>
                    )}

                    {split.vendor.length > 0 && (
                        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>
                                <span className="font-semibold">{split.vendor.length} Vendor</span>
                                {' '}report{split.vendor.length !== 1 ? 's' : ''} → <strong>Client Accepted</strong>.
                                This is <strong>final</strong> — the report is complete and cannot be sent
                                back from the row menu.
                            </span>
                        </div>
                    )}

                    {skipList}
                </div>

                <DialogFooter className="gap-2 sm:gap-2">
                    <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 gap-1"
                        onClick={run}
                        disabled={busy || toWrite.length === 0}
                    >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Approve {toWrite.length}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
