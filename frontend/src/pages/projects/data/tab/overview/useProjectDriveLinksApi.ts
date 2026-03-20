import { useFrappeGetDoc, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";
import { captureApiError } from "@/utils/sentry/captureApiError";

export interface ProjectDriveLinkDetail {
  name: string;
  idx?: number;
  drive_name: string;
  drive_link: string;
}

interface ProjectDriveLinksDoc {
  name: string;
  project_name?: string;
  drive_links?: ProjectDriveLinkDetail[];
}

export const useProjectDriveLinksDoc = (projectId?: string) => {
  const response = useFrappeGetDoc<ProjectDriveLinksDoc>(
    "Projects",
    projectId,
    { enabled: !!projectId }
  );

  useApiErrorLogger(response.error, {
    hook: "useProjectDriveLinksDoc",
    api: "Projects Doc",
    feature: "projects-tab-overview",
    entity_id: projectId,
  });

  return response;
};

export const useProjectDriveLinksMutations = () => {
  const updateDocResponse = useFrappeUpdateDoc();

  const updateProjectDriveLinks = async (
    projectName: string,
    driveLinks: Array<Partial<ProjectDriveLinkDetail>>
  ) => {
    try {
      return await updateDocResponse.updateDoc("Projects", projectName, {
        drive_links: driveLinks,
      });
    } catch (error) {
      captureApiError({
        hook: "useProjectDriveLinksMutations",
        api: "Update Project Drive Links",
        feature: "projects-tab-overview",
        doctype: "Projects",
        entity_id: projectName,
        error,
      });
      throw error;
    }
  };

  useApiErrorLogger(updateDocResponse.error, {
    hook: "useProjectDriveLinksMutations",
    api: "Update Projects",
    feature: "projects-tab-overview",
  });

  return {
    updateProjectDriveLinks,
    updateLoading: updateDocResponse.loading,
  };
};
