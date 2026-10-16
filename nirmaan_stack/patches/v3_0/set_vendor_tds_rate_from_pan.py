"""
Patch: set_vendor_tds_rate_from_pan

Individual and HUF vendors are deducted at 1%, everyone else at 2% (Section 194C).
The 4th character of a PAN is the holder type: P = Individual, H = HUF. Every vendor
sits at the form's 2% default today, so this moves the P/H ones to 1%.

Rules (decided purely by the PAN — no guessing):
    PAN valid, 4th char P or H, rate is the 2% default -> set 1%
    PAN valid, 4th char P or H, any other rate          -> left alone, listed as HAND-SET
    PAN valid, any other 4th char                       -> nothing to do (stays as is)
    PAN blank or not a valid PAN                        -> nothing to do (stays as is)

⚠️ ONLY FUTURE APPROVALS MOVE. A deduction snapshots the vendor's rate the day its payment is
approved (`services/payment_tds.vendor_rate`) and never re-reads it, so every existing
`Payment TDS Deduction` row keeps the rate it was taken at.

Safe to re-run: Yes (a vendor already at 1% is no longer at the 2% default and is skipped).

Usage:
    Dry run (writes nothing):
        bench --site localhost execute nirmaan_stack.patches.v3_0.set_vendor_tds_rate_from_pan.execute --kwargs "{'dry_run': True}"
    Apply: runs on `bench migrate` (post_model_sync).
"""

import re
from collections import Counter

import frappe
from frappe.utils import flt

# Same pattern as frontend/src/constants/vendorFormRegex.ts
PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")

ONE_PERCENT_HOLDER_TYPES = {"P", "H"}  # P = Individual, H = HUF
DEFAULT_RATE = 2.0
NEW_RATE = 1.0


def execute(dry_run=False):
	vendors = frappe.get_all(
		"Vendors",
		fields=["name", "vendor_name", "vendor_pan", "tds_deduction_percentage"],
		order_by="name asc",
	)

	by_holder_type = Counter()
	updates = []
	hand_set = []
	no_pan = 0

	for v in vendors:
		pan = (v.vendor_pan or "").strip().upper()
		if not PAN_RE.match(pan):
			no_pan += 1
			continue

		holder_type = pan[3]
		if holder_type not in ONE_PERCENT_HOLDER_TYPES:
			continue

		rate = flt(v.tds_deduction_percentage)
		if rate == NEW_RATE:
			by_holder_type["already"] += 1
		elif rate == DEFAULT_RATE:
			by_holder_type[holder_type] += 1
			updates.append(v.name)
		else:
			hand_set.append(v)

	label = "[DRY RUN] " if dry_run else ""
	print(f"\n{label}Vendors checked: {len(vendors)}")
	print(f"  PAN 4th char P (Individual) at 2%  : {by_holder_type['P']}  (set to 1%)")
	print(f"  PAN 4th char H (HUF) at 2%         : {by_holder_type['H']}  (set to 1%)")
	print(f"  P/H already at 1%                  : {by_holder_type['already']}")
	print(f"  P/H with a HAND-SET rate (skipped) : {len(hand_set)}")
	print(f"  no valid PAN (untouched)           : {no_pan}")
	print(f"  rows to update                     : {len(updates)}")

	for v in hand_set:
		print(f"    HAND-SET  {v.name}  {v.vendor_name}: {v.vendor_pan} at {v.tds_deduction_percentage}%")

	if dry_run:
		print("\n[DRY RUN] Nothing written.")
		return

	# Vendors carries doc_events (after_insert / on_update / on_trash -> vendor categories),
	# and `set_value` skips them. Skipping is correct: those hooks maintain the category list,
	# which does not depend on the rate, and nothing stores a figure derived from the vendor's
	# rate -- each deduction snapshots its own rate at approval.
	for name in updates:
		frappe.db.set_value("Vendors", name, "tds_deduction_percentage", NEW_RATE, update_modified=False)
	frappe.db.commit()
	print(f"Updated {len(updates)} vendor(s) to {NEW_RATE:g}%.")
