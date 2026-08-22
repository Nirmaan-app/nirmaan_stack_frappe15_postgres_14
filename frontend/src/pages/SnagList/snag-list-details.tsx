/**
 * `/snag-list/:id` — one project's snag list, reached from the sidebar grid.
 *
 * This page is a FRAME, not a second implementation: the table, the stats strip, the
 * import wizard and every permission gate come from `SnagListTab`, which the Project
 * page also renders as a tab. Two mount points, one component — a fork here is how the
 * two copies start drifting.
 *
 * `SnagListTab` persists its table state under `snags_<projectId>`, so a filter set on
 * the Project page tab is still set when the same project is opened here. That is on
 * purpose: it is the same list.
 */

import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { ArrowLeft, ArrowUpRight, MapPin } from "lucide-react";

import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { Button } from "@/components/ui/button";
import { ProjectStatusBadge } from "@/components/common/ProjectStatusBadge";

import { SnagListTab } from "./SnagListTab";

interface ProjectHeaderDoc {
  name: string;
  project_name?: string;
  project_city?: string;
  status?: string;
}

export const SnagListProjectDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: project, isLoading, error } = useFrappeGetDoc<ProjectHeaderDoc>(
    "Projects",
    id,
    id ? undefined : null
  );

  if (!id) return <AlertDestructive error={new Error("No project in the URL.")} />;
  if (isLoading) return <LoadingFallback />;
  if (error) return <AlertDestructive error={error as unknown as Error} />;

  return (
    <div className="flex-1 space-y-4">
      <div className="bg-white border-b border-gray-200 px-4 py-4 md:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => navigate("/snag-list")}
              aria-label="Back to snag lists"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-semibold text-gray-900">
                  {project?.project_name || id}
                </h1>
                <ProjectStatusBadge status={project?.status} />
              </div>
              <p className="flex items-center gap-2 text-sm text-gray-500">
                <span>Snag List</span>
                {project?.project_city && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {project.project_city}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* The rest of the project lives one click away — this page is only its snags. */}
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => navigate(`/projects/${id}`)}
          >
            Open project
            <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="px-4 md:px-6 pb-6">
        <SnagListTab projectId={id} projectName={project?.project_name} />
      </div>
    </div>
  );
};

export default SnagListProjectDetail;
