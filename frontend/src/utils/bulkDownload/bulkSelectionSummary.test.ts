import { describe, expect, it } from "vitest";
import { dateSpan, describeDateFilter, describeFilters, selectionBlocks, sumSelected } from "./bulkSelectionSummary";

const FACETS = { project: "Project", vendor: "Vendor", status: "Status" };
const DATES = { creation: "Created On" };

describe("describeDateFilter — every operator the date filter offers", () => {
    it("reads one day, a range, on-or-before, on-or-after and a timespan", () => {
        expect(describeDateFilter({ operator: "Is", value: "2025-06-02" })).toBe("02-Jun-2025");
        expect(describeDateFilter({ operator: "Between", value: ["2025-04-01", "2025-06-30"] })).toBe("01-Apr-2025 → 30-Jun-2025");
        expect(describeDateFilter({ operator: "<=", value: "2025-06-30" })).toBe("on or before 30-Jun-2025");
        expect(describeDateFilter({ operator: ">=", value: "2025-04-01" })).toBe("on or after 01-Apr-2025");
        expect(describeDateFilter({ operator: "Timespan", value: "last 30 days" })).toBe("Last 30 days");
    });

    it("never shifts the day of a date that carries a time", () => {
        expect(describeDateFilter({ operator: "Is", value: "2025-06-02 23:59:00" })).toBe("02-Jun-2025");
    });

    it("says nothing for a filter that filters nothing", () => {
        for (const f of [undefined, null, {}, { operator: "Is", value: null }, { operator: "Is", value: "" }, { operator: "Between", value: ["2025-04-01"] }]) {
            expect(describeDateFilter(f), JSON.stringify(f)).toBeNull();
        }
    });
});

describe("describeFilters — line 2", () => {
    it("reads 'None' when nothing filters the table (no 'Any date': dates of the ticked rows are line 1's)", () => {
        expect(describeFilters([], "", FACETS, DATES).map((p) => p.text)).toEqual(["None"]);
        expect(describeFilters([{ id: "project", value: [] }], "  ", FACETS, DATES).map((p) => p.text)).toEqual(["None"]);
    });

    it("lists facets in column order, then the date, then the search", () => {
        const parts = describeFilters(
            [
                { id: "creation", value: { operator: "Between", value: ["2025-04-01", "2025-06-30"] } },
                { id: "vendor", value: ["ACE Electricals"] },
                { id: "project", value: ["Light Rock", "Mind Studio"] },
            ],
            "PO/001",
            FACETS,
            DATES,
        );
        expect(parts.map((p) => p.text)).toEqual([
            "Project: Light Rock, Mind Studio",
            "Vendor: ACE Electricals",
            "Created On: 01-Apr-2025 → 30-Jun-2025",
            'Search: "PO/001"',
        ]);
    });

    it("shows the first two picks and '+N more', keeping the whole list for the hover", () => {
        const [part] = describeFilters([{ id: "project", value: ["A", "B", "C", "D", "E"] }], "", FACETS, {});
        expect(part.text).toBe("Project: A, B +3 more");
        expect(part.full).toBe("Project: A, B, C, D, E");
    });

    it("lists only what the user set: a facet alone adds no date words", () => {
        expect(describeFilters([{ id: "status", value: ["Delivered"] }], "", FACETS, DATES).map((p) => p.text)).toEqual(["Status: Delivered"]);
    });

    it("ignores a filter on a column that is not a facet or date column of this table", () => {
        expect(describeFilters([{ id: "unknown", value: ["x"] }], "", FACETS, DATES).map((p) => p.text)).toEqual(["None"]);
    });
});

describe("sumSelected / selectionBlocks — line 1, every value with its own label", () => {
    const rows = [
        { name: "PO-1", amount: 1000, total: "1180" },
        { name: "PO-2", amount: 2000.6, total: 2360.7 },
        { name: "PO-3", amount: 5000, total: 5900 },
        { name: "PO-4", amount: undefined, total: "" },
    ];
    const amounts = [
        { label: "Excl. GST", get: (r: (typeof rows)[number]) => r.amount },
        { label: "Incl. GST", get: (r: (typeof rows)[number]) => r.total },
    ];
    const DATES = { title: "Created On", span: "02-Jan-2025 → 07-Jul-2025" };

    it("adds only the ticked rows; a blank amount counts as 0 and a text amount is read as a number", () => {
        expect(sumSelected(rows, ["PO-1", "PO-2", "PO-4"], (r) => r.amount)).toBeCloseTo(3000.6);
        expect(sumSelected(rows, ["PO-1", "PO-2", "PO-4"], (r) => r.total)).toBeCloseTo(3540.7);
        expect(sumSelected(rows, [], (r) => r.amount)).toBe(0);
        expect(sumSelected(rows, ["NOT-A-ROW"], (r) => r.amount)).toBe(0);
    });

    it("reads Selected │ Date range (<column>) │ one block per amount, each total rounded to the rupee", () => {
        expect(selectionBlocks(rows, ["PO-1", "PO-2"], 318, amounts, DATES)).toEqual([
            { label: "Selected", value: "2 of 318" },
            { label: "Date range (Created On)", value: "02-Jan-2025 → 07-Jul-2025" },
            { label: "Excl. GST", value: "₹3,001" },
            { label: "Incl. GST", value: "₹3,541" },
        ]);
    });

    it("shows '—' for the date range and ₹0 when nothing is ticked", () => {
        expect(selectionBlocks(rows, [], 4, amounts.slice(0, 1), { title: "Paid On", span: null })).toEqual([
            { label: "Selected", value: "0 of 4" },
            { label: "Date range (Paid On)", value: "—" },
            { label: "Excl. GST", value: "₹0" },
        ]);
    });

    it("has no money block for a type with no amount (DN, DC, MIR, MTC), and no date block without a date column", () => {
        expect(selectionBlocks(rows, ["PO-1"], 1250, [], { title: "DC Date", span: "02-Jun-2025" }).map((b) => b.label))
            .toEqual(["Selected", "Date range (DC Date)"]);
        expect(selectionBlocks(rows, ["PO-1"], 1250)).toEqual([{ label: "Selected", value: "1 of 1,250" }]);
    });
});

describe("the ticked rows' date range — what is selected, not the date filter", () => {
    it("reads earliest → latest, skipping blank and unreadable dates; one day reads once", () => {
        expect(dateSpan(["2025-06-30 10:00:00", "2025-04-02", "", null, "n/a", "2025-05-15 09:00:00"])).toBe("02-Apr-2025 → 30-Jun-2025");
        expect(dateSpan(["2025-06-02", "2025-06-02 18:30:00"])).toBe("02-Jun-2025");
        expect(dateSpan([])).toBeNull();
        expect(dateSpan(["", undefined])).toBeNull();
    });
});
