# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Tax withheld from a Service Request payment — WHEN, at WHAT RATE, and the parent's running total.

⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE**. This repo ALSO uses "TDS" for **TECHNICAL DATA SHEET**
(`TDS Items`, `TDS Repository`, `Project TDS Item List`, `Project TDS Setting` — work packages,
makes, Verified/Not Verified, consultant logos). Same three letters, unrelated concepts, different
owners. A grep for `tds` lands on both families and they must never be reconciled with each other.
The same warning is already written into `Vendors.tds_deduction_percentage`'s own description.

THE SPINE
---------
A deduction is recorded when a payment REACHES `Approved`, from its vendor's rate, and is never
recomputed afterwards. Two consequences follow and both are load-bearing:

  * The RATE IS SNAPSHOTTED onto the row. `Vendors.tds_deduction_percentage` is editable (1,105 of
    1,106 vendors sit at 2%, one at 3%), and a historical deduction that re-read the vendor would
    silently restate itself the day someone edits it.
  * `Project Payments.amount` IS REWRITTEN TO THE NET FIGURE (owner ruling 2026-09-10). The stored
    amount becomes what actually leaves the bank -- see the block below.

⚠️ THE AMOUNT IS REWRITTEN, AND THE `amount_due` FORMULA HAD TO MOVE WITH IT. ONE CHANGE, NOT TWO.
The owner's worked case: `PAY-00103-283`, Rs 38,550 at 2% -> Rs 771.00 withheld -> the payment
amount becomes **Rs 37,779.00**. The gross figure is not lost -- it is kept on the deduction row as
`gross_amount`, which is what makes the rewrite auditable and reversible.

`Service Requests.amount_due` was `total_amount - amount_paid`, and `amount_paid` is the SUM of Paid
payment `amount`s. Left alone, storing the net figure would leave every fully-settled SR reading the
withheld tax as permanently outstanding -- a Rs 38,550 SR paid net-37,779 showing Rs 771 still due
with nothing left to pay it. Measured 2026-09-10 under the old arrangement: **700 SRs satisfy
`amount_paid == total_amount`**. So `_AMOUNT_DUE_OPERANDS["Service Requests"]` now subtracts BOTH
`amount_paid` AND `total_tds`. Neither half of this is correct without the other.

⚠️ THOSE 700 ARE NOT DISTURBED, AND THE REASON IS WHAT MAKES THIS SAFE TO SHIP BEFORE THE BACKFILL:
every legacy SR has `total_tds = 0`, because no `Payment TDS Deduction` row exists for any of them.
Subtracting zero subtracts nothing, so their `amount_due` is arithmetically unchanged. ⚠️ THE DAY
THE BACKFILL RUNS THAT STOPS BEING TRUE -- a backfilled SR gains a real `total_tds`, and unless the
same pass ALSO rewrites its payments to net, the tax is subtracted twice and every one of those 623
SRs reads short by its own TDS. The backfill is not a data copy; it is this same change applied
backwards.

⚠️ THE REWRITE HAPPENS AT MOST ONCE, guarded by the deduction row's existence: `record_deduction`
returns early when a row is already there, so a re-saved approved payment can never be reduced
twice, with the UNIQUE constraint on `project_payment` as the hard floor under that. An amount
EDITED after approval is out of scope -- the deduction is not recomputed, and correcting one needs
a reversal path that does not exist yet.

SCOPE, AND WHAT IS DELIBERATELY NOT HERE
----------------------------------------
`Service Requests` ONLY (owner scope, 2026-09-10). `Procurement Orders` payments are untouched by
this module even though 3,695 Paid PO payments carry a figure in the legacy `Project Payments.tds`
column -- widening to POs is a scope decision, not a refactor, and `Procurement Orders` has no
`total_tds` field to receive the total.

NOT here, and each absence is deliberate:
  * No BACKFILL. 1,331 Paid SR payments carry legacy `tds` totalling Rs 6,34,002 across 623 SRs and
    NONE of them has a `Payment TDS Deduction` row, so `total_tds` reads 0 for those SRs. Deferred
    by the owner until the forward path is proven. Until it runs, `total_tds` describes only
    payments approved after this shipped.
  * No REVERSAL STATUS, by owner ruling 2026-09-10. An earlier draft carried a `Deducted/Reversed`
    Select; there is no reversal, so a deduction is simply DELETED with the payment it belongs to
    (`controllers/project_payments.on_trash`). A status whose second option nothing ever writes is
    a field that only invites the question.
  * No NET AMOUNT FIELD, same ruling. Once this module rewrites `Project Payments.amount` to the
    net figure, that column IS the net -- storing a second copy here could only drift from it.
    `gross_amount` is kept because the rewrite destroys the original and nothing else remembers it.
  * A payment moving Approved -> Rejected leaves its deduction standing; it drops out of
    `total_tds` on its own, because that total counts Paid payments only.
"""

import frappe
from frappe.utils import flt, nowdate

TDS_DOCTYPE = "Payment TDS Deduction"
PAYMENT_DOCTYPE = "Project Payments"
SERVICE_REQUEST_DOCTYPE = "Service Requests"

APPROVED = "Approved"
PAID = "Paid"

#: The ledgers a deduction may be taken from. A frozenset rather than an `==` at each call site so
#: widening to `Procurement Orders` is one edit here plus a `total_tds` field on that doctype --
#: and so `total_tds` can never be summed for a ledger that has nowhere to store it.
DEDUCTIBLE_PARENTS = frozenset({SERVICE_REQUEST_DOCTYPE})

__all__ = [
	"DEDUCTIBLE_PARENTS",
	"is_deductible",
	"existing_deduction",
	"write_deduction",
	"record_deduction",
	"record_deduction_if_eligible",
	"total_tds_of",
	"sync_total_tds",
]


def is_deductible(doc) -> bool:
	"""Is this payment one this module withholds tax from, in its CURRENT state?

	Three facts, all of them about the payment itself: the parent ledger is deductible, the status
	is `Approved`, and there is a vendor to look a rate up on. The TRANSITION is the caller's
	concern -- `on_update` already knows whether the status just changed, and re-deriving that here
	would need `get_doc_before_save`, which is `None` on an insert.
	"""
	if (doc.get("document_type") or "").strip() not in DEDUCTIBLE_PARENTS:
		return False
	if (doc.get("status") or "").strip() != APPROVED:
		return False
	return bool((doc.get("vendor") or "").strip())


def existing_deduction(payment_name: str) -> str | None:
	"""The deduction already recorded against this payment, if any.

	⚠️ A CHECK, NOT THE GUARANTEE. `Payment TDS Deduction.project_payment` is UNIQUE, and that
	constraint is what actually makes a second row impossible; this read exists so the ordinary
	path returns quietly instead of raising a duplicate-key error at every re-save of an approved
	payment. Removing the unique index and keeping this would be a check-then-act race.
	"""
	return frappe.db.get_value(TDS_DOCTYPE, {"project_payment": payment_name}, "name")


def vendor_rate(vendor: str):
	"""The vendor's TDS rate, or `None` when there is nothing to deduct.

	A blank, zero or negative rate answers `None` rather than 0 so the caller writes NO ROW at all.
	A zero-value deduction row would be a claim that tax was withheld, which is a different
	statement from "this vendor is not deducted from" -- and it would sit in the audit trail as one.
	"""
	if not vendor:
		return None
	rate = flt(frappe.db.get_value("Vendors", vendor, "tds_deduction_percentage"))
	return rate if rate > 0 else None


def write_deduction(
	doc,
	*,
	tds_amount,
	tds_percentage,
	payment_approved_on: str | None = None,
	update_modified: bool = True,
) -> str | None:
	"""Record ONE deduction and net the payment. The caller supplies the FIGURES; this owns the
	record, the ordering and the guards.

	⚠️ IT EXISTS BECAUSE THE TWO ERAS SOURCE THE TAX DIFFERENTLY BUT MUST WRITE IT IDENTICALLY.
	A payment approved from now on derives its tax from the vendor's CURRENT rate
	(`record_deduction`); a historical payment carries the figure that was ACTUALLY withheld in
	`Project Payments.tds`, and 537 of 625 of those were taken at 1% while the vendor master now
	says 2% — so recomputing history from the vendor would restate 1,262 real deductions. Two write
	paths would be two chances to get the ordering, the netting or the idempotency subtly different;
	one function with two callers cannot.

	Returns the deduction's name, or `None` when there was nothing to record.
	"""
	existing = existing_deduction(doc.name)
	if existing:
		return existing

	gross = flt(doc.get("amount"))
	tds_amount = flt(tds_amount, 2)

	# A refund or zero-value payment has nothing to withhold from; a deduction that swallows the
	# whole payment is bad data rather than a deduction, and netting it would produce a zero or
	# negative amount that every downstream sum would then carry.
	if gross <= 0 or tds_amount <= 0 or tds_amount >= gross:
		return None

	net = flt(gross - tds_amount, 2)

	row = frappe.new_doc(TDS_DOCTYPE)
	row.update(
		{
			"project_payment": doc.name,
			"document_type": doc.get("document_type"),
			"document_name": doc.get("document_name"),
			"vendor": doc.get("vendor"),
			"project": doc.get("project"),
			"gross_amount": gross,
			"tds_percentage": flt(tds_percentage, 2),
			"tds_amount": tds_amount,
			"payment_approved_on": payment_approved_on or nowdate(),
		}
	)
	row.insert(ignore_permissions=True)

	# The payment now states what will actually leave the bank (owner ruling 2026-09-10).
	#
	# ⚠️ THE DEDUCTION ROW IS WRITTEN FIRST, AND THE ORDER IS THE SAFETY. `gross_amount` is the only
	# surviving record of the original figure, so if the insert fails the amount must still be
	# untouched -- a reduced payment with no row saying why, and no way to recover the gross, is the
	# one unrecoverable state this function can produce. Same reasoning as the outflow import's
	# `_record_settlement`, which inserts its match before flipping the row it describes.
	#
	# ⚠️ `db_set`, NOT `doc.amount = ...`. On the hook path this runs INSIDE the payment's own save,
	# so assigning to the field would be discarded -- the row is already written by the time a hook
	# sees it. `db_set` updates the column and the in-memory doc together, and fires no further
	# lifecycle events, so it cannot recurse back into this function.
	doc.db_set("amount", net, update_modified=update_modified)
	return row.name


def record_deduction(doc, *, payment_approved_on: str | None = None, update_modified: bool = True) -> str | None:
	"""Withhold tax from one approved payment AT THE VENDOR'S CURRENT RATE. The forward path.

	IDEMPOTENT: an already-recorded payment returns the existing row untouched. This is reached from
	two hooks and several approval routes (auto-approve at insert, CEO approve, CEO bulk approve, a
	split's approved half), and a payment can legitimately be saved again while sitting in
	`Approved`.

	⚠️ FOR HISTORY, USE `write_deduction` WITH THE STORED FIGURE INSTEAD -- see its docstring. The
	vendor's rate is the right source only for a deduction being taken NOW.

	`update_modified=False` writes the net amount WITHOUT stamping the payment's `modified` /
	`modified_by`. It exists for the one-off backfill
	(`patches/v3_0/backfill_sr_payment_tds_deductions.py`). Three reasons a backfill wants it off --
	a bumped `modified` raises `TimestampMismatchError` under anyone holding the payment open, it
	records a human editor for a change no human made, and every touched row would jump to the top
	of a list sorted by `modified`.
	"""
	rate = vendor_rate(doc.get("vendor"))
	if rate is None:
		return None

	gross = flt(doc.get("amount"))
	if gross <= 0:
		return None

	return write_deduction(
		doc,
		tds_amount=flt(gross * rate / 100.0, 2),
		tds_percentage=rate,
		# `None` on the hook path -> today, which IS the approval day there. The backfill passes the
		# historical approval date instead, so a record always carries the day it was decided.
		#
		# ⚠️ THE ALREADY-RUN BACKFILL PATCH STILL CALLS THIS WITH THE OLD KEYWORD `deducted_on=`.
		# `patches/` is append-only history and that patch has run everywhere, so it is left alone;
		# it would only raise on a fresh site that replays the whole patch log, which this repo
		# never does (new environments restore a backup, and the Patch Log travels with it).
		payment_approved_on=payment_approved_on,
		update_modified=update_modified,
	)


def record_deduction_if_eligible(doc) -> str | None:
	"""`record_deduction` behind `is_deductible`. The one call the controller makes.

	⚠️ IT MUST NEVER RAISE INTO THE APPROVAL. Withholding tax is bookkeeping that rides ALONGSIDE
	an approval a person just performed; a failure here must not roll back the approval itself or
	surface to the approver as a failed action. It is logged and swallowed, exactly as the
	controller already treats its notification fan-out and as `_post_split_side_effects` treats the
	split's side effects. The row is recoverable -- re-saving the approved payment records it.
	"""
	if not is_deductible(doc):
		return None
	try:
		return record_deduction(doc)
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"TDS deduction failed for {doc.name}")
		return None


def total_tds_of(document_type: str, document_name: str, exclude_payment: str | None = None) -> float:
	"""Tax withheld on the PAID payments of one parent document.

	⚠️ `Paid` ONLY, MIRRORING `amount_paid`. The two totals are recomputed in the same pass and
	must describe the same population, or a Service Request reports tax withheld on money it has
	not paid. A deduction recorded at `Approved` therefore sits in the ledger but OUTSIDE this
	total until its payment is fulfilled -- which is also when the tax is actually remitted.

	⚠️ ONE JOINED AGGREGATE, NEVER "read the payment names then filter on `name in [...]`". That
	shape is what tripped PostgreSQL's sqlparse token ceiling in production on the data-table reads,
	and it fails only once a parent has enough payments -- i.e. never in a test.

	`exclude_payment` mirrors `update_parent_amount_paid`'s `exclude_name`: during `on_trash` the
	row is still in the database, so a total that did not exclude it would keep counting tax
	withheld on a payment that is being deleted.
	"""
	if not document_type or not document_name:
		return 0.0
	if document_type not in DEDUCTIBLE_PARENTS:
		return 0.0

	conditions = ""
	params = [document_type, document_name, PAID]
	if exclude_payment:
		conditions = " AND p.name <> %s"
		params.append(exclude_payment)

	rows = frappe.db.sql(
		f"""
		SELECT COALESCE(SUM(d.tds_amount), 0)
		FROM "tabPayment TDS Deduction" d
		INNER JOIN "tabProject Payments" p ON p.name = d.project_payment
		WHERE p.document_type = %s
		  AND p.document_name = %s
		  AND p.status = %s{conditions}
		""",
		tuple(params),
	)
	return flt(rows[0][0]) if rows else 0.0


def sync_total_tds(document_type: str, document_name: str, exclude_payment: str | None = None) -> float:
	"""Recompute and store the parent's `total_tds`. No-ops for a ledger that has no such field.

	⚠️ `set_value`, LIKE `amount_paid` BESIDE IT. `total_tds` is a derived field on the parent and
	writing it through `doc.save()` would fire the parent's own `doc_events` on every payment
	settlement -- which is exactly what the sibling write avoids. The repo's raw-write rule is
	satisfied the same way it is there: this recomputes from source, so any later ordinary save
	leaves the value unchanged and a reconcile pass can always prove it.
	"""
	if document_type not in DEDUCTIBLE_PARENTS:
		return 0.0

	total = total_tds_of(document_type, document_name, exclude_payment=exclude_payment)
	frappe.db.set_value(document_type, document_name, "total_tds", total)
	return total
