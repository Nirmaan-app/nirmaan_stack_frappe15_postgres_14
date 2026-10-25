# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class CardMerchantMemory(Document):
	# Written only by services/outflow_import/card_memory.remember (card Create, a card Expense's type edit);
	# read by the card type suggestion (#1569, ADR-0039 ruling 5).
	pass
