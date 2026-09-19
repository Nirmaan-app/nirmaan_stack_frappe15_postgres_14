// src/pages/outflow-import/refundDocumentView.ts

/**
 * Filtering the vendor refund form's PO / WO lists: a search on the document number in the first
 * header, and a facet each on Project and Status.
 *
 * PURE MODULE -- no React, no fetching, `f(documents, filters) -> documents`, so it is unit-testable
 * without a DOM (this repo has none; see `frontend/CLAUDE.md`).
 *
 * ⚠️ THE FACETS LIST ONLY WHAT IS PRESENT: they are built from the vendor's list the server already
 * sent, so every option matches at least one row. Filter state is ids (the project's id, the status
 * text), never labels.
 *
 * ⚠️ AN EMPTY SELECTION IS A PASS-THROUGH, NEVER "HIDE EVERYTHING" -- the same rule as
 * `recordPickerView`. AND across axes, OR within an axis.
 *
 * ⚠️ FILTERING ONLY HIDES ROWS. A ticked document that a filter hides stays ticked, and stays in
 * the Selected section -- a filter must never change what the refund is recorded against.
 */

import { BLANK_FACET_ID, NO_PROJECT_LABEL, type FacetOption } from "./recordPickerView";

/** What a refund list row needs for filtering -- a subset of the dialog's `RefundDocument`. */
export interface RefundDocumentFilterable {
    name: string;
    status?: string;
    project?: string;
    project_name?: string;
}

export interface RefundDocumentFilters {
    /** Free text against the PO / WO number, token-matched. */
    search: string;
    /** Project ids, or `BLANK_FACET_ID` for "no project". */
    projects: ReadonlySet<string>;
    /** Status texts, or `BLANK_FACET_ID` for "no status". */
    statuses: ReadonlySet<string>;
}

export const NO_STATUS_LABEL = "(no status)";

const byLabelBlanksLast = (a: FacetOption, b: FacetOption) =>
    a.id === BLANK_FACET_ID ? 1 : b.id === BLANK_FACET_ID ? -1 : a.label.localeCompare(b.label);

/** The distinct projects and statuses on the list, each sorted by label, blanks last. */
export const refundDocumentFacets = (
    documents: readonly RefundDocumentFilterable[]
): { projects: FacetOption[]; statuses: FacetOption[] } => {
    const projects = new Map<string, string>();
    const statuses = new Map<string, string>();
    for (const document of documents) {
        const project = document.project || BLANK_FACET_ID;
        projects.set(
            project,
            project === BLANK_FACET_ID ? NO_PROJECT_LABEL : document.project_name || project
        );
        const status = document.status || BLANK_FACET_ID;
        statuses.set(status, status === BLANK_FACET_ID ? NO_STATUS_LABEL : status);
    }
    const toOptions = (map: Map<string, string>) =>
        [...map].map(([id, label]) => ({ id, label })).sort(byLabelBlanksLast);
    return { projects: toOptions(projects), statuses: toOptions(statuses) };
};

/** Whether any filter is narrowing the list. */
export const refundDocumentFiltersActive = (filters: RefundDocumentFilters): boolean =>
    Boolean(filters.search.trim()) || filters.projects.size > 0 || filters.statuses.size > 0;

/** The documents the filters let through, in the order the server sent them. */
export const filterRefundDocuments = <T extends RefundDocumentFilterable>(
    documents: readonly T[],
    filters: RefundDocumentFilters
): T[] => {
    const tokens = filters.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return documents.filter((document) => {
        if (tokens.length) {
            const name = document.name.toLowerCase();
            if (!tokens.every((token) => name.includes(token))) return false;
        }
        if (filters.projects.size && !filters.projects.has(document.project || BLANK_FACET_ID)) {
            return false;
        }
        if (filters.statuses.size && !filters.statuses.has(document.status || BLANK_FACET_ID)) {
            return false;
        }
        return true;
    });
};
