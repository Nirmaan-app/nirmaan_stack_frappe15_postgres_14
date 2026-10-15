/**
 * Who gets paid on an expense (spec #1420 tickets #1429, #1436, ADR-0033), pure so it tests without
 * React.
 *
 * Each expense type says whether a request names who gets paid: Required, Optional or Not asked (the
 * default). These are SCREEN rules (#1436): the server refuses none of them and only copies accounts
 * (`services/payees/pay_to`). The request dialog blocks sending with `whoGetsPaidProblem`, and the
 * Expense Packages screen describes each choice.
 */

/** The vendor picker's "no vendor on record" choice, as `vendor-select` labels it. */
const OTHERS_VENDOR_LABEL = "Others (No Vendor)";

export const PAYEE_RULE = {
    REQUIRED: "Required",
    OPTIONAL: "Optional",
    NOT_ASKED: "Not asked",
} as const;

export type PayeeRule = (typeof PAYEE_RULE)[keyof typeof PAYEE_RULE];

/** In the order the Expense Type's Select lists them (pinned to the server's `PAYEE_RULES`). */
export const PAYEE_RULES: PayeeRule[] = [PAYEE_RULE.REQUIRED, PAYEE_RULE.OPTIONAL, PAYEE_RULE.NOT_ASKED];

/** The one-line explanation under each choice in the expense type's Edit dialog. */
export const PAYEE_RULE_HELP: Record<PayeeRule, string> = {
    [PAYEE_RULE.REQUIRED]: "The request can't be sent without a payee.",
    [PAYEE_RULE.OPTIONAL]: "The request asks, but it can be left blank. Use for costs sometimes paid by card or cash.",
    [PAYEE_RULE.NOT_ASKED]: "The request doesn't show the payee field.",
};

/** A stored value as a rule; blank or unknown is Not asked, the field's default. */
export const asPayeeRule = (value: string | null | undefined): PayeeRule =>
    PAYEE_RULES.find((rule) => rule === value) ?? PAYEE_RULE.NOT_ASKED;

/** True when a request of this type shows the "Who gets paid" section. */
export const asksWhoGetsPaid = (rule: string | null | undefined): boolean =>
    asPayeeRule(rule) !== PAYEE_RULE.NOT_ASKED;

/**
 * True when the request shows the "Who gets paid" section: its type asks, or a vendor is picked. A
 * *Not asked* type naming a vendor still carries the vendor's Payee (the server fills it in), so the
 * raiser sees whose account the accountant will pay.
 */
export const showsWhoGetsPaid = (rule: string | null | undefined, vendorChosen: boolean): boolean =>
    asksWhoGetsPaid(rule) || vendorChosen;

/** How many of these types ask who gets paid (the Expense Packages summary line). */
export const countAskingWhoGetsPaid = (types: { payee_rule?: string | null }[]): number =>
    types.filter((t) => asksWhoGetsPaid(t.payee_rule)).length;

/** The line under the section's heading on the request. */
export const whoGetsPaidHelp = (rule: string | null | undefined, expenseType: string): string => {
    switch (asPayeeRule(rule)) {
        case PAYEE_RULE.REQUIRED:
            return `Required for ${expenseType}. The accountant pays this account.`;
        case PAYEE_RULE.OPTIONAL:
            return `Optional for ${expenseType}. Leave it blank if this is paid by card or cash.`;
        default:
            return `${expenseType} doesn't ask who gets paid, but a vendor is paid into its own account.`;
    }
};

export interface WhoGetsPaidState {
    rule: string | null | undefined;
    expenseType: string;
    /** The vendor's display name when one is picked (not "Others (No Vendor)"), else null. */
    vendor: string | null;
    /** The picked vendor has an account the request is (or will be) paid into. */
    vendorHasAccount: boolean;
    /** A payee is picked, or a new one is filled in. */
    hasChoice: boolean;
}

/** Why the request can't be sent yet because of who gets paid, or null. */
export const whoGetsPaidProblem = ({
    rule,
    vendor,
    vendorHasAccount,
    hasChoice,
}: WhoGetsPaidState): string | null => {
    if (asPayeeRule(rule) !== PAYEE_RULE.REQUIRED) return null;
    if (vendor) {
        return vendorHasAccount
            ? null
            : `${vendor} has no bank account on record. Add it on the vendor's page, or set Vendor to ${OTHERS_VENDOR_LABEL} and pick a payee.`;
    }
    return hasChoice ? null : "Pick who gets paid, or add a new payee.";
};

interface PayeeAccount {
    account_number: string;
    ifsc: string;
    bank_name?: string | null;
    bank_branch?: string | null;
}

export const payeeAccountLine = (p: PayeeAccount): string => `A/c ${p.account_number}, IFSC ${p.ifsc}`;
