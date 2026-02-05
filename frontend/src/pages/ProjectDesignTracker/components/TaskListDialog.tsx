// frontend/src/pages/ProjectDesignTracker/components/TaskListDialog.tsx

/**
 * @deprecated This component has been replaced by InlineTaskList for TeamPerformanceSummary.
 * The inline approach provides a better UX by showing tasks directly in the table without
 * opening a modal. This file is kept for reference but should not be used in new code.
 *
 * Migration: Use InlineTaskList component instead.
 * See: TeamPerformanceSummary.tsx for usage example.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Loader2 } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { TaskPreviewFilter, TaskPreviewItem } from '../types';
import { formatDeadlineShort } from '../utils';

interface TaskListDialogProps {
    isOpen: boolean;
    onClose: () => void;
    filter: TaskPreviewFilter | null;
    tasks: TaskPreviewItem[];
    isLoading: boolean;
}

export const TaskListDialog: React.FC<TaskListDialogProps> = ({
    isOpen,
    onClose,
    filter,
    tasks,
    isLoading,
}) => {
    // Build title based on filter context
    const dialogTitle = React.useMemo(() => {
        if (!filter) return 'Tasks';
        const userPart = filter.user_name;
        const statusPart = filter.status;
        const projectPart = filter.project_name ? ` (${filter.project_name})` : '';
        return `${userPart} - ${statusPart}${projectPart}`;
    }, [filter]);

    // Determine if we're showing project-level or user-level view
    const showProjectColumn = !filter?.project_id;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                className="sm:max-w-2xl"
                aria-labelledby="task-dialog-title"
                aria-describedby="task-dialog-description"
            >
                <DialogHeader>
                    <DialogTitle id="task-dialog-title" className="text-base font-semibold">
                        {dialogTitle}
                    </DialogTitle>
                    <DialogDescription id="task-dialog-description" className="text-sm text-muted-foreground">
                        {isLoading ? 'Loading tasks...' : `${tasks.length} task(s) found`}
                    </DialogDescription>
                </DialogHeader>

                <div className="max-h-[60vh] overflow-y-auto">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : tasks.length === 0 ? (
                        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                            No tasks found for the selected criteria.
                        </div>
                    ) : (
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
                                        Category
                                    </th>
                                    <th className="text-left py-2 px-3 font-medium text-gray-600 text-xs uppercase tracking-wider">
                                        Deadline
                                    </th>
                                    <th className="w-10 py-2 px-3">
                                        <span className="sr-only">Link</span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {tasks.map((task) => (
                                    <tr
                                        key={task.name}
                                        className="hover:bg-gray-50 transition-colors"
                                        style={{ height: '32px' }}
                                    >
                                        <td className="py-1.5 px-3 text-gray-900 truncate max-w-[200px]" title={task.task_name}>
                                            {task.task_name}
                                        </td>
                                        {showProjectColumn && (
                                            <td className="py-1.5 px-3 text-gray-600 truncate max-w-[150px]" title={task.project_name}>
                                                {task.project_name}
                                            </td>
                                        )}
                                        <td className="py-1.5 px-3 text-gray-600 truncate max-w-[120px]" title={task.design_category}>
                                            {task.design_category}
                                        </td>
                                        <td
                                            className="py-1.5 px-3 text-gray-600 whitespace-nowrap"
                                            style={{ fontVariantNumeric: 'tabular-nums' }}
                                        >
                                            {formatDeadlineShort(task.deadline || '')}
                                        </td>
                                        <td className="py-1.5 px-3">
                                            <Link
                                                to={`/design-tracker/${task.tracker_id}`}
                                                aria-label="View task in tracker"
                                                className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-gray-200 transition-colors"
                                            >
                                                <ExternalLink className="h-3.5 w-3.5 text-gray-500" />
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
