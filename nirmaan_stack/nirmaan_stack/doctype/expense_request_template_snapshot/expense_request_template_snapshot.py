# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class ExpenseRequestTemplateSnapshot(Document):
	"""A frozen copy of an Expense Type's `source_format`, addressed by its content hash.

	Deliberately empty. The docname IS `payload_hash` (`autoname: field:payload_hash`), so
	identical formats dedupe at insert with no validate hook, and `track_changes: 0` because
	a snapshot is already immutable evidence.

	⚠️ SEPARATE FROM `Commission Report Template Snapshot` BY OWNER RULING, even though the
	two are structurally identical. Expense evidence living in a commission-named table
	misleads every future reader, and the lifecycles are unrelated -- purging or retiring one
	pool must never touch the other. The hash-and-upsert LOGIC is shared (one
	doctype-parameterised helper); only the table is separate.
	"""

	pass
