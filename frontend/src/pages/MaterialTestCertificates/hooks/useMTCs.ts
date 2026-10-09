import { useFrappeGetCall } from "frappe-react-sdk";

import type {
  MaterialTestCertificate,
  MTCProjectsResponse,
} from "@/types/NirmaanStack/MaterialTestCertificate";

const API = "nirmaan_stack.api.material_test_certificates.mtc_api";

/**
 * Stable SWR keys. The PO page header count and the MTC card both read `mtcPoKey`, so
 * they share one fetch and one `mutate`.
 */
export const mtcPoKey = (po: string) => `mtc:po:${po}`;
export const mtcProjectKey = (project: string) => `mtc:project:${project}`;
export const MTC_PROJECTS_KEY = "mtc:projects";

const OPTIONS = { revalidateOnFocus: false };

/** MTCs of one PO, newest first. */
export const useMTCsForPO = (po?: string | null) => {
  const res = useFrappeGetCall<{ message: MaterialTestCertificate[] }>(
    `${API}.get_mtcs`,
    po ? { procurement_order: po } : undefined,
    po ? mtcPoKey(po) : null,
    OPTIONS
  );
  return { ...res, mtcs: res.data?.message };
};

/** MTCs of one project, newest first (the MTC list page). */
export const useMTCsForProject = (project?: string | null) => {
  const res = useFrappeGetCall<{ message: MaterialTestCertificate[] }>(
    `${API}.get_mtcs`,
    project ? { project } : undefined,
    project ? mtcProjectKey(project) : null,
    OPTIONS
  );
  return { ...res, mtcs: res.data?.message };
};

/** Projects the user may see on the MTC list page, with their MTC counts. */
export const useMTCProjects = (enabled = true) => {
  const res = useFrappeGetCall<{ message: MTCProjectsResponse }>(
    `${API}.get_mtc_projects`,
    undefined,
    enabled ? MTC_PROJECTS_KEY : null,
    OPTIONS
  );
  return { ...res, result: res.data?.message };
};
