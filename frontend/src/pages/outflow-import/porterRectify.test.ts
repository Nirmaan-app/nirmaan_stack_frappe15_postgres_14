import { describe, expect, it } from "vitest";

import {
    linesToMove,
    MOVE_ORDER_LABEL,
    moveDialogTitle,
    moveOrdersLabel,
    placementText,
    rectifyAffordance,
    rectifyButtonState,
    rectifyOutcome,
    staysNote,
    type RectifyPlanLine,
} from "./porterRectify";

const porter = (name: string, row_status = "Settled") => ({ name, row_status, source: "Porter Statement" });
const bank = (name: string) => ({ name, row_status: "Settled", source: "Cashfree" });

const onQuillon: RectifyPlanLine = {
    row: "OFR-1",
    crn: "CRN1",
    refusal: null,
    amount: 133,
    booked_by: "Arjun Pillai",
    ledger: "Project Expenses",
    project: "PRJ-Q",
    project_name: "Quillon Park",
    expense: "PE-1",
    description: "Porter Delivery raised by Arjun Pillai for Quillon Park",
    description_edited: false,
};
const nonProject: RectifyPlanLine = {
    ...onQuillon,
    row: "OFR-2",
    ledger: "Non Project Expenses",
    project: null,
    project_name: null,
    expense: "NPE-1",
};
const cancelled: RectifyPlanLine = { row: "OFR-3", crn: "CRN3", refusal: "This order is Skipped now, not Settled." };

describe("Rectify on one line", () => {
    it("is offered on a Settled Porter line to the undo roles only", () => {
        expect(rectifyAffordance(porter("a"), true)).toBe(true);
        expect(rectifyAffordance(porter("a"), false)).toBe(false);
    });

    it("is not offered on a bank line or a Porter line that is not Settled", () => {
        expect(rectifyAffordance(bank("a"), true)).toBe(false);
        expect(rectifyAffordance(porter("a", "Mismatched"), true)).toBe(false);
        expect(rectifyAffordance({ row_status: "Settled" }, true)).toBe(false);
    });
});

describe("Rectify N on ticked lines", () => {
    const page = [porter("a"), porter("b"), bank("c")];

    it("is hidden until a Porter line is ticked", () => {
        expect(rectifyButtonState(page, new Set(), new Map(), 1).visible).toBe(false);
        expect(rectifyButtonState(page, new Set(["c"]), new Map(), 1).visible).toBe(false);
    });

    it("works on ticked Porter lines", () => {
        expect(rectifyButtonState(page, new Set(["a", "b"]), new Map(), 1)).toEqual({
            visible: true,
            enabled: true,
            count: 2,
            note: null,
        });
    });

    it("is off while a bank line is ticked with them, and says why", () => {
        const state = rectifyButtonState(page, new Set(["a", "c"]), new Map(), 1);
        expect(state).toMatchObject({ visible: true, enabled: false, count: 2 });
        expect(state.note).toBe("Moving works on Porter orders only: untick the 1 other line.");
    });

    it("is off while a ticked line is on another page", () => {
        const state = rectifyButtonState(page, new Set(["a", "z"]), new Map([["z", 2]]), 1);
        expect(state.enabled).toBe(false);
        expect(state.note).toContain("Moving works on one page at a time");
    });
});

describe("The screen names Rectify Move to another project", () => {
    it("labels the line's button with the plain name", () => {
        expect(MOVE_ORDER_LABEL).toBe("Move to another project");
    });

    it("counts the orders on the toolbar and the dialog's run button", () => {
        expect(moveOrdersLabel(1)).toBe("Move 1 order");
        expect(moveOrdersLabel(3)).toBe("Move 3 orders");
    });

    it("titles the dialog for one order or several", () => {
        expect(moveDialogTitle(1)).toBe("Move this Porter order to another project");
        expect(moveDialogTitle(4)).toBe("Move 4 Porter orders to another project");
    });
});

describe("The dialog", () => {
    it("says where an order's expense is now", () => {
        expect(placementText(onQuillon)).toBe("Project Expense on Quillon Park");
        expect(placementText(nonProject)).toBe("Non-Project Expense");
    });

    it("moves only the lines that are not already where they are going and are not refused", () => {
        expect(linesToMove([onQuillon, nonProject, cancelled], "PRJ-Z").map((l) => l.row)).toEqual(["OFR-1", "OFR-2"]);
        expect(linesToMove([onQuillon, nonProject, cancelled], "PRJ-Q").map((l) => l.row)).toEqual(["OFR-2"]);
        expect(linesToMove([onQuillon, nonProject, cancelled], "").map((l) => l.row)).toEqual(["OFR-1"]);
    });

    it("says why a line stays: the server's refusal, or already there", () => {
        expect(staysNote(cancelled, "PRJ-Z")).toBe("This order is Skipped now, not Settled.");
        expect(staysNote(onQuillon, "PRJ-Q")).toBe("Already there, so it stays as it is.");
        expect(staysNote(nonProject, "")).toBe("Already there, so it stays as it is.");
        expect(staysNote(onQuillon, "")).toBeNull();
    });
});

describe("What a run reports", () => {
    it("counts what moved and lists what did not, with the server's sentence", () => {
        const outcome = rectifyOutcome(
            {
                count: 2,
                lines: [
                    { row: "OFR-1", rectified: true, description_kept: true },
                    { row: "OFR-2", rectified: false, reason: "This order is already on Zephyr Tower." },
                ],
            },
            "Zephyr Tower",
        );
        expect(outcome.title).toBe("1 order moved to Zephyr Tower.");
        expect(outcome.notes).toEqual(["1 kept its hand-edited description."]);
        expect(outcome.failed).toEqual([{ row: "OFR-2", reason: "This order is already on Zephyr Tower." }]);
    });

    it("names Non-Project as the destination when no project was chosen", () => {
        const outcome = rectifyOutcome(
            { count: 2, lines: [{ row: "a", rectified: true }, { row: "b", rectified: true }] },
            null,
        );
        expect(outcome.title).toBe("2 orders moved to Non-Project.");
        expect(outcome.notes).toEqual([]);
        expect(outcome.failed).toEqual([]);
    });

    it("says nothing moved when nothing did", () => {
        const outcome = rectifyOutcome({ count: 1, lines: [{ row: "a", rectified: false, reason: "No." }] }, null);
        expect(outcome.title).toBe("Nothing was moved.");
        expect(outcome.moved).toBe(0);
    });
});
