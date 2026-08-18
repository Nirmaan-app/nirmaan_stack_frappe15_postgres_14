"""Repair script — close the PO Payment Terms left open by the DUMMY-UTR payment backfill.

WHY THIS EXISTS
---------------
522 `Project Payments` carrying a UTR of the form `DUMMY-nnn` were inserted directly by
`Administrator` between 23-Jul-2024 and 28-Jun-2025 to record payments made before the
system existed. They were NOT created through `api/payments/project_payments.create_project_payment`,
which is the only code path that writes `PO Payment Terms.project_payment`.

Consequence: not one of the 522 is linked to a payment term. The status-sync hook
(`integrations/controllers/project_payments._find_and_update_po_term`) finds its term by
matching `term.project_payment == payment.name`, so with no link it can never fire, and the
term sat in `term_status = "Created"` forever — on a PO that was, in fact, fully paid.

That stale "Created" capacity is what the PO Adjustments module reads to decide how much a
PO can still absorb (`api/po_adjustments/_payment_utils._lock_and_assert_dest_capacity` and
`adjustment_logic.get_adjustment_candidate_pos` both sum `term_status = 'Created'`), which is
why settled POs kept being offered as adjustment destinations.

WHAT THIS SCRIPT DOES
---------------------
ONLY the A1 bucket: a PO whose Paid payments already equal its `total_amount` and which still
has open `Created` terms. For each, it sets the open term to `term_status = "Paid"`, links it
to that PO's dummy payment, and renames its `label` to "Dummy Payment".

The rename is what makes a repaired term legible on screen. The original labels were generic
("Payment Due", "Payment Done"), so after the repair nothing on the PO would say that this
term was settled by a backfilled record rather than by a bank transfer someone can trace. The
label is display-only — nothing in the app branches on it (checked: the credits list renders
it as a column, revision_logic quotes it inside a description string, and that is all) — so
renaming carries no behavioural risk, and the old value is kept in the receipt CSV.

A SECOND PASS relabels terms that an EARLIER run of this script already closed, back when it
wrote only status and link. That pass is defined by an unambiguous condition — the term links
to a DUMMY payment and is not yet called "Dummy Payment" — so it needs none of the bucket
logic, and it is self-cancelling: once everything is renamed it finds nothing.

It does NOT touch the B buckets (dummy double-counts a real payment) or C1 (dummy only partly
pays). Those need the dummy payment DELETED, which is a different operation with different
consequences (it moves `amount_paid` and re-triggers vendor-credit recalculation), and it gets
its own script.

It does NOT recalculate `amount_paid`. On an A1 PO that field is already correct by definition
— the bucket test IS `paid == total` — and the repair creates no payment, so nothing about the
money changed. This mirrors the deliberate restraint in `repair_po_adjustments.py`.

It writes with `frappe.db.set_value(..., update_modified=False)` on the child row, which is the
same mechanism `create_project_payment` uses (see its Step 5). Nothing loads or saves the
parent `Procurement Orders` document, so no PO controller, hook or validation fires, and no
PO's `modified` timestamp moves. The audit trail is the receipt CSV plus this script's stdout.

SAFETY
------
  * report mode is the DEFAULT; `--apply` is required to write anything
  * the bucket is RE-DERIVED from the live database on every run — there is no hard-coded
    PO list that could go stale between the survey and the repair
  * every PO must pass five guards (below) or it is SKIPPED and reported, never repaired
  * one transaction; each write is read back and verified; any surprise rolls the lot back
  * idempotent — a repaired PO has no open terms left, so it drops out of the bucket

RUNNING IT — PRODUCTION (preferred: `bench execute`)
----------------------------------------------------
`bench` resolves the bench path, the site and the database connection itself, so nothing in
this file has to know where it is running. This is the ONLY invocation that is portable
between the dev container and production. Run it from the bench directory:

    # 1. report. writes nothing.
    bench --site <site> execute nirmaan_stack.repair_dummy_payment_terms.run

    # 2. rehearse on five POs
    bench --site <site> execute nirmaan_stack.repair_dummy_payment_terms.run \
        --kwargs "{'apply': True, 'limit': 5}"

    # 3. the rest
    bench --site <site> execute nirmaan_stack.repair_dummy_payment_terms.run \
        --kwargs "{'apply': True, 'receipt': '/home/frappe/dummy_term_receipt.csv'}"

Take a database backup first — `bench --site <site> backup` — and keep the receipt CSV off
`/tmp`, which many hosts clear on reboot.

RUNNING IT — standalone (the dev container, where the host bench CLI is broken)
------------------------------------------------------------------------------
    docker cp nirmaan_stack/repair_dummy_payment_terms.py \
        frappe_docker_devcontainer-frappe-1:/tmp/repair_dummy_payment_terms.py
    docker exec -w /workspace/development/frappe-bench \
        frappe_docker_devcontainer-frappe-1 \
        env/bin/python /tmp/repair_dummy_payment_terms.py [--apply]
    docker cp frappe_docker_devcontainer-frappe-1:/tmp/dummy_term_repair_receipt.csv .

The standalone path needs a bench path and a site name, which are DEV defaults here; override
with `--bench <path>` and `--site <name>` if you use it anywhere else.

FLAGS (standalone) / KWARGS (bench execute)
-------------------------------------------
    --apply            / apply=True            perform the writes (default is report-only)
    --limit N          / limit=N               act on at most N POs — for a rehearsal run
    --po <PO name>     / po='PO/…' or [ … ]    act on specific POs only (flag is repeatable)
    --allow-mismatch   / allow_mismatch=True   also repair POs whose open capacity != the
                                               dummy amount (guard 5). Off by default; read
                                               the report before reaching for this.
    --receipt <path>   / receipt='<path>'      receipt CSV path
    --site <name>      standalone only — the site to connect to
    --bench <path>     standalone only — bench directory holding `sites/`
"""

import csv
import os
import sys

import frappe
from frappe.utils import flt


# Standalone-mode defaults ONLY. Under `bench execute` frappe is already initialised and
# connected, and neither of these is read — which is what makes this file importable in
# production, where the dev container's paths do not exist. Nothing at module scope may
# touch the filesystem or the database for the same reason.
DEFAULT_BENCH = "/workspace/development/frappe-bench"
DEFAULT_SITE = "localhost"

# Rupee tolerance for every money comparison in this script. Payment amounts are rounded to
# 2dp on write and the legacy rows carry sub-rupee dust, so an exact == would classify
# correct data as broken.
TOL = 1.0

# The dummy marker. Matched on the first five characters, upper-cased, so the comparison
# needs no LIKE and therefore no `%` escaping through frappe.db.sql's own formatting.
DUMMY_SQL = "LEFT(UPPER(COALESCE(pp.utr, '')), 5) = 'DUMMY'"

# What a repaired term is called afterwards. Every closed term gets this, so "which terms did
# the backfill settle?" is answerable by looking at the PO instead of by joining to the UTR.
DUMMY_TERM_LABEL = "Dummy Payment"

RECEIPT_DEFAULT = "/tmp/dummy_term_repair_receipt.csv"


# ── reporting helpers ───────────────────────────────────────────────────────────
def h1(text):
    print("\n" + "=" * 92)
    print(text)
    print("=" * 92)


def h2(text):
    print("\n--- " + text + " " + "-" * max(0, 84 - len(text)))


def money(v):
    return f"{flt(v):,.2f}"


# ── survey ──────────────────────────────────────────────────────────────────────
def load_dummy_pos():
    """Every PO carrying at least one DUMMY-UTR payment, with the figures the bucket needs.

    One query, no per-PO round trips — 522 POs would otherwise be 2,000+ reads.
    """
    return frappe.db.sql(
        """
        SELECT p.name AS po,
               p.total_amount,
               p.amount_paid AS stored_amount_paid,
               p.status AS po_status,
               COALESCE((SELECT SUM(pp.amount) FROM "tabProject Payments" pp
                          WHERE pp.document_type = 'Procurement Orders'
                            AND pp.document_name = p.name
                            AND pp.status = 'Paid'), 0) AS paid_sum,
               COALESCE((SELECT SUM(pp.amount) FROM "tabProject Payments" pp
                          WHERE pp.document_type = 'Procurement Orders'
                            AND pp.document_name = p.name
                            AND pp.status = 'Paid' AND """ + DUMMY_SQL + """), 0) AS dummy_amount,
               (SELECT COUNT(*) FROM "tabProject Payments" pp
                          WHERE pp.document_type = 'Procurement Orders'
                            AND pp.document_name = p.name
                            AND """ + DUMMY_SQL + """) AS dummy_count,
               (SELECT MIN(pp.name) FROM "tabProject Payments" pp
                          WHERE pp.document_type = 'Procurement Orders'
                            AND pp.document_name = p.name
                            AND """ + DUMMY_SQL + """) AS dummy_payment,
               (SELECT MIN(pp.utr) FROM "tabProject Payments" pp
                          WHERE pp.document_type = 'Procurement Orders'
                            AND pp.document_name = p.name
                            AND """ + DUMMY_SQL + """) AS dummy_utr,
               COALESCE((SELECT SUM(t.amount) FROM "tabPO Payment Terms" t
                          WHERE t.parent = p.name AND t.term_status = 'Created'), 0) AS open_amount,
               (SELECT COUNT(*) FROM "tabPO Payment Terms" t
                          WHERE t.parent = p.name AND t.term_status = 'Created') AS open_count
          FROM "tabProcurement Orders" p
         WHERE EXISTS (SELECT 1 FROM "tabProject Payments" pp
                        WHERE pp.document_type = 'Procurement Orders'
                          AND pp.document_name = p.name
                          AND """ + DUMMY_SQL + """)
         ORDER BY p.name
        """,
        as_dict=True,
    )


def bucket_of(row):
    """A1 / A2 / B1 / B2 / C1 — the SAME test the survey CSV used.

    Declared once, here, so the report and the writes can never describe different work.
    The comparison is money paid against what the PO is worth; everything else in this
    script hangs off that one line.
    """
    total = flt(row["total_amount"])
    paid = flt(row["paid_sum"])
    open_amt = flt(row["open_amount"])
    real_paid = paid - flt(row["dummy_amount"])

    if paid > total + TOL:
        return "B1" if real_paid >= total - TOL else "B2"
    if abs(paid - total) <= TOL:
        return "A1" if open_amt > TOL else "A2"
    return "C1"


def open_terms_of(po):
    """The `Created` term rows on one PO, oldest first."""
    return frappe.db.sql(
        """SELECT name, idx, label, amount, term_status, payment_type, project_payment
             FROM "tabPO Payment Terms"
            WHERE parent = %s AND term_status = 'Created'
            ORDER BY idx""",
        (po,),
        as_dict=True,
    )


# ── guards ──────────────────────────────────────────────────────────────────────
# A PO must clear every one of these or it is skipped. Each exists because the live data
# was checked for it; the counts in the comments are what the 2026-08-17 survey found.
def guard_failures(row, terms, allow_mismatch):
    """Return the list of reasons this PO must NOT be repaired. Empty list == safe."""
    problems = []

    # 1. Exactly one dummy payment, or the link is a guess. (measured: all 522 have exactly 1)
    if row["dummy_count"] != 1:
        problems.append(f"{row['dummy_count']} dummy payments on this PO — cannot choose the link")
    if not row["dummy_payment"]:
        problems.append("no dummy payment row resolved")

    # 2. There must be something to close.
    if not terms:
        problems.append("no open 'Created' terms")

    # 3. A negative open term is a Return/adjustment artefact, not an unpaid instalment.
    #    Stamping it "Paid" would assert money was received. (measured: 0 in A1)
    for t in terms:
        if flt(t["amount"]) < 0:
            problems.append(f"open term idx {t['idx']} is negative ({money(t['amount'])})")

    # 4. An open term that already carries a link belongs to some other payment; overwriting
    #    it would silently reassign that payment. (measured: 0 in A1)
    for t in terms:
        if (t["project_payment"] or "").strip():
            problems.append(
                f"open term idx {t['idx']} already links to {t['project_payment']}"
            )

    # 5. The open capacity should equal the dummy — that is what makes "this dummy paid this
    #    term" true rather than merely convenient. (measured: 491 of 492 match; the one that
    #    does not is PO/044/00052/25-26, open 2,801.96 against a dummy of 16,193.78, where the
    #    leftover term plainly belongs to something else.)
    if not allow_mismatch:
        gap = abs(flt(row["open_amount"]) - flt(row["dummy_amount"]))
        if gap > TOL:
            problems.append(
                f"open capacity {money(row['open_amount'])} != dummy {money(row['dummy_amount'])} "
                f"(gap {money(gap)})"
            )

    return problems


# ── plan ────────────────────────────────────────────────────────────────────────
def build_plan(only_pos, limit, allow_mismatch):
    """Survey the database and return (plan, skipped, bucket_counts).

    `plan` holds one entry per repairable PO; `skipped` one per PO that failed a guard.
    Nothing here writes.
    """
    rows = load_dummy_pos()
    counts = {}
    plan, skipped = [], []

    for row in rows:
        b = bucket_of(row)
        counts[b] = counts.get(b, 0) + 1

        if b != "A1":
            continue
        if only_pos and row["po"] not in only_pos:
            continue

        terms = open_terms_of(row["po"])
        problems = guard_failures(row, terms, allow_mismatch)
        if problems:
            skipped.append({"row": row, "terms": terms, "problems": problems})
            continue

        plan.append({"row": row, "terms": terms})

    if only_pos:
        found = {p["row"]["po"] for p in plan} | {s["row"]["po"] for s in skipped}
        for po in only_pos:
            if po not in found:
                print(f"  !! --po {po} is not an A1 case (or carries no dummy payment) — ignored")

    if limit is not None:
        plan = plan[:limit]

    return plan, skipped, counts


def build_relabel_plan(only_pos):
    """Terms an EARLIER run already closed, still carrying their original label.

    Selected purely on "links to a dummy payment and is not yet named DUMMY_TERM_LABEL", which
    is decidable from the row alone — no bucket, no guards, no reliance on the receipt of a
    previous run. `pp.document_name = t.parent` keeps it to same-PO links, so the three known
    cross-PO term links in this database cannot be dragged in by a widening of the condition.
    """
    rows = frappe.db.sql(
        """
        SELECT t.name, t.parent AS po, t.idx, t.label, t.amount, t.term_status,
               t.project_payment, pp.utr AS dummy_utr
          FROM "tabPO Payment Terms" t
          JOIN "tabProject Payments" pp ON pp.name = t.project_payment
         WHERE """ + DUMMY_SQL + """
           AND pp.document_type = 'Procurement Orders'
           AND pp.document_name = t.parent
           AND COALESCE(t.label, '') <> %s
         ORDER BY t.parent, t.idx
        """,
        (DUMMY_TERM_LABEL,),
        as_dict=True,
    )
    if only_pos:
        rows = [r for r in rows if r["po"] in only_pos]
    return rows


def report(plan, skipped, counts, relabel, apply_mode, allow_mismatch, limit):
    h1("DUMMY-UTR PAYMENT TERMS — " + ("REPAIR (--apply)" if apply_mode else "REPORT (read-only)"))

    h2("bucket census over every PO carrying a dummy payment")
    print()
    labels = {
        "A1": "settled exactly, terms still open   -> THIS SCRIPT repairs these",
        "A2": "settled exactly, terms already closed -> nothing to do",
        "B1": "overpaid, real payments alone cover it -> delete the dummy (other script)",
        "B2": "overpaid, real payments do not cover it -> delete the dummy (other script)",
        "C1": "under-paid, dummy only partly pays   -> delete the dummy (other script)",
    }
    for key in ("A1", "A2", "B1", "B2", "C1"):
        if key in counts:
            print(f"      {key}  {counts[key]:>4}   {labels[key]}")
    print(f"      {'':4}  {sum(counts.values()):>4}   total")

    if skipped:
        h2(f"SKIPPED — {len(skipped)} A1 PO(s) failed a guard and will NOT be touched")
        for s in skipped:
            print(f"\n    {s['row']['po']}")
            print(f"      total {money(s['row']['total_amount'])}   paid {money(s['row']['paid_sum'])}   "
                  f"dummy {money(s['row']['dummy_amount'])}   open {money(s['row']['open_amount'])}")
            for p in s["problems"]:
                print(f"      !! {p}")
        if not allow_mismatch:
            print("\n    (--allow-mismatch lifts guard 5 only. Read the figures above first.)")

    h2(f"PLANNED (close) — {len(plan)} PO(s)"
       + (f", capped by --limit {limit}" if limit is not None else ""))
    if not plan:
        print("\n    nothing to close")
    else:
        total_terms = sum(len(p["terms"]) for p in plan)
        total_amount = sum(flt(t["amount"]) for p in plan for t in p["terms"])
        print(f"\n    {total_terms} term row(s) will move 'Created' -> 'Paid', gain a payment link,")
        print(f"    and be renamed to '{DUMMY_TERM_LABEL}' — covering {money(total_amount)}\n")
        print(f"    {'PO':<26} {'term':>5} {'amount':>15}  {'old label':<24} -> link")
        for p in plan:
            for t in p["terms"]:
                print(f"    {p['row']['po']:<26} {t['idx']:>5} {money(t['amount']):>15}  "
                      f"{str(t['label'] or '')[:24]:<24} -> {p['row']['dummy_payment']} "
                      f"({p['row']['dummy_utr']})")

    h2(f"PLANNED (rename only) — {len(relabel)} term(s) closed by an earlier run")
    if not relabel:
        print(f"\n    nothing to rename — every dummy-linked term already reads '{DUMMY_TERM_LABEL}'")
        return
    print(f"\n    label -> '{DUMMY_TERM_LABEL}'. Status and link are NOT touched.\n")
    from collections import Counter
    for old, n in Counter(str(r["label"] or "(blank)") for r in relabel).most_common():
        print(f"      {old:<40} {n:>5} term(s)")
    print(f"\n    {'PO':<26} {'term':>5} {'amount':>15}  {'old label':<24}  status")
    for r in relabel[:15]:
        print(f"    {r['po']:<26} {r['idx']:>5} {money(r['amount']):>15}  "
              f"{str(r['label'] or '')[:24]:<24}  {r['term_status']}")
    if len(relabel) > 15:
        print(f"    ... and {len(relabel) - 15} more")


# ── apply ───────────────────────────────────────────────────────────────────────
def apply_plan(plan, relabel, receipt_path):
    h1("APPLYING — one transaction, rollback on any surprise")
    if not plan and not relabel:
        print("\n  nothing to apply")
        return

    receipt_rows = []
    closed = renamed = 0
    try:
        for p in plan:
            row, terms = p["row"], p["terms"]
            payment = row["dummy_payment"]

            for t in terms:
                # Status and link are the same two fields, written the same way, as
                # api/payments/project_payments.create_project_payment Step 5. The label is
                # this script's own addition — display only, nothing branches on it.
                # update_modified=False: the child row is the whole change, and bumping
                # timestamps on 490+ rows would churn every "recently modified" view in
                # the app for a repair that moves no money.
                frappe.db.set_value(
                    "PO Payment Terms",
                    t["name"],
                    {
                        "term_status": "Paid",
                        "project_payment": payment,
                        "label": DUMMY_TERM_LABEL,
                    },
                    update_modified=False,
                )

                # Read it back. A silent no-op write is the failure mode worth catching:
                # it would leave the report claiming work that never happened.
                fresh = frappe.db.get_value(
                    "PO Payment Terms", t["name"],
                    ["term_status", "project_payment", "label"], as_dict=True
                )
                if (not fresh or fresh["term_status"] != "Paid"
                        or fresh["project_payment"] != payment
                        or fresh["label"] != DUMMY_TERM_LABEL):
                    raise ValueError(
                        f"{row['po']} term idx {t['idx']} ({t['name']}): expected "
                        f"Paid/{payment}/{DUMMY_TERM_LABEL}, read back {fresh} — aborting"
                    )

                receipt_rows.append({
                    "operation": "close+rename",
                    "po": row["po"],
                    "term_row_name": t["name"],
                    "term_idx": t["idx"],
                    "term_amount": f"{flt(t['amount']):.2f}",
                    "old_label": t["label"],
                    "new_label": DUMMY_TERM_LABEL,
                    "old_term_status": t["term_status"],
                    "new_term_status": "Paid",
                    "old_project_payment": t["project_payment"] or "",
                    "new_project_payment": payment,
                    "dummy_utr": row["dummy_utr"],
                    "dummy_amount": f"{flt(row['dummy_amount']):.2f}",
                    "po_total_amount": f"{flt(row['total_amount']):.2f}",
                    "po_paid_sum": f"{flt(row['paid_sum']):.2f}",
                })
                closed += 1

            print(f"  {row['po']:<26} {len(terms)} term(s) closed -> {payment}")

        # ── rename pass: terms an earlier run closed before the label was part of the fix ──
        for r in relabel:
            frappe.db.set_value(
                "PO Payment Terms", r["name"], {"label": DUMMY_TERM_LABEL},
                update_modified=False,
            )
            fresh = frappe.db.get_value("PO Payment Terms", r["name"], "label")
            if fresh != DUMMY_TERM_LABEL:
                raise ValueError(
                    f"{r['po']} term idx {r['idx']} ({r['name']}): label read back as "
                    f"{fresh!r} — aborting"
                )
            receipt_rows.append({
                "operation": "rename",
                "po": r["po"],
                "term_row_name": r["name"],
                "term_idx": r["idx"],
                "term_amount": f"{flt(r['amount']):.2f}",
                "old_label": r["label"],
                "new_label": DUMMY_TERM_LABEL,
                # status and link are untouched on this path — recorded so the receipt
                # reads the same shape for both operations.
                "old_term_status": r["term_status"],
                "new_term_status": r["term_status"],
                "old_project_payment": r["project_payment"] or "",
                "new_project_payment": r["project_payment"] or "",
                "dummy_utr": r["dummy_utr"],
                "dummy_amount": "",
                "po_total_amount": "",
                "po_paid_sum": "",
            })
            renamed += 1
        if renamed:
            print(f"\n  renamed {renamed} term(s) closed by an earlier run")

        frappe.db.commit()
        print(f"\n  COMMITTED. {closed} term(s) closed across {len(plan)} PO(s); "
              f"{renamed} renamed only.")
        print("  No Project Payments were created, deleted or edited. amount_paid untouched.")
    except Exception as exc:
        frappe.db.rollback()
        print(f"\n  ROLLED BACK — nothing was written. {exc}")
        raise

    write_receipt(receipt_path, receipt_rows)
    verify_after(plan)


def write_receipt(path, rows):
    """Every field's old value, so a human can reverse this without re-deriving anything."""
    if not rows:
        return
    try:
        with open(path, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        print(f"  receipt written: {path} ({len(rows)} rows)")
    except Exception as exc:  # a lost receipt must not read as a failed repair
        print(f"  !! receipt could NOT be written to {path}: {exc}")
        print("  !! the repair IS committed — the change list above is the record.")


def verify_after(plan):
    """Re-read the repaired POs and confirm each now reports zero open capacity."""
    h2("post-commit verification")
    bad = []
    for p in plan:
        po = p["row"]["po"]
        cap = flt(frappe.db.sql(
            """SELECT COALESCE(SUM(amount), 0) FROM "tabPO Payment Terms"
                WHERE parent = %s AND term_status = 'Created'""",
            (po,),
        )[0][0])
        if cap > TOL:
            bad.append((po, cap))
    print(f"\n    {len(plan)} PO(s) checked — {len(bad)} still report open 'Created' capacity")
    for po, cap in bad[:20]:
        print(f"      {po:<26} {money(cap)}   (expected: a PO with more than one open term)")


# ── entry ───────────────────────────────────────────────────────────────────────
def run(apply=False, limit=None, po=None, allow_mismatch=False, receipt=RECEIPT_DEFAULT):
    """THE entry point. Assumes frappe is already initialised and connected.

    This is what `bench --site <site> execute nirmaan_stack.repair_dummy_payment_terms.run`
    calls, and it is also what standalone `main()` calls once it has done its own init. One
    body, so the dev container and production can never run different logic.

    `apply` is named to read correctly as a kwarg (`apply=True`); it shadows the builtin
    inside this function only, which nothing here uses.
    """
    only_pos = []
    if po:
        only_pos = [po] if isinstance(po, str) else list(po)

    limit = int(limit) if limit not in (None, "") else None

    plan, skipped, counts = build_plan(only_pos, limit, allow_mismatch)
    relabel = build_relabel_plan(only_pos)
    report(plan, skipped, counts, relabel, apply, allow_mismatch, limit)

    if apply:
        apply_plan(plan, relabel, receipt)
    else:
        h1("REPORT MODE — nothing was written")
        print("\n  Re-run with apply=True / --apply to perform the plan above.")
        print("  Rehearse first:  limit=5")

    return {
        "closed_pos": len(plan),
        "closed_terms": sum(len(p["terms"]) for p in plan),
        "renamed_terms": len(relabel),
        "skipped_pos": len(skipped),
        "buckets": counts,
        "applied": bool(apply),
    }


def parse_args(argv):
    """Standalone flag parsing. `bench execute` does not come through here."""
    opts = {
        "apply": "--apply" in argv,
        "allow_mismatch": "--allow-mismatch" in argv,
        "limit": None,
        "receipt": RECEIPT_DEFAULT,
        "po": [],
    }
    site, bench_path = DEFAULT_SITE, DEFAULT_BENCH

    i = 0
    while i < len(argv):
        if argv[i] == "--limit" and i + 1 < len(argv):
            opts["limit"] = int(argv[i + 1]); i += 1
        elif argv[i] == "--po" and i + 1 < len(argv):
            opts["po"].append(argv[i + 1]); i += 1
        elif argv[i] == "--receipt" and i + 1 < len(argv):
            opts["receipt"] = argv[i + 1]; i += 1
        elif argv[i] == "--site" and i + 1 < len(argv):
            site = argv[i + 1]; i += 1
        elif argv[i] == "--bench" and i + 1 < len(argv):
            bench_path = argv[i + 1]; i += 1
        i += 1

    return opts, site, bench_path


def main():
    opts, site, bench_path = parse_args(sys.argv[1:])

    # frappe.init() resolves site config relative to the CURRENT directory, so the chdir has
    # to happen here — never at import time, or this module could not be imported at all on a
    # host where that path does not exist (i.e. production, under `bench execute`).
    sites_dir = os.path.join(bench_path, "sites")
    if not os.path.isdir(sites_dir):
        sys.exit(f"no sites directory at {sites_dir} — pass --bench <path to your bench>")
    os.chdir(sites_dir)

    frappe.init(site=site)
    frappe.connect()
    frappe.set_user("Administrator")
    try:
        run(**opts)
    finally:
        frappe.destroy()


if __name__ == "__main__":
    main()
