#!/usr/bin/env python
"""
invoice_qty backfill — PLAN + EXTRACTION PREVIEW in ONE file. READ-ONLY.

Stage 1 (dry run, ALL projects, NO AI): classify every live PO and print the
  invoice_qty it would get. Self-classifying — mirrors recompute_po_invoice_qty:
    EXACT   -- every counted invoice is line-mapped        -> sum of signed matched qty.
    ORDERED -- not all mapped, has invoices (or Completed)  -> ordered qty.
    ZERO    -- no invoices (and project not Completed)      -> 0.
  An UNDER-invoiced ORDERED PO ("mismatch") gets ordered qty NOW; the HELD Gemini
  extraction will later read ALL its invoices and refine it to the exact qty.

Stage 2 (extraction preview, Gemini): HELD in dev (RUN_EXTRACTION = False). For each
  mismatched PO it reads every invoice image, maps the lines, shows the exact qty.

CREDIT NOTES: an invoice with a NEGATIVE amount is skipped (like Rejected) -- it never
  adds qty or corrects price; invoice_qty derives only from positive invoices.

It WRITES NOTHING (no set_value, no commit).

Run inside the dev container:
  docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 \
      env/bin/python /workspace/development/frappe-bench/dry_run_invoice_qty.py
"""
import os
os.chdir("/workspace/development/frappe-bench/sites")   # required before frappe.init
import frappe
frappe.init(site="localhost")
frappe.connect()
from collections import defaultdict

# ---- config -----------------------------------------------------------------
TOL                = 1.0      # Rs rounding cushion: a few Rs under the PO still counts as fully invoiced
MIN_MATCH          = 0.70     # extraction quality gate: >=70% of item lines must map or the invoice FAILs
RUN_EXTRACTION     = False     # Stage 2 on/off. False = pure dry run (no Gemini, no cost, no file reads).
EXTRACTION_PROJECT = None   # limit Stage 2 Gemini to this project; None = ALL mismatched POs


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


# ---- bulk reads (read-only) -------------------------------------------------
proj_status = dict(frappe.db.sql("""SELECT name, COALESCE(status, '') FROM "tabProjects" """))
proj_name = dict(frappe.db.sql("""SELECT name, COALESCE(project_name, name) FROM "tabProjects" """))

pos = frappe.db.sql(
    """SELECT name, project, COALESCE(total_amount, 0) AS amt
       FROM "tabProcurement Orders" WHERE status != 'Merged'""",   # Merged -> superseded by revisions
    as_dict=True,
)

invs = frappe.db.sql(
    """SELECT document_name AS po, name, invoice_no, status,
              COALESCE(invoice_amount, 0) AS invoice_amount, invoice_attachment
       FROM "tabVendor Invoices" WHERE document_type = 'Procurement Orders'""",
    as_dict=True,
)
inv_by_po = defaultdict(list)
for i in invs:
    inv_by_po[i.po].append(i)

# invoices that already carry line mappings (exact truth we must not clobber)
has_lines = {
    r[0] for r in frappe.db.sql(
        """SELECT DISTINCT parent FROM "tabVendor Invoice Line" WHERE parenttype = 'Vendor Invoices'"""
    )
}

# ordered-qty item-row count per PO (for the "rows written" tally)
item_count = dict(frappe.db.sql(
    """SELECT parent, COUNT(*) FROM "tabPurchase Order Item"
       WHERE parenttype = 'Procurement Orders' GROUP BY parent"""))

# Additional Charges (freight / P&F / etc.) NEVER get an invoice_qty -> always 0 (mirrors the
# patch's Additional-Charges rule). Count per PO so the ordered-qty tally excludes them.
addl_count = dict(frappe.db.sql(
    """SELECT parent, COUNT(*) FROM "tabPurchase Order Item"
       WHERE parenttype = 'Procurement Orders' AND category = 'Additional Charges' GROUP BY parent"""))


# =============================================================================
# STAGE 1 — classify every live PO (mirrors the patch's derivation)
# =============================================================================
def classify(project_status, po_total, po_invs):
    """Return (bucket, reason). bucket ∈ EXACT / COMPLETED / DIRECT / MISMATCH / ZERO.

    COMPLETED, DIRECT and MISMATCH all get invoice_qty = ordered qty (choice-i) -- the
    split is only for the review lists. `reason` explains WHY a MISMATCH PO is flagged.
    """
    # COUNTED = not Rejected AND amount >= 0 (a credit note = negative amount = skipped).
    active = [i for i in po_invs if i.status != "Rejected" and num(i.invoice_amount) >= 0]

    # EXACT -- every counted invoice has line data (ALL-OR-NOTHING) -> sum signed matched qty.
    if active and all(i.name in has_lines for i in active):
        return "EXACT", ""

    # COMPLETED project -> ordered qty directly (trusted fully billed, NO amount check).
    if project_status == "Completed":
        return "COMPLETED", ""

    # No counted invoices (and not Completed) -> 0.
    if not active:
        return "ZERO", ""

    # Has invoices, not all mapped, not Completed:
    net = sum(num(i.invoice_amount) for i in active)
    all_approved = all(i.status == "Approved" for i in active)
    if all_approved and net >= po_total - TOL:
        return "DIRECT", ""              # fully invoiced -> ordered qty, no extraction needed

    # MISMATCH -> ordered qty NOW, needs extraction to refine. Build the WHY.
    reasons = []
    if not all_approved:
        n_pending = sum(1 for i in active if i.status != "Approved")
        reasons.append(f"{n_pending} pending invoice(s)")
    if net < po_total - TOL:
        reasons.append(f"under-invoiced short {po_total - net:,.0f}")
    return "MISMATCH", " + ".join(reasons) or "under-invoiced"


counts = defaultdict(int)
ordered_rows = 0
addl_zero_rows = 0    # Additional Charges rows -> invoice_qty 0 (never ordered qty)
extraction = []       # MISMATCH POs (under-invoiced) -> the (held) Gemini extraction list
direct_ordered = []   # COMPLETED + DIRECT POs -> ordered qty directly, no extraction

for p in pos:
    bucket, reason = classify(proj_status.get(p.project, ""), num(p.amt), inv_by_po.get(p.name, []))
    counts[bucket] += 1
    if bucket in ("COMPLETED", "DIRECT", "MISMATCH"):
        # Additional Charges rows get 0 (never ordered qty) -> exclude them from the tally.
        ordered_rows += int(item_count.get(p.name, 0)) - int(addl_count.get(p.name, 0))
        addl_zero_rows += int(addl_count.get(p.name, 0))
    if bucket in ("COMPLETED", "DIRECT"):
        direct_ordered.append({
            "project": p.project or "(no project)", "po": p.name,
            "amt": num(p.amt), "bucket": bucket,
        })
    elif bucket == "MISMATCH":
        active = [i for i in inv_by_po[p.name]
                  if i.status != "Rejected" and num(i.invoice_amount) >= 0]   # positive invoices to extract
        credits = [i for i in inv_by_po[p.name]
                   if i.status != "Rejected" and num(i.invoice_amount) < 0]   # credit notes (skipped)
        net = sum(num(i.invoice_amount) for i in active)
        extraction.append({
            "project": p.project or "(no project)", "po": p.name,
            "amt": num(p.amt), "net": net, "n_inv": len(active),
            "invoices": active, "n_credit": len(credits), "reason": reason,
        })

n_completed = sum(1 for s in proj_status.values() if s == "Completed")
print("\n=========== STAGE 1: DRY RUN (all projects, no AI) — NOTHING WRITTEN ===========")
print(f"Projects: {n_completed} Completed  |  {len(proj_status) - n_completed} others")
print(f"Live POs (excl. Merged): {len(pos)}\n")
print("Bucket counts (POs) — the invoice_qty each PO gets NOW:")
print(f"  COMPLETED {counts['COMPLETED']:>5}   -> ordered qty  (project Completed -> directly)")
print(f"  DIRECT    {counts['DIRECT']:>5}   -> ordered qty  (fully invoiced, not completed -> directly)")
print(f"  MISMATCH  {counts['MISMATCH']:>5}   -> ordered qty NOW  (under-invoiced -> HELD Gemini refines to exact)")
print(f"  EXACT     {counts['EXACT']:>5}   -> sum of mapped line qty")
print(f"  ZERO      {counts['ZERO']:>5}   -> 0  (no invoices)")
print(f"\n  ordered qty on ~{ordered_rows} Purchase Order Item rows"
      f"  (COMPLETED {counts['COMPLETED']} + DIRECT {counts['DIRECT']} + MISMATCH {counts['MISMATCH']})")
print(f"  Additional Charges rows -> invoice_qty 0 (excluded from ordered qty): ~{addl_zero_rows} rows")

# ---- mismatch breakdown, PROJECT-WISE (how many POs + invoices mismatched per project) ----
by_proj = defaultdict(lambda: {"pos": 0, "invoices": 0})
for e in extraction:
    by_proj[e["project"]]["pos"] += 1
    by_proj[e["project"]]["invoices"] += e["n_inv"]

tot_pos = sum(d["pos"] for d in by_proj.values())
tot_inv = sum(d["invoices"] for d in by_proj.values())

print(f"\nMISMATCH SUMMARY — per project  "
      f"({len(by_proj)} projects · {tot_pos} mismatched POs · {tot_inv} invoices):")
print(f"  {'PROJECT':<34}{'mismatch POs':>14}{'invoices':>10}")
for proj in sorted(by_proj):
    d = by_proj[proj]
    print(f"  {proj:<34}{d['pos']:>14}{d['invoices']:>10}")
print(f"  {'TOTAL':<34}{tot_pos:>14}{tot_inv:>10}")

# resolve which invoice attachments actually have a file (extraction needs the file)
att_ids = tuple({i.invoice_attachment for e in extraction for i in e["invoices"] if i.invoice_attachment})
has_file = set()
if att_ids:
    has_file = {r[0] for r in frappe.db.sql(
        """SELECT name FROM "tabNirmaan Attachments"
           WHERE name IN %(ids)s AND COALESCE(attachment, '') != ''""",
        {"ids": att_ids})}

print("\nMISMATCHED POs — full detail (amount gap + the invoices to extract):")
last = None
for e in sorted(extraction, key=lambda x: (x["project"], x["po"])):
    if e["project"] != last:
        d = by_proj[e["project"]]
        print(f"\n  === {e['project']}  ({d['pos']} POs · {d['invoices']} invoices) ===")
        last = e["project"]
    tag = f"   ({e['n_credit']} credit note skipped)" if e["n_credit"] else ""
    print(f"     {e['po']:<24} PO {e['amt']:>13,.0f}  invoiced {e['net']:>13,.0f}"
          f"  short {e['amt'] - e['net']:>12,.0f}   [{e['n_inv']} inv]{tag}")
    print(f"          WHY mismatched: {e['reason']}")
    for inv in e["invoices"]:
        ok = "file OK" if inv.invoice_attachment in has_file else "NO FILE"
        print(f"          - {(inv.invoice_no or inv.name):<24} {inv.status:<10}"
              f" Rs {num(inv.invoice_amount):>12,.0f}   [{ok}]")

# extraction feasibility: how many of the to-extract invoices actually have a file
all_inv = [i for e in extraction for i in e["invoices"]]
with_file = sum(1 for i in all_inv if i.invoice_attachment in has_file)
print(f"\nEXTRACTION FEASIBILITY: {with_file}/{len(all_inv)} invoices have a file (extractable)"
      f"  |  {len(all_inv) - with_file} missing file -> manual")

# ---- FLAT LIST: every mismatched invoice (project | PO | invoice_no | invoice amount) ----
print(f"\nFLAT LIST — all mismatched invoices ({len(all_inv)}):")
print(f"  {'#':>3}  {'PROJECT':<32}  {'PO':<24}  {'INVOICE NO':<24}  {'INVOICE AMT':>13}")
n = 0
for e in sorted(extraction, key=lambda x: (x["project"], x["po"])):
    for inv in e["invoices"]:
        n += 1
        print(f"  {n:>3}  {e['project']:<32}  {e['po']:<24}  "
              f"{(inv.invoice_no or inv.name):<24}  {num(inv.invoice_amount):>13,.0f}")

# ---- CSV exports (output files, NOT DB changes) -----------------------------
import csv
_BENCH = "/workspace/development/frappe-bench"

# 1) MISMATCHED invoices — one row per invoice, WITH the reason it's mismatched.
with open(f"{_BENCH}/mismatched_invoices.csv", "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["project_name", "project_id", "po", "po_amount", "invoice_no",
                "invoice_amount", "status", "file_ok", "reason"])
    for e in sorted(extraction, key=lambda x: (x["project"], x["po"])):
        for inv in e["invoices"]:
            w.writerow([
                proj_name.get(e["project"], e["project"]), e["project"], e["po"], f"{e['amt']:.2f}",
                inv.invoice_no or inv.name, f"{num(inv.invoice_amount):.2f}",
                inv.status, "yes" if inv.invoice_attachment in has_file else "no", e["reason"],
            ])
print(f"\nCSV written: {_BENCH}/mismatched_invoices.csv  ({len(all_inv)} rows)")

# 2) DIRECT-ORDERED POs — the ones that get ordered qty WITHOUT extraction, one row
#    per PO, with bucket = COMPLETED (project done) or DIRECT (fully invoiced, not completed).
with open(f"{_BENCH}/direct_ordered_pos.csv", "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["bucket", "project_name", "project_id", "po", "po_amount"])
    for d in sorted(direct_ordered, key=lambda x: (x["bucket"], x["project"], x["po"])):
        w.writerow([d["bucket"], proj_name.get(d["project"], d["project"]),
                    d["project"], d["po"], f"{d['amt']:.2f}"])
n_comp = sum(1 for d in direct_ordered if d["bucket"] == "COMPLETED")
n_dir = sum(1 for d in direct_ordered if d["bucket"] == "DIRECT")
print(f"CSV written: {_BENCH}/direct_ordered_pos.csv  "
      f"({len(direct_ordered)} POs — COMPLETED {n_comp} + DIRECT {n_dir})")


# =============================================================================
# STAGE 2 — extraction preview (Gemini) on the mismatched POs from Stage 1
# =============================================================================
if not RUN_EXTRACTION:
    print("\n(Stage 2 skipped: RUN_EXTRACTION = False)\n")
    frappe.destroy()
    raise SystemExit

from nirmaan_stack.api.invoice_autofill import extract_invoice_fields   # reuse the real extractor

targets = [(e["project"], e["po"]) for e in sorted(extraction, key=lambda x: (x["project"], x["po"]))
           if EXTRACTION_PROJECT is None or e["project"] == EXTRACTION_PROJECT]

print("\n=========== STAGE 2: EXTRACTION PREVIEW (Gemini) — NOTHING WRITTEN ===========")
print(f"Scope: {EXTRACTION_PROJECT or 'ALL projects'}   |   mismatched POs to read: {len(targets)}\n")


def resolve(att):
    # invoice_attachment -> Nirmaan Attachments.attachment (a file_url)
    return frappe.db.get_value("Nirmaan Attachments", att, "attachment") if att else None


overall = {"PASS": 0, "FAIL": 0}
for proj, po in targets:
    active = [i for i in inv_by_po[po]
              if i.status != "Rejected" and num(i.invoice_amount) >= 0]   # positive invoices only (skip credit notes)
    print(f"================ {po}  ({proj}) ================")
    po_ok = True
    per_item = defaultdict(float)   # po_item_name -> NET matched qty (credit notes subtract)

    for inv in active:
        f = resolve(inv.invoice_attachment)
        sign = -1.0 if num(inv.invoice_amount) < 0 else 1.0   # credit note (negative amount) -> SUBTRACT
        kind = "CREDIT" if sign < 0 else "invoice"
        if not f:
            print(f"  {kind} {inv.invoice_no or inv.name}: NO FILE -> FAIL")
            po_ok = False
            continue
        try:
            res = extract_invoice_fields(f, docname=po)                 # reads file + calls Gemini
            lm = (res or {}).get("line_match") or {}
            s = lm.get("summary", {})
            m, u = s.get("matched", 0), s.get("unmatched", 0)
            success = m / max(1, m + u)
            verdict = "PASS" if success >= MIN_MATCH else "FAIL"
            print(f"  {kind} {inv.invoice_no or inv.name} (Rs {num(inv.invoice_amount):,.0f}): "
                  f"{m} matched / {u} unmatched ({success:.0%}) -> {verdict}")
            for x in (lm.get("mappings") or []):
                tgt = x.get("po_item_name") or "-"
                print(f"       {(x.get('description') or '')[:38]:<40} q={num(x.get('quantity')):<8,.0f}"
                      f" amt={num(x.get('amount')):<10,.0f} [{x.get('status')}] -> {tgt}")
                if x.get("status") == "matched" and x.get("po_item_name"):
                    per_item[x["po_item_name"]] += sign * num(x.get("quantity"))
            if success < MIN_MATCH:
                po_ok = False
        except Exception as e:
            print(f"  {kind} {inv.invoice_no or inv.name}: ERROR {str(e)[:50]} -> FAIL")
            po_ok = False

    if po_ok:
        overall["PASS"] += 1
        rows = frappe.db.sql(
            """SELECT item_name, category, COALESCE(quantity, 0) AS ordered
               FROM "tabPurchase Order Item"
               WHERE parent = %s AND parenttype = 'Procurement Orders' ORDER BY idx""",
            (po,), as_dict=True,
        )
        print("  >>> PO PASS — resulting NET invoice_qty vs ordered:")
        for r in rows:
            if r.category == "Additional Charges":       # charges never carry an invoice_qty -> 0
                print(f"        {r.item_name[:44]:<46} ordered {r.ordered:>10,.0f}  invoice_qty {0:>10,.0f}  charge->0")
                continue
            q = per_item.get(r.item_name, 0.0)
            flag = "OVER" if q > r.ordered else ("full" if q == r.ordered else "partial")
            print(f"        {r.item_name[:44]:<46} ordered {r.ordered:>10,.0f}  invoice_qty {q:>10,.0f}  {flag}")
    else:
        overall["FAIL"] += 1
        print("  >>> PO FAIL — one+ invoice errored / <80% / no file -> MANUAL (writes nothing)")
    print()

print(f"STAGE 2 SUMMARY:  PASS {overall['PASS']}  |  FAIL {overall['FAIL']}  (of {len(targets)} mismatched POs)")
print("(no changes committed — preview only)\n")
frappe.destroy()
