# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Set `Payment TDS Deduction.tds_section` to 194C on every row that has none (#1523, spec #1522).

⚠️ "TDS" HERE IS TAX DEDUCTED AT SOURCE, not the Technical Data Sheet family.

Every row written before the field existed is a Work Order payment's tax, section 194C (contractors).
On PostgreSQL the column's `DEFAULT '194C'` already fills the existing rows when migrate adds it, so on
most sites this updates nothing. It is the explicit guarantee for any row the default did not reach.
Only a blank is touched, so a re-run changes nothing and a 194-I row stays 194-I.

⚠️ RAW `UPDATE`, NO HOOKS, NO RECOUNT, ON PURPOSE. `Payment TDS Deduction`'s only hooks are the link
rule on save and the challan recompute on delete; neither reads the section. No total is built on it.
"""

import frappe

from nirmaan_stack.services.payment_tds import TDS_DOCTYPE, TDS_SECTION_WORK_ORDER


def execute():
    frappe.db.sql(
        f"""UPDATE "tab{TDS_DOCTYPE}" SET tds_section = %s WHERE COALESCE(tds_section, '') = ''""",
        (TDS_SECTION_WORK_ORDER,),
    )
