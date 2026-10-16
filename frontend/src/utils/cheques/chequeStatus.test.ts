import { describe, expect, it } from "vitest";

import {
    bulkResultText,
    canChangeChequeStatus,
    noteProblem,
    statusTargets,
} from "./chequeStatus";

describe("statusTargets", () => {
    it("offers the two other statuses, whichever the Cheque is at", () => {
        expect(statusTargets("Issued")).toEqual(["Cleared", "Cancelled"]);
        expect(statusTargets("Cleared")).toEqual(["Issued", "Cancelled"]);
        expect(statusTargets("Cancelled")).toEqual(["Issued", "Cleared"]);
    });

    it("offers every status for a mixed bulk selection", () => {
        expect(statusTargets(undefined)).toEqual(["Issued", "Cleared", "Cancelled"]);
    });
});

describe("noteProblem", () => {
    it("asks for a note only to cancel", () => {
        expect(noteProblem("Cancelled", "  ")).toBe("Write a note saying why the cheque is cancelled.");
        expect(noteProblem("Cancelled", "bounced")).toBeNull();
        expect(noteProblem("Cleared", "")).toBeNull();
    });
});

describe("bulkResultText", () => {
    it("counts what changed and names each skipped cheque with its reason", () => {
        expect(
            bulkResultText({
                changed: [{ cheque: "CHQ-1" }, { cheque: "CHQ-2" }],
                skipped: [{ cheque: "CHQ-3", cheque_no: "004521", reason: "already Cleared" }],
            }),
        ).toBe("2 changed, 1 skipped: 004521 already Cleared");
    });

    it("says only what changed when nothing was skipped", () => {
        expect(bulkResultText({ changed: [{ cheque: "CHQ-1" }], skipped: [] })).toBe("1 changed");
    });

    it("falls back to the record name when a skipped cheque has no number", () => {
        expect(
            bulkResultText({ changed: [], skipped: [{ cheque: "CHQ-9", cheque_no: null, reason: "not found" }] }),
        ).toBe("0 changed, 1 skipped: CHQ-9 not found");
    });
});

describe("canChangeChequeStatus", () => {
    it("lets accounts change status and not procurement", () => {
        expect(canChangeChequeStatus("Nirmaan Accountant Profile")).toBe(true);
        expect(canChangeChequeStatus("Nirmaan Accountant Lead Profile")).toBe(true);
        expect(canChangeChequeStatus("Nirmaan Admin Profile")).toBe(true);
        expect(canChangeChequeStatus("Nirmaan Procurement Executive Profile")).toBe(false);
        expect(canChangeChequeStatus("Nirmaan Project Manager Profile")).toBe(false);
    });
});
