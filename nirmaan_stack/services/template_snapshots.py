# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Content-addressed template snapshots: one row per distinct form, named by its hash.

SHARED by `Commission Report Template Snapshot` and `Expense Request Template Snapshot`
(ADR-0016: separate tables, shared hash-and-upsert logic). Each doctype names its row by
`payload_hash`, so two records filled against the same form share one row.
"""

import hashlib
import json

import frappe
from frappe.utils import now_datetime


def canonical_json(payload: dict) -> str:
	"""Stable byte-for-byte serialization for hashing.

	Python's `json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False)` matches a
	normalized JS `JSON.stringify` with a sorting-key replacer, which is what the commissioning
	frontend uses before sending.
	"""
	return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def payload_hash(payload: dict) -> str:
	return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def get_or_create_snapshot(doctype: str, payload: dict) -> str:
	"""Upsert a snapshot of `payload` into `doctype`, and return its docname (= its hash)."""
	name = payload_hash(payload)
	if frappe.db.exists(doctype, name):
		return name

	snapshot = frappe.new_doc(doctype)
	snapshot.payload_hash = name
	snapshot.template_id = payload.get("templateId") or ""
	snapshot.template_version = payload.get("templateVersion") or 1
	snapshot.template_title = payload.get("title") or ""
	snapshot.first_seen_at = now_datetime()
	snapshot.payload = canonical_json(payload)
	snapshot.insert(ignore_permissions=True)
	return snapshot.name
