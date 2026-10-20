import { describe, expect, it } from "vitest";

import { chequeRowActions, type ChequeActionRow } from "./chequeRowActions";

const ADMIN = { role: "Nirmaan Admin Profile", user: "admin@nirmaan.app" };
const ACCOUNTANT = { role: "Nirmaan Accountant Profile", user: "acc@nirmaan.app" };
const LEAD = { role: "Nirmaan Accountant Lead Profile", user: "lead@nirmaan.app" };
const PROCUREMENT = { role: "Nirmaan Procurement Executive Profile", user: "proc@nirmaan.app" };
const PM = { role: "Nirmaan Project Manager Profile", user: "pm@nirmaan.app" };

const cheque = (status: string, cheque_type = "Payment", owner = "proc@nirmaan.app"): ChequeActionRow =>
    ({ status, cheque_type, owner }) as ChequeActionRow;

describe("chequeRowActions for accounts", () => {
    it("offers Clear and Cancel on an Issued Payment cheque", () => {
        for (const viewer of [ADMIN, ACCOUNTANT, LEAD]) {
            expect(chequeRowActions(cheque("Issued"), viewer)).toEqual(["view", "edit", "clear", "cancel"]);
        }
    });

    it("offers Cancel but never Clear on a Pending Payment cheque: only the bank import clears one", () => {
        expect(chequeRowActions(cheque("Approval Pending"), ACCOUNTANT)).toEqual(["view", "edit", "cancel"]);
    });

    it("offers neither on a Cleared or Cancelled cheque: there is no undo by hand", () => {
        expect(chequeRowActions(cheque("Cleared"), ACCOUNTANT)).toEqual(["view", "edit"]);
        expect(chequeRowActions(cheque("Cancelled"), ACCOUNTANT)).toEqual(["view", "edit"]);
    });

    it("offers Cancel but never Clear on an Issued Security Deposit: the bank never pays one", () => {
        expect(chequeRowActions(cheque("Issued", "Security Deposit"), ADMIN)).toEqual(["view", "edit", "cancel"]);
        expect(chequeRowActions(cheque("Cancelled", "Security Deposit"), ADMIN)).toEqual(["view", "edit"]);
    });
});

describe("chequeRowActions for Procurement", () => {
    it("never offers Clear or Cancel", () => {
        for (const status of ["Approval Pending", "Issued", "Cleared", "Cancelled"]) {
            expect(chequeRowActions(cheque(status, "Payment", "someone@else"), PROCUREMENT)).toEqual(["view"]);
        }
    });

    it("offers Edit on a Pending cheque it made, as the edit rule allows (#1482)", () => {
        expect(chequeRowActions(cheque("Approval Pending"), PROCUREMENT)).toContain("edit");
        expect(chequeRowActions(cheque("Issued"), PROCUREMENT)).not.toContain("edit");
        expect(chequeRowActions(cheque("Approval Pending", "Payment", "someone@else"), PROCUREMENT)).not.toContain("edit");
    });
});

describe("chequeRowActions on a Security Deposit for Procurement (#1486)", () => {
    it("offers Edit on an Issued deposit it made, never on a Cancelled one or another's", () => {
        expect(chequeRowActions(cheque("Issued", "Security Deposit"), PROCUREMENT)).toEqual(["view", "edit"]);
        expect(chequeRowActions(cheque("Cancelled", "Security Deposit"), PROCUREMENT)).toEqual(["view"]);
        expect(chequeRowActions(cheque("Issued", "Security Deposit", "someone@else"), PROCUREMENT)).toEqual(["view"]);
    });
});

describe("chequeRowActions for anyone else", () => {
    it("offers only View", () => {
        expect(chequeRowActions(cheque("Issued", "Payment", PM.user), PM)).toEqual(["view"]);
    });
});
