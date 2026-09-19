# ADR-0028 — GST Hold replaces the Work Order ₹15 lakh block

- **Status:** Accepted, built (owner grilling 2026-09-19, Q1–Q16; Q3 revised twice the same day — final: the job never releases a hold)
- **Date:** 2026-09-19
- **Feature:** Vendors / Work Orders (Service Requests)
- **Replaces:** the new-WO amount check added 2026-09-16 (`validate_vendor_fy_limit`)

---

## Context

On 2026-09-16 a rule went in that refused a **new** Work Order when the vendor's GST-off Work Orders
this financial year, plus the new one, went above ₹15,00,000. It checked only at creation, so vendors
still got past it: a WO counts only once approval switches its GST off, the "GST Applicable" switch on
an approved WO is never checked, and an amendment can raise an amount. VEN-Service-0041 stood at
₹16,79,021 with the block in place.

The owner wanted detection instead of a hard amount stop, and a manual Admin release tied to the
vendor getting a GST number.

## Decision

**A `gst_hold` checkbox on the Vendor. A daily job turns it ON for a vendor with no GST number whose
GST-off Work Orders this financial year total more than ₹15,00,000. The job never turns it OFF. A
vendor on GST Hold cannot get a new Work Order. Only an Admin removes it, from the Vendor page, which
switches that year's GST-off Work Orders to GST-on.**

### The rule (unchanged from 2026-09-16, now owned as the GST Hold rule)

`services/wo_vendor_limit.py`: the vendor's Work Orders with `gst = "false"`, `status != "Rejected"`,
created 1 April → 31 March; summed on `total_amount` (Q-final — the owner's "WO total value"; on a
GST-off WO it equals qty × rate, checked on all 684 such WOs). Hold when the sum is **> ₹15,00,000**
(Q2: ₹15,00,001 holds, exactly ₹15,00,000 does not).

The job holds a vendor only when **all three** are true (owner, 2026-09-19):

1. the vendor has **no GST number** (blank or whitespace counts as none);
2. its type is **Service** or **Material & Service** (`GST_HOLD_VENDOR_TYPES`) — a **Material** vendor
   is never held, even over the limit;
3. its total is **above ₹15,00,000**.

### Setting and clearing

| Event | GST Hold |
|---|---|
| Vendor created | always OFF (Q-final; an early "no GST number → hold" idea was dropped) |
| Daily job, 04:00 | ON for every vendor meeting all three conditions (Q4 → daily, owner). Every other vendor is left exactly as it is — the job never turns a hold OFF |
| Total drops back to ₹15L or under mid-year | stays ON until an Admin removes it (owner, 2026-09-19 — final Q3) |
| Vendor gets a GST number | stays ON; the Admin still has to remove it, which is what switches its Work Orders |
| New financial year | stays ON — the hold carries over; there is no reset step (Q16). The new year's total starts at zero, so no vendor is *newly* held until it passes ₹15L again |
| Admin clicks Remove GST Hold | OFF (Q3, Q8: Admin only) |
| GST Hold ticked / unticked by hand | no WO is switched and no GST number is needed. The field is editable with **no backend role guard** (owner, after build: access is controlled by who is given the control in the UI). A tick stays, since the job never releases — even on a Material vendor or one with a GST number. An untick on a vendor that still meets all three is put back ON the next morning |

**One job, not two** (owner): `tasks/vendor_gst_hold.update_gst_holds` puts every qualifying vendor
ON each morning and touches no other vendor. Because it never releases, the new financial year needs
no marker or reset step.

**04:00, not 04:30.** The Vendor Hold credit job saves every vendor as a full row at 04:30; a GST Hold
write between its load and save would be overwritten or stop that job part-way.

### What GST Hold blocks (Q1 → c, Q12)

Only **creating** a Work Order for that vendor: the new-WO wizard (yellow card, "This vendor is on GST
Hold. Contact Admin to remove it.", Next and Submit disabled) and the server (`validate` on a new
Service Request). Amending, approving, paying and invoicing existing Work Orders carry on. The old
₹15L amount check at creation is **removed**, and so is the yellow figures card for vendors not on hold
(Q13 → b).

### Remove GST Hold (Q5–Q7, Q14)

- **Needs a GST number** (Q11 → a). Without one the Admin is told to add it first; nothing changes.
- Switches **every** GST-off Work Order of **this financial year** to GST-on (Q5 → a, Q7), saved
  normally so `total_amount` gains 18%, `amount_due` follows and Version history records it.
- **Skips any Work Order not in Approved status** (Q14 → b named Amendment). Saving a WO in Amendment
  re-sends its notifications and commits per recipient, which would break the one-transaction
  guarantee. Every GST-off WO was Approved on 2026-09-19.
- Then clears `gst_hold` and writes a comment on the Vendor. All in one transaction.

## Consequences

- A paid Work Order that gets switched shows a new 18% balance due (VEN-Service-0041: 7 WOs, +₹3.02L).
- With a daily job, a vendor can pass ₹15L during the day and is held the next morning.
- A hold never lifts by itself. Rejecting, deleting, switching to GST-on or amending down the vendor's
  GST-off Work Orders lowers the total but leaves the hold ON; only an Admin clears it.
- A skipped Work Order stays GST-off. The vendor now has a GST number, so the job never holds it again,
  even if the skipped ones alone exceed ₹15L.
- A hold carries into the next financial year. Removing it then switches only the new year's GST-off
  Work Orders, so the earlier year's stay GST-off.

## Rejected

- **Keep the creation block and add the job** (recommended as Q1 a) — owner chose to move the block from
  the amount to the flag.
- **Remove without a GST number, WOs stay GST-off** (Q6 first answer) — the job would re-hold the vendor
  the next morning; making it stick needed a "GST Hold Since" date field, which the owner declined.
- **All GST-off Work Orders of any year** (Q5 b) — would reopen settled books (+₹11.68L for one vendor).
- **Two scheduled entries** (daily set + 1 April reset) — owner asked for a single job.
- **Recompute both ways** — OFF the next morning once the total is back at ₹15L or under, which also
  cleared every hold at a new financial year. Built, then reversed by the owner on 2026-09-19: the job
  never releases, only an Admin does.
