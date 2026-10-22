# Reimbursements

A **Reimbursement** is a Nirmaan user's claim to be repaid money they spent for work. It is money of its own,
never an Expense: it counts in no financial figure and the bank-statement import does not match it. Decision
record: `docs/adr/0039-reimbursement-is-money-outside-the-ledgers.md`. Glossary: root `GLOSSARY.md`
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
- **Tabs, in order** (owner, 2026-10-22; `utils/reimbursements/rules.tabsFor`): Pending Approval (HR, Admin) · Payment need to be paid = the Approved claims (HR, Admin, Accounts) · All (HR, Admin, Accounts) · Reimbursement Raised By Me (everyone) · Rejected (HR, Admin, Accounts). Each person opens on their first tab. Display only: the server scopes every read.
- **Pending Approval lists every pending claim to HR and Admin** (owner, 2026-10-22), each with the server's `can_decide` / `cannot_decide_reason` (`review.get_pending_for_me`). HR's Approve / Reject are disabled, with the reason on hover, on claims above ₹2,000 and on HR-raised ones; the tab badge counts only the claims this person may decide. The endpoints still refuse what the rule refuses.
- **No Paid status.** Approved is where a claim ends for now; the "Payment need to be paid" tab (the Approved claims; renamed by the owner 2026-10-22, the status itself is still Approved) has an Export (ticked rows only, every
  column) changes nothing, so a claim can be exported twice. Accepted by the owner; see ADR-0039 Consequences.
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
  (owner, 2026-10-22: one account, no child table); Payee has no user field (ADR-0033 Amendment A). It is set only
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
- **Deleting a person is never blocked** (owner, 2026-10-22). Their `payee` field goes with them (the Payee stays, linked to nobody); their claims stay, carrying `claimant_name`, `claimant_role` and the `pay_to_*` copy, so an Approved claim is still exported and paid, and HR or Admin decide a pending one.
- **Notifications go to the claimant only**, on Approved and on Rejected (bell + realtime, no push), after the
  decision is committed; a failure never undoes the decision (`integrations/controllers/reimbursement_notify.py`).

## Key files

| Area | Files |
|---|---|
| Doctypes | `Reimbursement`; the field `Nirmaan Users.payee` (Link → Payee) |
| Endpoints | `api/reimbursements/claims.py` (raise, update, delete, get_claim_files), `review.py` (approve, reject, get_pending_for_me), `bank_accounts.py` (my_bank_account, add_my_bank_account, edit_my_bank_account, bank_account_of -- the profile's Payee tab: the person, Admin, HR, Accounts) |
| Rules | `services/reimbursements/` (`rules`, `access`, `receipts`), `services/payees/own_accounts.py` |
| Hooks | `integrations/controllers/reimbursement.py`, `reimbursement_notify.py`, `nirmaan_users.py` (`validate`) |
| Screen | `frontend/src/pages/Reimbursements/`, `utils/reimbursements/rules.ts`, sidebar entry + "Raise Reimbursement" header button; the read-only **Payees** tab on a user's profile (`pages/users/components/UserPayeesTab.tsx`) |
| Tests | `services/reimbursements/test_rules.py`, `api/reimbursements/test_reimbursements.py`, `frontend/src/utils/reimbursements/rules.test.ts` |
