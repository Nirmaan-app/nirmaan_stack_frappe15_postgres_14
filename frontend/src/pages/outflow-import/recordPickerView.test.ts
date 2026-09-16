// src/pages/outflow-import/recordPickerView.test.ts

import { describe, expect, it } from "vitest";

import { SETTLE_MODE_HINT, SETTLE_MODE_LABEL } from "./allocationView";
import type { SettleableRecord } from "./outflowTableModel";
import {
    BLANK_FACET_ID,
    EMPTY_FILTERS,
    NORMAL_NO_CANDIDATES_NOTE,
    RECORD_POOL_FAILED_NOTE,
    SPLIT_NO_CANDIDATES_NOTE,
    SPLIT_PAYMENTS_ONLY_NOTE,
    applyRecordFilters,
    splitCandidates,
    facetValues,
    hasActiveFilters,
    matchesText,
    nextSortState,
    parseAmountBound,
    reasonCaption,
    recordPoolMessage,
    recordPoolState,
    recordSortDate,
    sortRecords,
    visibleRecords,
    type RecordFilters,
} from "./recordPickerView";

const record = (over: Partial<SettleableRecord> = {}): SettleableRecord => ({
    target_doctype: "Project Payments",
    name: "PAY-1",
    amount: 10000,
    detail: "",
    suggested: true,
    vendor_name: "",
    project_name: "",
    document_name: "",
    vendor_nickname: "",
    contact_person: "",
    document_type: "",
    project: "",
    approved_on: "",
    updated_on: "",
    similarity: 0,
    similarity_reasons: [],
    ...over,
});

const filters = (over: Partial<RecordFilters> = {}): RecordFilters => ({
    ...EMPTY_FILTERS,
    ...over,
});

describe("the empty state passes everything through", () => {
    it("filters nothing when no filter is set", () => {
        const records = [record({ name: "A" }), record({ name: "B" })];
        expect(applyRecordFilters(records, EMPTY_FILTERS)).toHaveLength(2);
    });

    it("keeps the server's order when the sort is null", () => {
        // ⚠️ `null` IS THE SIMILARITY RANKING, not "unsorted". If this ever starts reordering, the
        // screen has quietly stopped showing the ranking it advertises.
        const records = [record({ name: "Z" }), record({ name: "A" })];
        expect(sortRecords(records, null).map((r) => r.name)).toEqual(["Z", "A"]);
    });

    it("EMPTY_FILTERS is a stable identity, not a fresh object", () => {
        // A factory here would give React a new default every render and defeat the memoisation
        // around this table.
        expect(EMPTY_FILTERS).toBe(EMPTY_FILTERS);
    });
});

describe("facet composition", () => {
    const records = [
        record({ name: "A", vendor_name: "Hakimi Hardware", project: "P1", project_name: "Telus" }),
        record({ name: "B", vendor_name: "Sri Sai", project: "P2", project_name: "Toshiba" }),
        record({ name: "C", target_doctype: "Non Project Expenses" }),
    ];

    it("offers a blank entry so a ledger with no vendor stays reachable", () => {
        // ⚠️ Without this, every Non Project Expense is visible in the list but impossible to
        // filter TO -- present, and unreachable.
        const { vendors, projects } = facetValues(records);
        expect(vendors.map((v) => v.id)).toContain(BLANK_FACET_ID);
        expect(projects.map((p) => p.id)).toContain(BLANK_FACET_ID);
    });

    it("puts the blank entry last rather than sorting it among real names", () => {
        const { vendors } = facetValues(records);
        expect(vendors[vendors.length - 1].id).toBe(BLANK_FACET_ID);
    });

    it("matches on the project id while displaying the project name", () => {
        // "Filter on the label, match on the id" -- renaming a project must not empty a live filter.
        const { projects } = facetValues(records);
        expect(projects.find((p) => p.id === "P1")?.label).toBe("Telus");
    });

    it("ORs within an axis", () => {
        const kept = applyRecordFilters(
            records,
            filters({ vendors: new Set(["Hakimi Hardware", "Sri Sai"]) })
        );
        expect(kept.map((r) => r.name)).toEqual(["A", "B"]);
    });

    it("ANDs across axes", () => {
        const kept = applyRecordFilters(
            records,
            filters({ vendors: new Set(["Hakimi Hardware"]), projects: new Set(["P2"]) })
        );
        expect(kept).toHaveLength(0);
    });

    it("selecting the blank entry finds the records with no vendor", () => {
        const kept = applyRecordFilters(records, filters({ vendors: new Set([BLANK_FACET_ID]) }));
        expect(kept.map((r) => r.name)).toEqual(["C"]);
    });
});

describe("range filters", () => {
    const records = [
        record({ name: "LOW", amount: 100 }),
        record({ name: "MID", amount: 5000 }),
        record({ name: "HIGH", amount: 90000 }),
    ];

    it("bounds are inclusive on both ends", () => {
        const kept = applyRecordFilters(records, filters({ amountMin: 100, amountMax: 5000 }));
        expect(kept.map((r) => r.name)).toEqual(["LOW", "MID"]);
    });

    it("one open end still bounds the other", () => {
        expect(
            applyRecordFilters(records, filters({ amountMin: 5000 })).map((r) => r.name)
        ).toEqual(["MID", "HIGH"]);
    });

    it("a date bound excludes an undated record rather than guessing where it belongs", () => {
        const dated = record({ name: "DATED", approved_on: "2026-07-01" });
        const undated = record({ name: "UNDATED" });
        const kept = applyRecordFilters([dated, undated], filters({ dateFrom: "2026-01-01" }));
        expect(kept.map((r) => r.name)).toEqual(["DATED"]);
    });
});

describe("parseAmountBound", () => {
    it("a blank box is unbounded, NOT zero", () => {
        // ⚠️ `Number("")` is 0, so the obvious implementation turns an empty minimum into
        // "at least zero" -- which looks like it works and hides a bound nobody can see.
        expect(parseAmountBound("")).toBeNull();
        expect(parseAmountBound("   ")).toBeNull();
    });

    it("rubbish is unbounded too, never zero", () => {
        expect(parseAmountBound("abc")).toBeNull();
    });

    it("reads a plain number and a comma-grouped one", () => {
        expect(parseAmountBound("5000")).toBe(5000);
        expect(parseAmountBound("1,23,456")).toBe(123456);
    });

    it("keeps a real zero", () => {
        expect(parseAmountBound("0")).toBe(0);
    });
});

describe("text search", () => {
    const target = record({
        name: "PAY-00105-034",
        vendor_name: "Hakimi Hardware",
        vendor_nickname: "HH Traders",
        contact_person: "Ravi Kumar",
        project_name: "Telus GIFT City",
        document_name: "PO-4471",
    });

    it("matches tokens in ANY order, across DIFFERENT fields", () => {
        // ⚠️ THE DEFECT THIS REPLACES. The server's `LIKE '%needle%'` needed the words in the order
        // the record stores them, so a perfectly sensible query found nothing.
        expect(matchesText(target, "hakimi 4471")).toBe(true);
        expect(matchesText(target, "4471 hakimi")).toBe(true);
    });

    it("every token must match somewhere", () => {
        expect(matchesText(target, "hakimi toshiba")).toBe(false);
    });

    it("finds a record by nickname and by contact person", () => {
        expect(matchesText(target, "hh traders")).toBe(true);
        expect(matchesText(target, "ravi")).toBe(true);
    });

    it("a partial word matches as it is typed", () => {
        expect(matchesText(target, "haki")).toBe(true);
    });

    it("blank text passes everything", () => {
        expect(matchesText(record(), "   ")).toBe(true);
    });
});

describe("the date column", () => {
    it("sorts a payment's approval date and an expense's update date TOGETHER", () => {
        // ⚠️ OWNER DECISION Q4. Ordering them together makes no claim about what either MEANS --
        // which is why `recordDateLabel` still says "approved" vs "updated" on screen and this does
        // not. If this function ever feeds a label, that ruling has been broken.
        const payment = record({ name: "PAY", approved_on: "2026-07-01 10:00:00" });
        const expense = record({ name: "EXP", updated_on: "2026-06-01 09:00:00" });
        const sorted = sortRecords([payment, expense], { column: "date", dir: "asc" });
        expect(sorted.map((r) => r.name)).toEqual(["EXP", "PAY"]);
    });

    it("prefers the approval date when a record somehow carries both", () => {
        expect(
            recordSortDate({ approved_on: "2026-07-01 10:00:00", updated_on: "2026-08-01" })
        ).toBe("2026-07-01");
    });

    it("blanks sort last ascending AND descending", () => {
        const dated = record({ name: "DATED", approved_on: "2026-07-01" });
        const undated = record({ name: "UNDATED" });
        for (const dir of ["asc", "desc"] as const) {
            const sorted = sortRecords([undated, dated], { column: "date", dir });
            expect(sorted[sorted.length - 1].name, dir).toBe("UNDATED");
        }
    });
});

describe("sorting", () => {
    it("cycles unsorted -> asc -> desc -> unsorted", () => {
        // ⚠️ RETURNING TO NULL MUST STAY REACHABLE: null is the similarity ranking, not "no
        // opinion". A two-state toggle would strand a reviewer away from the ranked view.
        let sort = nextSortState(null, "amount");
        expect(sort).toEqual({ column: "amount", dir: "asc" });
        sort = nextSortState(sort, "amount");
        expect(sort).toEqual({ column: "amount", dir: "desc" });
        expect(nextSortState(sort, "amount")).toBeNull();
    });

    it("switching column restarts at ascending", () => {
        expect(nextSortState({ column: "amount", dir: "desc" }, "vendor")).toEqual({
            column: "vendor",
            dir: "asc",
        });
    });

    it("does NOT re-impose the settleable split", () => {
        // ⚠️ A reviewer who sorts by amount has asked for amount order and must get it. Re-applying
        // the split would silently disobey the control they just used.
        const unsettleable = record({ name: "CHEAP", amount: 1, suggested: false });
        const settleable = record({ name: "DEAR", amount: 99999, suggested: true });
        const sorted = sortRecords([settleable, unsettleable], { column: "amount", dir: "asc" });
        expect(sorted.map((r) => r.name)).toEqual(["CHEAP", "DEAR"]);
    });

    it("ties break on the record name, so the order is total", () => {
        const a = record({ name: "PAY-B", vendor_name: "Same Vendor" });
        const b = record({ name: "PAY-A", vendor_name: "Same Vendor" });
        const forwards = sortRecords([a, b], { column: "vendor", dir: "asc" }).map((r) => r.name);
        const backwards = sortRecords([b, a], { column: "vendor", dir: "asc" }).map((r) => r.name);
        expect(forwards).toEqual(backwards);
        expect(forwards).toEqual(["PAY-A", "PAY-B"]);
    });

    it("never mutates the array it was given", () => {
        const records = [record({ name: "B" }), record({ name: "A" })];
        sortRecords(records, { column: "vendor", dir: "asc" });
        expect(records.map((r) => r.name)).toEqual(["B", "A"]);
    });
});

describe("hasActiveFilters", () => {
    it("is false for the untouched view", () => {
        expect(hasActiveFilters(EMPTY_FILTERS, null)).toBe(false);
    });

    it("counts a sort as active, so Clear can restore the ranking", () => {
        // ⚠️ OWNER DECISION Q5 -- "so that the view becomes normal again". Normal is the ranking.
        expect(hasActiveFilters(EMPTY_FILTERS, { column: "amount", dir: "asc" })).toBe(true);
    });

    it("counts each axis", () => {
        expect(hasActiveFilters(filters({ vendors: new Set(["V"]) }), null)).toBe(true);
        expect(hasActiveFilters(filters({ amountMin: 0 }), null)).toBe(true);
        expect(hasActiveFilters(filters({ dateTo: "2026-01-01" }), null)).toBe(true);
        expect(hasActiveFilters(filters({ text: "hakimi" }), null)).toBe(true);
    });

    it("whitespace-only text is not active", () => {
        expect(hasActiveFilters(filters({ text: "   " }), null)).toBe(false);
    });

    it("an amountMin of zero IS active", () => {
        // A real bound of 0 must not read as "unset" -- that is the `parseAmountBound` trap again,
        // one layer up.
        expect(hasActiveFilters(filters({ amountMin: 0 }), null)).toBe(true);
    });
});

describe("reasonCaption explains the ranking, and only while it IS the ranking", () => {
    it("joins the server's reasons in the order they arrived", () => {
        // ⚠️ THE ORDER IS THE OWNER'S PRIORITY ORDER (project > vendor > alias > amount), appended
        // by `score_record` in that sequence. Re-sorting them here would contradict the ranking they
        // exist to explain.
        const caption = reasonCaption(
            record({
                similarity_reasons: [
                    "the transfer names Fujitsu Chennai",
                    "the vendor name matches exactly",
                    "the amount is identical",
                ],
            }),
            null
        );
        expect(caption).toBe(
            "the transfer names Fujitsu Chennai · the vendor name matches exactly · the amount is identical"
        );
    });

    it("says nothing when an explicit sort is active", () => {
        // ⚠️ THE LOAD-BEARING HALF. Under a user-chosen sort the list is no longer in similarity
        // order, so a "why it ranks here" caption would be explaining an order that is not on
        // screen. `null` is the ranking; anything else is not.
        const r = record({ similarity_reasons: ["the vendor name matches exactly"] });
        expect(reasonCaption(r, { column: "amount", dir: "asc" })).toBe("");
        expect(reasonCaption(r, { column: "date", dir: "desc" })).toBe("");
        expect(reasonCaption(r, null)).not.toBe("");
    });

    it("says nothing when the record scored on nothing", () => {
        // Every Non Project Expense reaches this: no vendor column and no project column at all, so
        // it can only ever score on amount and often not even that. A blank caption is the honest
        // rendering -- an empty bullet would imply a reason was withheld.
        expect(reasonCaption(record({ similarity_reasons: [] }), null)).toBe("");
    });

    it("tolerates a missing or blank-padded reasons list", () => {
        // The field is always sent today. Guarded anyway: this renders inside a table that decides
        // where money goes, and a crash here would take the whole picker down.
        expect(
            reasonCaption({ similarity_reasons: undefined as unknown as string[] }, null)
        ).toBe("");
        expect(reasonCaption(record({ similarity_reasons: ["", "  "] }), null)).toBe("");
    });
});

describe("visibleRecords composes filter then sort", () => {
    it("sorts only what survived the filter", () => {
        const records = [
            record({ name: "A", vendor_name: "Keep", amount: 300 }),
            record({ name: "B", vendor_name: "Drop", amount: 1 }),
            record({ name: "C", vendor_name: "Keep", amount: 100 }),
        ];
        const shown = visibleRecords(records, filters({ vendors: new Set(["Keep"]) }), {
            column: "amount",
            dir: "asc",
        });
        expect(shown.map((r) => r.name)).toEqual(["C", "A"]);
    });
});

describe("splitCandidates -- Split mode lists settleable payments only (ADR-0020 B2/B3)", () => {
    const pool = [
        record({ target_doctype: "Project Payments", name: "PAY-1" }),
        record({ target_doctype: "Project Expenses", name: "PE-1" }),
        record({ target_doctype: "Project Payments", name: "PAY-2" }),
        record({ target_doctype: "Non Project Expenses", name: "NPE-1" }),
    ];

    it("keeps every Project Payment and drops both expense ledgers", () => {
        // ⚠️ THE RESTRICTION ALREADY EXISTS on `allocate_row` and on `tickAllowedForFanOut`; this
        // stops OFFERING what would be refused, rather than adding a rule.
        expect(splitCandidates(pool).map((r) => r.name)).toEqual(["PAY-1", "PAY-2"]);
    });

    it("keeps the server's ranking order untouched", () => {
        // The pool arrives ranked by similarity server-side; narrowing must not re-sort it.
        const ranked = [
            record({ target_doctype: "Project Payments", name: "B" }),
            record({ target_doctype: "Project Expenses", name: "X" }),
            record({ target_doctype: "Project Payments", name: "A" }),
        ];
        expect(splitCandidates(ranked).map((r) => r.name)).toEqual(["B", "A"]);
    });

    it("returns an empty list rather than falling back to the whole pool", () => {
        // ⚠️ A FALLBACK WOULD BE THE WORST SHAPE: it would offer expense records the endpoint
        // refuses, on the one screen whose whole job is to stop that. The caller renders
        // `SPLIT_NO_CANDIDATES_NOTE` instead -- a silent empty list reads as a broken screen.
        const expensesOnly = [
            record({ target_doctype: "Project Expenses", name: "PE-1" }),
            record({ target_doctype: "Non Project Expenses", name: "NPE-1" }),
        ];
        expect(splitCandidates(expensesOnly)).toEqual([]);
        expect(splitCandidates([])).toEqual([]);
    });

    it("says why the list is narrowed, and what to do when it is empty", () => {
        // The sentences are pinned because both are the ONLY thing on screen explaining an absence.
        // ⚠️ INVERTED AT #1289: both sentences said "approved", and the import no longer settles
        // an Approved record -- it settles one somebody has marked as done. Asserting the OLD word
        // is ABSENT is what stops it drifting back in beside the new one.
        expect(SPLIT_PAYMENTS_ONLY_NOTE).toMatch(/reconciliation pending project payments/i);
        expect(SPLIT_PAYMENTS_ONLY_NOTE).not.toMatch(/approved/i);
        expect(SPLIT_NO_CANDIDATES_NOTE).toMatch(/no reconciliation pending project payment/i);
        expect(SPLIT_NO_CANDIDATES_NOTE).not.toMatch(/approved/i);
        // ⚠️ THE EMPTY STATE MUST NAME THE WAY OUT, not merely report the absence.
        expect(SPLIT_NO_CANDIDATES_NOTE).toMatch(/normal/i);
    });

    it("NEVER calls either mode a 'partial' anything -- the inverse feature owns that word", () => {
        // ⚠️ THE SAME DIALOG RENDERS A RADIO LABELLED "A part payment", belonging to the INVERSE
        // feature (one approved payment split across several TRANSFERS). Two radio groups in one
        // dialog with near-identical labels and opposite meanings is the worst available outcome,
        // so the ban is mechanical rather than a note somebody has to remember.
        for (const copy of [
            SPLIT_PAYMENTS_ONLY_NOTE,
            SPLIT_NO_CANDIDATES_NOTE,
            SETTLE_MODE_LABEL.normal,
            SETTLE_MODE_LABEL.split,
            SETTLE_MODE_HINT.normal,
            SETTLE_MODE_HINT.split,
        ]) {
            expect(copy.toLowerCase()).not.toMatch(/part payment|partial/);
        }
    });
});

describe("recordPoolState -- loading, failed and empty are three different answers (issue #1248)", () => {
    // What a fresh fetch looks like before anything has come back.
    const base = { balanceUnknown: false, hasAnswer: false, poolSize: 0, isLoading: false, failed: false };

    it("a failed search is FAILED, never empty -- this is the defect", () => {
        // ⚠️ SWR's failed shape: no data, not loading, an error. Before #1248 the screen read only
        // `data` and `isLoading`, so this was indistinguishable from an empty pool.
        expect(recordPoolState({ ...base, failed: true })).toBe("failed");
    });

    it("a retry after a failure is LOADING, never empty", () => {
        // ⚠️ SWR keeps the old `error` while it retries and sets `isLoading` again (no data is
        // cached). Loading and failed may alternate; "there is nothing" must never appear between.
        expect(recordPoolState({ ...base, isLoading: true, failed: true })).toBe("loading");
    });

    it("EMPTY needs a real answer -- no answer and no error is still loading", () => {
        // A key that has not fired yet (or a `null` key) reports neither loading nor an error.
        expect(recordPoolState(base)).toBe("loading");
        expect(recordPoolState({ ...base, hasAnswer: true })).toBe("empty");
    });

    it("an unknown balance is loading, whatever the fetch says", () => {
        expect(recordPoolState({ ...base, balanceUnknown: true, failed: true })).toBe("loading");
        expect(recordPoolState({ ...base, balanceUnknown: true, hasAnswer: true, poolSize: 3 })).toBe("loading");
    });

    it("records in hand are shown, even if a background refresh then failed", () => {
        expect(recordPoolState({ ...base, hasAnswer: true, poolSize: 2 })).toBe("ready");
        expect(recordPoolState({ ...base, hasAnswer: true, poolSize: 2, failed: true })).toBe("ready");
    });

    it("an answer that the Split narrowing emptied is EMPTY, not failed", () => {
        expect(recordPoolState({ ...base, hasAnswer: true, poolSize: 0 })).toBe("empty");
    });
});

describe("recordPoolMessage -- one sentence per state, per mode", () => {
    it("keeps both empty sentences exactly as they were", () => {
        expect(recordPoolMessage("empty", "split")).toBe(SPLIT_NO_CANDIDATES_NOTE);
        expect(recordPoolMessage("empty", "normal")).toBe(NORMAL_NO_CANDIDATES_NOTE);
        // ⚠️ INVERTED AT #1289. The old sentence named the wrong status AND stopped short: a
        // reviewer meeting an empty pool needs to know the records are not missing, they simply
        // have not been marked as done yet -- which is the one thing that would fill this list.
        expect(NORMAL_NO_CANDIDATES_NOTE).toBe(
            "There are no payments or expenses at Reconciliation Pending to link to. A record has to be marked as done before a bank line can settle it.",
        );
    });

    it("says the list could not be loaded -- and claims nothing about what exists", () => {
        for (const mode of ["normal", "split"] as const) {
            const failed = recordPoolMessage("failed", mode);
            expect(failed).toBe(RECORD_POOL_FAILED_NOTE);
            expect(failed).toMatch(/could not be loaded/i);
            expect(failed).toMatch(/try again/i);
            // ⚠️ A FAILURE MUST NOT BORROW THE EMPTY SENTENCE, or say anything is absent.
            expect(failed).not.toBe(recordPoolMessage("empty", mode));
            expect(failed.toLowerCase()).not.toMatch(/there are no|nothing to/);
        }
    });

    it("gives loading, failed and empty three distinct sentences in both modes", () => {
        for (const mode of ["normal", "split"] as const) {
            const sentences = (["loading", "failed", "empty"] as const).map((s) => recordPoolMessage(s, mode));
            expect(new Set(sentences).size).toBe(3);
        }
    });
});
