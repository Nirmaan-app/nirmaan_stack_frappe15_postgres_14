# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Set `Payee.payee_type` on every Payee created before the field existed (owner, 2026-10-23).

From here on a Payee's type is where it was CREATED, set once by its creator through
`services/payees/writer.create_payee` and never changed (`set_only_once`): Users from Raise Reimbursement,
Vendors from a vendor's bank details, Others anywhere else. The Payees already there have no record of
where they were made, so they are typed ONCE from what links to them now (`rules.payee_type_from_links`):

  * a person's own account (`Nirmaan Users.payee`) -> Users;
  * otherwise any vendor paid into it (`Vendors.payee`) -> Vendors;
  * otherwise -> Others.

⚠️ RUN ONCE ONLY: the patch log is its only guard. Adding the column filled every row with its default,
"Others", so an old row and a new one look alike; in a deploy the column and this patch arrive in the same
migrate, so every row it types is an old one. Re-running it later would re-type Payees created since by the
links rule, overwriting the type their creator set (a Payee added on the Payees page and later picked for a
vendor would turn Vendors).

⚠️ RAW `UPDATE`, NO HOOKS, ON PURPOSE. Payee's only `doc_event` is `validate` (clean the details, refuse a
duplicate), which a type does not touch, and `set_only_once` would refuse the change through `doc.save` on
a row already holding the default. `modified` is left alone: this records a fact, it edits no Payee.

`preview()` reports what would change without writing:
  bench --site <site> execute nirmaan_stack.patches.v3_0.backfill_payee_type.preview
"""

import frappe

from nirmaan_stack.services.payees.rules import PAYEE_DOCTYPE, PAYEE_TYPES, payee_type_from_links

_LINKS_SQL = f"""
    SELECT p.name, p.payee_type,
           EXISTS (SELECT 1 FROM "tabNirmaan Users" u WHERE u.payee = p.name) AS is_own_account,
           (SELECT COUNT(*) FROM "tabVendors" v WHERE v.payee = p.name) AS vendor_count
    FROM "tab{PAYEE_DOCTYPE}" p
"""


def execute():
	backfill()


def plan() -> dict[str, list[str]]:
	"""`{type: [payee names whose stored type differs from it]}`, every type present as a key."""
	changes: dict[str, list[str]] = {t: [] for t in PAYEE_TYPES}
	for row in frappe.db.sql(_LINKS_SQL, as_dict=True):
		target = payee_type_from_links(bool(row.is_own_account), int(row.vendor_count or 0))
		if row.payee_type != target:
			changes[target].append(row.name)
	return changes


def preview() -> dict:
	"""What `backfill` would write, by type, and the totals after it. Writes nothing."""
	changes = plan()
	after = {t: 0 for t in PAYEE_TYPES}
	for row in frappe.db.sql(_LINKS_SQL, as_dict=True):
		after[payee_type_from_links(bool(row.is_own_account), int(row.vendor_count or 0))] += 1
	report = {"would_change": {t: len(names) for t, names in changes.items()}, "totals_after": after}
	print(report)
	return report


def backfill() -> None:
	"""Write each Payee's type from its links. Commits nothing (the migrate does)."""
	for payee_type, names in plan().items():
		if names:
			frappe.db.sql(
				f'UPDATE "tab{PAYEE_DOCTYPE}" SET payee_type = %s WHERE name IN %s',
				(payee_type, tuple(names)),
			)
