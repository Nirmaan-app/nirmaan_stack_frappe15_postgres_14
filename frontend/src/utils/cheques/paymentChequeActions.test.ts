import { describe, expect, it } from "vitest";

import {
    newChequeDuplicateText,
    newChequeStatusHint,
    paymentChequeButtons,
    tdsStillToWithhold,
} from "./paymentChequeActions";

const ACCOUNTANT = "Nirmaan Accountant Profile";
const PROCUREMENT = "Nirmaan Procurement Executive Profile";

describe("paymentChequeButtons", () => {
    it("offers Convert to Cheque on every Online payment that is not Rejected", () => {
        for (const status of ["Requested", "CEO Pending", "Approved", "Reconciliation Pending", "Paid"]) {
            expect(paymentChequeButtons({ status, mode_of_payment: "Online" }, ACCOUNTANT)).toEqual({
                convert: true,
                linkNew: false,
                switchOnline: false,
            });
        }
        // A payment from before the field (blank mode) is Online.
        expect(paymentChequeButtons({ status: "Approved", mode_of_payment: "" }, ACCOUNTANT).convert).toBe(true);
        expect(paymentChequeButtons({ status: "Rejected", mode_of_payment: "Online" }, ACCOUNTANT).convert).toBe(false);
    });

    it("offers Link a new cheque and Switch to Online only once the payment's Cheque is Cancelled", () => {
        // Blank while the chip is still loading: nothing shows until the Cheque's status is known.
        for (const chequeStatus of ["Issued", "Cleared", "", null]) {
            expect(
                paymentChequeButtons({ status: "Approved", mode_of_payment: "Cheque", cheque: "CHQ-26-00001", chequeStatus }, ACCOUNTANT),
            ).toEqual({
                convert: false,
                linkNew: false,
                switchOnline: false,
            });
        }
        expect(
            paymentChequeButtons(
                { status: "Reconciliation Pending", mode_of_payment: "Cheque", cheque: "CHQ-26-00001", chequeStatus: "Cancelled" },
                PROCUREMENT,
            ),
        ).toEqual({ convert: false, linkNew: true, switchOnline: true });
    });

    it("offers both on a Cheque payment no Cheque holds (a number the backfill refused), unless Rejected", () => {
        expect(paymentChequeButtons({ status: "Approved", mode_of_payment: "Cheque", cheque: null }, ACCOUNTANT)).toEqual({
            convert: false,
            linkNew: true,
            switchOnline: true,
        });
        expect(paymentChequeButtons({ status: "Rejected", mode_of_payment: "Cheque", cheque: "" }, ACCOUNTANT)).toEqual({
            convert: false,
            linkNew: false,
            switchOnline: false,
        });
    });

    it("never links a Rejected payment to a new cheque, but lets it go back to Online", () => {
        expect(
            paymentChequeButtons({ status: "Rejected", mode_of_payment: "Cheque", cheque: "CHQ-26-00001", chequeStatus: "Cancelled" }, ACCOUNTANT),
        ).toEqual({ convert: false, linkNew: false, switchOnline: true });
    });

    it("shows nothing to roles outside Admin, Accountants and Procurement", () => {
        for (const role of ["Nirmaan Project Manager Profile", "Nirmaan Estimates Executive Profile", "Loading"]) {
            expect(paymentChequeButtons({ status: "Approved", mode_of_payment: "Online" }, role)).toEqual({
                convert: false,
                linkNew: false,
                switchOnline: false,
            });
        }
    });
});

describe("newChequeStatusHint", () => {
    it("says what happens to the payment's status", () => {
        expect(newChequeStatusHint({ status: "Approved", mode_of_payment: "Online", on_hold: 0 })).toBe(
            "Switches to Cheque and moves to Reconciliation Pending now.",
        );
        expect(newChequeStatusHint({ status: "Approved", mode_of_payment: "Online", on_hold: 1 })).toBe(
            "Switches to Cheque; stays Approved while on hold and moves to Reconciliation Pending once released.",
        );
        expect(newChequeStatusHint({ status: "CEO Pending", mode_of_payment: "Online" })).toBe(
            "Switches to Cheque; moves to Reconciliation Pending once approved.",
        );
        expect(newChequeStatusHint({ status: "Paid", mode_of_payment: "Online" })).toBe("Switches to Cheque; stays Paid.");
        expect(newChequeStatusHint({ status: "Reconciliation Pending", mode_of_payment: "Cheque" })).toBe(
            "Goes on this cheque; stays Reconciliation Pending.",
        );
    });
});

describe("tdsStillToWithhold", () => {
    it("is true only while the payment waits for approval", () => {
        expect(tdsStillToWithhold("Requested")).toBe(true);
        expect(tdsStillToWithhold("CEO Pending")).toBe(true);
        for (const status of ["Approved", "Reconciliation Pending", "Paid", undefined]) {
            expect(tdsStillToWithhold(status)).toBe(false);
        }
    });
});

describe("newChequeDuplicateText", () => {
    it("matches the server's refusal word for word", () => {
        expect(newChequeDuplicateText({ cheque_no: "004521", bank_label: "ICICI Bank" })).toBe(
            "Cheque 004521 (ICICI Bank) already exists. This makes a new cheque for the payment. " +
                "To put this payment on 004521, add it to the cheque in Reports, Cheque Payments.",
        );
    });
});
