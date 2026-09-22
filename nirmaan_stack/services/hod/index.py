# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Handover Documents (HOD) index: the ONE definition of the 16 handover documents.

PURE LEAF -- no imports from frappe. Every other HOD module (the API, the print context, the
binder, the controller) reads the document list, titles, kinds and order from here; the frontend
receives the same list from the API instead of keeping its own copy.

`key` is what `Project HOD Document.document` stores (its Select options must list exactly these
keys, in this order -- pinned by test). `no` is the S.No printed on the checklist before
switched-off rows are removed and the rest renumbered.

`fill` marks a document that gives users something to fill in (a form, O&M blanks / pictures, certificate
dates); only those pass through "Form Filled" (see `checklist.derive_status`).

Kinds:
  form      -- the project types everything (stored in `form_data`)
  template  -- the text comes from the library; the project stores only its picks / blank values
  app       -- read live from an existing Nirmaan feature; nothing is copied
"""

FORM = "form"
TEMPLATE = "template"
FROM_APP = "app"

# HOD Library Content.document options (the long, per-system texts).
LIB_OM = "O&M Manual"
LIB_DOS = "Do's & Don'ts"
LIB_MAINT = "Maintenance Checklist"
LIBRARY_DOCUMENTS = (LIB_OM, LIB_DOS, LIB_MAINT)

# From-app sources.
SRC_COMMISSION = "commission"
SRC_TDS = "tds"
SRC_SNAG = "snag"
SRC_DESIGN = "design"

DOCUMENTS = (
    {"key": "escalation_chart", "no": 1, "title": "Escalation Chart", "kind": FORM, "fill": True},
    {"key": "demo_training", "no": 2, "title": "Demo & Training Certificate", "kind": FROM_APP, "source": SRC_COMMISSION, "bucket": "training"},
    {"key": "commissioning_report", "no": 3, "title": "Commissioning Report", "kind": FROM_APP, "source": SRC_COMMISSION, "bucket": "commissioning"},
    {"key": "material_tds", "no": 4, "title": "Material Technical Data Sheet", "kind": FROM_APP, "source": SRC_TDS},
    {"key": "om_manual", "no": 5, "title": "Operations & Maintenance Manual", "kind": TEMPLATE, "library": LIB_OM, "fill": True},
    {"key": "dos_donts", "no": 6, "title": "Do's & Don'ts", "kind": TEMPLATE, "library": LIB_DOS},
    {"key": "maintenance_checklist", "no": 7, "title": "Maintenance Checklist", "kind": TEMPLATE, "library": LIB_MAINT},
    {"key": "inventory_list", "no": 8, "title": "Inventory List", "kind": FORM, "landscape": True, "fill": True},
    {"key": "recommended_tools", "no": 9, "title": "Recommended Tools List", "kind": TEMPLATE},
    {"key": "attic_stock_list", "no": 10, "title": "Attic Stock List", "kind": FORM, "fill": True},
    {"key": "key_list", "no": 11, "title": "Key List", "kind": FORM, "fill": True},
    {"key": "equipment_warranty", "no": 12, "title": "Equipment Warranty", "kind": TEMPLATE, "fill": True},
    {"key": "completion_certificate", "no": 13, "title": "Completion Certificate", "kind": TEMPLATE, "fill": True},
    {"key": "factory_test_reports", "no": 14, "title": "Factory Test Reports", "kind": FROM_APP, "source": SRC_COMMISSION, "bucket": "factory_test"},
    {"key": "snag_list", "no": 15, "title": "Snag List", "kind": FROM_APP, "source": SRC_SNAG},
    {"key": "as_built_drawings", "no": 16, "title": "As Built Drawings", "kind": FROM_APP, "source": SRC_DESIGN},
)

KEYS = tuple(d["key"] for d in DOCUMENTS)
_BY_KEY = {d["key"]: d for d in DOCUMENTS}


def get(key):
	"""The index entry for `key`, or None."""
	return _BY_KEY.get(key)


def is_valid(key) -> bool:
	return key in _BY_KEY


def public_list():
	"""The index as plain dicts for the API (every key present on every entry)."""
	return [
		{
			"key": d["key"],
			"no": d["no"],
			"title": d["title"],
			"kind": d["kind"],
			"landscape": bool(d.get("landscape")),
			"fill": bool(d.get("fill")),
			"library": d.get("library"),
			"source": d.get("source"),
		}
		for d in DOCUMENTS
	]
