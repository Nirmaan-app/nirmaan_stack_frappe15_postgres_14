import React from "react";
import { useParams } from "react-router-dom";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { Calendar } from "lucide-react";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { SevendaysWorkPlan } from "@/pages/projects/components/planning/SevendaysWorkPlan";
import { Projects } from "@/types/NirmaanStack/Projects";
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import { CEOHoldBanner } from "@/components/ui/ceo-hold-banner";

const WorkPlanTrackerDetail: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { isCEOHold } = useCEOHoldGuard(projectId);

  // Fetch project data
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
      {isCEOHold && <CEOHoldBanner className="mb-4" />}
      {/* Header with project info */}
      <div className="flex items-center gap-3">
        <Calendar className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {project.project_name}
          </h1>
          <p className="text-sm text-gray-500">Work Plan</p>
        </div>
      </div>

      {/* Work Plan Content - Show all work plans (no date filter) */}
      <SevendaysWorkPlan
        projectId={projectId!}
        isOverview={false}
        projectName={project.project_name}
      />
    </div>
  );
};

export default WorkPlanTrackerDetail;
