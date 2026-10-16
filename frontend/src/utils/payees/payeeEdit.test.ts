import { describe, expect, it } from "vitest";

import {
    lastChangeLine,
    payeeDeleteBlock,
    payeeEditForm,
    payeeEditKeepsIfsc,
    sharedPayeeWarning,
} from "./payeeEdit";

const payee = {
    name: "PYE-0412",
    account_name: "Kaveri Ductfab Systems",
    account_number: "50200061234567",
    ifsc: "HDFC0000195",
};

const vendors = [
    { name: "VEN-0101", vendor_name: "Kaveri Ductfab (Rohtak)" },
    { name: "VEN-0102", vendor_name: "Kaveri Ductfab (Pune)" },
    { name: "VEN-0103", vendor_name: "Kaveri Ductfab (Indore)" },
];

describe("payeeEditForm", () => {
    it("starts from the Payee's own account, the number already in both boxes", () => {
        expect(payeeEditForm(payee)).toEqual({
            account_name: "Kaveri Ductfab Systems",
            account_number: "50200061234567",
            confirm_account_number: "50200061234567",
            ifsc: "HDFC0000195",
        });
    });

    it("starts the holder name from the rename prompt's new vendor name when given", () => {
        expect(payeeEditForm(payee, "Kaveri Airtech").account_name).toBe("Kaveri Airtech");
    });
});

describe("payeeEditKeepsIfsc", () => {
    it("knows the bank without a lookup while the IFSC is the Payee's own", () => {
        expect(payeeEditKeepsIfsc(payee, " hdfc0000195")).toBe(true);
        expect(payeeEditKeepsIfsc(payee, "SBIN0005943")).toBe(false);
        expect(payeeEditKeepsIfsc(undefined, "HDFC0000195")).toBe(false);
    });
});

describe("sharedPayeeWarning", () => {
    it("names every vendor the edit changes when the Payee serves more than one", () => {
        expect(sharedPayeeWarning(vendors)).toBe(
            "3 vendors are paid into this account. Saving changes it for all of them: " +
                "Kaveri Ductfab (Rohtak) (VEN-0101), Kaveri Ductfab (Pune) (VEN-0102), Kaveri Ductfab (Indore) (VEN-0103).",
        );
    });

    it("asks nothing when one vendor or none is paid into it", () => {
        expect(sharedPayeeWarning(vendors.slice(0, 1))).toBeNull();
        expect(sharedPayeeWarning([])).toBeNull();
    });
});

describe("payeeDeleteBlock", () => {
    it("refuses while a vendor links to the Payee, naming every one", () => {
        expect(payeeDeleteBlock(vendors.slice(0, 2))).toBe(
            "This payee can't be deleted: 2 vendors are paid into it (Kaveri Ductfab (Rohtak) (VEN-0101), " +
                "Kaveri Ductfab (Pune) (VEN-0102)). Point them at another payee first.",
        );
        expect(payeeDeleteBlock(vendors.slice(0, 1))).toMatch(/1 vendor is paid into it .* Point it at another payee/);
    });

    it("lets a Payee no vendor links to be deleted", () => {
        expect(payeeDeleteBlock([])).toBeNull();
    });
});

describe("lastChangeLine", () => {
    it("says when and by whom", () => {
        expect(lastChangeLine({ on: "2026-10-15", by: "Riya Sharma" })).toBe("15-Oct-2026 by Riya Sharma");
    });

    it("says Never when the history has no change", () => {
        expect(lastChangeLine(null)).toBe("Never");
    });
});
