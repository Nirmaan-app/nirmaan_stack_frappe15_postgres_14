# Browser walk — Reimbursements: raise, decide, and the delete rules (ADR-0040 Amendment A)

> **Superseded in part by the monthly reimbursement limit (ADR-0040 Amendment B, 2026-10-28).** Walks 1 and 2 are
> kept as they were walked. Three of their expectations no longer hold: Walk 1 **H1** and the C3 row (HR's Approve /
> Reject are no longer disabled above ₹2,000; HR approves any amount raised outside HR, with a warning above the
> limit), and Walk 2 **L1** (a claim's expense CAN now be Requested: HR's approval above the monthly limit sends it
> to L1). Walk 4 below covers the new rule.

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

# Walk 3 (not walked yet) — the own account in Raise Reimbursement and in New Expense Request

Changed after Walks 1 and 2 (owner, 2026-10-27); covered by tests only so far
(`api/expense_requests/test_request_payees`, `frontend/src/utils/payees/payeeForm.test.ts`).

**People:** a person with no own bank account yet (a fresh PM), a PM who has one, an Accountant.
**Records:** one Users Payee (the PM's own account) and one Others Payee with a similar holder name.

| # | Who | Step | Expected |
|---|---|---|---|
| O1 | Fresh PM | Raise Reimbursement | The account section is titled **Add Your Account**; its button reads **Add Account** |
| O2 | Fresh PM | Fill the account, Add Account | The account shows read-only; the title is now **Who gets paid**; "Edit it on your profile" link |
| O3 | Fresh PM | Close and reopen Raise Reimbursement | **Who gets paid** with the saved account (no Add Your Account flash while it loads) |
| E1 | PM | New Expense Request (a type that asks who gets paid) → Pick a payee → type the holder name | The Others Payee is listed; the PM's own account (Users) is not |
| E2 | PM | Same, typing the own account's number | No match for the own account |
| E3 | PM | Add new payee → the own account's exact number + IFSC | Red block **This is a user's account**: "This is a user's own account (Users), so it can't be used in an expense request. Enter a different account." No Pick button; Submit stays blocked |
| E4 | PM | Add new payee → the Others Payee's number + IFSC | The ordinary block: "This account is already a payee" with **Pick … instead**, which picks it |
| E5 | PM | Change the number to a new account | The block clears; the request submits with the new Payee |
| A1 | Accountant | An expense's Change account (Paid to box) → search the PM's name | The own account IS listed here (only the request's picker hides it) |

---

# Walk 4 — the monthly reimbursement limit (ADR-0040 Amendment B)

Built 2026-10-28; covered by tests so far (`services/reimbursements/test_rules.py`,
`api/reimbursements/test_reimbursements.TestMonthlyLimit`, `test_reimbursement_e2e`,
`frontend/src/utils/reimbursements/monthLimit.test.ts`).

**People:** P, a Project Manager with **no Approved or Paid claims raised this month** (checked read-only before
the walk; a PM left with Walk 2's Approved and Paid claims would be over the limit from the start); an HR
Executive; an Admin who is **not** the CEO (L1), who also raises one claim of their own (claimant Q); the CEO
user, who also raises two claims for the stale-total check (claimant R). Four logins, handed over for this walk
only.

**Receipts:** one tiny one-page PDF per claim (ten in all): they upload to the real bucket and stay there.

**Month:** every claim is raised in the walk's own month. The month boundary (a claim raised last month never
counts) is pinned by `TestMonthlyLimit.test_the_month_total_counts_this_claim_and_approved_or_paid_ones_of_the_same_month`.

## The claims

All raised first, so none is approved while the others are still pending (a pending claim must not count).

| Claim | Claimant | Type · amount | Decided by | Month total when decided | Then |
|---|---|---|---|---|---|
| M1 | P | Travel · ₹1,500 | HR approves | ₹1,500 | auto-approved, no L1 |
| M2 | P | Food · ₹500 | HR approves | ₹2,000 (exactly the limit) | auto-approved, no L1 |
| M7 | P | Food · ₹900 | HR rejects | — | never counts |
| M3 | P | Travel · ₹1,200 | HR approves, with the tick | ₹3,200 | waits for L1 in Payments, even under ₹15,000 |
| M4 | P | Others · ₹60,000 | HR approves, with the tick | ₹63,200 | L1, then the CEO |
| M5 | P | Travel · ₹20,000 | Admin approves, with the tick | ₹83,200 | Approved at once: the Admin is L1 |
| M6 | Q (the Admin) | Travel · ₹2,400 | HR approves, with the tick | ₹2,400 (one claim above the limit) | waits for L1 |
| M8 | the HR Executive | Food · ₹300 | Admin only | — | HR's buttons disabled |

## Test cases

| # | Who | Step | Expected |
|---|---|---|---|
| W1 | P, Q, HR | Raise M1–M8 | Each saves; all Pending Approval |
| W2 | HR | Pending Approval | Approve / Reject live on every claim of P and Q, including M4 (₹60,000) and M5; disabled on M8 with "A claim raised by someone in HR is approved by Admin." |
| W3 | HR | Approve M1 | A quiet grey line: "… has no other approved claims in <month>. With this claim: ₹1,500, within the ₹2,000 monthly limit." No tick box; Approve enabled. A blue line says where it goes: 'Approving makes it a Non-Project Expense in Project Payments, under "Payment need to paid", where Accounts pays it.' Toast |
| W4 | HR | Approve M2 | Grey line: "… has already claimed ₹1,500 in <month> (1 claim). With this claim: ₹2,000, within …". No tick box |
| W5 | HR | Reject M7 with a reason | Rejected |
| W6 | HR | Approve M3 → look, don't tick | Amber warning: "… has already claimed ₹2,000 in <month> (2 claims)." (M7's ₹900 and the pending M4–M5 are NOT in it) and "With this claim of ₹1,200, <month>'s total is ₹3,200, above the ₹2,000 monthly limit. After you approve, it goes to L1 in Payments." Approve **disabled**. The blue line: '… under "Payment Pending Approval", where L1 (Admin) approves it.' |
| W7 | HR | Tick, untick, tick | Approve enables, disables, enables |
| W8 | HR | Cancel, reopen Approve on M3 | The box is unticked again; Approve disabled |
| W9 | HR | Tick → Approve M3 | Toast; M3 leaves Pending Approval |
| W10 | HR | Approve M4 and M6 with the tick | Same warning (M6: "… has no other approved claims …", total ₹2,400 above the limit) |
| W11 | Admin | Approve M5 | Amber warning with the tick, but **no** "goes to L1" sentence; the blue line says "Payment need to paid"; after approving, M5's expense is NOT in the lead tab. (M4 approved by HR would say '… "Payment Pending Approval", where L1 (Admin) approves it, then the CEO.') |
| W11b | P, second window | Keep P's "Raised By Me" open while HR approves in the other window; then click back into P's window | The rows refresh on focus (status Approved), together with the tab counts |
| W12 | P | Reimbursements → M3, M4 → detail | Status Approved; payment "Waiting for L1 approval" |
| L1 | Admin | Project Payments → Approve Payments (lead tab) | M3 (₹1,200), M4 (₹60,000) and M6 listed, Type "Reimbursement / Non Project Expense"; M1, M2, M5 not listed |
| L2 | Admin | M3 → Approve (single) | Amber warning, Payments wording: "… With this claim of ₹1,200, … total is ₹3,200, above … Approving it pays above the monthly limit." Confirm **disabled** until ticked |
| L3 | Admin | Tick → Confirm | M3 Approved; P's detail sheet now says "Waiting to be paid" |
| L4 | Admin | Tick M4 + M6 (+ an ordinary Requested expense if the tab has one) → bulk Approve | The confirm dialog shows the amber box "Reimbursements above the ₹2,000 monthly limit · 2 claims · 2 people": P ₹83,200 ("… 1 of them is in this approval: ₹60,000") and Q ₹2,400. **No tick box**; Approve enabled. Expanding "Non Project Expense" shows an amber "Above limit · ₹… in <Mon>" tag on each reimbursement row; an ordinary expense has no tag |
| L5 | Admin | Confirm | M4 → CEO Pending; M6 → Approved |
| L6 | Admin | Tick a reimbursement → bulk **Reject** → look, then Cancel | No limit box on a reject |
| C1 | CEO | CEO tab → M4 → Approve (single) | The same warning and tick; after Confirm, M4 Approved; P's detail sheet "Waiting to be paid" |
| S0 | CEO (claimant R) | Raise S-a Travel ₹1,500 and S-b Food ₹800 | Both Pending Approval; R has no approved claims this month |
| S1 | HR + Admin, two windows | HR opens Approve on S-b (grey line, ₹800, no tick). Before HR clicks, the Admin approves S-a in the other window. Then HR clicks Approve | The server refuses: "This person's reimbursements this month come to ₹2,300, above the ₹2,000 monthly limit. Tick the box to confirm, then approve." S-b stays Pending; no expense |
| S2 | HR | Close and reopen Approve on S-b | Now the amber warning: "… has already claimed ₹1,500 …", total ₹2,300, with the tick box |
| Z1 | each | Sign out | Back at the login screen |

**Clean-up:** the claimant deletes M7 (Rejected), and HR or Admin rejects S-b and M8 so their claimants can delete them. The rest go only by deleting each expense where the screen allows
(Walk 2 finding 7: All Payments offers no Delete), so expect to leave M1–M6 and M8 on localhost for the owner.

## Walk 4 results (2026-10-28)

> **The edge moved after this walk (owner, 2026-10-28):** a month total of exactly ₹2,000 now **reaches** the limit
> (only ₹1,999 or less is within it), and the wording reads "under" / "at or above" / "Limit reached". W4 below (M2
> bringing the month to exactly ₹2,000 and auto-approving) recorded the old edge; it now shows the warning and goes to
> L1. Pinned by `TestMonthlyLimit.test_exactly_2000_for_the_month_reaches_the_limit`, the e2e
> `test_the_monthly_limit_is_reached_at_2000_…` and the shared cases. Not re-walked in the browser.

**Environment:** localhost:8080 (vite) + backend :8000, throwaway incognito Chrome (chrome-devtools MCP), one isolated
context per person. **People:** a Project Manager (P), an HR Executive, an Admin who is not the CEO (L1, also claimant
Q), the CEO user (claimant R), and an Accountant-side user (claimant for the re-run of S1). Logins handed over for this
walk only.

Claims: **M1 = REIMB-26-00170** (₹1,500) · **M2 = 00171** (₹500) · **M7 = 00172** (₹900) · **M3 = 00173** (₹1,200) ·
**M4 = 00174** (₹60,000) · **M5 = 00175** (₹20,000) · **M6 = 00176** (Q, ₹2,400) · **M8 = 00177** (HR, ₹300) ·
**S-a = 00178** (R, ₹1,500) · **S-b = 00179** (R, ₹800) · **X1 = 00180** (₹500) · **X2 = 00181** (₹1,600).

| # | Verdict | What the screen showed |
|---|---|---|
| W1 | **PASS** | All raised; the three new claimants went through Add Your Account in the Raise dialog |
| W2 | **PASS** | HR: Approve / Reject live on every claim of P and Q, ₹60,000 and ₹20,000 included; M8 disabled with "A claim raised by someone in HR is approved by Admin." |
| W3 | **PASS** | Grey line "Shahbaj Khan has no other approved claims in October 2026. With this claim: ₹1,500, within the ₹2,000 monthly limit."; blue line "… under "Payment need to paid", where Accounts pays it."; no tick |
| W4 | **PASS** | "… has already claimed ₹1,500 in October 2026 (1 claim). With this claim: ₹2,000, within …"; no tick at exactly ₹2,000 |
| W5 | **PASS** | M7 Rejected with the reason |
| W6 | **PASS** | Amber: "… has already claimed ₹2,000 in October 2026 (2 claims)." (rejected ₹900 and pending claims left out); "… total is ₹3,200, above the ₹2,000 monthly limit. After you approve, it goes to L1 in Payments."; blue line "Payment Pending Approval"; Approve disabled |
| W7 | **PASS** | Tick enables, untick disables |
| W8 | **PASS** | Cancel and reopen: unticked, Approve disabled |
| W9 | **PASS** | Approved after the tick |
| W10 | **PASS** | M4: "already claimed ₹3,200 (3 claims) … ₹63,200", blue line "… L1 (Admin) approves it, then the CEO."; M6: "no other approved claims … ₹2,400, above" |
| W11 | **PASS** | Admin on M5: "already claimed ₹63,200 (4 claims) … ₹83,200", tick required, **no** "goes to L1" sentence, blue line "Payment need to paid"; M5 never reached the lead tab |
| W11b | **NOT TESTABLE with this tool** | Bringing an isolated CDP window to the front fires no window `focus`, so neither the counts nor the rows refreshed; a sidebar click to the same page fetched nothing either. Refreshed by a browser reload. Check by hand in a normal browser (switch windows and come back) |
| W12 | **PASS** | P's detail sheet for M3: Approved, Stage "Waiting for L1 approval", the expense named |
| L1 | **PASS** | Lead tab: M3, M4, M6 as "Non Project Expense / Reimbursement"; M1, M2, M5 absent; summary "Auto Approval Today (2) ₹2,000", "L1 Approval Today (1) ₹20,000" |
| L2 | **PASS** | M3 single approve: "already claimed ₹82,000 (4 claims) … ₹83,200, above … Approving it pays above the monthly limit."; Confirm disabled until ticked |
| L3 | **PASS** | "Expense marked Approved."; P's sheet "Waiting to be paid" |
| L4 | **PASS** | Bulk M4 + M6: box "Reimbursements above the ₹2,000 monthly limit · 2 claims · 2 people", Shahbaj Khan ₹83,200 "Claimed in October 2026 across 5 claims. 1 of them is in this approval: ₹60,000.", Kumar Shanu ₹2,400 "… across 1 claim. It is in this approval: ₹2,400."; no tick; row tags "Above limit · ₹2,400 in Oct" / "Above limit · ₹83,200 in Oct" |
| L5 | **PASS** | "2 expenses approved."; M4 → CEO Pending, M6 → Approved |
| L6 | **PASS** | Bulk Reject (CEO tab): no limit box, reason required |
| C1 | **PASS** | CEO bulk Approve shows the box (1 claim · 1 person); CEO single approve of M4: "already claimed ₹23,200 (4 claims) … ₹83,200", tick required, "Expense marked Approved." |
| S1 | **PASS (server) → FIXED (screen)** | First run: the server refused the stale approval ("This person's reimbursements this month come to ₹2,300, above the ₹2,000 monthly limit. Tick the box to confirm, then approve.") but the dialog still showed the old "₹800, within" line with no box to tick. Fixed the same day: on a refusal the dialog reads the total again (`useMonthTotals().refresh`). Re-run with X1/X2: the amber warning (₹2,100), the tick box and the "Payment Pending Approval" line appeared in place under the server's message; tick → Approved |
| S2 | **PASS** | Reopened: "already claimed ₹1,500 (1 claim) … ₹2,300 … goes to L1", with the tick |
| Z1 | **PASS** | All five signed out to "Welcome back" |

**After the walk (backend, read only):** M1, M2, S-a, X1 expenses Approved with `auto_approved = 1`; M3, M4, M5, M6
Approved with `auto_approved = 0`; X2 Requested (waiting for L1); M7 deleted by its claimant (no expense); M8, S-b
Pending Approval. Project Payments 8,648 before and after.

## Walk 4 findings and notes

1. **A refused stale approval showed no box to tick** (S1). Fixed and re-walked (above).
2. **The test tool cannot fire a window focus**, so the table's new refresh-on-focus (`ClaimsTable`) is unproven in
   the browser; the tab counts did not refresh that way either. Same-window refreshes (after every approve and reject)
   worked throughout.
3. **Payments' row buttons come before the row's text** in the accessibility tree, so a click aimed by reading the
   tree landed on the next row (a real PO payment's Approve dialog opened; cancelled, nothing approved). Searching
   "UI-TEST" first kept every later click on the test rows. Not a product defect.
4. **Cosmetic, not this change:** after Confirm in Payments' single approve, the closing dialog flashed "Could not
   load this expense's details. You can still approve it." (the expense details block reloading as the row moves on).
5. **Payments tab badges lag:** the lead tab's badge stayed at 17 after M3 was approved until the next refetch.
6. **Left on localhost:** the test claims above except M7, with their expenses (X2 waiting in the lead tab), the four
   new Users Payees (holders "… UI Test", account numbers 99000777200001–04, IFSC HDFC0000001), and 12 receipt PDFs in
   the bucket. REIMB-26-00169 (₹2,000, "breakfast …") was not part of the walk.

---

# Walk 5 (not walked yet) — the Reimbursements tab on a user's profile

Built 2026-10-28 (owner: Admin only); covered by `frontend/src/utils/reimbursements/profileMonth.test.ts` and a
read-only server check of the tab's query (October for the Walk 4 PM: 6 claims, Approved ₹83,200, Pending ₹2,000;
September: none). **People:** an Admin, the CEO user, HR, Accounts and a Project Manager.

| # | Who | Step | Expected |
|---|---|---|---|
| P1 | Admin | Users → a person with claims → profile | A **Reimbursements** tab after Payee; it opens on this month |
| P2 | Admin | The tab | That person's claims raised this month only, every status; no Claimant column, no Edit / Delete |
| P3 | Admin | The summary above the table | "<Month> total ₹X · Approved + Paid" with the chip "Limit reached" from ₹2,000 or "Under the ₹2,000 limit", then Approved, Paid, Pending ("not counted yet") and Rejected ("never counted") |
| P4 | Admin | The same month total in an approver's warning for that person's next claim | The same figure |
| P5 | Admin | Month → last month; → All months | Rows and totals change together; All months says "Total", with no chip |
| P6 | Admin | Reload with the month chosen | The same month (`?reimb_month=`) |
| P7 | Admin | Click an ID | The detail sheet, with no Approve / Reject / Edit / Delete |
| P8 | Admin | More than one page of claims (All months) | The total covers every page, not only the one shown |
| P9 | CEO | A profile | The tab is there |
| P10 | HR, Accounts, the PM on their own profile | A profile | **No** Reimbursements tab |
| P11 | Admin | Phone width | Five tabs fit (icons only) |
