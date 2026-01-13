import React from "react";
import { useParams } from "react-router-dom";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { ClipboardCheck } from "lucide-react";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { CriticalPOTasksTab } from "@/pages/projects/CriticalPOTasks/CriticalPOTasksTab";
import { Projects } from "@/types/NirmaanStack/Projects";

const CriticalPOTrackerDetail: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();

  // Fetch project data needed by CriticalPOTasksTab
  const {
    data: project,
    isLoading,
    error,
  } = useFrappeGetDoc<Projects>("Projects", projectId!, projectId ? undefined : null);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[400px]">
        <LoadingFallback />
      </div>
    );
  }

  // Error state
  if (error || !project) {
    return (
      <div className="flex-1 p-6 space-y-4">
        <AlertDestructive error={error || new Error("Project not found")} />
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 space-y-6">
      {/* Header with project info */}
      <div className="flex items-center gap-3">
        <ClipboardCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {project.project_name}
          </h1>
          <p className="text-sm text-gray-500">Critical PO Tasks</p>
        </div>
      </div>

      {/* Critical PO Tasks Content - Reuse existing component */}
      <CriticalPOTasksTab
        projectId={projectId!}
        projectData={project}
      />
    </div>
  );
};

export default CriticalPOTrackerDetail;
