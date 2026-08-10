"""
Repair script — PO Adjustments ledger integrity.

WHY THIS EXISTS
---------------
`PO Adjustments.remaining_impact` is a DERIVED number: it must always equal the sum
of the doc's own `adjustment_items` rows. Nothing enforced that. The doctype has no
`validate()`, the field is writable, and the child grid is editable — so a Desk save
persists whatever a human typed. Two docs were hand-edited that way (both
`modified_by = Administrator`), one of them losing an audit row entirely.

Separately, `_auto_absorb_created_terms` (revision_logic.py) can only reduce terms in
`term_status == "Created"`. When a PO shrinks while its only unpaid term is mid-approval
(`Requested` / `CEO Pending` / `Approved`), the decrease is absorbed by NOTHING and is
recorded as an unresolved negative `remaining_impact` — i.e. "the vendor owes us money"
— on a PO where nothing was ever paid. That is a HARD payment lock that no UI action can
clear honestly: all three existing resolution methods create a `Project Payments` row,
which would book money that never moved.

WHAT THIS SCRIPT DOES
---------------------
Report mode (default) writes NOTHING. It prints:
  1. every adjustment whose stored `remaining_impact` disagrees with its own children
  2. the two targeted repairs, with before/after and the resulting lock state
  3. report-only findings that are NOT repaired here (payment-term drift,
     `amount_paid` drift, stray `term_status` values) — these need their own decision

`--apply` performs ONLY the two targeted repairs in section 2, inside one transaction.
It creates NO `Project Payments` rows. That is deliberate: neither repair represents
money moving, and creating a payment would re-trigger `_recalculate_amount_paid`, which
sums `status == "Paid"` only and would disturb the deliberately-`Approved` negative
payments the owner is holding.

USAGE (from the host; bench CLI is broken on the host — click version mismatch)
------------------------------------------------------------------------------
    docker cp nirmaan_stack/repair_po_adjustments.py \
        frappe_docker_devcontainer-frappe-1:/tmp/repair_po_adjustments.py
    docker exec -w /workspace/development/frappe-bench \
        frappe_docker_devcontainer-frappe-1 \
        env/bin/python /tmp/repair_po_adjustments.py            # report
    docker exec -w /workspace/development/frappe-bench \
        frappe_docker_devcontainer-frappe-1 \
        env/bin/python /tmp/repair_po_adjustments.py --apply    # write
"""

import os
import sys

os.chdir("/workspace/development/frappe-bench/sites")

import frappe  # noqa: E402
from frappe.utils import flt  # noqa: E402


# ── The two targeted repairs ────────────────────────────────────────────────────
# Declared ONCE so the report and the apply can never describe different work.
# `entry_type` values reuse the existing vocabulary; "Write Off" is the entry type
# the Admin-only write-off action will also use.
REPAIRS = [
    {
        "po_id": "PO/246/00103/26-27",
        "entry_type": "Write Off",
        "amount": 4130.00,
        "description": (
            "Write-off: PO decreased by Rs.4,130.00 on 16-Jul-2026 (revision "
            "PRT/00103/246/02) while its only payment term was CEO Pending, so nothing "
            "could absorb it. Rs.0 was ever paid on this PO — there is no money to "
            "recover. Recorded as a write-off; no payment created."
        ),
        "why": (
            "Phantom liability. amount_paid = 0 on a Rs.20,650 PO, payment terms already "
            "sum to Rs.20,650. The -4,130 is a bookkeeping gap, not money owed."
        ),
    },
    {
        "po_id": "PO/011/00097/26-27",
        "entry_type": "Against PO",
        "amount": 144.67,
        # NO target_po. `target_po` is a Link to Procurement Orders and the destination
        # PO/055/00106/26-27 was DELETED on 17-Jul-2026 by sowmya@nirmaan.app — the day
        # after this credit was transferred into it. Writing the link fails Frappe's
        # link validation (correctly). The destination is named in the description
        # instead; the payment leg still exists and stays linked.
        "project_payment": "PAY-00097-061",
        "description": (
            "Credit applied to PO/055/00106/26-27 (that PO was deleted on 17-Jul-2026, "
            "so it cannot be linked here). Evidence: payment term "
            "'RA PO PO/055/00106/26-27' (-144.67) + payment PAY-00097-061."
        ),
        "why": (
            "Restores an audit row deleted by hand. The transfer really happened. Its "
            "'Against PO' entry was removed and remaining_impact was hand-typed as "
            "+144.00 (wrong sign, wrong value). NOTE: the Rs.144.67 is STRANDED — it "
            "left this PO into a PO that no longer exists. This entry records that the "
            "credit left; recovering it is a separate commercial decision."
        ),
    },
]

MID_APPROVAL = ("Requested", "CEO Pending", "Approved")
DONE_BAND = 100.0  # |remaining_impact| < 100 reads as "Done" (display tolerance)


def h1(text):
    print("\n" + "=" * 78)
    print(text)
    print("=" * 78)


def h2(text):
    print("\n--- " + text + " " + "-" * max(0, 70 - len(text)))


def child_sum(adj_name):
    return flt(
        frappe.db.sql(
            """SELECT COALESCE(SUM(amount), 0) FROM "tabPO Adjustment Items" WHERE parent=%s""",
            (adj_name,),
        )[0][0],
        2,
    )


def lock_state(remaining):
    """Mirrors revision_po_check.check_po_in_pending_revisions' adjustment branch."""
    status = "Done" if abs(flt(remaining)) < DONE_BAND else "Pending"
    if status == "Pending":
        return status, "HARD PAYMENT LOCK"
    if flt(remaining) <= -1.0:
        return status, "soft credit notice (not locked)"
    return status, "unlocked"


# ── Section 1 ───────────────────────────────────────────────────────────────────
def report_out_of_sync():
    h1("SECTION 1 — adjustments whose stored remaining_impact != sum of their children")
    rows = frappe.db.sql(
        """SELECT name, po_id, status, remaining_impact, modified, modified_by
           FROM "tabPO Adjustments" ORDER BY po_id""",
        as_dict=True,
    )
    bad = []
    for r in rows:
        cs = child_sum(r["name"])
        if abs(flt(r["remaining_impact"]) - cs) > 0.02:
            r["child_sum"] = cs
            bad.append(r)

    print(f"\n  scanned {len(rows)} adjustments — {len(bad)} out of sync\n")
    for r in bad:
        print(f"    {r['po_id']}")
        print(f"      stored remaining_impact : {flt(r['remaining_impact']):>12,.2f}")
        print(f"      sum of child rows       : {r['child_sum']:>12,.2f}")
        print(f"      status                  : {r['status']}")
        print(f"      last modified by        : {r['modified_by']}  ({r['modified']})")
    return bad


# ── Section 2 ───────────────────────────────────────────────────────────────────
def report_repairs():
    h1("SECTION 2 — the two targeted repairs (this is ALL that --apply writes)")
    planned = []

    for spec in REPAIRS:
        po_id = spec["po_id"]
        h2(po_id)

        adj_name = frappe.db.get_value("PO Adjustments", {"po_id": po_id}, "name")
        if not adj_name:
            print("    !! no PO Adjustments doc found — SKIPPED")
            continue

        po = frappe.db.get_value(
            "Procurement Orders", po_id, ["total_amount", "amount_paid", "status"], as_dict=True
        )
        stored = flt(frappe.db.get_value("PO Adjustments", adj_name, "remaining_impact"))
        before = child_sum(adj_name)
        after = flt(before + flt(spec["amount"]), 2)

        st_b, lk_b = lock_state(stored)
        st_a, lk_a = lock_state(after)

        terms = frappe.db.sql(
            """SELECT idx, label, amount, term_status FROM "tabPO Payment Terms"
               WHERE parent=%s ORDER BY idx""",
            (po_id,),
            as_dict=True,
        )
        terms_total = flt(sum(flt(t["amount"]) for t in terms), 2)

        print(f"    PO total_amount   : {flt(po['total_amount']):>12,.2f}")
        print(f"    PO amount_paid    : {flt(po['amount_paid']):>12,.2f}   <- stored field, not recomputed")
        print(f"    payment terms sum : {terms_total:>12,.2f}  ({len(terms)} terms)")
        print(f"    real overpayment  : {max(0.0, flt(po['amount_paid']) - flt(po['total_amount'])):>12,.2f}")
        print()
        print("    existing ledger entries:")
        for it in frappe.db.sql(
            """SELECT idx, entry_type, amount, revision_id FROM "tabPO Adjustment Items"
               WHERE parent=%s ORDER BY idx""",
            (adj_name,),
            as_dict=True,
        ):
            print(f"      {it['idx']}. {it['entry_type']:<18} {flt(it['amount']):>12,.2f}   {it['revision_id'] or ''}")
        print()
        print("    WILL APPEND:")
        print(f"      +  {spec['entry_type']:<18} {flt(spec['amount']):>12,.2f}")
        print(f"         description : {spec['description']}")
        if spec.get("target_po"):
            print(f"         target_po   : {spec['target_po']}")
        if spec.get("project_payment"):
            print(f"         payment     : {spec['project_payment']}")
        print(f"         (no Project Payments row is created)")
        print()
        print(f"    remaining_impact : {stored:>12,.2f}  ->  {after:>12,.2f}")
        print(f"    status           : {st_b:<8}      ->  {st_a}")
        print(f"    lock             : {lk_b}  ->  {lk_a}")
        print()
        print(f"    reason: {spec['why']}")

        planned.append((adj_name, spec, stored, after))

    return planned


# ── Section 3 ───────────────────────────────────────────────────────────────────
def report_only_findings():
    h1("SECTION 3 — report only, NOT repaired here (each needs its own decision)")

    h2("3a. POs whose payment terms do not sum to total_amount")
    rows = frappe.db.sql(
        """SELECT p.name, p.total_amount, p.amount_paid, p.status,
                  (SELECT COALESCE(SUM(t.amount),0) FROM "tabPO Payment Terms" t
                    WHERE t.parent=p.name) AS terms_sum,
                  (SELECT COUNT(*) FROM "tabPO Payment Terms" t WHERE t.parent=p.name) AS n
           FROM "tabProcurement Orders" p""",
        as_dict=True,
    )
    drift = [
        r for r in rows
        if r["n"] and abs(flt(r["terms_sum"]) - flt(r["total_amount"])) > 1
    ]
    drift.sort(key=lambda r: -abs(flt(r["terms_sum"]) - flt(r["total_amount"])))
    print(f"\n    {len(drift)} of {len(rows)} POs drift. Top 10 by size:\n")
    for r in drift[:10]:
        d = flt(r["terms_sum"]) - flt(r["total_amount"])
        print(f"      {r['name']:<26} total={flt(r['total_amount']):>13,.2f} "
              f"terms={flt(r['terms_sum']):>13,.2f} drift={d:>13,.2f}")

    h2("3b. POs where amount_paid != SUM(Project Payments in status 'Paid')")
    rows = frappe.db.sql(
        """SELECT p.name, p.amount_paid,
                  COALESCE((SELECT SUM(pp.amount) FROM "tabProject Payments" pp
                     WHERE pp.document_type='Procurement Orders'
                       AND pp.document_name=p.name AND pp.status='Paid'),0) AS paid_sum
           FROM "tabProcurement Orders" p""",
        as_dict=True,
    )
    pd = [r for r in rows if abs(flt(r["amount_paid"]) - flt(r["paid_sum"])) > 1]
    approved_n = frappe.db.sql(
        """SELECT COUNT(*) FROM "tabProject Payments" WHERE status='Approved'"""
    )[0][0]
    print(f"\n    {len(pd)} of {len(rows)} POs drift.")
    print(f"    CAUSE: {approved_n} Project Payments sit in status 'Approved' (approved, not")
    print("    yet bank-settled). _recalculate_amount_paid sums status='Paid' ONLY, so it")
    print("    excludes them, while the stored amount_paid field already counts them.")
    print("    THIS COUNT IS VOLATILE — it tracks the Approved population, which the Bulk")
    print("    Import Outflow settle drains into 'Paid'. Measured this session at 585 and")
    print("    at 15 on the same site. The stored amount_paid field did NOT move.")
    print()
    print("    DESIGN CONSEQUENCE (load-bearing for the Step 4 cap): the overpayment cap")
    print("    MUST read the stored `amount_paid` field and MUST NOT recompute it from")
    print("    Paid payments — a recompute is wrong on these POs and would widen the cap,")
    print("    letting exactly the phantom liability this whole fix removes back in.")
    print("    Owner decision: leave these rows alone. The Section 2 repair creates no")
    print("    Project Payments row, so it cannot disturb them.\n")
    pd.sort(key=lambda r: -abs(flt(r["amount_paid"]) - flt(r["paid_sum"])))
    for r in pd[:5]:
        d = flt(r["amount_paid"]) - flt(r["paid_sum"])
        print(f"      {r['name']:<26} amount_paid={flt(r['amount_paid']):>13,.2f} "
              f"sum_Paid={flt(r['paid_sum']):>13,.2f} drift={d:>13,.2f}")

    h2("3c. term_status vocabulary in live data (the field is free-text Data, no options)")
    print()
    for r in frappe.db.sql(
        """SELECT term_status, COUNT(*) c FROM "tabPO Payment Terms"
           GROUP BY term_status ORDER BY c DESC""",
        as_dict=True,
    ):
        flag = ""
        if r["term_status"] not in ("Paid", "Created", "Return") + MID_APPROVAL:
            flag = "   <-- STRAY: matches no set in the code"
        print(f"      {str(r['term_status']):<16} {r['c']:>6}{flag}")

    h2("3d. LIVE EXPOSURE — POs one decrease-revision away from this bug")
    parents = frappe.db.sql(
        """SELECT DISTINCT parent FROM "tabPO Payment Terms" WHERE term_status IN %(s)s""",
        {"s": MID_APPROVAL},
    )
    at_risk = []
    for (p,) in parents:
        cap = flt(
            frappe.db.sql(
                """SELECT COALESCE(SUM(amount),0) FROM "tabPO Payment Terms"
                   WHERE parent=%s AND term_status='Created'""",
                (p,),
            )[0][0]
        )
        if cap <= 0.01:
            at_risk.append(p)
    print(f"\n      {len(parents)} POs hold a term in {MID_APPROVAL}")
    print(f"      {len(at_risk)} of those have ZERO 'Created' capacity")
    print("      -> a decrease revision on any of those produces a phantom lock TODAY.")
    print("      -> this is what the Step 3 block rule prevents.")


# ── Apply ───────────────────────────────────────────────────────────────────────
def apply_repairs(planned):
    h1("APPLYING — one transaction, rollback on any error")
    if not planned:
        print("\n  nothing to apply")
        return
    try:
        for adj_name, spec, stored, expected_after in planned:
            adj = frappe.get_doc("PO Adjustments", adj_name)
            row = {
                "entry_type": spec["entry_type"],
                "amount": flt(spec["amount"]),
                "description": spec["description"],
                "timestamp": frappe.utils.nowdate(),
            }
            for k in ("target_po", "project_payment"):
                if spec.get(k):
                    row[k] = spec[k]
            adj.append("adjustment_items", row)
            adj.recalculate_remaining_impact()  # recomputes from children, then saves

            fresh = flt(frappe.db.get_value("PO Adjustments", adj_name, "remaining_impact"))
            new_status = frappe.db.get_value("PO Adjustments", adj_name, "status")
            if abs(fresh - expected_after) > 0.02:
                raise ValueError(
                    f"{spec['po_id']}: expected {expected_after}, got {fresh} — aborting"
                )
            print(f"\n  {spec['po_id']}: remaining_impact {stored:,.2f} -> {fresh:,.2f}  status={new_status}")

        frappe.db.commit()
        print("\n  COMMITTED. No Project Payments rows were created.")
    except Exception as exc:
        frappe.db.rollback()
        print(f"\n  ROLLED BACK — {exc}")
        raise


def main():
    apply_mode = "--apply" in sys.argv
    frappe.init(site="localhost")
    frappe.connect()
    frappe.set_user("Administrator")

    print("\nPO ADJUSTMENTS — LEDGER INTEGRITY " + ("REPAIR (--apply)" if apply_mode else "REPORT (read-only)"))

    report_out_of_sync()
    planned = report_repairs()
    report_only_findings()

    if apply_mode:
        apply_repairs(planned)
    else:
        h1("REPORT MODE — nothing was written")
        print("\n  Re-run with --apply to perform ONLY the Section 2 repairs.")

    frappe.destroy()


if __name__ == "__main__":
    main()
