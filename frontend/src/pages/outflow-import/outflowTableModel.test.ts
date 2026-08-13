import { describe, expect, it } from "vitest";

import type { OutflowImportRow } from "@/types/NirmaanStack/OutflowImportBatch";
import {
    DEFAULT_HIDDEN_COLUMNS,
    DEFAULT_TAB,
    PERIOD_COLUMN_ID,
    SERVER_FACET_COLUMNS,
    importsCoveredLabel,
    isDateFilterValue,
    rematchWarning,
    type SummaryImport,
    OUTFLOW_COLUMNS,
    OUTFLOW_TABS,
    RECORD_COLUMNS,
    activeFilterCount,
    amountVerdict,
    candidateKeySet,
    partialOffer,
    deductionOffer,
    deductionRefusalText,
    TDS_BAND_MIN_PCT,
    TDS_BAND_MAX_PCT,
    INTENT_PART_PAYMENT,
    INTENT_DEDUCTION,
    matcherCandidateLine,
    confirmFunnel,
    describeFrappeError,
    settleBlockText,
    settleBlocker,
    previewCounts,
    statementDebit,
    tabCountParts,
    matchBasisLabel,
    ARBITRARY_SUGGESTION_RULES,
    SUGGESTION_RULE_LABELS,
    buildConfirmTree,
    nodeSelectionState,
    toggleNode,
    confirmSelectionSummary,
    filterConfirmRows,
    confirmFilterCount,
    EMPTY_CONFIRM_FILTERS,
    orderLabel,
    suggestionRuleLabel,
    type ConfirmableRow,
    ledgerLabel,
    parseRecordKey,
    RECORD_DATE_LABELS,
    recordDateParts,
    recordKey,
    DEFAULT_PAGE_SIZE,
    SCOPE_FOR_TAB,
    countDecided,
    decidedRows,
    decisionOrigin,
    highlightSegments,
    importOptionLabel,
    isConfirmable,
    orderBySuggestion,
    orderPaymentsHref,
    rowSettlementLinks,
    seedDecisions,
    serverQuery,
    settlementLink,
    suggestedDecision,
    summaryTiles,
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
    it("carries the default columns in the owner's order", () => {
        // ⚠️ "Import" JOINED AT X3 and it only makes sense from X3 on: the batch screen showed one
        // import, so naming it in every row would have been noise. The master table spans every
        // import, and "which statement was this?" becomes a real question the moment it does.
        const shown = OUTFLOW_COLUMNS.filter((c) => !c.hiddenByDefault).map((c) => c.title);
        expect(shown).toEqual([
            "Payment Date",
            "Beneficiary",
            "Amount Paid",
            "Remarks",
            "Reference (UTR)",
            "Status",
            "Outcome",
            "Import",
        ]);
    });

    it("ships settled-via, bank a/c, IFSC and time hidden", () => {
        // Real and occasionally needed; putting them in the default row costs every reader
        // horizontal space on every visit to serve a rare lookup.
        //
        // ⚠️ `settlement_origin` JOINED THIS LIST AT SLICE Q1, DELIBERATELY. The owner asked for a
        // FILTER and a summary number, not a column -- but in this table a filter IS a column
        // header, because the funnel lives in the `<th>`. Hidden-by-default is the honest
        // resolution: the table looks exactly as it did and the funnel is one click away in the
        // column picker. The alternative -- a second filter path that bypasses OUTFLOW_COLUMNS --
        // would break the single-builder guarantee that keeps the page, its count, the tabs and
        // the summary from disagreeing.
        expect(DEFAULT_HIDDEN_COLUMNS).toEqual([
            "settlement_origin",
            "bank_account",
            "ifsc",
            "time",
        ]);
    });

    it("offers settled-via as a FACET, so the values come from the database", () => {
        // The three origins are a closed vocabulary, but the facet is still the right shape: it is
        // the one filter kind `_row_filters` already serves over the whole filtered table rather
        // than over the loaded page.
        const col = OUTFLOW_COLUMNS.find((c) => c.id === "settlement_origin")!;
        expect(col.filter).toBe("facet");
        expect(col.title).toBe("Settled via");
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
    it("is All / Not-Matched / Matched-Settled, in that order", () => {
        // ⚠️ THERE IS NO SKIPPED TAB, and "All" excludes Skipped too (owner ruling 2026-08-10) --
        // it means everything a person might still act on, not every row in the table. The import
        // summary panel is the only place skipped transfers are reported.
        expect(OUTFLOW_TABS.map((t) => t.id)).toEqual(["all", "notMatched", "matched"]);
        expect(OUTFLOW_TABS.map((t) => t.label)).toEqual([
            "All",
            "Not-Matched",
            "Matched / Settled",
        ]);
    });

    it("opens on the work, not the archive", () => {
        expect(DEFAULT_TAB).toBe("notMatched");
    });

    it("maps every tab to a scope the server knows", () => {
        // ⚠️ The two vocabularies differ on purpose -- camelCase ids in TypeScript, snake_case
        // scopes in Python and in URLs. This map is the one place they meet, so an unmapped tab
        // would silently scope to the server's fallback rather than to what the label promises.
        expect(SCOPE_FOR_TAB.all).toBe("all");
        expect(SCOPE_FOR_TAB.notMatched).toBe("not_matched");
        expect(SCOPE_FOR_TAB.matched).toBe("matched");
    });

    it("maps every declared tab, with no gaps", () => {
        // A tab present in the strip but missing from the map renders an empty table with no error.
        for (const tab of OUTFLOW_TABS) expect(SCOPE_FOR_TAB[tab.id]).toBeTruthy();
    });
});

/**
 * ⚠️ THE OLD `search` / `filters` / `visibleRows` SUITES ARE GONE, AND THE LOSS IS EXPECTED.
 *
 * They covered `matchesQuery`, `passesFilters`, `visibleRows` and `facetValues` -- the client-side
 * filter engine, deleted at X3 because the master table is paged and the SERVER has to answer
 * "which rows match". Keeping the client copy would have left two engines that disagree the day
 * somebody edits one (ADR-0010 F1/F3), and keeping their tests would have pinned a rule nothing
 * runs any more. What replaces them is `serverQuery` below, which pins the MEANING, plus the
 * endpoint tests in `test_review.py`, which pin the APPLICATION. A test count that went down is the
 * correct outcome here.
 */
describe("serverQuery", () => {
    it("translates the tab into the scope the endpoint knows", () => {
        expect(serverQuery({ tab: "notMatched" }).scope).toBe("not_matched");
        expect(serverQuery({ tab: "matched" }).scope).toBe("matched");
        expect(serverQuery({ tab: "all" }).scope).toBe("all");
    });

    it("omits an empty filter rather than sending an empty value", () => {
        // ⚠️ An empty facet array reaching the server is indistinguishable from a real selection in
        // a naive handler, and the day one treats it as "match nothing" the table blanks when you
        // untick the last value. Omitting is unambiguous at both ends.
        const query = serverQuery({
            tab: "notMatched",
            query: "   ",
            filters: { beneficiary_name: [], amount: { min: null, max: null } },
        });
        expect(query.search).toBeUndefined();
        expect(query.facets).toBeUndefined();
        expect(query.amount_min).toBeUndefined();
    });

    it("sends only the columns the server can facet on", () => {
        const query = serverQuery({
            tab: "notMatched",
            filters: { beneficiary_name: ["APEX"], outcome: ["nonsense"] },
        });
        expect(query.facets).toEqual({ beneficiary_name: ["APEX"] });
    });

    it("passes an amount range through as two bounds", () => {
        const query = serverQuery({ tab: "notMatched", filters: { amount: { min: 100, max: 500 } } });
        expect(query.amount_min).toBe(100);
        expect(query.amount_max).toBe(500);
    });

    it("allows a one-sided range", () => {
        expect(serverQuery({ tab: "notMatched", filters: { amount: { min: 500 } } }).amount_max)
            .toBeUndefined();
        expect(serverQuery({ tab: "notMatched", filters: { amount: { max: 100 } } }).amount_min)
            .toBeUndefined();
    });

    it("falls back to the default sort for a column the server cannot sort by", () => {
        // The Outcome column is a button and Time is a rendering of `added_on`; neither is a sort
        // key the endpoint knows, and sending one would fail the whole page load over a cosmetic
        // click.
        const query = serverQuery({
            tab: "notMatched",
            sort: { columnId: "outcome", direction: "asc" },
        });
        expect(query.sort_by).toBe("added_on");
        expect(query.sort_dir).toBe("desc");
    });

    it("passes a sortable column through with its direction", () => {
        const query = serverQuery({ tab: "notMatched", sort: { columnId: "amount", direction: "asc" } });
        expect(query.sort_by).toBe("amount");
        expect(query.sort_dir).toBe("asc");
    });

    it("turns the page number into an offset", () => {
        expect(serverQuery({ tab: "notMatched", page: 0 }).offset).toBe(0);
        expect(serverQuery({ tab: "notMatched", page: 2 }).offset).toBe(2 * DEFAULT_PAGE_SIZE);
        expect(serverQuery({ tab: "notMatched", page: 2, pageSize: 10 }).offset).toBe(20);
    });

    it("never sends a negative offset", () => {
        expect(serverQuery({ tab: "notMatched", page: -3 }).offset).toBe(0);
    });

    it("scopes to one import when the screen is deep-linked to it", () => {
        expect(serverQuery({ tab: "notMatched", batch: "OFI-26-00007" }).batch).toBe("OFI-26-00007");
        expect(serverQuery({ tab: "notMatched" }).batch).toBeUndefined();
    });

    it("folds a per-column text filter into the search the server already runs", () => {
        // `remarks` and `bank_reference_no` are both covered by the endpoint's search, so they do
        // not need two more parameters for a distinction no reader makes.
        expect(serverQuery({ tab: "notMatched", filters: { remarks: "rent" } }).search).toBe("rent");
    });

    it("lets an explicit search win over a column text filter", () => {
        const query = serverQuery({
            tab: "notMatched",
            query: "apex",
            filters: { remarks: "rent" },
        });
        expect(query.search).toBe("apex");
    });
});

describe("the summary panel's figures", () => {
    const totals = {
        matched_rows: 4,
        mismatched_rows: 7,
        settled_rows: 12,
        skipped_rows: 3,
        pending_rows: 0,
        error_rows: 0,
    };

    it("leads with the work, not with the vocabulary", () => {
        expect(summaryTiles(totals).map((t) => t.id)).toEqual([
            "matched",
            "mismatched",
            "settled",
            "skipped",
        ]);
    });

    it("shows Mismatched even at zero, because zero is the answer", () => {
        // ⚠️ THIS REVERSES THE PRE-MERGE RULE, and the reversal is the point. `Mismatched` used to
        // be hidden at zero: it fired only when a hand-ticked payment disagreed on amount beyond
        // the window, so it was 0 on almost every import and a standing "0 Mismatched" chip would
        // have trained people to stop reading the row it sits in. Having absorbed `Unmatched`
        // (owner ruling 2026-08-10) it carries most of a statement's work, and at zero it says the
        // genuinely useful thing: this import is finished finding work.
        expect(summaryTiles({ ...totals, mismatched_rows: 0 }).find((t) => t.id === "mismatched"))
            .toBeDefined();
    });

    it("still hides Errors when they are zero", () => {
        // Error is the one that stays conditional: it means the SOFTWARE failed, and that is still
        // rare enough that a standing "0 Errors" would be noise.
        expect(summaryTiles(totals).find((t) => t.id === "error")).toBeUndefined();
    });

    it("shows Errors the moment they are not zero", () => {
        expect(summaryTiles({ ...totals, error_rows: 2 }).find((t) => t.id === "error")?.count)
            .toBe(2);
    });

    it("puts an un-matched-yet import's own figure first", () => {
        const tiles = summaryTiles({ ...totals, pending_rows: 26 });
        expect(tiles[0].id).toBe("pending");
    });

    it("carries no status set, because a figure is not a filter", () => {
        // ⚠️ THE CHIPS STOPPED BEING BUTTONS (owner ruling 2026-08-10), and the `statuses` field
        // went with the click. A panel describing ONE import must not rewrite the filters of a
        // table spanning all of them -- and it moved the tab as a side effect, so a click meant to
        // read a figure navigated away from the work in progress.
        for (const tile of summaryTiles({ ...totals, error_rows: 2 })) {
            expect(tile).not.toHaveProperty("statuses");
        }
    });
});

describe("importOptionLabel", () => {
    it("names the file and the period, never the batch id", () => {
        // `OFI-26-00007` means nothing to an accountant; the file they uploaded and the fortnight
        // it covers is how they know which statement is which.
        expect(
            importOptionLabel({
                name: "OFI-26-00007",
                original_filename: "july-b.csv",
                period_from: "2026-07-16 00:00:00",
                period_to: "2026-07-31 00:00:00",
            })
        ).toBe("july-b.csv · 16-Jul-2026 → 31-Jul-2026");
    });

    it("falls back through file, then period, then the id", () => {
        expect(importOptionLabel({ name: "OFI-1", original_filename: "a.csv" })).toBe("a.csv");
        expect(importOptionLabel({ name: "OFI-1", period_from: "2026-07-16 00:00:00" })).toBe(
            "16-Jul-2026"
        );
        expect(importOptionLabel({ name: "OFI-1" })).toBe("OFI-1");
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

describe("activeFilterCount", () => {
    it("counts only filters that are actually constraining anything", () => {
        // It drives the "Clear filters (N)" control, so a filter that constrains nothing must not
        // be counted -- otherwise the button offers to clear something invisible.
        expect(activeFilterCount({})).toBe(0);
        expect(activeFilterCount({ beneficiary_name: [] })).toBe(0);
        expect(activeFilterCount({ remarks: "  " })).toBe(0);
        expect(activeFilterCount({ amount: { min: null, max: null } })).toBe(0);
        expect(activeFilterCount({ beneficiary_name: ["APEX"], amount: { min: 1 } })).toBe(2);
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
        expect(isConfirmable(row({ row_status: "Mismatched" }), undefined)).toBe(false);
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
        const base = row({ row_status: "Mismatched" });
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
            isConfirmable(row({ row_status: "Mismatched" }), {
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
        row({ name: "c", row_status: "Mismatched" }),
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

describe("links to the record a row settles — the app's own route (slice E3)", () => {
    const ORDER = "PO/123/25-26";

    it("sends a payment to its ORDER, the way the rest of the app does", () => {
        // ⚠️ THE HEADLINE CHANGE. Twelve other call sites navigate to `/project-payments/<order>`;
        // this feature had its own scheme, which only landed while four separate things agreed.
        const link = settlementLink("Project Payments", "PAY-00105-038", true, ORDER)!;
        expect(link.href).toBe("/project-payments/PO&=123&=25-26");
        expect(link.exact).toBe(true);
        // The LABEL stays the payment -- that is the record the row settled and what the reviewer
        // recognises. Only the destination changed.
        expect(link.label).toBe("PAY-00105-038");
    });

    it("escapes every slash as &=, because the reader reverses exactly that", () => {
        // `OrderPaymentSummary` does `id.replace(/&=/g, "/")`. A different escape here would not
        // fail loudly -- it would land on a route param that resolves to no document.
        expect(orderPaymentsHref("PO/123/25-26")).toBe("/project-payments/PO&=123&=25-26");
        expect(orderPaymentsHref("SR/9/25-26")).toBe("/project-payments/SR&=9&=25-26");
        expect(orderPaymentsHref("NOSLASH")).toBe("/project-payments/NOSLASH");
    });

    it("carries a Service Request order as readily as a PO", () => {
        // A quarter of payments are against an SR, and `OrderPaymentSummary` branches on the id
        // prefix itself -- so this helper must not assume "PO".
        expect(settlementLink("Project Payments", "PAY-1", true, "SR/9/25-26")!.href).toBe(
            "/project-payments/SR&=9&=25-26"
        );
    });

    it("the tooltip names the ORDER being opened, not a tab that no longer applies", () => {
        const link = settlementLink("Project Payments", "PAY-1", true, ORDER)!;
        expect(link.title).toContain(ORDER);
        expect(link.title).not.toContain("Payments Done");
    });

    it("ignores the settled flag on the order route, which carries no status filter", () => {
        const settled = settlementLink("Project Payments", "PAY-1", true, ORDER)!;
        const open = settlementLink("Project Payments", "PAY-1", false, ORDER)!;
        expect(settled.href).toBe(open.href);
    });

    it("⚠️ FALLS BACK rather than losing the link when no order is known", () => {
        // A payload predating `order_name`, or a payment with no order at all. Blank and absent
        // are the same answer: there is no order to open.
        for (const missing of [undefined, null, "", "   "]) {
            const link = settlementLink("Project Payments", "PAY-1", false, missing)!;
            expect(link.href).toContain("tab=All+Payments");
        }
    });

    it("never routes an EXPENSE to the payments route, whatever it is handed", () => {
        // `document_name` holds the expense TYPE on both expense ledgers, so an order id passed
        // here would be a category name, not a document.
        expect(settlementLink("Project Expenses", "EXP-1", false, "Travel")!.href).toBe(
            "/expense/project"
        );
        expect(settlementLink("Non Project Expenses", "NPE-1", false, "Travel")!.href).toBe(
            "/expense/non-project"
        );
    });
});

describe("links to the record a row settles — the FALLBACK path, with no order known", () => {
    it("sends a SETTLED payment to Payments Done", () => {
        const link = settlementLink("Project Payments", "PAY-00105-038", true)!;
        expect(link.exact).toBe(true);
        expect(link.label).toBe("PAY-00105-038");
        expect(link.href).toContain("/project-payments");
        // The tab filters status = Paid, and `name` is a searchable field, so pre-seeding the
        // table's own search params is what lands on the row.
        expect(link.href).toContain("tab=Payments+Done");
        expect(link.href).toContain("searchBy=name");
        expect(link.href).toContain("PAY-00105-038");
    });

    it("sends an UNSETTLED payment to All Payments, because it is not Paid yet", () => {
        // ⚠️ Verified live before this branch existed: "Payments Done" filters status = Paid, so a
        // merely SUGGESTED payment -- still Approved -- landed on an empty table with nothing on
        // screen explaining why. "All Payments" carries no status filter.
        const link = settlementLink("Project Payments", "PAY-00107-044", false)!;
        expect(link.href).toContain("tab=All+Payments");
        expect(link.href).not.toContain("Payments+Done");
        expect(link.href).toContain("PAY-00107-044");
    });

    it("names the SAME tab in the tooltip that the href goes to", () => {
        // The tooltip was written in the component and immediately went stale -- it said "Payments
        // Done" on a link redirected to "All Payments". Built beside the href, it cannot.
        const settled = settlementLink("Project Payments", "PAY-1", true)!;
        expect(settled.title).toContain("Payments Done");
        const open = settlementLink("Project Payments", "PAY-1", false)!;
        expect(open.title).toContain("All Payments");
        expect(open.title).not.toContain("Payments Done");
    });

    it("says out loud that an expense link is not the record itself", () => {
        expect(settlementLink("Project Expenses", "i87sop52n3")!.title).toContain(
            "cannot be linked to directly"
        );
    });

    it("defaults to the unsettled destination, which is the safe one", () => {
        // If a caller forgets, the link still finds the record; the reverse default would hide it.
        expect(settlementLink("Project Payments", "PAY-1")!.href).toContain("tab=All+Payments");
    });

    it("marks an expense link INEXACT, because its table cannot be searched by record id", () => {
        // Not a shortcoming of this helper: PE_SEARCHABLE_FIELDS / NPE_SEARCHABLE_FIELDS cover
        // description, type, vendor and amount -- never `name`. Rendering it like a payment link
        // would promise a precision it does not have.
        const pe = settlementLink("Project Expenses", "i87sop52n3")!;
        expect(pe.exact).toBe(false);
        expect(pe.href).toBe("/expense/project");

        const npe = settlementLink("Non Project Expenses", "abc123")!;
        expect(npe.exact).toBe(false);
        expect(npe.href).toBe("/expense/non-project");
    });

    it("refuses a half-written or unknown target", () => {
        expect(settlementLink("Project Payments", "")).toBeNull();
        expect(settlementLink("", "PAY-1")).toBeNull();
        expect(settlementLink(undefined, undefined)).toBeNull();
        expect(settlementLink("Procurement Orders", "PO-1")).toBeNull();
    });

    it("a SETTLED row reads its match records, not its note", () => {
        // The note is a sentence written for a person. `Outflow Row Match` stores the fact exactly,
        // so parsing the prose back out would be guessing at something already known.
        const settled = row({
            row_status: "Settled",
            outcome_note: "One approved record at this amount: PAY-DECOY.",
            suggested_doctype: "Project Payments",
            suggested_name: "PAY-DECOY",
            matches: [
                {
                    import_row: "OFR-1",
                    target_doctype: "Project Payments",
                    target_name: "PAY-REAL",
                    target_amount: 100,
                    match_kind: "Settled",
                    match_basis: "Bank reference",
                },
            ],
        });
        const [link] = rowSettlementLinks(settled);
        expect(link.label).toBe("PAY-REAL");
        // A match record means money was written, so the payment IS Paid.
        expect(link.href).toContain("tab=Payments+Done");
    });

    it("a fan-out settlement yields one link per record", () => {
        const settled = row({
            row_status: "Settled",
            matches: [
                { target_doctype: "Project Payments", target_name: "PAY-A" },
                { target_doctype: "Project Payments", target_name: "PAY-B" },
            ] as OutflowImportRow["matches"],
        });
        expect(rowSettlementLinks(settled).map((l) => l.label)).toEqual(["PAY-A", "PAY-B"]);
    });

    it("a MATCHED row falls back to the stored suggestion, because nothing is written yet", () => {
        const matched = row({
            row_status: "Matched",
            suggested_doctype: "Project Payments",
            suggested_name: "PAY-00105-038",
            matches: [],
        });
        const [link] = rowSettlementLinks(matched);
        expect(link.label).toBe("PAY-00105-038");
        // Nothing has been written, so the payment is still Approved -> All Payments.
        expect(link.href).toContain("tab=All+Payments");
    });

    it("links a SKIPPED duplicate to the payment somebody already ticked Paid", () => {
        // The gap this closed: a skip settles nothing and DELETES its match records, and it carries
        // no suggestion either (`sole_suggestion` is gated on Matched, so a skipped row can never
        // render as ready to confirm). The payment existed only inside the note's prose.
        const skipped = row({
            row_status: "Skipped",
            outcome_note: "Already recorded as Paid on PAY-00102-211.",
            matches: [],
            related_payments: [
                { target_doctype: "Project Payments", target_name: "PAY-00102-211" },
            ],
        });
        const [link] = rowSettlementLinks(skipped);
        expect(link.label).toBe("PAY-00102-211");
        // Somebody else paid it, but it IS Paid -- so Payments Done is the right table.
        expect(link.href).toContain("tab=Payments+Done");
    });

    it("links a MISMATCHED row too, since it comes from the same duplicate check", () => {
        const mismatched = row({
            row_status: "Mismatched",
            matches: [],
            related_payments: [
                { target_doctype: "Project Payments", target_name: "PAY-00187-018" },
            ],
        });
        expect(rowSettlementLinks(mismatched).map((l) => l.label)).toEqual(["PAY-00187-018"]);
    });

    it("prefers what WE settled over what was already paid", () => {
        const both = row({
            row_status: "Settled",
            matches: [
                { target_doctype: "Project Payments", target_name: "PAY-SETTLED" },
            ] as OutflowImportRow["matches"],
            related_payments: [
                { target_doctype: "Project Payments", target_name: "PAY-DUPLICATE" },
            ],
        });
        expect(rowSettlementLinks(both).map((l) => l.label)).toEqual(["PAY-SETTLED"]);
    });

    it("gives a mismatched row nothing to link to", () => {
        expect(rowSettlementLinks(row({ row_status: "Mismatched" }))).toEqual([]);
    });

    it("gives a skip with no payment behind it nothing to link to", () => {
        // "Transfer did not succeed at the bank", or a manual skip -- no record is involved.
        expect(
            rowSettlementLinks(row({ row_status: "Skipped", matches: [], related_payments: [] }))
        ).toEqual([]);
    });
});

describe("the match run's suggestion becomes a decision", () => {
    /**
     * ⚠️ THE "EXACTLY ONE" RULE IS NOT TESTED HERE, ON PURPOSE. It lives on the server, in
     * `services/outflow_import/status.sole_suggestion`, and is pinned by its own unit tests. Two
     * candidates, a fan-out, a skipped duplicate and a mismatched row all arrive with the fields
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
            row({ name: "C", row_status: "Mismatched" }),
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
        expect(seedDecisions([row({ row_status: "Mismatched" })], existing)).toBe(existing);
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

describe("the settleable-record table model", () => {
    const payment = {
        target_doctype: "Project Payments" as const,
        name: "PAY-00105-034",
        amount: 21924.1,
        detail: "",
        suggested: true,
        vendor_name: "Testfamily Enterprises",
        project_name: "EXL Kochi",
        document_name: "PO/077/00066/25-26",
        approved_on: "2026-07-12 10:00:00",
        updated_on: "2026-07-20 10:00:00",
    };
    const expense = { ...payment, target_doctype: "Project Expenses" as const, name: "EXP-1", approved_on: "" };

    it("keys a record by ledger AND name, because a bare name is not unique across three ledgers", () => {
        expect(recordKey(payment)).toBe("Project Payments|PAY-00105-034");
        expect(recordKey({ target_doctype: "Project Expenses", name: "PAY-00105-034" })).not.toBe(
            recordKey(payment)
        );
    });

    it("round-trips a key back into the ledger and the name", () => {
        expect(parseRecordKey(recordKey(payment))).toEqual({
            target: "Project Payments",
            name: "PAY-00105-034",
        });
    });

    it("round-trips a name that itself contains the separator", () => {
        // The doctype half can hold no "|"; the name half may, so the split must rejoin the tail.
        const odd = { target_doctype: "Project Expenses" as const, name: "EXP|WITH|PIPES" };
        expect(parseRecordKey(recordKey(odd))).toEqual({
            target: "Project Expenses",
            name: "EXP|WITH|PIPES",
        });
    });

    it("refuses a malformed key rather than returning half a decision", () => {
        // A half-written decision reaches `settle_row` with an undefined doctype.
        expect(parseRecordKey("")).toBeNull();
        expect(parseRecordKey("Project Payments")).toBeNull();
        expect(parseRecordKey("|PAY-1")).toBeNull();
    });

    it("says APPROVED for a payment and UPDATED for an expense", () => {
        // ⚠️ THE OWNER RULING THIS FUNCTION EXISTS FOR. Neither expense doctype has an approval
        // date; presenting its modification timestamp under the word "approved" would be a
        // confident lie on two thirds of the list.
        const format = (value: string) => `formatted(${value})`;
        expect(recordDateParts(payment, format)).toEqual({
            kind: "approved",
            date: "formatted(2026-07-12 10:00:00)",
        });
        expect(recordDateParts(expense, format)).toEqual({
            kind: "updated",
            date: "formatted(2026-07-20 10:00:00)",
        });
    });

    it("returns the KIND and the DATE separately, so the badge cannot be lost in the sentence", () => {
        // ⚠️ SLICE E2. It used to return one string -- "approved 12-Jul-2026" -- under a column
        // headed "Approved", so the qualifier was a lowercase word mid-cell in the same weight as
        // the date. The parts render as a badge ABOVE the date. The rule is unchanged; the
        // separation is what makes it visible.
        const parts = recordDateParts(expense, (v) => v);
        expect(parts?.kind).toBe("updated");
        expect(parts?.date).not.toContain("updated");
    });

    it("gives every kind a badge word, so a new kind cannot render blank", () => {
        for (const kind of ["approved", "updated"] as const) {
            expect(RECORD_DATE_LABELS[kind]).toBeTruthy();
        }
        expect(RECORD_DATE_LABELS.approved).toBe("Approved");
        expect(RECORD_DATE_LABELS.updated).toBe("Updated");
    });

    it("says nothing rather than inventing a date when the record has neither", () => {
        expect(recordDateParts({ approved_on: "", updated_on: "" }, (v) => v)).toBeNull();
    });

    it("prefers the approval date when a payment carries both", () => {
        expect(recordDateParts(payment, (v) => v)?.kind).toBe("approved");
    });

    it("the column is headed Approval Date", () => {
        expect(RECORD_COLUMNS.find((c) => c.id === "date")?.title).toBe("Approval Date");
    });

    it("names each ledger in the singular, and passes an unknown one through unchanged", () => {
        expect(ledgerLabel("Project Payments")).toBe("Project Payment");
        expect(ledgerLabel("Non Project Expenses")).toBe("Non Project Expense");
        expect(ledgerLabel("Something Else")).toBe("Something Else");
    });

    it("declares every column the reviewer picks a record by", () => {
        // ⚠️ FIVE, NOT SIX (owner ruling 2026-08-10). The ledger label used to be its own `type`
        // column and the six pushed AMOUNT off the right edge -- so the one fact that decides
        // whether a record can be settled needed a horizontal scroll to reach. The label now
        // stacks above the id it qualifies inside `record`.
        expect(RECORD_COLUMNS.map((c) => c.id)).toEqual([
            "record",
            "vendor",
            "project",
            "date",
            "amount",
        ]);
    });

    it("keeps the whole table inside the dialog without horizontal scroll", () => {
        // The dialog is 960px wide with ~48px of padding and a ~36px radio column. If the columns
        // outgrow that, Amount is the one that falls off -- which is what this change fixed.
        const total = RECORD_COLUMNS.reduce((sum, c) => sum + parseInt(c.width, 10), 0);
        expect(total).toBeLessThanOrEqual(960 - 48 - 36);
    });

    it("gives every column a fixed width, so the header and the scrolling body stay in step", () => {
        for (const column of RECORD_COLUMNS) {
            expect(column.width).toMatch(/^\d+px$/);
        }
    });
});

describe("confirmFunnel", () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `r${i}` }));

    it("reports what the summary panel's button counts as ready plus stale", () => {
        // The defect this exists for: the button read 688 and the dialog listed fewer, with nothing
        // accounting for the gap. `confirmable` is the button's number, reconstructed here.
        const funnel = confirmFunnel({
            matched_rows: 10,
            ready: rows(6),
            stale: rows(2),
            needs_you: rows(2),
        });
        expect(funnel.confirmable).toBe(8);
        expect(funnel.ready).toBe(6);
        expect(funnel.stale).toBe(2);
        expect(funnel.needsYou).toBe(2);
    });

    it("keeps the three buckets partitioning the matched rows", () => {
        const funnel = confirmFunnel({
            matched_rows: 10,
            ready: rows(6),
            stale: rows(2),
            needs_you: rows(2),
        });
        expect(funnel.ready + funnel.stale + funnel.needsYou).toBe(funnel.matched);
    });

    it("falls back to the sum when the server sends no matched total", () => {
        // An absent total must read as "all of them", never as "there are none" -- a 0 here would
        // make the dialog claim nothing matched while listing rows underneath it.
        const funnel = confirmFunnel({ ready: rows(3), stale: rows(1), needs_you: rows(1) });
        expect(funnel.matched).toBe(5);
    });

    it("is all zeroes on an absent payload rather than throwing", () => {
        expect(confirmFunnel(undefined)).toEqual({
            matched: 0,
            confirmable: 0,
            ready: 0,
            needsYou: 0,
            stale: 0,
        });
    });
});

describe("settleBlocker", () => {
    it("blocks a record the server marked unsettleable, and reports the gap", () => {
        const block = settleBlocker(
            { name: "i87sop52n3", amount: 26000, suggested: false },
            245000
        );
        expect(block).toEqual({
            kind: "amount_outside_window",
            // The record is SMALLER than the transfer, and no doctype was sent -- so the direction
            // reason, never the ledger one. See the fail-open case below.
            reason: "bank_paid_more",
            recordName: "i87sop52n3",
            recordAmount: 26000,
            bankAmount: 245000,
            difference: -219000,
        });
    });

    it("keeps the difference SIGNED, so an overpayment is distinguishable", () => {
        // Negative = the bank moved MORE than the record is for. The dialog shows the magnitude,
        // but the sign is the difference between "we underpaid" and "we overpaid" for anyone who
        // later reads this value.
        expect(settleBlocker({ name: "P", amount: 100, suggested: false }, 90)!.difference).toBe(10);
        expect(settleBlocker({ name: "P", amount: 90, suggested: false }, 100)!.difference).toBe(-10);
    });

    it("does not block a record the server accepts", () => {
        expect(settleBlocker({ name: "PAY-1", amount: 86553, suggested: true }, 86553)).toBeNull();
    });

    it("FAILS OPEN when the server did not send the flag", () => {
        // ⚠️ THE LOAD-BEARING CASE. `suggested` absent means "the server did not say", and blocking
        // on that would make a valid record unconfirmable from the screen with no way to override --
        // strictly worse than letting the server refuse it out loud. Only an explicit `false` blocks.
        expect(settleBlocker({ name: "PAY-1", amount: 100 }, 999999)).toBeNull();
        expect(settleBlocker({ name: "PAY-1", amount: 100, suggested: undefined }, 1)).toBeNull();
    });

    it("does not block when nothing is picked", () => {
        expect(settleBlocker(null, 1000)).toBeNull();
        expect(settleBlocker(undefined, 1000)).toBeNull();
    });
});

describe("settleBlockReason / settleBlockText — WHY this pick cannot be settled (D1)", () => {
    const blocked = (over: Record<string, unknown>, bank: number) =>
        settleBlocker({ name: "P", amount: 100, suggested: false, ...over }, bank)!;

    it("names an overpayment when the bank moved more than the record is for", () => {
        expect(blocked({ amount: 26000, target_doctype: "Project Payments" }, 245000).reason).toBe(
            "bank_paid_more"
        );
        // The ledger does not change this one -- the direction is the useful fact either way.
        expect(blocked({ amount: 26000, target_doctype: "Project Expenses" }, 245000).reason).toBe(
            "bank_paid_more"
        );
    });

    it("names the expense rule when a LARGER record is an expense", () => {
        expect(blocked({ amount: 500000, target_doctype: "Project Expenses" }, 200000).reason).toBe(
            "expense_exact_only"
        );
        expect(
            blocked({ amount: 500000, target_doctype: "Non Project Expenses" }, 200000).reason
        ).toBe("expense_exact_only");
    });

    it("falls back to the payment case for a LARGER payment", () => {
        // Ordinarily this shape opens the two-answer partial dialog instead; it reaches the
        // dead-end branch only with SHOW_PARTIAL_SETTLE off, and must still say something true.
        expect(blocked({ amount: 500000, target_doctype: "Project Payments" }, 200000).reason).toBe(
            "record_larger"
        );
    });

    it("⚠️ NEVER READS AN ABSENT target_doctype AS AN EXPENSE", () => {
        // The load-bearing fail-open, matching `suggested`'s. An older payload would otherwise be
        // told "an expense can only be settled at its exact amount" about a payment -- confident,
        // specific, and wrong.
        expect(blocked({ amount: 500000 }, 200000).reason).toBe("record_larger");
        expect(blocked({ amount: 500000, target_doctype: undefined }, 200000).reason).toBe(
            "record_larger"
        );
    });

    it("guards a non-positive amount BEFORE asking about direction", () => {
        expect(blocked({ amount: 0 }, 200000).reason).toBe("not_positive");
        expect(blocked({ amount: -500 }, 200000).reason).toBe("not_positive");
        expect(blocked({ amount: 500000 }, 0).reason).toBe("not_positive");
        expect(blocked({ amount: 500000 }, -200000).reason).toBe("not_positive");
    });

    it("gives every reason its own non-empty sentence, and none of them mention TDS", () => {
        const reasons = [
            blocked({ amount: 26000 }, 245000),
            blocked({ amount: 500000, target_doctype: "Project Expenses" }, 200000),
            blocked({ amount: 500000, target_doctype: "Project Payments" }, 200000),
            blocked({ amount: 0 }, 200000),
        ];
        const texts = reasons.map(settleBlockText);
        expect(new Set(texts).size).toBe(4);
        for (const text of texts) expect(text.length).toBeGreaterThan(0);

        // ⚠️ THE REGRESSION THIS SLICE EXISTS FOR. The old fixed paragraph told the reviewer to
        // settle a TDS deduction "in the payments screen", and slice TD made that false without
        // touching the sentence. It must not come back, in any of the four.
        for (const text of texts) expect(text).not.toMatch(/TDS/i);
        // `SHOW_CREATE_NEW_EXPENSE` is false, so that route is not on this dialog either.
        for (const text of texts) expect(text).not.toMatch(/new expense/i);
    });

    it("carries no amounts, so the figures live in exactly one place on screen", () => {
        // The dialog's first paragraph already prints the record, the bank figure and the
        // difference. A number repeated here would be a second copy free to drift.
        for (const block of [
            blocked({ amount: 26000 }, 245000),
            blocked({ amount: 500000, target_doctype: "Project Expenses" }, 200000),
        ]) {
            expect(settleBlockText(block)).not.toMatch(/\d/);
        }
    });

    it("is empty for no block at all", () => {
        expect(settleBlockText(null)).toBe("");
        expect(settleBlockText(undefined)).toBe("");
    });

    it("⚠️ the LEDGER reason and partialOffer's ledger bail cover the same set", () => {
        // These two read the same field for opposite purposes: `partialOffer` returns null on a
        // non-payment ledger, and `settleBlockReason` prints the expense sentence for it. If they
        // ever drifted apart the dialog would explain a refusal that had not happened, or offer a
        // split the endpoint would reject. Sharing `PROJECT_PAYMENTS_DOCTYPE` is what holds it;
        // this pins that it stays held.
        const larger = { name: "P", amount: 500000, suggested: false as const };
        for (const target_doctype of ["Project Expenses", "Non Project Expenses"]) {
            expect(partialOffer({ ...larger, target_doctype }, 200000)).toBeNull();
            expect(settleBlocker({ ...larger, target_doctype }, 200000)!.reason).toBe(
                "expense_exact_only"
            );
        }
        // And the payment ledger is the other way round on both.
        const payment = { ...larger, target_doctype: "Project Payments" };
        expect(partialOffer(payment, 200000)).not.toBeNull();
        expect(settleBlocker(payment, 200000)!.reason).toBe("record_larger");
    });
});

describe("describeFrappeError", () => {
    const serverMessages = (...items: object[]) =>
        JSON.stringify(items.map((i) => JSON.stringify(i)));

    it("prefers the server's own sentence over Frappe's generic envelope", () => {
        // THE DEFECT THIS EXISTS FOR. Frappe answers a `frappe.throw` with HTTP 417 and
        // `message: "There was an error."`; every call site read `.message`, so a live confirm
        // failure rendered as that string and could not be diagnosed from the screen at all.
        const err = {
            httpStatus: 417,
            message: "There was an error.",
            _server_messages: serverMessages({
                title: "Already settled",
                message: "PAY-00107-024 was already marked Paid. Refresh to see who settled it.",
            }),
        };
        expect(describeFrappeError(err)).toBe(
            "Already settled: PAY-00107-024 was already marked Paid. Refresh to see who settled it."
        );
    });

    it("never returns the generic placeholder on its own", () => {
        expect(describeFrappeError({ message: "There was an error." }, "Could not settle.")).toBe(
            "Could not settle."
        );
    });

    it("drops a title that only repeats the message", () => {
        const err = {
            _server_messages: serverMessages({
                title: "Not permitted",
                message: "Not permitted: this module is limited to Accountants and Admins.",
            }),
        };
        expect(describeFrappeError(err)).toBe(
            "Not permitted: this module is limited to Accountants and Admins."
        );
    });

    it("joins several server messages rather than showing only the first", () => {
        const err = {
            _server_messages: serverMessages({ message: "First." }, { message: "Second." }),
        };
        expect(describeFrappeError(err)).toBe("First. Second.");
    });

    it("strips the HTML Frappe puts in its messages", () => {
        const err = { _server_messages: serverMessages({ message: "Row <b>3</b><br>failed." }) };
        expect(describeFrappeError(err)).toBe("Row 3 failed.");
    });

    it("falls back to the exception class and text when nothing was thrown deliberately", () => {
        // An UNCAUGHT error. Nobody wrote it for a reader, but the class beats a generic string and
        // tells them a stack trace is waiting in the Error Log.
        const err = {
            message: "There was an error.",
            exception: "frappe.exceptions.ValidationError: Amounts differ by 412.00",
        };
        expect(describeFrappeError(err)).toBe("ValidationError: Amounts differ by 412.00");
    });

    it("keeps a real message that is not the placeholder", () => {
        expect(describeFrappeError(new Error("Network request failed"))).toBe(
            "Network request failed"
        );
    });

    it("names the HTTP status when the envelope is empty", () => {
        // Still says something: 417 vs 403 vs 500 tells a reader whether to look at the rule, the
        // permission, or the log.
        expect(
            describeFrappeError({ httpStatus: 403, httpStatusText: "FORBIDDEN" }, "Could not settle.")
        ).toBe("Could not settle. (HTTP 403 FORBIDDEN)");
    });

    it("survives junk instead of throwing on top of the error it is describing", () => {
        expect(describeFrappeError(undefined, "Could not settle.")).toBe("Could not settle.");
        expect(describeFrappeError({ _server_messages: "not json" }, "Could not settle.")).toBe(
            "Could not settle."
        );
        expect(describeFrappeError({ _server_messages: "[\"plain string\"]" })).toBe("plain string");
    });
});

describe("statementDebit", () => {
    it("foots gross and charges into the total that left the account", () => {
        expect(statementDebit({ gross_amount: 2_10_95_243, charges_amount: 4_720 })).toEqual({
            gross: 2_10_95_243,
            charges: 4_720,
            total: 2_10_99_963,
        });
    });

    it("treats a missing figure as zero, never as NaN", () => {
        // A NaN reaches the screen as "₹NaN" on a money figure, which is worse than a wrong number
        // because it looks like the feature is broken rather than the data being absent.
        expect(statementDebit({}).total).toBe(0);
        expect(statementDebit({ gross_amount: 100 }).total).toBe(100);
    });
});

describe("previewCounts", () => {
    it("keeps the two exclusions on separate axes", () => {
        const counts = previewCounts({
            total_rows: 1043,
            successful_rows: 1016,
            failed_rows: 27,
            duplicate_rows: 20,
            new_rows: 1023,
        });
        expect(counts).toEqual({
            total: 1043,
            successful: 1016,
            failed: 27,
            duplicates: 20,
            newRows: 1023,
        });
    });

    it("derives successful from the failed count when the server omits it", () => {
        const counts = previewCounts({ total_rows: 10, failed_rows: 3 });
        expect(counts.successful).toBe(7);
    });

    it("never returns a negative successful count", () => {
        expect(previewCounts({ total_rows: 0, failed_rows: 5 }).successful).toBe(0);
    });
});

// ------------------------------------------------------------------------------------------------
// tabCountParts -- one tab holds two statuses, so one number there means two things
// ------------------------------------------------------------------------------------------------

describe("tabCountParts", () => {
    // ⚠️ `skipped` IS A SCOPE WITH NO TAB. It rides `tab_counts` because every count derives from
    // `_SCOPE_STATUSES`, and it must never appear in the tab strip -- pinned below.
    const tabCounts = { all: 996, not_matched: 133, matched: 863, skipped: 47 };
    const statusCounts = {
        "Pending match run": 0,
        Matched: 863,
        Mismatched: 133,
        Settled: 0,
        Skipped: 47,
        Error: 0,
    };

    it("gives the two single-status tabs one number, unchanged", () => {
        expect(tabCountParts("all", tabCounts, statusCounts)).toEqual([{ key: "all", count: 996 }]);
        expect(tabCountParts("notMatched", tabCounts, statusCounts)).toEqual([
            { key: "not_matched", count: 133 },
        ]);
    });

    it("splits the matched tab, because one number there reads as the terminal half", () => {
        const parts = tabCountParts("matched", tabCounts, statusCounts);
        expect(parts.map((p) => [p.label, p.count])).toEqual([
            ["matched", 863],
            ["settled", 0],
        ]);
    });

    it("the split still adds up to the tab it labels", () => {
        const parts = tabCountParts("matched", tabCounts, statusCounts);
        expect(parts.reduce((n, p) => n + (p.count ?? 0), 0)).toBe(tabCounts.matched);
    });

    // The live shape that started this: 863 under a tab whose second word means finished, while
    // nothing at all had been settled.
    it("says zero settled rather than leaving it to be inferred", () => {
        const parts = tabCountParts("matched", tabCounts, statusCounts);
        expect(parts[1]).toMatchObject({ label: "settled", count: 0 });
    });

    it("falls back to the single total when the server sends no status counts", () => {
        expect(tabCountParts("matched", tabCounts, undefined)).toEqual([
            { key: "matched", count: 863 },
        ]);
    });

    it("reports an unanswered page as null, never as zero", () => {
        expect(tabCountParts("all", undefined, undefined)[0].count).toBeNull();
    });

    // ⚠️ THE OWNER RULING, PINNED IN THE ONE PLACE THE TWO VOCABULARIES MEET. Skipped rows have a
    // scope so the dialog can ask for them by name; they must never acquire a tab.
    it("no tab maps to the skipped scope", () => {
        expect(Object.values(SCOPE_FOR_TAB)).not.toContain("skipped");
    });

    it("the tab strip never renders a skipped count", () => {
        for (const tab of OUTFLOW_TABS) {
            const parts = tabCountParts(tab.id, tabCounts, statusCounts);
            expect(parts.map((p) => p.count)).not.toContain(tabCounts.skipped);
        }
    });
});

// ------------------------------------------------------------------------------------------------
// the confirm rollup (S4) -- vendor -> project -> transfer
// ------------------------------------------------------------------------------------------------

const cr = (over: Partial<ConfirmableRow> & { name: string }): ConfirmableRow => ({
    amount: 1000,
    target_doctype: "Project Payments",
    target_name: `PAY-${over.name}`,
    vendor_name: "Acme",
    project_name: "Alpha",
    ...over,
});

describe("buildConfirmTree", () => {
    it("groups by vendor then project", () => {
        const tree = buildConfirmTree([
            cr({ name: "1", vendor_name: "Acme", project_name: "Alpha" }),
            cr({ name: "2", vendor_name: "Acme", project_name: "Beta" }),
            cr({ name: "3", vendor_name: "Bolt", project_name: "Alpha" }),
        ]);
        expect(tree.map((v) => v.vendor).sort()).toEqual(["Acme", "Bolt"]);
        const acme = tree.find((v) => v.vendor === "Acme")!;
        expect(acme.projects.map((p) => p.project).sort()).toEqual(["Alpha", "Beta"]);
    });

    // The measured shape: 147 of 210 vendors sit on exactly one project.
    it("marks a single-project vendor so the level can read inline instead of expanding", () => {
        const tree = buildConfirmTree([
            cr({ name: "1", vendor_name: "Acme", project_name: "Alpha" }),
            cr({ name: "2", vendor_name: "Acme", project_name: "Alpha" }),
        ]);
        expect(tree[0].soleProject).toBe("Alpha");
    });

    it("keeps the project level when it carries information", () => {
        const tree = buildConfirmTree([
            cr({ name: "1", vendor_name: "Acme", project_name: "Alpha" }),
            cr({ name: "2", vendor_name: "Acme", project_name: "Beta" }),
        ]);
        expect(tree[0].soleProject).toBeNull();
        expect(tree[0].projects).toHaveLength(2);
    });

    it("totals the BANK amount at every level, never the record's", () => {
        const tree = buildConfirmTree([
            cr({ name: "1", amount: 100, target_amount: 999 }),
            cr({ name: "2", amount: 250, target_amount: 999 }),
        ]);
        expect(tree[0].value).toBe(350);
        expect(tree[0].projects[0].value).toBe(350);
    });

    it("orders vendors by value, largest first", () => {
        const tree = buildConfirmTree([
            cr({ name: "1", vendor_name: "Small", amount: 10 }),
            cr({ name: "2", vendor_name: "Big", amount: 900 }),
        ]);
        expect(tree.map((v) => v.vendor)).toEqual(["Big", "Small"]);
    });

    it("is stable across renders when two branches tie on value", () => {
        const rows = [
            cr({ name: "1", vendor_name: "Zeta", amount: 100 }),
            cr({ name: "2", vendor_name: "Alpha", amount: 100 }),
        ];
        expect(buildConfirmTree(rows).map((v) => v.vendor)).toEqual(
            buildConfirmTree([...rows].reverse()).map((v) => v.vendor)
        );
    });

    // Non Project Expenses carry neither, and must still be reachable.
    it("buckets a row with no vendor and no project rather than dropping it", () => {
        const tree = buildConfirmTree([
            cr({ name: "1", vendor_name: null, project_name: null }),
        ]);
        expect(tree).toHaveLength(1);
        expect(tree[0].rows).toHaveLength(1);
    });

    it("a vendor's rows are every leaf beneath it", () => {
        const tree = buildConfirmTree([
            cr({ name: "1", project_name: "Alpha" }),
            cr({ name: "2", project_name: "Beta" }),
        ]);
        expect(tree[0].rows.map((r) => r.name).sort()).toEqual(["1", "2"]);
    });
});

describe("nodeSelectionState", () => {
    const rows = [cr({ name: "1" }), cr({ name: "2" })];

    it("reads none, some and all off the leaves", () => {
        expect(nodeSelectionState(rows, new Set())).toBe("none");
        expect(nodeSelectionState(rows, new Set(["1"]))).toBe("some");
        expect(nodeSelectionState(rows, new Set(["1", "2"]))).toBe("all");
    });

    it("an empty node is not selected", () => {
        expect(nodeSelectionState([], new Set(["1"]))).toBe("none");
    });

    // A parent with stored state goes stale the moment a leaf changes by any other route.
    it("is derived, so a leaf toggled underneath changes the parent", () => {
        const selected = new Set(["1", "2"]);
        selected.delete("2");
        expect(nodeSelectionState(rows, selected)).toBe("some");
    });
});

describe("toggleNode", () => {
    const rows = [cr({ name: "1" }), cr({ name: "2" })];

    it("selects everything under an unselected node", () => {
        expect([...toggleNode(rows, new Set())].sort()).toEqual(["1", "2"]);
    });

    it("clears everything under a fully selected node", () => {
        expect([...toggleNode(rows, new Set(["1", "2"]))]).toEqual([]);
    });

    it("a half-selected node fills up rather than emptying", () => {
        expect([...toggleNode(rows, new Set(["1"]))].sort()).toEqual(["1", "2"]);
    });

    it("never touches a row outside the node", () => {
        const next = toggleNode(rows, new Set(["elsewhere"]));
        expect(next.has("elsewhere")).toBe(true);
    });

    it("returns a new set rather than mutating", () => {
        const before = new Set<string>();
        toggleNode(rows, before);
        expect(before.size).toBe(0);
    });
});

describe("confirmSelectionSummary", () => {
    const all = [
        cr({ name: "1", vendor_name: "Acme", project_name: "Alpha", amount: 100, amount_changes: true }),
        cr({ name: "2", vendor_name: "Acme", project_name: "Beta", amount: 200 }),
        cr({ name: "3", vendor_name: "Bolt", project_name: "Alpha", amount: 300 }),
    ];

    it("counts transfers, vendors, projects and the bank value", () => {
        const s = confirmSelectionSummary(all, all, new Set(["1", "2", "3"]));
        expect(s).toMatchObject({ transfers: 3, vendors: 2, projects: 3, value: 600 });
    });

    it("counts the same project under two vendors separately", () => {
        const s = confirmSelectionSummary(all, all, new Set(["1", "3"]));
        expect(s.projects).toBe(2);
    });

    // The figure that exists nowhere else on the screen.
    it("counts how many confirms will rewrite an approved amount", () => {
        expect(confirmSelectionSummary(all, all, new Set(["1", "2"])).amountsChanging).toBe(1);
    });

    // Filter to one vendor, read "12 transfers", confirm 142.
    it("reports selected rows the filter is hiding", () => {
        const visible = [all[0]];
        const s = confirmSelectionSummary(all, visible, new Set(["1", "2", "3"]));
        expect(s.transfers).toBe(3);
        expect(s.hidden).toBe(2);
    });

    it("nothing hidden when the selection is entirely on screen", () => {
        expect(confirmSelectionSummary(all, all, new Set(["1"])).hidden).toBe(0);
    });

    it("an empty selection totals nothing", () => {
        expect(confirmSelectionSummary(all, all, new Set())).toMatchObject({
            transfers: 0,
            value: 0,
            hidden: 0,
        });
    });
});

describe("filterConfirmRows", () => {
    const rows = [
        // ⚠️ `sole` IS A STORED VALUE SINCE T1, not a blank. Blank now means "no suggestion" and
        // nothing else — before that, this row and a stack-paired one were indistinguishable.
        cr({ name: "1", vendor_name: "Rich Fasteners", project_name: "Alorica",
             order_name: "PO/082/00103/26-27", suggestion_rule: "sole", amount_changes: true }),
        cr({ name: "2", vendor_name: "Bolt", project_name: "Beta",
             order_name: "SR-00097-000845", suggestion_rule: "interchangeable" }),
        cr({ name: "3", vendor_name: "Bolt", project_name: "Beta",
             target_doctype: "Project Expenses", suggestion_rule: "nearest-amount" }),
    ];
    const f = (over: Partial<typeof EMPTY_CONFIRM_FILTERS>) =>
        filterConfirmRows(rows, { ...EMPTY_CONFIRM_FILTERS, ...over });

    it("no filters keeps everything", () => {
        expect(f({})).toHaveLength(3);
    });

    it("searches the vendor", () => {
        expect(f({ search: "rich" }).map((r) => r.name)).toEqual(["1"]);
    });

    it("searches the order number", () => {
        expect(f({ search: "00097" }).map((r) => r.name)).toEqual(["2"]);
    });

    it("searches the project", () => {
        expect(f({ search: "alorica" }).map((r) => r.name)).toEqual(["1"]);
    });

    it("filters by ledger", () => {
        expect(f({ ledger: "Project Expenses" }).map((r) => r.name)).toEqual(["3"]);
    });

    it("isolates rows a rule picked, and a sole match is not one", () => {
        expect(f({ pickedBy: "rule" }).map((r) => r.name)).toEqual(["2", "3"]);
    });

    it("isolates rows that were simply the only candidate", () => {
        expect(f({ pickedBy: "sole" }).map((r) => r.name)).toEqual(["1"]);
    });

    // ⚠️ THE SET WORTH OPENING, and the reason `rule` is not it. Both members chose between records
    // nothing distinguished; `nearest-amount` acted on evidence and does not belong here.
    it("isolates only the picks that were arbitrary", () => {
        expect(f({ pickedBy: "arbitrary" }).map((r) => r.name)).toEqual(["2"]);
    });

    it("a stack pairing is arbitrary and is never filed as the only candidate", () => {
        const stacked = [cr({ name: "9", suggestion_rule: "stack-pairing" })];
        expect(filterConfirmRows(stacked, { ...EMPTY_CONFIRM_FILTERS, pickedBy: "sole" })).toEqual([]);
        expect(
            filterConfirmRows(stacked, { ...EMPTY_CONFIRM_FILTERS, pickedBy: "arbitrary" })
        ).toHaveLength(1);
    });

    it("isolates one specific rule", () => {
        expect(f({ pickedBy: "interchangeable" }).map((r) => r.name)).toEqual(["2"]);
    });

    it("isolates the confirms that will rewrite an amount", () => {
        expect(f({ changesOnly: true }).map((r) => r.name)).toEqual(["1"]);
    });

    it("composes as AND across the facets", () => {
        expect(f({ search: "bolt", pickedBy: "interchangeable" }).map((r) => r.name)).toEqual(["2"]);
    });

    it("counts the active narrowings", () => {
        expect(confirmFilterCount(EMPTY_CONFIRM_FILTERS)).toBe(0);
        expect(confirmFilterCount({ ...EMPTY_CONFIRM_FILTERS, search: " ", ledger: "x" })).toBe(1);
    });

    // Rebuilding the tree from surviving ROWS is what keeps every node count true.
    it("a vendor whose own name matches is dropped when none of its rows do", () => {
        const kept = filterConfirmRows(rows, {
            ...EMPTY_CONFIRM_FILTERS,
            search: "bolt",
            ledger: "Project Payments",
        });
        expect(buildConfirmTree(kept).map((v) => v.vendor)).toEqual(["Bolt"]);
        expect(buildConfirmTree(kept)[0].rows).toHaveLength(1);
    });
});

describe("orderLabel", () => {
    it("labels a Procurement Order PO", () => {
        expect(orderLabel({ order_doctype: "Procurement Orders", order_name: "PO/1" }))
            .toEqual({ kind: "PO", name: "PO/1" });
    });

    // A quarter of the payments on a real statement. Calling this a PO would be wrong.
    it("labels a Service Request SR", () => {
        expect(orderLabel({ order_doctype: "Service Requests", order_name: "SR-1" })?.kind)
            .toBe("SR");
    });

    it("is absent when the record has no order at all", () => {
        expect(orderLabel({ order_doctype: null, order_name: null })).toBeNull();
        expect(orderLabel({ order_doctype: "Procurement Orders", order_name: "  " })).toBeNull();
    });

    it("never guesses from the id format when the type is unknown", () => {
        expect(orderLabel({ order_doctype: "", order_name: "PO/1" })?.kind).toBe("Order");
    });
});

describe("serverQuery — the skipped split", () => {
    // ⚠️ TWO CORRECT NUMBERS THAT DISAGREED. The summary chip counted 20 skipped, the `skipped`
    // scope returns 47, and the difference is the 27 the bank refused — excluded from every summary
    // FIGURE by owner ruling while still carrying `row_status` Skipped.
    it("asks for neither half by default", () => {
        expect(serverQuery({ scope: "skipped" }).failed).toBeUndefined();
    });

    it("asks for the refused half", () => {
        expect(serverQuery({ scope: "skipped", filters: { failed: "failed" } }).failed).toBe(true);
    });

    it("asks for everything else", () => {
        expect(serverQuery({ scope: "skipped", filters: { failed: "recorded" } }).failed).toBe(false);
    });

    // `false` and "absent" are different questions; sending one for the other would silently drop
    // the 27 from a list that exists to hold them.
    it("an empty choice is absent, never false", () => {
        expect(serverQuery({ scope: "skipped", filters: { failed: "" } }).failed).toBeUndefined();
    });

    it("counts as an active filter so the clear control appears", () => {
        expect(activeFilterCount({ failed: "failed" })).toBe(1);
        expect(activeFilterCount({ failed: "" })).toBe(0);
    });
});

describe("matchBasisLabel", () => {
    it("blank reads as nothing", () => {
        expect(matchBasisLabel(null)).toBe("");
    });

    it("names the tiers", () => {
        expect(matchBasisLabel("account+IFSC")).toBe("Vendor bank account");
        expect(matchBasisLabel("project in remark")).toBe("Amount + project in remark");
    });

    it("falls back to the raw id for a tier this mirror has not learned", () => {
        expect(matchBasisLabel("some-new-tier")).toBe("some-new-tier");
    });
});

describe("suggestionRuleLabel", () => {
    it("blank means the ordinary case and reads as nothing", () => {
        expect(suggestionRuleLabel(null)).toBe("");
        expect(suggestionRuleLabel("  ")).toBe("");
    });

    it("names the known rules", () => {
        expect(suggestionRuleLabel("interchangeable")).toBe("Interchangeable records");
        expect(suggestionRuleLabel("sole")).toBe("Only candidate");
        expect(suggestionRuleLabel("stack-pairing")).toBe("Identical set, paired arbitrarily");
    });

    // Parity with services/outflow_import/disambiguate.RULE_LABELS -- the backend is the authority.
    it("knows every rule the arbitrary set names", () => {
        for (const rule of ARBITRARY_SUGGESTION_RULES) {
            expect(SUGGESTION_RULE_LABELS[rule]).toBeTruthy();
        }
    });

    // A rule shipped server-side that this mirror has not learned must not render as "no rule".
    it("falls back to the raw id rather than to an empty chip", () => {
        expect(suggestionRuleLabel("brand-new-rule")).toBe("brand-new-rule");
    });
});

// --- the period, and the filter it IS (slice P1) --------------------------------------------------

describe("the period column", () => {
    it("is a date filter, not a facet", () => {
        // ⚠️ IT SHIPPED AS `facet`, WHICH IS THE DEFECT THIS FIXES. A facet offers a tick box per
        // DISTINCT VALUE -- one per calendar day the table touches, growing without limit -- and it
        // cannot express "everything after the 14th" at all.
        const column = OUTFLOW_COLUMNS.find((c) => c.id === PERIOD_COLUMN_ID);
        expect(column?.filter).toBe("date");
    });

    it("is not offered as a server FACET column, or the funnel would fetch dates to tick", () => {
        expect(SERVER_FACET_COLUMNS).not.toContain(PERIOD_COLUMN_ID);
    });
});

describe("isDateFilterValue", () => {
    it("tells a date filter apart from every other filter shape", () => {
        expect(isDateFilterValue({ operator: "Is", value: "2026-07-01" })).toBe(true);
        expect(isDateFilterValue(["a", "b"])).toBe(false); // facet
        expect(isDateFilterValue("contains")).toBe(false); // text
        expect(isDateFilterValue({ min: 1, max: 2 })).toBe(false); // range
        expect(isDateFilterValue(undefined)).toBe(false);
    });
});

describe("activeFilterCount with a period", () => {
    // ⚠️ A REAL PERIOD, NEVER `DEFAULT_PERIOD`. The default became `null` on 2026-08-12, and
    // `activeFilterCount` skips every null filter before it ever reaches the period rule -- so a
    // test written against the default would pass whether the exclusion existed or not. It has to
    // be a period that WOULD otherwise count.
    const A_REAL_PERIOD = { operator: "Timespan", value: "last 30 days" } as const;

    it("EXCLUDES the period, so the badge does not count the screen's own scope", () => {
        // It has a large, always-visible control of its own stating exactly what it is -- which is
        // the thing a badge exists to substitute for.
        expect(activeFilterCount({ [PERIOD_COLUMN_ID]: A_REAL_PERIOD })).toBe(0);
    });

    it("still counts every other filter beside it", () => {
        expect(
            activeFilterCount({
                [PERIOD_COLUMN_ID]: A_REAL_PERIOD,
                beneficiary_name: ["ACME"],
                amount: { min: 100 },
            })
        ).toBe(2);
    });

    it("counts the SAME VALUE under a different column, so the exclusion is the COLUMN", () => {
        // Proves the zero above comes from the period rule and not from the value's shape.
        // ⚠️ `PERIOD_COLUMN_ID` IS `added_on` -- the Period control and the Payment Date column
        // funnel are two editors of ONE filter -- so there is no second real date column to test
        // against and this id is deliberately hypothetical. `activeFilterCount` is generic over
        // column ids and does not validate them, which is exactly what makes the point provable.
        expect(activeFilterCount({ some_other_column: A_REAL_PERIOD })).toBe(1);
    });
});

describe("serverQuery and the period", () => {
    it("resolves a Between into the endpoint's two bounds", () => {
        const query = serverQuery({
            tab: DEFAULT_TAB,
            filters: {
                [PERIOD_COLUMN_ID]: { operator: "Between", value: ["2026-07-01", "2026-07-31"] },
            },
        });
        expect(query.date_from).toBe("2026-07-01");
        expect(query.date_to).toBe("2026-07-31");
    });

    it("sends only the bound an open-ended filter actually has", () => {
        const query = serverQuery({
            tab: DEFAULT_TAB,
            filters: { [PERIOD_COLUMN_ID]: { operator: ">=", value: "2026-07-01" } },
        });
        expect(query.date_from).toBe("2026-07-01");
        expect(query.date_to).toBeUndefined();
    });

    it("resolves a timespan into DATES, because these endpoints do not speak Frappe timespans", () => {
        const query = serverQuery({
            tab: DEFAULT_TAB,
            filters: { [PERIOD_COLUMN_ID]: { operator: "Timespan", value: "today" } },
        });
        // Resolved against a live today, so assert the SHAPE and that the two agree rather than
        // pinning a date that is wrong tomorrow.
        expect(query.date_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(query.date_from).toBe(query.date_to);
    });

    it("sends no date at all when the period is cleared", () => {
        const query = serverQuery({ tab: DEFAULT_TAB, filters: {} });
        expect(query.date_from).toBeUndefined();
        expect(query.date_to).toBeUndefined();
    });
});

describe("importsCoveredLabel", () => {
    it("says nothing when there is nothing to say", () => {
        expect(importsCoveredLabel([])).toBe("");
    });

    it("agrees with itself about singular and plural", () => {
        expect(importsCoveredLabel([anImport()])).toBe("1 import");
        expect(importsCoveredLabel([anImport(), anImport({ name: "OFI-2" })])).toBe("2 imports");
    });
});

describe("rematchWarning", () => {
    it("names the imports the click will touch", () => {
        const warning = rematchWarning([anImport({ original_filename: "july.csv" })]);
        expect(warning).toContain("july.csv");
        expect(warning).toContain("1 import");
    });

    it("stays quiet about overspill when every row of every batch is in scope", () => {
        const warning = rematchWarning([anImport({ row_count: 40, total_rows: 40 })]);
        expect(warning).not.toContain("extend past");
    });

    it("says 'It extends', not '1 of them extend', for a single straddling import", () => {
        // ⚠️ FOUND IN THE BROWSER, NOT BY A TEST. The shipped wording read "1 of them extend past
        // this period" — broken grammar on the one sentence whose job is to warn that a button
        // reaches further than it looks, and "1 of them" is clumsy for a set of one.
        const warning = rematchWarning([anImport({ row_count: 10, total_rows: 40 })]);
        expect(warning).toContain("It extends past this period");
        expect(warning).not.toContain("of them extend");
    });

    it("agrees subject and verb when SOME of several imports straddle", () => {
        const warning = rematchWarning([
            anImport({ name: "OFI-1", row_count: 10, total_rows: 40 }),
            anImport({ name: "OFI-2", row_count: 5, total_rows: 5 }),
        ]);
        expect(warning).toContain("1 of them extends past this period");
    });

    it("uses the plural verb when several straddle", () => {
        const warning = rematchWarning([
            anImport({ name: "OFI-1", row_count: 10, total_rows: 40 }),
            anImport({ name: "OFI-2", row_count: 5, total_rows: 6 }),
        ]);
        expect(warning).toContain("2 of them extend past this period");
    });

    it("STATES the overspill when a statement straddles the period", () => {
        // ⚠️ THE WHOLE REASON THIS FUNCTION EXISTS. Matching runs per BATCH -- `match_batch`'s four
        // global passes reason over a whole import at once -- so a straddling statement is
        // re-matched in full. That is wider than the period implies, and the screen has to say so
        // BEFORE the click rather than after it.
        const warning = rematchWarning([anImport({ row_count: 10, total_rows: 40 })]);
        expect(warning).toContain("past this period");
        expect(warning).toContain("30 transfers");
    });

    it("adds up the overspill across several straddling statements", () => {
        const warning = rematchWarning([
            anImport({ name: "OFI-1", row_count: 10, total_rows: 40 }),
            anImport({ name: "OFI-2", row_count: 5, total_rows: 6 }),
        ]);
        expect(warning).toContain("31 transfers");
    });

    it("says so plainly when the period holds no imports at all", () => {
        expect(rematchWarning([])).toBe("No imports in this period.");
    });
});

function anImport(overrides: Partial<SummaryImport> = {}): SummaryImport {
    return {
        name: "OFI-26-00001",
        original_filename: "statement.csv",
        row_count: 10,
        total_rows: 10,
        ...overrides,
    };
}

describe("a pinned batch and the period", () => {
    /**
     * ⚠️ FOUND IN THE BROWSER, NOT BY A TEST, AND IT WAS THE WORST KIND OF WRONG. On
     * `/bulk-import-outflow/:id` the period control is HIDDEN, so a period left in the store by an
     * earlier visit kept narrowing the view with nothing on screen able to reveal or clear it. A
     * deep link to a 1,043-row statement reported 274 transfers under a panel headed "Showing
     * OFI-26-00289": every number wrong, everything looking right.
     *
     * `useOutflowRows` drops the period whenever a batch is pinned. That is a hook, so it is not
     * directly testable here — what IS testable is the contract underneath it: given no date filter,
     * `serverQuery` must send no date bound at all, so a pinned batch means the whole batch.
     */
    it("sends NO date bound when the period filter is absent", () => {
        const query = serverQuery({ tab: DEFAULT_TAB, batch: "OFI-26-00289", filters: {} });
        expect(query.batch).toBe("OFI-26-00289");
        expect(query.date_from).toBeUndefined();
        expect(query.date_to).toBeUndefined();
    });

    it("would otherwise narrow a pinned batch, which is exactly the defect", () => {
        // The same call WITH a period proves the two are independent: nothing about `batch` cancels
        // a date server-side, which is why the hook has to withhold it.
        const query = serverQuery({
            tab: DEFAULT_TAB,
            batch: "OFI-26-00289",
            filters: { [PERIOD_COLUMN_ID]: { operator: "Between", value: ["2026-07-01", "2026-07-31"] } },
        });
        expect(query.date_from).toBe("2026-07-01");
    });
});

describe("importOptionLabel dates", () => {
    it("renders the period in the app's dd-MMM-yyyy, not raw ISO", () => {
        // ⚠️ FOUND IN THE BROWSER. The selector's label sat directly above a metadata line already
        // showing "02-May-2026", so the ISO form put two date conventions on one panel.
        const label = importOptionLabel({
            name: "OFI-26-00289",
            original_filename: "statement.csv",
            period_from: "2026-05-02",
            period_to: "2026-08-06",
        });
        expect(label).toBe("statement.csv · 02-May-2026 → 06-Aug-2026");
    });

    it("still falls back to the id when there is neither a file nor a period", () => {
        expect(importOptionLabel({ name: "OFI-26-00289" })).toBe("OFI-26-00289");
    });
});

describe("the candidates the match run could not separate (N3)", () => {
    it("keys a candidate on BOTH halves, because a name is not unique across ledgers", () => {
        // The live collision this prevents: a `Project Expenses` record and a `Project Payments`
        // record are free to share a name, and marking the wrong one points a reviewer at a record
        // the matcher never considered.
        const keys = candidateKeySet([
            { doctype: "Project Payments", name: "PAY-1" },
            { doctype: "Project Expenses", name: "PAY-1" },
        ]);
        expect(keys.size).toBe(2);
        expect(keys.has(recordKey({ target_doctype: "Project Payments", name: "PAY-1" }))).toBe(true);
        expect(keys.has(recordKey({ target_doctype: "Project Expenses", name: "PAY-1" }))).toBe(true);
    });

    it("an absent list is an empty set, never a crash", () => {
        // The dialog renders this while the fetch is still in flight, on every row it opens.
        expect(candidateKeySet(undefined).size).toBe(0);
        expect(candidateKeySet([]).size).toBe(0);
    });

    it("drops a half-formed candidate rather than minting a key that matches nothing", () => {
        expect(candidateKeySet([{ doctype: "Project Payments", name: "" }]).size).toBe(0);
        expect(candidateKeySet([{ doctype: "", name: "PAY-1" }]).size).toBe(0);
    });

    it("the line states what the match run FOUND, never what may be picked", () => {
        // ⚠️ THE WORDING IS A GUARD. `get_row_candidates` re-runs the match live and skips the
        // claim pass, so a marked record may already be held by another open row. Promising
        // availability would surface as a confirm failing with AlreadyPaidError after the click.
        const line = matcherCandidateLine(6);
        expect(line).toContain("The match run found 6 records");
        expect(line).not.toMatch(/can pick|may pick|available|choose from these/i);
    });

    it("stays silent below two, where there is nothing to choose between", () => {
        expect(matcherCandidateLine(0)).toBe("");
        expect(matcherCandidateLine(1)).toBe("");
        expect(matcherCandidateLine(2)).not.toBe("");
    });

    // ⚠️ THE `suppressOutcomeNote` TEST WAS DELETED WITH THE FUNCTION (slice D2). It pinned that
    // the stored `outcome_note` stood down exactly when this live line took over -- a rule that
    // needed two printers on one screen to mean anything. `WhyThisSuggestion` was the other
    // printer and is gone, so this line is now the only count the dialog shows and there is
    // nothing left for a threshold to agree with.
});

describe("partialOffer — may this transfer pay part of this record? (PS)", () => {
    const payment = (over: Record<string, unknown> = {}) => ({
        target_doctype: "Project Payments",
        amount: 500000,
        ...over,
    });

    it("offers the split when the record is larger by more than the settle window", () => {
        const offer = partialOffer(payment(), 200000);
        expect(offer).not.toBeNull();
        expect(offer!.keep).toBe(200000);
        expect(offer!.remainder).toBe(300000);
    });

    it("the kept amount is the bank's own figure, never rounded", () => {
        // The reviewer types nothing -- the bank already decided the amount. That is the biggest
        // safety difference from the CEO split, and rounding here would quietly undo it.
        const offer = partialOffer(payment({ amount: 18678.69 }), 12000.34);
        expect(offer!.keep).toBe(12000.34);
    });

    it("refuses an expense, which has no balance to carry", () => {
        for (const doctype of ["Project Expenses", "Non Project Expenses"]) {
            expect(partialOffer(payment({ target_doctype: doctype }), 200000)).toBeNull();
        }
    });

    it("refuses an overpayment, which is a different problem", () => {
        // Carving the record up to match money it never covered would be a wrong answer, not a
        // partial one.
        expect(partialOffer(payment({ amount: 200000 }), 500000)).toBeNull();
        expect(partialOffer(payment({ amount: 200000 }), 200000)).toBeNull();
    });

    it("refuses a gap inside the settle window, which Confirm already handles", () => {
        expect(partialOffer(payment({ amount: 200005 }), 200000)).toBeNull();
        expect(partialOffer(payment({ amount: 200005.01 }), 200000)).not.toBeNull();
    });

    it("refuses a refund or a zero", () => {
        expect(partialOffer(payment({ amount: -50000 }), 10000)).toBeNull();
        expect(partialOffer(payment({ amount: 50000 }), -10000)).toBeNull();
        expect(partialOffer(payment({ amount: 0 }), 10000)).toBeNull();
    });

    it("refuses a missing record rather than throwing inside a dialog", () => {
        expect(partialOffer(null, 200000)).toBeNull();
        expect(partialOffer(undefined, 200000)).toBeNull();
    });

    it("flags a TDS-shaped shortfall WITHOUT refusing it", () => {
        // ⚠️ THE LOAD-BEARING HALF. A 2% gap may genuinely be a 2% part payment, so the offer
        // stands and the reviewer is merely asked to look twice. Wiring the hint to a refusal
        // would convert a warning into a guess about money.
        const offer = partialOffer(payment(), 490000);
        expect(offer).not.toBeNull();
        expect(offer!.impliedPct).toBeCloseTo(2, 6);
        expect(offer!.tdsLike).toBe(true);
    });

    it("does not flag an ordinary part-payment fraction", () => {
        const offer = partialOffer(payment(), 200000);
        expect(offer!.tdsLike).toBe(false);
    });

    it("mirrors the server's gate, and the two intents are the server's strings", () => {
        // A typo here posts an intent the endpoint rejects -- which is the safe direction, but the
        // reviewer would see a refusal with no way to act on it.
        expect(INTENT_PART_PAYMENT).toBe("part_payment");
        expect(INTENT_DEDUCTION).toBe("deduction");
    });
});

describe("deductionOffer — may the shortfall be recorded as TDS? (TD)", () => {
    const service = (over: Record<string, unknown> = {}) => ({
        target_doctype: "Project Payments",
        amount: 100000,
        document_type: "Service Requests",
        ...over,
    });
    const shapeFor = (rec: any, bank: number) => partialOffer(rec, bank);

    it("a 1% shortfall on a service payment is recordable", () => {
        const rec = service();
        const offer = deductionOffer(rec, shapeFor(rec, 99000));
        expect(offer.eligible).toBe(true);
        expect(offer.tds).toBe(1000);
        expect(offer.impliedPct).toBeCloseTo(1, 6);
    });

    it("a 2% shortfall is recordable", () => {
        const rec = service({ amount: 200000 });
        expect(deductionOffer(rec, shapeFor(rec, 196000)).eligible).toBe(true);
    });

    it("a PO payment is refused, and the verdict SAYS SO rather than vanishing", () => {
        // ⚠️ THE SAFETY ARGUMENT. If this returned null/absent the screen would hide the option, and
        // a reviewer with a real 2% TDS on a materials PO would take "part payment" instead —
        // creating an approved balance for money nobody owes.
        const rec = service({ document_type: "Procurement Orders" });
        const offer = deductionOffer(rec, shapeFor(rec, 98000));
        expect(offer.eligible).toBe(false);
        expect(offer.refusal).toBe("not_service");
        expect(deductionRefusalText(offer)).toContain("service payments");
    });

    it("a rate outside the band is refused with its own reason", () => {
        const rec = service();
        for (const bank of [60000, 95000, 90000, 99900]) {
            const offer = deductionOffer(rec, shapeFor(rec, bank));
            expect(offer.eligible).toBe(false);
            expect(offer.refusal).toBe("rate_out_of_band");
        }
        expect(deductionRefusalText(deductionOffer(rec, shapeFor(rec, 60000)))).toContain("1–2%");
    });

    it("the band edges are inclusive and mirror the server", () => {
        const rec = service();
        expect(deductionOffer(rec, shapeFor(rec, 99050)).eligible).toBe(true);   // 0.95%
        expect(deductionOffer(rec, shapeFor(rec, 97950)).eligible).toBe(true);   // 2.05%
        expect(deductionOffer(rec, shapeFor(rec, 99060)).eligible).toBe(false);  // 0.94%
        expect(deductionOffer(rec, shapeFor(rec, 97940)).eligible).toBe(false);  // 2.06%
        expect(TDS_BAND_MIN_PCT).toBe(0.95);
        expect(TDS_BAND_MAX_PCT).toBe(2.05);
    });

    it("the upper edge survives float arithmetic that the server does in Decimal", () => {
        // ⚠️ THIS CAUGHT A REAL DIVERGENCE. 2050/100000*100 is exactly 2.05 in Python's Decimal and
        // 2.0500000000000003 in IEEE-754 — so a naive `> MAX` comparison greys out an option the
        // server accepts, on the very boundary the band is defined by. The mirror must never be
        // stricter than the server; see BAND_EDGE_EPSILON.
        const rec = service();
        expect((100000 - 97950) / 100000 * 100).toBeGreaterThan(2.05); // the float, stated plainly
        expect(deductionOffer(rec, shapeFor(rec, 97950)).eligible).toBe(true);
    });

    it("no shape means no deduction, and no reason to show either", () => {
        // The record is not larger than the transfer at all — the dialog is the pre-TD one.
        expect(deductionOffer(service(), null).eligible).toBe(false);
        expect(deductionOffer(service(), null).refusal).toBe("shape");
    });

    it("an expense can never carry a deduction", () => {
        const rec = service({ target_doctype: "Project Expenses", document_type: "" });
        expect(deductionOffer(rec, shapeFor(rec, 99000)).eligible).toBe(false);
    });

    it("a blank parent doctype is refused rather than assumed to be a service", () => {
        const rec = service({ document_type: "" });
        expect(deductionOffer(rec, shapeFor(rec, 99000)).refusal).toBe("not_service");
    });

    it("the derived TDS reconciles the transfer exactly", () => {
        // ⚠️ `bank = amount - tds` is the relation the whole ledger reads. Deriving the figure —
        // never typing it — is what keeps it true.
        for (const [amount, bank] of [[100000, 99000], [715757, 701441.86], [200000, 196000]]) {
            const rec = service({ amount });
            const offer = deductionOffer(rec, shapeFor(rec, bank));
            expect(offer.eligible).toBe(true);
            expect(amount - offer.tds).toBeCloseTo(bank, 2);
        }
    });
});
