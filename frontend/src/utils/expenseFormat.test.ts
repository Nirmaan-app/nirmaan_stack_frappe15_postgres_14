import { describe, expect, it } from "vitest";
import { parseFormat, seedAnswers, isKnownBinding, validateFormat } from "./expenseFormat";

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
