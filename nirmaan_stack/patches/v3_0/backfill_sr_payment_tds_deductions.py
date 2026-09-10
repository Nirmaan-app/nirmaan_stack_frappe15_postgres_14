# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Move Service Request TDS onto `Payment TDS Deduction`, and re-derive the orders' totals.

`services/payment_tds.py` now records a deduction the moment an SR payment reaches `Approved`, and
nets the payment's `amount` in the same breath. Everything that happened BEFORE that shipped is
outside it. This patch closes both ends of that window, in one pass, then repairs the parents.

    PHASE A -- A FIGURE ALREADY EXISTS.  Paid or Approved SR payments carrying a real value in the
                         legacy `Project Payments.tds` column. That value IS the tax; it is used
                         verbatim and never recomputed, whatever the payment's status.
    PHASE B -- NOTHING EXISTS YET.  `Approved` SR payments with no deduction row AND no stored tds
                         -- approved before the hook existed. The tax comes FROM THE VENDOR'S RATE.

    PHASE C -- THE PARENTS.  Re-derive `amount_paid`, `total_tds` and `amount_due` on every Service
                         Request either phase touched.

`Requested` / `CEO Pending` payments are deliberately untouched: nothing is committed yet, and the
live hook records their deduction the moment they reach `Approved`.

⚠️ WHY HISTORY MUST NOT USE THE VENDOR'S RATE (measured 2026-09-10, do not re-derive).
Of 625 historical deductions, **537 were taken at 1%** and 64 at 2%, with two dozen at odd rates
(1.70%, 5.96%, 7.69%). The vendor master today says 2% for 1,105 of 1,106 vendors. Recomputing
history from it would restate **1,262 of 1,332** real deductions into figures nobody withheld. The
stored value is the only record of what actually happened, so `tds_percentage` is DERIVED BACKWARDS
from it (`tds / amount * 100`) rather than read forwards from the vendor (owner ruling).

⚠️ NETTING THE AMOUNT IS NOT AN EXTRA STEP -- IT IS THE SAME STEP. `Service Requests.amount_due` is
`total_amount - amount_paid - total_tds`, and `amount_paid` sums payment `amount`s. Insert the
deduction row but leave the payment gross and the tax lands in BOTH terms: all 253 orders would
report themselves short by exactly their own TDS. Phase A and Phase C are therefore inseparable --
running the inserts without the recompute leaves the database in the state this warning describes.

⚠️ HOOKS DO NOT FIRE HERE, WHICH IS WHY PHASE C EXISTS. `db_set` / `set_value` write the column
directly and run no `doc_events`, so nothing recomputes the parent on its own. Phase C calls the
same recompute the live path uses, so the two can never disagree about how a total is derived.

WHAT THIS PATCH DOES NOT TOUCH
------------------------------
* **`Project Payments.tds` is LEFT POPULATED** (owner ruling 2026-09-10 -- it is cleared later, with
  the Procurement Order side, in one deliberate sweep). ⚠️ CONSEQUENCE, STATED SO IT IS NOT A
  SURPRISE: a legacy payment ends up with a NET `amount` and a still-populated `tds`, so anything
  that displays `amount - tds` shows the tax subtracted twice --
  `frontend/src/pages/ProjectPayments/AmountPaidHoverCard.tsx` is exactly that, and its
  Service-Request guard is currently commented out. Restore that guard or this patch will make the
  hover wrong for 625 payments.
* **`Procurement Orders`** and their payments: excluded by the `document_type` filter. 3,695 Paid PO
  payments carry a legacy `tds`; POs have no `total_tds` column and their `amount_due` formula is
  unchanged, so touching them here would break what this fixes for SRs.
* **`modified` / `modified_by`** on any payment: `update_modified=False` throughout.
* **`Version` rows, notifications, `doc_events`**: none, by construction.

IDEMPOTENT. Both phases select only payments with NO deduction row, `write_deduction` returns early
if one appears anyway, and `Payment TDS Deduction.project_payment` is UNIQUE. A re-run writes
nothing -- which is also what makes it impossible to net an amount twice.

THE ASSERTION THAT PROVES IT WORKED: `amount_due` must be UNCHANGED on every SR. `amount_paid` falls
by the order's tax and `total_tds` rises by the same, so `total - paid - tds` lands where
`total - paid` was. Phase C reports every order where it moved; that list should be empty.
"""

import frappe
from frappe.utils import flt

from nirmaan_stack.services import payment_tds

SR = payment_tds.SERVICE_REQUEST_DOCTYPE
PAYMENT = payment_tds.PAYMENT_DOCTYPE

#: A plain decimal. `Project Payments.tds` is a Data column, so a CAST is only safe behind this --
#: one junk value would abort the whole migrate rather than skip a row. Measured 0 offenders here,
#: but a patch runs on databases this one has never seen.
_NUMERIC = r"^[0-9]+(\.[0-9]+)?$"


def _carrying_stored_tds() -> list[dict]:
	"""PHASE A candidates: SR payments whose legacy `tds` column already holds a real figure.

	⚠️ SELECTED BY WHAT THE RECORD KNOWS, NOT BY ITS STATUS. A stored `tds` is a decision somebody
	already made about this payment, and it wins over the vendor's current rate whatever state the
	payment is in -- an `Approved` payment carrying one must NOT be recomputed at 2% by Phase B.
	Today no such row exists on this database, but the combination is perfectly legal and a patch
	runs on databases this one has never seen.

	`Paid` and `Approved` only. A `Requested` or `CEO Pending` payment is not yet committed and
	needs nothing from this patch: when it is approved the live hook fires and records the
	deduction itself.
	"""
	return frappe.db.sql(
		f"""
		SELECT p.name, p.amount, p.tds, p.document_name, p.status,
		       COALESCE(p.ceo_approval_date, p.approval_date, p.payment_date) AS decided_on
		FROM "tabProject Payments" p
		LEFT JOIN "tabPayment TDS Deduction" d ON d.project_payment = p.name
		WHERE p.document_type = %s
		  AND p.status IN ('Paid', 'Approved')
		  AND d.name IS NULL
		  AND p.tds IS NOT NULL
		  AND btrim(p.tds) ~ '{_NUMERIC}'
		  AND CAST(btrim(p.tds) AS numeric) > 0
		  AND COALESCE(p.amount, 0) > 0
		ORDER BY p.name
		""",
		(SR,),
		as_dict=True,
	)


def _open_approved() -> list[dict]:
	"""PHASE B candidates: `Approved` SR payments the hook never saw AND that carry no stored tds.

	The stored-tds exclusion is what keeps the two phases disjoint: a payment holding a figure
	somebody already decided belongs to Phase A, which uses that figure verbatim.
	"""
	return frappe.db.sql(
		"""
		SELECT p.name, p.document_name,
		       COALESCE(p.ceo_approval_date, p.approval_date, p.payment_date) AS decided_on
		FROM "tabProject Payments" p
		LEFT JOIN "tabPayment TDS Deduction" d ON d.project_payment = p.name
		WHERE p.document_type = %s
		  AND p.status = %s
		  AND d.name IS NULL
		  AND NOT (p.tds IS NOT NULL
		           AND btrim(p.tds) ~ '{_NUMERIC}'
		           AND CAST(btrim(p.tds) AS numeric) > 0)
		ORDER BY p.name
		""".replace("{_NUMERIC}", _NUMERIC),
		(SR, payment_tds.APPROVED),
		as_dict=True,
	)


def _stamp_as_of(deduction: str, when) -> None:
	"""Backdate the deduction row's `creation` / `modified` to the day it was decided.

	⚠️ A DELIBERATE DEPARTURE FROM WHAT THOSE FIELDS NORMALLY MEAN (owner ruling 2026-09-10). They
	usually answer "when did this row enter the database"; here they are made to answer "when was
	this deduction taken", because from a reviewer's side the record exists BECAUSE the payment was
	approved -- 628 records all stamped with the migration date would read as an import artefact
	rather than as the history they describe. `deducted_on` carries the same date, so the three
	agree instead of one contradicting the other two.

	⚠️ THE NAME CANNOT FOLLOW. `autoname` is `PTD-.YY.-.#####` and `YY` is resolved at insert, so a
	2025 deduction is still named `PTD-26-…`. Nothing can backdate a naming series; the name is
	opaque and the dates are what a reader goes by.

	⚠️ MIDNIGHT, because the source is a Date. `approval_date` has no clock, so no time of day can
	be recovered -- inventing one would be a fabrication on top of a backdating.

	Raw SQL: `creation` is not writable through the document layer, and `set_value` would stamp
	`modified` again on its way past.
	"""
	if not when:
		return
	frappe.db.sql(
		"""UPDATE "tabPayment TDS Deduction" SET creation = %s, modified = %s WHERE name = %s""",
		(when, when, deduction),
	)


def _snapshot(srs: list[str]) -> dict:
	if not srs:
		return {}
	rows = frappe.db.sql(
		"""SELECT name, COALESCE(total_amount,0) t, COALESCE(amount_paid,0) p,
		          COALESCE(total_tds,0) d, COALESCE(amount_due,0) due
		   FROM "tabService Requests" WHERE name IN %(n)s""",
		{"n": tuple(srs)},
		as_dict=True,
	)
	return {r["name"]: r for r in rows}


def execute():
	legacy, approved = _carrying_stored_tds(), _open_approved()
	touched_srs = sorted({r["document_name"] for r in legacy} | {r["document_name"] for r in approved})

	print(
		f"SR TDS backfill: {len(legacy)} historical payment(s), {len(approved)} open approved, "
		f"{len(touched_srs)} order(s) to re-derive."
	)
	if not legacy and not approved:
		return

	before = _snapshot(touched_srs)
	written = failed = skipped = 0

	# ---- PHASE A: history — the figure that was actually withheld ------------------------------
	for row in legacy:
		gross, tds = flt(row["amount"]), flt(row["tds"])
		# Derived BACKWARDS from what happened, not forwards from the vendor. See the module note.
		pct = flt(gross and (tds / gross * 100.0), 2)
		try:
			frappe.db.savepoint("sr_tds_legacy")
			doc = frappe.get_doc(PAYMENT, row["name"])
			name = payment_tds.write_deduction(
				doc,
				tds_amount=tds,
				tds_percentage=pct,
				# THE DAY THE PAYMENT WAS APPROVED -- that is when the deduction is decided,
				# which is exactly what the live hook records. Not the day this patch ran, and
				# not the day the money later moved (they differ on 117 of the 625).
				# `ceo_approval_date` first, mirroring `ledgers.DECIDED_ON_SQL`; `approval_date`
				# next; `payment_date` only as a last resort for the 7 rows carrying neither.
				deducted_on=row["decided_on"],
				update_modified=False,
			)
		except Exception:
			frappe.db.rollback(save_point="sr_tds_legacy")
			frappe.log_error(frappe.get_traceback(), f"SR TDS backfill (history) failed: {row['name']}")
			failed += 1
			continue
		if name:
			_stamp_as_of(name, row["decided_on"])
		frappe.db.release_savepoint("sr_tds_legacy")
		written += 1 if name else 0
		skipped += 0 if name else 1

	# ---- PHASE B: the open edge — the vendor's current rate ------------------------------------
	for row in approved:
		try:
			frappe.db.savepoint("sr_tds_open")
			doc = frappe.get_doc(PAYMENT, row["name"])
			name = (
				payment_tds.record_deduction(
					doc, deducted_on=row["decided_on"], update_modified=False
				)
				if payment_tds.is_deductible(doc)
				else None
			)
		except Exception:
			frappe.db.rollback(save_point="sr_tds_open")
			frappe.log_error(frappe.get_traceback(), f"SR TDS backfill (approved) failed: {row['name']}")
			failed += 1
			continue
		if name:
			_stamp_as_of(name, row["decided_on"])
		frappe.db.release_savepoint("sr_tds_open")
		written += 1 if name else 0
		skipped += 0 if name else 1

	# ---- PHASE C: re-derive the parents --------------------------------------------------------
	# One payment per order drives it; `update_parent_amount_paid` re-reads every sibling itself and
	# chains amount_paid -> total_tds -> amount_due in the order the live path uses.
	for sr in touched_srs:
		driver = frappe.db.get_value(PAYMENT, {"document_type": SR, "document_name": sr}, "name")
		if not driver:
			continue
		try:
			frappe.get_doc(PAYMENT, driver).update_parent_amount_paid()
		except Exception:
			frappe.log_error(frappe.get_traceback(), f"SR TDS backfill (recompute) failed: {sr}")
			failed += 1

	frappe.db.commit()

	# ---- The proof -----------------------------------------------------------------------------
	after = _snapshot(touched_srs)
	moved, stale, paid_shift, tds_shift = [], [], 0.0, 0.0
	for sr, b in before.items():
		a = after.get(sr)
		if not a:
			continue
		paid_shift += flt(a["p"]) - flt(b["p"])
		tds_shift += flt(a["d"]) - flt(b["d"])

		# ⚠️ MEASURED AGAINST THE DERIVED BEFORE, NOT THE STORED ONE -- the same distinction
		# `dry_run` makes, and the two must agree or the rehearsal proves nothing about the run.
		# An order whose stored `amount_due` was already stale would otherwise be reported as
		# "the patch moved it", sending a reader hunting for a defect that is not there.
		due_before_derived = flt(b["t"]) - flt(b["p"]) - flt(b["d"])
		if abs(flt(a["due"]) - due_before_derived) > 0.01:
			moved.append((sr, due_before_derived, flt(a["due"])))
		if abs(flt(b["due"]) - due_before_derived) > 0.01:
			stale.append((sr, flt(b["due"]), flt(a["due"])))

	print(
		f"  recorded {written}, skipped {skipped}, failed {failed}\n"
		f"  amount_paid moved {paid_shift:+,.2f} | total_tds moved {tds_shift:+,.2f} "
		f"(these must be equal and opposite)"
	)
	if moved:
		print(f"  ⚠️ amount_due MOVED on {len(moved)} order(s) — investigate before trusting the totals:")
		for sr, b, a in moved[:20]:
			print(f"     {sr}: {b:,.2f} -> {a:,.2f}")
	else:
		print("  amount_due unchanged on every order, as required.")
	if stale:
		print(f"  NOTE: {len(stale)} order(s) carried a STALE amount_due beforehand — unrelated to")
		print("  this patch; the recompute corrected them as a side effect:")
		for sr, b, a in stale[:10]:
			print(f"     {sr}: stored {b:,.2f} -> {a:,.2f}")


def dry_run():
	"""Report exactly what `execute()` would change, writing NOTHING.

	    bench --site <site> execute nirmaan_stack.patches.v3_0.backfill_sr_payment_tds_deductions.dry_run

	⚠️ A SEPARATE FUNCTION RATHER THAN AN `execute(dry_run=True)` FLAG, DELIBERATELY. Frappe calls
	`execute()` with no arguments, so a defaulted flag is one typo away from a patch that silently
	does nothing on every migrate and reports success.
	"""
	legacy, approved = _carrying_stored_tds(), _open_approved()
	srs = sorted({r["document_name"] for r in legacy} | {r["document_name"] for r in approved})
	before = _snapshot(srs)

	# Only PAID payments move a parent total -- an Approved one is absent from amount_paid and
	# total_tds alike, so Phase B shifts nothing.
	shift: dict[str, float] = {}
	for r in legacy:
		if r["status"] == "Paid":
			shift[r["document_name"]] = shift.get(r["document_name"], 0.0) + flt(r["tds"])

	print(f"\n=== PHASE A — stored figure wins ({len(legacy)} payment(s)) ===")
	print(f"{'payment':<20}{'status':<10}{'gross':>13}{'tds':>11}{'pct':>7}{'net':>13}  deducted_on")
	for r in legacy[:10]:
		g, t = flt(r["amount"]), flt(r["tds"])
		print(f"{r['name']:<20}{r['status']:<10}{g:>13,.2f}{t:>11,.2f}"
		      f"{(t / g * 100 if g else 0):>7.2f}{g - t:>13,.2f}  {r['decided_on']}")
	if len(legacy) > 10:
		print(f"  ... and {len(legacy) - 10} more")

	print(f"\n=== PHASE B — vendor rate ({len(approved)} payment(s)) ===")
	for r in approved:
		doc = frappe.get_doc(PAYMENT, r["name"])
		rate = payment_tds.vendor_rate(doc.get("vendor"))
		g = flt(doc.get("amount"))
		t = flt(g * (rate or 0) / 100.0, 2)
		print(f"{r['name']:<20}{'Approved':<10}{g:>13,.2f}{t:>11,.2f}{(rate or 0):>7.2f}{g - t:>13,.2f}"
		      f"  {r['decided_on']}")

	print(f"\n=== PHASE C — orders re-derived ({len(srs)}) ===")
	print(f"{'service request':<24}{'total':>13}{'paid':>13}{'->':>13}{'tds':>11}{'due':>12}{'due after':>12}")
	moved = 0
	stale: list[tuple] = []
	for sr in srs:
		b = before.get(sr)
		if not b:
			continue
		d = shift.get(sr, 0.0)
		paid_after, tds_after = flt(b["p"]) - d, flt(b["d"]) + d
		due_after = flt(b["t"]) - paid_after - tds_after
		# ⚠️ COMPARED AGAINST THE DERIVED BEFORE, NOT THE STORED `amount_due`. An order whose stored
		# value is already stale (never seeded, or drifted) would otherwise be reported as "the
		# patch moved it", which sends someone hunting for a defect in the patch instead of a stale
		# row. The question here is only ever: does re-deriving with the tax land where re-deriving
		# WITHOUT it landed?
		due_before_derived = flt(b["t"]) - flt(b["p"]) - flt(b["d"])
		if abs(due_after - due_before_derived) > 0.01:
			moved += 1
		if abs(flt(b["due"]) - due_before_derived) > 0.01:
			stale.append((sr, flt(b["due"]), due_before_derived))
		if len([1 for x in srs[:8] if x == sr]):
			print(f"{sr:<24}{flt(b['t']):>13,.2f}{flt(b['p']):>13,.2f}{paid_after:>13,.2f}"
			      f"{tds_after:>11,.2f}{flt(b['due']):>12,.2f}{due_after:>12,.2f}")
	if len(srs) > 8:
		print(f"  ... and {len(srs) - 8} more")

	total = sum(shift.values())
	print(f"\n=== TOTALS ===")
	print(f"  amount_paid across all orders : -{total:,.2f}")
	print(f"  total_tds   across all orders : +{total:,.2f}")
	print(f"  orders whose amount_due would MOVE: {moved}   (must be 0)")
	if stale:
		print(f"\n  NOTE: {len(stale)} order(s) already carry a STALE amount_due — unrelated to this")
		print("  patch, but the recompute will correct them as a side effect:")
		for sr, stored, derived in stale[:10]:
			print(f"     {sr}: stored {stored:,.2f} -> correct {derived:,.2f}")
	print("\n  DRY RUN — nothing was written.")
