import { z } from "zod";

import type { ChequeDetail } from "@/components/cheques/useChequeDetail";
import { CHEQUE_BANK, CHEQUE_TYPE } from "@/types/NirmaanStack/Cheques";

import type { SaveChequeArgs } from "./chequeForm";
import { LINE_TYPE } from "./chequeLines";

/**
 * A Security Deposit cheque (#1486, spec #1477, ADR-0035), pure so vitest covers it without React (F4).
 *
 * A deposit is handed to a vendor (or a landlord) as a guarantee and never cashed. It is made out to a Vendor
 * or a typed name, needs its photo and a typed issue date (today by default), and may name the Vendor's POs and
 * Work Orders it secures: one "Secured PO/WO" line each, record only, no payment, no amount. It is Issued as
 * soon as it is saved, and Cancelled ("marked returned") by Accounts with a note.
 *
 * The server is the enforcement (`services/cheques/rules.py`: `header_problem`, `secured_line_problem`,
 * `issue_date_problem`, `deposit_cancel_problem`); this only spares the user a round trip. Messages match it.
 */

export const PO_DOCTYPE = "Procurement Orders";
export const WORK_ORDER_DOCTYPE = "Service Requests";
export type SecurableDoctype = typeof PO_DOCTYPE | typeof WORK_ORDER_DOCTYPE;

/** One PO or Work Order a deposit secures, as the form holds it. */
export interface SecuredRecordDraft {
    record_doctype: string;
    record_name: string;
    project: string;
}

/** One of the Vendor's open POs or Work Orders (`api/cheques/pickers.get_securable_records`). */
export interface SecurableRecord {
    doctype: SecurableDoctype;
    name: string;
    project: string;
    project_name: string;
    status: string;
}

const day = (v: string) => v.slice(0, 10);

const securedSchema = z.object({ record_doctype: z.string(), record_name: z.string(), project: z.string() });

/** The deposit form's schema. `today` is the browser's date (`chequeStatus.todayISO`). */
export const makeDepositFormSchema = ({ photoRequired, today }: { photoRequired: boolean; today: string }) => z
    .object({
        bank: z.enum([CHEQUE_BANK.ICICI, CHEQUE_BANK.OTHERS], {
            errorMap: () => ({ message: "Choose the bank the cheque is drawn on: ICICI Bank or Others." }),
        }),
        bank_name: z.string().optional(),
        cheque_no: z.string().trim().min(1, "Enter the cheque number."),
        cheque_date: z.string().min(1, "Enter the cheque date."),
        amount: z.coerce.number({ invalid_type_error: "Enter a cheque amount greater than 0." })
            .gt(0, "Enter a cheque amount greater than 0."),
        issue_date: z.string(),
        payee_kind: z.enum(["vendor", "typed"]),
        vendor: z.string().optional(),
        payee_name: z.string().optional(),
        attachment: z.string().optional(),
        description: z.string().optional(),
        secures: z.array(securedSchema).default([]),
    })
    .superRefine((v, ctx) => {
        const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
        if (v.bank === CHEQUE_BANK.OTHERS && !v.bank_name?.trim()) issue("bank_name", "Type the name of the bank the cheque is drawn on.");
        if (photoRequired && !v.attachment) issue("attachment", "Upload the photo of the cheque.");
        if (!v.issue_date) issue("issue_date", "Enter the issue date: the day it was handed over.");
        else if (day(v.issue_date) > day(today)) issue("issue_date", "The issue date cannot be after today.");
        if (v.payee_kind === "vendor" && !v.vendor) issue("vendor", "Pick the Vendor the cheque is made out to.");
        if (v.payee_kind === "typed") {
            if (!v.payee_name?.trim()) issue("payee_name", "Type the payee's name.");
            if (v.secures.length) issue("secures", "A cheque made out to a typed payee names no PO or Work Order.");
        }
    });

type DepositSchema = ReturnType<typeof makeDepositFormSchema>;
export type DepositFormInput = z.input<DepositSchema>;
export type DepositFormValues = z.output<DepositSchema>;

/** A new deposit: today's issue date, a Vendor payee, nothing secured. */
export const emptyDepositForm = (today: string): DepositFormInput => ({
    bank: CHEQUE_BANK.ICICI,
    bank_name: "",
    cheque_no: "",
    cheque_date: "",
    amount: "" as unknown as number,
    issue_date: today,
    payee_kind: "vendor",
    vendor: "",
    payee_name: "",
    attachment: "",
    description: "",
    secures: [],
});

/** The PO or Work Order a page's "Add Security Deposit Cheque" starts from. */
export interface DepositPageRecord {
    doctype: SecurableDoctype;
    name: string;
    project: string;
    vendor: string;
}

/** A deposit added from a PO / Work Order page: made out to its Vendor, naming that record (story 61). */
export const depositPrefill = (record: DepositPageRecord, today: string): DepositFormInput => ({
    ...emptyDepositForm(today),
    vendor: record.vendor,
    secures: [{ record_doctype: record.doctype, record_name: record.name, project: record.project }],
});

/** The Edit form's starting values: the deposit as recorded. */
export const depositFormFromDetail = (d: ChequeDetail): DepositFormInput => ({
    bank: d.bank,
    bank_name: d.bank_name ?? "",
    cheque_no: d.cheque_no,
    cheque_date: d.cheque_date,
    amount: d.amount,
    issue_date: d.issue_date ? day(d.issue_date) : "",
    payee_kind: d.vendor ? "vendor" : "typed",
    vendor: d.vendor ?? "",
    payee_name: d.payee_name ?? "",
    attachment: d.attachment ?? "",
    description: d.description ?? "",
    secures: d.lines
        .filter((l) => l.line_type === LINE_TYPE.SECURED)
        .map((l) => ({ record_doctype: l.record_doctype ?? "", record_name: l.record_name ?? "", project: l.project ?? "" })),
});

/** What `save_cheque` takes for a deposit: its type, issue date, one payee, one Secured PO/WO line per record. */
export const saveDepositArgs = (v: DepositFormValues): SaveChequeArgs => ({
    cheque_type: CHEQUE_TYPE.SECURITY_DEPOSIT,
    issue_date: v.issue_date,
    bank: v.bank,
    ...(v.bank === CHEQUE_BANK.OTHERS ? { bank_name: v.bank_name?.trim() } : {}),
    cheque_no: v.cheque_no.trim(),
    cheque_date: v.cheque_date,
    amount: v.amount,
    ...(v.payee_kind === "vendor" ? { vendor: v.vendor } : { payee_name: v.payee_name?.trim() }),
    ...(v.description?.trim() ? { description: v.description.trim() } : {}),
    ...(v.attachment ? { attachment: v.attachment } : {}),
    lines: (v.payee_kind === "vendor" ? v.secures : []).map((s) => ({
        line_type: LINE_TYPE.SECURED,
        record_doctype: s.record_doctype,
        record_name: s.record_name,
        project: s.project,
    })),
});

/** "SR/301/00004/26-27 (Work Order)", or a PO's name as it is. */
export const securedLabel = (doctype: string | null | undefined, name: string | null | undefined): string =>
    doctype === WORK_ORDER_DOCTYPE ? `${name ?? ""} (Work Order)` : name ?? "";

/** The Vendor's records the "Secures" picker still offers: those not already on the deposit. */
export const securableOptions = (records: SecurableRecord[], secured: SecuredRecordDraft[]) => {
    const taken = new Set(secured.map((s) => `${s.record_doctype}|${s.record_name}`));
    return records
        .map((r) => ({
            value: `${r.doctype}|${r.name}`,
            label: `${securedLabel(r.doctype, r.name)} · ${r.project_name || r.project}`,
            record: r,
        }))
        .filter((o) => !taken.has(o.value));
};

/** A line as the list and the detail view return it. */
interface LineOfRecord {
    line_type: string;
    record_doctype?: string | null;
    record_name?: string | null;
}

/** The records a deposit secures, by label, in line order. */
export const securedRecords = (lines: LineOfRecord[]): string[] =>
    lines.filter((l) => l.line_type === LINE_TYPE.SECURED && l.record_name).map((l) => securedLabel(l.record_doctype, l.record_name));

/** The PO card's "Also secures": the deposit's other records, beside the page's own `record`. */
export const alsoSecures = (lines: LineOfRecord[], record: string): string[] =>
    securedRecords(lines.filter((l) => l.record_name !== record));

/** The list filters for a PO / Work Order page's card: the deposit cheques whose lines name `record`. */
export const depositCardFilters = (record: string): [string, "=", string][] => [
    ["cheque_type", "=", CHEQUE_TYPE.SECURITY_DEPOSIT],
    ["record_name", "=", record],
];

const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** The Security Deposits tab's strip: held by others now (Issued) and returned or cancelled. */
export const depositFigures = (aggregates: Record<string, unknown> | null | undefined) => {
    const a = aggregates ?? {};
    return {
        held: { count: num(a.issued_count), amount: num(a.issued_amount) },
        returned: { count: num(a.cancelled_count), amount: num(a.cancelled_amount) },
    };
};
