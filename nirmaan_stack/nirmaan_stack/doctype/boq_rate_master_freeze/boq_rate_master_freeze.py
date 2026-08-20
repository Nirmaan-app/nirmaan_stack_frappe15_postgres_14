# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""BoQ Rate Master Freeze -- the system-wide deployment freeze on the rate master.

A Single, because the flag is SYSTEM-WIDE: it is not per-sheet, per-discipline or
per-category. The precedent followed is BOQ Upload Review AI Settings (issingle:1,
track_changes:1, System Manager permissions); the BoQ Sheet lock/classification-freeze/
category-override triples are the FIELD SHAPE precedent (flag + _by Data + _at Datetime)
but are per-row and therefore the wrong SCOPE.

track_changes:1 is load-bearing and is what satisfies the owner's R6 ruling that any
admin may lift any other admin's freeze: the live fields record who SET the current
freeze, and the Version log records every flip -- including who LIFTED one -- because
services/boq_rate_master/freeze.py writes through doc.save(ignore_version=False) and
NEVER through frappe.db.set_single_value (which bypasses the doc lifecycle and would
write no Version row at all).

Controller stays minimal per the CLAUDE.md doctype convention. No validate: the two
provenance fields are stamped together by the service writer, never by hand, and a
Single has no identity to validate.
"""

from frappe.model.document import Document


class BoQRateMasterFreeze(Document):
    pass
