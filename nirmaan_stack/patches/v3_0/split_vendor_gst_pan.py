"""
Patch: split_vendor_gst_pan

`Vendors.vendor_gst` used to hold EITHER a GST number or a PAN — the vendor form's
"Taxation Type" select (GST | PAN) wrote both into the same field. This patch splits
them into `vendor_gst` (GSTIN only) and the new `vendor_pan` (PAN only).

Rules (decided purely by shape — no guessing):
    vendor_gst is a GSTIN (15 chars) -> keep it; vendor_pan = GSTIN chars 3-12
                                        (every GSTIN embeds the holder's PAN there)
    vendor_gst is a PAN   (10 chars) -> move it to vendor_pan; clear vendor_gst
    vendor_gst is blank              -> nothing to do
    anything else                    -> left untouched, listed as UNRECOGNISED

A vendor_pan that is already filled is never overwritten; a different value is
reported as a CONFLICT and skipped. Updates bypass validate and keep `modified`.

Safe to re-run: Yes (split rows are recognised and skipped).

The dry run also prints a REVIEW list — rows the backfill splits correctly but whose
value looks wrong (placeholder or mistyped GSTINs, invalid PAN type). Those need a
human; the patch does not "fix" them.

Usage:
    Dry run (writes nothing; works before the vendor_pan column exists):
        bench --site localhost execute nirmaan_stack.patches.v3_0.split_vendor_gst_pan.execute --kwargs "{'dry_run': True}"
    Apply: runs on `bench migrate` (post_model_sync).
"""

import re
from collections import defaultdict

import frappe

# Same patterns as frontend/src/constants/vendorFormRegex.ts
GST_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")

_GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
# 4th PAN character = holder type (P person, C company, F firm, H HUF, A AOP, T trust,
# B BOI, L local authority, J artificial juridical person, G government, K krishi).
_PAN_HOLDER_TYPES = set("ABCFGHJLPTK")


def execute(dry_run=False):
	has_pan_column = frappe.db.has_column("Vendors", "vendor_pan")
	if not has_pan_column and not dry_run:
		print("vendor_pan column missing — run `bench migrate` so the Vendors doctype syncs first.")
		return

	fields = ["name", "vendor_name", "vendor_type", "vendor_gst"]
	if has_pan_column:
		fields.append("vendor_pan")
	vendors = frappe.get_all("Vendors", fields=fields, order_by="name asc")

	counts = defaultdict(int)
	updates = []
	conflicts = []
	unrecognised = []

	for v in vendors:
		gst = (v.vendor_gst or "").strip().upper()
		pan = (v.get("vendor_pan") or "").strip().upper()

		if not gst:
			counts["blank"] += 1
			continue

		if GST_RE.match(gst):
			counts["gst"] += 1
			target_pan = gst[2:12]
			if pan and pan != target_pan:
				conflicts.append((v, f"GST {gst} implies PAN {target_pan}, vendor_pan has {pan}"))
				continue
			change = {}
			if pan != target_pan:
				change["vendor_pan"] = target_pan
			if gst != v.vendor_gst:
				change["vendor_gst"] = gst
			if change:
				updates.append((v.name, change))
			else:
				counts["already_split"] += 1

		elif PAN_RE.match(gst):
			counts["pan"] += 1
			if pan and pan != gst:
				conflicts.append((v, f"vendor_gst has PAN {gst}, vendor_pan has {pan}"))
				continue
			updates.append((v.name, {"vendor_pan": gst, "vendor_gst": None}))

		else:
			unrecognised.append(v)

	label = "[DRY RUN] " if dry_run else ""
	print(f"\n{label}Vendors checked: {len(vendors)}")
	print(f"  GST number in vendor_gst : {counts['gst']}  (PAN derived from GSTIN)")
	print(f"  PAN in vendor_gst        : {counts['pan']}  (moved to vendor_pan)")
	print(f"  blank                    : {counts['blank']}")
	print(f"  already split            : {counts['already_split']}")
	print(f"  rows to update           : {len(updates)}")
	print(f"  CONFLICTS (skipped)      : {len(conflicts)}")
	print(f"  UNRECOGNISED (untouched) : {len(unrecognised)}")

	for v, reason in conflicts:
		print(f"    CONFLICT  {v.name}  {v.vendor_name}: {reason}")
	for v in unrecognised:
		print(f"    UNRECOGNISED  {v.name}  {v.vendor_name}: {v.vendor_gst!r}")

	if dry_run:
		_print_review(vendors)
		print("\n[DRY RUN] Nothing written.")
		return

	for name, change in updates:
		frappe.db.set_value("Vendors", name, change, update_modified=False)
	frappe.db.commit()
	print(f"Updated {len(updates)} vendor(s).")


def _gst_checksum_ok(gst):
	total = 0
	for i, ch in enumerate(gst[:14]):
		value = _GST_CHARS.index(ch) * (2 if i % 2 else 1)
		total += value // 36 + value % 36
	return _GST_CHARS[(36 - total % 36) % 36] == gst[14]


def _print_review(vendors):
	"""Rows that split fine but carry a doubtful value. Report only — nothing is changed."""
	placeholder, bad_checksum, bad_pan_type = [], [], []
	gst_by_value = defaultdict(list)
	gst_vendor_by_pan = {}
	pan_only = []

	for v in vendors:
		gst = (v.vendor_gst or "").strip().upper()
		if GST_RE.match(gst):
			pan = gst[2:12]
			gst_by_value[gst].append(v)
			gst_vendor_by_pan.setdefault(pan, v)
			if len(set(pan[:5])) == 1:
				placeholder.append(v)
			elif not _gst_checksum_ok(gst):
				bad_checksum.append(v)
		elif PAN_RE.match(gst):
			pan = gst
			pan_only.append(v)
		else:
			continue
		if pan[3] not in _PAN_HOLDER_TYPES:
			bad_pan_type.append(v)

	same_entity = [
		(v, gst_vendor_by_pan[v.vendor_gst.strip().upper()])
		for v in pan_only
		if v.vendor_gst.strip().upper() in gst_vendor_by_pan
	]
	duplicate_gst = {gst: vs for gst, vs in gst_by_value.items() if len(vs) > 1}

	print("\nREVIEW — needs a human (the patch does not change these values):")

	print(f"\n  Placeholder GSTINs (AAAAA/BBBBB-style PAN part): {len(placeholder)}")
	for v in placeholder:
		print(f"    {v.name:<20} {v.vendor_gst}  {v.vendor_name}")

	print(f"\n  GSTINs failing the GST check digit (likely typos): {len(bad_checksum)}")
	for v in bad_checksum:
		print(f"    {v.name:<20} {v.vendor_gst}  {v.vendor_name}")

	print(f"\n  Invalid PAN holder type (4th character): {len(bad_pan_type)}")
	for v in bad_pan_type:
		print(f"    {v.name:<20} {v.vendor_gst}  {v.vendor_name}")

	print(f"\n  PAN-only vendors that match a GST vendor's PAN (same entity twice): {len(same_entity)}")
	for v, g in same_entity:
		print(f"    {v.name:<20} {v.vendor_gst}  {v.vendor_name}  <->  {g.name} {g.vendor_gst} {g.vendor_name}")

	print(f"\n  Same GSTIN on more than one vendor: {len(duplicate_gst)}")
	for gst, vs in duplicate_gst.items():
		print(f"    {gst}: " + ", ".join(f"{v.name} ({v.vendor_name})" for v in vs))
