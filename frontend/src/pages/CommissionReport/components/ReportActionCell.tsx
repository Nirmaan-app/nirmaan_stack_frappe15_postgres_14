// Unified "Action" cell for the commission tracker table.
// ONE primary next-step button per row + a "⋮ More" dropdown for everything else.
// Replaces the old Signed Report / Settings / Report columns.
//
// Status → primary:
//   Pending  (Field, empty)  -> Fill Report
//   Pending  (Field, draft)  -> Submit for Approval   (More: Edit)
//   Pending  (Vendor)        -> Upload Report
//   Pending Approval         -> View Submission        (+ "awaiting approval")
//   Approved                 -> Download Report + Upload Signed (helper text)
//   Completed                -> View Signed Report      (More: Replace)
//   Not Applicable           -> (muted) + Re-activate in More

import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFrappeFileUpload } from 'frappe-react-sdk';
import {
    Eye, FileText, FileEdit, Send, Upload, Download, Loader2, MoreVertical,
    Settings, Ban, RotateCcw, Replace as ReplaceIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import SITEURL from '@/constants/siteURL';
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

import type { CommissionReportTask } from '../types';
import { todayDate } from '../utils';
import { useUserData } from '@/hooks/useUserData';
import { useUpdateCommissionTaskChild } from '../data/useCommissionMutations';
import { type MasterTaskInfo, masterMapKey } from './FillReportButton';
import { ReportPreviewDialog } from './ReportPreviewDialog';

const PREVIEW_PRINT_FORMAT_PORTRAIT = 'Project Commission Report - Filled Task';
const PREVIEW_PRINT_FORMAT_LANDSCAPE = 'LSProject Commission Report - Filled Task';
const PARENT_DOCTYPE = 'Project Commission Report';

const buildPdfUrl = (parentName: string, childRowName: string, isLandscape: boolean): string => {
    const params = new URLSearchParams({
        doctype: PARENT_DOCTYPE,
        name: parentName,
        format: isLandscape ? PREVIEW_PRINT_FORMAT_LANDSCAPE : PREVIEW_PRINT_FORMAT_PORTRAIT,
        task_row: childRowName,
        letterhead: 'No Letterhead',
    });
    return `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;
};

interface Props {
    parentName: string;
    task: CommissionReportTask;
    masterMap: Map<string, MasterTaskInfo>;
    canEdit: boolean;
    refresh?: () => void;
    /** Opens the task settings (Configure) modal. */
    onConfigure?: (task: CommissionReportTask) => void;
}

export const ReportActionCell: React.FC<Props> = ({ parentName, task, masterMap, canEdit, refresh, onConfigure }) => {
    const navigate = useNavigate();
    const { upload } = useFrappeFileUpload();
    const { updateTaskChild } = useUpdateCommissionTaskChild();
    const { role, user_id } = useUserData();
    const isAdmin = role === 'Nirmaan Admin Profile' || user_id === 'Administrator';

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    // Preview can target either the generated print format or the uploaded file.
    const [preview, setPreview] = useState<{ open: boolean; url: string; download: boolean; title: string; direct: boolean }>(
        { open: false, url: '', download: false, title: '', direct: false },
    );
    const openPreview = (url: string, download: boolean, title: string, direct = false) =>
        setPreview({ open: true, url, download, title, direct });

    const status = task.task_status;
    const isVendor = (task.report_type || 'Field') === 'Vendor';
    const hasResponse = !!(task.response_data || '').trim();
    const hasFile = !!task.approval_proof;
    const info = masterMap.get(masterMapKey(task.commission_category, task.task_name));
    const hasTemplate = !!info?.hasTemplate;
    const isLandscape = !!info?.isLandscape;
    const canDownload = status === 'Approved' || status === 'Completed';

    // Generated print-format PDF (from the wizard answers) vs the uploaded file.
    const genUrl = buildPdfUrl(parentName, task.name, isLandscape);
    const uploadedHref = task.approval_proof
        ? (task.approval_proof.startsWith('http') ? task.approval_proof : SITEURL + task.approval_proof)
        : '';

    // ── actions ──────────────────────────────────────────────────────────
    const goWizard = (mode: 'fill' | 'edit' | 'view') =>
        navigate(`/commission-tracker/${parentName}/task/${task.name}/fill?mode=${mode}`);

    const setStatus = async (next: string, extra: Record<string, any> = {}) => {
        setBusy(true);
        try {
            await updateTaskChild(task.name, { task_status: next, ...extra });
            refresh?.();
        } catch {
            toast({ title: 'Update failed', variant: 'destructive' });
        } finally {
            setBusy(false);
        }
    };

    const sendForApproval = () => setStatus('Pending Approval');

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
                task_status: 'Completed',
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

    // ── building blocks ──────────────────────────────────────────────────
    const hiddenInput = (
        <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={onFileChosen} />
    );

    const primaryBtn = (Icon: React.ElementType, label: string, onClick: () => void, color?: string) => (
        <Button
            size="sm"
            className={cn('h-7 px-2.5 gap-1', color ? `text-white border-0 ${color}` : '')}
            variant={color ? 'default' : 'outline'}
            onClick={onClick}
            disabled={busy}
            title={label}
        >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
            <span className="text-[11px] font-medium">{label}</span>
        </Button>
    );

    type Item = { icon: React.ElementType; label: string; onClick: () => void; danger?: boolean };
    const moreItems: Item[] = [];
    if (canEdit && status === 'Pending' && !isVendor && hasResponse) {
        moreItems.push({ icon: FileEdit, label: 'Edit submission', onClick: () => goWizard('edit') });
    }
    if (canEdit && status === 'Approved') {
        moreItems.push({ icon: Upload, label: 'Upload Signed Copy', onClick: triggerUpload });
    }
    if (canEdit && status === 'Completed' && hasFile) {
        moreItems.push({ icon: ReplaceIcon, label: 'Replace Signed Copy', onClick: triggerUpload });
    }
    if (canDownload && hasTemplate) {
        moreItems.push({ icon: Eye, label: 'View generated report', onClick: () => openPreview(genUrl, canDownload, task.task_name) });
    }
    if (canEdit && (status === 'Pending' || status === 'Rejected')) {
        moreItems.push({ icon: Ban, label: 'Mark as Not Applicable', onClick: () => setStatus('Not Applicable', { deadline: '' }), danger: true });
    }
    if (canEdit && status === 'Not Applicable') {
        moreItems.push({ icon: RotateCcw, label: 'Re-activate (Pending)', onClick: () => setStatus('Pending') });
    }
    // Admin-only: reopen a submitted/approved/completed Field report back to Pending.
    if (isAdmin && !isVendor && (status === 'Pending Approval' || status === 'Approved' || status === 'Completed')) {
        moreItems.push({ icon: RotateCcw, label: 'Send back to Pending', onClick: () => setStatus('Pending'), danger: true });
    }
    if (canEdit && onConfigure) {
        moreItems.push({ icon: Settings, label: 'Report Type / Deadline / Comments', onClick: () => onConfigure(task) });
    }

    const moreMenu = moreItems.length > 0 && (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7 border-gray-300 text-slate-600 hover:bg-gray-100 hover:text-slate-900"
                    title="More actions"
                    disabled={busy}
                >
                    <MoreVertical className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
                {moreItems.map((it, i) => (
                    <React.Fragment key={it.label}>
                        {it.label.startsWith('Report Type') && i > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuItem onClick={it.onClick} className={cn('gap-2 text-[10px]', it.danger && 'text-red-600')}>
                            <it.icon className="h-3 w-3" /> {it.label}
                        </DropdownMenuItem>
                    </React.Fragment>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );

    const previewDialog = (
        <ReportPreviewDialog
            open={preview.open}
            onOpenChange={(o) => setPreview((p) => ({ ...p, open: o }))}
            pdfUrl={preview.url}
            directSrc={preview.direct}
            title={preview.title || task.task_name}
            fileName={`${task.task_name || 'report'}.pdf`}
            canDownload={preview.download}
        />
    );

    const shell = (primary: React.ReactNode, helper?: string) => (
        <div className="flex flex-col items-center gap-0.5 w-full">
            <div className="flex items-center w-full gap-1">
                {hiddenInput}
                {/* primary centered; the ⋮ stays pinned to the right end of the cell */}
                <div className="flex-1 flex items-center justify-center gap-1">
                    {primary}
                </div>
                {moreMenu}
            </div>
            {helper && <span className="text-[10px] text-gray-400 text-center leading-tight">{helper}</span>}
            {previewDialog}
        </div>
    );

    // ── primary action by status ─────────────────────────────────────────
    if (status === 'Not Applicable') {
        return shell(<span className="text-[11px] text-gray-400">Not Applicable</span>);
    }

    if (!isVendor && !hasTemplate) {
        return shell(<span className="text-[11px] text-gray-400">No Template</span>);
    }

    if (status === 'Completed') {
        // The uploaded PDF is the final artifact (vendor's report or the client-signed copy).
        const label = isVendor ? 'View Vendor Report' : 'View Signed Report';
        if (uploadedHref) {
            return shell(primaryBtn(Eye, label, () => openPreview(uploadedHref, true, task.task_name, true)));
        }
        return shell(
            hasTemplate
                ? primaryBtn(Eye, 'View report', () => openPreview(genUrl, true, task.task_name))
                : <span className="text-[11px] text-green-600">Completed</span>,
        );
    }

    if (status === 'Approved') {
        if (!canEdit) {
            return shell(
                hasTemplate ? primaryBtn(Eye, 'View report', () => openPreview(genUrl, true, task.task_name)) : <span className="text-[11px] text-teal-600">Awaiting signature</span>,
            );
        }
        return shell(
            <div className="flex flex-col gap-1">
                {hasTemplate && primaryBtn(Download, 'Download Report', () => openPreview(genUrl, true, task.task_name))}
                {primaryBtn(Upload, 'Upload Signed', triggerUpload, 'bg-green-600 hover:bg-green-700')}
            </div>,
            'Download → sign → upload signed copy',
        );
    }

    if (status === 'Rejected') {
        if (!canEdit) {
            return shell(<span className="text-[11px] text-red-600">Rejected</span>);
        }
        if (isVendor) {
            return shell(primaryBtn(Upload, 'Upload Report', triggerUpload, 'bg-blue-600 hover:bg-blue-700'));
        }
        // Resolve = edit the submission; saving it moves the task to Pending, where
        // "Submit for Approval" then appears.
        return shell(
            primaryBtn(FileEdit, 'Resolve', () => goWizard('edit'), 'bg-blue-600 hover:bg-blue-700'),
            'Resolve (edit), then submit for approval',
        );
    }

    if (status === 'Pending Approval') {
        return shell(
            <>
                {hasTemplate
                    ? primaryBtn(Eye, 'View Submission', () => openPreview(genUrl, false, task.task_name))
                    : <span className="text-[11px] text-indigo-500">Awaiting approval</span>}
            </>,
            hasTemplate ? 'Awaiting approval' : undefined,
        );
    }

    // status === 'Pending'
    if (!canEdit) {
        return shell(
            hasTemplate ? primaryBtn(Eye, 'View', () => openPreview(genUrl, false, task.task_name)) : <span className="text-[11px] text-gray-400">--</span>,
        );
    }
    if (isVendor) {
        return shell(primaryBtn(Upload, 'Upload Report', triggerUpload, 'bg-blue-600 hover:bg-blue-700'));
    }
    if (!info?.isActive) {
        return shell(<span className="text-[11px] text-gray-400">Template inactive</span>);
    }
    if (!hasResponse) {
        return shell(primaryBtn(FileText, 'Fill Report', () => goWizard('fill'), 'bg-blue-600 hover:bg-blue-700'));
    }
    return shell(primaryBtn(Send, 'Submit for Approval', sendForApproval, 'bg-indigo-600 hover:bg-indigo-700'));
};
