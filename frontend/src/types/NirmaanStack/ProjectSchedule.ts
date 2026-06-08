import { ProjectScheduleMilestone } from "./ProjectScheduleMilestone";

export interface ProjectSchedule {
    name: string;
    project: string;
    project_name?: string;
    milestones: ProjectScheduleMilestone[];
    creation: string;
    modified: string;
    modified_by: string;
    owner: string;
    /** Names of milestones marked `Disabled` in the project's latest completed
     *  Project Progress Report. Server-side derived; used by the schedule UI
     *  to lock date edits and drop rows from the DPR PDF. */
    disabled_milestones?: string[];
}
