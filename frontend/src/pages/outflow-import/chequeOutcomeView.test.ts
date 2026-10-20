import { describe, expect, it } from "vitest";

import type { ChequeOutcome } from "@/types/NirmaanStack/OutflowImportBatch";

import { chequeOutcomeChip } from "./chequeOutcomeView";

const outcome = (over: Partial<ChequeOutcome> = {}): ChequeOutcome => ({
    cheque: "CHQ-26-00001",
    cheque_no: "000747",
    status: "Cleared",
    started: "Issued",
    double_payments: [],
    ...over,
});

describe("chequeOutcomeChip", () => {
    it("says nothing for a line that cleared no cheque", () => {
        expect(chequeOutcomeChip(null)).toBeNull();
        expect(chequeOutcomeChip(undefined)).toBeNull();
    });

    it("names the cheque and the move, and links to it in the Cheque Tracker", () => {
        const chip = chequeOutcomeChip(outcome());
        expect(chip?.label).toBe("Cheque 000747 · Issued → Cleared");
        expect(chip?.href).toBe("/cheque-tracker?cheques_q=000747&cheques_searchBy=cheque_no");
        expect(chip?.tone).toBe("cleared");
        expect(chip?.warning).toBeNull();
    });

    it("tones each start apart", () => {
        expect(chequeOutcomeChip(outcome({ started: "Approval Pending" }))?.label).toBe("Cheque 000747 · Approval Pending → Cleared");
        expect(chequeOutcomeChip(outcome({ started: "Approval Pending" }))?.tone).toBe("approved");
        expect(chequeOutcomeChip(outcome({ started: "Cancelled" }))?.tone).toBe("revived");
    });

    it("says a hand-cleared cheque was only linked", () => {
        const chip = chequeOutcomeChip(outcome({ started: "Cleared" }));
        expect(chip?.label).toBe("Cheque 000747 · linked");
        expect(chip?.tone).toBe("linked");
    });

    it("warns of a double payment, naming each payment raised after the cancel", () => {
        const chip = chequeOutcomeChip(
            outcome({
                started: "Cancelled",
                double_payments: [
                    { payment: "PAY-00071-019", record: "PO/077/00071/26-27", amount: 40273, status: "Approved" },
                ],
            })
        );
        expect(chip?.warning).toEqual({
            label: "Check for double payment",
            detail: "PO/077/00071/26-27 has PAY-00071-019 (Approved), raised after this cheque was cancelled.",
        });
    });
});
