import { useFrappeGetDocList } from "frappe-react-sdk";

import { ProjectSnagBatch } from "../types";
import { SNAG_BATCH_DOCTYPE } from "../config/snagTable.config";

export interface UseSnagBatchesResult {
  batches: ProjectSnagBatch[];
  isLoading: boolean;
  error: Error | null;
  mutate: () => void;
}

/**
 * The project's import batches, newest first. Read straight off the doctype —
 * there is no batch-list endpoint and none is needed (plain list read).
 */
export function useSnagBatches(projectId?: string): UseSnagBatchesResult {
  const { data, isLoading, error, mutate } =
    useFrappeGetDocList<ProjectSnagBatch>(
      SNAG_BATCH_DOCTYPE,
      {
        fields: [
          "name",
          "project",
          "batch_name",
          "source_sheet",
          "source_file",
          "uploaded_by",
          "uploaded_on",
          "snag_count",
          "column_mapping",
        ],
        filters: projectId ? [["project", "=", projectId]] : undefined,
        orderBy: { field: "creation", order: "desc" },
        limit: 0,
      },
      // swrKey — `null` skips the fetch entirely until we have a project.
      projectId ? `snag_batches_${projectId}` : null
    );

  return {
    batches: (data as ProjectSnagBatch[] | undefined) ?? [],
    isLoading: !!projectId && isLoading,
    // frappe-js-sdk ships its OWN `Error` shape (message/httpStatus/exception),
    // structurally distinct from the DOM `Error`. Normalised through `unknown`
    // so callers get one type — same cast `useServerDataTable` makes.
    error: (error as unknown as Error) ?? null,
    mutate,
  };
}
