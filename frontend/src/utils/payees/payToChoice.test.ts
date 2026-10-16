import { describe, expect, it } from "vitest";

import { pickedAccount, payToSave, type PickedPayTo } from "./payToChoice";

const account = {
    account_name: "Ramesh Kumar Yadav",
    account_number: "36147100982211",
    ifsc: "SBIN0003435",
    bank_name: "State Bank of India",
    bank_branch: "Bhiwandi",
};
const payee: PickedPayTo = { kind: "payee", payee: { name: "PYE-0412", ...account } };
const own: PickedPayTo = { kind: "own", account };

describe("payToSave", () => {
    it("keeps the request's own account as it is while it stays picked", () => {
        expect(payToSave(own)).toEqual({ keep_pay_to: true });
    });

    it("sends the Payee to copy when one is picked", () => {
        expect(payToSave(payee)).toEqual({ payee: "PYE-0412" });
    });

    it("sends no Payee when nothing is picked", () => {
        expect(payToSave(null)).toEqual({});
    });
});

describe("pickedAccount", () => {
    it("shows the account of either pick", () => {
        expect(pickedAccount(payee)).toMatchObject(account);
        expect(pickedAccount(own)).toBe(account);
    });
});
