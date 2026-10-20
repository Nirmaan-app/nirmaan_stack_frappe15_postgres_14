import { describe, expect, it } from "vitest";

import { listedInTransactionDetails } from "./transactionDetails";

const UNPAID = ["Requested", "CEO Pending", "Approved", "Reconciliation Pending", "Rejected"];
const EVERY_STATUS = [...UNPAID, "Paid"];

describe("listedInTransactionDetails", () => {
    it.each(UNPAID)("hides a cheque payment at %s: the bank has not paid it yet", (status) => {
        expect(listedInTransactionDetails({ mode_of_payment: "Cheque", status })).toBe(false);
    });

    it("lists a cheque payment once it is Paid", () => {
        expect(listedInTransactionDetails({ mode_of_payment: "Cheque", status: "Paid" })).toBe(true);
    });

    it.each(EVERY_STATUS)("lists an online payment at %s, as before", (status) => {
        expect(listedInTransactionDetails({ mode_of_payment: "Online", status })).toBe(true);
    });

    it.each(EVERY_STATUS)("lists a payment with no mode (read as Online) at %s", (status) => {
        expect(listedInTransactionDetails({ mode_of_payment: "", status })).toBe(true);
        expect(listedInTransactionDetails({ status })).toBe(true);
    });
});
