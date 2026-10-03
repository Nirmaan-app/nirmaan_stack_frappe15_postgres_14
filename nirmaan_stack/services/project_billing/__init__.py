# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""Client billing tracker -- business rules (ADR-0010 B1).

`rules.py` owns the status groups (pending / approved / NA), the "next bill"
pick and the manager-summary columns. Pure: no `frappe.db`, no request context.
`api/project_billing/` and the doctype controllers import UP into here; nothing
here imports from `api/`.
"""
