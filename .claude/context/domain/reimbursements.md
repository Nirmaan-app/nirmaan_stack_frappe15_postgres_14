# Reimbursements

A **Reimbursement** is a Nirmaan user's claim to be repaid money they spent for work. Approving it creates the
Non-Project Expense that pays it; every later step (L1, CEO, Export for Payment, Mark as Paid, Mark Reconciled)
happens on the Reimbursements page, on that expense, and the claim follows its endings. Reimbursement expenses do
not appear in Project Payments & Expenses. Decision record:
`docs/adr/0040-an-approved-reimbursement-becomes-a-non-project-expense.md` (supersedes ADR-0041; Amendment C,
2026-11-18, moved every step onto the Reimbursements page). Glossary: root `GLOSSARY.md`
§ Reimbursements (*Reimbursement*, *Claimant*, *Month total*, *Monthly reimbursement limit*) and § Payees (*Own bank account*).

## Load-bearing invariants

- **The rules have one home each.**
  - `services/reimbursements/rules.py` (pure): `decide_problem`, `reviewer_for`, `edit_problem`, `delete_problem`,
    `claim_problem`, `rejection_problem`, `MONTHLY_LIMIT` (₹2,000; a total of exactly ₹2,000 has reached it), `over_monthly_limit` (`>=`),
    `approval_needs_l1`, `acknowledgement_problem`, `STATUSES`. Its screen twin is
    `frontend/src/utils/reimbursements/rules.ts`; both read `reimbursement_rules_cases.json` (F1), so a change to
    either fails the other's test until both agree.
  - `services/reimbursements/month_total.py`: the **month total**, the one query that adds it up (read by the
    approve endpoint and `api/reimbursements/month_totals.get_month_totals`). The screen's warning text is
    `frontend/src/utils/reimbursements/monthLimit.ts`.
  - `services/reimbursements/access.py`: the same rules answered for a logged-in user by role PROFILE
    (`REIMBURSEMENT_HR_PROFILES`, `REIMBURSEMENT_VIEW_ALL_PROFILES` in `services/role_profiles.py`).
  - `services/payees/own_accounts.py`: a person's own bank account. It is a Payee rule, so it lives in the Payee
    module (`payees.md` "One owner").
- **Every claim has a type: Travel, Food or Others** (owner, 2026-10-22). `reimbursement_type`, a required Select;
  `TYPES` in `rules.py` / `rules.ts`, pinned to the doctype options by test and shared through the JSON cases.
  `claim_problem` refuses a missing or unknown type on raise and on edit. No default: the claimant picks it.
- **A claim above ₹2,000 needs a description** (owner, 2026-10-22): `DESCRIPTION_REQUIRED_ABOVE` /
  `description_required` in `rules.py` and its twin in `rules.ts`, shared cases in the JSON. Exactly ₹2,000 does
  not. `claim_problem` refuses it on raise and on edit.
- **Who decides** (owner, 2026-10-28, ADR-0040 Amendment B). HR (Executive or Lead) decides a claim of any amount
  raised outside HR; Admin decides every claim, every HR-raised claim included, and may decide their own. Approval
  is the full amount. Saved: `approved_by` on approve, `rejection_reason` on reject. There is no reviewed-by /
  reviewed-on field (owner, 2026-10-22).
- **The monthly reimbursement limit decides how far an approval goes** (owner, 2026-10-28, ADR-0040 Amendment B).
  The **month total** is the claim in hand plus the claimant's other approved (any of `rules.APPROVED_STEPS`) and Paid claims raised in the same
  calendar month (`month_total.month_totals`; pending and rejected ones don't count; the month is the claim's
  `creation` month). It is worked out on every read and never stored. Under ₹2,000 (₹1,999 or less), HR's approval
  auto-approves the expense. From ₹2,000 up, HR's approval sends the expense to L1 (`rules.approval_needs_l1`), even
  under ₹15,000. An Admin's approval counts as L1 whatever the total.
- **Every approver is warned at or above the limit, never blocked.** Approving ONE claim, on any of the three
  approval tabs, shows the month total; at or above the limit Approve needs a tick
  (`components/reimbursements/MonthLimitNotice`). `review.approve_reimbursement` refuses an at-or-above-limit approval
  sent without `acknowledged` (`rules.acknowledgement_problem`), working the total out again inside the claim's
  lock; on that refusal the dialog reads the total again, so the box to tick appears in place (`useMonthTotals().refresh`).
  Bulk approve lists the claims at or above the limit per person, with no tick (`BulkMonthLimitBox`; ADR-0040
  Amendment C point 5). The expense decision call (`decide_expenses`, used for L1 and CEO) takes no
  acknowledgement: there the tick is the screen's.
- **The approve dialog says where the claim goes** (owner, 2026-10-28; tabs per Amendment C): which Reimbursements
  tab it moves to (Pending L1 Approval, Pending CEO Approval or Payment need to be paid), worked out on the screen by
  `utils/reimbursements/monthLimit.approvalLanding` from the approver's level and the month total. It mirrors
  `expense_decision.starting_status`; the server decides.
- **A user's profile has a Reimbursements tab, for Admin only** (owner, 2026-10-28; `Administrator` and the Admin
  profile, the CEO included: `utils/reimbursements/profileMonth.seesProfileReimbursements`). It lists that person's
  claims for one month (the month a claim was raised in, as the limit counts it; default this month, the 11 before it,
  or All months; `?reimb_month=YYYY-MM`) with a summary above the table: the month total = approved (every approved step) + Paid with a
  "Limit reached" / "Under the ₹2,000 limit" chip, then Approved, Paid, Pending ("not counted yet") and Rejected
  ("never counted"). The totals are the data
  table's group-by (`status`, SUM `amount`) over every matching claim, never the page shown. Read only: the "Raised By
  Me" columns without Edit / Delete, and the detail sheet with no actions (`pages/users/components/UserReimbursementsTab`).
  Frontend only: no endpoint of its own.
- **The claims table reads its rows again on window focus** (`ClaimsTable`), as the tab counts do. Its rows live in
  local state and otherwise move only on the live list event, which a dev page signed in at `/login` never gets.
- **Tabs, in order** (owner, 2026-11-18, ADR-0040 Amendment C; sets per role 2026-11-19, Amendment E;
  `utils/reimbursements/rules.tabsFor`): Pending Approval (claim Pending Approval) · Pending L1 Approval (Requested) ·
  Pending CEO Approval (CEO Pending; **the CEO only**) · Payment need to be paid (Approved) · Reconciliation Pending ·
  Reconciliation Done / Paid (Paid; id `paid`) · Reimbursement Raised By Me · All (Rejected included; no Rejected tab).
  Each step tab lists one claim status (`rules.TAB_OF_STATUS`). Admin: every tab but the CEO's; CEO: all eight; HR:
  Pending Approval, Reconciliation Done / Paid, All, Raised By Me; Accounts: Payment need to be paid, Reconciliation
  Pending, Reconciliation Done / Paid, All, Raised By Me; everyone else: Raised By Me. Default tab (`rules.defaultTab`):
  CEO → Pending CEO Approval, Admin → Pending L1 Approval, HR → Pending Approval, Accounts → Payment need to be paid,
  others → Raised By Me; a `?tab=` the person doesn't have falls back to it. Display only: the server scopes every
  read, and answers the CEO tab for the CEO alone.
- **The claim carries its Non-Project Expense's status, by the same name** (owner, 2026-11-19, ADR-0040 Amendment E,
  replacing 2026-11-18's "use the old statuses only"): Pending Approval (before the expense exists) · Requested ·
  CEO Pending · Approved (waiting to be paid) · Reconciliation Pending · Paid · Rejected (`rules.STATUSES`,
  `CLAIM_STATUS_OF_EXPENSE`). "Approved somewhere and not yet paid" is `rules.APPROVED_STEPS` (Requested, CEO
  Pending, Approved, Reconciliation Pending): the month total, the Project Manager cap and the profile summary count
  it where they used to read Approved. Claims approved before the change were moved once by
  `patches/v3_0/reimbursement_status_from_expense` (raw SQL, `modified` left as it was).
- **Every tab has the month bar** (owner, 2026-11-19; `utils/reimbursements/claimMonth`, `queue.get_claims(month)`,
  `queue.get_claim_month_summary`): a month picker with month tiles, This month (Nov) / Last month (Oct) / All, and
  Reset (red while a month is picked). The month is the raised month, except Reconciliation Done / Paid (the
  expense's paid-on month). Payment need to be paid opens on this month, every other tab on all months
  (`defaultMonth`); the month stays in the address. Raised By Me has it for everyone, over their own claims. The
  totals under it cover every row the filters match: the total, Claims, then every status (All, Raised By Me, with a
  share bar) or Travel / Food / Others.
- **Narrow screens drop nothing** (owner, 2026-11-19; `ReimbursementTabBar` measures its own width): the full tab row
  when it fits, else one row that scrolls sideways (group names inline), else -- a phone-narrow bar -- one button
  with the open tab and its count that opens every tab, grouped, with its count. The month card stacks its figures;
  the table keeps every column and scrolls inside its box.
- **Who acts on which tab**: Approve / Reject on Pending Approval = HR, Admin, CEO (`decide_problem`); on Pending
  L1 Approval = Admin, CEO; on Pending CEO Approval = the CEO. Export for Payment and Mark as Paid on Payment need to
  be paid, and Mark Reconciled on Reconciliation Pending = Accounts and Admin. Everyone else who sees a tab only views
  it. L1, CEO, Mark as Paid (`mark_done`: Approved → Reconciliation Pending) and Mark Reconciled (`mark_paid`) are
  the expense's own decisions through `api/approvals/expense_actions.decide_expenses`, with its rules and reasons.
- **Every approval tab decides in bulk** (owner, 2026-11-18): tick up to 100 claims, Approve selected / Reject
  selected. A claim the person may not decide (an HR-raised one for HR; on Pending Approval an Admin may still decide
  their own, as the single call allows) can't be ticked. The bulk confirm
  shows the total, the people at or above the monthly limit (no tick) and the claims grouped by the tab they move to;
  a bulk reject takes one reason for all. One claim failing never stops the rest. On Pending Approval this is
  `review.bulk_approve_reimbursements` / `bulk_reject_reimbursements`: the single call's steps per claim, each in a
  savepoint, decided in name order (so a person's second claim counts the first one), `acknowledged` sent once the
  bulk confirm is accepted; each reply row carries the `tab` the claim landed in. The later tabs send
  `decide_expenses` the claims' expenses.
- **Pending Approval lists every pending claim to HR, Admin and the CEO** (owner, 2026-10-22; CEO 2026-11-18), each with the server's `can_decide` / `cannot_decide_reason` (`review.get_pending_for_me`). Approve / Reject are disabled, with the reason on hover, on a claim the person may not decide. Every tab badge is the number of rows the tab shows (owner, 2026-11-18, replacing "only the claims this person may decide"). The endpoints still refuse what the rule refuses.
- **Approval creates the claim's Non-Project Expense, in the same transaction** (ADR-0040,
  `services/reimbursements/convert.create_expense`, called by `review.approve_reimbursement` before its commit):
  a claim is never Approved without one. **No Expense Type** (owner, 2026-10-23: the claim link marks it, and the
  "Reimbursements" type is to be deleted -- never make the expense depend on a type again); `reimbursement` = the claim's ID (the expense's only link back; `request_id`
  names only an Expense Request); `amount`, `pay_to_*` and `invoice_attachment` (a LINK to the claim's private
  receipts PDF; `convert.receipts_link` leaves it blank for a local-disk `/files` / `/private/files` path, which
  Frappe's `attach_files_to_document` would turn into a File on the expense -- code review finding 7) copied; `description` = `convert.describe`; `comment` = the approver; `invoice_ref` /
  `invoice_date` = the claim's ID / raised date (the claim is the invoice); `owner` = the claimant
  (an owner-only `set_value` after insert, since Frappe stamps the session user).
- **The expense's starting status is the expense rule with the APPROVER as raiser, in ONE place**: the expense is
  born Requested and `expense_decision.apply_starting_status` (both ledgers' `validate`) routes it like any other, reading its raiser through
  `approval_raiser.routing_raiser`, which returns the claim's `approved_by` when `reimbursement` is set (code
  review finding 6: no second copy of the rule in `convert.py`). HR's claims under the monthly limit are
  auto-approved; an HR approval at or above it is born Requested even under ₹15,000 (`starting_status(skip_auto=True)`,
  asked for by the server-side flag `approval_raiser.REIMBURSEMENT_NEEDS_L1_FLAG` that `convert.create_expense`
  puts on the insert, read through `approval_raiser.routing_skips_auto`); an Admin's approval clears L1
  (≤ ₹50,000 Approved, above CEO Pending); the CEO's clears both. `expense_raiser` (who
  raised it, for the approval detail) still answers the claimant, the row's owner.
- **The claim follows every change of its expense's status** (owner, 2026-11-19, Amendment E;
  `services/reimbursements/expense_link.claim_status_for`, the pure rule, run by the expense `on_update` hook
  `integrations/controllers/reimbursement_expense`): L1 / CEO approval, Mark as Paid, a reconcile, a reject and an
  undone bank match (Paid → Reconciliation Pending) are copied onto the claim wherever they are made -- this page,
  Project Payments or the bank import. The hook runs on the expense's insert too, which is how an approval that leaves
  the expense at Requested or CEO Pending puts the claim there (`review._approve` saves the claim Approved first: the
  routing reads its approver). A Pending Approval claim (no expense yet) and a Rejected one (final) never move. A
  reject carries the queue's reason (`expense_decision.decide` puts it on `doc.flags[REJECTION_REASON_FLAG]`; every
  Reject goes through `expense_actions.decide_expenses` with a required reason; only a rejection that skips `decide`
  gets `FALLBACK_REASON`). The claim is written with `doc.save`, in the expense's transaction, through
  `expense_link.lock_claim`.
- **The `reimbursement` link can't be forged** (code review 2026-10-23): it is set only on the insert
  `convert.create_expense` makes (server-side flag `convert.APPROVAL_FLAG`), never changed or removed afterwards,
  and a claim has one expense (`expense_link.guard_link` / pure `link_problem`, in the expense `validate`).
  `routing_raiser` uses the claim's approver only on that flagged insert (the flag's one constant is
  `approval_raiser.REIMBURSEMENT_APPROVAL_FLAG`). A typed-in link (REST, import) is refused; the field is
  `no_copy`, so Desk's Duplicate drops it (the copy is an ordinary expense). Nobody can skip approval or delete /
  pay someone else's claim through it.
- **The claimant can't delete their own claim's expense directly, in any status** (`expense_link.refuse_claimant_delete`,
  the expense `on_trash`, first; owner, 2026-10-27): a Rejected one goes only by deleting the claim from
  Reimbursements. Many roles (Project Managers included) hold delete on Non-Project Expenses, so this is what stops
  a claimant deleting an Approved or Paid claim through its expense. Anyone else deleting it still deletes the claim.
- **The expense edit dialog needs no type for these** (`EditNonProjectExpense`): it shows "Reimbursement · <claim>"
  where the type picker is, and keeps the type empty.
- **Edits to the expense never touch the claim** (owner, 2026-10-23): amount, account (Change account), anything.
  It is NOT guarded beyond the doctype's own permissions (owner, 2026-10-23, code review finding 4 accepted): any
  role with Non Project Expenses write can edit or delete it, the claimant included (they are its `owner`, which
  grants nothing by itself). Audit is by the `reimbursement` link back to the claim. Don't add an edit guard
  without the owner.
- **A reimbursement's Rejected expense is final** (owner, 2026-10-23; code review finding 3): its `validate`
  (`expense_link.refuse_revival`, pure rule `revival_problem`) refuses any other status. Delete it (deleting the
  claim) and re-raise. So a claim never sits Rejected while its expense is paid.
- **Bulk Import Transactions treats it as any Non-Project Expense.** It is never auto-suggested (expense matching is
  tier 2 only, gated on a project the remark names; `matcher.match_expenses`), so a line is linked by hand from
  Reconciliation Pending (`link_lines.get_linkable_expenses` lists it, with a blank type). The settle and
  `unreconcile._revert_expense` both `doc.save` inside `outflow_import_write`, so the claim follows in the same
  savepoint. Pinned by `test_reimbursements.test_the_bank_import_links_settles_and_undoes_it_like_any_expense`.
- **Deleting** (owner, 2026-10-27): the claimant deletes their claim while it is Pending Approval or Rejected;
  an Admin (the CEO included) deletes anyone's claim once it is Rejected, through the same call, from All or the
  claim view (owner, 2026-11-19) (`rules.delete_problem`, twin `rules.ts`, shared cases JSON). A pending claim, or one HR or Admin rejected, has no
  expense; a claim rejected after its first approval (L1 or CEO) takes its Rejected expense with it (`expense_link.delete_rejected_expense`),
  and one whose expense is not Rejected (an older row, a raw write) is refused, telling the claimant Accounts can
  delete that expense. Deleting the expense in ANY status deletes the claim (`expense_link.delete_with_expense`:
  clears its notifications, deletes it, deletes its receipts after the commit through `frappe.db.after_commit`);
  Frappe's delete permission and the bank-link guard still decide whether it may go, and every delete screen says
  the claim goes too (the Non-Project Expenses page naming it; Project Payments no longer lists these expenses,
  ADR-0040 Amendment C).
  **One lock order, expense then claim** (code review 2026-10-27, finding 2): the claimant's delete locks the
  expense (`expense_link.lock_expense_of`) before the claim, as a decision and a delete from Payments do, so the
  paths can wait on each other but never deadlock. A flag stops the expense's hooks deleting the claim back.
- **The "Reimbursements" Expense Type is to be deleted** (owner, 2026-10-23); until then it keeps its HR / PM roles
  (an Expense Request route that skips the monthly reimbursement limit). Nothing here uses it.
- **"Payment need to be paid" has Project Payments' Export for Payment** (owner, 2026-11-18, ADR-0040 Amendment C,
  reversing the 2026-10-23 "no Export"): Accounts and Admin tick claims, see the selected count and total, and
  download the same bank upload file as Payments (`ProjectPayments/bankUploadFile`); the plain Export (table CSV)
  stays on every tab. It was removed because a second place to pay a claim is how it gets paid twice; with
  reimbursement expenses gone from Payments this is again the only place.
- **The tables show the expense; still no bell when the claim follows its expense** (owner, 2026-11-18, reversing
  the 2026-10-23 "no Payment column"; the bell rule of 2026-10-23 stands, so only the HR / Admin Approved and
  Rejected bells exist). Every tab after approval has a Non-Project Expense column (its ID and its own status), and
  the claim's view shows the full expense: created on, status, amount, description, invoice ref / date, pay-to
  account, receipts, paid on, UTR, payment source, and who approved, paid and reconciled it. All of it is read
  through `api/reimbursements`, scoped to the claims the caller may read, so a claimant never depends on reading
  Non-Project Expenses. That read is the ledger's own DocPerm, not this feature's: on localhost (2026-10-27) a
  Project Manager reads every Non-Project Expense.
- **Reimbursement expenses are not in Project Payments & Expenses** (owner, 2026-11-18, ADR-0040 Amendment C).
  The Non-Project branch of `get_approval_queue` skips every row whose `reimbursement` is set, so every tab, count,
  facet, export and Payment Raised By Me leaves them out, and the queue's `Reimbursement` type value and its filter
  option go. Everything else in Payments is unchanged. Bulk Import Transactions still links bank lines to them.
  Before this, the queue showed them as a Non-Project pill with a Reimbursement tag (owner, 2026-10-27). Payments'
  own reimbursement code (the month-limit box in its approve dialogs, `ReimbursementTag`) stays but never sees such a
  row now. The Payments summary cards still COUNT them in non-project outflow, and the Action Center's pending item
  for one opens Reimbursements → Payment need to be paid searched to the claim (`finance.reimbursement_pay_link`;
  both the recommended answers, built 2026-11-19, to be confirmed).
- **A Project Manager may claim at most ₹2,000 a month** (owner, 2026-11-18, ADR-0040 Amendment D): a BLOCK at raise
  and edit, unlike the approver's monthly limit. The month counts the person's Pending Approval, approved (any step) and Paid
  claims raised that calendar month (`month_total.month_used`; rejected and deleted claims free their amount; an edit
  replaces its own old amount). Exactly ₹2,000 is allowed. Only the Project Manager profile (`access.is_capped`).
  The server checks inside a lock on the person's Nirmaan Users row (`claims._check_cap`: a no-op UPDATE, because a
  request's first transaction is REPEATABLE READ); the dialog reads `claims.get_my_month` (own claims only), shows
  what is left and keeps Submit off. The rule is `rules.cap_problem` / `capProblem`, cases `pm_cap`. The test suite
  turns the cap off for its Project Manager fixtures (they raise large claims on purpose); `TestProjectManagerCap`
  turns it on.
- **Every read is scoped on the server.** Every Nirmaan role holds READ on the doctype; `integrations/controllers/
  reimbursement.py` narrows it (`has_permission` + `permission_query_conditions`): Admin / HR / Accounts see every
  claim, everyone else only their own (`owner`). The page's tabs are display only.
- **Every write goes through `api/reimbursements`.** The same hook refuses any non-read ptype to everyone but
  `Administrator`, because System Manager rides on several profiles with full rights on the doctype. The endpoints
  write with `ignore_permissions` after their own checks, lock the claim (`for_update`) and re-read its status
  inside the lock, so two people can't decide one claim and an edit can't slip past a decision.
- **The claimant is saved on the claim.** `claimant_name` + `claimant_role` (role profile) are filled once, on insert, by the doctype's `validate` (`Reimbursement.save_claimant`), from the owner's Nirmaan Users row. The HR rule reads the saved role (`access.claimant_is_hr`, and `get_pending_for_me`), so moving role or deleting the person never moves a claim to another approver; a claim saved before the fields existed falls back to the person's role now. Screens show the saved name (`claimantName` in `utils/reimbursements/rules.ts`).
- **The bank account is copied, never linked.** The claim holds the five `pay_to_*` fields
  (`pay_to.copy_payee_account`) and no link to the Payee (owner, 2026-10-22). A person has one account, so an
  edit re-copies it onto the claim.
- **The own bank account lives on Nirmaan Users, one per person.** `Nirmaan Users.payee` is a Link to one Payee
  (owner, 2026-10-22: one account, no child table); Payee has no user field (ADR-0033 Amendment B). It is set only
  by `own_accounts.add_own_account`, which refuses a second account and an account already on record as a Vendors
  or Others Payee (owner, 2026-10-28: only a Users Payee is ever someone's own); the Nirmaan Users `validate` hook
  (`check_own_account`) refuses every other change and a Payee that is already another person's.
- **The Raise dialog adds it the first time** (`pages/Reimbursements/components/BankAccountSection.tsx`, through
  `add_my_bank_account`). With no account yet the section is titled **Add Your Account** and its button **Add
  Account** (owner, 2026-10-27); once there is one (and while it loads) it is **Who gets paid**, showing it
  read-only. It is a Users Payee, so no Expense Request can be paid into it (`payees.md` § Payee Type).
- **The person corrects their own account** from their profile's Payee tab (`own_accounts.edit_own_account`, the Payee module's `edit_payee_reply` underneath). Refused for someone else's account and for one a Vendor is also paid into (`links.linked_vendors`). Claims keep their copy.
- **Receipts are merged before anything is written.** The dialog uploads every file loose (no doctype: claimants
  hold read only). `receipts.plan_receipts` reads them and merges the PDFs and pictures into one PDF IN MEMORY
  first; only then is the claim saved and `apply_receipts` stores the PDF (`store_file` commits inside the storage
  hook, so nothing after it can be rolled back). Other files are adopted onto the claim as they are. Files a save
  replaces are deleted LAST, after the commit, through `services/stored_files.delete_files`.
- **Deleting a claim detaches its Files first** (`receipts.detach_claim_files`), so Frappe's own delete doesn't
  trash them through the document layer (which deletes bytes another File may share); they go through
  `delete_files` after the commit.
- **Deleting a person is never blocked** (owner, 2026-10-22). Their `payee` field goes with them (the Payee stays, linked to nobody); their claims stay, carrying `claimant_name`, `claimant_role` and the `pay_to_*` copy, so an Approved claim's expense is still paid, and HR or Admin decide a pending one.
- **Notifications go to the claimant only**, on Approved and on Rejected (bell + realtime, no push), after the
  decision is committed; a failure never undoes the decision (`integrations/controllers/reimbursement_notify.py`).

## Key files

| Area | Files |
|---|---|
| Doctypes | `Reimbursement`; the fields `Nirmaan Users.payee` (Link → Payee) and `Non Project Expenses.reimbursement` (Link → Reimbursement) |
| Endpoints | `api/reimbursements/queue.py` (get_claims: one tab's page for the data table; get_claim_tab_counts: every badge; the tab rules are `rules.claim_tab` / `tab_problem` / `count_tabs`), `api/reimbursements/claims.py` (raise, update -- both check the Project Manager cap --, delete, get_my_month, get_claim_files, get_claim_payments -- with the full expense and its payment source), `review.py` (approve, reject -- each reply names the claim's new `tab` --, bulk_approve_reimbursements / bulk_reject_reimbursements -- up to 100, one savepoint per claim, get_pending_for_me), `month_totals.py` (get_month_totals, by claim or by expense: Admin, HR, Accounts), `bank_accounts.py` (my_bank_account, add_my_bank_account, edit_my_bank_account, bank_account_of -- the profile's Payee tab: the person, Admin, HR, Accounts) |
| Rules | `services/reimbursements/` (`rules`, `access`, `month_total`, `receipts`, `convert`, `expense_link`), `services/payees/own_accounts.py`; the auto-band skip in `services/expense_decision.starting_status(skip_auto=)` + `approval_raiser.routing_skips_auto` |
| Hooks | `integrations/controllers/reimbursement.py`, `reimbursement_notify.py`, `nirmaan_users.py` (`validate`), `reimbursement_expense.py` (on `Non Project Expenses`) |
| Screen | `frontend/src/pages/Reimbursements/` (`ClaimsTable` on `queue.get_claims`; `hooks/useClaimDecisions` -- every approve / reject, one row or many; `BulkDecisionDialog`; `PayoutDialogs` -- Export for Payment and Mark as Paid; Mark Reconciled reuses the Non-Project Expense pay dialog), `utils/reimbursements/rules.ts`, `utils/reimbursements/monthLimit.ts` (the warning text, `landingTab` / `approvalLanding`: Goes to), `components/reimbursements/` (`useMonthTotals`, `MonthLimitNotice` -- also in Payments' `PaymentActionDialog` -- and `BulkMonthLimit`, in Payments' `BulkConfirmDialog`), sidebar entry + "Raise Reimbursement" header button; the read-only **Payees** tab on a user's profile (`pages/users/components/UserPayeesTab.tsx`); the Admin-only **Reimbursements** tab there (`UserReimbursementsTab.tsx`, rules in `utils/reimbursements/profileMonth.ts`) |
| Tests | `services/reimbursements/test_rules.py` (incl. the shared `claim_tab` / `tab_problem` cases and `count_tabs`), `api/reimbursements/test_reimbursements.py` (`TestClaimTabs`: each step's tab, the CEO-only tab, scoped lists and counts, the claim view's expense; `TestBulkDecisions`: Approve / Reject selected on Pending Approval; `TestProjectManagerCap`), `api/reimbursements/test_reimbursement_e2e.py` (raise → decide → Payments' `decide_expenses` → the claim follows; the bulk approve / reject / Mark as Paid bars with reimbursements among ordinary expenses), `frontend/src/utils/reimbursements/rules.test.ts`, `frontend/src/utils/reimbursements/monthLimit.test.ts`, `profileMonth.test.ts`; the monthly limit: `test_reimbursements.TestMonthlyLimit` and the e2e `test_the_monthly_limit_is_inclusive_and_above_it_hr_hands_the_claim_to_l1_in_payments`. Browser walks: `docs/browser-walk-reimbursements.md` (Walk 4 = the monthly limit, walked 2026-10-28) |
