// frontend/src/pages/ProjectDesignTracker/components/InlineTaskList.tsx

import React, { useMemo, useState } from 'react';
import { X, Pencil, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useFrappeUpdateDoc } from 'frappe-react-sdk';
import { toast } from '@/components/ui/use-toast';
import { TaskEditModal } from './TaskEditModal';
import { InlineTaskExpansion, TaskPreviewItem, User, DesignTrackerTask } from '../types';
import { formatDeadlineShort, getUnifiedStatusStyle } from '../utils';

interface StatusOption {
    label: string;
    value: string;
}

interface InlineTaskListProps {
    filter: InlineTaskExpansion;
    tasks: TaskPreviewItem[];
    isLoading: boolean;
    onClose: () => void;
    // For TaskEditModal integration
    usersList: User[];
    statusOptions: StatusOption[];
    subStatusOptions: StatusOption[];
    onTaskUpdated: () => void;
    // Accessibility
    expansionId?: string;
}

export const InlineTaskList: React.FC<InlineTaskListProps> = ({
    filter,
    tasks,
    isLoading,
    onClose,
    usersList,
    statusOptions,
    subStatusOptions,
    onTaskUpdated,
    expansionId,
}) => {
    const [editingTask, setEditingTask] = useState<TaskPreviewItem | null>(null);

    const { updateDoc, loading: isUpdating } = useFrappeUpdateDoc();

    // Determine if we're showing project-level or user-level view
    const showProjectColumn = !filter.projectId;

    // Get status-matched styling for the expansion container
    const statusStyle = useMemo(() => getUnifiedStatusStyle(filter.status), [filter.status]);

    // Extract colors from the status style for the container
    const containerColors = useMemo(() => {
        // Map status styles to container border/background colors
        // Check for dark green (Approved) first - has bg-green-700
        if (statusStyle.includes('bg-green-700')) {
            return { border: 'border-l-green-700', bg: 'bg-green-100/60', badgeBg: 'bg-green-700', badgeText: 'text-white', badgeBorder: 'border-green-800' };
        }
        // Light green (Submitted, Done)
        if (statusStyle.includes('green')) {
            return { border: 'border-l-green-400', bg: 'bg-green-50/40', badgeBg: 'bg-green-100', badgeText: 'text-green-700', badgeBorder: 'border-green-200' };
        }
        if (statusStyle.includes('blue')) {
            return { border: 'border-l-blue-400', bg: 'bg-blue-50/40', badgeBg: 'bg-blue-100', badgeText: 'text-blue-700', badgeBorder: 'border-blue-200' };
        }
        if (statusStyle.includes('orange')) {
            return { border: 'border-l-orange-400', bg: 'bg-orange-50/40', badgeBg: 'bg-orange-100', badgeText: 'text-orange-700', badgeBorder: 'border-orange-200' };
        }
        // Default gray
        return { border: 'border-l-gray-400', bg: 'bg-gray-50/40', badgeBg: 'bg-gray-100', badgeText: 'text-gray-700', badgeBorder: 'border-gray-300' };
    }, [statusStyle]);

    // Color-coded rows based on deadline/submission state
    const getTaskRowColor = (task: TaskPreviewItem): string => {
        const status = task.task_status;

        // Priority 1: Submitted 3+ days ago but not approved
        if (task.last_submitted && status !== 'Approved') {
            const submitted = new Date(task.last_submitted);
            submitted.setHours(0, 0, 0, 0);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const diffDays = Math.floor((today.getTime() - submitted.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays >= 3) return 'bg-red-100';
        }

        // Priority 2: Past deadline, not submitted and not approved
        if (task.deadline && status !== 'Submitted' && status !== 'Approved') {
            const deadline = new Date(task.deadline);
            deadline.setHours(0, 0, 0, 0);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (deadline < today) return 'bg-red-50';
        }

        // Priority 3: Deadline is today, not approved
        if (task.deadline && status !== 'Approved') {
            const deadline = new Date(task.deadline);
            deadline.setHours(0, 0, 0, 0);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (deadline.getTime() === today.getTime()) return 'bg-yellow-50';
        }

        return '';
    };

    // Convert TaskPreviewItem to DesignTrackerTask for modal
    const taskForModal: DesignTrackerTask | null = editingTask ? {
        name: editingTask.name,
        task_name: editingTask.task_name,
        design_category: editingTask.design_category,
        deadline: editingTask.deadline,
        task_status: editingTask.task_status as DesignTrackerTask['task_status'],
        task_sub_status: editingTask.task_sub_status,
        assigned_designers: editingTask.assigned_designers,
        sort_order: 0,
    } : null;

    const handleTaskSave = async (updatedFields: Record<string, any>) => {
        if (!editingTask) return;

        const fieldsToSend: Record<string, any> = { ...updatedFields };

        // Serialize assigned_designers array for Frappe JSON field
        if (Array.isArray(updatedFields.assigned_designers)) {
            fieldsToSend.assigned_designers = JSON.stringify({ list: updatedFields.assigned_designers });
        }

        try {
            await updateDoc('Design Tracker Task Child Table', editingTask.name, fieldsToSend);
            toast({ title: "Task Updated", description: "Changes saved successfully." });
            setEditingTask(null);
            onTaskUpdated();
        } catch (error) {
            toast({ title: "Update Failed", description: "Could not save changes.", variant: "destructive" });
            throw error;
        }
    };

    return (
        <tr id={expansionId}>
            <td colSpan={8} className="p-0">
                <div className={`${containerColors.bg} border-l-4 ${containerColors.border} px-3 py-2`}>
                    {/* Compact Enterprise Header with Labeled Badges */}
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                            {/* Designer Badge */}
                            <div className="flex items-center gap-1 shrink-0">
                                <span className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Designer</span>
                                <Badge
                                    variant="outline"
                                    className="px-2 py-0.5 text-[11px] font-medium bg-white text-gray-700 border-gray-300"
                                >
                                    {filter.userName}
                                </Badge>
                            </div>

                            {/* Status Badge - Color matched */}
                            <div className="flex items-center gap-1 shrink-0">
                                <span className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Status</span>
                                <Badge
                                    variant="outline"
                                    className={`px-2 py-0.5 text-[11px] font-medium ${containerColors.badgeBg} ${containerColors.badgeText} ${containerColors.badgeBorder}`}
                                >
                                    {filter.status}
                                </Badge>
                            </div>

                            {/* Project Badge (if applicable) */}
                            {filter.projectName && (
                                <div className="flex items-center gap-1 min-w-0">
                                    <span className="text-[10px] uppercase tracking-wide text-gray-400 font-medium shrink-0">Project</span>
                                    <Badge
                                        variant="outline"
                                        className="px-2 py-0.5 text-[11px] font-normal bg-gray-50 text-gray-600 border-gray-200 truncate max-w-[180px]"
                                        title={filter.projectName}
                                    >
                                        {filter.projectName}
                                    </Badge>
                                </div>
                            )}

                            {/* Task Count */}
                            {!isLoading && (
                                <div className="flex items-center gap-1 shrink-0">
                                    <span className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Tasks</span>
                                    <span className="text-[11px] font-medium text-gray-600 tabular-nums">
                                        {tasks.length}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Close Button - Minimal */}
                        <button
                            type="button"
                            onClick={onClose}
                            className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded hover:bg-white/80 transition-colors text-gray-400 hover:text-gray-600"
                            aria-label="Close task list"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>

                    {/* Task table or loading/empty states */}
                    {isLoading ? (
                        <div className="space-y-1.5 mt-2">
                            <Skeleton className="h-7 w-full rounded" />
                            <Skeleton className="h-7 w-full rounded" />
                            <Skeleton className="h-7 w-3/4 rounded" />
                        </div>
                    ) : tasks.length === 0 ? (
                        <div className="text-xs text-gray-500 text-center py-3 mt-2">
                            No tasks found for the selected criteria.
                        </div>
                    ) : (
                        <div className="max-h-[280px] overflow-y-auto rounded border border-gray-200/80 bg-white mt-2 shadow-sm">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                                    <tr>
                                        <th className="text-left py-2 px-3 font-medium text-gray-600 text-xs uppercase tracking-wider">
                                            Task Name
                                        </th>
                                        {showProjectColumn && (
                                            <th className="text-left py-2 px-3 font-medium text-gray-600 text-xs uppercase tracking-wider">
                                                Project
                                            </th>
                                        )}
                                        <th className="text-left py-2 px-3 font-medium text-gray-600 text-xs uppercase tracking-wider">
                                            Zone
                                        </th>
                                        <th className="text-left py-2 px-3 font-medium text-gray-600 text-xs uppercase tracking-wider">
                                            Category
                                        </th>
                                        <th className="text-left py-2 px-3 font-medium text-gray-600 text-xs uppercase tracking-wider">
                                            Deadline
                                        </th>
                                        <th className="text-left py-2 px-3 font-medium text-gray-600 text-xs uppercase tracking-wider">
                                            Submitted
                                        </th>
                                        <th className="w-12 py-2 px-3 text-center font-medium text-gray-600 text-xs uppercase tracking-wider">
                                            File
                                        </th>
                                        <th className="w-12 py-2 px-3 text-center font-medium text-gray-600 text-xs uppercase tracking-wider">
                                            Edit
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {tasks.map((task) => {
                                        const rowColor = getTaskRowColor(task);
                                        return (
                                        <tr
                                            key={task.name}
                                            className={`transition-colors ${rowColor ? `${rowColor} hover:brightness-95` : 'hover:bg-gray-50'}`}
                                            style={{ height: '32px' }}
                                        >
                                            <td
                                                className="py-1.5 px-3 text-gray-900 truncate max-w-[200px]"
                                                title={task.task_name}
                                            >
                                                {task.task_name}
                                            </td>
                                            {showProjectColumn && (
                                                <td
                                                    className="py-1.5 px-3 text-gray-600 truncate max-w-[150px]"
                                                    title={task.project_name}
                                                >
                                                    {task.project_name}
                                                </td>
                                            )}
                                            <td
                                                className="py-1.5 px-3 text-gray-500 truncate max-w-[100px]"
                                                title={task.task_zone || ''}
                                            >
                                                {task.task_zone || '--'}
                                            </td>
                                            <td
                                                className="py-1.5 px-3 text-gray-600 truncate max-w-[120px]"
                                                title={task.design_category}
                                            >
                                                {task.design_category}
                                            </td>
                                            <td
                                                className="py-1.5 px-3 text-gray-600 whitespace-nowrap"
                                                style={{ fontVariantNumeric: 'tabular-nums' }}
                                            >
                                                {formatDeadlineShort(task.deadline || '')}
                                            </td>
                                            <td
                                                className="py-1.5 px-3 text-gray-600 whitespace-nowrap"
                                                style={{ fontVariantNumeric: 'tabular-nums' }}
                                            >
                                                {formatDeadlineShort(task.last_submitted || '')}
                                            </td>
                                            <td className="py-1.5 px-3 text-center">
                                                {task.file_link ? (
                                                    <a
                                                        href={task.file_link}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        aria-label="Open design file"
                                                        className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-blue-100 transition-colors text-blue-600"
                                                        title={task.file_link}
                                                    >
                                                        <ExternalLink className="h-3.5 w-3.5" />
                                                    </a>
                                                ) : (
                                                    <span className="text-gray-300">--</span>
                                                )}
                                            </td>
                                            <td className="py-1.5 px-3 text-center">
                                                <button
                                                    onClick={() => setEditingTask(task)}
                                                    aria-label="Edit task"
                                                    className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-gray-200 transition-colors"
                                                    disabled={isUpdating}
                                                >
                                                    <Pencil className="h-3.5 w-3.5 text-gray-500" />
                                                </button>
                                            </td>
                                        </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Task Edit Modal */}
                {editingTask && taskForModal && (
                    <TaskEditModal
                        task={taskForModal}
                        isOpen={!!editingTask}
                        onOpenChange={(open) => !open && setEditingTask(null)}
                        onSave={handleTaskSave}
                        usersList={usersList}
                        statusOptions={statusOptions}
                        subStatusOptions={subStatusOptions}
                        existingTaskNames={[]}
                        disableTaskNameEdit={true}
                    />
                )}
            </td>
        </tr>
    );
};
