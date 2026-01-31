import React from "react";
import { useParams } from "react-router-dom";

import { useFrappeGetDoc } from "frappe-react-sdk";
import { CircleDollarSign } from "lucide-react";
import { CashflowPlan } from "@/pages/projects/CashflowPlan/CashflowPlan";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { Projects } from "@/types/NirmaanStack/Projects";

const CashflowPlanTrackerDetail: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();

  // Fetch project data
  const {
    data: project,
    isLoading,
    error,
  } = useFrappeGetDoc<Projects>("Projects", projectId!, projectId ? undefined : null);

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Project ID not found</p>
      </div>
    );
  }

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
       {/* Header with Back Button & Project Info */}
        <div className="flex items-center gap-3">
          
            <CircleDollarSign className="h-6 w-6 text-primary" />
         
          <div>
            <h1 className="text-xl font-semibold text-gray-900 leading-tight">
              {project.project_name}
            </h1>
            <p className="text-sm text-gray-500 font-medium">Cashflow Plans</p>
          </div>
        </div>

      <CashflowPlan />
    </div>
  );
};

export default CashflowPlanTrackerDetail;
