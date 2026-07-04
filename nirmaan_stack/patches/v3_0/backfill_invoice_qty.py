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
_FAIL_LOG = "/workspace/development/frappe-bench/extraction_failures.log"


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
            vi.save(ignore_permissions=True)

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
    """MINIMAL change on the invoice: write line_mappings (the data recompute reads) and mark
    autofill_used = 1. Nothing else -- no audit-JSON snapshots. recompute (called right after
    the save, in run_extraction) then derives invoice_qty from these mappings."""
    import json
    from nirmaan_stack.api.delivery_notes.update_invoice_data import build_line_mapping_rows

    lm = (res or {}).get("line_match") or {}
    vi.set("line_mappings", build_line_mapping_rows(json.dumps(lm), po_doc))
    vi.autofill_used = 1


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
    vi.save(ignore_permissions=True)
    recompute_po_invoice_qty(vi.document_name)
    frappe.db.commit()
    print(f"  ✓ mapped {invoice_name}; recomputed {vi.document_name} "
          f"(EXACT once all its invoices are mapped)")
