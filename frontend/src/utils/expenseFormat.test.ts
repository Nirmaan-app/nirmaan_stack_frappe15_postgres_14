import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    answersFromSourceData, invalidMonthKeys, invalidPanKeys, isKnownBinding, monthAnswerProblem, panAnswerProblem,
    parseFormat, readDetailDescription, readNativeInvoice, seedAnswers, showAnswer, validateFormat,
} from "./expenseFormat";

const FMT = parseFormat(JSON.stringify({
    templateId: "t", templateVersion: 1, title: "T",
    sections: [
        { id: "stay", type: "fields", fields: [
            { key: "occupant_name", label: "Person Name", type: "text", bind: "user.full_name" },
            { key: "refundable", label: "Refundable", type: "select", default: "Yes" },
            { key: "location", label: "City", type: "text" },
            { key: "ghost", label: "Ghost", type: "text", bind: "user.shoe_size" },
        ] },
        { id: "proof", type: "image_attachments", slots: [{ key: "bill", label: "Bill" }] },
    ],
}));

const CTX = { userFullName: "Shahbaj Khan", userEmail: "shahbaj@nirmaan.app" };

describe("seedAnswers", () => {
    it("prefills a bound field from the logged-in user", () => {
        expect(seedAnswers(FMT, CTX)["stay.occupant_name"]).toBe("Shahbaj Khan");
    });

    it("prefills a static default", () => {
        expect(seedAnswers(FMT, CTX)["stay.refundable"]).toBe("Yes");
    });

    it("leaves an unbound, defaultless field absent rather than empty-string", () => {
        // An absent key means "the requester has not answered" -- an empty string would look
        // like they answered with nothing.
        expect("stay.location" in seedAnswers(FMT, CTX)).toBe(false);
    });

    it("an UNKNOWN binding costs only the prefill, never the form", () => {
        // The allowlist is closed; a stale or invented bind must degrade, not throw.
        const seeded = seedAnswers(FMT, CTX);
        expect("stay.ghost" in seeded).toBe(false);
        expect(isKnownBinding("user.shoe_size")).toBe(false);
        expect(isKnownBinding("user.full_name")).toBe(true);
    });

    it("skips non-field sections", () => {
        expect(Object.keys(seedAnswers(FMT, CTX)).some((k) => k.startsWith("proof."))).toBe(false);
    });

    it("degrades to nothing when the user context is empty or the format absent", () => {
        expect(seedAnswers(FMT, {})["stay.occupant_name"]).toBeUndefined();
        expect(seedAnswers(null, CTX)).toEqual({});
    });
});

// --- validateFormat ------------------------------------------------------------------
// This module validates its OWN grammar. The regression these pin: the commissioning
// parser rejected `bind: "user.full_name"` (its allowlist is project-scoped), so five of
// the seven shipped formats could not be saved through the editor at all.

const validFormat = {
    templateId: "t", templateVersion: 1, title: "T",
    sections: [
        { id: "detail", type: "fields", fields: [
            { key: "person_name", label: "Person Name", type: "text", bind: "user.full_name" },
        ] },
        { id: "proof", type: "image_attachments", slots: [
            { key: "bill", label: "Bill / Receipt", maps_to: "invoice_attachment" },
        ] },
    ],
};
const v = (o: unknown) => validateFormat(JSON.stringify(o));
const codes = (r: ReturnType<typeof v>) => (r.ok ? [] : r.errors.map((e) => e.code));

describe("validateFormat", () => {
    it("accepts a user binding — the whole point of owning the allowlist", () => {
        const r = v(validFormat);
        expect(r.ok).toBe(true);
        expect(isKnownBinding("user.full_name")).toBe(true);
    });

    it("still refuses a binding that is not ours", () => {
        const r = v({ ...validFormat, sections: [
            { id: "d", type: "fields", fields: [{ key: "k", label: "L", bind: "project.project_name" }] },
        ] });
        expect(codes(r)).toEqual(["invalid_type"]);
    });

    it("refuses a section this module cannot render", () => {
        // Commissioning accepted these; FormatFieldsRenderer draws nothing for them, so the
        // format would save clean and reach the requester with a section missing.
        const r = v({ ...validFormat, sections: [{ id: "c", type: "checklist", items: [] }] });
        expect(codes(r)).toEqual(["invalid_type"]);
    });

    it("refuses duplicate section ids and duplicate field keys", () => {
        expect(codes(v({ ...validFormat, sections: [
            { id: "detail", type: "fields", fields: [{ key: "a", label: "A" }] },
            { id: "detail", type: "fields", fields: [{ key: "b", label: "B" }] },
        ] }))).toContain("duplicate_id");
        expect(codes(v({ ...validFormat, sections: [
            { id: "detail", type: "fields", fields: [{ key: "a", label: "A" }, { key: "a", label: "B" }] },
        ] }))).toContain("duplicate_id");
    });

    it("requires a label — without one the ledger prints a title-cased key", () => {
        expect(codes(v({ ...validFormat, sections: [
            { id: "d", type: "fields", fields: [{ key: "person_name", type: "text" }] },
        ] }))).toEqual(["missing_field"]);
    });

    it("requires options on a select", () => {
        expect(codes(v({ ...validFormat, sections: [
            { id: "d", type: "fields", fields: [{ key: "k", label: "L", type: "select" }] },
        ] }))).toEqual(["missing_field"]);
    });

    it("rejects junk before it can reach a requester", () => {
        expect(codes(v("not an object"))).toEqual(["invalid_type"]);
        expect(codes(validateFormat("{nope"))).toEqual(["invalid_json"]);
        expect(codes(validateFormat(""))).toEqual(["invalid_json"]);
        expect(codes(v({ templateId: "t" }))).toEqual(["missing_field"]);
    });

    it("warns, but does not fail, on a second invoice_attachment slot", () => {
        const r = v({ ...validFormat, sections: [
            { id: "p", type: "image_attachments", slots: [
                { key: "a", label: "A", maps_to: "invoice_attachment" },
                { key: "b", label: "B", maps_to: "invoice_attachment" },
            ] },
        ] });
        expect(r.ok).toBe(true);
        expect(r.ok && r.warnings.some((w) => w.includes("FIRST one wins"))).toBe(true);
    });
});

describe("the PAN field", () => {
    const RENT = parseFormat(JSON.stringify({
        templateId: "office-rent", templateVersion: 1,
        sections: [{ id: "detail", type: "fields", fields: [
            { key: "landlord_name", label: "Landlord Name", type: "text", required: true },
            { key: "landlord_pan", label: "Landlord PAN", type: "pan", required: true },
        ] }],
    }));

    it("accepts a PAN shaped like ABCPK1234D, in any case", () => {
        expect(panAnswerProblem("ABCPK1234D")).toBeNull();
        expect(panAnswerProblem("abcpk1234d")).toBeNull();
    });

    it("refuses anything else with a message that shows the shape", () => {
        for (const bad of ["ABC123", "ABCPK1234", "ABCPK12345", "1BCPK1234D", "ABCPKX234D"]) {
            expect(panAnswerProblem(bad)).toMatch(/ABCPK1234D/);
        }
    });

    it("leaves a blank PAN to the required check", () => {
        expect(panAnswerProblem("")).toBeNull();
        expect(panAnswerProblem("  ")).toBeNull();
    });

    it("names the PAN answers that block submit, and never a text field", () => {
        expect(invalidPanKeys(RENT, { "detail.landlord_name": "abc123", "detail.landlord_pan": "ABC123" }))
            .toEqual(["detail.landlord_pan"]);
        expect(invalidPanKeys(RENT, { "detail.landlord_pan": "ABCPK1234D" })).toEqual([]);
        expect(invalidPanKeys(RENT, {})).toEqual([]);
        expect(invalidPanKeys(null, { "detail.landlord_pan": "ABC123" })).toEqual([]);
    });

    it("is a field type the format editor saves", () => {
        expect(codes(validateFormat(JSON.stringify(RENT)))).toEqual([]);
    });
});

describe("the month field", () => {
    const RENT = parseFormat(JSON.stringify({
        templateId: "office-rent", templateVersion: 2,
        sections: [{ id: "detail", type: "fields", fields: [
            { key: "rent_month", label: "Rent Month", type: "month", required: true },
            { key: "office_location", label: "Office Location", type: "text", required: true },
        ] }],
    }));

    it("accepts a month and year, as the month picker gives it", () => {
        for (const good of ["2026-10", "2026-01", "1999-12"]) expect(monthAnswerProblem(good)).toBeNull();
    });

    it("refuses a full date, a word or a month out of range", () => {
        for (const bad of ["2026-10-01", "Oct 2026", "2026-13", "2026-00", "10-2026", "2026-1"]) {
            expect(monthAnswerProblem(bad)).toMatch(/2026-10/);
        }
    });

    it("leaves a blank month to the required check", () => {
        expect(monthAnswerProblem("")).toBeNull();
        expect(monthAnswerProblem("  ")).toBeNull();
    });

    it("names the month answers that block submit, and never a text field", () => {
        expect(invalidMonthKeys(RENT, { "detail.rent_month": "2026-10-01", "detail.office_location": "2026-10-01" }))
            .toEqual(["detail.rent_month"]);
        expect(invalidMonthKeys(RENT, { "detail.rent_month": "2026-10" })).toEqual([]);
        expect(invalidMonthKeys(RENT, {})).toEqual([]);
        expect(invalidMonthKeys(null, { "detail.rent_month": "nope" })).toEqual([]);
    });

    it("is a field type the format editor saves", () => {
        expect(codes(validateFormat(JSON.stringify(RENT)))).toEqual([]);
    });

    it("reads as month and year on the request page, as the sentence does", () => {
        expect(showAnswer("2026-10")).toBe("Oct 2026");
        expect(showAnswer("2026-01")).toBe("Jan 2026");
        expect(showAnswer("2026-13")).toBe("2026-13");
        expect(showAnswer("Bengaluru HQ")).toBe("Bengaluru HQ");
    });
});

describe("answersFromSourceData", () => {
    const wrap = (responses: unknown) => JSON.stringify({ responses });

    it("flattens sections into the dialog's `section.field` keys", () => {
        expect(answersFromSourceData(wrap({ stay: { person_name: "Shahbaj Khan", city: "BTM" } })))
            .toEqual({ "stay.person_name": "Shahbaj Khan", "stay.city": "BTM" });
    });

    it("round-trips what the dialog stored, so editing shows what was submitted", () => {
        // The exact shape `toResponses` writes -- if these two ever disagree, an edit opens blank.
        const stored = wrap({ stay: { person_name: "A", rent_period_from: "2026-08-01" } });
        expect(answersFromSourceData(stored)).toEqual({
            "stay.person_name": "A", "stay.rent_period_from": "2026-08-01",
        });
    });

    it("stringifies non-string answers rather than dropping them", () => {
        expect(answersFromSourceData(wrap({ s: { nights: 3, ac: false } })))
            .toEqual({ "s.nights": "3", "s.ac": "false" });
    });

    it("drops null and undefined -- an absent answer is not the string 'null'", () => {
        expect(answersFromSourceData(wrap({ s: { a: null, b: "x" } }))).toEqual({ "s.b": "x" });
    });

    it("ignores a section that is not an object", () => {
        expect(answersFromSourceData(wrap({ s: ["a"], t: "x", u: { k: "v" } })))
            .toEqual({ "u.k": "v" });
    });

    it("returns {} for absent, blank, malformed or non-object envelopes", () => {
        [undefined, null, "", "not json", "{}", '{"responses":null}', '{"responses":[]}']
            .forEach((raw) => expect(answersFromSourceData(raw as string | null)).toEqual({}));
    });
});

describe("readDetailDescription", () => {
    it("reads the synthetic key a format-less request stores its typed text under", () => {
        expect(readDetailDescription(JSON.stringify({
            responses: { detail: { description: "Paid the courier" } },
        }))).toBe("Paid the courier");
    });

    it("returns '' when there is no detail section, so a formatted request stays blank", () => {
        expect(readDetailDescription(JSON.stringify({ responses: { stay: { a: "b" } } }))).toBe("");
    });

    it("returns '' for a non-string description rather than rendering '[object Object]'", () => {
        expect(readDetailDescription(JSON.stringify({
            responses: { detail: { description: { a: 1 } } },
        }))).toBe("");
    });

    it("returns '' for absent, blank or malformed input", () => {
        [undefined, null, "", "{", '{"responses":{"detail":[]}}']
            .forEach((raw) => expect(readDetailDescription(raw as string | null)).toBe(""));
    });
});

describe("readNativeInvoice", () => {
    it("reads a standard request's invoice answers and its first invoice file", () => {
        expect(readNativeInvoice(JSON.stringify({
            responses: {
                detail: { description: "Cement" },
                invoice: { invoice_date: "2026-09-01", invoice_ref: "INV-7" },
            },
            attachments: { invoice: ["/private/files/a.pdf", "/private/files/b.pdf"], bill: ["/x"] },
        }))).toEqual({
            invoice_date: "2026-09-01", invoice_ref: "INV-7", invoice_attachment: "/private/files/a.pdf",
        });
    });

    it("ignores a form's own slots -- only the standard `invoice` slot is an invoice", () => {
        expect(readNativeInvoice(JSON.stringify({ attachments: { bill: ["/x.pdf"] } })).invoice_attachment)
            .toBe("");
    });

    it("returns blanks for absent, malformed or non-string input", () => {
        const blank = { invoice_date: "", invoice_ref: "", invoice_attachment: "" };
        [undefined, null, "", "{", '{"responses":{"invoice":[]}}',
         '{"responses":{"invoice":{"invoice_date":7}},"attachments":{"invoice":[{}]}}']
            .forEach((raw) => expect(readNativeInvoice(raw as string | null)).toEqual(blank));
    });
});

describe("the shipped request forms", () => {
    // `fixtures/expense_type.json` is what every migrate re-imports, so these are the forms
    // requesters get. A form changed there (#1430 took the bank fields off) must still draw.
    const types: { name: string; source_format: string | null }[] = JSON.parse(readFileSync(
        resolve(__dirname, "../../../nirmaan_stack/fixtures/expense_type.json"), "utf-8"));

    it.each(types.filter((t) => t.source_format?.trim()).map((t) => [t.name, t.source_format!]))(
        "%s validates", (_name, raw) => {
            expect(codes(validateFormat(raw))).toEqual([]);
        });
});
