import React, { useMemo, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ReactSelect from "react-select";
import { getSelectStyles } from "@/config/selectTheme";
import { TailSpin } from "react-loader-spinner";
import { Users, Check, AlertCircle } from "lucide-react";
import { parseAssignedFromField, type AssignedPMODetail } from "../utils";

interface PMOUserOption {
    value: string; // userId
    label: string; // fullName
    email: string;
}

interface TaskForAssign {
    name: string;
    task_name: string;
    category: string;
    project_name?: string;
    assigned_to?: string | null;
}

interface AssignPMODialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    selectedTasks: TaskForAssign[];
    pmoUsers: { user_id: string; full_name: string; email: string }[];
    onAssign: (taskNames: string[], assignedTo: AssignedPMODetail[]) => Promise<void>;
}

export const AssignPMODialog: React.FC<AssignPMODialogProps> = ({
    isOpen,
    onOpenChange,
    selectedTasks,
    pmoUsers,
    onAssign,
}) => {
    const [selectedUsers, setSelectedUsers] = useState<PMOUserOption[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setSelectedUsers([]);
        }
        onOpenChange(open);
    };

    const userOptions: PMOUserOption[] = useMemo(
        () =>
            pmoUsers.map((u) => ({
                value: u.user_id,
                label: u.full_name || u.user_id,
                email: u.email || "",
            })),
        [pmoUsers]
    );

    const taskAnalysis = useMemo(
        () =>
            selectedTasks.map((task) => {
                const existing = parseAssignedFromField(task.assigned_to);
                const existingIds = new Set(existing.map((d) => d.userId));
                return { task, existing, existingIds };
            }),
        [selectedTasks]
    );

    const previewUpdates = useMemo(() => {
        if (selectedUsers.length === 0) {
            return { tasksToUpdate: [] as typeof taskAnalysis, tasksSkipped: [] as typeof taskAnalysis };
        }

        const tasksToUpdate: typeof taskAnalysis = [];
        const tasksSkipped: typeof taskAnalysis = [];

        for (const item of taskAnalysis) {
            const newUsers = selectedUsers.filter((u) => !item.existingIds.has(u.value));
            if (newUsers.length > 0) {
                tasksToUpdate.push(item);
            } else {
                tasksSkipped.push(item);
            }
        }

        return { tasksToUpdate, tasksSkipped };
    }, [taskAnalysis, selectedUsers]);

    const updateCount = previewUpdates.tasksToUpdate.length;
    const skipCount = previewUpdates.tasksSkipped.length;

    const handleAssign = async () => {
        setIsSaving(true);
        try {
            const taskNames: string[] = [];
            for (const item of taskAnalysis) {
                const toAdd = selectedUsers
                    .filter((u) => !item.existingIds.has(u.value))
                    .map((u) => ({
                        userId: u.value,
                        userName: u.label,
                        userEmail: u.email,
                    }));
                if (toAdd.length > 0) {
                    taskNames.push(item.task.name);
                }
            }

            if (taskNames.length > 0) {
                const assignedTo = selectedUsers.map((u) => ({
                    userId: u.value,
                    userName: u.label,
                    userEmail: u.email,
                }));
                await onAssign(taskNames, assignedTo);
            }
            handleOpenChange(false);
        } catch {
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
                        Assign PMO Executive
                        <Badge
                            variant="secondary"
                            className="ml-1 px-1.5 py-0 text-[10px] font-medium"
                        >
                            {selectedTasks.length} task{selectedTasks.length !== 1 ? "s" : ""}
                        </Badge>
                    </DialogTitle>
                </DialogHeader>

                <div className="grid gap-4 py-2">
                    {/* Selected Tasks */}
                    <div className="space-y-1.5">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Selected Tasks
                        </p>
                        <div className="max-h-48 overflow-y-auto rounded border border-gray-200 divide-y divide-gray-100">
                            {taskAnalysis.map(({ task, existing }) => (
                                <div
                                    key={task.name}
                                    className="flex items-center justify-between gap-2 px-2.5 py-1.5"
                                >
                                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                        <span className="text-xs font-medium text-gray-800 truncate">
                                            {task.task_name}
                                        </span>
                                        <span className="text-[10px] text-gray-400 shrink-0">
                                            {task.category}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-0.5 shrink-0 max-w-[40%] justify-end">
                                        {existing.length > 0 ? (
                                            existing.map((d, idx) => (
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

                    {/* Select PMO Users */}
                    <div className="space-y-1.5">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Assign To
                        </p>
                        <ReactSelect<PMOUserOption, true>
                            isMulti
                            value={selectedUsers}
                            options={userOptions}
                            onChange={(newValue) => setSelectedUsers(newValue as PMOUserOption[])}
                            placeholder="Select PMO executives to assign..."
                            classNamePrefix="react-select"
                            styles={getSelectStyles<PMOUserOption, true>()}
                            menuPortalTarget={document.body}
                            menuPosition="fixed"
                            isDisabled={isSaving}
                        />
                    </div>

                    {/* Preview */}
                    {selectedUsers.length > 0 && (
                        <div className="space-y-1.5">
                            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Preview
                            </p>
                            <div className="max-h-40 overflow-y-auto rounded border border-gray-200 divide-y divide-gray-100">
                                {taskAnalysis.map(({ task, existingIds }) => {
                                    const newOnes = selectedUsers.filter(
                                        (u) => !existingIds.has(u.value)
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
                                                    newOnes.map((u, idx) => (
                                                        <Badge
                                                            key={idx}
                                                            variant="secondary"
                                                            className="px-1 py-0 text-[9px] font-medium bg-green-50 text-green-700 border border-green-200 rounded-full whitespace-nowrap"
                                                        >
                                                            + {u.label}
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
                                Will update{" "}
                                <span className="font-medium text-gray-700">{updateCount}</span> of{" "}
                                <span className="font-medium text-gray-700">
                                    {selectedTasks.length}
                                </span>{" "}
                                tasks
                                {skipCount > 0 && (
                                    <span className="text-amber-600 ml-1">
                                        ({skipCount} already have all selected users)
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
                        disabled={selectedUsers.length === 0 || updateCount === 0 || isSaving}
                        className="bg-red-600 hover:bg-red-700"
                    >
                        {isSaving ? (
                            <TailSpin height={14} width={14} color="#fff" />
                        ) : (
                            <>
                                <Users className="h-3 w-3 mr-1.5" />
                                Assign to {updateCount} task{updateCount !== 1 ? "s" : ""}
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
