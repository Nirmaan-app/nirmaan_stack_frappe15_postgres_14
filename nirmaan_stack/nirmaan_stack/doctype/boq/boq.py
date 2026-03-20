# Copyright (c) 2026, Abhishek and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class BOQ(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF
		from nirmaan_stack.nirmaan_stack.doctype.boq_item.boq_item import BOQItem

		project: DF.Link
		work_package: DF.Link
		zone: DF.Data | None
		source_file: DF.Attach | None
		status: DF.Literal["Draft", "Imported", "Error"]
		header_row: DF.Int
		column_mapping: DF.JSON | None
		total_items: DF.Int
		total_amount: DF.Currency
		items: DF.Table[BOQItem]
	# end: auto-generated types

	pass
