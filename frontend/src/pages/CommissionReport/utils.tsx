import { ProjectCommissionReportType } from './types';


// Status color mapping for Commission Report
// - Client Accepted  -> Green
// - Submitted        -> Teal
// - Pending Approval -> Indigo
// - Pending          -> Amber
// - Not Applicable   -> Gray
export const getUnifiedStatusStyle = (status: string) => {
    if (!status) return 'bg-gray-50 text-gray-700 border border-gray-200';

    if (status === 'Client Accepted') {
        return 'bg-green-50 text-green-700 border border-green-200';
    }

    if (status === 'Submitted') {
        return 'bg-teal-50 text-teal-700 border border-teal-200';
    }

    if (status === 'Pending Approval') {
        return 'bg-indigo-50 text-indigo-700 border border-indigo-200';
    }

    if (status === 'Rejected') {
        return 'bg-red-50 text-red-700 border border-red-200';
    }

    if (status === 'Pending') {
        return 'bg-amber-50 text-amber-700 border border-amber-200';
    }

    if (status === 'Not Applicable') {
        return 'bg-gray-50 text-gray-500 border border-gray-200';
    }

    return 'bg-gray-50 text-gray-700 border border-gray-200';
};

// Frappe-friendly current date (yyyy-mm-dd) for stamping last_submitted etc.
export const todayDate = (): string => new Date().toISOString().slice(0, 10);

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


export const getExistingTaskNames = (trackerDoc?: ProjectCommissionReportType): string[] => {
    if (!trackerDoc?.commission_report_task) return [];
    return trackerDoc.commission_report_task.map(t => t.task_name);
};
