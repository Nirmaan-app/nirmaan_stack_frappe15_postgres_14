export interface ProjectScheduleMilestone {
    name: string;
    idx?: number;
    parent?: string;
    parentfield?: string;
    parenttype?: string;
    work_header: string;
    work_milestone: string;
    start_date: string | null;
    end_date: string | null;
    edited_by_user: string | null;
    changed_by_user: 0 | 1;
}
