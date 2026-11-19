import { useFrappeGetDocList } from "@/lib/frappe";

import type { PORevisionsDocType } from "@/types/doctypes/PORevisions";
import { PO_REVISION_DOCTYPE } from "@/pages/PORevision/data/poRevision.constants";

export interface POHeaderDate {
  label: "PO Date" | "Revised PO Date";
  /** The raw date to format; undefined when the PO has none. */
  date?: string | null;
}

/**
 * The date in a PO's header (owner, 2026-11-19): a PO that has an approved revision shows
 * "Revised PO Date" with the latest revision's approval date; any other PO shows "PO Date"
 * with its creation date. The "PO Orders" print formats follow the same rule.
 */
export const poHeaderDate = (
  creation: string | null | undefined,
  latestRevisionApproval: string | null | undefined
): POHeaderDate =>
  latestRevisionApproval
    ? { label: "Revised PO Date", date: latestRevisionApproval }
    : { label: "PO Date", date: creation };

/** The latest of these Frappe date-times ("YYYY-MM-DD HH:MM:SS...", so text order is time order). */
export const latestDate = (dates: ReadonlyArray<string | null | undefined> | undefined): string | undefined =>
  (dates ?? []).reduce<string | undefined>((latest, d) => (d && (!latest || d > latest) ? d : latest), undefined);

/** `poHeaderDate` for a PO, reading the approval dates of its approved revisions. */
export const usePOHeaderDate = (poName: string | undefined, creation: string | null | undefined): POHeaderDate => {
  // Every approved revision (a handful at most), not "latest first, limit 1": Postgres sorts an
  // empty date FIRST in a descending order, and Frappe's "is set" filter fails on a Datetime.
  const { data } = useFrappeGetDocList<PORevisionsDocType>(
    PO_REVISION_DOCTYPE,
    {
      fields: ["approval_date"],
      filters: [
        ["revised_po", "=", poName ?? ""],
        ["status", "=", "Approved"],
      ],
      limit: 0,
    },
    poName ? `po-header-date-${poName}` : null
  );
  return poHeaderDate(creation, latestDate(data?.map((r) => r.approval_date)));
};
