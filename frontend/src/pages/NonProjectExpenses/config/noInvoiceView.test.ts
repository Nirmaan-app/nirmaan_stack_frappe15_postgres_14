// A card spend marked "No invoice" (#1570, ADR-0039 ruling 8, story 45): the Non Project Expenses table shows
// who marked it, when and why, where the invoice would show. Nothing on any other expense.
import { describe, expect, it } from "vitest";

import { noInvoiceNote } from "./noInvoiceView";

const names: Record<string, string> = { "lead@example.com": "Asha Lead" };
const userName = (id?: string) => (id && names[id]) || id || "";

describe("noInvoiceNote", () => {
    it("names who marked it, when and why", () => {
        expect(
            noInvoiceNote(
                {
                    no_invoice_reason: "Toll booth, no receipt",
                    no_invoice_by: "lead@example.com",
                    no_invoice_at: "2026-10-21 14:05:09.123456",
                },
                userName,
            ),
        ).toEqual({
            label: "No invoice",
            detail: "Asha Lead, 21-Oct-2026: Toll booth, no receipt",
        });
    });

    it("is null on an expense nobody marked", () => {
        expect(noInvoiceNote({}, userName)).toBeNull();
        expect(noInvoiceNote({ no_invoice_reason: null, no_invoice_by: null, no_invoice_at: null }, userName)).toBeNull();
    });
});
