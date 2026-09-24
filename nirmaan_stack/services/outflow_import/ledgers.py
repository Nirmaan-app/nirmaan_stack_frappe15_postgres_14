# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The three ledgers this feature settles, and what it may settle them from (slice V1).

PURE MODULE -- no `frappe`, no database, no request context. It holds vocabulary, not behaviour.

WHY IT EXISTS. `candidates.py` decides what a bank row may be OFFERED and `settle.py` decides what
it may WRITE, and until v3 each carried its own copy of the settleable-status list. Two copies of
one rule is how one gets tightened and the other does not -- and here the failure mode is that the
screen refuses to offer a record the write path would happily have paid, or worse, the reverse.
ADR-0010 B1/B2: a rule the business names gets ONE owner.

THE RULE, and it is an owner ruling, not an implementation detail (Q3, 2026-08-06; MOVED at #1289):

    RECONCILIATION PENDING ONLY. All three ledgers. No exception.

⚠️ IT SAID `APPROVED ONLY` UNTIL #1289, AND THE NEW ANCHOR REPLACES THE OLD ONE RATHER THAN JOINING
IT. The lifecycle gained a step (#1282): an Accountant presses **Mark as Done** when the money has
actually gone out, which moves a record from `Approved` to `Reconciliation Pending`. `Approved` now
means only "sanctioned" -- settling from it marks Paid money nobody has confirmed left the bank. The
sharper failure was the other way round: a bank line for a record already marked done found NOTHING,
sat unmatched, and a reviewer pressing Create recorded the same money a second time. Accepting BOTH
statuses would have left that second hole open, which is why this is a move and not a widening.

⚠️ THE `Paid`-ONLY GUARDS ARE UNTOUCHED BY THAT MOVE. A `Reconciliation Pending` record is the thing
a line settles, never a duplicate finding; adding it to the duplicate or recorded-money guards would
skip exactly the lines this anchor exists to settle.

⚠️ THE NON-PROJECT EXCEPTION IS GONE. v2 accepted `Requested` on `Non Project Expenses`, reasoning
that the doctype has no separate approval step in practice so a narrow pool would be empty. The owner
overruled it: the import PAYS what someone has already approved, and "the queue is empty" is not a
reason to pay something nobody approved. An empty pool is the correct answer when nothing is waiting.

⚠️ NOTHING HERE FILTERS BY `Paid`. An already-Paid record is not a settle candidate at all; it is a
DUPLICATE FINDING, loaded by a separate query (`candidates.load_paid_payments_by_reference`) and
turned into a Skip by `status.derive_row_outcome`. Keeping the two apart is deliberate -- see
owner ruling Q14 -- and a `Paid` entry appearing in the map below would silently make this import
able to re-pay money that has already gone out.
"""

from __future__ import annotations

__all__ = [
    "PAYMENT_DOCTYPE",
    "PROJECT_EXPENSE_DOCTYPE",
    "NON_PROJECT_EXPENSE_DOCTYPE",
    "INFLOW_DOCTYPE",
    "NON_PROJECT_INFLOW_DOCTYPE",
    "VENDOR_REFUND_DOCTYPE",
    "INFLOW_DOCTYPES",
    "EXPENSE_DOCTYPES",
    "LEDGER_DOCTYPES",
    "RECEIVED_LEDGER_DOCTYPES",
    "LEDGER_NOUNS",
    "SETTLEABLE_STATUSES",
    "TARGET_SNAPSHOT_FIELDS",
    "PAID",
    "APPROVED",
    "RECONCILIATION_PENDING",
    "DECIDED_ON_SQL",
    "SETTLED_LEDGER_SEPARATOR",
    "SETTLED_LEDGER_SQL",
    "settleable_statuses",
    "decided_on_sql",
    "is_expense_doctype",
    "project_field_of",
]

PAYMENT_DOCTYPE = "Project Payments"
PROJECT_EXPENSE_DOCTYPE = "Project Expenses"
NON_PROJECT_EXPENSE_DOCTYPE = "Non Project Expenses"

APPROVED = "Approved"
PAID = "Paid"

# The step between the two, added to the payment and expense lifecycle by #1282: an Accountant
# presses **Mark as Done** when the money has gone out, and the record waits here for its bank line.
# THIS is what the import settles from, from #1289 on -- see `SETTLEABLE_STATUSES`.
RECONCILIATION_PENDING = "Reconciliation Pending"

# The two ledgers the import may CREATE a record in. A `Project Payment` is born from a PO or SR
# request and the import must never mint one -- that is half the v3 spine, and the reason this
# tuple is not simply "every ledger".
EXPENSE_DOCTYPES = (PROJECT_EXPENSE_DOCTYPE, NON_PROJECT_EXPENSE_DOCTYPE)

# Every ledger the import may SETTLE. All three, since the v3 reversal.
#
# ⚠️ THE ORDER IS NOW READ AS A DISPLAY ORDER, not just a membership list.
# `status.derive_settled_ledger_split` walks this tuple to lay out the settled-by-ledger breakdown,
# and zero-fills from it, so reordering it reorders that panel -- specifically its PAID block since
# B8b, the received block having its own order below. It is deliberately the order a
# reviewer meets the three ledgers -- the main one first, then the two expense books -- and NOT a
# ranking by volume, which would rearrange itself between statements. Anything that needs the three
# names must bind THIS tuple; a second list is how one grows a ledger the other does not have.
LEDGER_DOCTYPES = (PAYMENT_DOCTYPE, *EXPENSE_DOCTYPES)

# The ledger a bank CREDIT can become, and the one thing this module names that is NOT settleable.
#
# ⚠️ IT IS **NOT** IN `LEDGER_DOCTYPES`, `EXPENSE_DOCTYPES` OR `SETTLEABLE_STATUSES`, AND MUST NEVER
# BE ADDED TO ANY OF THEM. `settle.INFLOW_DOCTYPE` states the rule this obeys: an inflow is never
# SETTLED, only CREATED -- there is no approved inflow waiting to be paid -- so putting it in
# `LEDGER_DOCTYPES` would grow a fourth column on the PAID breakdown for a book no debit can ever
# reach, and would make it look like a settle candidate to `settleable_statuses`.
#
# ⚠️ THE STRING IS SPELLED HERE RATHER THAN IMPORTED, on exactly the precedent
# `settle.DIRECTION_CREDIT` set: `settle.py` imports `frappe`, and this module is a PURE leaf that
# `status.py` imports under a transitive purity test. Importing upward would make `status.py`
# bench-dependent, which is the one property that test exists to protect.
# `api/outflow_import/test_review.TestInflowDoctypeSpelling` pins the two spellings against each
# other, under bench, so a rename cannot reach only one of them.
INFLOW_DOCTYPE = "Project Inflows"

# The ledger a bank CREDIT with no project behind it becomes (#1266, ADR-0016 Amendment A-D2).
# Created, never settled -- the same rule as `INFLOW_DOCTYPE`, so it is kept out of the same tuples.
NON_PROJECT_INFLOW_DOCTYPE = "Non Project Inflows"

# The ledger a bank CREDIT from a VENDOR becomes: money a vendor paid back, one record per PO / WO /
# Project Expense it is against (2026-09-17). Created, never settled, and it moves no paid amount.
VENDOR_REFUND_DOCTYPE = "Vendor Refunds"

# The ledgers that hold ONLY money received -- the books a bank CREDIT can become, in display order
# (#1268). The credit side of every duplicate check reads THIS, so an inflow book is one edit here
# rather than one per guard -- `Vendor Refunds` joined exactly that way.
#
# Kept out of `LEDGER_DOCTYPES` / `SETTLEABLE_STATUSES` for the reason above.
INFLOW_DOCTYPES = (INFLOW_DOCTYPE, NON_PROJECT_INFLOW_DOCTYPE, VENDOR_REFUND_DOCTYPE)

# The DISPLAY ORDER of the RECEIVED half of the settled-money panel (slice B8b).
#
# ⚠️ A SECOND ORDER, NOT A WIDENING OF THE FIRST, BECAUSE THE TWO BLOCKS HOLD DIFFERENT BOOKS. A
# credit becomes a `Project Inflow` (B6), a `Non Project Inflow` (#1266) or a `Vendor Refund`. A
# credit can never become a `Project Payment` or a `Project Expense`, so zero-filling the received
# block from `LEDGER_DOCTYPES` would put permanent zeroes on the panel asserting that receipts could
# have landed in books they cannot reach -- the exact opposite of what the zero-fill is for.
#
# ⚠️ `Non Project Expenses` WAS REMOVED FROM THIS LIST (owner ruling 2026-09-24). It was kept for the
# removed B7 path, which wrote a credit as a NEGATIVE `Non Project Expense`; no receipt reaches that
# book any more, so it was a permanent ₹0 line on every Received card. A leftover B7 row is NOT
# lost: its ledger is now unrecognised here, so `derive_settled_ledger_split` folds it into the
# `Other` slot, which renders only when non-zero and keeps the block's total exact.
#
# ⚠️ IT IS READ AS A DISPLAY ORDER, exactly as `LEDGER_DOCTYPES` is, and by the same function:
# `status.derive_settled_ledger_split` takes the order as a PARAMETER so there is ONE
# implementation of ordering, zero-filling and the `Other` slot, not two. Reordering this tuple
# reorders the received block. It is NEVER sorted by value.
RECEIVED_LEDGER_DOCTYPES = INFLOW_DOCTYPES

# The singular and plural READER-FACING name of each ledger, for sentences a person reads (#1253).
#
# ⚠️ EVERY LEDGER, INFLOWS INCLUDED -- this is vocabulary, not a settle list, so the rule that keeps
# the inflow ledgers out of `LEDGER_DOCTYPES` does not apply here. Read by `status._records_phrase`; a
# duplicate note must never spell a ledger name of its own.
LEDGER_NOUNS: dict[str, tuple[str, str]] = {
    PAYMENT_DOCTYPE: ("Project Payment", "Project Payments"),
    PROJECT_EXPENSE_DOCTYPE: ("Project Expense", "Project Expenses"),
    NON_PROJECT_EXPENSE_DOCTYPE: ("Non Project Expense", "Non Project Expenses"),
    INFLOW_DOCTYPE: ("Project Inflow", "Project Inflows"),
    NON_PROJECT_INFLOW_DOCTYPE: ("Non Project Inflow", "Non Project Inflows"),
    VENDOR_REFUND_DOCTYPE: ("Vendor Refund", "Vendor Refunds"),
}

# THE single source of the settleable-status rule. Read by `candidates.py` (what may be offered) and
# by `settle.py` (what may be written), so the two can never disagree about the same record.
#
# ⚠️ IT WAS `Approved` UNTIL #1289, AND THE NEW VALUE **REPLACES** IT RATHER THAN WIDENING IT. The
# lifecycle now runs `Requested -> CEO Pending -> Approved -> Reconciliation Pending -> Paid`, and
# `Approved` means sanctioned, not sent. Settling from it marked money Paid that nobody had confirmed
# left the bank; worse, a record an Accountant HAD marked done matched nothing, sat unmatched, and a
# reviewer pressing Create then recorded the same money twice. Both halves of that are closed by
# moving the anchor one step, not by accepting both.
SETTLEABLE_STATUSES: dict[str, tuple[str, ...]] = {
    PAYMENT_DOCTYPE: (RECONCILIATION_PENDING,),
    PROJECT_EXPENSE_DOCTYPE: (RECONCILIATION_PENDING,),
    NON_PROJECT_EXPENSE_DOCTYPE: (RECONCILIATION_PENDING,),
}


# The per-ledger PROJECT/VENDOR field names for the `Outflow Row Match` snapshot taken at
# settlement time (ADR-0020, Task 3). It lives beside `SETTLEABLE_STATUSES` for the same reason:
# a per-ledger column fact gets ONE owner, and `expenses._target_snapshot` reads THIS map rather
# than a private copy.
#
# ⚠️ THE PROJECT FIELD IS NAMED DIFFERENTLY ON EACH LEDGER, and `Non Project Expenses` has neither
# a project nor a vendor. A single `doc.get("project")` at the call site would silently snapshot
# `None` on every Project Expense -- correct-looking and wrong.
TARGET_SNAPSHOT_FIELDS: dict[str, tuple[str | None, str | None]] = {
    PAYMENT_DOCTYPE: ("project", "vendor"),
    PROJECT_EXPENSE_DOCTYPE: ("projects", "vendor"),
    NON_PROJECT_EXPENSE_DOCTYPE: (None, None),
}


def project_field_of(doctype: str) -> str | None:
    """The column a record of `doctype` names its project in, or `None` when it has none (#1278).

    The settle ledgers' answer is `TARGET_SNAPSHOT_FIELDS`; an inflow is created, never settled, so it is
    kept out of that map (see `INFLOW_DOCTYPE`) and answered here. `Non Project Inflows` has no project.
    """
    if doctype == INFLOW_DOCTYPE:
        return "project"
    return TARGET_SNAPSHOT_FIELDS.get(doctype, (None, None))[0]


def settleable_statuses(doctype: str) -> tuple[str, ...]:
    """The statuses this import may settle a record of `doctype` from.

    Returns an empty tuple for anything that is not one of the three ledgers, so a caller that
    forgets to check gets "nothing is settleable" rather than a KeyError in a write path.
    """
    return SETTLEABLE_STATUSES.get(doctype, ())


def is_expense_doctype(doctype: str) -> bool:
    """Whether the import may CREATE a record here. Never true for `Project Payments`."""
    return doctype in EXPENSE_DOCTYPES


# --- when was this record DECIDED? (M4, the nearest-date rule) ------------------------------------
#
# THE SINGLE DEFINITION, read by `candidates.py` when it builds the candidate pools. It lives here
# for the same reason `SETTLEABLE_STATUSES` does: two copies of a per-ledger column fact is how one
# gets corrected and the other does not.
#
# ⚠️ THIS MERGES AN APPROVAL DATE AND A MODIFICATION TIMESTAMP INTO ONE VALUE, WHICH THE APPROVED
# INBOX IS FORBIDDEN TO DO -- and the distinction is the whole licence for this constant. That rule
# (`ledger_read.py`, and the invariant behind it) governs a DISPLAY surface: a human reads that
# column, and showing them a modification under a heading saying "approved" states something false
# about 82 of 1,164 records. THIS value is a MATCHING INPUT. Nobody reads it as a label, so it
# carries no such claim -- but the note M4 writes IS read, so **every note built from this must name
# which date it used**. That is what keeps the display rule intact where it actually applies, and it
# is not optional politeness: without it a reviewer cannot tell an approval from someone editing a
# description, on the screen where they authorise money.
#
# ⚠️ `ledger_read.py` KEEPS ITS OWN TWO SEPARATE KEYS (`approved_on` / `updated_on`) and must not be
# rewritten to read this. The two answer different questions and the split there is the ruling.
#
# ⚠️ ONLY `Project Payments` HAS AN APPROVAL DATE AT ALL. Neither expense doctype has a field, an
# approver, or an approval step -- so `modified` is a PROXY, and a deliberately weak one: it moves
# whenever anyone edits the row. M4 is correspondingly weaker on expenses than on payments, which is
# why the note names the date's source rather than presenting all three ledgers as equivalent.
#
# CEO date first, then the accounts one: a payment needing CEO sign-off is not payable until that
# signature exists, and the two differ by days on exactly the high-value payments where a wrong pick
# costs most (owner ruling 2026-08-11).
DECIDED_ON_SQL: dict[str, str] = {
    PAYMENT_DOCTYPE: "COALESCE(ceo_approval_date, approval_date)",
    PROJECT_EXPENSE_DOCTYPE: "modified",
    NON_PROJECT_EXPENSE_DOCTYPE: "modified",
}


def decided_on_sql(doctype: str) -> str:
    """The SQL expression for "when was this record decided?", aliased by the caller.

    Returns `"NULL"` for anything that is not one of the three ledgers, so a caller that forgets to
    check selects a null column rather than building broken SQL. A null date makes M4 abstain, which
    is the honest outcome for a record whose decision date we cannot establish.
    """
    return DECIDED_ON_SQL.get(doctype, "NULL")


# --- which ledger did this row SETTLE into? (the settled split) -----------------------------------
#
# THE SINGLE DEFINITION, selected by `review.get_import_summary` alongside `row_status` so the
# summary can group settled transfers by the book the money landed in. It lives here beside
# `DECIDED_ON_SQL` for the same reason: a per-ledger SQL fact gets ONE owner, or one copy gets
# corrected and the other does not.
#
# ⚠️ IT IS WRITTEN AGAINST THE ALIAS `r` FOR `tabOutflow Import Row`, and that is not decoration --
# `review._row_filters` writes every fragment against `r.`, and this expression is selected in the
# same statements those fragments filter. A caller that aliases the table anything else gets a
# broken query rather than a wrong number, which is the failure mode to prefer.
#
# ⚠️ A SCALAR CORRELATED SUBQUERY, NOT A JOIN, AND THE REASON IS STRUCTURAL. FIVE queries share
# `_row_filters` -- the page query, its count, the tab counts, the facet values and the summary --
# and a JOIN changes the FROM clause of the statement it appears in. Adding one here would force
# either a fork of that one shared builder (the exact defect it exists to prevent: a count computed
# under different filters than the page it labels) or a JOIN on all five reads, three of which have
# no interest in the match table at all. A scalar subquery is confined to the SELECT list of the one
# query that wants it and leaves the other four byte-identical.
#
# ⚠️ AN AGGREGATE, NOT `LIMIT 1` (changed at ADR-0020). One transfer may settle several payments,
# so `LIMIT 1` -- which had no `ORDER BY` -- would pick one leg arbitrarily and quietly mis-report
# the row. The previous note here asked the next reader to re-check the multi-match count before
# relying on it; that count is no longer zero, and this is the re-decision it asked for.
#
# STILL A SCALAR CORRELATED SUBQUERY, for the reason the rest of this comment gives: five reads
# share `_row_filters` (nine statements across six callers, in fact) and a JOIN would change the
# FROM clause of every one of them. `string_agg` keeps the result one value per row.
#
# REVERSED LEGS ARE EXCLUDED, matching `allocation.allocated_of`. A reversed settlement no longer
# landed anywhere, and reporting its ledger would claim money that is no longer there.
#
# ⚠️ `ofm_match_import_row_idx` (patched onto already-deployed databases by
# `patches/v3_0/add_outflow_match_import_row_index.py`) is what keeps this affordable; without it
# the subquery is a sequential probe per settled row.
#
# ⚠️ `'Settled'` IS SPELLED HERE RATHER THAN IMPORTED, on the EXACT precedent `INFLOW_DOCTYPE` sets
# a few lines up (Task 6 review fix E). `allocation.py` OWNS this value as `MATCH_SETTLED` -- but
# `allocation.py` imports `status.py`, and `status.py` imports THIS module (`ledgers.py`), so
# `ledgers.py -> allocation.py -> status.py -> ledgers.py` is a REAL circular import, not a
# theoretical one: verified with `frappe.init()`, it raises `ImportError: cannot import name
# 'LEDGER_DOCTYPES' from partially initialized module 'ledgers'` regardless of which of the three
# is imported first (both `status.py`'s and `allocation.py`'s own imports of the names they need sit
# AFTER the circular import line in each file, so neither import order survives). A local constant,
# pinned against `allocation.MATCH_SETTLED` under bench by
# `test_review.TestSettledMatchKindSpelling` (the same shape as `TestInflowDoctypeSpelling`), keeps
# the two spellings from drifting the way `INFLOW_DOCTYPE` already guards against for the inflow
# doctype name.
_SETTLED_MATCH_KIND = "Settled"

# ⚠️ THE ONE PLACE THIS SEPARATOR IS SPELLED (Task 6 review fix F). `SETTLED_LEDGER_SQL` writes it
# and `review.py`'s row-shaping loop (`get_outflow_rows` AND `export_outflow_rows`, both) reads it
# back with `.split(SETTLED_LEDGER_SEPARATOR)` -- imported from here, never re-spelled, so the two
# sides cannot drift the way five independent copies of `'|'` could. It is deliberately BARE (no
# surrounding spaces): this value is PARSED back into a list, and a padded separator would leave
# whitespace on every ledger name after the split. Contrast `review._SETTLED_EXPORT_SEPARATOR`
# (`' | '`, WITH spaces) -- that one is a display string a reconciler reads directly in a
# spreadsheet cell and NOTHING ever parses back, so it is free to be human-readable. The two must
# stay two constants, not one: unifying them would either put whitespace into every parsed ledger
# name, or make the CSV's name/amount columns visually cramped.
SETTLED_LEDGER_SEPARATOR = "|"
SETTLED_LEDGER_SQL = (
    f"(SELECT string_agg(DISTINCT m.target_doctype, '{SETTLED_LEDGER_SEPARATOR}' "
    "ORDER BY m.target_doctype) "
    'FROM "tabOutflow Row Match" m '
    f"WHERE m.import_row = r.name AND m.match_kind = '{_SETTLED_MATCH_KIND}')"
)
