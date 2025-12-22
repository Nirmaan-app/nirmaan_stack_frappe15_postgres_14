import { ProjectDesignTracker, DesignTrackerTask, User, AssignedDesignerDetail } from './types';


// Consolidated Status Logic
export const getUnifiedStatusStyle = (status: string) => {
    if (!status) return 'bg-gray-100 text-gray-700 border border-gray-300 font-medium rounded-full';
    
    const lowerStatus = status.toLowerCase();

    // 1. Not Applicable -> Gray
    if (lowerStatus.includes('not applicable')) {
        return 'bg-gray-100 text-gray-700 border border-gray-300 font-medium rounded-full';
    }

    // 2. Not Started -> Red
    if (lowerStatus.includes('not started')) {
        return 'bg-red-100 text-red-700 border border-red-500 font-medium rounded-full';
    }

    // 3. Submitted -> Light Green
    if (lowerStatus.includes('submitted')) {
        return 'bg-green-100 text-green-700 border border-green-500 font-medium rounded-full';
    }

    // 4. Approved -> Dark Green (Using a stronger green variant)
    if (lowerStatus.includes('approved')) {
         return 'bg-green-300 text-green-900 border border-green-500 font-medium rounded-full';
    }

    // 5. Default / Others -> Amber
    return 'bg-amber-100 text-amber-700 border border-amber-500 font-medium rounded-full';
};

// Keeping these for backward compatibility if needed, but they can just alias the unified one
export const getStatusBadgeStyle = getUnifiedStatusStyle;
export const getTaskStatusStyle = getUnifiedStatusStyle;

export const getTaskSubStatusStyle = (subStatus?: string) => {
    if (!subStatus || subStatus === '...') return 'bg-gray-100 text-gray-700 border border-gray-300 font-medium rounded-full ';
    
    const lowerSubStatus = subStatus.toLowerCase();
    if (lowerSubStatus.includes('clarification') || lowerSubStatus.includes('rework') || lowerSubStatus.includes('sub-status 1')) {
        return 'bg-amber-100 text-amber-700 border border-amber-500 font-medium rounded-full';
    }
    return 'bg-gray-100 text-gray-700 border border-gray-300 font-medium rounded-full';
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
