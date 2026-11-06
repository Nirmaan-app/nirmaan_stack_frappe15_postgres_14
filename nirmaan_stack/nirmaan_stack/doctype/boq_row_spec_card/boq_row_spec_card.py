# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""BoQ Row Spec Card -- one stored spec card per (payload_sha256, prompt_version, model) (DEV2-B1, R-H2W).

Written only by services/boq_rate_match/cards.py. The card is reused for any row whose exact payload block, under the
same card prompt and model, was carded before; a malformed or failed card is kept (never dropped) and overwritten in
place when the row is carded again. Controller stays minimal: validate + the two indexes."""

import frappe
from frappe.model.document import Document

# Postgres index names are schema-wide, so both names are explicit (services/index_manifest.py lists them).
# The UNIQUE name is all lower case: add_unique issues it unquoted (ALTER TABLE ... ADD CONSTRAINT <name>), so
# PostgreSQL folds it to lower case, and a mixed-case manifest name would then build a second, twin index (seen on
# dev2's first migrate, DEV2-B1). Payee and Cheques name theirs in lower case for the same reason.
REUSE_KEY_UNIQUE = "boq_row_spec_card_payload_sha256_prompt_version_model_idx"
BOQ_SHEET_INDEX = "BoQ_Row_Spec_Card_boq_sheet_idx"


class BoQRowSpecCard(Document):
	def validate(self):
		for field in ("boq", "sheet", "payload_sha256", "prompt_version", "model"):
			if not (self.get(field) or "").strip():
				frappe.throw(f"{field} is required for a spec card.")
		if self.excel_row is None:
			frappe.throw("excel_row is required for a spec card.")


def on_doctype_update():
	# One card per payload, prompt and model: the reuse key, and the backstop under the reuse lookup for two jobs racing.
	frappe.db.add_unique("BoQ Row Spec Card", ["payload_sha256", "prompt_version", "model"], REUSE_KEY_UNIQUE)
	# The cards of one sheet (a later slice reads them by BoQ and sheet).
	frappe.db.add_index("BoQ Row Spec Card", ["boq", "sheet"], BOQ_SHEET_INDEX)
