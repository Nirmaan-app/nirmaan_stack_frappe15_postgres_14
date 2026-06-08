# CEO Hold — How the system auto-holds and auto-releases projects

*Last updated: 2026-05-16*

> **Audience:** Admins, Project Leads, Accountants, PMO, and external stakeholders who need to understand *why* a project is on CEO Hold and *what changes its state*.
>
> **TL;DR:** Every time a payment, expense, inflow, or PO changes, the system recomputes the project's *cashflow gap* in real time. If the gap exceeds the project's configured limit, the project is auto-placed on CEO Hold immediately. If the gap later drops back below the limit, the system auto-releases — unless the hold was manually placed by an authorized user.
>
> **Primary mechanism:** realtime checks fire on every relevant save, no waiting for a scheduled job. A weekly safety-net cron exists in code as a backstop for missed edge cases; whether it is actively scheduled depends on environment configuration.

---

## 1. What is CEO Hold?

`CEO Hold` is a special **status** on a Project that **freezes all procurement, payment, and expense operations** for that project. While a project is on CEO Hold, no new Project Payments, Expenses, POs, PRs, or Service Requests can be created or edited. *(Delivery Notes are the only exception — they can still be filed.)*

It exists to prevent projects from running deeper into a cashflow deficit before leadership has reviewed the situation.

---

## 2. The cashflow gap — in plain English

For every project, the system continuously computes one number:

> **Cashflow Gap** = (Money already paid out + Money we owe vendors for goods received) − (Money received from customer)

Concretely:

| Side of the equation | Comes from |
|---|---|
| **Paid out** | All Project Payments with status = Paid + all Project Expenses |
| **Owed** (liabilities) | For each PO: amount of goods *delivered* minus the portion of that delivery already paid |
| **Received** | All Project Inflows |

When the gap is **positive**, the project is burning faster than it's collecting. When negative or near zero, finances are healthy.

Each project carries a **Cashflow Gap Limit** (defaulted to 20% of the project's GST value at project creation). The limit is the threshold for "this much overspend is acceptable; beyond this, leadership review is required."

---

## 3. When does the system **auto-apply** CEO Hold?

A project is automatically placed on CEO Hold the moment **all** of these are true:

1. The project is **not** currently `Completed` or already on `CEO Hold`.
2. The project's `Cashflow Gap Limit` is **greater than zero** (a limit of `0` means auto-management is opted out — see §6 below).
3. The newly computed **Gap > Limit**.

This check fires in real time whenever any of the following user actions happen:

| Action | Why it can push gap over the limit |
|---|---|
| Marking a Project Payment as `Paid` | Adds to paid-out side |
| Creating a Project Expense | Adds to paid-out side |
| Deleting a Project Inflow | Reduces received side |
| Reducing a Project Inflow amount | Reduces received side |
| Goods being received on a PO (`po_amount_delivered` rises) | Increases liabilities |
| Lowering the project's `Cashflow Gap Limit` | Gap doesn't change, but the threshold drops |

A weekly Sunday 05:00 IST safety-net cron exists in code to re-evaluate every active project as a backstop for the realtime checks. Whether it's actively scheduled in your environment depends on operations setup — confirm with engineering. **Even if the cron is not active, the realtime hooks listed above are the primary mechanism** and cover every routine user action.

> **Note on Procurement Orders:** the realtime check only re-evaluates when **`po_amount_delivered`** or **`amount_paid`** changes — these are the only PO fields that affect the gap. Edits to vendor, items, line categories, status flags, etc. do not trigger a hold re-evaluation. This is by design (avoids redundant work on PO edits that don't move the gap).

When the system applies a hold automatically:
- The project's **status** flips to `CEO Hold`.
- The field **`ceo_hold_by`** is set to `System (Cashflow Cron)` — this is the marker that says "this hold was placed by automation, not by a human."

---

## 4. When does the system **auto-release** CEO Hold?

A project on `CEO Hold` is automatically released the moment **all** of these are true:

1. The current status is `CEO Hold`.
2. **`ceo_hold_by`** is `System (Cashflow Cron)` — i.e., the hold was placed by automation, not by a human.
3. The project's `Cashflow Gap Limit` is **greater than zero**.
4. The newly computed **Gap ≤ Limit**.

User actions that can naturally trigger an auto-release:

| Action | Why it pulls gap below limit |
|---|---|
| Recording a new Project Inflow (customer payment received) | Increases received side |
| Increasing an existing Inflow amount | Same |
| **Deleting** a Paid Project Payment (e.g., reversing a mistaken entry) | Reduces paid-out side |
| **Deleting** a Project Expense | Reduces paid-out side |
| A PO's `amount_paid` catching up with `po_amount_delivered` | Reduces liabilities |
| **Raising** the project's `Cashflow Gap Limit` | Threshold moves above gap |

When the system auto-releases:
- The status is reverted to **whatever the user had it on before the auto-hold** (e.g., `WIP`, `Halted`, `Active`).
- The system finds the previous status by walking the project's edit history (Frappe's built-in `Version` records) and using the most recent status that a real user (not a system actor) set.
- If no user-set status is on record, the project falls back to `WIP`.
- `ceo_hold_by` is cleared.

---

## 5. What does **NOT** auto-release?

The system **never** auto-releases a hold that was placed manually by a human (i.e., when `ceo_hold_by` contains a real user's email address — typically the authorized user, `nitesh@nirmaan.app`).

Rule: *whoever places a hold owns lifting it.*

| Type of hold | Indicator on the project | Lifted automatically? |
|---|---|---|
| Automatic (by the cron/realtime) | `ceo_hold_by = "System (Cashflow Cron)"` | ✅ Yes, when gap drops below limit |
| Manual (by the authorized user) | `ceo_hold_by = "nitesh@nirmaan.app"` | ❌ No — only `nitesh@nirmaan.app` can clear it |

This is intentional. A human reviewing a project may have placed the hold for reasons the cashflow formula doesn't capture (legal review, customer dispute, internal compliance check, etc.), and the system must not second-guess that judgment.

---

## 6. Opting out — clearing the limit

A user can set the project's **Cashflow Gap Limit** to **0**. This **disables automatic management entirely** for that project:

- The system will **not** auto-apply a CEO Hold no matter how high the gap rises.
- If the project is already on cron-set CEO Hold, the system will **not** auto-release either. The hold becomes "sticky" until a human acts.

To re-engage automatic management, set the limit back above zero.

---

## 7. Sticky-hold edge case (read this once)

If a project is **currently on cron-set CEO Hold** and someone **clears the limit to 0**, the project lands in a stuck state:

- Auto-hold: disabled (limit is 0).
- Auto-release: also disabled (limit is 0).

To get the project moving again, an admin must do **one of**:

1. **Restore the limit** to a positive value. The next gap-changing action will then auto-release if appropriate.
2. **Manually clear the CEO Hold** from the project page. Since `ceo_hold_by` is `System (Cashflow Cron)`, the authorized user (`nitesh@nirmaan.app`) is permitted to override.

---

## 8. How to avoid being surprised by an auto-hold

The most common causes of auto-holds, ranked by frequency:

1. **Paying a vendor for a PO whose goods aren't yet delivered.** This increases paid-out side without reducing the liability side — gap rises.
2. **Marking a payment as Paid without recording the corresponding customer inflow.** Outflow without matching inflow.
3. **Recording a one-off Project Expense** without budgeting room in the gap limit.
4. **Recording goods receipt (PO marked Delivered) before payment.** This shifts the PO into liabilities; the system treats it as "owed but not yet paid."
5. **Adjusting the Cashflow Gap Limit downward.** The gap didn't move, but the threshold did.

To prevent surprises, **check the project's current gap before** taking any of these actions. A small dashboard widget on the project page would help here — speak to engineering if you want one added.

---

## 9. What to do if a project is unexpectedly on CEO Hold

Open the project's history (Comments / Version timeline) and look at:

1. **Status of the last few Project Payments** — was something just marked Paid?
2. **Recent Project Expenses** — was a large expense filed?
3. **PO goods receipts** — did a PO just receive Delivered status?
4. **Current Cashflow Gap Limit** — did someone reduce it?

If you can identify the action that pushed gap over the limit, two options:

- **Reverse / fix the action** (e.g., delete the wrong payment) — the system auto-releases on the next save.
- **Raise the Cashflow Gap Limit** — once the limit is above the gap, the system auto-releases.

If neither is appropriate, escalate to `nitesh@nirmaan.app` to review and manually release.

---

## 10. Quick reference — state transitions

| From → To | What causes it |
|---|---|
| Normal status (WIP, etc.) → `CEO Hold` | Cron/realtime: gap rose above limit |
| `CEO Hold` (cron-set) → Previous status | Cron/realtime: gap dropped at/below limit |
| Normal status → `CEO Hold` | Manual: authorized user sets it |
| `CEO Hold` (manual) → Previous status | Manual: same authorized user releases it |
| Anything → `Completed` | Manual: end of project |
| `Completed` → Anything | Manual only — system never touches Completed projects |

---

## 11. Frequently Asked Questions

**Q. Can a Project Manager override CEO Hold?**
A. No. Only the authorized user (`nitesh@nirmaan.app`) can manually set or clear CEO Hold.

**Q. If I delete a wrong Paid payment, will the hold automatically clear?**
A. Yes, if the deletion brings the gap back at or below the limit, and the hold was cron-set.

**Q. Why didn't my project auto-release when I added a large Inflow?**
A. Possible reasons:
 - Gap is still above limit even with the new inflow.
 - The hold was placed manually (`ceo_hold_by` is a user email, not `System (Cashflow Cron)`).
 - The Cashflow Gap Limit on the project is 0 (auto-management disabled).

**Q. Why does Delivery Note creation still work on a held project?**
A. By design. DN management is exempt from CEO Hold blocking. All other procurement/payment operations are blocked.

**Q. How often does the safety-net cron run?**
A. It is registered in code for Sunday 05:00 IST and evaluates every non-completed project in both directions (hold and release). However, whether the cron is actively scheduled depends on the environment — in some setups it's currently triggered only manually via command line, not by the scheduler. The realtime hooks are doing the day-to-day work; the cron is a backstop for any drift the realtime path might miss.

**Q. What happens if multiple changes are saved in a single request (e.g., a script creates several Payments at once)?**
A. The system evaluates the gap once per project per request. If a batch of changes cumulatively pushes the gap over the limit, the auto-hold may not trigger inside that same request — but the very next single save (Payment, Expense, Inflow, PO field change, or limit edit) on the project will catch it and flip the status. The weekly safety-net cron, when scheduled, also catches such cases on its next run.

**Q. Where can I see a history of when this project was held or released?**
A. Open the project in the Desk UI and check the **Activity / Timeline** panel — every status change made by a real user is recorded in Frappe's `Version` log. System-driven flips by the cron/realtime don't currently generate a timeline entry; that visibility is planned in a future update.

**Q. Can the system ever auto-place a hold on a Completed project?**
A. No. Completed status is terminal — the cron skips it entirely.

---

## 12. Glossary

- **Cashflow Gap** — `(paid + expenses + liabilities) − inflows` for a project.
- **Cashflow Gap Limit** — Per-project threshold above which auto-hold triggers. Defaulted to 20% of the project's GST value when first set.
- **Liabilities** — For each PO: amount of goods *delivered* minus the amount already paid against the delivered portion. Capped at the delivered amount, so over-payments don't go negative.
- **CEO Hold** — A project status that blocks procurement, payment, and expense operations.
- **`ceo_hold_by`** — Stored on every project; the user (or system marker) that placed the current hold. Determines who can release it.
- **`System (Cashflow Cron)`** — The marker the automation uses when it places a hold. The presence of this marker is what makes a hold auto-revertible.
- **Realtime trigger** — Hooks that fire on every save of Payments, Expenses, Inflows, POs (only on `po_amount_delivered` / `amount_paid` changes), and the project's gap limit. The primary mechanism — state stays current without waiting for any cron.
- **Safety-net cron** — Weekly Sunday 05:00 job registered in code to re-evaluate every project. Whether it is actively scheduled in production depends on environment configuration; check with engineering. Functions as a backstop for edge cases the realtime hooks might miss (e.g., direct SQL writes, partial rollbacks, batch-save scenarios where multiple records change in a single request).
- **Batch-save edge case** — When a single request saves multiple gap-affecting documents (e.g., a script that creates 5 Project Payments in one go), the realtime check evaluates the gap once based on the first save's state. The cumulative effect of saves 2-N may not trigger an auto-hold within that request. The very next single save on the project, or the safety-net cron (when active), corrects this.
