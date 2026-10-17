import { describe, expect, it } from "vitest";

import {
    CHEQUE_TRACKER_TAB,
    chequeTabFilters,
    chequeTrackerTabOf,
    isInChequeTab,
    RECONCILIATION_PENDING_LEAVES_OUT,
    waitsInChequeTracker,
} from "./chequeTabs";

const row = (status: string, cheque_type: string) => ({ status, cheque_type }) as Parameters<typeof isInChequeTab>[0];

describe("isInChequeTab", () => {
    it("lists every cheque under All Cheques", () => {
        for (const status of ["Pending", "Issued", "Cleared", "Cancelled"]) {
            for (const type of ["Payment", "Security Deposit"]) {
                expect(isInChequeTab(row(status, type), CHEQUE_TRACKER_TAB.ALL)).toBe(true);
            }
        }
    });

    it("lists only Issued Payment cheques under Cheque Issued – Reconciliation Pending", () => {
        expect(isInChequeTab(row("Issued", "Payment"), CHEQUE_TRACKER_TAB.ISSUED)).toBe(true);
        expect(isInChequeTab(row("Pending", "Payment"), CHEQUE_TRACKER_TAB.ISSUED)).toBe(false);
        expect(isInChequeTab(row("Cleared", "Payment"), CHEQUE_TRACKER_TAB.ISSUED)).toBe(false);
        expect(isInChequeTab(row("Cancelled", "Payment"), CHEQUE_TRACKER_TAB.ISSUED)).toBe(false);
        // A Security Deposit is Issued from the day it is written, but the bank never pays it.
        expect(isInChequeTab(row("Issued", "Security Deposit"), CHEQUE_TRACKER_TAB.ISSUED)).toBe(false);
    });

    it("lists every Security Deposit cheque, at any status, and no Payment cheque under Security Deposits", () => {
        for (const status of ["Issued", "Cancelled"]) {
            expect(isInChequeTab(row(status, "Security Deposit"), CHEQUE_TRACKER_TAB.DEPOSITS)).toBe(true);
        }
        for (const status of ["Pending", "Issued", "Cleared", "Cancelled"]) {
            expect(isInChequeTab(row(status, "Payment"), CHEQUE_TRACKER_TAB.DEPOSITS)).toBe(false);
        }
    });
});

describe("chequeTabFilters", () => {
    it("sends the list endpoint the same rule the tab shows", () => {
        expect(chequeTabFilters(CHEQUE_TRACKER_TAB.ALL)).toEqual([]);
        expect(chequeTabFilters(CHEQUE_TRACKER_TAB.ISSUED)).toEqual([
            ["status", "=", "Issued"],
            ["cheque_type", "=", "Payment"],
        ]);
        expect(chequeTabFilters(CHEQUE_TRACKER_TAB.DEPOSITS)).toEqual([["cheque_type", "=", "Security Deposit"]]);
    });
});

describe("chequeTrackerTabOf", () => {
    it("reads the tab from the URL, and opens All Cheques for anything else", () => {
        expect(chequeTrackerTabOf("issued")).toBe(CHEQUE_TRACKER_TAB.ISSUED);
        expect(chequeTrackerTabOf("all")).toBe(CHEQUE_TRACKER_TAB.ALL);
        expect(chequeTrackerTabOf("deposits")).toBe(CHEQUE_TRACKER_TAB.DEPOSITS);
        expect(chequeTrackerTabOf("security")).toBe(CHEQUE_TRACKER_TAB.ALL);
        expect(chequeTrackerTabOf(null)).toBe(CHEQUE_TRACKER_TAB.ALL);
    });
});

describe("waitsInChequeTracker", () => {
    it("takes a payment on an Issued cheque out of Project Payments' Reconciliation Pending", () => {
        expect(waitsInChequeTracker({ cheque_status: "Issued" })).toBe(true);
    });

    it("keeps Online payments, expenses and payments on a cheque in any other status", () => {
        expect(waitsInChequeTracker({ cheque_status: "" })).toBe(false);
        expect(waitsInChequeTracker({ cheque_status: null })).toBe(false);
        expect(waitsInChequeTracker({})).toBe(false);
        for (const status of ["Pending", "Cleared", "Cancelled"]) {
            expect(waitsInChequeTracker({ cheque_status: status })).toBe(false);
        }
    });

    it("is the filter the Reconciliation Pending tab sends", () => {
        expect(RECONCILIATION_PENDING_LEAVES_OUT).toEqual(["cheque_status", "!=", "Issued"]);
    });
});
