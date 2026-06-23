# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class BoQSheetPricingLock(Document):
    """Single-editor pricing lock for one committed sheet+version (Phase 5, lock slice A).

    One record per (boq, sheet_name [VERBATIM #152], committed_version). The lock is
    acquired ON FIRST EDIT (the first save_cell_price for that sheet+version), refreshed
    on every subsequent holder save, and goes STALE 5 minutes after the last edit
    (edit-driven expiry, no heartbeat). A different user may take over a STALE lock.

    ATOMICITY (exactly-one-winner): the `name` (primary key) is a DETERMINISTIC hash of
    the identity (see pricing_lock._lock_identity), so two concurrent first-edits both
    attempt to INSERT the SAME name -> the Postgres primary-key collision raises
    frappe.exceptions.DuplicateEntryError; exactly one insert wins, the loser re-reads
    and is rejected (or takes over if stale). The whole acquire/refresh/reject/takeover
    decision lives in the pricing write path (api/boq/wizard/pricing_lock.py), NOT in
    this controller (mirroring the committed-tier + pricing-layer convention).

    The JSON autoname is blank on purpose: this controller's autoname() sets the
    deterministic name (Frappe runs the controller autoname before any series fallback).
    """

    def autoname(self):
        # Deferred import keeps this controller free of an import-time dependency on the
        # api module; _lock_identity is the SINGLE source of truth for the lock's PK.
        from nirmaan_stack.api.boq.wizard.pricing_lock import _lock_identity

        self.name = _lock_identity(self.boq, self.sheet_name, self.committed_version)
