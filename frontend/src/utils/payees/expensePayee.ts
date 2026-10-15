/**
 * Who gets paid on an expense (spec #1420 ticket #1429, ADR-0033), pure so it tests without React.
 *
 * Each expense type says whether a request names a Payee: Required, Optional or Not asked (the
 * default). The server's Payee module is the enforcement boundary
 * (`services/payees/expense_rules.py`); these mirror it so the request dialog can say why it can't
 * be sent yet, and the Expense Packages screen can describe each choice.
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
    /** The picked vendor's Payee, or null when it has none (or none is picked). */
    vendorPayee: string | null;
    /** A payee is picked, or a new one is filled in. */
    hasChoice: boolean;
    /**
     * The picked vendor's Payee is Inactive and the request newly names that vendor (a new request,
     * or one moved to it). A request already naming it keeps it.
     */
    vendorPayeeInactive?: boolean;
}

/**
 * The server's refusal of a request newly naming a vendor whose Payee is Inactive, on any type
 * (`expense_rules.VENDOR_PAYEE_INACTIVE_PROBLEM`; pinned by the shared cases).
 */
export const VENDOR_PAYEE_INACTIVE_PROBLEM =
    "This vendor's bank account is Inactive. Use Change account on the vendor page first.";

/** Why the request can't be sent yet because of who gets paid, or null. */
export const whoGetsPaidProblem = ({
    rule,
    vendor,
    vendorPayee,
    hasChoice,
    vendorPayeeInactive,
}: WhoGetsPaidState): string | null => {
    if (vendor && vendorPayeeInactive) return VENDOR_PAYEE_INACTIVE_PROBLEM;
    if (asPayeeRule(rule) !== PAYEE_RULE.REQUIRED) return null;
    if (vendor) {
        return vendorPayee
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

export const timesPaidText = (times: number): string =>
    times > 1 ? `Paid ${times} times before.` : times === 1 ? "Paid once before." : "Not paid before.";

/**
 * Whether a request's save newly names `vendor` (a real vendor on screen): a new request names it
 * anew, an edit only when it differs from `sentVendor`, the vendor the request was saved with. The
 * server asks the same (`guard._changed(doc, "vendor")`) before refusing a vendor whose Payee is
 * Inactive.
 */
export const newlyNamesVendor = (vendor: string, sentVendor: string | null | undefined): boolean =>
    vendor !== (sentVendor || "");

/**
 * Whether an edit that clears the vendor (to none or Others (No Vendor)) also clears the picked
 * Payee: it does when the pick is still the Payee the request was saved with through its vendor
 * (`sentVendorPayee`, null when it was saved with no vendor), which the server drops in the same
 * case (`guard._sent_payee`). Any other pick stays.
 */
export const vendorClearDropsPayee = (
    picked: string | null | undefined,
    sentVendorPayee: string | null | undefined,
): boolean => !!picked && picked === sentVendorPayee;
