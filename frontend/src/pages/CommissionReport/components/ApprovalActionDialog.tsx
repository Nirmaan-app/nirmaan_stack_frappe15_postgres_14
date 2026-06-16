// Approve / Reject confirmation dialog for the commission approval queue.
//   Approve: confirm → status Submitted (team handles download → sign → upload later).
//   Reject:  confirm → status Rejected (team Resolves + resubmits).

import React, { useEffect, useState } from 'react';
import { Check, X, Loader2, AlertTriangle } from 'lucide-react';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';

import { useUpdateCommissionTaskChild } from '../data/useCommissionMutations';

export interface ApprovalTaskRef {
    name: string;          // child row name
    prjname: string;       // parent tracker name
    task_name: string;
    hasTemplate?: boolean;
    isLandscape?: boolean;
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mode: 'approve' | 'reject' | null;
    task: ApprovalTaskRef | null;
    refresh?: () => void;
}

export const ApprovalActionDialog: React.FC<Props> = ({ open, onOpenChange, mode, task, refresh }) => {
    const { updateTaskChild } = useUpdateCommissionTaskChild();
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (open) setBusy(false);
    }, [open, mode, task?.name]);

    if (!task || !mode) return null;

    const close = () => onOpenChange(false);

    const doApprove = async () => {
        setBusy(true);
        try {
            await updateTaskChild(task.name, { task_status: 'Submitted' });
            toast({ title: 'Submitted', variant: 'success' });
            refresh?.();
            close();
        } catch {
            toast({ title: 'Submit failed', variant: 'destructive' });
        } finally {
            setBusy(false);
        }
    };

    const doReject = async () => {
        setBusy(true);
        try {
            await updateTaskChild(task.name, { task_status: 'Rejected' });
            toast({ title: 'Rejected — sent back to the team to resolve', variant: 'success' });
            refresh?.();
            close();
        } catch {
            toast({ title: 'Reject failed', variant: 'destructive' });
        } finally {
            setBusy(false);
        }
    };

    // ── REJECT ───────────────────────────────────────────────────────────
    if (mode === 'reject') {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base">
                            <AlertTriangle className="h-4 w-4 text-red-600" /> Reject report?
                        </DialogTitle>
                        <DialogDescription className="text-sm">
                            <span className="font-medium text-gray-700">{task.task_name}</span> will be marked
                            <strong> Rejected</strong>. The team can <strong>Resolve</strong> it (edit the
                            submission) and submit for approval again.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-2">
                        <Button variant="outline" size="sm" onClick={close} disabled={busy}>Cancel</Button>
                        <Button
                            size="sm"
                            className="bg-red-600 hover:bg-red-700 gap-1"
                            onClick={doReject}
                            disabled={busy}
                        >
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                            Reject
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
                        <Check className="h-4 w-4 text-green-600" /> Submit report?
                    </DialogTitle>
                    <DialogDescription className="text-sm">
                        Submit <span className="font-medium text-gray-700">{task.task_name}</span>? The team can
                        then download the report, get the client signature, and upload the signed copy to mark it Client Accepted.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2 sm:gap-2">
                    <Button variant="outline" size="sm" onClick={close} disabled={busy}>Cancel</Button>
                    <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 gap-1"
                        onClick={doApprove}
                        disabled={busy}
                    >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Submit
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
