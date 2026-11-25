#!/usr/bin/env python3
"""Walk Work Order invoice auto-approval (ADR-0050, ADR-0014 Amendment C).

    python3 .claude/skills/verify/bin/walk_wo_invoice_auto_approve.py --task <task> --user <procurement email> \
        --password <pw>

`wo_invoice_auto_approve_seed.py` (run first, here) makes three generated invoices A, B, C on a GST-off Work Order
the procurement user can see, and opens the made-up Accountant `walk-accountant@example.com`. Then:

1. As the Procurement Executive, who may upload but not approve: sidebar Work Orders, search the WO, open it.
2. Upload signed copy of A: the toast says the System approved it, A's row reads Approved. DB: its Vendor Invoice
   Approved by System, auto_approved 1; the record Approved (rule 1, decision 9).
3. Add Invoice of B's signed copy, the AI finding the signature box signed: linked and approved. DB as for A.
4. Add Invoice of C's copy, the AI finding the box empty: the dialog warns "Generated invoice not signed" above its
   button, which stays enabled; linked, C's row reads Signed. Rule 1 can't approve it and rules 2 and 3 don't match,
   so it is Pending. DB: `wo_generated_copy_not_signed` first, then the WO total and Amount Paid reasons.
5. Add Invoice of an ordinary bill D (a number no generated invoice has) matching neither rule: Pending. DB: its
   reasons carry the WO total, Amount Paid and the invoiced sum.
6. As the Accountant: sidebar Vendor Invoice Recon, Pending Invoice Approvals, WO: D's row shows both reasons with
   those figures, C's row "Generated invoice not signed" and its two.
7. Setup (`wo_invoice_auto_approve_match_setup.py`): the Accountant rejects every Pending invoice on the WO (C, D),
   any generated invoice not uploaded is voided, and the WO's FINAL E is generated for the rest of its total.
8. As the Procurement Executive: Add Invoice of E's copy, the box empty: the same warning, then rule 2 matches
   (Approved + E = the WO total), so E is approved by the System. DB: Approved by System; the record Approved.

The env has no Gemini key, so the walk answers the AI read itself: it serves the browser's call to
`extract_invoice_fields` with the number, amount and signature answer the AI would read off that file. Everything
after it, the upload, the save, the link and the System's decision, runs on the env's backend. Every check prints
`ok …`; a miss saves `FAIL.*` and exits 1. Evidence: `$VERIFY_OUT`, else ~/claude-artifacts/verify/<task>/<UTC time>/.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

from drive import save, session, sidebar
from playwright.sync_api import Page

ROOT = Path(__file__).resolve().parents[4]
BIN = ROOT / ".claude/skills/verify/bin"
DEVENV = str(ROOT / "scripts/devenv/devenv.sh")
EXTRACT = "**/api/method/nirmaan_stack.api.invoice_autofill.extract_invoice_fields*"

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--user", required=True, help="a Procurement Executive the app does not lock")
ap.add_argument("--password", required=True)
a = ap.parse_args()

misses = []


def expect(ok: bool, what: str) -> None:
    print(f"{'ok  ' if ok else 'MISS'} {what}")
    if not ok:
        misses.append(what)


def script(name: str, *args: str) -> dict:
    res = subprocess.run([DEVENV, "script", a.task, str(BIN / name), *args], capture_output=True, text=True,
                         timeout=600)
    line = next((ln for ln in reversed(res.stdout.splitlines()) if ln.startswith("{")), None)
    if line is None:
        sys.exit(f"{name} printed no JSON:\n{res.stdout}\n{res.stderr}")
    return json.loads(line)


def rupees(amount: float) -> str:
    """₹ in Indian grouping, rounded to the rupee, as the reason column shows it."""
    whole = str(int(round(abs(amount))))
    head, tail = whole[:-3], whole[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    text = ",".join(([head] if head else []) + groups + [tail])
    return ("-" if amount < 0 else "") + "₹" + text


seed = script("wo_invoice_auto_approve_seed.py", a.user)
# After the seed: it creates the made-up Accountant on a fresh env.
for user in (a.user, seed["accountant"]):
    subprocess.run([DEVENV, "run", a.task, "set-password", user, a.password], check=True, capture_output=True)
WO = seed["wo"]
A, B, C = seed["records"]
D_NO, D_AMOUNT = f"WALK-{date.today():%y%m%d}-RA{A['name'].rsplit('-', 1)[1]}", 1_234
SCANS = Path.home() / "claude-artifacts" / "verify" / a.task / "walk-wo-invoice-scans"


def scan(no: str) -> str:
    """A one-page PDF of its own for `no`: the upload refuses a file that is not a readable PDF, and Frappe reuses
    the URL of any File with the same bytes."""
    stream = f"BT /F1 14 Tf 60 760 Td (Walk invoice {no}) Tj ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        "/Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    body, offsets = "%PDF-1.4\n", []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(body))
        body += f"{i} 0 obj\n{obj}\nendobj\n"
    xref = len(body)
    body += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offsets)
    body += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    SCANS.mkdir(parents=True, exist_ok=True)
    path = SCANS / f"{no}.pdf"
    path.write_bytes(body.encode("latin-1"))
    return str(path)

answer = {}


def no_misses(part: str) -> None:
    """Raised inside a session, so `drive.session` saves FAIL.* and stamps the walk failed."""
    if misses:
        raise AssertionError(f"{part}: {len(misses)} miss(es): {misses}")


def ai_read(route):
    """The AI's answer for the file just picked: `answer` holds its number, amount and signature box."""
    no, amount, signature = answer["no"], answer["amount"], answer["signature"]
    entities = [{"type": "invoice_id", "value": no, "confidence": 1.0},
                {"type": "total_amount", "value": str(amount), "confidence": 1.0}]
    if signature:
        entities.append({"type": "authorized_signature", "value": signature, "confidence": 1.0})
    route.fulfill(json={"message": {
        "invoice_no": no, "invoice_date": date.today().isoformat(), "amount": str(amount),
        "net_amount": str(amount), "base_amount": str(amount), "gst_amount": "0", "gst_note": "",
        "supplier_gstin": "", "receiver_gstin": "", "entities": entities, "line_items": [],
        "confidence": {k: 1.0 for k in ("invoice_no", "invoice_date", "amount", "net_amount", "base_amount",
                                        "gst_amount")},
        "line_item_validation": None, "line_match": None, "credit_note_detected": False,
    }})


def open_work_order(page: Page, ready: str) -> None:
    """Open the WO the way the role does; `ready`: a generated invoice number whose row must show."""
    sidebar(page, "Work Orders")
    page.get_by_role("button", name=re.compile(r"^All WO\s*\d+$")).click()
    page.locator("a[href*='/service-requests/SR-']").first.wait_for(timeout=60_000)
    # The search box searches the service descriptions until "WO ID" is chosen beside it.
    page.get_by_role("combobox").filter(has_text="Item in WO").click()
    page.get_by_role("option", name="WO ID", exact=True).click()
    page.get_by_role("textbox", name=re.compile(r"^Search by WO ID")).fill(WO)
    page.locator(f"a[href*='/service-requests/{WO}']").first.click()
    page.get_by_text("Loading data...").wait_for(state="hidden", timeout=60_000)
    page.get_by_role("button", name=f"Print {ready}", exact=True).wait_for(timeout=60_000)


def toast(page: Page, text: str) -> bool:
    try:
        page.get_by_text(re.compile(re.escape(text))).first.wait_for(timeout=30_000)
        return True
    except Exception:
        return False


WARNING = "Generated invoice not signed"


def add_invoice(page: Page, no: str, amount: float, signature: str | None, warn: bool) -> None:
    """Add Invoice of `no`; `warn`: the dialog must (or must not) show the unsigned-copy warning above its button."""
    answer.update(no=no, amount=amount, signature=signature)
    page.get_by_role("button", name="Add Invoice", exact=True).first.click()
    dialog = page.get_by_role("alertdialog")
    dialog.get_by_text("Upload your invoice").wait_for()
    dialog.locator("input[type=file]").set_input_files(scan(no))
    dialog.locator("#invoice_no").wait_for(timeout=60_000)
    expect(dialog.locator("#invoice_no").input_value() == no, f"Add Invoice: the AI's number {no} is filled in")
    button = dialog.get_by_role("button", name="Add Invoice", exact=True)
    box = dialog.locator("div.rounded-md").filter(has_text=WARNING)
    if warn:
        try:
            box.first.wait_for(timeout=10_000)
        except Exception:
            pass
    else:
        page.wait_for_timeout(1_500)
    shown = box.count() > 0 and box.first.is_visible()
    expect(shown == warn, f"Add Invoice of {no}: the {WARNING!r} warning is {'shown' if warn else 'not shown'}")
    if shown:
        # Greyed only while the dialog's duplicate-number check runs; the warning itself never blocks.
        for _ in range(40):
            if button.is_enabled():
                break
            page.wait_for_timeout(500)
        expect(button.is_enabled(), f"Add Invoice of {no}: the warning does not block, the button is enabled")
        save(page, out_dir, f"add-invoice-warning-{no}")
    button.click()
    expect(toast(page, "Success"), f"Add Invoice of {no}: saved")
    dialog.wait_for(state="hidden", timeout=30_000)


def generated_row(page: Page, no: str):
    """`no`'s row in the generated invoices table (it has a Print button). The table hides Approved ones."""
    return page.get_by_role("row").filter(has=page.get_by_role("button", name=f"Print {no}", exact=True))


def invoice_row(page: Page, no: str):
    """`no`'s row in the Vendor Invoices table (its number is a button)."""
    return page.get_by_role("row").filter(has=page.get_by_role("button", name=no, exact=True))


def approved_on_screen(page: Page, no: str, how: str) -> None:
    row = invoice_row(page, no).first
    row.wait_for(timeout=60_000)
    expect("Approved" in row.inner_text(), f"{no}: {how}, its Vendor Invoice row reads Approved")
    expect(generated_row(page, no).count() == 0, f"{no}: it leaves the generated invoices table (Approved ones are hidden)")


out_dir = None

with session(a.task, a.user, a.password) as (page, out):
    out_dir = out
    (out / "seed.json").write_text(json.dumps(seed, indent=1))
    page.route(EXTRACT, ai_read)
    # Every write's answer goes into the log, so a refused step says why.
    page.on("response", lambda r: "/api/method/" in r.url and r.request.method == "POST"
            and print(f"     {r.status} {r.url.split('/api/method/')[1][:90]}"
                      + ("" if r.ok else f"  {r.text()[:300]}")))
    open_work_order(page, A["invoice_no"])
    save(page, out, "01-work-order")

    # 2. Upload signed copy of A
    page.get_by_role("button", name=f"Upload signed copy of {A['invoice_no']}").click()
    upload = page.get_by_role("dialog")
    upload.locator("input[type=file]").set_input_files(scan(A["invoice_no"]))
    upload.get_by_role("button", name="Upload", exact=True).click()
    expect(toast(page, f"{A['invoice_no']} is approved by the System"), "Upload signed copy: the toast says the System approved it")
    approved_on_screen(page, A["invoice_no"], "uploaded as its signed copy")
    save(page, out, "02-upload-signed-copy-approved")

    # 3. Add Invoice of B's signed copy
    add_invoice(page, B["invoice_no"], B["amount"], "signed", warn=False)
    page.reload()
    page.get_by_text("Loading data...").wait_for(state="hidden", timeout=60_000)
    approved_on_screen(page, B["invoice_no"], "added through Add Invoice as its signed copy")
    save(page, out, "03-add-invoice-signed-copy-approved")

    # 4. Add Invoice of C's copy, not signed
    add_invoice(page, C["invoice_no"], C["amount"], "not_signed", warn=True)
    page.reload()
    page.get_by_text("Loading data...").wait_for(state="hidden", timeout=60_000)
    generated_row(page, C["invoice_no"]).first.wait_for(timeout=60_000)
    expect("Signed" in generated_row(page, C["invoice_no"]).first.inner_text(),
           f"{C['invoice_no']}: an unsigned copy is linked, its generated invoice reads Signed")
    expect("Pending" in invoice_row(page, C["invoice_no"]).first.inner_text(),
           f"{C['invoice_no']}: its Vendor Invoice row reads Pending")
    save(page, out, "04-add-invoice-unsigned-copy-pending")

    # 5. Add Invoice of an ordinary bill D
    add_invoice(page, D_NO, D_AMOUNT, None, warn=False)
    save(page, out, "05-add-invoice-ordinary")

    db = script("wo_invoice_auto_approve_db.py", WO, A["invoice_no"], B["invoice_no"], C["invoice_no"], D_NO)
    (out / "db.json").write_text(json.dumps(db, indent=1))
    for rec in (A, B):
        row = db[rec["invoice_no"]]
        inv = row["invoice"] or {}
        expect((inv.get("status"), inv.get("approved_by"), inv.get("auto_approved")) == ("Approved", "System", 1),
               f"DB: {rec['invoice_no']}'s Vendor Invoice {inv.get('name')} Approved by System, auto_approved 1")
        expect((row["record"] or {}).get("status") == "Approved" and row["record"]["vendor_invoice"] == inv.get("name"),
               f"DB: generated invoice {rec['name']} Approved, linked to {inv.get('name')}")
    c = db[C["invoice_no"]]
    c_sum = seed["approved"] + A["amount"] + B["amount"] + C["amount"]
    want_c = (f"wo_generated_copy_not_signed,wo_total_mismatch:{seed['total']:.2f}:{c_sum:.2f},"
              f"wo_paid_mismatch:{seed['paid']:.2f}:{c_sum:.2f}")
    expect((c["invoice"] or {}).get("status") == "Pending"
           and c["invoice"]["auto_approve_skip_reasons"] == want_c,
           f"DB: {C['invoice_no']} Pending with {want_c} (got {(c['invoice'] or {}).get('auto_approve_skip_reasons')})")
    expect((c["record"] or {}).get("status") == "Signed" and c["record"]["vendor_invoice"] == c["invoice"]["name"],
           f"DB: generated invoice {C['name']} Signed, linked to {c['invoice']['name']}")
    d = db[D_NO]["invoice"] or {}
    approved = seed["approved"] + A["amount"] + B["amount"]
    invoiced = approved + D_AMOUNT
    want = f"wo_total_mismatch:{seed['total']:.2f}:{invoiced:.2f},wo_paid_mismatch:{seed['paid']:.2f}:{invoiced:.2f}"
    expect(d.get("status") == "Pending" and d.get("auto_approve_skip_reasons") == want,
           f"DB: {D_NO} Pending with {want} (got {d.get('auto_approve_skip_reasons')})")
    expect(db[D_NO]["record"] is None, f"DB: {D_NO} is linked to no generated invoice")
    no_misses("Work Order page")

with session(a.task, seed["accountant"], a.password) as (page, out):
    sidebar(page, "Vendor Invoice Recon")
    page.get_by_role("button", name="Pending Invoice Approvals", exact=True).click()
    page.wait_for_url(re.compile(r"tab=pending(&|$)"))
    page.get_by_role("button", name="WO", exact=True).click()
    page.wait_for_load_state("networkidle")
    search = page.get_by_role("textbox", name=re.compile(r"^Search"))
    for no, labels, step in (
        (D_NO, [f"Invoices + this {rupees(invoiced)} ≠ WO total {rupees(seed['total'])}",
                f"Invoices + this {rupees(invoiced)} ≠ Amount Paid {rupees(seed['paid'])}"], "06-reason-figures"),
        (C["invoice_no"], ["Generated invoice not signed",
                           f"Invoices + this {rupees(c_sum)} ≠ WO total {rupees(seed['total'])}",
                           f"Invoices + this {rupees(c_sum)} ≠ Amount Paid {rupees(seed['paid'])}"],
         "07-reason-unsigned-copy"),
    ):
        search.first.fill(WO)   # it searches by PO/SR number
        page.wait_for_load_state("networkidle")
        row = page.get_by_role("row").filter(has_text=no).first
        try:
            row.wait_for(timeout=30_000)
        except Exception:
            expect(False, f"Pending Invoice Approvals › WO lists {no}")
            continue
        # The cell shows the top reason (and "+n"); its hover card lists every one.
        row.get_by_text(labels[0]).first.hover()
        card = page.locator("[data-radix-popper-content-wrapper]").filter(has_text="Not auto-approved because")
        card.first.wait_for(timeout=10_000)
        shown = row.inner_text() + "\n" + card.first.inner_text()
        for label in labels:
            expect(label in shown, f"Pending Invoice Approvals › WO, {no}: shows {label!r}")
        if no == D_NO:
            expect("Work Order figures are checked again daily at 5 AM." in shown,
                   f"Pending Invoice Approvals › WO, {no}: the hover says the daily check takes it")
        save(page, out, step)
        page.mouse.move(0, 0)
        card.first.wait_for(state="hidden", timeout=10_000)
    no_misses("Pending Invoice Approvals")
    print(f"evidence: {out}")

# 7-8. An unsigned copy whose amounts match: rule 2 approves it (ADR-0050 decision 1).
match = script("wo_invoice_auto_approve_match_setup.py", WO, seed["accountant"])
E = match["record"]
with session(a.task, a.user, a.password) as (page, out):
    out_dir = out
    (out / "match.json").write_text(json.dumps(match, indent=1))
    page.route(EXTRACT, ai_read)
    open_work_order(page, E["invoice_no"])
    add_invoice(page, E["invoice_no"], float(E["amount"]), "not_signed", warn=True)
    page.reload()
    page.get_by_text("Loading data...").wait_for(state="hidden", timeout=60_000)
    approved_on_screen(page, E["invoice_no"], "an unsigned copy matching the WO total (rule 2)")
    save(page, out, "08-unsigned-copy-matching-approved")
    e = script("wo_invoice_auto_approve_db.py", WO, E["invoice_no"])[E["invoice_no"]]
    inv = e["invoice"] or {}
    expect((inv.get("status"), inv.get("approved_by"), inv.get("auto_approved")) == ("Approved", "System", 1),
           f"DB: {E['invoice_no']} (₹{float(E['amount']):,.0f}; Approved {rupees(match['approved'])} + it = WO total "
           f"{rupees(match['total'])}) Approved by System, auto_approved 1")
    expect((e["record"] or {}).get("status") == "Approved" and e["record"]["vendor_invoice"] == inv.get("name"),
           f"DB: generated invoice {E['name']} Approved, linked to {inv.get('name')}")
    no_misses("Unsigned copy matching the WO total")
    print(f"evidence: {out}")
