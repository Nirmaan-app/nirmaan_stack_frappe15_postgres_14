# Reimbursements

A **Reimbursement** is a Nirmaan user's claim to be repaid money they spent for work. Approving it creates the
Non-Project Expense that pays it; Accounts pays that expense from Project Payments & Expenses and the claim follows
its endings. Decision record: `docs/adr/0040-an-approved-reimbursement-becomes-a-non-project-expense.md`
(supersedes ADR-0041). Glossary: root `GLOSSARY.md`
§ Reimbursements (*Reimbursement*, *Claimant*, *HR approval limit*) and § Payees (*Own bank account*).

## Load-bearing invariants

- **The rules have one home each.**
  - `services/reimbursements/rules.py` (pure): `decide_problem`, `reviewer_for`, `edit_problem`, `delete_problem`,
    `claim_problem`, `rejection_problem`, `HR_APPROVAL_LIMIT` (₹2,000, inclusive), `STATUSES`. Its screen twin is
    `frontend/src/utils/reimbursements/rules.ts`; both read `reimbursement_rules_cases.json` (F1), so a change to
    either fails the other's test until both agree.
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
- **Who decides.** HR (Executive or Lead) decides a claim of ₹2,000 or less raised outside HR; Admin decides the
  rest, every HR-raised claim included, and may decide their own. Approval is the full amount. Saved: `approved_by`
  on approve, `rejection_reason` on reject. There is no reviewed-by / reviewed-on field (owner, 2026-10-22).
- **Tabs, in order** (owner, 2026-10-22/23; `utils/reimbursements/rules.tabsFor`): Pending Approval (HR, Admin) · Payment need to be paid = the Approved claims (HR, Admin, Accounts) · Paid (HR, Admin, Accounts) · All (HR, Admin, Accounts) · Reimbursement Raised By Me (everyone) · Rejected (HR, Admin, Accounts). Each person opens on their first tab. Display only: the server scopes every read.
- **Pending Approval lists every pending claim to HR and Admin** (owner, 2026-10-22), each with the server's `can_decide` / `cannot_decide_reason` (`review.get_pending_for_me`). HR's Approve / Reject are disabled, with the reason on hover, on claims above ₹2,000 and on HR-raised ones; the tab badge counts only the claims this person may decide. The endpoints still refuse what the rule refuses.
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
  review finding 6: no second copy of the rule in `convert.py`). HR's claims are auto-approved; an Admin's
  approval clears L1 (≤ ₹50,000 Approved, above CEO Pending); the CEO's clears both. `expense_raiser` (who
  raised it, for the approval detail) still answers the claimant, the row's owner.
- **The claim follows only its expense's endings** (`services/reimbursements/expense_link.claim_status_for`, the
  pure rule, run by the expense `on_update` hook `integrations/controllers/reimbursement_expense`): Approved
  while the expense is Requested / CEO Pending / Approved / Reconciliation Pending; Paid → claim `Paid` (nothing
  else sets it); Rejected → claim Rejected with the queue's reason (`expense_decision.decide` puts it on
  `doc.flags[REJECTION_REASON_FLAG]`. Every Reject in Approve Payments, single-row or bulk, goes through develop's one decision call `expense_actions.decide_expenses` with a required reason (`ApprovePayments.handlePaymentUpdate`, `PaymentActionDialog.rejectsExpense`), never a bare status PATCH. Only a rejection that skips `decide` gets `FALLBACK_REASON`); Paid → back (an undone match) → claim
  Approved. The claim is written with `doc.save`, in the expense's transaction.
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
- **Deleting** (owner, 2026-10-27): the claimant deletes their claim while it is Pending Approval or Rejected
  (`rules.delete_problem`, twin `rules.ts`, shared cases JSON). A pending claim, or one HR or Admin rejected, has no
  expense; a claim rejected in Payments takes its Rejected expense with it (`expense_link.delete_rejected_expense`),
  and one whose expense is not Rejected (an older row, a raw write) is refused, telling the claimant Accounts can
  delete that expense. Deleting the expense in ANY status deletes the claim (`expense_link.delete_with_expense`:
  clears its notifications, deletes it, deletes its receipts after the commit through `frappe.db.after_commit`);
  Frappe's delete permission and the bank-link guard still decide whether it may go, and every delete screen says
  the claim goes too (the Non-Project Expenses page naming it, Project Payments' accountant tabs, All Payments).
  **One lock order, expense then claim** (code review 2026-10-27, finding 2): the claimant's delete locks the
  expense (`expense_link.lock_expense_of`) before the claim, as a decision and a delete from Payments do, so the
  paths can wait on each other but never deadlock. A flag stops the expense's hooks deleting the claim back.
- **The "Reimbursements" Expense Type is to be deleted** (owner, 2026-10-23); until then it keeps its HR / PM roles
  (an Expense Request route that skips the HR ₹2,000 rule). Nothing here uses it.
- **"Payment need to be paid" has no Export** (owner, 2026-10-23; `ClaimsTable` `showExportButton={!approved}`):
  its file was a ready list of approved claims' bank accounts to pay from outside Project Payments. Every other
  tab keeps its Export.
- **No tick-and-Export, no Payment column in the tables, and no bell when the claim follows its expense** (owner,
  2026-10-23; a Paid / Payments-rejection bell was added and removed the same day). Only the HR / Admin Approved
  and Rejected bells exist. The claim's payment (expense, stage,
  UTR) is read through `claims.get_claim_payments`, scoped to the claims the caller may read, so a claimant
  never depends on reading Non-Project Expenses. That read is the ledger's own DocPerm, not this feature's: on
  localhost (2026-10-27) a Project Manager reads every Non-Project Expense and the whole Approve Payments queue.
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
  by `own_accounts.add_own_account`, which refuses a second account; the Nirmaan Users `validate` hook
  (`check_own_account`) refuses every other change and a Payee that is already another person's.
- **The person corrects their own account** from their profile's Payee tab (`own_accounts.edit_own_account`, the Payee module's `edit_payee_reply` underneath). Refused for someone else's account and for one a Vendor is also paid into (`links.linked_vendors`). Claims keep their copy.
- **Receipts are merged before anything is written.** The dialog uploads every file loose (no doctype: claimants
  hold read only). `receipts.plan_receipts` reads them and merges the PDFs and pictures into one PDF IN MEMORY
  first; only then is the claim saved and `apply_receipts` stores the PDF (`save_file` commits inside the storage
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
| Endpoints | `api/reimbursements/claims.py` (raise, update, delete, get_claim_files, get_claim_payments), `review.py` (approve, reject, get_pending_for_me), `bank_accounts.py` (my_bank_account, add_my_bank_account, edit_my_bank_account, bank_account_of -- the profile's Payee tab: the person, Admin, HR, Accounts) |
| Rules | `services/reimbursements/` (`rules`, `access`, `receipts`, `convert`, `expense_link`), `services/payees/own_accounts.py` |
| Hooks | `integrations/controllers/reimbursement.py`, `reimbursement_notify.py`, `nirmaan_users.py` (`validate`), `reimbursement_expense.py` (on `Non Project Expenses`) |
| Screen | `frontend/src/pages/Reimbursements/`, `utils/reimbursements/rules.ts`, sidebar entry + "Raise Reimbursement" header button; the read-only **Payees** tab on a user's profile (`pages/users/components/UserPayeesTab.tsx`) |
| Tests | `services/reimbursements/test_rules.py`, `api/reimbursements/test_reimbursements.py`, `api/reimbursements/test_reimbursement_e2e.py` (raise → decide → Payments' `decide_expenses` → the claim follows; the bulk approve / reject / Mark as Paid bars with reimbursements among ordinary expenses), `frontend/src/utils/reimbursements/rules.test.ts` |
