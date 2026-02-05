// frontend/src/pages/ProjectDesignTracker/components/BulkAssignDialog.tsx

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
import ReactSelect from 'react-select';
import { getSelectStyles } from '@/config/selectTheme';
import { TailSpin } from 'react-loader-spinner';
import { Users, Check, AlertCircle } from 'lucide-react';

// --- TYPE DEFINITIONS ---

interface DesignerOption {
    value: string; // userId
    label: string; // fullName
    email: string;
}

interface BulkAssignDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    selectedTasks: DesignTrackerTask[];
    usersList: { name: string; full_name: string; email?: string }[];
    onBulkAssign: (taskUpdates: Map<string, AssignedDesignerDetail[]>) => Promise<void>;
}

// --- COMPONENT ---

export const BulkAssignDialog: React.FC<BulkAssignDialogProps> = ({
    isOpen,
    onOpenChange,
    selectedTasks,
    usersList,
    onBulkAssign,
}) => {
    const [selectedNewDesigners, setSelectedNewDesigners] = useState<DesignerOption[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    // Reset state when dialog closes
    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setSelectedNewDesigners([]);
        }
        onOpenChange(open);
    };

    // Map usersList to react-select option format
    const designerOptions: DesignerOption[] = useMemo(
        () =>
            usersList.map((u) => ({
                value: u.name,
                label: u.full_name || u.name,
                email: u.email || '',
            })),
        [usersList]
    );

    // Parse existing designers for each selected task
    const taskAnalysis = useMemo(
        () =>
            selectedTasks.map((task) => {
                const existingDesigners = parseDesignersFromField(task.assigned_designers);
                const existingIds = new Set(existingDesigners.map((d) => d.userId));
                return { task, existingDesigners, existingIds };
            }),
        [selectedTasks]
    );

    // Compute preview: which tasks get new designers, which are skipped
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

    // Save handler
    const handleAssign = async () => {
        setIsSaving(true);
        try {
            const updates = new Map<string, AssignedDesignerDetail[]>();
            for (const item of taskAnalysis) {
                const toAdd = selectedNewDesigners
                    .filter((d) => !item.existingIds.has(d.value))
                    .map((d) => ({
                        userId: d.value,
                        userName: d.label,
                        userEmail: d.email,
                    }));
                if (toAdd.length > 0) {
                    updates.set(item.task.name, [...item.existingDesigners, ...toAdd]);
                }
            }
            if (updates.size > 0) {
                await onBulkAssign(updates);
            }
            handleOpenChange(false);
        } catch (error) {
            // Error handling done by parent
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-lg overflow-visible">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                        <Users className="h-4 w-4" />
                        Bulk Assign Designers
                        <Badge
                            variant="secondary"
                            className="ml-1 px-1.5 py-0 text-[10px] font-medium"
                        >
                            {selectedTasks.length} task{selectedTasks.length !== 1 ? 's' : ''}
                        </Badge>
                    </DialogTitle>
                </DialogHeader>

                <div className="grid gap-4 py-2">
                    {/* Section 1: Selected Tasks */}
                    <div className="space-y-1.5">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Selected Tasks
                        </p>
                        <div className="max-h-48 overflow-y-auto rounded border border-gray-200 divide-y divide-gray-100">
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
                                        <span className="text-[10px] text-gray-400 shrink-0">
                                            {task.design_category}
                                        </span>
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

                    {/* Section 2: Add Designers */}
                    <div className="space-y-1.5">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Add Designers
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
                            isDisabled={isSaving}
                        />
                    </div>

                    {/* Section 3: Preview (only when designers are selected) */}
                    {selectedNewDesigners.length > 0 && (
                        <div className="space-y-1.5">
                            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Preview
                            </p>
                            <div className="max-h-40 overflow-y-auto rounded border border-gray-200 divide-y divide-gray-100">
                                {taskAnalysis.map(({ task, existingIds }) => {
                                    const newOnes = selectedNewDesigners.filter(
                                        (d) => !existingIds.has(d.value)
                                    );
                                    const allAlreadyAssigned = newOnes.length === 0;

                                    return (
                                        <div
                                            key={task.name}
                                            className="flex items-center justify-between gap-2 px-2.5 py-1.5"
                                        >
                                            <span className="text-xs text-gray-700 truncate min-w-0 flex-1">
                                                {task.task_name}
                                            </span>
                                            <div className="flex items-center gap-1 shrink-0">
                                                {allAlreadyAssigned ? (
                                                    <span className="flex items-center gap-1 text-[10px] text-amber-600">
                                                        <AlertCircle className="h-3 w-3" />
                                                        already assigned
                                                    </span>
                                                ) : (
                                                    newOnes.map((d, idx) => (
                                                        <Badge
                                                            key={idx}
                                                            variant="secondary"
                                                            className="px-1 py-0 text-[9px] font-medium bg-green-50 text-green-700 border border-green-200 rounded-full whitespace-nowrap"
                                                        >
                                                            + {d.label}
                                                        </Badge>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <p className="text-[11px] text-gray-500 flex items-center gap-1">
                                <Check className="h-3 w-3 text-green-600" />
                                Will update{' '}
                                <span className="font-medium text-gray-700">{updateCount}</span> of{' '}
                                <span className="font-medium text-gray-700">
                                    {selectedTasks.length}
                                </span>{' '}
                                tasks
                                {skipCount > 0 && (
                                    <span className="text-amber-600 ml-1">
                                        ({skipCount} already have all selected designers)
                                    </span>
                                )}
                            </p>
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <DialogClose asChild>
                        <Button variant="outline" size="sm" disabled={isSaving}>
                            Cancel
                        </Button>
                    </DialogClose>
                    <Button
                        size="sm"
                        onClick={handleAssign}
                        disabled={
                            selectedNewDesigners.length === 0 || updateCount === 0 || isSaving
                        }
                        className="bg-red-600 hover:bg-red-700"
                    >
                        {isSaving ? (
                            <TailSpin height={14} width={14} color="#fff" />
                        ) : (
                            <>
                                <Users className="h-3 w-3 mr-1.5" />
                                Assign to {updateCount} task{updateCount !== 1 ? 's' : ''}
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
