/**
 * Facet options for the unified approval queue.
 *
 * ⚠️ WHY NOT THE SELF-FETCHING FACETS (`facetDoctype` + `meta.facet`).
 *
 * That path reads ONE doctype. This screen's rows come from a UNION of three, so
 * a facet fetched from `Project Payments` would offer no `Type` values at all,
 * and would list only the projects and vendors that appear on PAYMENTS — while
 * the table beside it shows expense rows from projects the filter cannot name.
 * A facet that cannot name what is on screen is worse than no facet.
 *
 * So facets come from `get_approval_queue_facets`, which groups over the same
 * union the table reads, under the same filters.
 */

import { useMemo } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import { APPROVAL_STATUS, TYPE_FILTER_VALUES, TYPE_LABEL } from "./approvalsTable.config";

const FACET_API =
  "nirmaan_stack.api.approvals.get_approval_queue.get_approval_queue_facets";

interface FacetResponse {
  message: {
    field: string;
    values: { value: string; count: number }[];
    blank_count: number;
  };
}

export interface FacetOptionMap {
  [columnId: string]: {
    title: string;
    options: { label: string; value: string }[];
    isLoading?: boolean;
  };
}

/** Closed sets — no round trip earns its keep for four values. */
const TYPE_OPTIONS = TYPE_FILTER_VALUES.map((k) => ({ label: TYPE_LABEL[k], value: k }));

const STATUS_OPTIONS = Object.values(APPROVAL_STATUS).map((s) => ({ label: s, value: s }));

export interface UseApprovalFacetsArgs {
  /** The tab's own filters, so counts reflect the list actually on screen. */
  filters: Array<[string, string, unknown]>;
  /** Id -> display name; the endpoint returns ids, the filter shows names. */
  projectLabels: Map<string, string>;
  vendorLabels: Map<string, string>;
  /** Whether the Status facet is meaningful (only on a mixed-status tab). */
  includeStatus?: boolean;
}

export function useApprovalFacets({
  filters,
  projectLabels,
  vendorLabels,
  includeStatus = false,
}: UseApprovalFacetsArgs): FacetOptionMap {
  const key = JSON.stringify(filters);

  const { data: projectData, isLoading: projectLoading } = useFrappeGetCall<FacetResponse>(
    FACET_API, { field: "project", filters: JSON.stringify(filters) }, `approval-facet-project-${key}`,
  );
  const { data: vendorData, isLoading: vendorLoading } = useFrappeGetCall<FacetResponse>(
    FACET_API, { field: "vendor", filters: JSON.stringify(filters) }, `approval-facet-vendor-${key}`,
  );

  return useMemo(() => {
    const map: FacetOptionMap = {
      // Keyed by the COLUMN ID, which is the server field `source_type`.
      source_type: { title: "Type", options: TYPE_OPTIONS },
      // A blank is a TRUE value here (a non-project expense has no project and no
      // vendor), but it cannot be expressed as a filter option, so those rows are
      // simply not reachable through these two facets. Deliberate: the Type
      // facet is how you isolate them.
      project: {
        title: "Project",
        isLoading: projectLoading,
        options: (projectData?.message?.values ?? []).map((v) => ({
          label: projectLabels.get(v.value) || v.value,
          value: v.value,
        })),
      },
      vendor: {
        title: "Vendor",
        isLoading: vendorLoading,
        options: (vendorData?.message?.values ?? []).map((v) => ({
          label: vendorLabels.get(v.value) || v.value,
          value: v.value,
        })),
      },
    };
    if (includeStatus) map.status = { title: "Status", options: STATUS_OPTIONS };
    return map;
  }, [projectData, vendorData, projectLoading, vendorLoading, projectLabels, vendorLabels, includeStatus]);
}
