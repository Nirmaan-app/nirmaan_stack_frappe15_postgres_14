# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""BoQ Row Category -- per-row classification overlay (Classifier CL-1a).

A durable-address per-row overlay mirroring BoQ Cell Remark's shape (see
boq_cell_remark). Identity = (boq, sheet_name [VERBATIM #152], excel_row,
committed_version, discipline). Unlike the annotation layers, `discipline` is
part of the identity tuple, so a second engine's classification for the SAME
Excel address can coexist as its own current record.

Freeze-and-supersede (category_version / is_current / classified_at) is enforced
by the write path -- services/boq_category/persist.write_row_categories -- NOT in
this controller (mirrors the pricing/annotation convention: the doctype .py stays
minimal, per CLAUDE.md).

Effective-category resolution (the documented contract; NOT computed here):
    effective = human_category_id if set else final_category_id
A BLANK final_category_id means route-to-human (routing == "Needs review"); it is
NEVER a category. The human verdict annotates the SAME classification run in place
(persist.set_human_verdict) -- it does NOT mint a new version.
"""

from frappe.model.document import Document


class BoQRowCategory(Document):
    pass
