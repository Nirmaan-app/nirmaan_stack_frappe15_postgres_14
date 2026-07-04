import frappe

# Backfill `Purchase Order Item.invoice_qty`. THREE steps, run IN ORDER, deliberately:
#
#   1. execute()          -- deterministic backfill for EVERY live PO. No AI. Run FIRST.
#                            Leaves the under-invoiced ("MISMATCH") POs at ordered qty.
#
#   2. run_extraction()   -- run AFTER the backfill. Reads the MISMATCH POs' invoices with
#                            Gemini, ONE AT A TIME, and prints ✓/✗ for each. When an invoice
#                            FAILS (no file, or < MIN_MATCH) it PAUSES and lets you fix it in
#                            the terminal (type the qty per item); once fixed it continues to
#                            the next. Anything you SKIP is written to the failure log so you
#                            can come back to it. Needs the files (S3) + Document AI live.
#
#   3. manual_fix()       -- fix a single logged/failed invoice later, from the terminal.
#
# invoice_qty is durable because every fix is saved as LINE MAPPINGS (never a raw number),
# so recompute keeps deriving it. NOT wired into patches.txt -- run each step deliberately.

MIN_MATCH = 0.70
TOL = 1.0
# TESTING SCOPE: run on ONE project only. Set to None to backfill ALL projects.
PROJECT = "GAUTAM_BUDDHA_NAGAR-PROJ-00074"   # Maconns Noida (set None for the full run)
_COUNTED = ("Pending", "Approved")

import os
_BENCH = frappe.utils.get_bench_path()          # the bench dir on dev AND prod (portable)
_FAIL_LOG = os.path.join(_BENCH, "extraction_failures.log")
_CACHE = os.path.join(_BENCH, "extraction_cache.json")


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
    print(f"    {counts['MISMATCH']} MISMATCH POs left at ordered qty — run run_extraction() next.")


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
    the extraction path (run_extraction) can read its files, write the line mappings, and
    recompute the EXACT invoice_qty. The backfill only sets the CERTAIN cases.
    """
    if bucket == "MISMATCH":
        return                                        # left for the extraction path
    items = frappe.get_all(
        "Purchase Order Item",
        filters={"parent": po_name, "parenttype": "Procurement Orders"},
        fields=["name", "quantity"],
    )
    if bucket == "EXACT":
        summed = _line_sums(po_name)
        value_of = lambda it: summed.get(it.name, 0)
    elif bucket == "ZERO":
        value_of = lambda it: 0
    else:  # COMPLETED / DIRECT -> ordered qty
        value_of = lambda it: float(it.quantity or 0)
    for it in items:
        frappe.db.set_value("Purchase Order Item", it.name, "invoice_qty",
                            value_of(it), update_modified=False)


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
# STEP 2 — interactive extraction of the MISMATCH POs (run AFTER execute()).
# One invoice at a time: ✓ auto-map on success, ✗ pause + fix on failure, skip -> log.
# =============================================================================
def run_extraction(project=None):
    from nirmaan_stack.api.invoices._item_billing_sync import recompute_po_invoice_qty

    project = project or PROJECT   # default to the test scope; pass a project to override
    mismatched = _find_mismatched(project)
    print(f"[extraction] {len(mismatched)} MISMATCH POs to read"
          f"{f' in {project}' if project else ''}. Failures log -> {_FAIL_LOG}\n")

    exact, incomplete = 0, 0
    for idx, po in enumerate(mismatched, 1):
        po_doc = frappe.get_doc("Procurement Orders", po)
        active = _active_invoices(po)
        print(f"\n[{idx}/{len(mismatched)}] {po}  ({len(active)} invoices)")

        any_skipped = False
        for inv in active:
            if _has_lines(inv.name):                 # already mapped (earlier run) -> leave it
                print(f"    · {inv.invoice_no or inv.name}: already mapped")
                continue
            result = _extract_one(inv, po, po_doc)    # ("auto", res) | ("manual", rows) | None
            if result is None:
                any_skipped = True
                _log_failure(po, inv)
                continue
            kind, payload = result
            vi = frappe.get_doc("Vendor Invoices", inv.name)
            if kind == "auto":
                _apply_autofill(vi, payload, po_doc)  # line_mappings + all autofill_* fields
            else:                                     # manual fix -> line_mappings only
                vi.set("line_mappings", payload)
            _save_no_modified(vi)

        recompute_po_invoice_qty(po)                  # EXACT if ALL mapped, else stays ordered qty
        frappe.db.commit()
        if any_skipped:
            incomplete += 1
            print(f"  → {po}: INCOMPLETE — stays ordered qty (skipped invoices logged)")
        else:
            exact += 1
            print(f"  → {po}: EXACT ✓")

    print(f"\n[extraction] EXACT {exact}  |  incomplete {incomplete}  of {len(mismatched)}")
    if incomplete:
        print(f"  skipped/failed invoices are in {_FAIL_LOG} — fix each with manual_fix(...)")


def _extract_one(inv, po, po_doc):
    """Read + map ONE invoice. Returns:
        ("auto", res)    -- Gemini succeeded -> line_mappings + all autofill_* fields from res
        ("manual", rows) -- you hand-fixed it -> line_mappings only
        None             -- you skipped it
    Prints ✓ on success, ✗ + reason on failure (then prompts to fix or skip)."""
    from nirmaan_stack.api.invoice_autofill import extract_invoice_fields

    fu = (frappe.db.get_value("Nirmaan Attachments", inv.invoice_attachment, "attachment")
          if inv.invoice_attachment else None)
    reason, line_match = None, None
    if not fu:
        reason = "no file"
    else:
        try:
            res = extract_invoice_fields(fu, docname=po)          # reads file + Gemini
            lm = (res or {}).get("line_match") or {}
            s = lm.get("summary", {})
            m, u = s.get("matched", 0), s.get("unmatched", 0)
            success = m / max(1, m + u)
            if success >= MIN_MATCH:
                print(f"    ✓ {inv.invoice_no or inv.name}: {m} matched ({success:.0%})")
                return ("auto", res)
            reason = f"match {success:.0%} < {MIN_MATCH:.0%}"
            line_match = lm       # keep the read lines so the fix can DROPDOWN-map the unmatched ones
        except Exception as e:
            reason = str(e)[:50]

    print(f"    ✗ {inv.invoice_no or inv.name}: FAILED ({reason})")
    rows = _prompt_fix(inv, po_doc, line_match)
    return ("manual", rows) if rows is not None else None


def _apply_autofill(vi, res, po_doc):
    """Populate line_mappings AND every autofill_* field from the extract response, so the
    invoice is identical to a UI-autofilled one (recon UI + auto-approve gates + cacheable)."""
    import json
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


def _prompt_fix(inv, po_doc, line_match=None):
    """Terminal fix for a failed invoice. Shows the PO items as a NUMBERED DROPDOWN, then:
      - Gemini read lines (match-failure): keeps the matched lines and asks you to pick the
        item # for each UNMATCHED line (its qty comes from the read);
      - no lines (file unreadable): you type the qty per item.
    Returns line-mapping rows, or None to skip (and log)."""
    import json
    from nirmaan_stack.api.delivery_notes.update_invoice_data import build_line_mapping_rows

    ans = input(f"      fix invoice {inv.invoice_no or inv.name} now? "
                f"[y = map, n = skip & log]: ").strip().lower()
    if ans != "y":
        return None

    items = po_doc.items
    print("      PO items — pick by number:")
    for i, it in enumerate(items, 1):
        print(f"        [{i}] {it.item_name}  (ordered {it.quantity})")

    mappings = (line_match or {}).get("mappings") or []
    if mappings:
        # match-failure: keep matched lines; DROPDOWN-map each UNMATCHED line to a PO item #.
        for mrow in mappings:
            if mrow.get("status") == "matched" and mrow.get("po_row") is not None:
                continue                                  # already matched -> keep
            desc = (mrow.get("description") or "")[:40]
            sel = input(f"        map '{desc}' qty {mrow.get('quantity')} -> item # [0=skip]: ").strip()
            if sel.isdigit() and 1 <= int(sel) <= len(items):
                mrow["status"] = "matched"
                mrow["source"] = "manual"
                mrow["po_row"] = int(sel) - 1             # index into po_doc.items
        rows = build_line_mapping_rows(json.dumps(line_match), po_doc)
    else:
        # file-failure: no lines -> type the qty per item (same numbering).
        rows = []
        for i, it in enumerate(items, 1):
            val = input(f"        [{i}] {it.item_name} qty [blank=none]: ").strip()
            if not val:
                continue
            try:
                q = float(val)
            except ValueError:
                print("        ?? not a number — item skipped")
                continue
            rows.append({
                "description": it.item_name, "quantity": q, "match_status": "Matched",
                "match_source": "Manual", "po_item_id": it.item_id,
                "po_item_row": it.name, "po_item_name": it.item_name,
            })
    matched = sum(1 for r in rows if r.get("match_status") == "Matched")
    print(f"        → {matched} line(s) mapped")
    return rows


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
    """Note a skipped/failed PO+invoice so it can be fixed later (tab-separated)."""
    line = f"{frappe.utils.now()}\t{po}\t{inv.name}\t{inv.invoice_no}\t{inv.invoice_amount}\n"
    with open(_FAIL_LOG, "a") as fh:
        fh.write(line)


# =============================================================================
# STEP 3 — fix a single logged/failed invoice from the terminal (no UI).
# =============================================================================
def manual_fix(invoice_name, qty_by_item):
    """Hand-map ONE failed invoice (from the log) in bench console:
        manual_fix("<vendor-invoice-name>", {"LUGS 1.5 SQMM": 3000, "LUGS 2.5 SQMM": 4800})
    Writes LINE MAPPINGS (not a raw number) -> recompute -> EXACT once all the PO's invoices
    are mapped. Item names must match the PO exactly."""
    from nirmaan_stack.api.invoices._item_billing_sync import recompute_po_invoice_qty

    vi = frappe.get_doc("Vendor Invoices", invoice_name)
    po_doc = frappe.get_doc("Procurement Orders", vi.document_name)
    by_name = {it.item_name: it for it in po_doc.items}

    rows, unknown = [], []
    for item_name, qty in qty_by_item.items():
        it = by_name.get(item_name)
        if not it:
            unknown.append(item_name); continue
        rows.append({
            "description": item_name, "quantity": float(qty), "match_status": "Matched",
            "match_source": "Manual", "po_item_id": it.item_id,
            "po_item_row": it.name, "po_item_name": it.item_name,
        })
    if unknown:
        print(f"  !! item names not on {vi.document_name}: {unknown} — nothing written")
        return

    vi.set("line_mappings", rows)
    _save_no_modified(vi)
    recompute_po_invoice_qty(vi.document_name)
    frappe.db.commit()
    print(f"  ✓ mapped {invoice_name}; recomputed {vi.document_name} "
          f"(EXACT once all its invoices are mapped)")


# =============================================================================
# CACHE — extract once on TEST, replay on PROD (no Gemini for cached invoices).
# =============================================================================
_AF_FIELDS = (
    "autofill_used", "autofill_processor_id", "autofill_extracted_invoice_no",
    "autofill_extracted_invoice_date", "autofill_extracted_amount",
    "autofill_extracted_supplier_gstin", "autofill_extracted_receiver_gstin",
    "autofill_confidence_json", "autofill_all_entities_json",
    "autofill_line_items_json", "autofill_line_match_json",
)


def export_cache(project=None):
    """TEST: write every MAPPED invoice's full autofill data -> extraction_cache.json.
    Opens the file with "w" -> CLEARS any existing content and regenerates it FRESH from
    the current DB each run (so it always mirrors the latest extraction + manual fixes)."""
    import json
    project = project or PROJECT

    po_filter = {"status": ["!=", "Merged"]}
    if project:
        po_filter["project"] = ["=", project]
    pos = set(frappe.get_all("Procurement Orders", filters=po_filter, pluck="name"))

    invs = frappe.get_all(
        "Vendor Invoices", filters={"document_type": "Procurement Orders"},
        fields=["name", "document_name", "invoice_no", "invoice_attachment", *_AF_FIELDS])

    entries = []
    for vi in invs:
        if vi.document_name not in pos:
            continue
        lm = frappe.get_all(
            "Vendor Invoice Line",
            filters={"parent": vi.name, "parenttype": "Vendor Invoices"},
            fields=["description", "quantity", "rate", "amount", "tax_rate",
                    "match_status", "match_source", "match_score", "po_item_id", "po_item_name"])
        if not lm:
            continue                                    # only invoices that actually got mapped
        entry = {"po": vi.document_name, "invoice_no": vi.invoice_no,
                 "content_hash": _content_hash(vi.invoice_attachment), "line_mappings": lm}
        for f in _AF_FIELDS:
            entry[f] = vi.get(f)
        entries.append(entry)

    with open(_CACHE, "w") as fh:                       # "w" = truncate (clear) + write fresh
        json.dump(entries, fh, indent=2, default=str)
    print(f"[export_cache] wrote {len(entries)} invoices -> {_CACHE} (fresh, {project or 'ALL'})")


def import_cache(project=None, apply=False):
    """PROD: replay the cache onto each mismatched PO's invoices.
        HIT  (po + invoice_no in cache) -> set all autofill fields + line_mappings, NO Gemini.
        MISS (not cached)               -> non-interactive Gemini read + apply (else logged).
    Then recompute per PO. apply=False = dry preview (nothing written)."""
    import json
    from nirmaan_stack.api.invoices._item_billing_sync import recompute_po_invoice_qty

    project = project or PROJECT
    try:
        with open(_CACHE) as fh:
            cache = json.load(fh)
    except FileNotFoundError:
        print(f"[import_cache] no cache file at {_CACHE}"); return
    by_key = {(e["po"], e["invoice_no"]): e for e in cache}
    print(f"[import_cache] {len(cache)} cached invoices. scope={project or 'ALL'}  apply={apply}\n")

    mismatched = _find_mismatched(project)
    hit = miss = failed = 0
    for po in mismatched:
        po_doc = frappe.get_doc("Procurement Orders", po)
        for inv in _active_invoices(po):
            if _has_lines(inv.name):
                continue
            entry = by_key.get((po, inv.invoice_no))
            if entry:
                hit += 1
                print(f"  HIT  {po} / {inv.invoice_no}")
                if apply:
                    _apply_cache_entry(inv.name, entry, po_doc)
            else:
                miss += 1
                print(f"  MISS {po} / {inv.invoice_no} -> Gemini")
                if apply and not _gemini_apply(inv, po_doc):
                    failed += 1
                    _log_failure(po, inv)
        if apply:
            recompute_po_invoice_qty(po)
            frappe.db.commit()

    tag = "applied" if apply else "DRY PREVIEW — nothing written"
    print(f"\n[import_cache] HIT {hit}  |  MISS→Gemini {miss}  |  failed {failed}  ({tag})")


def _apply_cache_entry(invoice_name, entry, po_doc):
    """Write a cached extract onto an invoice: all autofill fields + re-resolved line_mappings."""
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
    """Cache MISS fallback: a non-interactive Gemini read + apply. Returns True on success."""
    from nirmaan_stack.api.invoice_autofill import extract_invoice_fields
    fu = (frappe.db.get_value("Nirmaan Attachments", inv.invoice_attachment, "attachment")
          if inv.invoice_attachment else None)
    if not fu:
        return False
    try:
        res = extract_invoice_fields(fu, docname=po_doc.name)
        lm = (res or {}).get("line_match") or {}
        s = lm.get("summary", {})
        m, u = s.get("matched", 0), s.get("unmatched", 0)
        if m / max(1, m + u) < MIN_MATCH:
            return False
        vi = frappe.get_doc("Vendor Invoices", inv.name)
        _apply_autofill(vi, res, po_doc)
        _save_no_modified(vi)
        return True
    except Exception:
        return False
