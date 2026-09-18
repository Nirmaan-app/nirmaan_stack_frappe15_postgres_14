import { describe, expect, it } from "vitest";

import { BLANK_FACET_ID, NO_PROJECT_LABEL } from "./recordPickerView";
import {
    NO_STATUS_LABEL,
    filterRefundDocuments,
    refundDocumentFacets,
    refundDocumentFiltersActive,
    type RefundDocumentFilters,
} from "./refundDocumentView";

const DOCS = [
    { name: "PO/052/00123/25-26", status: "Delivered", project: "PROJ-1", project_name: "Alpha Tower" },
    { name: "PO/052/00456/25-26", status: "Partially Delivered", project: "PROJ-2", project_name: "Beta Mall" },
    { name: "PO/077/00789/25-26", status: "Delivered", project: "PROJ-2", project_name: "Beta Mall" },
    { name: "PO/077/00999/25-26", status: "", project: "" },
];

const NONE: RefundDocumentFilters = { search: "", projects: new Set(), statuses: new Set() };
const names = (docs: { name: string }[]) => docs.map((d) => d.name);

describe("refundDocumentFacets", () => {
    it("lists only the projects and statuses present, by label, blanks last", () => {
        const { projects, statuses } = refundDocumentFacets(DOCS);
        expect(projects).toEqual([
            { id: "PROJ-1", label: "Alpha Tower" },
            { id: "PROJ-2", label: "Beta Mall" },
            { id: BLANK_FACET_ID, label: NO_PROJECT_LABEL },
        ]);
        expect(statuses).toEqual([
            { id: "Delivered", label: "Delivered" },
            { id: "Partially Delivered", label: "Partially Delivered" },
            { id: BLANK_FACET_ID, label: NO_STATUS_LABEL },
        ]);
    });

    it("falls back to the project id when the name is missing", () => {
        expect(refundDocumentFacets([{ name: "PO/1", project: "PROJ-9" }]).projects).toEqual([
            { id: "PROJ-9", label: "PROJ-9" },
        ]);
    });
});

describe("filterRefundDocuments", () => {
    it("passes everything through when nothing is set", () => {
        expect(names(filterRefundDocuments(DOCS, NONE))).toEqual(names(DOCS));
        expect(refundDocumentFiltersActive(NONE)).toBe(false);
    });

    it("searches the document number, case-insensitive, every token must match", () => {
        expect(names(filterRefundDocuments(DOCS, { ...NONE, search: "00456" }))).toEqual([
            "PO/052/00456/25-26",
        ]);
        expect(names(filterRefundDocuments(DOCS, { ...NONE, search: "po/077 999" }))).toEqual([
            "PO/077/00999/25-26",
        ]);
        expect(filterRefundDocuments(DOCS, { ...NONE, search: "Beta" })).toEqual([]);
    });

    it("ORs within a facet and ANDs across facets and the search", () => {
        const both = { ...NONE, projects: new Set(["PROJ-1", "PROJ-2"]) };
        expect(filterRefundDocuments(DOCS, both)).toHaveLength(3);

        const narrowed = { ...both, statuses: new Set(["Delivered"]), search: "077" };
        expect(names(filterRefundDocuments(DOCS, narrowed))).toEqual(["PO/077/00789/25-26"]);
        expect(refundDocumentFiltersActive(narrowed)).toBe(true);
    });

    it("reaches the rows with no project or no status through the blank option", () => {
        const blanks = { ...NONE, projects: new Set([BLANK_FACET_ID]), statuses: new Set([BLANK_FACET_ID]) };
        expect(names(filterRefundDocuments(DOCS, blanks))).toEqual(["PO/077/00999/25-26"]);
    });
});
