import { useFrappePostCall, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";
import { captureApiError } from "@/utils/sentry/captureApiError";

const RENAME_ZONE_METHOD =
  "nirmaan_stack.api.projects.rename_project_zones.rename_zone_and_cascade";

export const useProjectTrackingSetupApi = () => {
  const updateDocResponse = useFrappeUpdateDoc();
  const renameZoneResponse = useFrappePostCall(RENAME_ZONE_METHOD);

  const saveProgressTrackingSetup = async (projectName: string, payload: Record<string, any>) => {
    try {
      return await updateDocResponse.updateDoc("Projects", projectName, payload);
    } catch (error) {
      captureApiError({
        hook: "useProjectTrackingSetupApi",
        api: "Save Progress Tracking Setup",
        feature: "projects-tab-work-report",
        doctype: "Projects",
        entity_id: projectName,
        error,
      });
      throw error;
    }
  };

  const updateProjectZones = async (
    projectName: string,
    zones: Array<{ name?: string; zone_name: string }>
  ) => {
    try {
      return await updateDocResponse.updateDoc("Projects", projectName, {
        project_zones: zones,
      });
    } catch (error) {
      captureApiError({
        hook: "useProjectTrackingSetupApi",
        api: "Update Project Zones",
        feature: "projects-tab-work-report",
        doctype: "Projects",
        entity_id: projectName,
        error,
      });
      throw error;
    }
  };

  const renameProjectZone = async (
    projectName: string,
    zoneDocName: string,
    oldZoneName: string,
    newZoneName: string
  ) => {
    try {
      return await renameZoneResponse.call({
        project_name: projectName,
        zone_doc_name: zoneDocName,
        old_zone_name: oldZoneName,
        new_zone_name: newZoneName,
      });
    } catch (error) {
      captureApiError({
        hook: "useProjectTrackingSetupApi",
        api: RENAME_ZONE_METHOD,
        feature: "projects-tab-work-report",
        entity_id: projectName,
        error,
      });
      throw error;
    }
  };

  useApiErrorLogger(updateDocResponse.error, {
    hook: "useProjectTrackingSetupApi",
    api: "Update Projects",
    feature: "projects-tab-work-report",
  });

  useApiErrorLogger(renameZoneResponse.error, {
    hook: "useProjectTrackingSetupApi",
    api: RENAME_ZONE_METHOD,
    feature: "projects-tab-work-report",
  });

  return {
    saveProgressTrackingSetup,
    updateProjectZones,
    renameProjectZone,
    updateDocLoading: updateDocResponse.loading,
    renameLoading: renameZoneResponse.loading,
  };
};
