import { z } from "zod";

import { CHEQUE_BANK } from "@/types/NirmaanStack/Cheques";
import { parseNumber } from "@/utils/parseNumber";

import { LINE_NEEDS, LINE_TYPE, saveLineArgs, type ChequeLineDraft, type SaveLineArg } from "./chequeLines";

/**
 * The Add Cheque form's rules (spec #1407; #1482, spec #1477), pure so vitest covers them without React (F4).
 *
 * They mirror the server's `services/cheques/rules.header_problem` and `tracker_payment_cheque_problem`,
 * which are the enforcement: this only spares the user a round trip. The messages match the server's.
 */

/** Who the cheque is made out to. A Payment cheque names a Vendor; only an Old-type cheque has a typed name. */
export type PayeeKind = "vendor" | "typed";

/** One Cheque line. A Payment cheque's are PO lines; an Old-type cheque may still show expense lines. */
const lineSchema = z.object({
    // Every kind the doctype has, so a recorded line parses; a Payment cheque refuses all but PO lines below.
    line_type: z.enum(["PO/WO Payment", "Project Expense", "Non-project Expense", "Secured PO/WO"]),
    project: z.string(),
    record_doctype: z.string(),
    record_name: z.string(),
    payment_name: z.string(),
    payment_status: z.string().optional(),
    amount: z.union([z.number(), z.string()]),
}) satisfies z.ZodType<ChequeLineDraft>;

export const NO_LINES_MESSAGE = "Add at least one PO payment: a Payment cheque pays the PO payments on its lines.";

interface ChequeFormRules {
    /** False only when editing a Cheque that has none (a backfilled one, #1419/#1418). */
    photoRequired: boolean;
    /**
     * True for a Payment cheque the Tracker adds or edits in full (#1482): a Vendor payee, at least one
     * line, PO lines only. False for a photo-only edit (an Old-type, Issued, Cleared or Cancelled cheque),
     * whose other boxes are locked as recorded.
     */
    paymentCheque: boolean;
}

/** The form's schema. The photo is uploaded as soon as it is picked; the form holds its file URL. */
export const makeChequeFormSchema = ({ photoRequired, paymentCheque }: ChequeFormRules) => z
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
        lines: z.array(lineSchema).default([]),
    })
    .superRefine((v, ctx) => {
        const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
        if (v.bank === CHEQUE_BANK.OTHERS && !v.bank_name?.trim()) {
            issue(["bank_name"], "Type the name of the bank the cheque is drawn on.");
        }
        if (photoRequired && !v.attachment) issue(["attachment"], "Upload the photo of the cheque.");
        if (!paymentCheque) {
            if (v.payee_kind === "vendor" && !v.vendor) issue(["vendor"], "Pick the Vendor the cheque is made out to.");
            if (v.payee_kind === "typed" && !v.payee_name?.trim()) issue(["payee_name"], "Type the payee's name.");
            return;
        }
        if (v.payee_kind !== "vendor") {
            issue(["vendor"], "A Payment cheque is made out to a Vendor: pick the Vendor, not a typed payee.");
        } else if (!v.vendor) {
            issue(["vendor"], "Pick the Vendor the cheque is made out to.");
        }
        if (v.lines.length === 0) issue(["lines"], NO_LINES_MESSAGE);
        v.lines.forEach((line, i) => {
            if (line.line_type !== LINE_TYPE.PO_WO) {
                issue(["lines", i, "line_type"], "A Payment cheque pays PO payments only.");
                return;
            }
            const needs = LINE_NEEDS[line.line_type];
            if (needs.project && !line.project) issue(["lines", i, "project"], "Pick the project.");
            if (needs.record && !line.record_name) issue(["lines", i, "record_name"], "Pick the PO.");
            // A picked payment lends its amount; otherwise the amount is typed.
            if (!line.payment_name && parseNumber(line.amount) <= 0) {
                issue(["lines", i, "amount"], "Enter the amount, greater than 0.");
            }
        });
    });

/** A new Payment cheque's schema. */
export const chequeFormSchema = makeChequeFormSchema({ photoRequired: true, paymentCheque: true });

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
    /** "Security Deposit" for a deposit cheque (#1486); absent: a Payment cheque. */
    cheque_type?: string;
    /** A deposit cheque's typed issue date. */
    issue_date?: string;
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
 * The error on the lines as a whole (no lines), or undefined. Once the lines are a field array,
 * react-hook-form nests that error at `root`; an error on one line's box is an array with no message of
 * its own, and shows under that box instead.
 */
export const linesErrorMessage = (
    error: { message?: unknown; root?: { message?: unknown } } | undefined,
): string | undefined => {
    const message = error?.root?.message ?? error?.message;
    return typeof message === "string" && message ? message : undefined;
};
