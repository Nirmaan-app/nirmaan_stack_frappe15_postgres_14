import React, { useState, useMemo } from "react";
import { useFrappeGetDocList, useFrappeDeleteDoc, useFrappeDocumentEventListener } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { CriticalPOTask } from "@/types/NirmaanStack/CriticalPOTasks";
import { Projects } from "@/types/NirmaanStack/Projects";
import { NoCriticalPOTasksView } from "./NoCriticalPOTasksView";
import { CriticalPOTasksList } from "./CriticalPOTasksList";
import { ManageSetupDialog } from "./components/ManageSetupDialog";
import { formatDate } from "@/utils/FormatDate";
import { Calendar } from "lucide-react";
import { useUserData } from "@/hooks/useUserData";

// Roles that can manage setup (Add/Delete tasks configuration)
const MANAGE_SETUP_ROLES = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
  "Nirmaan Project Lead Profile",
];

// Roles that can edit tasks and delete associated POs
const EDIT_ROLES = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
  "Nirmaan Project Lead Profile",
  "Nirmaan Procurement Executive Profile",
];

interface CriticalPOTasksTabProps {
  projectId: string;
  projectData: Projects;
  onTasksCreated?: () => void;
}

export const CriticalPOTasksTab: React.FC<CriticalPOTasksTabProps> = ({
  projectId,
  projectData,
  onTasksCreated,
}) => {
  const { role } = useUserData();
  const [manageSetupOpen, setManageSetupOpen] = useState(false);

  // Role-based access controls
  const canManageSetup = useMemo(() => MANAGE_SETUP_ROLES.includes(role), [role]);
  const canEdit = useMemo(() => EDIT_ROLES.includes(role), [role]);

  // Fetch all Critical PO Tasks for this project
  const {
    data: tasks,
    isLoading,
    error,
    mutate,
  } = useFrappeGetDocList<CriticalPOTask>("Critical PO Tasks", {
    fields: [
      "name",
      "project",
      "critical_po_category",
      "project_name",
      "item_name",
      "sub_category",
      "po_release_date",
      "status",
      "associated_pos",
      "revised_date",
      "remarks",
    ],
    filters: [["project", "=", projectId]],
    limit: 0,
    orderBy: { field: "po_release_date", order: "asc" },
  });

  const hasTasks = tasks && tasks.length > 0;

  // Listen for project document updates (e.g., project_start_date changes)
  // When project is updated, refetch Critical PO Tasks as deadlines may have been recalculated
  useFrappeDocumentEventListener("Projects", projectId, () => {
    mutate();
  });

  const handleTasksCreated = () => {
    mutate();
    if (onTasksCreated) {
      onTasksCreated();
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <TailSpin width={40} height={40} color="#dc2626" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-red-600 border border-red-200 rounded-md bg-red-50">
        Error loading Critical PO Tasks: {error.message}
      </div>
    );
  }

  return (
    <>
      {hasTasks ? (
        <div className="space-y-4">
          {/* Project Start Date Info */}
          {projectData.project_start_date && (
            <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-md">
              <Calendar className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-900">Project Start Date:</span>
              <span className="text-sm text-blue-700 font-semibold">
                {formatDate(projectData.project_start_date)}
              </span>
            </div>
          )}

          <CriticalPOTasksList
            tasks={tasks}
            projectId={projectId}
            mutate={mutate}
            onManageSetup={canManageSetup ? () => setManageSetupOpen(true) : undefined}
            canEdit={canEdit}
          />
        </div>
      ) : (
        <NoCriticalPOTasksView
          projectId={projectId}
          projectName={projectData.project_name}
          projectStartDate={projectData.project_start_date}
          onTasksCreated={handleTasksCreated}
        />
      )}

      {/* Manage Setup Dialog - Only for roles with manage setup permission */}
      {hasTasks && canManageSetup && (
        <ManageSetupDialog
          open={manageSetupOpen}
          onOpenChange={setManageSetupOpen}
          projectId={projectId}
          projectName={projectData.project_name}
          projectStartDate={projectData.project_start_date}
          existingTasks={tasks || []}
          onTasksUpdated={handleTasksCreated}
        />
      )}
    </>
  );
};
