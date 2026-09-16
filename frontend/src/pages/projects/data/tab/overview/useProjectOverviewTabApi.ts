import { useFrappeCreateDoc, useFrappeGetDoc, useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";
import { captureApiError } from "@/utils/sentry/captureApiError";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";

const overviewTabKeys = {
  projectInflows: (projectName: string) => ["project-tab", "overview", "inflows", projectName] as const,
  projectType: (projectTypeId?: string) => ["project-tab", "overview", "projectType", projectTypeId] as const,
  projectAssignees: (projectName: string) => ["project-tab", "overview", "assignees", projectName] as const,
};

export const useProjectOverviewApi = (projectName?: string, projectTypeId?: string) => {
  const createDocResponse = useFrappeCreateDoc();
  // Admin-only on the server (`api/projects/assignees.py`); the card only shows the ✕ to
  // Admin (`canRemoveProjectAssignee`).
  const removeAssigneeResponse = useFrappePostCall(
    "nirmaan_stack.api.projects.assignees.remove_project_assignee"
  );

  const projectInflowsResponse = useFrappeGetDocList<ProjectInflows>(
    "Project Inflows",
    {
      fields: ["amount", "name"],
      filters: projectName ? [["project", "=", projectName]] : [],
      limit: 0,
    },
    projectName ? overviewTabKeys.projectInflows(projectName) : null
  );

  const projectTypeResponse = useFrappeGetDoc(
    "Project Types",
    projectTypeId,
    projectTypeId ? overviewTabKeys.projectType(projectTypeId) : null
  );

  const projectAssigneesResponse = useFrappeGetDocList(
    "Nirmaan User Permissions",
    {
      fields: ["user"],
      limit: 0,
      filters: [
        ["for_value", "=", `${projectName}`],
        ["allow", "=", "Projects"],
      ],
    },
    projectName ? overviewTabKeys.projectAssignees(projectName) : null
  );

  const createUserPermission = async (user: string, forValue: string) => {
    try {
      return await createDocResponse.createDoc("User Permission", {
        user,
        allow: "Projects",
        for_value: forValue,
      });
    } catch (error) {
      captureApiError({
        hook: "useProjectOverviewApi",
        api: "Create User Permission",
        feature: "projects-tab-overview",
        doctype: "User Permission",
        entity_id: forValue,
        error,
      });
      throw error;
    }
  };

  /** Take `user` off `project` — deletes the assignment and the card's mirror row. */
  const removeProjectAssignee = async (user: string, project: string) => {
    try {
      return await removeAssigneeResponse.call({ user, project });
    } catch (error) {
      captureApiError({
        hook: "useProjectOverviewApi",
        api: "Remove Project Assignee",
        feature: "projects-tab-overview",
        doctype: "User Permission",
        entity_id: project,
        error,
      });
      throw error;
    }
  };

  useApiErrorLogger(projectInflowsResponse.error, {
    hook: "useProjectOverviewApi",
    api: "Project Inflows List",
    feature: "projects-tab-overview",
    entity_id: projectName,
  });

  useApiErrorLogger(projectTypeResponse.error, {
    hook: "useProjectOverviewApi",
    api: "Project Types Doc",
    feature: "projects-tab-overview",
    entity_id: projectTypeId,
  });

  useApiErrorLogger(projectAssigneesResponse.error, {
    hook: "useProjectOverviewApi",
    api: "Nirmaan User Permissions List",
    feature: "projects-tab-overview",
    entity_id: projectName,
  });

  return {
    createUserPermission,
    createDocLoading: createDocResponse.loading,
    removeProjectAssignee,
    removeAssigneeLoading: removeAssigneeResponse.loading,
    projectInflowsResponse,
    projectTypeResponse,
    projectAssigneesResponse,
  };
};
