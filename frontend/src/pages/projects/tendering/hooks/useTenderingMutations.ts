import { useFrappePostCall } from "frappe-react-sdk";
import { captureApiError } from "@/utils/sentry/captureApiError";

export interface CreateTenderingPayload {
  project_name: string;
  project_state: string;
  project_city: string;
  customer?: string;
}

export interface CreateTenderingResponse {
  status: number;
  message?: string;
  project_name?: string;
  error?: string;
}

/**
 * Wraps the `create_tendering_project` whitelisted API.
 *
 * Returns the backend payload shape:
 *   { status, message, project_name } on success
 *   { status: 400, error } on failure
 */
export const useCreateTenderingProject = () => {
  const { call, loading, error } = useFrappePostCall<{
    message: CreateTenderingResponse;
  }>("nirmaan_stack.api.projects.tendering.create_tendering_project");

  const createTenderingProject = async (payload: CreateTenderingPayload) => {
    try {
      return await call(payload);
    } catch (err: any) {
      captureApiError({
        error: err,
        hook: "useCreateTenderingProject",
        api: "create_tendering_project",
        feature: "tendering",
      });
      throw err;
    }
  };

  return { createTenderingProject, loading, error };
};

export interface UpdateTenderingPayload {
  /** The frozen Projects docname (`{city}-PROJ-#####`). */
  project_name: string;
  /** New human-readable title (the `project_name` field on the doc). */
  project_title?: string;
  project_state?: string;
  project_city?: string;
  /** Empty string clears the link; undefined leaves it untouched. */
  customer?: string;
}

export interface MutateTenderingResponse {
  status: number;
  message?: string;
  project_name?: string;
  error?: string;
}

/**
 * Wraps the `update_tendering_project` whitelisted API.
 *
 * Edits ONLY the four stub fields (title/state/city/customer). The backend
 * rejects the call unless the project is currently `status = "Tendering"`,
 * and never changes the frozen docname even when the City is edited.
 */
export const useUpdateTenderingProject = () => {
  const { call, loading, error } = useFrappePostCall<{
    message: MutateTenderingResponse;
  }>("nirmaan_stack.api.projects.tendering.update_tendering_project");

  const updateTenderingProject = async (payload: UpdateTenderingPayload) => {
    try {
      return await call(payload);
    } catch (err: any) {
      captureApiError({
        error: err,
        hook: "useUpdateTenderingProject",
        api: "update_tendering_project",
        feature: "tendering",
      });
      throw err;
    }
  };

  return { updateTenderingProject, loading, error };
};

/**
 * Wraps the `delete_tendering_project` whitelisted API.
 *
 * Deletes a stub outright. The backend refuses to delete anything whose
 * `status` is not `"Tendering"`, so real/awarded projects are protected.
 */
export const useDeleteTenderingProject = () => {
  const { call, loading, error } = useFrappePostCall<{
    message: MutateTenderingResponse;
  }>("nirmaan_stack.api.projects.tendering.delete_tendering_project");

  const deleteTenderingProject = async (project_name: string) => {
    try {
      return await call({ project_name });
    } catch (err: any) {
      captureApiError({
        error: err,
        hook: "useDeleteTenderingProject",
        api: "delete_tendering_project",
        feature: "tendering",
      });
      throw err;
    }
  };

  return { deleteTenderingProject, loading, error };
};
