// Non-Project Inflows (#1265) -- the page's pure rules: the type list, the form gate, the payload,
// and who may create / edit / delete.
//
// The type list and the Others-needs-a-description rule have TWO homes: the doctype (the enforcement
// boundary) and this screen (UX). The parity case reads the doctype JSON so a type added on one side
// only fails here instead of producing a dropdown value the server refuses.
import { describe, expect, it } from "vitest";

import doctype from "../../../../nirmaan_stack/nirmaan_stack/doctype/non_project_inflows/non_project_inflows.json";

import {
    INFLOW_TYPES,
    NonProjectInflowForm,
    buildNonProjectInflowDoc,
    canCreateNonProjectInflow,
    canDeleteNonProjectInflow,
    canEditNonProjectInflow,
    validateNonProjectInflowForm,
} from "./nonProjectInflowModel";

const validForm = (over: Partial<NonProjectInflowForm> = {}): NonProjectInflowForm => ({
    inflow_type: "FD Closures",
    description: "",
    amount: "250000",
    utr: "UTR123",
    payment_date: "2026-09-01",
    ...over,
});

describe("INFLOW_TYPES parity with the doctype", () => {
    it("matches the Select options on the doctype, in order", () => {
        const field = doctype.fields.find((f: { fieldname: string }) => f.fieldname === "inflow_type");
        expect(field, "inflow_type field must exist -- a rotted path would make this vacuous").toBeTruthy();
        const options = (field!.options as string).split("\n").filter(Boolean);
        expect(options).toEqual([...INFLOW_TYPES]);
    });
});

describe("validateNonProjectInflowForm", () => {
    it("passes a complete form", () => {
        expect(validateNonProjectInflowForm(validForm())).toEqual({});
    });

    it("requires a type, and only a known one", () => {
        expect(validateNonProjectInflowForm(validForm({ inflow_type: "" })).inflow_type).toBeTruthy();
        expect(validateNonProjectInflowForm(validForm({ inflow_type: "Vendor Refund" })).inflow_type).toBeTruthy();
    });

    it("requires a description for Others, and a blank one does not count", () => {
        expect(validateNonProjectInflowForm(validForm({ inflow_type: "Others" })).description).toBeTruthy();
        expect(
            validateNonProjectInflowForm(validForm({ inflow_type: "Others", description: "   " })).description
        ).toBeTruthy();
        expect(
            validateNonProjectInflowForm(validForm({ inflow_type: "Others", description: "Vendor refund" }))
        ).toEqual({});
    });

    it("does not require a description for a named type", () => {
        for (const t of INFLOW_TYPES.filter((x) => x !== "Others")) {
            expect(validateNonProjectInflowForm(validForm({ inflow_type: t })).description).toBeUndefined();
        }
    });

    it("refuses a zero, negative or missing amount", () => {
        for (const amount of ["0", "-10", "", "abc"]) {
            expect(validateNonProjectInflowForm(validForm({ amount })).amount, amount).toBeTruthy();
        }
    });

    it("requires a reference and a payment date", () => {
        expect(validateNonProjectInflowForm(validForm({ utr: "  " })).utr).toBeTruthy();
        expect(validateNonProjectInflowForm(validForm({ payment_date: "" })).payment_date).toBeTruthy();
    });
});

describe("buildNonProjectInflowDoc", () => {
    it("trims text, parses the amount and carries the receipt url", () => {
        expect(
            buildNonProjectInflowDoc(
                validForm({ utr: "  UTR9 ", description: " Interest Q2 ", amount: "1200.50" }),
                "/files/r.pdf"
            )
        ).toEqual({
            inflow_type: "FD Closures",
            description: "Interest Q2",
            amount: 1200.5,
            utr: "UTR9",
            payment_date: "2026-09-01",
            inflow_attachment: "/files/r.pdf",
        });
    });

    it("sends a blank description and a missing receipt as null, so an edit can clear them", () => {
        const doc = buildNonProjectInflowDoc(validForm({ description: "  " }), null);
        expect(doc.description).toBeNull();
        expect(doc.inflow_attachment).toBeNull();
    });
});

describe("access", () => {
    const ADMIN = "Nirmaan Admin Profile";
    const LEAD = "Nirmaan Accountant Lead Profile";
    const ACCOUNTANT = "Nirmaan Accountant Profile";
    const SALES = ["Nirmaan Sales Executive Profile", "Nirmaan Sales Lead Profile"];
    const OTHERS = ["Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile", "Nirmaan Project Manager Profile"];

    it("Administrator (the user) can do everything", () => {
        expect(canCreateNonProjectInflow("Loading", "Administrator")).toBe(true);
        expect(canEditNonProjectInflow(undefined, "Administrator")).toBe(true);
        expect(canDeleteNonProjectInflow(undefined, "Administrator")).toBe(true);
    });

    it("Admin creates, edits and deletes", () => {
        expect([canCreateNonProjectInflow(ADMIN), canEditNonProjectInflow(ADMIN), canDeleteNonProjectInflow(ADMIN)])
            .toEqual([true, true, true]);
    });

    it("Accountant Lead creates and edits, never deletes", () => {
        expect([canCreateNonProjectInflow(LEAD), canEditNonProjectInflow(LEAD), canDeleteNonProjectInflow(LEAD)])
            .toEqual([true, true, false]);
    });

    it("Accountant creates only", () => {
        expect([
            canCreateNonProjectInflow(ACCOUNTANT),
            canEditNonProjectInflow(ACCOUNTANT),
            canDeleteNonProjectInflow(ACCOUNTANT),
        ]).toEqual([true, false, false]);
    });

    it("Sales and every other profile get nothing", () => {
        for (const role of [...SALES, ...OTHERS, undefined, "Loading"]) {
            expect(canCreateNonProjectInflow(role), String(role)).toBe(false);
            expect(canEditNonProjectInflow(role), String(role)).toBe(false);
            expect(canDeleteNonProjectInflow(role), String(role)).toBe(false);
        }
    });
});
