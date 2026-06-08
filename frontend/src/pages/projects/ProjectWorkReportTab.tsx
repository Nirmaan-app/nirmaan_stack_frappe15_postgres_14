// src/pages/projects/ProjectWorkReportTab.tsx
import React from "react";
import { ClipboardList } from "lucide-react";
import { Projects, ProjectZoneEntry } from "@/types/NirmaanStack/Projects";
import { FrappeDoc } from "frappe-react-sdk";
import type { KeyedMutator } from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { MilestonesSummary } from "../Manpower-and-WorkMilestones/MilestonesSummary";
import { ProgressTrackingSettingsCard } from "./components/ProgressTrackingSettingsCard";

interface ProjectWorkReportTabProps {
    projectData: Projects;
    project_mutate: KeyedMutator<FrappeDoc<Projects>>;
    current_role: string;
}

interface ProjectsWithZones extends Projects {
    project_zones: ProjectZoneEntry[];
}

const ADMIN_ROLES = [
    "Nirmaan Admin Profile",
    "Nirmaan PMO Executive Profile",
    "Nirmaan Project Lead Profile",
];

export const ProjectWorkReportTab: React.FC<ProjectWorkReportTabProps> = ({
    projectData,
    project_mutate,
    current_role,
}) => {
    const projectDataWithZones = projectData as ProjectsWithZones;
    const isMilestoneTrackingEnabled = Boolean(projectData.enable_project_milestone_tracking);
    const hasZones = Boolean(projectDataWithZones?.project_zones?.length);
    const showMilestones = isMilestoneTrackingEnabled && hasZones;
    const hasAdminAccess = ADMIN_ROLES.includes(current_role);

    return (
        <>
            <ProgressTrackingSettingsCard
                projectData={projectData}
                project_mutate={project_mutate}
                current_role={current_role}
            />

            {showMilestones && (
                <MilestonesSummary
                    workReport={true}
                    projectIdForWorkReport={projectData?.name}
                />
            )}

            {!showMilestones && !hasAdminAccess && (
                <div className="flex flex-col items-center justify-center min-h-[300px] p-6">
                    <Card className="w-full max-w-xl border-dashed border-2">
                        <CardContent className="flex flex-col items-center justify-center py-10 px-6 space-y-4">
                            <div className="rounded-full bg-gray-100 p-5">
                                <ClipboardList className="h-10 w-10 text-gray-500" />
                            </div>
                            <div className="text-center space-y-2">
                                <h3 className="text-xl font-semibold text-gray-900">
                                    Work Report not configured
                                </h3>
                                <p className="text-sm text-gray-600 max-w-md">
                                    Milestone tracking has not been set up for this project yet.
                                    Please ask your Project Lead or PMO to enable progress tracking
                                    and define zones and work headers.
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </>
    );
};
