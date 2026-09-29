import { describe, expect, it } from "vitest";

import { describeChanges, keepTyped } from "./useStaleConflict";

const base = {
    name: "EXP-1",
    modified: "2026-09-29 12:00:00.000000",
    status: "Requested",
    description: "Tea for site team",
    comment: null,
    amount: 20000,
    invoice_date: "2026-09-20",
    invoice_attachment: null,
    payment_attachment: "/files/old.pdf",
};

describe("describeChanges (any doctype, no field list)", () => {
    it("names nothing when only Frappe's own bookkeeping changed", () => {
        const latest = { ...base, modified: "2026-09-29 12:40:00.000000", modified_by: "nitesh@nirmaan.app", idx: 3 };
        expect(describeChanges(base, latest)).toEqual([]);
    });

    it("names a changed amount, before and after", () => {
        expect(describeChanges(base, { ...base, amount: 45000 })).toEqual(["Amount: 20,000 → 45,000"]);
    });

    it("treats a number stored as text and as a number as the same value", () => {
        expect(describeChanges(base, { ...base, amount: "20000" })).toEqual([]);
    });

    it("treats null, undefined and empty text as the same empty value", () => {
        expect(describeChanges(base, { ...base, comment: "" })).toEqual([]);
        expect(describeChanges(base, { ...base, comment: undefined })).toEqual([]);
    });

    it("compares dates on the day, ignoring a time part", () => {
        expect(describeChanges(base, { ...base, invoice_date: "2026-09-20 00:00:00" })).toEqual([]);
    });

    it("says an attachment was added, removed or replaced, never its URL", () => {
        expect(describeChanges(base, { ...base, invoice_attachment: "/files/inv.pdf" })).toEqual(["Invoice attachment: added"]);
        expect(describeChanges(base, { ...base, payment_attachment: null })).toEqual(["Payment attachment: removed"]);
        expect(describeChanges(base, { ...base, payment_attachment: "/files/new.pdf" })).toEqual(["Payment attachment: replaced"]);
    });

    it("shows an empty side as (empty) and labels the field from its name", () => {
        expect(describeChanges(base, { ...base, comment: "Checked by site" })).toEqual(["Comment: (empty) → Checked by site"]);
    });

    it("uses a readable name for an id-valued field when one is given", () => {
        const labels = { vendor: (id: string) => (id === "V-2" ? "Sri Sai Enterprises" : id) };
        // `vendor` is loaded on the opened side, so it is compared
        expect(describeChanges({ ...base, vendor: "V-1" }, { ...base, vendor: "V-2" }, labels)).toEqual([
            "Vendor: V-1 → Sri Sai Enterprises",
        ]);
    });

    it("ignores fields the screen never loaded (a list fetches only some columns)", () => {
        const latest = { ...base, autofill_used: 0, autofill_extracted_amount: 0 };
        expect(describeChanges(base, latest)).toEqual([]);
    });

    it("skips child tables and private fields", () => {
        const latest = { ...base, items: [{ qty: 2 }], _comments: "[1]", _liked_by: "x" };
        expect(describeChanges({ ...base, items: [{ qty: 1 }] }, latest)).toEqual([]);
    });

    it("lists several changes in the record's field order", () => {
        const latest = { ...base, status: "Approved", amount: 30000, description: "Tea and snacks" };
        expect(describeChanges(base, latest)).toEqual([
            "Status: Requested → Approved",
            "Description: Tea for site team → Tea and snacks",
            "Amount: 20,000 → 30,000",
        ]);
    });
});

describe("keepTyped (Save again keeps both people's work)", () => {
    const opened = { description: "Tea", amount: "20000", comment: "" };

    it("takes the other person's value for a field the user did not touch", () => {
        const current = { ...opened, description: "Tea and snacks" };        // user edited only the description
        const latest = { ...opened, amount: "45000", comment: "Per bill" };   // someone else changed amount + comment
        expect(keepTyped(current, opened, latest)).toEqual({ description: "Tea and snacks", amount: "45000", comment: "Per bill" });
    });

    it("keeps the user's typing when both changed the same field", () => {
        const current = { ...opened, amount: "30000" };
        const latest = { ...opened, amount: "45000" };
        expect(keepTyped(current, opened, latest).amount).toBe("30000");
    });

    it("leaves fields outside the given subset alone", () => {
        const current = { ...opened, project_name: "Display only" };
        expect(keepTyped(current, { amount: "20000" }, { amount: "45000" })).toEqual({ ...current, amount: "45000" });
    });
});
