// An expense marked "No invoice" (#1570, ADR-0039 ruling 8, stories 32 and 45): the Non Project Expenses table and
// a project's Misc. Project Expenses tab show who marked it, when and why, where the invoice would show.
import { describe, expect, it } from "vitest";

import type { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses";

import { invoiceRefExportText, noInvoiceNote } from "./noInvoiceView";

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

describe("a Project Expense marked No invoice (story 32)", () => {
    const marked: Partial<ProjectExpenses> = {
        invoice_ref: undefined,
        no_invoice_reason: "Cash to a labour contractor",
        no_invoice_by: "lead@example.com",
        no_invoice_at: "2026-10-30 09:12:00",
    };

    it("gets the same note as a non-project one", () => {
        expect(noInvoiceNote(marked, userName)).toEqual({
            label: "No invoice",
            detail: "Asha Lead, 30-Oct-2026: Cash to a labour contractor",
        });
    });

    it("exports the note in place of the missing ref", () => {
        expect(invoiceRefExportText(marked, userName)).toBe(
            "No invoice (Asha Lead, 30-Oct-2026: Cash to a labour contractor)",
        );
    });

    it("exports the ref, or --, on any other expense", () => {
        expect(invoiceRefExportText({ invoice_ref: "INV-7" }, userName)).toBe("INV-7");
        expect(invoiceRefExportText({}, userName)).toBe("--");
    });
});
