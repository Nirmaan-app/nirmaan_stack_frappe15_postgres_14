import { describe, expect, it } from "vitest";

import { tdsDeductee, tdsDeducteeText, tdsRowSource } from "./tdsRegisterRow";

const workOrderRow = { project_payment: "PAY-0001", vendor: "VEN-1" };
const rentRow = { non_project_expense: "NPE-0001", deductee_name: "Asha Rao", deductee_pan: "ABCPK1234D" };
const vendorName = (id: string) => (id === "VEN-1" ? "Sharma Electricals" : id);

describe("tdsRowSource", () => {
    it("is the payment on a Work Order row", () => {
        expect(tdsRowSource(workOrderRow)).toEqual({ kind: "payment", name: "PAY-0001" });
    });

    it("is the expense on an Office Rent row", () => {
        expect(tdsRowSource(rentRow)).toEqual({ kind: "expense", name: "NPE-0001" });
    });

    it("is nothing on a row with neither", () => {
        expect(tdsRowSource({})).toBeNull();
    });
});

describe("tdsDeductee", () => {
    it("is the vendor on a Work Order row", () => {
        expect(tdsDeductee(workOrderRow)).toEqual({ kind: "vendor", vendor: "VEN-1" });
        expect(tdsDeducteeText(workOrderRow, vendorName)).toBe("Sharma Electricals");
    });

    it("is the landlord and PAN on an Office Rent row", () => {
        expect(tdsDeductee(rentRow)).toEqual({ kind: "landlord", name: "Asha Rao", pan: "ABCPK1234D" });
        expect(tdsDeducteeText(rentRow, vendorName)).toBe("Asha Rao (PAN ABCPK1234D)");
    });

    it("keeps a rent row's name when its request gave no PAN, and shows nothing when it named nobody", () => {
        expect(tdsDeducteeText({ non_project_expense: "NPE-2", deductee_name: "Asha Rao" }, vendorName)).toBe("Asha Rao");
        expect(tdsDeductee({ non_project_expense: "NPE-3" })).toBeNull();
        expect(tdsDeducteeText({ non_project_expense: "NPE-3" }, vendorName)).toBe("--");
    });
});
