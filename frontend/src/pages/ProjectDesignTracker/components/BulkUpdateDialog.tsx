import React, { useMemo, useState } from 'react';
import { DesignTrackerTask, AssignedDesignerDetail } from '../types';
import { parseDesignersFromField } from '../utils';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ReactSelect from 'react-select';
import { getSelectStyles } from '@/config/selectTheme';
import { TailSpin } from 'react-loader-spinner';
import { Check, AlertCircle, AlertTriangle, Edit3 } from 'lucide-react';
import { TASK_STATUS_OPTIONS, SUB_STATUS_MAP, SUB_STATUS_OPTIONS } from '../hooks/useDesignMasters';

interface DesignerOption {
    value: string; // userId
    label: string; // fullName
    email: string;
}

interface StatusOption {
    label: string;
    value: string;
}

interface BulkUpdateDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    selectedTasks: DesignTrackerTask[];
    usersList: { name: string; full_name: string; email?: string }[];
    isAdmin: boolean;
    onBulkUpdate: (updates: {
        taskNames: string[];
        assignUpdates?: Map<string, AssignedDesignerDetail[]>;
        deadline?: string;
        status?: {
            taskStatus: string;
            taskSubStatus?: string;
        };
    }) => Promise<void>;
}

export const BulkUpdateDialog: React.FC<BulkUpdateDialogProps> = ({
    isOpen,
    onOpenChange,
    selectedTasks,
    usersList,
    isAdmin,
    onBulkUpdate,
}) => {
    const [isSaving, setIsSaving] = useState(false);

    // --- Assign State ---
    const [selectedNewDesigners, setSelectedNewDesigners] = useState<DesignerOption[]>([]);

    // --- Status State ---
    const [selectedStatus, setSelectedStatus] = useState<StatusOption | null>(null);
    const [subStatusDropdown, setSubStatusDropdown] = useState<StatusOption | null>(null);
    const [subStatusText, setSubStatusText] = useState('');

    // --- Deadline State ---
    const [deadlineDate, setDeadlineDate] = useState('');

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setSelectedNewDesigners([]);
            setSelectedStatus(null);
            setSubStatusDropdown(null);
            setSubStatusText('');
            setDeadlineDate('');
        }
        onOpenChange(open);
    };

    // --- ASSIGN LOGIC ---
    const designerOptions: DesignerOption[] = useMemo(
        () =>
            usersList.map((u) => ({
                value: u.name,
                label: u.full_name || u.name,
                email: u.email || '',
            })),
        [usersList]
    );

    const taskAnalysis = useMemo(
        () =>
            selectedTasks.map((task) => {
                const existingDesigners = parseDesignersFromField(task.assigned_designers);
                const existingIds = new Set(existingDesigners.map((d) => d.userId));
                return { task, existingDesigners, existingIds };
            }),
        [selectedTasks]
    );

    const previewUpdates = useMemo(() => {
        if (selectedNewDesigners.length === 0) {
            return { tasksToUpdate: [] as typeof taskAnalysis, tasksSkipped: [] as typeof taskAnalysis };
        }
        const tasksToUpdate: typeof taskAnalysis = [];
        const tasksSkipped: typeof taskAnalysis = [];
        for (const item of taskAnalysis) {
            const newDesigners = selectedNewDesigners.filter(
                (d) => !item.existingIds.has(d.value)
            );
            if (newDesigners.length > 0) {
                tasksToUpdate.push(item);
            } else {
                tasksSkipped.push(item);
            }
        }
        return { tasksToUpdate, tasksSkipped };
    }, [taskAnalysis, selectedNewDesigners]);

    const updateCount = previewUpdates.tasksToUpdate.length;
    const skipCount = previewUpdates.tasksSkipped.length;

    // --- STATUS LOGIC ---
    const statusValue = selectedStatus?.value;
    const isClarification = statusValue === 'Clarification Awaiting';
    const isRevision = statusValue === 'Revision Pending';
    const isSubmitted = statusValue === 'Submitted' || statusValue === 'Revision Submitted';
    const isApproved = statusValue === 'Approved';
    const isNotApplicable = statusValue === 'Not Applicable';

    const clarificationSubStatusOptions = useMemo(() => {
        const allowed = SUB_STATUS_MAP['Clarification Awaiting'];
        if (!Array.isArray(allowed)) return [];
        return SUB_STATUS_OPTIONS.filter(opt => allowed.includes(opt.value));
    }, []);

    const isStatusValid = useMemo(() => {
        if (!statusValue) return true; // If no status selected, it's valid to submit other fields
        if (isClarification && !subStatusDropdown) return false;
        if (isRevision && !subStatusText.trim()) return false;
        return true;
    }, [statusValue, isClarification, isRevision, subStatusDropdown, subStatusText]);

    // --- SUBMIT LOGIC ---
    const handleApply = async () => {
        setIsSaving(true);
        try {
            const taskNames = selectedTasks.map(t => t.name);
            const updates: Parameters<typeof onBulkUpdate>[0] = { taskNames };

            // 1. Assign Updates
            if (selectedNewDesigners.length > 0) {
                const assignUpdates = new Map<string, AssignedDesignerDetail[]>();
                for (const item of taskAnalysis) {
                    const toAdd = selectedNewDesigners
                        .filter((d) => !item.existingIds.has(d.value))
                        .map((d) => ({
                            userId: d.value,
                            userName: d.label,
                            userEmail: d.email,
                        }));
                    if (toAdd.length > 0) {
                        assignUpdates.set(item.task.name, [...item.existingDesigners, ...toAdd]);
                    }
                }
                if (assignUpdates.size > 0) {
                    updates.assignUpdates = assignUpdates;
                }
            }

            // 2. Deadline Updates
            if (deadlineDate) {
                updates.deadline = deadlineDate;
            }

            // 3. Status Updates
            if (isAdmin && statusValue && isStatusValid) {
                let subStatus: string | undefined;
                if (isClarification) subStatus = subStatusDropdown?.value;
                else if (isRevision) subStatus = subStatusText.trim();

                updates.status = {
                    taskStatus: statusValue,
                    taskSubStatus: subStatus,
                };
            }

            if (updates.assignUpdates || updates.deadline || updates.status) {
                await onBulkUpdate(updates);
            }
            handleOpenChange(false);
        } catch (error) {
            // Error handling is expected to be managed by the parent via the passed callbacks
        } finally {
            setIsSaving(false);
        }
    };

    const isFormValid = () => {
        const hasAssign = selectedNewDesigners.length > 0 && updateCount > 0;
        const hasDeadline = !!deadlineDate;
        const hasStatus = isAdmin && statusValue && isStatusValid;
        // Must have at least one valid update, and if status is selected it must be valid
        return (hasAssign || hasDeadline || hasStatus) && isStatusValid;
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-lg overflow-visible max-h-[90vh] flex flex-col p-0">
                <DialogHeader className="p-6 pb-4 border-b shrink-0">
                    <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                        <Edit3 className="h-4 w-4" />
                        Bulk Update
                        <Badge
                            variant="secondary"
                            className="ml-1 px-1.5 py-0 text-[10px] font-medium"
                        >
                            {selectedTasks.length} task{selectedTasks.length !== 1 ? 's' : ''}
                        </Badge>
                    </DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-6 space-y-8 min-h-0">
                    
                    {/* Selected Tasks Overview */}
                    <div className="space-y-3">
                        <p className="text-sm font-semibold text-gray-900 border-b pb-1">
                            Selected Tasks Overview
                        </p>
                        <div className="max-h-32 overflow-y-auto rounded border border-gray-200 divide-y divide-gray-100 bg-gray-50/50">
                            {taskAnalysis.map(({ task, existingDesigners }) => (
                                <div
                                    key={task.name}
                                    className="flex items-center justify-between gap-2 px-2.5 py-1.5"
                                >
                                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                        <span className="text-xs font-medium text-gray-800 truncate">
                                            {task.task_name}
                                        </span>
                                        {task.task_zone && (
                                            <Badge
                                                variant="outline"
                                                className="px-1 py-0 text-[9px] font-normal text-gray-500 border-gray-300 shrink-0"
                                            >
                                                {task.task_zone}
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-0.5 shrink-0 max-w-[40%] justify-end">
                                        {existingDesigners.length > 0 ? (
                                            existingDesigners.map((d, idx) => (
                                                <Badge
                                                    key={idx}
                                                    variant="secondary"
                                                    className="px-1 py-0 text-[9px] font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-full whitespace-nowrap"
                                                >
                                                    {d.userName || d.userId}
                                                </Badge>
                                            ))
                                        ) : (
                                            <span className="text-gray-400 text-[10px]">--</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Status Section (1st) */}
                    {isAdmin && (
                        <div className="space-y-3">
                            <p className="text-sm font-semibold text-gray-900 border-b pb-1">
                                Update Status
                            </p>
                            <div className="space-y-1">
                                <Label htmlFor="bulk_status" className="text-xs text-gray-600">Status</Label>
                                <ReactSelect
                                    inputId="bulk_status"
                                    options={TASK_STATUS_OPTIONS}
                                    value={selectedStatus}
                                    onChange={(opt) => {
                                        setSelectedStatus(opt as StatusOption | null);
                                        setSubStatusDropdown(null);
                                        setSubStatusText('');
                                    }}
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
                            {isClarification && (
                                <div className="space-y-1 mt-2">
                                    <Label htmlFor="bulk_sub_status" className="text-xs text-gray-600">Sub Status <span className="text-red-500">*</span></Label>
                                    <ReactSelect
                                        inputId="bulk_sub_status"
                                        options={clarificationSubStatusOptions}
                                        value={subStatusDropdown}
                                        onChange={(opt) => setSubStatusDropdown(opt as StatusOption | null)}
                                        placeholder="Select sub-status..."
                                        classNamePrefix="react-select"
                                        styles={getSelectStyles()}
                                        menuPortalTarget={document.body}
                                        menuPosition="fixed"
                                        closeMenuOnScroll={true}
                                        isDisabled={isSaving}
                                    />
                                </div>
                            )}
                            {isRevision && (
                                <div className="space-y-1 mt-2">
                                    <Label htmlFor="bulk_sub_status_text" className="text-xs text-gray-600">Sub Status (Custom) <span className="text-red-500">*</span></Label>
                                    <Input
                                        id="bulk_sub_status_text"
                                        type="text"
                                        value={subStatusText}
                                        onChange={(e) => setSubStatusText(e.target.value)}
                                        placeholder="Enter custom sub-status..."
                                        disabled={isSaving}
                                    />
                                </div>
                            )}
                            {(isSubmitted || isApproved) && (
                                <div className="flex items-start gap-2 p-2.5 rounded-md bg-red-50 border border-red-200 mt-2">
                                    <AlertTriangle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                                    <div className="text-xs text-red-700 leading-snug">
                                        <p className="font-semibold mb-0.5">Evidence check will be skipped</p>
                                        <p>
                                            {isSubmitted
                                                ? 'Design file link will NOT be required.'
                                                : 'Approval proof will NOT be required.'}
                                        </p>
                                    </div>
                                </div>
                            )}
                            {isNotApplicable && (
                                <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-50 border border-amber-200 mt-2">
                                    <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                                    <p className="text-xs text-amber-700 leading-snug">
                                        Deadlines will be cleared for these tasks.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Assign Section (2nd) */}
                    <div className="space-y-3">
                        <p className="text-sm font-semibold text-gray-900 border-b pb-1">
                            Assign Designers
                        </p>
                        <ReactSelect<DesignerOption, true>
                            isMulti
                            value={selectedNewDesigners}
                            options={designerOptions}
                            onChange={(newValue) =>
                                setSelectedNewDesigners(newValue as DesignerOption[])
                            }
                            placeholder="Select designers to assign..."
                            classNamePrefix="react-select"
                            styles={getSelectStyles<DesignerOption, true>()}
                            menuPortalTarget={document.body}
                            menuPosition="fixed"
                            closeMenuOnScroll={true}
                            isDisabled={isSaving}
                        />
                        {selectedNewDesigners.length > 0 && (
                            <p className="text-[11px] text-gray-500 flex items-center gap-1 mt-1.5">
                                <Check className="h-3 w-3 text-green-600" />
                                Will update <span className="font-medium text-gray-700">{updateCount}</span> of <span className="font-medium text-gray-700">{selectedTasks.length}</span> tasks
                                {skipCount > 0 && (
                                    <span className="text-amber-600 ml-1">
                                        ({skipCount} already have all selected)
                                    </span>
                                )}
                            </p>
                        )}
                    </div>

                    {/* Deadline Section (3rd) */}
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
                            <div className="flex items-start gap-2 p-2.5 rounded-md bg-blue-50 border border-blue-200 mt-2">
                                <AlertCircle className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-blue-700 leading-snug">
                                    This will override the existing deadline for all <span className="font-semibold">{selectedTasks.length}</span> selected task(s).
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
                        disabled={!isFormValid() || isSaving}
                        className="bg-blue-600 hover:bg-blue-700"
                    >
                        {isSaving ? (
                            <TailSpin width={14} height={14} color="white" />
                        ) : (
                            <>Apply Updates to {selectedTasks.length} Task{selectedTasks.length === 1 ? '' : 's'}</>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
