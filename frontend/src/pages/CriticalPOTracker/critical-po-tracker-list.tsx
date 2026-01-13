import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFrappeGetCall } from "frappe-react-sdk";
import { Search, ClipboardCheck, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { CriticalPOProjectCard } from "./components/CriticalPOProjectCard";
import { ProjectWithCriticalPOStats } from "./types";

const API_PATH = "nirmaan_stack.api.critical_po_tasks.get_projects_with_stats.get_projects_with_critical_po_stats";

const CriticalPOTrackerList: React.FC = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");

  // Fetch projects with Critical PO stats
  const {
    data: apiResponse,
    isLoading,
    error,
    mutate: refetchList,
  } = useFrappeGetCall<{ message: ProjectWithCriticalPOStats[] }>(
    API_PATH,
    {},
    API_PATH // SWR cache key
  );

  // Safely extract project data from API response
  const projects = useMemo(() => {
    if (!apiResponse) return [];
    // Handle both direct array and .message wrapper
    if (Array.isArray(apiResponse)) return apiResponse;
    if (Array.isArray(apiResponse.message)) return apiResponse.message;
    return [];
  }, [apiResponse]);

  // Filter projects by search term
  const filteredProjects = useMemo(() => {
    if (!searchTerm.trim()) return projects;

    const lowerSearch = searchTerm.toLowerCase();
    return projects.filter(
      (project) =>
        project.project_name.toLowerCase().includes(lowerSearch) ||
        project.project.toLowerCase().includes(lowerSearch)
    );
  }, [projects, searchTerm]);

  // Handle card click - navigate to dedicated detail view
  const handleProjectClick = (projectId: string) => {
    navigate(`/critical-po-tracker/${projectId}`);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[400px]">
        <LoadingFallback />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6">
        <AlertDestructive error={error} />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => refetchList()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              PO Tracker
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Track critical PO release status across all projects
            </p>
          </div>
        </div>

        {/* Refresh button */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetchList()}
          className="w-fit"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search by project name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <span className="text-sm text-gray-500">
          {filteredProjects.length} of {projects.length} projects
        </span>
      </div>

      {/* Project Cards Grid */}
      {projects.length === 0 ? (
        // Empty state - no projects have Critical PO setup
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ClipboardCheck className="h-16 w-16 text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-700 mb-2">
            No Critical PO Tasks Found
          </h3>
          <p className="text-sm text-gray-500 max-w-md">
            No projects have been set up with Critical PO Tasks yet. Set up
            Critical PO Tasks from within a project&apos;s Critical PO tab.
          </p>
        </div>
      ) : filteredProjects.length === 0 ? (
        // No results for search
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="h-12 w-12 text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-700 mb-2">
            No matching projects
          </h3>
          <p className="text-sm text-gray-500">
            Try adjusting your search term
          </p>
        </div>
      ) : (
        // Project cards grid
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {filteredProjects.map((project) => (
            <CriticalPOProjectCard
              key={project.project}
              project={project}
              onClick={() => handleProjectClick(project.project)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default CriticalPOTrackerList;
