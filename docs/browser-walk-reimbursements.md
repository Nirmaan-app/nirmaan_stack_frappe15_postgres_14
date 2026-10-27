# Browser walk — Reimbursements: raise, decide, and the delete rules (ADR-0040 Amendment A)

**Date:** 2026-10-27 · **Branch:** `reimbursement/v2` (rebased on develop `11b880821`, working tree)
**Environment:** localhost:8080 (vite) + backend :8000, a throwaway incognito Chrome (chrome-devtools MCP).
**People:** a Project Manager (claimant), an HR Executive, an Admin (also the system's CEO user). Logins were
handed over for this walk only and are not recorded here.

> Walked as a real user: log in through the form, reach every screen by the sidebar, tabs and buttons, and judge
> each result by what the screen shows (toasts, rows, buttons). No deep links, no scripts in the page, nothing
> created or checked from the backend during the walk. The backend was read only after the walk, to confirm the
> cleanup.

> Receipts upload to the real `nirmaan-attachments` bucket and stay there after a delete
> (`delete_file_from_cloud` is off), so the walk uploads ONE tiny one-page PDF per claim: four files in all.

## The four claims

| Claim | Type · amount | Description | Decided by | Then |
|---|---|---|---|---|
| C1 | Travel · ₹500 | — | HR approves | Admin deletes its Non-Project Expense from **Project Payments** → the claim goes too |
| C2 | Food · ₹600 | — | HR rejects | the PM deletes the Rejected claim (it has no expense) |
| C3 | Others · ₹3,000 | required (> ₹2,000) | HR can't; Admin approves | the PM has no Delete; Admin deletes the expense from **Non-Project Expenses** → the claim goes too |
| C4 | Travel · ₹2,500 | required | Admin rejects while Pending Approval | the PM deletes the Rejected claim |

The Admin is the CEO user, so their approval clears L1 and the CEO step: C3's expense is born **Approved**.

## Test cases

| # | Who | Step | Expected |
|---|---|---|---|
| R1 | PM | Sidebar → Reimbursements | The page opens on "Reimbursement Raised By Me"; no Pending Approval tab |
| R2 | PM | Raise Reimbursement with no receipt | Refused: at least one receipt |
| R3 | PM | Raise with amount 0 | Refused: amount above ₹0 |
| R4 | PM | Raise ₹3,000 with no description | Refused: description needed above ₹2,000 |
| R5 | PM | Raise with no type | Refused: pick the type |
| R6 | PM | Raise C1–C4 (one receipt each) | Each saves: toast "Raised REIMB-… · It's waiting for approval."; the server answers who decides ("HR or Admin" for C1, C2; "Admin" for C3, C4) |
| R7 | PM | Raised By Me | C1–C4 listed, Pending Approval, each with Edit and Delete |
| H1 | HR | Reimbursements → Pending Approval | C1–C4 listed; Approve / Reject live on C1, C2; disabled on C3, C4 with the reason |
| H2 | HR | Approve C1 | Toast; C1 leaves Pending Approval and shows under "Payment need to be paid" |
| H3 | HR | Reject C2 with no reason | Refused: a reason is required |
| H4 | HR | Reject C2 with a reason | Toast; C2 under Rejected with the reason |
| A1 | Admin | Pending Approval | C3, C4 listed, Approve / Reject live |
| A2 | Admin | Approve C3 | Toast; C3 under "Payment need to be paid" |
| A3 | Admin | Reject C4 with a reason | Toast; C4 under Rejected with the reason |
| P1 | PM | Raised By Me | C1, C3 Approved with no Edit / Delete; C2, C4 Rejected with their reasons and a Delete |
| P2 | PM | Delete C2 | The dialog says its rejection reason and receipts go; C2 disappears |
| P3 | PM | Delete C4 | Same; C4 disappears |
| X1 | Admin | Project Payments → C1's expense row | Type "Reimbursement / Non Project Expense", ₹500, paid to the PM's own account |
| X2 | Admin | Delete C1's expense there | The dialog says the reimbursement claim and its receipts are deleted too; the row goes |
| X3 | Admin | C3's expense → Delete (Project Payments; see note) | The dialog names the claim (REIMB-…); the row goes |
| S1 | PM | A stale list (decided elsewhere) → Delete on an Approved claim | The server refuses: "This claim is Approved, so it can't be deleted." |
| X4 | PM | Raised By Me | C1 and C3 are gone too |
| Z1 | each | Sign out | Back at the login screen |

## Results

Claims raised: **C1 = REIMB-26-01321**, **C2 = REIMB-26-01322**, **C3 = REIMB-26-01320**, **C4 = REIMB-26-01323**.

| # | Verdict | What the screen showed |
|---|---|---|
| R1 | **PASS** | Opens on "Reimbursement Raised By Me"; no Pending Approval tab for the PM |
| R2 | **PASS** | "Attach at least one receipt." — nothing saved |
| R3 | **PASS** | "Enter an amount above ₹0." |
| R4 | **PASS** | "Add a description. It's needed for a claim above ₹2,000." (seen twice: also when the field re-rendered as required and dropped a typed value) |
| R5 | **PASS** | "Pick the type of claim: Travel, Food or Others." |
| R6 | **PASS** | "Raised REIMB-26-0132x · It's waiting for approval." each time; server reply `reviewer: "HR or Admin"` for C1 |
| R7 | **PASS** | C1–C4 Pending Approval, each with Edit and Delete |
| H1 | **PASS** | Tabs: Pending Approval 4 · Payment need to be paid · Paid · All · Raised By Me · Rejected. Approve / Reject live on C1, C2; disabled on C3, C4 with "A claim above ₹2,000 is approved by Admin." Claimant name and role shown |
| H2 | **PASS** | Dialog "Approve REIMB-26-01321? … Approve ₹500.00"; toast "Approved REIMB-26-01321 · Shahbaj Khan has been notified."; Pending 4 → 3, Payment need to be paid 0 → 1 |
| H3 | **PASS** | "Write a reason. The person who raised the claim sees it." — dialog stays open |
| H4 | **PASS** | Toast "Rejected REIMB-26-01322 · Shahbaj Khan has been notified."; Rejected tab shows the reason "UI test: lunch bill has no GST number." |
| A1 | **PASS** | C3, C4 listed with Approve / Reject live |
| A2 | **PASS** | Toast "Approved REIMB-26-01320 · Shahbaj Khan has been notified." |
| A3 | **PASS** | Toast "Rejected REIMB-26-01323 · Shahbaj Khan has been notified." |
| P1 | **PASS** (after reload) | C2, C4 Rejected with their reasons and only a Delete; C1 "Approved by Shalini Dubey", C3 "Approved by Nitesh Kumar", neither with Edit / Delete; bell 2 → 6 |
| S1 | **PASS** | Before the reload the list still showed C1 Pending with Delete; Delete → "This claim is Approved, so it can't be deleted." |
| P2 | **PASS** | Dialog: "Its rejection reason and receipts are deleted too, and so is its rejected expense in Project Payments, if it has one."; toast "Deleted REIMB-26-01322"; the claim's bell entry went with it (6 → 5) |
| P3 | **PASS** | Same for C4: "Deleted REIMB-26-01323" |
| X1 | **PASS** | "Payment need to paid": Type "Reimbursement / Non Project Expense", "Travel · UI-TEST C1 cab to site · Claim…", paid to the PM's own account, ₹500, raised by Shahbaj Khan; tick box, Mark as Paid, Delete |
| X2 | **PASS** | Dialog: "It pays a reimbursement claim, so that claim and its receipts are deleted too." with "[REIMB-26-01321]"; toast "… [REIMB-26-01321] was deleted."; tab 93 → 92 |
| X3 | **PASS** (Project Payments) | Same dialog for C3, "[REIMB-26-01320]"; toast "… [REIMB-26-01320] was deleted." |
| X4 | **PASS** | The PM's list is back to their two older Paid claims; bell back to 2 |
| Z1 | **PASS** | All three signed out to "Welcome back" |

**After the walk (backend, read only):** the four claims, their two Non-Project Expenses, their receipt Files and
their notifications are gone; a Deleted Document row exists for each claim and each expense.

## Findings and notes

1. **Lists don't refresh live in this dev setup.** The PM's list (and the Admin's tab counts) kept showing the old
   status until a reload. Expected here: a browser that signed in through the form keeps a Guest socket on the dev
   site until reloaded. Not checked on production. The server still refused the stale Delete (S1).
2. **The raise toast doesn't say who decides.** The server returns it ("HR or Admin" / "Admin"); the toast says
   "It's waiting for approval." A product choice, not a defect — say if the reviewer should be shown.
3. **The Non-Project Expenses page has no navigation entry** on develop (hidden 2026-09-15; only a deep link or the
   Accountant dashboard card reaches it), so X3 used Project Payments. **All Payments shows no Delete** for a
   reimbursement's expense (its Actions cell is "--"); deleting is on "Payment need to paid".
4. **Cosmetic:** after "Yes, delete" in Project Payments the dialog's title flips to the generic "Are you sure you
   want to delete this payment?" for a moment while it closes.
5. **Data seen on localhost, not caused by the walk:** the PM's own bank account holds another person's name
   ("Madhu Balan T"); the HR user was locked by an overdue monthly asset audit (submitted by the owner mid-walk).
6. **Not walked:** a Payments-queue rejection of a reimbursement (the Admin here is the CEO user, so their approval
   lands Approved, never CEO Pending), Mark as Paid → claim Paid, and editing a pending claim. Covered by
   `test_reimbursement_e2e.py` and `test_reimbursements.py`.

---

# Walk 2 — the Project Payments bulk bars with reimbursements and ordinary Non-Project Expenses

**Same day, same environment.** People: the PM (claimant / raiser), HR, a second Admin who is **not** the CEO
(so their approval clears L1 only), and the Admin who is the CEO user. Logins handed over for this walk only.

## The records

| Row | Raised as | Amount | Decided by | Lands in Payments at |
|---|---|---|---|---|
| B1 | Reimbursement (Others) | ₹60,000 | 2nd Admin approves the claim | CEO Pending |
| B2 | Reimbursement (Travel) | ₹55,000 | 2nd Admin approves the claim | CEO Pending |
| B3 | Reimbursement (Food) | ₹52,000 | 2nd Admin approves the claim | CEO Pending |
| B4 | Reimbursement (Travel) | ₹700 | HR approves the claim | Approved |
| B5 | Reimbursement (Food) | ₹800 | HR approves the claim | Approved |
| O1 | Ordinary Non-Project Expense (New Expense → request → HR review) | ₹20,000 | — | Requested |
| O2 | Ordinary Non-Project Expense | ₹60,000 | — | Requested |
| O3 | Ordinary Non-Project Expense | ₹25,000 | — | Requested |

## Test cases

| # | Who | Step | Expected |
|---|---|---|---|
| L1 | 2nd Admin | Approve Payments → lead tab | O1, O2, O3 listed; **no reimbursement row** (a claim's expense is never Requested) |
| L2 | 2nd Admin | Tick O1 + O2 → bulk Approve | O1 → Approved; O2 → CEO Pending (above ₹50,000) |
| L3 | 2nd Admin | Tick O3 → bulk Reject, no reason | Refused: a reason is required |
| L4 | 2nd Admin | Tick O3 → bulk Reject with a reason | O3 → Rejected |
| C1 | CEO | CEO tab | B1, B2, B3 (Type "Reimbursement") and O2 listed |
| C2 | CEO | Tick B1 + B2 + O2 → bulk Approve | All three → Approved; claims B1, B2 stay Approved |
| C3 | CEO | Tick B3 → bulk Reject with a reason | B3 → Rejected; claim B3 Rejected with that reason |
| M1 | CEO | "Payment need to paid": B1, B2, B4, B5, O1 can be ticked | Each ticks; reimbursement rows show the claimant's own account |
| M2 | CEO | Tick B1 + B4 + B5 + O1 → bulk Mark as Paid | Confirmation lists them; all → Reconciliation Pending; their claims stay Approved |
| M3 | CEO | Record Payment on B4 and O1 (date, UTR, proof) | → Paid; claim B4 → Paid with the UTR |
| D1 | PM | Reimbursements: B3 (Rejected in Payments) → Delete | The dialog says its rejected expense goes too; claim and expense both gone |
| D2 | PM | B1, B2, B4, B5 (Approved / Paid) | No Delete offered |
| D3 | Admin | Clean-up: delete the rest from Project Payments where the screen allows | Each claim goes with its expense |

## Walk 2 results

Records: **B1 = REIMB-26-01323**, **B2 = REIMB-26-01324**, **B3 = REIMB-26-01325**, **B4 = REIMB-26-01326**,
**B5 = REIMB-26-01327**; **O1 = EXR-26-00130**, **O2 = EXR-26-00131**, **O3 = EXR-26-00132**.

| # | Verdict | What the screen showed |
|---|---|---|
| L1 | **PASS** | Lead tab lists O1, O2, O3 only; no reimbursement row |
| L2 | **PASS** | Toast "2 expenses approved"; O1 Approved, O2 on to CEO Pending |
| L3 | **PASS** | Reject stays disabled until a reason is typed |
| L4 | **PASS** | Toast "1 expense rejected"; O3 Rejected |
| C1 | **PASS** | CEO tab lists B1, B2, B3 (Type "Reimbursement") and O2 |
| C2 | **PASS** | Toast "3 expenses approved", ₹1,75,000; claims B1, B2 stay Approved |
| C3 | **PASS** | Toast "1 expense rejected"; claim B3 Rejected with the CEO's reason |
| M1 | **PASS** | B1, B2, B4, B5, O1 each tick; reimbursement rows show the claimant's own account |
| M2 | **PASS** | Toast "Marked as Paid · 4 expenses moved to Reconciliation Pending."; claims stay Approved |
| M3 | **PASS** | Reconciliation Pending → "Mark Reconciled" opens "Record Payment & Mark as Paid". B4: Invoice Ref and Invoice Attachment come prefilled with the claim ID and its receipts; after date, UTR and proof, the expense is Paid with the UTR and claim B4 is **Paid**. O1: Paid with its UTR, no invoice needed |
| D2 | **PASS** (after reload) | B3 Rejected with the CEO's reason and only a Delete; B1, B2, B5 Approved and B4 Paid, none with Edit / Delete |
| D1 | **PASS** | Dialog: "Its rejection reason and receipts are deleted too, and so is its rejected expense in Project Payments, if it has one."; list 7 → 6, bell 8 → 7. Backend: claim, its Rejected expense, its notifications and its receipt Files all gone |
| D3 | **NOT POSSIBLE in the UI** | All Payments offers no Delete on any test row (Actions "--" or Edit only). The rows are left for the owner — see below |
| Z1 | **PASS** | PM and CEO signed out to "Welcome back"; pages closed |

**Left on localhost after the walk (test data):** claims B1, B2, B4, B5 with their four expenses (B1, B5
Reconciliation Pending; B2 Approved; B4 Paid), and the ordinary expenses O1 (Paid), O2 (Approved), O3 (Rejected)
with their three Expense Requests.

## Walk 2 findings and notes

1. **B5 was approved outside the walk** (by "Administrator", not HR); it still served M1 and M2.
2. **Stale lists again** (Walk 1, finding 1): the PM's list kept showing B1–B4 Pending with Edit / Delete until a
   browser reload. A sidebar click served the cached list.
3. **"Paid by Shalini Dubey"** on claim B4: the "by" names who approved the claim, not who paid it. Say if a Paid claim
   should name the payer.
4. **The reconcile dialog shows Expense Type "--"** for a reimbursement's expense; ordinary rows show their type.
5. **Receipt auto-fill failed** ("Auto-fill failed · There was an error.") on the dummy test PDF for O1. The fields
   were typed by hand. Expected for a blank PDF; not checked with a real bank receipt.
6. **Claim numbers are reused after a delete:** B1 got REIMB-26-01323, the number of Walk 1's deleted C4 (the
   naming series reuses a deleted newest number).
7. **Clean-up (D3) has no screen:** none of the test rows can be deleted from Project Payments' All Payments
   (Walk 1, finding 3).
