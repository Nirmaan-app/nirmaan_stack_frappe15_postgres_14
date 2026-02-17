import frappe


def execute():
	"""Backfill task_phase='Onboarding' on all existing design tracker tasks."""

	frappe.db.sql("""
		UPDATE "tabDesign Tracker Task Child Table"
		SET task_phase = 'Onboarding'
		WHERE task_phase IS NULL OR task_phase = ''
	""")

	frappe.db.commit()
