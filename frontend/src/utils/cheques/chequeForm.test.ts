import { describe, expect, it } from "vitest";

import { makeChequeFormSchema, saveChequeArgs, type ChequeFormInput } from "./chequeForm";

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
    description: "",
    ...overrides,
});

const schema = makeChequeFormSchema({ photoRequired: true });

/** The message on `field`, or undefined when the form is valid there. */
const problemAt = (input: ChequeFormInput, field: string) => {
    const result = schema.safeParse(input);
    if (result.success) return undefined;
    return result.error.issues.find((i) => i.path[0] === field)?.message;
};

describe("makeChequeFormSchema: a Payment cheque's Edit (spec #1514)", () => {
    it("accepts the cheque as recorded, with no description", () => {
        expect(schema.safeParse(valid()).success).toBe(true);
    });

    it("asks for the number and the date", () => {
        expect(problemAt(valid({ cheque_no: "  " }), "cheque_no")).toBe("Enter the cheque number.");
        expect(problemAt(valid({ cheque_date: "" }), "cheque_date")).toBe("Enter the Cheque/Payment Date.");
    });

    it("needs the bank's name for Others only", () => {
        expect(problemAt(valid({ bank: "Others" }), "bank_name")).toBe("Type the name of the bank the cheque is drawn on.");
        expect(problemAt(valid({ bank: "Others", bank_name: "HDFC Bank" }), "bank_name")).toBeUndefined();
    });

    it("takes an Old-type cheque's typed payee as recorded", () => {
        expect(schema.safeParse(valid({ payee_kind: "typed", vendor: "", payee_name: "Tata Power" })).success).toBe(true);
    });

    it("asks for the photo only when told to: a backfilled cheque has none", () => {
        const input = valid({ attachment: "" });
        expect(problemAt(input, "attachment")).toBe("Upload the photo of the cheque.");
        expect(makeChequeFormSchema({ photoRequired: false }).safeParse(input).success).toBe(true);
    });
});

describe("saveChequeArgs", () => {
    it("sends the Vendor and not a left-over typed name", () => {
        expect(saveChequeArgs(schema.parse(valid({ payee_name: "left over" })))).toEqual({
            bank: "ICICI Bank",
            cheque_no: "004521",
            cheque_date: "2026-10-14",
            amount: 25000,
            vendor: "VEN-0042",
            attachment: PHOTO,
        });
    });

    it("sends an Old-type cheque's typed payee back as recorded", () => {
        const args = saveChequeArgs(
            schema.parse(valid({ payee_kind: "typed", vendor: "VEN-0042", payee_name: " Tata Power ", description: "Rent" })),
        );
        expect(args.payee_name).toBe("Tata Power");
        expect(args.vendor).toBeUndefined();
        expect(args.description).toBe("Rent");
    });

    it("sends the Others bank name, and drops one typed before switching back to ICICI Bank", () => {
        expect(saveChequeArgs(schema.parse(valid({ bank: "Others", bank_name: " HDFC Bank " }))).bank_name).toBe("HDFC Bank");
        expect(saveChequeArgs(schema.parse(valid({ bank_name: "HDFC Bank" }))).bank_name).toBeUndefined();
    });
});
