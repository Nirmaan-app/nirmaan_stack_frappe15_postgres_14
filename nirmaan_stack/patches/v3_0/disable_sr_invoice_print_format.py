# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Turn off the "SR Invoice" print format (#1546, spec #1528 story 90).

It printed a GST-off Work Order's invoice from the amount, RA number and type in the print link, so
anyone could change them, and Desk's Print menu on a Work Order printed a FINAL for the whole WO with
whatever invoice number was last saved. Generated invoices are records now, printed by the
"WO Generated Invoice" format, which reads the record.

The fixture says `disabled: 1` too, but Frappe keeps a site's own `disabled` when it re-imports a
Print Format fixture (`frappe/modules/import_file.ignore_values`), so an existing site needs this.
Kept, not deleted: nothing links to a print format, and the old layout stays readable in Desk.
Idempotent.
"""

import frappe

FORMAT = "SR Invoice"


def execute():
	if frappe.db.exists("Print Format", FORMAT):
		frappe.db.set_value("Print Format", FORMAT, "disabled", 1, update_modified=False)
