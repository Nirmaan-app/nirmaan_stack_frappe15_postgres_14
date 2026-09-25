import { describe, expect, it } from "vitest";

import {
    bulkCheckSummary,
    bulkResultSummary,
    bulkRunningTitle,
    bulkStartLabel,
    bulkUnreconcileTitle,
    type BulkUnreconcileEntry,
    CHECK_STEP_FOOTER,
    FAILED_RUN_NOTE,
    NOT_UNDONE_HEADING,
    NOT_UNDONE_NOTE,
    LINE_GONE,
    NOT_SETTLED_ANY_MORE,
    NOTHING_SETTLED,
    unreconcileButtonState,
} from "./bulkUnreconcileView";
import { ROW_MATCHED, ROW_MISMATCHED, ROW_SETTLED } from "./outflowImportStatus";
import {
    VERDICT_DELETE_CREATED,
    VERDICT_REFUSED,
    VERDICT_REVERT_PAYMENT,
    VERDICT_UNLINK_EXPENSE_LINE,
    VERDICT_UNSPLIT_PAYMENT,
    type ReversedLeg,
    type UnreconcilePlan,
    type UnreconcilePlanLeg,
} from "./unreconcileView";

const leg = (over: Partial<UnreconcilePlanLeg> = {}): UnreconcilePlanLeg => ({
    match: "M1",
    target_doctype: "Project Payments",
    target_name: "PAY-1",
    target_amount: 100,
    verdict: VERDICT_REVERT_PAYMENT,
    what_happens: "Goes back to Reconciliation Pending.",
    reason: null,
    title: null,
    fix_at: null,
    ...over,
});

const plan = (over: Partial<UnreconcilePlan> = {}): UnreconcilePlan => ({
    row: "R1",
    row_status: ROW_SETTLED,
    amount: 100,
    allocated: 100,
    refused_count: 0,
    legs: [leg()],
    ...over,
});

describe("unreconcileButtonState", () => {
    const rows = [{ name: "a" }, { name: "b" }];
    it("is off with nothing ticked", () => {
        expect(unreconcileButtonState(rows, new Set(), new Map(), 0)).toEqual({
            enabled: false,
            count: 0,
            note: null,
            offPage: null,
        });
    });
    it("is on when every tick is on this page", () => {
        expect(unreconcileButtonState(rows, new Set(["a", "b"]), new Map(), 0)).toEqual({
            enabled: true,
            count: 2,
            note: null,
            offPage: null,
        });
    });
    it("is off, and names the page, when a tick is on another page", () => {
        expect(unreconcileButtonState(rows, new Set(["a", "x"]), new Map([["x", 2]]), 0)).toEqual({
            enabled: false,
            count: 2,
            note: "1 ticked line is on page 3. Unreconcile works on one page at a time: go back to page 3, or untick it.",
            offPage: "1 on page 3",
        });
    });
});

describe("bulkUnreconcileTitle", () => {
    it("counts transfers", () => {
        expect(bulkUnreconcileTitle(1)).toBe("Unreconcile 1 transfer?");
        expect(bulkUnreconcileTitle(4)).toBe("Unreconcile 4 transfers?");
    });
});

describe("bulkCheckSummary", () => {
    it("counts what will be undone and its money", () => {
        const s = bulkCheckSummary([
            plan({ row: "R1", amount: 100 }),
            plan({ row: "R2", amount: 640, legs: [leg({ verdict: VERDICT_DELETE_CREATED })] }),
        ]);
        expect(s.undoCount).toBe(2);
        expect(s.blockedCount).toBe(0);
        expect(s.undoAmount).toBe(740);
        expect(s.pills).toEqual([{ tone: "go", text: "2 will be undone · ₹740" }]);
        expect(s.lines.map((l) => l.blocked)).toEqual([false, false]);
    });

    it("greys a line with a refused record, uses the one-line sentence, and lists it after the others", () => {
        const refused = plan({
            row: "R1",
            refused_count: 1,
            legs: [
                leg({ match: "M1" }),
                leg({
                    match: "M2",
                    verdict: VERDICT_REFUSED,
                    what_happens: null,
                    reason: "Someone changed its amount.",
                    title: "Changed",
                }),
            ],
        });
        const s = bulkCheckSummary([refused, plan({ row: "R2", amount: 50 })]);
        expect(s.lines.map((l) => l.plan.row)).toEqual(["R2", "R1"]);
        const blocked = s.lines[1];
        expect(blocked.blocked).toBe(true);
        expect(blocked.reason).toBeNull();
        expect(blocked.records[1].outcome).toEqual({
            tone: "refused",
            lead: "Can't be undone here.",
            text: "Someone changed its amount.",
        });
        expect(s.undoCount).toBe(1);
        expect(s.blockedCount).toBe(1);
        expect(s.undoAmount).toBe(50);
        expect(s.pills).toEqual([
            { tone: "go", text: "1 will be undone · ₹50" },
            { tone: "stop", text: "1 can't be undone · left out" },
        ]);
    });

    it("blocks a line that is no longer Settled, or has nothing settled", () => {
        const s = bulkCheckSummary([
            plan({ row: "R1", row_status: ROW_MATCHED, legs: [] }),
            plan({ row: "R2", legs: [] }),
            plan({ row: "R3", row_status: null, not_found: true, legs: [] }),
        ]);
        expect(s.lines.map((l) => [l.blocked, l.reason])).toEqual([
            [true, NOT_SETTLED_ANY_MORE],
            [true, NOTHING_SETTLED],
            [true, LINE_GONE],
        ]);
        expect(s.undoCount).toBe(0);
        expect(s.pills).toEqual([
            { tone: "go", text: "0 will be undone" },
            { tone: "stop", text: "3 can't be undone · left out" },
        ]);
    });
});

describe("the run's labels", () => {
    it("counts transfers on the button and the spinner", () => {
        expect(bulkStartLabel(1)).toBe("Unreconcile 1 transfer");
        expect(bulkStartLabel(3)).toBe("Unreconcile 3 transfers");
        expect(bulkRunningTitle(3)).toBe("Unreconciling 3 transfers…");
    });
});

describe("bulkResultSummary", () => {
    const undone = (row: string, row_status: string, reversed: Partial<ReversedLeg>[]): BulkUnreconcileEntry => ({
        row,
        undone: true,
        row_status,
        allocated: 0,
        remaining: 100,
        reversed: reversed.map((r) => ({
            match: "M",
            target_doctype: "Project Payments",
            target_name: "PAY-1",
            verdict: VERDICT_REVERT_PAYMENT,
            reversed_amount: 100,
            amount_after: 100,
            ...r,
        })),
    });
    const plans = [
        plan({ row: "R1", amount: 125000, beneficiary_name: "Shree Balaji" }),
        plan({ row: "R2", amount: 640, beneficiary_name: "Site petty cash" }),
        plan({ row: "R3", amount: 240000, beneficiary_name: "Krishna Fabricators" }),
        plan({ row: "R4", amount: 90, beneficiary_name: "Hand link" }),
    ];

    it("groups undone lines by where each one went, and lists the blocked ones with their reasons", () => {
        const s = bulkResultSummary(
            {
                count: 4,
                lines: [
                    undone("R2", ROW_MISMATCHED, [{ target_name: "PE-1", verdict: VERDICT_DELETE_CREATED }]),
                    undone("R1", ROW_MATCHED, [{ target_name: "PAY-18" }]),
                    { row: "R3", undone: false, reason: "Changed after you checked it." },
                    undone("R4", ROW_MISMATCHED, [
                        { target_name: "PAY-2", verdict: VERDICT_UNSPLIT_PAYMENT },
                        { target_name: "PE-9", verdict: VERDICT_UNLINK_EXPENSE_LINE, stays_paid: true },
                    ]),
                ],
            },
            plans
        );
        expect(s.title).toBe("3 transfers unreconciled, 1 blocked");
        expect(s.undoneCount).toBe(3);
        expect(s.groups.map((g) => [g.status, g.label, g.confirmByHand, g.lines.map((l) => l.row)])).toEqual([
            [ROW_MATCHED, "Matched", true, ["R1"]],
            [ROW_MISMATCHED, "Not-Matched", false, ["R2", "R4"]],
        ]);
        const [matched, notMatched] = s.groups;
        expect(matched.lines[0]).toMatchObject({
            beneficiary: "Shree Balaji",
            amount: 125000,
            records: ["PAY-18 back to Reconciliation Pending"],
        });
        expect(notMatched.lines[0].records).toEqual(["PE-1 deleted"]);
        expect(notMatched.lines[1].records).toEqual([
            "PAY-2 split undone, back to Reconciliation Pending",
            "PE-9 came off; the expense stays Paid",
        ]);
        expect(s.blocked).toEqual([
            { row: "R3", beneficiary: "Krishna Fabricators", amount: 240000, reason: "Changed after you checked it." },
        ]);
        expect(s.confirmByHandNote).toBe(true);
    });

    it("words a run with nothing blocked, and one with nothing undone", () => {
        expect(bulkResultSummary({ count: 1, lines: [undone("R1", ROW_MATCHED, [{}])] }, plans).title).toBe(
            "1 transfer unreconciled"
        );
        const none = bulkResultSummary(
            {
                count: 2,
                lines: [
                    { row: "R1", undone: false, reason: "a" },
                    { row: "R2", undone: false, reason: "b" },
                ],
            },
            plans
        );
        expect(none.title).toBe("Nothing unreconciled, 2 blocked");
        expect(none.groups).toEqual([]);
        expect(none.confirmByHandNote).toBe(false);
    });

    it("still lists a line it has no plan for, by its name", () => {
        const s = bulkResultSummary({ count: 1, lines: [{ row: "GONE", undone: false, reason: "gone" }] }, []);
        expect(s.blocked).toEqual([{ row: "GONE", beneficiary: null, amount: null, reason: "gone" }]);
    });

    it("lists the lines the check step left out as blocked, with the check step's reason", () => {
        const s = bulkResultSummary({ count: 1, lines: [undone("R1", ROW_MATCHED, [{}])] }, [
            plans[0],
            plan({
                row: "R5",
                amount: 60,
                beneficiary_name: "Metro Cement",
                refused_count: 1,
                legs: [leg({ verdict: VERDICT_REFUSED, what_happens: null, reason: "Someone changed its amount." })],
            }),
            plan({ row: "R6", amount: 10, row_status: ROW_MATCHED, legs: [] }),
        ]);
        expect(s.title).toBe("1 transfer unreconciled, 2 blocked");
        expect(s.blocked).toEqual([
            { row: "R5", beneficiary: "Metro Cement", amount: 60, reason: "Someone changed its amount." },
            { row: "R6", beneficiary: null, amount: 10, reason: NOT_SETTLED_ANY_MORE },
        ]);
    });
});

describe("the wording for lines a run did not undo", () => {
    // Review finding (#1317): a line lands in this group for being refused, but ALSO for no longer
    // existing or no longer being Settled -- so no sentence may claim these lines are "still Settled".
    const texts = [NOT_UNDONE_HEADING, NOT_UNDONE_NOTE, CHECK_STEP_FOOTER, FAILED_RUN_NOTE];

    it("never says the lines are Settled", () => {
        for (const text of texts) expect(text).not.toMatch(/settled/i);
    });

    it("says what is true of every such line: nothing changed on it", () => {
        expect(NOT_UNDONE_HEADING).toBe("Not undone");
        expect(NOT_UNDONE_NOTE).toBe("nothing changed on these");
        expect(CHECK_STEP_FOOTER).toMatch(/left exactly as it is/);
        expect(FAILED_RUN_NOTE).toMatch(/left as they were/);
    });

    it("covers the gone and no-longer-Settled reasons the group can hold", () => {
        // The heading has to be true for these two as well, which is why it cannot name a status.
        expect(LINE_GONE).toMatch(/no longer exists/);
        expect(NOT_SETTLED_ANY_MORE).toMatch(/no longer Settled/);
    });
});
