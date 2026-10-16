import { z } from "zod";

import { CHEQUE_BANK } from "@/types/NirmaanStack/Cheques";
import { parseNumber } from "@/utils/parseNumber";

import { EXPENSE_LABELS, LINE_NEEDS, LINE_TYPE, saveLineArgs, type ChequeLineDraft, type SaveLineArg } from "./chequeLines";

/**
 * The Add Cheque form's rules (spec #1407), pure so vitest covers them without React (F4).
 *
 * They mirror the server's `services/cheques/rules.header_problem`, which is the enforcement: this
 * only spares the user a round trip. The messages match the server's.
 */

/** Who the cheque is made out to: a Vendor picked from the list, or a name typed in. */
export type PayeeKind = "vendor" | "typed";

/** One Cheque line of any kind. Its rules, per kind (`LINE_NEEDS`), are checked in the form's `superRefine`. */
const lineSchema = z.object({
    line_type: z.enum(["PO/WO Payment", "Project Expense", "Non-project Expense"]),
    project: z.string(),
    record_doctype: z.string(),
    record_name: z.string(),
    payment_name: z.string(),
    amount: z.union([z.number(), z.string()]),
}) satisfies z.ZodType<ChequeLineDraft>;

/**
 * The form's schema. The photo is uploaded as soon as it is picked; the form holds its file URL.
 * `photoRequired` is false only when editing a Cheque that has none (a backfilled one, #1419/#1418):
 * the server asks for the photo on a new Cheque only.
 */
export const makeChequeFormSchema = ({ photoRequired }: { photoRequired: boolean }) => z
    .object({
        bank: z.enum([CHEQUE_BANK.ICICI, CHEQUE_BANK.OTHERS], {
            errorMap: () => ({ message: "Choose the bank the cheque is drawn on: ICICI Bank or Others." }),
        }),
        bank_name: z.string().optional(),
        cheque_no: z.string().trim().min(1, "Enter the cheque number."),
        cheque_date: z.string().min(1, "Enter the cheque date."),
        amount: z.coerce.number({ invalid_type_error: "Enter a cheque amount greater than 0." })
            .gt(0, "Enter a cheque amount greater than 0."),
        payee_kind: z.enum(["vendor", "typed"]),
        vendor: z.string().optional(),
        payee_name: z.string().optional(),
        attachment: z.string().optional(),
        description: z.string().optional(),
        /** The Cheque's lines; none makes it an Ad-hoc cheque. A typed payee takes expense lines only. */
        lines: z.array(lineSchema).default([]),
    })
    .superRefine((v, ctx) => {
        if (v.bank === CHEQUE_BANK.OTHERS && !v.bank_name?.trim()) {
            ctx.addIssue({ code: "custom", path: ["bank_name"], message: "Type the name of the bank the cheque is drawn on." });
        }
        if (v.payee_kind === "vendor" && !v.vendor) {
            ctx.addIssue({ code: "custom", path: ["vendor"], message: "Pick the Vendor the cheque is made out to." });
        }
        if (v.payee_kind === "typed" && !v.payee_name?.trim()) {
            ctx.addIssue({ code: "custom", path: ["payee_name"], message: "Type the payee's name." });
        }
        if (photoRequired && !v.attachment) {
            ctx.addIssue({ code: "custom", path: ["attachment"], message: "Upload the photo of the cheque." });
        }
        if (v.payee_kind !== "vendor" && v.lines.some((l) => l.line_type === LINE_TYPE.PO_WO)) {
            ctx.addIssue({
                code: "custom",
                path: ["lines"],
                message: "A PO or Work Order payment needs a cheque made out to a Vendor, not a typed payee.",
            });
        }
        v.lines.forEach((line, i) => {
            const needs = LINE_NEEDS[line.line_type];
            const issue = (field: keyof ChequeLineDraft, message: string) =>
                ctx.addIssue({ code: "custom", path: ["lines", i, field], message });
            if (needs.project && !line.project) issue("project", "Pick the project.");
            if (needs.record && !line.record_name) issue("record_name", "Pick the PO or Work Order.");
            if (needs.expense && !line.payment_name) issue("payment_name", `Pick the ${EXPENSE_LABELS[line.line_type]}.`);
            // A picked payment or expense lends its amount; otherwise the amount is typed.
            if (!line.payment_name && !needs.expense && parseNumber(line.amount) <= 0) {
                issue("amount", "Enter the amount, greater than 0.");
            }
        });
        if (v.lines.length === 0 && !v.description?.trim()) {
            ctx.addIssue({
                code: "custom",
                path: ["description"],
                message: "A cheque with no lines is an Ad-hoc cheque: write a description of what it pays for.",
            });
        }
    });

export const chequeFormSchema = makeChequeFormSchema({ photoRequired: true });

export type ChequeFormInput = z.input<typeof chequeFormSchema>;
export type ChequeFormValues = z.output<typeof chequeFormSchema>;

export const EMPTY_CHEQUE_FORM: ChequeFormInput = {
    bank: CHEQUE_BANK.ICICI,
    bank_name: "",
    cheque_no: "",
    cheque_date: "",
    amount: "" as unknown as number,
    payee_kind: "vendor",
    vendor: "",
    payee_name: "",
    attachment: "",
    description: "",
    lines: [],
};

/** The arguments `api/cheques/save_cheque.save_cheque` takes. */
export interface SaveChequeArgs {
    bank: string;
    bank_name?: string;
    cheque_no: string;
    cheque_date: string;
    amount: number;
    vendor?: string;
    payee_name?: string;
    description?: string;
    attachment?: string;
    lines?: SaveLineArg[];
    /** The Cheque being edited (#1418); absent for a new one. */
    name?: string;
}

/** Turn valid form values into the save arguments: one payee only, a bank name only for Others. */
export const saveChequeArgs = (v: ChequeFormValues): SaveChequeArgs => ({
    bank: v.bank,
    ...(v.bank === CHEQUE_BANK.OTHERS ? { bank_name: v.bank_name?.trim() } : {}),
    cheque_no: v.cheque_no.trim(),
    cheque_date: v.cheque_date,
    amount: v.amount,
    ...(v.payee_kind === "vendor" ? { vendor: v.vendor } : { payee_name: v.payee_name?.trim() }),
    ...(v.description?.trim() ? { description: v.description.trim() } : {}),
    ...(v.attachment ? { attachment: v.attachment } : {}),
    ...(v.lines.length ? { lines: saveLineArgs(v.lines) } : {}),
});

/**
 * The error on the lines as a whole (a PO/WO line on a typed payee), or undefined. Once the lines are
 * a field array, react-hook-form nests that error at `root`; an error on one line's box is an array
 * with no message of its own, and shows under that box instead.
 */
export const linesErrorMessage = (
    error: { message?: unknown; root?: { message?: unknown } } | undefined,
): string | undefined => {
    const message = error?.root?.message ?? error?.message;
    return typeof message === "string" && message ? message : undefined;
};
