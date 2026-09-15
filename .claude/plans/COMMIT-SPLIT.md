# Commit split — unified approvals (50 files)

Ordered so each commit is reviewable on its own and the tree builds at every step.
**Run these yourself** — I don't stage or commit.

⚠️ Before any of it: `bench --site localhost migrate` (commit 2 carries schema).

---

## 1 — the shared rules, with nothing calling them yet

    git add nirmaan_stack/services/approval_tiers.py \
            nirmaan_stack/services/settlement.py \
            nirmaan_stack/services/test_approval_tiers.py \
            nirmaan_stack/services/test_settlement.py \
            frontend/src/utils/approvalTiers.ts frontend/src/utils/approvalTiers.test.ts \
            frontend/src/utils/settlement.ts frontend/src/utils/settlement.test.ts

    git commit -m "feat(approvals): add shared amount-tier and settlement rule modules

Two pure modules, no frappe imports, plus byte-for-behaviour TypeScript mirrors.

approval_tiers: below 15,000 auto-approves; the CEO line is a PARAMETER because it
differs per ledger -- 50,000 for Project Payments, 30,000 for both expense ledgers.
A non-positive amount is never auto-approved but is still banded by its size.

settlement: SETTLED_STATUSES = (Reconciliation Pending, Paid). Paid now means
RECONCILED, so the money-out event moves to Approved -> Reconciliation Pending.

Nothing calls either module in this commit. The TS parity tests READ the Python
source, and were verified to go red on drift and green on restore.

36 Python + 36 TypeScript tests passing."

## 2 — schema (needs a migrate)

    git add nirmaan_stack/nirmaan_stack/doctype/project_expenses/project_expenses.json \
            nirmaan_stack/nirmaan_stack/doctype/non_project_expenses/non_project_expenses.json

    git commit -m "feat(expenses): add approval_date, ceo_approval_date and auto_approved

Three nullable columns on both expense ledgers, labels copied verbatim from Project
Payments, plus the CEO Pending / Reconciliation Pending / Rejected values on each
status Select.

No data is read or rewritten and no existing status value changes. Written by Frappe
through the Desk/DocType layer, not hand-edited.

Requires: bench --site localhost migrate"

## 3 — expenses adopt the rule

    git add nirmaan_stack/nirmaan_stack/doctype/project_expenses/project_expenses.py \
            nirmaan_stack/nirmaan_stack/doctype/non_project_expenses/non_project_expenses.py \
            frontend/src/utils/expenseApproval.ts frontend/src/utils/expenseApproval.test.ts \
            frontend/src/pages/ProjectExpenses/ProjectExpensesList.tsx \
            frontend/src/pages/NonProjectExpenses/NonProjectExpensesPage.tsx

    git commit -m "feat(expenses): route expense approval through the shared tier rule

Deletes the local AUTO_APPROVE_LIMIT = 10000 from both doctype controllers and calls
initial_status() instead, passing TIER_L2_ABOVE_EXPENSES so the CEO line is 30,000.

An auto-approved expense now STAMPS auto_approved + approval_date + ceo_approval_date
the way Project Payments does. Without it an auto-approval was indistinguishable from
a human one and the dashboard's Auto Approval counters could never see it.

An L1 approval now routes through statusAfterL1(amount): it either finishes the
approval or forwards to CEO Pending. It previously wrote Approved unconditionally, so
an expense above the CEO line skipped the gate entirely.

expenseApproval.ts no longer owns a threshold -- it owns copy, and reads the shared rule.

flt() before every tier test: Project Expenses.amount is a varchar column, so a raw
string compare puts \"9000\" above \"30000\"."

## 4 — payments adopt the rule  ⚠️ riskiest

    git add nirmaan_stack/api/payments/project_payments.py \
            nirmaan_stack/api/payments/bulk_actions.py

    git commit -m "feat(payments): adopt the 15k/50k tiers and make the approve target per-row

Creation no longer routes on PAYMENT_AUTO_APPROVAL_THRESHOLD (10001); it calls
is_auto_approved() -- the shared 15,000 line. An L1 approval on a 15k-50k payment now
FINISHES the approval instead of forwarding, so roughly 912 payments a year stop
reaching the CEO.

bulk_actions: the approve target was ONE constant for a whole batch. With L1 finishing
some approvals and forwarding others, two payments in the same batch can have different
destinations, so the group key now carries the target. _process_group still receives one
target per call and its PO row-locking is untouched.

The SR tax-withholding gate compared against that same batch constant. Left alone, every
15k-50k payment approved in bulk would have landed at Approved with NO deduction, no
error and nothing on screen looking wrong. It now re-reads the committed status and
deducts for the rows that actually reached Approved."

## 5 — the union endpoint

    git add nirmaan_stack/api/approvals/ \
            nirmaan_stack/api/sidebar_counts.py \
            frontend/src/pages/ProjectPayments/approve-payments/constants.ts

    git commit -m "feat(approvals): add the unified money-out queue endpoint

get_approval_queue: a UNION ALL of Project Payments + Project Expenses + Non Project
Expenses, normalized to one row shape, filtered/sorted/paged OVER the union so age and
amount order correctly ACROSS ledgers. Only unions the ledgers the caller can read.

Project Expenses.amount is a varchar column: an unguarded ORDER BY returns 999 above
26,000 (measured), so every read of it casts. Tier is derived server-side from the cast
amount, so the chip and the routing can never disagree.

Filter fields and sort columns are allowlisted -- the values bind, the identifiers do
not. Date filters accept the control's own vocabulary (Is / Between / Timespan / <= /
>=), casting to ::date because creation is a timestamp.

Also: a facet endpoint that groups over the same union, because the table's
self-fetching facets read ONE doctype and would have offered no Source values at all."

## 6 — the queue screens

    git add frontend/src/pages/ProjectPayments/config/ \
            frontend/src/pages/ProjectPayments/hooks/ \
            frontend/src/pages/ProjectPayments/bulkSelectionSummary.ts \
            frontend/src/pages/ProjectPayments/bulkSelectionSummary.test.ts \
            frontend/src/pages/ProjectPayments/AllPayments.tsx \
            frontend/src/pages/ProjectPayments/RenderProjectPaymentsComponent.tsx \
            frontend/src/pages/ProjectPayments/approve-payments/

    git commit -m "feat(approvals): put all three ledgers on the payments queue screens

Replaces ~675 lines of inline column definitions across three screens with ONE registry
keyed by column id plus a per-tab id array. The array IS the order, which is what puts
Actions in position 2; adding a tab is one entry, not another 300-line block.

The rows now come from the union endpoint. The bulk engine and its dialogs only widened
their types: the normalized row carries document_name / document_type / tds under their
payment names, so it is a superset of what those already read.

Approve and reject now route off row.doctype. They previously wrote \"Project Payments\"
with a flat CEO Pending status and a payment_details field, so approving an expense tried
to update a payment of the same name and failed.

Tab badges count all three ledgers. Each screen also listens for realtime events on both
expense doctypes -- the table only self-refreshes for its nominal doctype, so an expense
change never reached it.

Parity kept deliberately: the unseen-payment dot, resolved requester names, the CEO tab's
Project Value / Cashflow Gap, the admin Edit on settled rows, and the bank-details
selection gate (scoped to payment rows, so expense rows stay actionable)."

## 7 — the summary card

    git add nirmaan_stack/api/payments/get_project_payment_summary.py \
            frontend/src/pages/ProjectPayments/PaymentSummaryCards.tsx

    git commit -m "feat(payments): count all three ledgers in the Payment Summary card

The Pending and Approved & Paid blocks read Project Payments alone, so the card said
'Approved But not Paid 3 / Rs 13,848' while the tab beside it listed 16 rows worth
Rs 94,408. Only the SOURCE widened -- not a single rule.

The 30-day outflow accumulator keeps a payments-only guard: Project Expenses are added
to it further down and Non-Project after that, so without the guard the widened loop
would count every expense twice.

Adds total_reconciliation_pending_* for the new worklist line."

## 8 — the ₹15,000 cap

    git add frontend/src/pages/ProjectExpenses/components/NewProjectExpenseDialog.tsx \
            frontend/src/pages/ProjectExpenses/components/EditProjectExpenseDialog.tsx \
            frontend/src/pages/NonProjectExpenses/components/NewNonProjectExpense.tsx

    git commit -m "feat(expenses): remove the Rs 15,000 creation cap

The form cap and the auto-approve line were the same number, so every non-Accommodation
project expense that could be created was auto-approved on save -- the screen could
almost never produce an approval request, which is the thing it exists to do.

The tier rule now decides routing; the form no longer refuses the amount."

## 9 — the entry point

    git add frontend/src/components/helpers/renderRightActionButton.tsx \
            frontend/src/components/layout/NewSidebar.tsx

    git commit -m "feat(expenses): add the Expense Request entry point, hide the Expense nav

A dropdown in the /project-payments top bar raising either kind of expense, so a
payment-facing user has one place to work. Gated to procurement + accountant + admin --
narrower than the page's audience, because Project Lead has no Expense nav entry today
and including them would be a capability grant rather than a shortcut.

The Expense sidebar item is COMMENTED OUT, not deleted: both routes still resolve, so
links and bookmarks keep working, and restoring it is un-commenting one block. Its label
must go back into the flat-nav Set at the same time -- that Set is matched by label, and
an entry missing from it renders as a collapsible group that swallows the click.

Note: Nirmaan HR Executive Profile had the Expense entry but is not in the
/project-payments gate, so HR now has no nav route to expenses. The URL still works."

## 10 — unrelated, keep it separate

    git add frontend/src/hooks/usePOValidation.ts \
            frontend/src/pages/ProcurementOrders/purchase-order/components/POPaymentTermsCard.tsx

    git commit -m "feat(po): block a payment request when the vendor has no bank details

A payment request ends as a row in the ICICI / Cashfree file, keyed on account_number +
ifsc. Letting one in for a vendor with neither defers the failure to the accountant.

Deliberately NOT folded into usePOValidation's errors/isValid: those gate dispatch and
the GST editor on four other screens, and a vendor with no bank row is still a
dispatchable PO. It gates exactly one action."

## 11 — docs

    git add .claude/plans/

    git commit -m "docs(plans): record the unified-approvals and expense-request plans"
