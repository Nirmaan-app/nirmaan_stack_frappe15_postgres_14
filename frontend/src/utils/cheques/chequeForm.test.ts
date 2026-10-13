import { describe, expect, it } from "vitest";

import { chequeFormSchema, saveChequeArgs, type ChequeFormInput } from "./chequeForm";
import type { ChequeLineDraft } from "./chequeLines";

const PHOTO = "/private/files/cheque.jpg";

const valid = (overrides: Partial<ChequeFormInput> = {}): ChequeFormInput => ({
    bank: "ICICI Bank",
    bank_name: "",
    cheque_no: "004521",
    cheque_date: "2026-10-14",
    amount: 25000,
    payee_kind: "vendor",
    vendor: "VEN-0042",
    payee_name: "",
    attachment: PHOTO,
    description: "Office rent, October",
    lines: [],
    ...overrides,
});

const poLine = (overrides: Partial<ChequeLineDraft> = {}): ChequeLineDraft => ({
    line_type: "PO/WO Payment",
    project: "PROJ-1",
    record_doctype: "Service Requests",
    record_name: "SR-001",
    payment_name: "",
    amount: 5000,
    ...overrides,
});

/** The message on `field`, or undefined when the form is valid there. */
const problemAt = (input: ChequeFormInput, field: string) => {
    const result = chequeFormSchema.safeParse(input);
    if (result.success) return undefined;
    return result.error.issues.find((i) => i.path[0] === field)?.message;
};

describe("chequeFormSchema", () => {
    it("accepts an Ad-hoc cheque with a description", () => {
        expect(chequeFormSchema.safeParse(valid()).success).toBe(true);
    });

    it("refuses a cheque with no lines and no description", () => {
        expect(problemAt(valid({ description: "  " }), "description")).toMatch(/Ad-hoc cheque/);
    });

    it("requires the photo", () => {
        expect(problemAt(valid({ attachment: "" }), "attachment")).toBe("Upload the photo of the cheque.");
    });

    it("requires the Vendor or the typed payee, whichever is chosen", () => {
        expect(problemAt(valid({ vendor: "" }), "vendor")).toBeDefined();
        expect(problemAt(valid({ payee_kind: "typed", payee_name: " " }), "payee_name")).toBeDefined();
        expect(chequeFormSchema.safeParse(valid({ payee_kind: "typed", vendor: "", payee_name: "Tata Power" })).success).toBe(true);
    });

    it("needs the bank's name for Others only", () => {
        expect(problemAt(valid({ bank: "Others" }), "bank_name")).toBeDefined();
        expect(problemAt(valid({ bank: "Others", bank_name: "HDFC Bank" }), "bank_name")).toBeUndefined();
    });

    it("refuses a zero or blank amount", () => {
        expect(problemAt(valid({ amount: 0 }), "amount")).toBe("Enter a cheque amount greater than 0.");
        expect(problemAt(valid({ amount: "" as unknown as number }), "amount")).toBeDefined();
    });

    it("needs no description once the cheque has a line", () => {
        expect(chequeFormSchema.safeParse(valid({ description: "", lines: [poLine()] })).success).toBe(true);
    });

    it("asks each PO/WO line for its project, its PO or Work Order, and an amount when it has no payment", () => {
        const issues = (line: ReturnType<typeof poLine>) =>
            chequeFormSchema.safeParse(valid({ lines: [line] })).error?.issues.map((i) => [i.path.join("."), i.message]);
        expect(issues(poLine({ project: "" }))).toContainEqual(["lines.0.project", "Pick the project."]);
        expect(issues(poLine({ record_name: "" }))).toContainEqual(["lines.0.record_name", "Pick the PO or Work Order."]);
        expect(issues(poLine({ amount: "" }))).toContainEqual(["lines.0.amount", "Enter the amount, greater than 0."]);
        expect(issues(poLine({ payment_name: "PAY-1", amount: 20000 }))).toBeUndefined();
    });

    it("keeps PO/WO lines to a Vendor payee", () => {
        expect(problemAt(valid({ payee_kind: "typed", vendor: "", payee_name: "Tata Power", lines: [poLine()] }), "lines")).toBe(
            "A PO or Work Order payment needs a cheque made out to a Vendor, not a typed payee."
        );
    });

    it("accepts a post-dated cheque", () => {
        expect(chequeFormSchema.safeParse(valid({ cheque_date: "2027-03-01" })).success).toBe(true);
    });
});

describe("saveChequeArgs", () => {
    it("sends the Vendor and not the typed name for a Vendor payee", () => {
        const args = saveChequeArgs(chequeFormSchema.parse(valid({ payee_name: "left over" })));
        expect(args).toEqual({
            bank: "ICICI Bank",
            cheque_no: "004521",
            cheque_date: "2026-10-14",
            amount: 25000,
            vendor: "VEN-0042",
            description: "Office rent, October",
            attachment: PHOTO,
        });
    });

    it("sends the typed payee and the Others bank name", () => {
        const args = saveChequeArgs(
            chequeFormSchema.parse(
                valid({ bank: "Others", bank_name: " HDFC Bank ", payee_kind: "typed", vendor: "VEN-0042", payee_name: " Tata Power " }),
            ),
        );
        expect(args.bank_name).toBe("HDFC Bank");
        expect(args.payee_name).toBe("Tata Power");
        expect(args.vendor).toBeUndefined();
    });

    it("sends the lines, when there are any", () => {
        const args = saveChequeArgs(chequeFormSchema.parse(valid({ lines: [poLine({ amount: "5000" })] })));
        expect(args.lines).toEqual([
            { line_type: "PO/WO Payment", project: "PROJ-1", record_doctype: "Service Requests", record_name: "SR-001", amount: 5000 },
        ]);
    });

    it("drops a bank name typed before switching back to ICICI Bank", () => {
        const args = saveChequeArgs(chequeFormSchema.parse(valid({ bank_name: "HDFC Bank" })));
        expect(args.bank_name).toBeUndefined();
    });
});
