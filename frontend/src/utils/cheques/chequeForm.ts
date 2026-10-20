import { z } from "zod";

import { CHEQUE_BANK } from "@/types/NirmaanStack/Cheques";

import type { SaveLineArg } from "./chequeLines";

/**
 * A Payment cheque's Edit form (spec #1407; spec #1514), pure so vitest covers it without React (F4).
 *
 * The Tracker makes no Payment cheque: one is made with its payment on the PO page. Its Edit corrects what is
 * written on the paper, so the form holds the cheque's header only; its lines are shown, never sent. The rules
 * mirror the server's `services/cheques/rules.header_problem`, which is the enforcement: this only spares the
 * user a round trip. The messages match the server's.
 */

/** Who the cheque is made out to. A Payment cheque names a Vendor; only an Old-type cheque has a typed name. */
export type PayeeKind = "vendor" | "typed";

interface ChequeFormRules {
    /** False only when editing a Cheque that has none (a backfilled one, #1419/#1418). */
    photoRequired: boolean;
}

/** The form's schema. The photo is uploaded as soon as it is picked; the form holds its file URL. */
export const makeChequeFormSchema = ({ photoRequired }: ChequeFormRules) => z
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
    })
    .superRefine((v, ctx) => {
        const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
        if (v.bank === CHEQUE_BANK.OTHERS && !v.bank_name?.trim()) {
            issue(["bank_name"], "Type the name of the bank the cheque is drawn on.");
        }
        if (photoRequired && !v.attachment) issue(["attachment"], "Upload the photo of the cheque.");
        if (v.payee_kind === "vendor" && !v.vendor) issue(["vendor"], "Pick the Vendor the cheque is made out to.");
        if (v.payee_kind === "typed" && !v.payee_name?.trim()) issue(["payee_name"], "Type the payee's name.");
    });

/** The schema whose types the form uses. */
const chequeFormSchema = makeChequeFormSchema({ photoRequired: true });

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
};

/** Saves a new Security Deposit cheque, or the Edit of a Cheque of either type (spec #1514). */
export const SAVE_CHEQUE_API = "nirmaan_stack.api.cheques.save_cheque.save_cheque";

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
    /** "Security Deposit" for a new deposit cheque (#1486): the server records no other new cheque (spec #1514). */
    cheque_type?: string;
    /** A deposit cheque's typed issue date. */
    issue_date?: string;
}

/** Turn valid form values into the save arguments: one payee only, a bank name only for Others, no lines. */
export const saveChequeArgs = (v: ChequeFormValues): SaveChequeArgs => ({
    bank: v.bank,
    ...(v.bank === CHEQUE_BANK.OTHERS ? { bank_name: v.bank_name?.trim() } : {}),
    cheque_no: v.cheque_no.trim(),
    cheque_date: v.cheque_date,
    amount: v.amount,
    ...(v.payee_kind === "vendor" ? { vendor: v.vendor } : { payee_name: v.payee_name?.trim() }),
    ...(v.description?.trim() ? { description: v.description.trim() } : {}),
    ...(v.attachment ? { attachment: v.attachment } : {}),
});
