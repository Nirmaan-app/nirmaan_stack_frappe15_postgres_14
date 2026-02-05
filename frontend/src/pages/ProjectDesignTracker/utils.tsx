import { ProjectDesignTracker, DesignTrackerTask, AssignedDesignerDetail } from './types';
import { Badge } from "@/components/ui/badge";


// Consolidated Status Logic
// Color scheme aligned with WorkPlanTracker and CriticalPOTracker:
// - Completed/Approved -> Green
// - In Progress/Active work -> Blue
// - Blocked/On Hold -> Orange
// - Not Started/Todo -> Gray
// - Not Applicable -> Gray (lighter)
export const getUnifiedStatusStyle = (status: string) => {
    if (!status) return 'bg-gray-50 text-gray-700 border border-gray-200';

    const lowerStatus = status.toLowerCase();

    // 1a. Approved -> Dark Green with white text (final completion state)
    if (lowerStatus.includes('approved')) {
        return 'bg-green-700 text-white border border-green-800';
    }

    // 1b. Done/Submitted -> Light Green (completed but not final)
    if (lowerStatus.includes('done') || lowerStatus.includes('submitted')) {
        return 'bg-green-50 text-green-700 border border-green-200';
    }

    // 2. In Progress -> Blue (active work)
    if (lowerStatus.includes('in progress')) {
        return 'bg-blue-50 text-blue-700 border border-blue-200';
    }

    // 3. Blocked/On Hold/Revision/Clarification -> Orange (needs attention)
    if (lowerStatus.includes('blocked') || lowerStatus.includes('on hold') ||
        lowerStatus.includes('revision') || lowerStatus.includes('clarification') ||
        lowerStatus.includes('awaiting')) {
        return 'bg-orange-50 text-orange-700 border border-orange-200';
    }

    // 4. Not Started/Todo -> Gray (not yet started)
    if (lowerStatus.includes('not started') || lowerStatus.includes('todo')) {
        return 'bg-gray-100 text-gray-700 border border-gray-300';
    }

    // 5. Not Applicable -> Light Gray
    if (lowerStatus.includes('not applicable')) {
        return 'bg-gray-50 text-gray-500 border border-gray-200';
    }

    // 6. Default -> Gray
    return 'bg-gray-50 text-gray-700 border border-gray-200';
};

// Keeping these for backward compatibility if needed, but they can just alias the unified one
export const getStatusBadgeStyle = getUnifiedStatusStyle;
export const getTaskStatusStyle = getUnifiedStatusStyle;

export const getTaskSubStatusStyle = (subStatus?: string) => {
    if (!subStatus || subStatus === '...') return 'bg-gray-50 text-gray-700 border border-gray-200';

    const lowerSubStatus = subStatus.toLowerCase();
    // Needs attention states -> Orange
    if (lowerSubStatus.includes('clarification') || lowerSubStatus.includes('rework') || lowerSubStatus.includes('sub-status 1')) {
        return 'bg-orange-50 text-orange-700 border border-orange-200';
    }
    return 'bg-gray-50 text-gray-700 border border-gray-200';
};

// --- DATE HELPER ---
// Standard date format for the project: dd-MMM-yyyy (e.g., "15-Jan-2026")
export const formatDeadlineShort = (dateString: string) => {
    if (!dateString) return '--';
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return '--';
        const day = date.toLocaleString('default', { day: '2-digit' });
        const month = date.toLocaleString('default', { month: 'short' });
        const year = date.toLocaleString('default', { year: 'numeric' });
        return `${day}-${month}-${year}`;
    } catch {
        return dateString;
    }
};


export const getAssignedNameForDisplay = (task: DesignTrackerTask): React.ReactNode => {
        const designerField = task.assigned_designers as unknown;
        let designers: AssignedDesignerDetail[] = [];

        if (designerField) {
            // Check if already an object with list property (from useDesignTrackerLogic state)
            if (typeof designerField === 'object' && designerField !== null && 'list' in designerField) {
                const obj = designerField as { list: AssignedDesignerDetail[] };
                if (Array.isArray(obj.list)) {
                    designers = obj.list;
                }
            } else if (Array.isArray(designerField)) {
                designers = designerField;
            } else if (typeof designerField === 'string' && designerField.trim() !== '') {
                try {
                    const parsed = JSON.parse(designerField);
                    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.list)) {
                        designers = parsed.list;
                    } else if (Array.isArray(parsed)) {
                        designers = parsed;
                    }
                } catch (e) { /* silent fail */ }
            }
        }

        if (designers.length > 0) {
            return (
                <div className="flex flex-wrap gap-1 justify-start">
                    {designers.map((d, index) => (
                        <Badge
                            key={index}
                            variant="secondary"
                            className="px-1.5 py-0 text-[9px] font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-full whitespace-nowrap"
                        >
                            {d.userName || d.userId}
                        </Badge>
                    ))}
                </div>
            );
        } else {
            return (
                <span className="text-gray-400 text-xs">--</span>
            );
        }
    };


    
export const getExistingTaskNames = (trackerDoc?: ProjectDesignTracker): string[] => {
    if (!trackerDoc?.design_tracker_task) return [];
    return trackerDoc.design_tracker_task.map(t => t.task_name);
};
