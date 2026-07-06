import frappe

# Backfill `Purchase Order Item.invoice_qty`.
#
# ONE COMMAND (recommended):
#   run()   -- deterministic backfill + cache-first extraction in a single, non-interactive
#              pass, scoped to PROJECT (None = ALL projects):
#                bench --site <site> execute nirmaan_stack.patches.v3_0.backfill_invoice_qty.run
#
# The pieces (run() calls the first two):
#   execute()                -- deterministic backfill for EVERY live PO, no AI. Leaves the
#                               under-invoiced ("MISMATCH") POs for the extraction step.
#   import_cache(apply=True) -- extraction on the MISMATCH POs. It BUILDS the cache as it goes:
#                               HIT  (mapped entry in extraction_cache.json) -> replay, no AI;
#                               FAIL (failed entry)                          -> skip, leave for the UI;
#                               MISS (not cached) -> Gemini reads it ONCE -> registers the result
#                                                    as a 'mapped' entry, or a 'failed' entry.
#   export_cache()           -- optional: re-snapshot the DB's mapped invoices into the cache
#                               (import_cache already writes it live; failed entries are preserved).
#
# ALL human fixing happens in the Resolve UI (/resolve-invoices), which on save ALSO updates the
# invoice's cache entry (failed -> mapped) so the fix ships to prod with extraction_cache.json.
# A failed invoice is Gemini'd at most ONCE, then left for the UI (never retried). There is NO
# terminal fixing. invoice_qty is durable: every fix is LINE MAPPINGS (never a raw number), so
# recompute keeps deriving it. NOT wired into patches.txt -- run deliberately.

MIN_MATCH = 0.70
TOL = 1.0
# TESTING SCOPE: run on ONE project only. Set to None to backfill ALL projects.
PROJECT = "GAUTAM_BUDDHA_NAGAR-PROJ-00074"   # Maconns Noida (set None for the full run)
_COUNTED = ("Pending", "Approved")

import os
import json
# The extraction CACHE lives in the APP's backend dir (.../apps/nirmaan_stack/nirmaan_stack) so it
# travels WITH the app to prod (copy the app / the file in, then run() replays it there). The
# failure LOG goes through the standard Frappe logger -> logs/extraction_failures.log (NOT the app dir).
_APP = frappe.get_app_path("nirmaan_stack")     # .../apps/nirmaan_stack/nirmaan_stack
_CACHE = os.path.join(_APP, "extraction_cache.json")


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _save_no_modified(vi):
    """Save a Vendor Invoice WITHOUT bumping modified/modified_by -- this is a backfill, not a
    user edit. doc.save() always sets modified, so we capture the original first and restore it
    right after (the update_modified=False equivalent for a doc that has a child table)."""
    orig_m, orig_mb = vi.get("modified"), vi.get("modified_by")
    vi.save(ignore_permissions=True)
    frappe.db.set_value("Vendor Invoices", vi.name,
                        {"modified": orig_m, "modified_by": orig_mb}, update_modified=False)


# =============================================================================
# SINGLE COMMAND (recommended entry point) — backfill + extraction in ONE run:
#   bench --site <site> execute nirmaan_stack.patches.v3_0.backfill_invoice_qty.run
# =============================================================================
def run():
    """Do the whole thing in one pass — deterministic backfill, then extraction —
    scoped to the module-level PROJECT (a project id for one project; None = ALL
    projects). Flip PROJECT = None for production and nothing else here changes.

      Step 1  execute()               -- buckets -> invoice_qty (deterministic, no AI).
      Step 2  import_cache(apply=True) -- each MISMATCH PO's still-unmapped invoice:
                HIT  in extraction_cache.json  -> replay the cached mapping, NO AI;
                FAIL (failed entry)            -> skip, leave it for the Resolve UI;
                MISS (not cached)              -> Gemini reads it ONCE -> mapped/failed entry.
              Recompute + commit per PO. Non-interactive; builds the cache as it goes.
    """
    print(f"[run] backfill + extraction — scope = {PROJECT or 'ALL projects'}\n")
    execute()                       # step 1 — deterministic buckets
    import_cache(apply=True)        # step 2 — cache replay + Gemini for the misses
    print("\n[run] complete — backfill + extraction done.")


# =============================================================================
# STEP 1 — deterministic backfill (no AI). Run first.
# =============================================================================
def execute():
    completed = set(frappe.get_all("Projects", filters={"status": "Completed"}, pluck="name"))
    filters = {"status": ["!=", "Merged"]}
    if PROJECT:
        filters["project"] = ["=", PROJECT]
    pos = frappe.get_all(
        "Procurement Orders",
        filters=filters,
        fields=["name", "project", "total_amount"],
    )
    print(f"[backfill_invoice_qty] scope: {PROJECT or 'ALL projects'}")
    counts = {"EXACT": 0, "COMPLETED": 0, "DIRECT": 0, "MISMATCH": 0, "ZERO": 0}
    for i, po in enumerate(pos):
        bucket = _po_bucket(po.name, po.project, float(po.total_amount or 0), completed)
        _write_bucket(po.name, bucket)
        counts[bucket] += 1
        if i % 200 == 0:
            frappe.db.commit()   # batch-commit: thousands of POs, avoid one giant txn
    frappe.db.commit()
    print(f"[backfill_invoice_qty] backfill done — {len(pos)} POs: {counts}")
    print(f"    {counts['MISMATCH']} MISMATCH POs left for extraction — run import_cache(apply=True) (or run()).")


def _po_bucket(po_name, project, po_total, completed):
    """Classify one PO -> EXACT / COMPLETED / DIRECT / MISMATCH / ZERO (READ-ONLY)."""
    active = _active_invoices(po_name)
    if active and all(_has_lines(i.name) for i in active):
        return "EXACT"
    if project in completed:
        return "COMPLETED"
    if not active:
        return "ZERO"
    net = sum(float(i.invoice_amount or 0) for i in active)
    all_approved = all(i.status == "Approved" for i in active)
    return "DIRECT" if (all_approved and net >= po_total - TOL) else "MISMATCH"


def _write_bucket(po_name, bucket):
    """Write invoice_qty on the PO's item rows for its classified bucket.

    MISMATCH is deliberately NOT written here -- an under-invoiced PO is left untouched so
    the extraction path (import_cache) can read its files, write the line mappings, and
    recompute the EXACT invoice_qty. The backfill only sets the CERTAIN cases.
    """
    if bucket == "MISMATCH":
        return                                        # left for the extraction path
    items = frappe.get_all(
        "Purchase Order Item",
        filters={"parent": po_name, "parenttype": "Procurement Orders"},
        fields=["name", "quantity", "category"],
    )
    if bucket == "EXACT":
        summed = _line_sums(po_name)
        value_of = lambda it: summed.get(it.name, 0)
    elif bucket == "ZERO":
        value_of = lambda it: 0
    else:  # COMPLETED / DIRECT -> ordered qty
        value_of = lambda it: float(it.quantity or 0)
    for it in items:
        # Additional Charges (freight / P&F / etc.) are not real line quantities -> always 0.
        val = 0 if it.category == "Additional Charges" else value_of(it)
        frappe.db.set_value("Purchase Order Item", it.name, "invoice_qty",
                            val, update_modified=False)


def _active_invoices(po_name):
    invs = frappe.get_all(
        "Vendor Invoices",
        filters={"document_type": "Procurement Orders", "document_name": po_name,
                 "status": ["in", _COUNTED]},
        fields=["name", "invoice_no", "status", "invoice_amount", "invoice_attachment"],
    )
    return [i for i in invs if float(i.invoice_amount or 0) >= 0]   # credit notes (negative) skipped


def _has_lines(invoice):
    return bool(frappe.db.count(
        "Vendor Invoice Line", {"parent": invoice, "parenttype": "Vendor Invoices"}))


def _line_sums(po_name):
    rows = frappe.db.sql(
        """
        SELECT vil.po_item_row              AS row_name,
               SUM(COALESCE(vil.quantity, 0)) AS qty
        FROM "tabVendor Invoice Line" vil
        JOIN "tabVendor Invoices" vi ON vil.parent = vi.name
        WHERE vil.parenttype = 'Vendor Invoices'
          AND vil.match_status = 'Matched'
          AND vil.po_item_row IS NOT NULL AND vil.po_item_row != ''
          AND vi.document_type = 'Procurement Orders'
          AND vi.document_name = %(po)s
          AND vi.status IN %(statuses)s
          AND COALESCE(vi.invoice_amount, 0) >= 0
        GROUP BY vil.po_item_row
        """,
        {"po": po_name, "statuses": _COUNTED},
        as_dict=True,
    )
    return {r.row_name: float(r.qty or 0) for r in rows}


# =============================================================================
# STEP 2 helper — apply ONE Gemini extraction result to an invoice. Extraction is
# driven non-interactively by import_cache() (cache-first, Gemini for misses) — see
# the CACHE section. There is NO terminal fixing; failures go to the Resolve UI.
# =============================================================================
def _apply_autofill(vi, res, po_doc):
    """Populate line_mappings AND every autofill_* field from the extract response, so the
    invoice is identical to a UI-autofilled one (recon UI + auto-approve gates + cacheable)."""
    from nirmaan_stack.api.delivery_notes.update_invoice_data import build_line_mapping_rows

    lm = (res or {}).get("line_match") or {}
    _j = lambda v: json.dumps(v) if v else None

    vi.set("line_mappings", build_line_mapping_rows(json.dumps(lm), po_doc))
    vi.autofill_used = 1
    vi.autofill_processor_id = res.get("processor_id")
    vi.autofill_extracted_invoice_no = res.get("invoice_no")
    vi.autofill_extracted_invoice_date = res.get("invoice_date")
    vi.autofill_extracted_amount = res.get("amount")
    vi.autofill_extracted_supplier_gstin = res.get("supplier_gstin")
    vi.autofill_extracted_receiver_gstin = res.get("receiver_gstin")
    vi.autofill_confidence_json = _j(res.get("confidence"))
    vi.autofill_all_entities_json = _j(res.get("entities"))
    vi.autofill_line_items_json = _j(res.get("line_items"))
    vi.autofill_line_match_json = _j(lm)


def _find_mismatched(project):
    completed = set(frappe.get_all("Projects", filters={"status": "Completed"}, pluck="name"))
    filt = {"status": ["!=", "Merged"]}
    if project:
        filt["project"] = project
    pos = frappe.get_all("Procurement Orders", filters=filt,
                         fields=["name", "project", "total_amount"])
    return [p.name for p in pos
            if _po_bucket(p.name, p.project, float(p.total_amount or 0), completed) == "MISMATCH"]


def _log_failure(po, inv):
    """Note a skipped/failed PO+invoice through the standard Frappe logger
    (-> logs/extraction_failures.log). Supplementary — the cache's 'failed' entries are the
    primary record; this log is a convenience trail."""
    frappe.logger("extraction_failures").info(
        f"{po}\t{inv.name}\t{inv.invoice_no}\t{inv.invoice_amount}"
    )


# =============================================================================
# CACHE — the single durable record of every MISMATCH invoice's extraction outcome.
# Built as import_cache() runs (mapped + failed entries) and updated by the Resolve UI.
# Ships with the app to prod, where run() replays it (no Gemini for cached invoices).
# =============================================================================
_AF_FIELDS = (
    "autofill_used", "autofill_processor_id", "autofill_extracted_invoice_no",
    "autofill_extracted_invoice_date", "autofill_extracted_amount",
    "autofill_extracted_supplier_gstin", "autofill_extracted_receiver_gstin",
    "autofill_confidence_json", "autofill_all_entities_json",
    "autofill_line_items_json", "autofill_line_match_json",
)


def _load_cache():
    """Read extraction_cache.json (a list of entries); [] if it doesn't exist yet."""
    try:
        with open(_CACHE) as fh:
            return json.load(fh)
    except FileNotFoundError:
        return []


def _write_cache(entries):
    """Overwrite extraction_cache.json with `entries` (pretty JSON)."""
    with open(_CACHE, "w") as fh:
        json.dump(entries, fh, indent=2, default=str)


def _cache_line_rows(vi_name):
    return frappe.get_all(
        "Vendor Invoice Line",
        filters={"parent": vi_name, "parenttype": "Vendor Invoices"},
        fields=["description", "quantity", "rate", "amount", "tax_rate",
                "match_status", "match_source", "match_score", "po_item_id", "po_item_name"])


def _mapped_entry(vi):
    """A SUCCESS cache entry from an invoice's current DB state (line_mappings + autofill).
    `vi` may be a Document or a get_all _dict (both support .document_name/.invoice_no/.get)."""
    entry = {"invoice": vi.name, "po": vi.document_name, "invoice_no": vi.invoice_no,
             "status": "mapped", "content_hash": _content_hash(vi.invoice_attachment),
             "line_mappings": _cache_line_rows(vi.name)}
    for f in _AF_FIELDS:
        entry[f] = vi.get(f)
    return entry


def _failed_entry(invoice_name, po, invoice_no, attachment_id):
    """A FAILURE cache entry: no AI fields, no line items. Left for the Resolve UI to fill."""
    return {"invoice": invoice_name, "po": po, "invoice_no": invoice_no, "status": "failed",
            "content_hash": _content_hash(attachment_id), "line_mappings": []}


def _entry_key(e):
    """Canonical cache key = the Vendor Invoices docname (e.g. VI-2026-04448) — stable + UNIQUE,
    and identical across test/prod (dev envs are restored from the prod DB). Entries written before
    the docname was stored fall back to the (po, invoice_no) composite (back-compat)."""
    return e.get("invoice") or (e.get("po"), e.get("invoice_no"))


def _store(by_key, entry):
    """Put/replace `entry` under its docname key, dropping any legacy (po, invoice_no) key for the
    same invoice so upgrading a legacy entry doesn't leave a duplicate."""
    by_key.pop((entry.get("po"), entry.get("invoice_no")), None)
    by_key[_entry_key(entry)] = entry


def _cache_is_mapped(entry):
    """True if the entry is a success. 'failed' -> no; explicit 'mapped' -> yes; legacy entries
    (no status) with line_mappings -> yes (back-compat with the old export_cache format)."""
    if entry.get("status") == "failed":
        return False
    return entry.get("status") == "mapped" or bool(entry.get("line_mappings"))


def upsert_cache_entry(entry):
    """Insert/replace ONE entry by its invoice docname. Called by the Resolve UI on save so a UI
    fix flips the invoice's cache entry from 'failed' -> 'mapped' and ships to prod with the cache."""
    by_key = {_entry_key(e): e for e in _load_cache()}
    _store(by_key, entry)
    _write_cache(list(by_key.values()))


def export_cache(project=None):
    """OPTIONAL: re-snapshot the DB's MAPPED invoices into the cache, PRESERVING existing 'failed'
    entries. import_cache()/run() already writes the cache live; use this only to rebuild the
    mapped entries from the current DB (e.g. after out-of-band manual DB edits)."""
    project = project or PROJECT
    po_filter = {"status": ["!=", "Merged"]}
    if project:
        po_filter["project"] = ["=", project]
    pos = set(frappe.get_all("Procurement Orders", filters=po_filter, pluck="name"))

    by_key = {_entry_key(e): e for e in _load_cache()}   # keep existing (incl. failed)
    invs = frappe.get_all(
        "Vendor Invoices", filters={"document_type": "Procurement Orders"},
        fields=["name", "document_name", "invoice_no", "invoice_attachment", *_AF_FIELDS])
    mapped = 0
    for vi in invs:
        if vi.document_name not in pos or not _cache_line_rows(vi.name):
            continue                                    # skip PROs out of scope / unmapped invoices
        _store(by_key, _mapped_entry(vi))
        mapped += 1
    _write_cache(list(by_key.values()))
    print(f"[export_cache] {mapped} mapped invoices refreshed -> {_CACHE} "
          f"({len(by_key)} total entries, {project or 'ALL'})")


def import_cache(project=None, apply=False):
    """Extraction on the MISMATCH POs, cache-first. For each still-unmapped invoice:
        HIT  (mapped entry in cache) -> replay it, NO Gemini.
        FAIL (failed entry in cache) -> skip; leave it for the Resolve UI (no Gemini retry).
        MISS (not in cache)          -> Gemini reads it ONCE:
                                          success -> apply + register a 'mapped' entry;
                                          failure -> register a 'failed' entry (empty).
    The cache is REWRITTEN with the new entries (self-building). Recompute per PO.
    apply=False = dry preview (nothing written; the cache is not touched)."""
    from nirmaan_stack.api.invoices._item_billing_sync import recompute_po_invoice_qty

    project = project or PROJECT
    by_key = {_entry_key(e): e for e in _load_cache()}
    print(f"[import_cache] {len(by_key)} cached invoices. scope={project or 'ALL'}  apply={apply}\n")

    mismatched = _find_mismatched(project)
    hit = fail_skip = miss = new_ok = new_fail = 0
    changed = False
    for po in mismatched:
        po_doc = frappe.get_doc("Procurement Orders", po)
        for inv in _active_invoices(po):
            if _has_lines(inv.name):
                continue                                  # already mapped in DB -> its entry stays
            # look up by docname first (canonical), then the legacy (po, invoice_no) composite.
            entry = by_key.get(inv.name) or by_key.get((po, inv.invoice_no))
            if entry and _cache_is_mapped(entry):
                hit += 1
                print(f"  HIT   {inv.name}  ({po} / {inv.invoice_no})")
                if apply:
                    _apply_cache_entry(inv.name, entry, po_doc)
            elif entry and entry.get("status") == "failed":
                fail_skip += 1
                print(f"  FAIL  {inv.name}  ({po} / {inv.invoice_no}) — known failure, left for the UI")
            else:
                miss += 1
                print(f"  MISS  {inv.name}  ({po} / {inv.invoice_no}) -> Gemini")
                if apply:
                    vi = _gemini_apply(inv, po_doc)
                    if vi:
                        new_ok += 1
                        _store(by_key, _mapped_entry(vi))
                    else:
                        new_fail += 1
                        _store(by_key, _failed_entry(inv.name, po, inv.invoice_no, inv.invoice_attachment))
                        _log_failure(po, inv)
                    changed = True
        if apply:
            recompute_po_invoice_qty(po)
            frappe.db.commit()

    if apply and changed:
        _write_cache(list(by_key.values()))

    tag = "applied + cache updated" if apply else "DRY PREVIEW — nothing written"
    print(f"\n[import_cache] HIT {hit}  |  cached-fail skipped {fail_skip}  |  "
          f"MISS→Gemini {miss} (ok {new_ok}, failed {new_fail})  ({tag})")


def _apply_cache_entry(invoice_name, entry, po_doc):
    """Write a cached MAPPED extract onto an invoice: all autofill fields + re-resolved line_mappings."""
    vi = frappe.get_doc("Vendor Invoices", invoice_name)
    for f in _AF_FIELDS:
        setattr(vi, f, entry.get(f))
    vi.autofill_used = 1
    vi.set("line_mappings", [_resolve_row(m, po_doc) for m in entry.get("line_mappings", [])])
    _save_no_modified(vi)


def _resolve_row(m, po_doc):
    """Re-resolve a cached mapping's po_item_row against THIS PO's items (by name, then id)."""
    it = (next((x for x in po_doc.items if x.item_name == m.get("po_item_name")), None)
          or next((x for x in po_doc.items if x.item_id == m.get("po_item_id")), None))
    row = {
        "description": m.get("description"), "quantity": _num(m.get("quantity")),
        "rate": _num(m.get("rate")), "amount": _num(m.get("amount")),
        "tax_rate": _num(m.get("tax_rate")),
        "match_status": m.get("match_status") or "Unmatched",
        "match_source": m.get("match_source") or "", "match_score": _num(m.get("match_score")),
    }
    if it and m.get("match_status") == "Matched":
        row.update({"po_item_id": it.item_id, "po_item_row": it.name, "po_item_name": it.item_name})
    return row


def _content_hash(attachment_id):
    """Lightweight file identity for the cache (the attachment's file_url)."""
    return (frappe.db.get_value("Nirmaan Attachments", attachment_id, "attachment")
            if attachment_id else None)


def _gemini_apply(inv, po_doc):
    """Cache MISS: a non-interactive Gemini read + apply. Returns the applied Vendor Invoices
    doc on success (>= MIN_MATCH), or None on any failure (no file / low match / error)."""
    from nirmaan_stack.api.invoice_autofill import extract_invoice_fields
    fu = (frappe.db.get_value("Nirmaan Attachments", inv.invoice_attachment, "attachment")
          if inv.invoice_attachment else None)
    if not fu:
        return None
    try:
        res = extract_invoice_fields(fu, docname=po_doc.name)
        lm = (res or {}).get("line_match") or {}
        s = lm.get("summary", {})
        m, u = s.get("matched", 0), s.get("unmatched", 0)
        if m / max(1, m + u) < MIN_MATCH:
            return None
        vi = frappe.get_doc("Vendor Invoices", inv.name)
        _apply_autofill(vi, res, po_doc)
        _save_no_modified(vi)
        return vi
    except Exception:
        return None
