// frontend/src/pages/CommissionReport/components/ReportEditModal.tsx
//
// Lightweight task editor. Edits only task meta: Report Type, Deadline, Comments
// (Report Name is read-only). Status and the report file are NOT managed here —
// status is driven by the Report-column actions, and the PDF is uploaded/replaced
// directly from the Report column. (Link source is deprecated.)

import React, { useState } from 'react';
import { CommissionReportTask, User } from '../types';
import { REPORT_TYPE_OPTIONS } from '../hooks/useCommissionMasters';
import { toast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ReactSelect from 'react-select';
import { Save, Loader2 } from 'lucide-react';

interface StatusOption {
    label: string;
    value: string;
}

interface TaskEditModalProps {
    task: CommissionReportTask;
    onSave: (updatedTask: { [key: string]: any }) => Promise<void>;
    usersList: User[];
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    statusOptions: StatusOption[];
    existingTaskNames: string[];
    disableTaskNameEdit?: boolean;
    isRestrictedMode?: boolean;
}

export const TaskEditModal: React.FC<TaskEditModalProps> = ({
    task,
    onSave,
    isOpen,
    onOpenChange,
    isRestrictedMode = false,
}) => {

    const [editState, setEditState] = useState<Partial<CommissionReportTask>>({});
    const [isSaving, setIsSaving] = useState(false);

    // Initialize state when dialog opens
    React.useEffect(() => {
        if (isOpen) {
            setEditState({
                task_name: task.task_name,
                deadline: task.deadline,
                comments: task.comments,
                report_type: task.report_type || 'Field',
            });
        }
    }, [isOpen, task.name]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Only task meta — never touch task_status / file_link / approval_proof here.
            await onSave({
                task_name: task.task_name,
                deadline: editState.deadline || '',
                comments: editState.comments || '',
                report_type: editState.report_type || 'Field',
            });
            onOpenChange(false);
        } catch (error) {
            toast({ title: "Save Failed", description: "Could not save task details.", variant: "destructive" });
        } finally {
            setIsSaving(false);
        }
    };

    const reportType = editState.report_type || 'Field';
    // Report Type can only change before the report workflow starts.
    const reportTypeEditable = !isRestrictedMode
        && (task.task_status === 'Pending' || task.task_status === 'Not Applicable');

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl overflow-visible">
                <DialogHeader className="space-y-1">
                    <DialogTitle className="text-base font-semibold">Edit Task</DialogTitle>
                    {/* Task Context Header */}
                    <div className="flex flex-col gap-1.5 pt-1 pb-2 border-b border-gray-200">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            <div className="flex items-center gap-1">
                                <span className="text-[10px] uppercase tracking-wider text-gray-400">Category:</span>
                                <span className="font-medium text-gray-700">{task.commission_category}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-[10px] uppercase tracking-wider text-gray-400">Task:</span>
                            <span className="text-sm font-medium text-gray-900 truncate">
                                {task.task_name}
                            </span>
                        </div>
                    </div>
                </DialogHeader>
                <div className="grid gap-3 py-3 max-h-[70vh] overflow-y-auto pr-1">

                    {/* Task Name (read-only) */}
                    <div className="space-y-1">
                        <Label htmlFor="task_name">Report Name</Label>
                        <Input
                            id="task_name"
                            value={editState.task_name || ''}
                            disabled
                            className="bg-gray-100 text-gray-500 cursor-not-allowed"
                        />
                    </div>

                    {/* Report Type */}
                    <div className="space-y-1">
                        <Label htmlFor="report_type">Report Type</Label>
                        <ReactSelect
                            inputId="report_type"
                            options={REPORT_TYPE_OPTIONS}
                            value={REPORT_TYPE_OPTIONS.find((o) => o.value === reportType) || null}
                            onChange={(option: any) => setEditState(prev => ({ ...prev, report_type: option?.value || 'Field' }))}
                            isDisabled={!reportTypeEditable}
                            classNamePrefix="react-select"
                        />
                        <p className="text-[11px] text-gray-400">
                            {!reportTypeEditable
                                ? 'Report Type can only be changed while the task is Pending or Not Applicable.'
                                : reportType === 'Vendor'
                                    ? 'Vendor uploads a signed PDF directly from the Report column (no wizard).'
                                    : 'Field team fills the report wizard, then it goes through approval + client signature.'}
                        </p>
                    </div>

                    {/* Deadline */}
                    <div className="space-y-1">
                        <Label htmlFor="deadline">Deadline</Label>
                        <Input
                            id="deadline"
                            type="date"
                            value={editState.deadline || ''}
                            onChange={(e) => setEditState(prev => ({ ...prev, deadline: e.target.value }))}
                            disabled={isRestrictedMode}
                        />
                    </div>

                    {/* Comments */}
                    <div className="space-y-1">
                        <Label htmlFor="comments">Comments</Label>
                        <textarea
                            id="comments"
                            rows={3}
                            value={editState.comments || ''}
                            onChange={(e) => setEditState(prev => ({ ...prev, comments: e.target.value }))}
                            className="w-full p-2 border rounded"
                        />
                    </div>
                </div>
                <DialogFooter className="gap-2 sm:gap-0">
                    <DialogClose asChild>
                        <Button variant="outline" size="sm" disabled={isSaving}>Cancel</Button>
                    </DialogClose>
                    <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={isSaving}
                        className="bg-red-600 hover:bg-red-700"
                    >
                        {isSaving ? (
                            <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                        ) : (
                            <Save className="h-3 w-3 mr-1.5" />
                        )}
                        {isSaving ? 'Saving...' : 'Save Changes'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
