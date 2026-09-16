# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Test-only helper shared by the outflow-import api suites (#1254): a bank narration longer than
the old 140-character Data columns, saved onto an import row."""

import frappe

from nirmaan_stack.api.outflow_import.review import ROW_DOCTYPE


def _long_narration():
    """A bank narration well past the old Data column's 140 characters, unique per call."""
    narration = f"MMT/IMPS/{frappe.generate_hash(length=12)}/PAYMENT TO VENDOR FOR SITE MATERIAL " * 6
    narration = narration.strip()  # the settle writers strip, so a trailing space would not survive
    assert len(narration) > 140
    return narration


def _give_row_a_long_reference(test, row_name):
    """Save a long narration onto the row THROUGH THE DOCUMENT LAYER, where Frappe's length check
    lives -- a raw `set_value` would skip the very check this is about."""
    narration = _long_narration()
    doc = frappe.get_doc(ROW_DOCTYPE, row_name)
    doc.settlement_reference = narration
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    test.assertEqual(
        frappe.db.get_value(ROW_DOCTYPE, row_name, "settlement_reference"), narration
    )
    return narration


def _give_row_a_long_narration(test, row_name):
    """Save a long narration as the row's `remarks` -- what an ICICI settle stores since #1259, which
    reads the passbook line's own narration rather than `settlement_reference`."""
    narration = _long_narration()
    doc = frappe.get_doc(ROW_DOCTYPE, row_name)
    doc.remarks = narration
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    test.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row_name, "remarks"), narration)
    return narration
