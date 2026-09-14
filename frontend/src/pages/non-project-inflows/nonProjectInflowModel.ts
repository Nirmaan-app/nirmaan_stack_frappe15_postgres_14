/**
 * Non-Project Inflows (#1265, ADR-0016 Amendment A) — the page's pure rules.
 *
 * The doctype's `validate` and role permissions are the enforcement boundary; this module is the
 * ONE frontend home for the same rules, so the add and edit forms and the action buttons cannot
 * disagree with each other (ADR-0010 F1/F4). The type list is pinned to the doctype JSON by the
 * parity case in `nonProjectInflowModel.test.ts`.
 */

import {
    NON_PROJECT_INFLOWS_ACCESS,
    NON_PROJECT_INFLOWS_DELETE,
    NON_PROJECT_INFLOWS_EDIT,
} from "@/constants/roles";
import { parseNumber } from "@/utils/parseNumber";

export const DOCTYPE = "Non Project Inflows";

export const INFLOW_TYPES = ["Interest Payouts", "FD Closures", "Loan Received", "Others"] as const;
export type InflowType = (typeof INFLOW_TYPES)[number];
export const INFLOW_TYPE_OTHERS: InflowType = "Others";

/** The form as typed: every value is a string, exactly what the inputs hold. */
export interface NonProjectInflowForm {
    inflow_type: string;
    description: string;
    amount: string;
    utr: string;
    payment_date: string; // yyyy-MM-dd
}

export type NonProjectInflowFormErrors = Partial<Record<keyof NonProjectInflowForm, string>>;

/** Is this one of the four Inflow Types? The one membership test (the Decision Dialog's gate reads it too). */
export const isInflowType = (value: string): value is InflowType =>
    (INFLOW_TYPES as readonly string[]).includes(value);

/** `true` when the type demands a description. The one place the Others rule is spelled. */
export const descriptionRequired = (inflowType: string): boolean => inflowType === INFLOW_TYPE_OTHERS;

export const validateNonProjectInflowForm = (form: NonProjectInflowForm): NonProjectInflowFormErrors => {
    const errors: NonProjectInflowFormErrors = {};
    if (!isInflowType(form.inflow_type)) errors.inflow_type = "Pick an Inflow Type.";
    if (descriptionRequired(form.inflow_type) && !form.description.trim()) {
        errors.description = "A description is required when the type is Others.";
    }
    if (parseNumber(form.amount) <= 0) errors.amount = "Amount must be greater than 0.";
    if (!form.utr.trim()) errors.utr = "Payment reference (UTR) is required.";
    if (!form.payment_date) errors.payment_date = "Payment date is required.";
    return errors;
};

export interface NonProjectInflowDoc {
    inflow_type: string;
    description: string | null;
    amount: number;
    utr: string;
    payment_date: string;
    inflow_attachment: string | null;
}

/**
 * The payload for both create and edit. Blank description and a missing receipt go as `null`,
 * never omitted, so an edit that clears them actually clears them.
 */
export const buildNonProjectInflowDoc = (
    form: NonProjectInflowForm,
    attachmentUrl: string | null
): NonProjectInflowDoc => ({
    inflow_type: form.inflow_type,
    description: form.description.trim() || null,
    amount: parseNumber(form.amount),
    utr: form.utr.trim(),
    payment_date: form.payment_date,
    inflow_attachment: attachmentUrl || null,
});

const allows = (set: readonly string[], role?: string | null, userId?: string | null): boolean =>
    userId === "Administrator" || (!!role && set.includes(role));

/** Who reaches the page and may add a record. Same set as the route guard and sidebar item, which read the constant directly. */
export const canCreateNonProjectInflow = (role?: string | null, userId?: string | null): boolean =>
    allows(NON_PROJECT_INFLOWS_ACCESS, role, userId);

export const canEditNonProjectInflow = (role?: string | null, userId?: string | null): boolean =>
    allows(NON_PROJECT_INFLOWS_EDIT, role, userId);

export const canDeleteNonProjectInflow = (role?: string | null, userId?: string | null): boolean =>
    allows(NON_PROJECT_INFLOWS_DELETE, role, userId);
