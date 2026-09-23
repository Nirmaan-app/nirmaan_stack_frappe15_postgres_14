// The one place the Handover Documents screen talks to the server (ADR-0010 F2): method names,
// SWR keys and the typed reads. Components never call `api/hod/*` directly.

import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";

import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

import type { HodPayload, HodRow, HodSources, HodSystemLibrary } from "./types";

const API = "nirmaan_stack.api.hod";

export const HOD_METHODS = {
  getProjectHod: `${API}.project_hod.get_project_hod`,
  addSystems: `${API}.project_hod.add_systems`,
  removeSystem: `${API}.project_hod.remove_system`,
  updateRow: `${API}.project_hod.update_row`,
  getSystemLibrary: `${API}.project_hod.get_system_library`,
  getFromAppSources: `${API}.from_app.get_from_app_sources`,
  enqueueBinder: `${API}.binder.enqueue_binder`,
  jobStatus: `${API}.binder.get_job_status`,
} as const;

/** Realtime event the server publishes after any row change on a project. */
/** Owner 2026-09-23: the binder works, but it is hidden on the screen for now. Set it back to true to
 *  bring back the "Download binder" button and its part of the Details guide; nothing else changes. */
export const SHOW_BINDER_BUTTON = false;

export const HOD_ROWS_CHANGED_EVENT = "hod:rows_changed";

export const HOD_DOCTYPE = "Project HOD Document";
export const HOD_PRINT_DOCUMENT = "HOD Document";
export const HOD_PRINT_CHECKLIST = "HOD Checklist";

export const hodProjectKey = (projectId: string) =>
  ["hod", "project", projectId] as const;

export const useProjectHod = (projectId: string) => {
  const response = useFrappeGetCall<{ message: HodPayload }>(
    HOD_METHODS.getProjectHod,
    { project: projectId },
    projectId ? hodProjectKey(projectId) : null,
  );
  useApiErrorLogger(response.error, {
    hook: "useProjectHod",
    api: "get_project_hod",
    feature: "handover-documents",
  });
  return { ...response, payload: response.data?.message };
};

export const useSystemLibrary = (
  projectId: string,
  hodSystem: string,
  enabled: boolean,
) => {
  const response = useFrappeGetCall<{ message: HodSystemLibrary }>(
    HOD_METHODS.getSystemLibrary,
    { project: projectId, hod_system: hodSystem },
    enabled ? ["hod", "library", projectId, hodSystem] : null,
  );
  useApiErrorLogger(response.error, {
    hook: "useSystemLibrary",
    api: "get_system_library",
    feature: "handover-documents",
  });
  return { ...response, library: response.data?.message };
};

export const useFromAppSources = (
  projectId: string,
  hodSystem: string,
  document: string,
  enabled: boolean,
) => {
  const response = useFrappeGetCall<{ message: HodSources }>(
    HOD_METHODS.getFromAppSources,
    { project: projectId, hod_system: hodSystem, document },
    enabled ? ["hod", "sources", projectId, hodSystem, document] : null,
  );
  useApiErrorLogger(response.error, {
    hook: "useFromAppSources",
    api: "get_from_app_sources",
    feature: "handover-documents",
  });
  return { ...response, sources: response.data?.message };
};

export type HodRowPatch = Partial<
  Pick<HodRow, "remarks" | "attachment" | "form_data"> & { disabled: boolean }
>;

/** Every HOD write. Each returns the server's answer; the caller refreshes the project payload. */
export const useHodMutations = () => {
  const add = useFrappePostCall<{ message: HodPayload }>(
    HOD_METHODS.addSystems,
  );
  const remove = useFrappePostCall<{ message: HodPayload }>(
    HOD_METHODS.removeSystem,
  );
  const update = useFrappePostCall<{ message: HodRow }>(HOD_METHODS.updateRow);

  return {
    /** All or nothing: every chosen system gets its 16 rows in one save. */
    addSystems: (project: string, hodSystems: string[]) =>
      add.call({ project, hod_systems: JSON.stringify(hodSystems) }),
    /** `force` = the user confirmed that the system's entries are deleted with it. */
    removeSystem: (project: string, hodSystem: string, force = false) =>
      remove.call({ project, hod_system: hodSystem, force: force ? 1 : 0 }),
    updateRow: (name: string, patch: HodRowPatch) =>
      update.call({ name, patch: JSON.stringify(patch) }),
    busy: add.loading || remove.loading || update.loading,
  };
};
