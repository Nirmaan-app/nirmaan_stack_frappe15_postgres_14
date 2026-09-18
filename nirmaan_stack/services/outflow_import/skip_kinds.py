# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The skip-kind vocabulary: what KIND of skip a Skipped import line is.

PURE LEAF -- no imports at all, so `status.py` (the deriver) and `cashbook.py` (the Cashbook plan,
which is fenced off from the deriver) can both name the same kinds. The labels are shown to people
verbatim, as the Skipped popup's Skip Type column and filter values.
"""

# WHAT KIND of skip a line is -- the Skipped popup's "Skip Type" column and filter (owner-confirmed
# list, 2026-09-17). Stored on `Outflow Import Row.skip_kind`, whose Select carries this exact list in
# this exact order (pinned by test). Blank on every line that is not Skipped.
#
# ⚠️ STORED, NOT READ BACK OUT OF THE SENTENCE (owner ruling). `skip_reason` / `outcome_note` are
# written for a person and get reworded; a filter keyed on their prefixes would silently re-file rows
# the day one sentence changed. Every writer sets the kind BESIDE the sentence, from the same branch.
#
# ⚠️ ONE KIND PER BANK-EXCLUSION RULE, NOT ONE "NOT A SPEND" BUCKET (owner ruling). The two GL-transfer
# rules share a kind: they are the same movement, and the popup's Inflow / Outflow tabs already split
# the direction. A NEW rule in `bank_exclusions` needs a kind here in the same change -- a test fails
# otherwise.
SKIP_KIND_ALREADY_IMPORTED = "Already imported"
SKIP_KIND_REPEATED_IN_FILE = "Repeated in same file"
SKIP_KIND_BANK_REFUSED = "Bank refused"
SKIP_KIND_NO_AMOUNT = "No amount"
SKIP_KIND_OUTFLOW_RECORDED = "Outflow Already Recorded"
SKIP_KIND_INFLOW_RECORDED = "Inflow Already Recorded"
SKIP_KIND_CASHFREE_TOP_UP = "Cashfree wallet top-up"
SKIP_KIND_CASHBOOK_TOP_UP = "Cashbook wallet top-up"
SKIP_KIND_PORTER_TOP_UP = "Porter wallet top-up"
SKIP_KIND_WALLET_RETURNED = "Wallet money returned"
SKIP_KIND_BANK_INTERNAL_TRANSFER = "Bank internal transfer"
SKIP_KIND_FAILED_PAYMENT_RETURNED = "Failed payment bounced back"
SKIP_KIND_CARD_ROUNDING = "Bank card rounding (₹2)"
SKIP_KIND_CARD_BILL = "Credit card bill payment"
SKIP_KIND_CARD_AUTO_DEBIT = "Credit card auto-debit"
SKIP_KIND_CASHBOOK_INTERNAL = "Cashbook internal movement"
SKIP_KIND_BY_HAND = "Skipped by hand"

# Keyed by the `bank_exclusions` category id as a plain string: this leaf imports nothing, and
# `status.derive_staged_row_outcome` is handed the id rather than importing `bank_exclusions`. Parity with `SKIP_CATEGORY_IDS` is pinned by test.
SKIP_KIND_BY_EXCLUSION_CATEGORY: dict[str, str] = {
    "platform_cashfree": SKIP_KIND_CASHFREE_TOP_UP,
    "platform_cashbook": SKIP_KIND_CASHBOOK_TOP_UP,
    "platform_porter": SKIP_KIND_PORTER_TOP_UP,
    "gateway_wallet_return": SKIP_KIND_WALLET_RETURNED,
    "internal_gl_transfer": SKIP_KIND_BANK_INTERNAL_TRANSFER,
    "internal_gl_transfer_in": SKIP_KIND_BANK_INTERNAL_TRANSFER,
    "neft_return_failed": SKIP_KIND_FAILED_PAYMENT_RETURNED,
    "bank_card_adjustment": SKIP_KIND_CARD_ROUNDING,
    "credit_card_bill_payment": SKIP_KIND_CARD_BILL,
    "credit_facility_auto_debit": SKIP_KIND_CARD_AUTO_DEBIT,
}

SKIP_KINDS = (
    SKIP_KIND_ALREADY_IMPORTED,
    SKIP_KIND_REPEATED_IN_FILE,
    SKIP_KIND_BANK_REFUSED,
    SKIP_KIND_NO_AMOUNT,
    SKIP_KIND_OUTFLOW_RECORDED,
    SKIP_KIND_INFLOW_RECORDED,
    SKIP_KIND_CASHFREE_TOP_UP,
    SKIP_KIND_CASHBOOK_TOP_UP,
    SKIP_KIND_PORTER_TOP_UP,
    SKIP_KIND_WALLET_RETURNED,
    SKIP_KIND_BANK_INTERNAL_TRANSFER,
    SKIP_KIND_FAILED_PAYMENT_RETURNED,
    SKIP_KIND_CARD_ROUNDING,
    SKIP_KIND_CARD_BILL,
    SKIP_KIND_CARD_AUTO_DEBIT,
    SKIP_KIND_CASHBOOK_INTERNAL,
    SKIP_KIND_BY_HAND,
)

# The kinds a BANK-STATEMENT RULE decided (`bank_exclusions`): the line was read as money moving inside
# the bank or between our own accounts. Unskipping one warns before it goes back to work (owner, B1).
BANK_RULE_SKIP_KINDS = frozenset(SKIP_KIND_BY_EXCLUSION_CATEGORY.values())

# What each rule-decided kind means, in plain words -- the Skip Type hover's "why". One line each; the
# rule id itself stays in the stored sentence for anyone auditing the rule.
SKIP_KIND_RULE_DESCRIPTIONS: dict[str, str] = {
    SKIP_KIND_CASHFREE_TOP_UP: (
        "Money moved into our Cashfree payout wallet. The real payments come from the Cashfree statement."
    ),
    SKIP_KIND_CASHBOOK_TOP_UP: (
        "Money moved into our Cashbook wallet. The real spends come from the Cashbook statement."
    ),
    SKIP_KIND_PORTER_TOP_UP: "Money moved into our Porter wallet. A top-up, not a spend.",
    SKIP_KIND_WALLET_RETURNED: "Unused money coming back from the payout wallet. Not a receipt.",
    SKIP_KIND_BANK_INTERNAL_TRANSFER: "The bank's own ledger transfer. No money left or joined the company.",
    SKIP_KIND_FAILED_PAYMENT_RETURNED: (
        "A payment we made failed and came back. The original debit is already in this statement."
    ),
    SKIP_KIND_CARD_ROUNDING: "A ₹2 card rounding entry the bank posted. Not a transaction anyone made.",
    SKIP_KIND_CARD_BILL: "Paying the credit card bill. The card's own spends are recorded separately.",
    SKIP_KIND_CARD_AUTO_DEBIT: "An automatic debit that services the card or credit facility. Not a purchase.",
    SKIP_KIND_CASHBOOK_INTERNAL: "Money moving between our own Cashbook balances. Not a spend.",
}

