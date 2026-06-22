// Action cell shown in the tracker DataTable's "Report" column.
//
// ONE clear next-step per row. The status badge says where the task is; this
// column shows the single primary action to move it forward (plus tiny icons
// for rare/secondary actions like view/print/replace).
//
//   Field : Pending --[Fill]--> (filled) --[Send]--> Pending Approval
//           --(admin Approve)--> Submitted --[Upload Signed]--> Client Accepted
//   Vendor: Pending --[Upload]--> Client Accepted
// Read-only roles only ever see a small View icon.

import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFrappeFileUpload } from 'frappe-react-sdk';
import { Eye, FileEdit, FileText, Upload, Send, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';

import type { CommissionReportTask } from '../types';
import { todayDate } from '../utils';
import { useUpdateCommissionTaskChild } from '../data/useCommissionMutations';
import { ReportPreviewDialog } from './ReportPreviewDialog';

const PREVIEW_PRINT_FORMAT_PORTRAIT = 'Project Commission Report - Filled Task';
const PREVIEW_PRINT_FORMAT_LANDSCAPE = 'LSProject Commission Report - Filled Task';
const PARENT_DOCTYPE = 'Project Commission Report';

const buildPreviewUrl = (
    parentName: string,
    childRowName: string,
    isLandscape: boolean,
): string => {
    const params = new URLSearchParams({
        doctype: PARENT_DOCTYPE,
        name: parentName,
        format: isLandscape ? PREVIEW_PRINT_FORMAT_LANDSCAPE : PREVIEW_PRINT_FORMAT_PORTRAIT,
        task_row: childRowName,
        letterhead: 'No Letterhead',
    });
    return `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;
};

export interface MasterTaskInfo {
    masterName: string;
    hasTemplate: boolean;
    isActive: boolean;
    /** True when the template's source_format declares `printOrientation: "landscape"`. */
    isLandscape: boolean;
    /** Master deadline offset in days (from the tracker's start_date). Used to
     *  recompute a deadline when a "Not Applicable" task is re-activated. */
    deadlineOffset: number | null;
}

interface Props {
    parentName: string;
    task: CommissionReportTask;
    /** Lookup keyed by `${commission_category}::${task_name}`. */
    masterMap: Map<string, MasterTaskInfo>;
    canEdit: boolean;
    /** Refresh the parent tracker doc after a status/file mutation. */
    refresh?: () => void;
}

/** Map key helper — exported so callers stay consistent. */
export const masterMapKey = (categoryName: string, taskName: string): string =>
    `${categoryName}::${taskName}`;

export const FillReportButton: React.FC<Props> = ({ parentName, task, masterMap, canEdit, refresh }) => {
    const navigate = useNavigate();
    const info = masterMap.get(masterMapKey(task.commission_category, task.task_name));
    const { upload } = useFrappeFileUpload();
    const { updateTaskChild } = useUpdateCommissionTaskChild();

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);

    const status = task.task_status;
    const isVendor = (task.report_type || 'Field') === 'Vendor';
    const hasResponse = !!(task.response_data || '').trim();
    const hasFile = !!task.approval_proof;
    const hasTemplate = !!info?.hasTemplate;
    const isLandscape = !!info?.isLandscape;

    // --- actions -------------------------------------------------------------
    const goWizard = (mode: 'fill' | 'edit' | 'view') =>
        navigate(`/commission-tracker/${parentName}/task/${task.name}/fill?mode=${mode}`);

    // Download is only permitted once the report is approved/completed.
    const canDownloadPreview = status === 'Submitted' || status === 'Client Accepted';

    const sendForApproval = async () => {
        setBusy(true);
        try {
            await updateTaskChild(task.name, { task_status: 'Pending Approval' });
            toast({ title: 'Sent for approval', variant: 'success' });
            refresh?.();
        } catch {
            toast({ title: 'Failed to send for approval', variant: 'destructive' });
        } finally {
            setBusy(false);
        }
    };

    // Vendor upload AND Field signed-PDF upload both land the file in approval_proof
    // and complete the task.
    const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
                task_status: 'Client Accepted',
                last_submitted: todayDate(),
            });
            toast({ title: 'Report completed', variant: 'success' });
            refresh?.();
        } catch {
            toast({ title: 'Upload failed', variant: 'destructive' });
        } finally {
            setBusy(false);
        }
    };

    const triggerUpload = () => fileInputRef.current?.click();

    // --- building blocks -----------------------------------------------------
    const hiddenInput = (
        <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={onFileChosen} />
    );

    // Tiny secondary action (view / print / download / replace).
    const iconBtn = (key: string, Icon: React.ElementType, title: string, onClick: () => void, extra?: string) => (
        <Button
            key={key}
            variant="ghost"
            size="icon"
            className={cn('h-6 w-6 text-slate-400 hover:bg-blue-50 hover:text-blue-600', extra)}
            onClick={onClick}
            disabled={busy}
            title={title}
        >
            <Icon className="h-3.5 w-3.5" />
        </Button>
    );

    // The single prominent next-step button.
    const primaryBtn = (Icon: React.ElementType, label: string, onClick: () => void, color: string, title?: string) => (
        <Button
            size="sm"
            className={cn('h-6 px-2.5 gap-1 text-white border-0', color)}
            onClick={onClick}
            disabled={busy}
            title={title || label}
        >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
            <span className="text-xs font-medium">{label}</span>
        </Button>
    );

    const wrap = (children: React.ReactNode) => (
        <div className="flex items-center justify-center gap-1 w-full">
            {hiddenInput}
            {children}
            {hasTemplate && (
                <ReportPreviewDialog
                    open={previewOpen}
                    onOpenChange={setPreviewOpen}
                    pdfUrl={buildPreviewUrl(parentName, task.name, isLandscape)}
                    title={task.task_name}
                    fileName={`${task.task_name || 'report'}.pdf`}
                    canDownload={canDownloadPreview}
                />
            )}
        </div>
    );

    const note = (text: string, color = 'text-gray-400') =>
        wrap(<span className={cn('text-[10px] whitespace-nowrap', color)}>{text}</span>);

    // --- state machine -------------------------------------------------------
    if (status === 'Not Applicable') return null;

    // Field task with no report template — nothing to fill/generate.
    if (!isVendor && !hasTemplate) return note('No Template');

    // CLIENT ACCEPTED → View report (preview; download available inside the dialog) + Replace.
    if (status === 'Client Accepted') {
        const out: React.ReactNode[] = [];
        if (hasTemplate && hasResponse) {
            out.push(
                <Button
                    key="view"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 gap-1"
                    onClick={() => setPreviewOpen(true)}
                    disabled={busy}
                    title="View / download the report"
                >
                    <Eye className="h-3 w-3" />
                    <span className="text-xs">View report</span>
                </Button>,
            );
        }
        if (canEdit && hasFile) {
            out.push(
                <Button
                    key="replace"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 gap-1 text-amber-700 hover:bg-amber-50"
                    onClick={triggerUpload}
                    disabled={busy}
                    title="Replace the uploaded PDF with a new file"
                >
                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                    <span className="text-xs">Replace</span>
                </Button>,
            );
        }
        return out.length ? wrap(out) : note('Done', 'text-green-600');
    }

    // PENDING APPROVAL → waiting on an approver; just a status note (+ view for Field).
    if (status === 'Pending Approval') {
        return wrap(
            <>
                {hasTemplate && iconBtn('view', Eye, 'View report', () => setPreviewOpen(true))}
                <span className="text-[10px] text-indigo-500 whitespace-nowrap">Awaiting approval</span>
            </>,
        );
    }

    // SUBMITTED → primary action is uploading the client-signed PDF.
    if (status === 'Submitted') {
        if (!canEdit) return note('Awaiting signature', 'text-teal-600');
        return wrap(
            <>
                {hasTemplate && (
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 gap-1"
                        onClick={() => setPreviewOpen(true)}
                        disabled={busy}
                        title="View / download the report to get the client signature"
                    >
                        <Eye className="h-3 w-3" />
                        <span className="text-xs">View report</span>
                    </Button>
                )}
                {primaryBtn(Upload, 'Upload Signed', triggerUpload, 'bg-green-600 hover:bg-green-700')}
            </>,
        );
    }

    // PENDING (default) -------------------------------------------------------
    if (!canEdit) {
        return hasTemplate ? wrap(iconBtn('view', Eye, 'View report', () => setPreviewOpen(true))) : null;
    }

    if (isVendor) {
        // One step: upload the PDF → task completes.
        return wrap(primaryBtn(Upload, 'Upload', triggerUpload, 'bg-blue-600 hover:bg-blue-700', 'Upload PDF'));
    }

    // Field + canEdit + Pending
    if (!info?.isActive && !hasResponse) return note('Template inactive');

    if (!hasResponse) {
        return wrap(primaryBtn(FileText, 'Fill', () => goWizard('fill'), 'bg-blue-600 hover:bg-blue-700', 'Fill Report'));
    }

    // Filled, not yet sent → user can still Edit the fill, then Send for approval.
    return wrap(
        <>
            <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 gap-1"
                onClick={() => goWizard('edit')}
                disabled={busy}
                title="Edit the filled report"
            >
                <FileEdit className="h-3 w-3" />
                <span className="text-xs">Edit</span>
            </Button>
            {primaryBtn(Send, 'Send', sendForApproval, 'bg-indigo-600 hover:bg-indigo-700', 'Send for Approval')}
        </>,
    );
};
