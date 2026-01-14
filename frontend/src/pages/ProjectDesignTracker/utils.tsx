import { ProjectDesignTracker, DesignTrackerTask, User, AssignedDesignerDetail } from './types';


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

    // 1. Approved/Done/Submitted -> Green (completed states)
    if (lowerStatus.includes('approved') || lowerStatus.includes('done') || lowerStatus.includes('submitted')) {
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

// --- DATE & STYLE HELPERS ---
const getOrdinalNum = (n: number) => {
    return n + (n > 0 ? ['th', 'st', 'nd', 'rd'][(n > 3 && n < 21) || n % 10 > 3 ? 0 : n % 10] : '');
};

const formatDate = (dateString?: string): string => {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        const day = date.getDate();
        const month = date.toLocaleString('en-US', { month: 'short' });
        const year = date.getFullYear();
        return `${getOrdinalNum(day)} ${month}, ${year}`;
    } catch (e) {
        return dateString; // Fallback to raw string if date parsing fails
    }
};

export const formatDeadlineShort = (dateString: string) => {
    if (!dateString) return '...';
    return formatDate(dateString).replace(/, 20(\d{2})$/, ', $1');
};


export const getAssignedNameForDisplay = (task: DesignTrackerTask): React.ReactNode => {
        const designerField = task.assigned_designers;
        let designers: AssignedDesignerDetail[] = [];

        if (designerField) {
            // Check if already an object (from useDesignTrackerLogic state)
            if (designerField && typeof designerField === 'object' && Array.isArray(designerField.list)) {
                designers = designerField.list;
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
                <div className="flex justify-start">
                <ul className="list-disc list-inside text-xs text-center">
                    {designers.map((d, index) => (
                        <li key={index}>
                            {d.userName || d.userId}
                        </li>
                    ))}
                </ul>
            </div>
            )
        } else {
            return  <div className="flex justify-start ml-10">
                <p>--</p>
            </div>
        }
        // return getDesignerName(undefined);
    };


    
export const getExistingTaskNames = (trackerDoc?: ProjectDesignTracker): string[] => {
    if (!trackerDoc?.design_tracker_task) return [];
    return trackerDoc.design_tracker_task.map(t => t.task_name);
};
