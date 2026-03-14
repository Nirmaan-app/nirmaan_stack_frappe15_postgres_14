import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { ClipboardList, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { Projects } from "@/types/NirmaanStack/Projects";
import { PRCriticalTagsList } from "./components/PRCriticalTagsList";
import { PRCriticalTagsTable } from "./components/PRCriticalTagsTable";
import { CriticalPRTag } from "./types";

const PRTrackerDetail: React.FC = () => {
    const { projectId } = useParams<{ projectId: string }>();
    const navigate = useNavigate();

    // Fetch project data
    const {
        data: project,
        isLoading: isProjectLoading,
        error: projectError,
    } = useFrappeGetDoc<Projects>("Projects", projectId!, projectId ? undefined : null);

    // Fetch Critical PR Tags for this project
    const {
        data: tags,
        isLoading: isTagsLoading,
        error: tagsError,
    } = useFrappeGetDocList<CriticalPRTag>("Critical PR Tags", {
        fields: ["name", "project", "projectname", "header", "package", "associated_prs"],
        filters: projectId ? [["project", "=", projectId]] : [],
        limit: 0,
        orderBy: { field: "header", order: "asc" },
    }, projectId ? `Critical PR Tags ${projectId}` : null);

    // Loading state
    if (isProjectLoading || isTagsLoading) {
        return (
            <div className="flex-1 flex items-center justify-center min-h-[400px]">
                <LoadingFallback />
            </div>
        );
    }

    // Error state
    if (projectError || tagsError || !project) {
        return (
            <div className="flex-1 p-6 space-y-4">
                <AlertDestructive error={projectError || tagsError || new Error("Project not found")} />
                <Button variant="outline" onClick={() => navigate("/pr-tracker")}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to PR Tracker
                </Button>
            </div>
        );
    }

    const [viewMode, setViewMode] = React.useState<"list" | "table">("table");

    return (
        <div className="flex-1 p-6 space-y-6">
            {/* Header with back button and project info */}
            <div className="flex flex-col gap-4">
                <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => navigate("/pr-tracker")}
                    className="w-fit text-gray-500 hover:text-gray-900 -ml-2"
                >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to PR Tracker
                </Button>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <ClipboardList className="h-7 w-7 text-primary" />
                        <div>
                            <h1 className="text-2xl font-semibold text-gray-900">
                                {project.project_name}
                            </h1>
                            <p className="text-sm text-gray-500">Critical PR Tag Monitoring</p>
                        </div>
                    </div>

                    {/* View Switcher */}
                    <div className="flex items-center bg-gray-100 p-1 rounded-md">
                        <Button
                            variant={viewMode === "table" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setViewMode("table")}
                            className={`text-xs h-8 ${viewMode === "table" ? "bg-white shadow-sm" : ""}`}
                        >
                            Table
                        </Button>
                        <Button
                            variant={viewMode === "list" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setViewMode("list")}
                            className={`text-xs h-8 ${viewMode === "list" ? "bg-white shadow-sm" : ""}`}
                        >
                            Cards
                        </Button>
                    </div>
                </div>
            </div>

            {/* List or Table of critical PR tags */}
            {viewMode === "list" ? (
                <PRCriticalTagsList
                    projectId={projectId!}
                    tags={tags || []}
                />
            ) : (
                <PRCriticalTagsTable
                    tags={tags || []}
                    projectName={project.project_name}
                />
            )}
        </div>
    );
};

export default PRTrackerDetail;
