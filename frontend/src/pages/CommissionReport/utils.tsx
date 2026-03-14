import { ProjectCommissionReportType, CommissionReportTask, AssignedDesignerDetail } from './types';
import { Badge } from "@/components/ui/badge";


// Status color mapping for Commission Report
// - Completed -> Green
// - In Progress -> Blue
// - Pending -> Amber
// - Not Applicable -> Gray
export const getUnifiedStatusStyle = (status: string) => {
    if (!status) return 'bg-gray-50 text-gray-700 border border-gray-200';

    if (status === 'Completed') {
        return 'bg-green-50 text-green-700 border border-green-200';
    }

    if (status === 'In Progress') {
        return 'bg-blue-50 text-blue-700 border border-blue-200';
    }

    if (status === 'Pending') {
        return 'bg-amber-50 text-amber-700 border border-amber-200';
    }

    if (status === 'Not Applicable') {
        return 'bg-gray-50 text-gray-500 border border-gray-200';
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


export const parseDesignersFromField = (designerField: unknown): AssignedDesignerDetail[] => {
    if (!designerField) return [];

    // Already an object with list property (from useCommissionTrackerLogic state)
    if (typeof designerField === 'object' && designerField !== null && 'list' in designerField) {
        const obj = designerField as { list: AssignedDesignerDetail[] };
        if (Array.isArray(obj.list)) return obj.list;
    }

    // Already an array
    if (Array.isArray(designerField)) return designerField;

    // JSON string
    if (typeof designerField === 'string' && designerField.trim() !== '') {
        try {
            const parsed = JSON.parse(designerField);
            if (parsed?.list && Array.isArray(parsed.list)) return parsed.list;
            if (Array.isArray(parsed)) return parsed;
        } catch { /* silent fail */ }
    }

    return [];
};

export const getAssignedNameForDisplay = (task: CommissionReportTask): React.ReactNode => {
    const designers = parseDesignersFromField(task.assigned_designers);

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



export const getExistingTaskNames = (trackerDoc?: ProjectCommissionReportType): string[] => {
    if (!trackerDoc?.commission_report_task) return [];
    return trackerDoc.commission_report_task.map(t => t.task_name);
};
