import { describe, expect, it } from "vitest";

import { chequeFormSchema, linesErrorMessage, makeChequeFormSchema, saveChequeArgs, type ChequeFormInput } from "./chequeForm";
import type { ChequeLineDraft } from "./chequeLines";

const PHOTO = "/private/files/cheque.jpg";

const poLine = (overrides: Partial<ChequeLineDraft> = {}): ChequeLineDraft => ({
    line_type: "PO/WO Payment",
    project: "PROJ-1",
    record_doctype: "Procurement Orders",
    record_name: "PO/001",
    payment_name: "",
    amount: 5000,
    ...overrides,
});

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
    description: "",
    lines: [poLine({ payment_name: "PAY-1", amount: 25000 })],
    ...overrides,
});

/** The message on `field`, or undefined when the form is valid there. */
const problemAt = (input: ChequeFormInput, field: string) => {
    const result = chequeFormSchema.safeParse(input);
    if (result.success) return undefined;
    return result.error.issues.find((i) => i.path[0] === field)?.message;
};

const lineIssues = (line: ChequeLineDraft) => {
    const result = chequeFormSchema.safeParse(valid({ lines: [line] }));
    return result.success ? undefined : result.error.issues.map((i) => [i.path.join("."), i.message]);
};

describe("chequeFormSchema: a new Payment cheque (#1482)", () => {
    it("accepts a Vendor cheque with a PO line and no description", () => {
        expect(chequeFormSchema.safeParse(valid()).success).toBe(true);
    });

    it("refuses a cheque with no lines: there is no Ad-hoc Payment cheque", () => {
        expect(problemAt(valid({ lines: [], description: "Office rent" }), "lines")).toBe(
            "Add at least one PO payment: a Payment cheque pays the PO payments on its lines.",
        );
    });

    it("requires the Vendor and refuses a typed payee", () => {
        expect(problemAt(valid({ vendor: "" }), "vendor")).toBe("Pick the Vendor the cheque is made out to.");
        expect(problemAt(valid({ payee_kind: "typed", vendor: "", payee_name: "Tata Power" }), "vendor")).toBe(
            "A Payment cheque is made out to a Vendor: pick the Vendor, not a typed payee.",
        );
    });

    it("refuses an expense line", () => {
        const npe = poLine({ line_type: "Non-project Expense", project: "", record_doctype: "", record_name: "", payment_name: "NPE-1" });
        expect(lineIssues(npe)).toContainEqual(["lines.0.line_type", "A Payment cheque pays PO payments only."]);
    });

    it("asks each line for its project, its PO, and an amount when it has no payment", () => {
        expect(lineIssues(poLine({ project: "" }))).toContainEqual(["lines.0.project", "Pick the project."]);
        expect(lineIssues(poLine({ record_name: "" }))).toContainEqual(["lines.0.record_name", "Pick the PO."]);
        expect(lineIssues(poLine({ amount: "" }))).toContainEqual(["lines.0.amount", "Enter the amount, greater than 0."]);
        expect(lineIssues(poLine({ payment_name: "PAY-1", amount: 20000 }))).toBeUndefined();
    });

    it("requires the photo", () => {
        expect(problemAt(valid({ attachment: "" }), "attachment")).toBe("Upload the photo of the cheque.");
    });

    it("needs the bank's name for Others only", () => {
        expect(problemAt(valid({ bank: "Others" }), "bank_name")).toBeDefined();
        expect(problemAt(valid({ bank: "Others", bank_name: "HDFC Bank" }), "bank_name")).toBeUndefined();
    });

    it("refuses a zero or blank amount", () => {
        expect(problemAt(valid({ amount: 0 }), "amount")).toBe("Enter a cheque amount greater than 0.");
        expect(problemAt(valid({ amount: "" as unknown as number }), "amount")).toBeDefined();
    });

    it("accepts a post-dated cheque", () => {
        expect(chequeFormSchema.safeParse(valid({ cheque_date: "2027-03-01" })).success).toBe(true);
    });
});

describe("makeChequeFormSchema for an Old-type cheque's photo-only edit", () => {
    const oldType = makeChequeFormSchema({ photoRequired: true, paymentCheque: false });

    it("takes the cheque as recorded: a typed payee, expense lines or none", () => {
        const typed = { payee_kind: "typed" as const, vendor: "", payee_name: "Tata Power" };
        const npe = poLine({ line_type: "Non-project Expense", project: "", record_doctype: "", record_name: "", payment_name: "NPE-1" });
        expect(oldType.safeParse(valid({ ...typed, lines: [npe] })).success).toBe(true);
        expect(oldType.safeParse(valid({ ...typed, lines: [], description: "Rent" })).success).toBe(true);
    });

    it("still asks for a backfilled cheque's photo only when told to", () => {
        const input = valid({ attachment: "" });
        expect(makeChequeFormSchema({ photoRequired: false, paymentCheque: false }).safeParse(input).success).toBe(true);
        expect(oldType.safeParse(input).success).toBe(false);
    });
});

describe("saveChequeArgs", () => {
    it("sends the Vendor and not a left-over typed name", () => {
        const args = saveChequeArgs(chequeFormSchema.parse(valid({ payee_name: "left over" })));
        expect(args).toEqual({
            bank: "ICICI Bank",
            cheque_no: "004521",
            cheque_date: "2026-10-14",
            amount: 25000,
            vendor: "VEN-0042",
            attachment: PHOTO,
            lines: [
                { line_type: "PO/WO Payment", project: "PROJ-1", record_doctype: "Procurement Orders", record_name: "PO/001", payment_name: "PAY-1", amount: 25000 },
            ],
        });
    });

    it("sends an Old-type cheque's typed payee back as recorded", () => {
        const values = makeChequeFormSchema({ photoRequired: true, paymentCheque: false }).parse(
            valid({ payee_kind: "typed", vendor: "VEN-0042", payee_name: " Tata Power ", lines: [], description: "Rent" }),
        );
        const args = saveChequeArgs(values);
        expect(args.payee_name).toBe("Tata Power");
        expect(args.vendor).toBeUndefined();
        expect(args.description).toBe("Rent");
    });

    it("sends the Others bank name, and drops one typed before switching back to ICICI Bank", () => {
        expect(saveChequeArgs(chequeFormSchema.parse(valid({ bank: "Others", bank_name: " HDFC Bank " }))).bank_name).toBe("HDFC Bank");
        expect(saveChequeArgs(chequeFormSchema.parse(valid({ bank_name: "HDFC Bank" }))).bank_name).toBeUndefined();
    });
});

describe("linesErrorMessage", () => {
    it("reads the lines' own error, nested at root by react-hook-form", () => {
        expect(linesErrorMessage({ root: { message: "Add at least one PO payment." } })).toBe("Add at least one PO payment.");
        expect(linesErrorMessage({ message: "Lines are wrong." })).toBe("Lines are wrong.");
    });

    it("shows nothing for errors on one line's boxes (no 'undefined')", () => {
        const perLine = [{ record_name: { message: "Pick the PO." } }];
        expect(linesErrorMessage(perLine as never)).toBeUndefined();
        expect(linesErrorMessage(undefined)).toBeUndefined();
    });
});
