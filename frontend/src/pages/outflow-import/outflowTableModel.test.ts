import { describe, expect, it } from "vitest";

import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";
import {
    DEFAULT_HIDDEN_COLUMNS,
    OUTFLOW_COLUMNS,
    activeFilterCount,
    amountVerdict,
    countDecided,
    decidedRows,
    decisionOrigin,
    facetValues,
    highlightSegments,
    isConfirmable,
    matchesQuery,
    orderBySuggestion,
    passesFilters,
    rowsForTab,
    seedDecisions,
    suggestedDecision,
    tabCounts,
    tabForStatus,
    visibleRows,
    type RowDecision,
} from "./outflowTableModel";

/**
 * The batch screen's model (slice V4).
 *
 * ⚠️ WHAT THIS SUITE CANNOT REACH, stated so nobody mistakes it for coverage of the screen: there
 * is no DOM environment in this repository, so the table, the decision dialog and the selection
 * behaviour are React semantics and are structurally untestable here. This file covers the part
 * that is NOT a React semantic. The screen itself is verified by a live browser walk -- the method
 * that found five real defects in the prototype that a green suite could never have seen.
 */

const row = (over: Partial<OutflowImportRow> = {}): OutflowImportRow =>
    ({
        name: "OFR-1",
        transfer_id: "T1",
        added_on: "2026-08-05 14:22:31",
        amount: 235000,
        beneficiary_name: "APEX FABRICATION WORKS",
        bank_account: "0042345678904",
        ifsc: "HDFC0001234",
        remarks: "PO/2026/0451 second milestone",
        bank_reference_no: "620919871893",
        service_charge: 0,
        service_tax: 0,
        row_status: "Matched",
        matches: [],
        ...over,
    }) as OutflowImportRow;

describe("columns", () => {
    it("carries the seven default columns in the owner's order", () => {
        const shown = OUTFLOW_COLUMNS.filter((c) => !c.hiddenByDefault).map((c) => c.title);
        expect(shown).toEqual([
            "Payment Date",
            "Beneficiary",
            "Amount Paid",
            "Remarks",
            "Reference (UTR)",
            "Status",
            "Outcome",
        ]);
    });

    it("ships bank a/c, IFSC and time hidden", () => {
        // Real and occasionally needed; putting them in the default row costs every reader
        // horizontal space on every visit to serve a rare lookup.
        expect(DEFAULT_HIDDEN_COLUMNS).toEqual(["bank_account", "ifsc", "time"]);
    });

    it("gives Outcome no filter, because it is a button and not text", () => {
        const outcome = OUTFLOW_COLUMNS.find((c) => c.id === "outcome")!;
        expect(outcome.filter).toBe("none");
    });

    it("splits the payment date and time from one stored datetime", () => {
        const source = row({ added_on: "2026-08-05 14:22:31" });
        const date = OUTFLOW_COLUMNS.find((c) => c.id === "added_on")!;
        const time = OUTFLOW_COLUMNS.find((c) => c.id === "time")!;
        expect(date.get(source)).toBe("2026-08-05");
        expect(time.get(source)).toBe("14:22");
    });
});

describe("tabs", () => {
    it("routes every OPEN status to Pending and the two terminal ones to their own tabs", () => {
        expect(tabForStatus("Pending match run")).toBe("pending");
        expect(tabForStatus("Matched")).toBe("pending");
        expect(tabForStatus("Unmatched")).toBe("pending");
        expect(tabForStatus("Mismatched")).toBe("pending");
        expect(tabForStatus("Error")).toBe("pending");
        expect(tabForStatus("Settled")).toBe("settled");
        expect(tabForStatus("Skipped")).toBe("skipped");
    });

    it("never leaves a row homeless", () => {
        // A status with no tab is invisible, which is worse than a wrong tab: the work silently
        // disappears from the screen.
        const rows = [
            row({ name: "a", row_status: "Matched" }),
            row({ name: "b", row_status: "Settled" }),
            row({ name: "c", row_status: "Skipped" }),
            row({ name: "d", row_status: "Something the server invented" }),
        ];
        const counts = tabCounts(rows);
        expect(counts.pending + counts.settled + counts.skipped).toBe(rows.length);
    });

    it("puts an unknown status in Pending rather than dropping it", () => {
        expect(tabForStatus("Something the server invented")).toBe("pending");
    });

    it("partitions rows without duplicating any", () => {
        const rows = [
            row({ name: "a", row_status: "Matched" }),
            row({ name: "b", row_status: "Settled" }),
            row({ name: "c", row_status: "Skipped" }),
        ];
        expect(rowsForTab(rows, "pending").map((r) => r.name)).toEqual(["a"]);
        expect(rowsForTab(rows, "settled").map((r) => r.name)).toEqual(["b"]);
        expect(rowsForTab(rows, "skipped").map((r) => r.name)).toEqual(["c"]);
    });
});

describe("search", () => {
    it("matches remarks, reference and beneficiary", () => {
        expect(matchesQuery(row(), "milestone")).toBe(true);
        expect(matchesQuery(row(), "620919")).toBe(true);
        expect(matchesQuery(row(), "apex")).toBe(true);
    });

    it("does not match a field outside the three", () => {
        // Scoped deliberately -- searching every column would match a status or an amount the
        // reader did not mean and put the highlight somewhere confusing.
        expect(matchesQuery(row(), "HDFC0001234")).toBe(false);
        expect(matchesQuery(row({ row_status: "Mismatched" }), "Mismatched")).toBe(false);
    });

    it("is case-insensitive and ignores surrounding whitespace", () => {
        expect(matchesQuery(row(), "  ApEx  ")).toBe(true);
    });

    it("matches everything when the query is blank", () => {
        expect(matchesQuery(row(), "")).toBe(true);
        expect(matchesQuery(row(), "   ")).toBe(true);
    });
});

describe("highlightSegments", () => {
    it("splits around every occurrence", () => {
        expect(highlightSegments("aXbXc", "x")).toEqual([
            { text: "a", hit: false },
            { text: "X", hit: true },
            { text: "b", hit: false },
            { text: "X", hit: true },
            { text: "c", hit: false },
        ]);
    });

    it("preserves the original text exactly when the segments are rejoined", () => {
        // A highlighter that drops characters is a bug that only shows on unusual data.
        const source = "PO/2026/0451 — second milestone";
        for (const query of ["", "o", "milestone", "—", "PO/2026"]) {
            expect(highlightSegments(source, query).map((s) => s.text).join("")).toBe(source);
        }
    });

    it("keeps the ORIGINAL casing in a hit, not the query's", () => {
        expect(highlightSegments("Apex Works", "apex")).toEqual([
            { text: "Apex", hit: true },
            { text: " Works", hit: false },
        ]);
    });

    it("returns one plain segment when there is no query", () => {
        expect(highlightSegments("anything", "")).toEqual([{ text: "anything", hit: false }]);
    });

    it("returns nothing for empty text rather than an empty segment", () => {
        expect(highlightSegments("", "x")).toEqual([]);
        expect(highlightSegments(null, "x")).toEqual([]);
    });
});

describe("filters", () => {
    const rows = [
        row({ name: "a", beneficiary_name: "APEX", amount: 100, remarks: "rent" }),
        row({ name: "b", beneficiary_name: "MERIDIAN", amount: 500, remarks: "cable" }),
        row({ name: "c", beneficiary_name: "APEX", amount: 900, remarks: "rent, july" }),
    ];

    it("ORs within a facet column", () => {
        const kept = rows.filter((r) => passesFilters(r, { beneficiary_name: ["APEX"] }));
        expect(kept.map((r) => r.name)).toEqual(["a", "c"]);
    });

    it("ANDs across columns", () => {
        const kept = rows.filter((r) =>
            passesFilters(r, { beneficiary_name: ["APEX"], remarks: "july" })
        );
        expect(kept.map((r) => r.name)).toEqual(["c"]);
    });

    it("treats an EMPTY facet selection as no filter, not as match-nothing", () => {
        // Otherwise unticking the last value blanks the table instead of clearing the filter,
        // which reads as a bug every single time.
        const kept = rows.filter((r) => passesFilters(r, { beneficiary_name: [] }));
        expect(kept).toHaveLength(3);
    });

    it("applies a range filter inclusively at both ends", () => {
        const kept = rows.filter((r) => passesFilters(r, { amount: { min: 100, max: 500 } }));
        expect(kept.map((r) => r.name)).toEqual(["a", "b"]);
    });

    it("allows a one-sided range", () => {
        expect(rows.filter((r) => passesFilters(r, { amount: { min: 500 } })).map((r) => r.name))
            .toEqual(["b", "c"]);
        expect(rows.filter((r) => passesFilters(r, { amount: { max: 100 } })).map((r) => r.name))
            .toEqual(["a"]);
    });

    it("counts only filters that are actually constraining anything", () => {
        expect(activeFilterCount({})).toBe(0);
        expect(activeFilterCount({ beneficiary_name: [] })).toBe(0);
        expect(activeFilterCount({ remarks: "  " })).toBe(0);
        expect(activeFilterCount({ amount: { min: null, max: null } })).toBe(0);
        expect(activeFilterCount({ beneficiary_name: ["APEX"], amount: { min: 1 } })).toBe(2);
    });

    it("offers each distinct facet value once, sorted", () => {
        const column = OUTFLOW_COLUMNS.find((c) => c.id === "beneficiary_name")!;
        expect(facetValues(rows, column)).toEqual(["APEX", "MERIDIAN"]);
    });
});

describe("visibleRows", () => {
    const rows = [
        row({ name: "a", amount: 300, added_on: "2026-08-03 09:00:00", remarks: "beta" }),
        row({ name: "b", amount: 100, added_on: "2026-08-05 09:00:00", remarks: "alpha" }),
        row({ name: "c", amount: 200, added_on: "2026-08-04 09:00:00", remarks: "gamma" }),
    ];

    it("sorts numerically on a numeric column, not lexically", () => {
        // "100" < "200" < "300" happens to agree lexically; 1000 would not, which is the case
        // that matters on a real statement.
        const withBig = [...rows, row({ name: "d", amount: 1000 })];
        const sorted = visibleRows(withBig, { sort: { columnId: "amount", direction: "asc" } });
        expect(sorted.map((r) => r.amount)).toEqual([100, 200, 300, 1000]);
    });

    it("reverses on desc", () => {
        const sorted = visibleRows(rows, { sort: { columnId: "amount", direction: "desc" } });
        expect(sorted.map((r) => r.name)).toEqual(["a", "c", "b"]);
    });

    it("sorts dates chronologically", () => {
        const sorted = visibleRows(rows, { sort: { columnId: "added_on", direction: "asc" } });
        expect(sorted.map((r) => r.name)).toEqual(["a", "c", "b"]);
    });

    it("combines search, filters and sort", () => {
        const out = visibleRows(rows, {
            query: "a",
            filters: { amount: { min: 150 } },
            sort: { columnId: "amount", direction: "asc" },
        });
        expect(out.map((r) => r.name)).toEqual(["c", "a"]);
    });

    it("does not mutate the array it was given", () => {
        // It belongs to the caller, and sorting in place would mutate state React is holding.
        const original = [...rows];
        visibleRows(rows, { sort: { columnId: "amount", direction: "asc" } });
        expect(rows).toEqual(original);
    });

    it("leaves the order untouched when no column is sorted", () => {
        expect(visibleRows(rows, {}).map((r) => r.name)).toEqual(["a", "b", "c"]);
    });
});

describe("isConfirmable", () => {
    const link: RowDecision = { target: "Project Payments", linkTo: "PAY-1" };

    it("accepts a matched row with a linked record", () => {
        expect(isConfirmable(row({ row_status: "Matched" }), link)).toBe(true);
    });

    it("accepts a mismatched row, because a mismatch must stay resolvable", () => {
        // Owner ruling: reporting a mismatch with no way to act on it was the defect.
        expect(isConfirmable(row({ row_status: "Mismatched" }), link)).toBe(true);
    });

    it("refuses a row the match has NOT run on, whatever decision is attached", () => {
        // `Pending match run` means nothing was looked up, so any decision on it was made against
        // no evidence at all.
        expect(isConfirmable(row({ row_status: "Pending match run" }), link)).toBe(false);
    });

    it("refuses an already terminal row", () => {
        expect(isConfirmable(row({ row_status: "Settled" }), link)).toBe(false);
        expect(isConfirmable(row({ row_status: "Skipped" }), link)).toBe(false);
    });

    it("refuses a row with no decision at all", () => {
        expect(isConfirmable(row({ row_status: "Unmatched" }), undefined)).toBe(false);
    });

    it("refuses a linked record with no ledger behind it", () => {
        // ⚠️ The ledger now arrives WITH the chosen record instead of from a card clicked first
        // (slice R2), so a decision can hold one half and not the other. Without both,
        // `settle_row` would be posted with an undefined doctype.
        expect(isConfirmable(row(), { linkTo: "PAY-1" })).toBe(false);
        expect(isConfirmable(row(), {})).toBe(false);
    });

    it("refuses a link decision with nothing linked", () => {
        expect(
            isConfirmable(row(), { target: "Project Payments", linkTo: null })
        ).toBe(false);
    });

    it("requires a type on a new expense, and a project on the project side", () => {
        const base = row({ row_status: "Unmatched" });
        expect(
            isConfirmable(base, {
                target: "new",
                newExpense: { doctype: "Project Expenses", expenseType: "Rent" },
            })
        ).toBe(false); // no project
        expect(
            isConfirmable(base, {
                target: "new",
                newExpense: { doctype: "Project Expenses", expenseType: "Rent", project: "P-1" },
            })
        ).toBe(true);
    });

    it("does not require a project for a NON-project expense", () => {
        // The two expense doctypes are not twins: `Non Project Expenses` has no project at all.
        expect(
            isConfirmable(row({ row_status: "Unmatched" }), {
                target: "new",
                newExpense: { doctype: "Non Project Expenses", expenseType: "Office Maintenance" },
            })
        ).toBe(true);
    });
});

describe("the bulk bar counts DECIDED rows, not selected ones", () => {
    const rows = [
        row({ name: "a", row_status: "Matched" }),
        row({ name: "b", row_status: "Matched" }),
        row({ name: "c", row_status: "Unmatched" }),
    ];
    const decisions = new Map<string, RowDecision>([
        ["a", { target: "Project Payments", linkTo: "PAY-1" }],
        ["b", { target: "Project Payments", linkTo: "PAY-2" }],
    ]);

    it("reports 2 when 3 are ticked but one is unresolved", () => {
        // Owner ruling: "Confirm 4 decided" when 5 are ticked. It must never silently act on a row
        // nobody resolved -- and must not refuse the whole action either, because the rest are
        // ready.
        const selected = new Set(["a", "b", "c"]);
        expect(selected.size).toBe(3);
        expect(countDecided(rows, selected, decisions)).toBe(2);
    });

    it("returns the decided rows themselves, so the caller acts on exactly what it counted", () => {
        const selected = new Set(["a", "b", "c"]);
        expect(decidedRows(rows, selected, decisions).map((r) => r.name)).toEqual(["a", "b"]);
    });

    it("is zero when nothing selected is resolved", () => {
        expect(countDecided(rows, new Set(["c"]), decisions)).toBe(0);
    });

    it("ignores a decision for a row that is not selected", () => {
        expect(countDecided(rows, new Set(["c"]), decisions)).toBe(0);
    });
});

describe("the match run's suggestion becomes a decision", () => {
    /**
     * ⚠️ THE "EXACTLY ONE" RULE IS NOT TESTED HERE, ON PURPOSE. It lives on the server, in
     * `services/outflow_import/status.sole_suggestion`, and is pinned by its own unit tests. Two
     * candidates, a fan-out, a skipped duplicate and an unmatched row all arrive with the fields
     * BLANK. A second copy of that rule in the browser is exactly what this replaced.
     */
    const suggested = (over: Partial<OutflowImportRow> = {}) =>
        row({
            row_status: "Matched",
            suggested_doctype: "Project Payments",
            suggested_name: "PAY-00105-038",
            ...over,
        });

    it("reads the stored pair as a ready decision", () => {
        expect(suggestedDecision(suggested())).toEqual({
            target: "Project Payments",
            linkTo: "PAY-00105-038",
        });
    });

    it("carries the suggestion's OWN ledger, not an assumed one", () => {
        // A hardcoded "Project Payments" would settle an expense against the wrong table.
        expect(
            suggestedDecision(
                suggested({ suggested_doctype: "Non Project Expenses", suggested_name: "NPE-4" })
            )
        ).toEqual({ target: "Non Project Expenses", linkTo: "NPE-4" });
    });

    it("reads a blank or half-written pair as nothing", () => {
        expect(suggestedDecision(suggested({ suggested_name: "" }))).toBeNull();
        expect(suggestedDecision(suggested({ suggested_doctype: undefined }))).toBeNull();
        expect(suggestedDecision(row())).toBeNull();
    });

    it("refuses a ledger this screen cannot settle", () => {
        expect(suggestedDecision(suggested({ suggested_doctype: "Procurement Orders" }))).toBeNull();
    });

    it("refuses a row nobody may decide, however the pair got there", () => {
        // The server blanks these already. Checked twice because the failure -- a green
        // "ready to confirm" on a settled or skipped row -- is worth more than the two lines.
        expect(suggestedDecision(suggested({ row_status: "Settled" }))).toBeNull();
        expect(suggestedDecision(suggested({ row_status: "Skipped" }))).toBeNull();
        expect(suggestedDecision(suggested({ row_status: "Pending match run" }))).toBeNull();
    });

    it("seeds every suggested row that nobody has touched", () => {
        const rows = [
            suggested({ name: "A" }),
            suggested({ name: "B", suggested_name: "PAY-2" }),
            row({ name: "C", row_status: "Unmatched" }),
        ];
        const seeded = seedDecisions(rows, new Map());
        expect(seeded.size).toBe(2);
        expect(seeded.get("A")?.linkTo).toBe("PAY-00105-038");
        expect(seeded.get("B")?.linkTo).toBe("PAY-2");
        expect(seeded.has("C")).toBe(false);
    });

    it("never overwrites a decision the reviewer already made", () => {
        const existing = new Map<string, RowDecision>([
            ["A", { target: "Project Expenses", linkTo: "PE-9" }],
        ]);
        const seeded = seedDecisions([suggested({ name: "A" })], existing);
        expect(seeded.get("A")).toEqual({ target: "Project Expenses", linkTo: "PE-9" });
    });

    it("never re-seeds a selection the reviewer deliberately CLEARED", () => {
        // Clearing leaves an entry with a null link, not an absent entry -- which is what makes it
        // distinguishable from "never touched". Re-seeding here would put the machine's pick back
        // under someone who had just rejected it, on the next refetch, silently.
        const cleared = new Map<string, RowDecision>([
            ["A", { target: "Project Payments", linkTo: null }],
        ]);
        const seeded = seedDecisions([suggested({ name: "A" })], cleared);
        expect(seeded.get("A")?.linkTo).toBeNull();
    });

    it("returns the SAME map when there is nothing to add", () => {
        // The page re-runs this on every fetch. A fresh Map each time would change the reference,
        // re-render the table and re-run every memo for no change at all.
        const existing = new Map<string, RowDecision>();
        expect(seedDecisions([row({ row_status: "Unmatched" })], existing)).toBe(existing);
    });

    it("a seeded row is immediately confirmable, which is the whole point", () => {
        const seeded = seedDecisions([suggested({ name: "A" })], new Map());
        expect(isConfirmable(suggested({ name: "A" }), seeded.get("A"))).toBe(true);
    });

    it("tells the table whether the machine or a person put the decision there", () => {
        const r = suggested();
        expect(decisionOrigin(r, undefined)).toBe("none");
        expect(decisionOrigin(r, { target: "Project Payments", linkTo: "PAY-00105-038" })).toBe(
            "suggested"
        );
        expect(decisionOrigin(r, { target: "Project Payments", linkTo: "PAY-OTHER" })).toBe(
            "chosen"
        );
        expect(decisionOrigin(r, { target: "Project Expenses", linkTo: "PAY-00105-038" })).toBe(
            "chosen"
        );
        // A row with no suggestion at all: anything on it was chosen by a person.
        expect(decisionOrigin(row(), { target: "Project Payments", linkTo: "PAY-1" })).toBe(
            "chosen"
        );
    });
});

describe("candidate ordering and pre-selection", () => {
    /**
     * ⚠️ `suggested` COMES FROM THE SERVER and encodes the Re 1 rounding tolerance. The client
     * deliberately holds no copy of that number: a duplicated constant would drift the moment the
     * owner changed it, and the symptom would be a screen offering a record the confirm refuses.
     */
    const candidates = [
        { name: "PAY-3", amount: 999, suggested: false },
        { name: "PAY-1", amount: 235000, suggested: true },
        { name: "PAY-2", amount: 235000, suggested: true },
    ];

    it("sorts suggested records first, then by closeness", () => {
        expect(orderBySuggestion(candidates, 235000).map((c) => c.name)).toEqual([
            "PAY-1",
            "PAY-2",
            "PAY-3",
        ]);
    });

    it("floats a near-miss above a far one among unsuggested records", () => {
        const spread = [
            { name: "FAR", amount: 1000, suggested: false },
            { name: "NEAR", amount: 234000, suggested: false },
        ];
        expect(orderBySuggestion(spread, 235000).map((c) => c.name)).toEqual(["NEAR", "FAR"]);
    });

    it("does not mutate the candidate list", () => {
        const original = [...candidates];
        orderBySuggestion(candidates, 235000);
        expect(candidates).toEqual(original);
    });

    it("reports the amount verdict as same or a signed difference", () => {
        expect(amountVerdict(235000, 235000)).toEqual({ same: true, difference: 0 });
        expect(amountVerdict(235000, 232650)).toEqual({ same: false, difference: 2350 });
        expect(amountVerdict(280000, 310000)).toEqual({ same: false, difference: -30000 });
    });

    it("reports a sub-rupee difference honestly rather than rounding it to zero", () => {
        // The screen renders this as "differs by X, within the accepted tolerance". Rounding it
        // away would tell the reviewer the amounts are identical when they are not.
        const verdict = amountVerdict(18678.69, 18679);
        expect(verdict.same).toBe(false);
        expect(verdict.difference).toBeCloseTo(-0.31, 2);
    });
});
