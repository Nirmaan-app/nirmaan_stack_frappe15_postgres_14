// The one place the Handover Documents screen talks to the server (ADR-0010 F2): method names,
// SWR keys and the typed reads. Components never call `api/hod/*` directly.

import {
  useFrappeFileUpload,
  useFrappeGetCall,
  useFrappePostCall,
} from "frappe-react-sdk";

import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

import type {
  HodPayload,
  HodRow,
  HodSignedCopy,
  HodSources,
  HodSystemLibrary,
} from "./types";

const API = "nirmaan_stack.api.hod";

export const HOD_METHODS = {
  getProjectHod: `${API}.project_hod.get_project_hod`,
  addSystems: `${API}.project_hod.add_systems`,
  removeSystem: `${API}.project_hod.remove_system`,
  updateRow: `${API}.project_hod.update_row`,
  getSystemLibrary: `${API}.project_hod.get_system_library`,
  getFromAppSources: `${API}.from_app.get_from_app_sources`,
  getHeaderRoles: `${API}.header_roles.get_header_roles`,
  setHeaderRoles: `${API}.header_roles.set_header_roles`,
  setSignedCopy: `${API}.package_files.set_signed_copy`,
  enqueueBinder: `${API}.binder.enqueue_binder`,
  jobStatus: `${API}.binder.get_job_status`,
} as const;

/** Realtime event the server publishes after any row change on a project. */
/** The "Download binder" button and its part of the Details guide. Hidden on 2026-09-23 while the
 *  binder was unproven; switched back ON 2026-09-24 (owner). Set it to false to hide it again --
 *  nothing else changes, the binder itself works either way. */
export const SHOW_BINDER_BUTTON = true;

export const HOD_ROWS_CHANGED_EVENT = "hod:rows_changed";

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

/** One of the six stakeholders a project's handover documents can be headed with. */
export interface HodHeaderRole {
  role: string;
  label: string;
  name: string;
  logo: string;
  /** False until the project's TDS Setting carries BOTH a name and a logo for it. */
  selectable: boolean;
}

export interface HodHeaderRoles {
  roles: HodHeaderRole[];
  /** What prints today: the pick, or every selectable role when nothing is picked. */
  selected: string[];
  /** The project's `Project TDS Setting`, so the dialog can send the user there. */
  tds_setting: string | null;
  order: string[];
}

export const useHeaderRoles = (projectId: string, enabled: boolean) => {
  const response = useFrappeGetCall<{ message: HodHeaderRoles }>(
    HOD_METHODS.getHeaderRoles,
    { project: projectId },
    enabled && projectId ? ["hod", "header-roles", projectId] : null,
  );
  useApiErrorLogger(response.error, {
    hook: "useHeaderRoles",
    api: "get_header_roles",
    feature: "handover-documents",
  });
  return { ...response, header: response.data?.message };
};

export const useSetHeaderRoles = () => {
  const call = useFrappePostCall<{ message: HodHeaderRoles }>(
    HOD_METHODS.setHeaderRoles,
  );
  return {
    setHeaderRoles: (project: string, roles: string[]) =>
      call.call({ project, roles: JSON.stringify(roles) }),
    saving: call.loading,
  };
};

export type HodRowPatch = Partial<
  Pick<HodRow, "status" | "remarks" | "form_data"> & { disabled: boolean }
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

/** A package's signed copy: a PDF or a scanned picture. */
export const SIGNED_COPY_ACCEPT = "application/pdf,image/png,image/jpeg";

/** Upload a package's signed copy (owner 2026-10-06) -- stored only, Download binder never reads it. The
 *  file is uploaded PRIVATE against the project's `Project HOD Setting` (named after the project, so the
 *  name is known before the setting exists), then `set_signed_copy` records it on the package's row,
 *  replacing any earlier one. */
export const useHodSignedCopy = () => {
  const { upload } = useFrappeFileUpload();
  const record = useFrappePostCall<{ message: HodSignedCopy }>(
    HOD_METHODS.setSignedCopy,
  );
  return {
    uploadSignedCopy: async (project: string, hodSystem: string, file: File) => {
      const res = await upload(file, {
        doctype: "Project HOD Setting",
        docname: project,
        isPrivate: true,
      });
      return record.call({
        project,
        hod_system: hodSystem,
        file_url: res.file_url,
      });
    },
  };
};
