// Guided Approve / Reject dialog for the commission approval queue.
//
// Approve:  confirm → status Approved → (download report → get signature → upload
//           signed copy) → uploading auto-completes the task.
// Reject:   confirm → status back to Pending (team can edit & resubmit).

import React, { useEffect, useRef, useState } from 'react';
import { useFrappeFileUpload } from 'frappe-react-sdk';
import { Check, X, Download, Upload, Loader2, AlertTriangle } from 'lucide-react';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';

import { todayDate } from '../utils';
import { useUpdateCommissionTaskChild } from '../data/useCommissionMutations';

const PARENT_DOCTYPE = 'Project Commission Report';
const PREVIEW_PORTRAIT = 'Project Commission Report - Filled Task';
const PREVIEW_LANDSCAPE = 'LSProject Commission Report - Filled Task';

const buildPdfUrl = (parentName: string, childRowName: string, isLandscape: boolean): string => {
    const params = new URLSearchParams({
        doctype: PARENT_DOCTYPE,
        name: parentName,
        format: isLandscape ? PREVIEW_LANDSCAPE : PREVIEW_PORTRAIT,
        task_row: childRowName,
        letterhead: 'No Letterhead',
    });
    return `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;
};

export interface ApprovalTaskRef {
    name: string;          // child row name
    prjname: string;       // parent tracker name
    task_name: string;
    hasTemplate?: boolean; // whether a generated report exists to download
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
    const { upload } = useFrappeFileUpload();
    const [step, setStep] = useState<'confirm' | 'sign'>('confirm');
    const [busy, setBusy] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) { setStep('confirm'); setBusy(false); }
    }, [open, mode, task?.name]);

    if (!task || !mode) return null;

    const close = () => onOpenChange(false);

    const doApprove = async () => {
        setBusy(true);
        try {
            await updateTaskChild(task.name, { task_status: 'Approved' });
            toast({ title: 'Approved', variant: 'success' });
            refresh?.();
            // Move into the download → sign → upload step.
            setStep('sign');
        } catch {
            toast({ title: 'Approval failed', variant: 'destructive' });
        } finally {
            setBusy(false);
        }
    };

    const doReject = async () => {
        setBusy(true);
        try {
            await updateTaskChild(task.name, { task_status: 'Pending' });
            toast({ title: 'Rejected — sent back to Pending', variant: 'success' });
            refresh?.();
            close();
        } catch {
            toast({ title: 'Reject failed', variant: 'destructive' });
        } finally {
            setBusy(false);
        }
    };

    const downloadReport = () =>
        window.open(buildPdfUrl(task.prjname, task.name, !!task.isLandscape), '_blank', 'noopener');

    const onSignedChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setBusy(true);
        try {
            const uploaded = await upload(file, {
                doctype: 'Commission Report Task Child Table',
                docname: task.name,
                fieldname: 'approval_proof',
                isPrivate: true,
            });
            await updateTaskChild(task.name, {
                approval_proof: uploaded.file_url,
                task_status: 'Completed',
                last_submitted: todayDate(),
            });
            toast({ title: 'Signed copy uploaded — report completed', variant: 'success' });
            refresh?.();
            close();
        } catch {
            toast({ title: 'Upload failed', variant: 'destructive' });
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
                            <span className="font-medium text-gray-700">{task.task_name}</span> will be sent
                            back to <strong>Pending</strong> so the team can edit/refill it and submit for
                            approval again.
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
                <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={onSignedChosen} />
                {step === 'confirm' ? (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2 text-base">
                                <Check className="h-4 w-4 text-green-600" /> Approve report?
                            </DialogTitle>
                            <DialogDescription className="text-sm">
                                Approve <span className="font-medium text-gray-700">{task.task_name}</span>?
                                After approval you can download the report, get the client signature, and
                                upload the signed copy to complete it.
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
                                Approve
                            </Button>
                        </DialogFooter>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle className="text-base">Get signature &amp; complete</DialogTitle>
                            <DialogDescription className="text-sm">
                                <strong>1.</strong> Download the approved report &nbsp;
                                <strong>2.</strong> Get the client signature &nbsp;
                                <strong>3.</strong> Upload the signed copy — that marks it <strong>Completed</strong>.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="flex flex-col gap-2 py-2">
                            {task.hasTemplate && (
                                <Button variant="outline" size="sm" className="gap-1 justify-center" onClick={downloadReport} disabled={busy}>
                                    <Download className="h-3.5 w-3.5" /> Download Report
                                </Button>
                            )}
                            <Button
                                size="sm"
                                className="bg-green-600 hover:bg-green-700 gap-1 justify-center"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={busy}
                            >
                                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                                Upload Signed Copy
                            </Button>
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" size="sm" onClick={close} disabled={busy}>I'll do this later</Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
};
