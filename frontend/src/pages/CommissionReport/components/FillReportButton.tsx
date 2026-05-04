// Action button shown in the tracker DataTable's "Report" column.
// Decides Fill / View / Edit based on whether the row already has response_data.
// Hidden entirely when the matching master has no source_format.

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, FileEdit, FileText, Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { CommissionReportTask } from '../types';

const PREVIEW_PRINT_FORMAT = 'Project Commission Report - Filled Task';
const PARENT_DOCTYPE = 'Project Commission Report';

const buildPreviewUrl = (parentName: string, childRowName: string): string => {
    const params = new URLSearchParams({
        doctype: PARENT_DOCTYPE,
        name: parentName,
        format: PREVIEW_PRINT_FORMAT,
        task_row: childRowName,
        letterhead: 'No Letterhead',
    });
    return `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;
};

export interface MasterTaskInfo {
    masterName: string;
    hasTemplate: boolean;
    isActive: boolean;
}

interface Props {
    parentName: string;
    task: CommissionReportTask;
    /** Lookup keyed by `${commission_category}::${task_name}`. */
    masterMap: Map<string, MasterTaskInfo>;
    canEdit: boolean;
}

/** Map key helper — exported so callers stay consistent. */
export const masterMapKey = (categoryName: string, taskName: string): string =>
    `${categoryName}::${taskName}`;

export const FillReportButton: React.FC<Props> = ({ parentName, task, masterMap, canEdit }) => {
    const navigate = useNavigate();
    const info = masterMap.get(masterMapKey(task.commission_category, task.task_name));

    // Hide the button entirely when no template exists. Soft-deleted templates
    // still show the button for already-filled rows (View mode); hide it for
    // unfilled rows (no point starting a fill against an inactive template).
    const isFilled = !!(task.response_data || '').trim();
    if (!info || !info.hasTemplate) return null;
    if (!info.isActive && !isFilled) return null;

    const mode: 'view' | 'edit' | 'fill' = isFilled ? (canEdit ? 'edit' : 'view') : (canEdit ? 'fill' : 'view');
    const Icon = mode === 'fill' ? FileText : mode === 'edit' ? FileEdit : Eye;
    const label = mode === 'fill' ? 'Fill' : mode === 'edit' ? 'Edit' : 'View';

    return (
        <div className="flex items-center gap-1">
            <Button
                variant="outline"
                size="sm"
                className={cn('h-6 px-1.5 gap-1', mode === 'view' && 'text-muted-foreground')}
                onClick={() =>
                    navigate(
                        `/commission-tracker/${parentName}/task/${task.name}/fill?mode=${mode}`,
                    )
                }
                title={`${label} report${!info.isActive ? ' (template inactive)' : ''}`}
            >
                <Icon className="h-3 w-3" />
                <span className="text-xs">{label}</span>
            </Button>
            {isFilled && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-slate-500 hover:bg-blue-50 hover:text-blue-600"
                    onClick={() =>
                        window.open(buildPreviewUrl(parentName, task.name), '_blank', 'noopener')
                    }
                    title="Preview PDF"
                >
                    <Printer className="h-3 w-3" />
                </Button>
            )}
        </div>
    );
};
