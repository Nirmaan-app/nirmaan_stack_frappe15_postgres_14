"""Walk branch wo/inv-auto (Work Order invoices approved by the System by three rules: ADR-0050 and ADR-0014
Amendment C) on its env and on an env of develop, before vs after. The branch has no PR yet.

    python3 .claude/skills/pr-walk/bin/walk_branch_wo_inv_auto.py <out dir> --user <procurement email> \
        --after <env> --before <env> [--password <pw>] [function ...]

Run it from the checkout root with both envs served. `--user` is a Procurement Executive the app does not lock
(`free_users.py "Nirmaan Procurement Executive Profile"`). Each side is seeded with the verify skill's
`wo_invoice_auto_approve_seed.py`: three new generated invoices A, B, C on an Approved GST-off Work Order the user
can see, and the made-up Accountant `walk-accountant@example.com`. The screens are the after-side walk of
`walk_wo_invoice_auto_approve.py`, driven on both envs, with its DB reader and its rule-2 setup
(`wo_invoice_auto_approve_match_setup.py`, which rejects the WO's Pending invoices and generates its FINAL E).
Every figure checked is read from that env's DB during the run. The env has no Gemini key: the walk answers the
browser's `extract_invoice_fields` call with the number, amount and signature answer for the file it picked.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import traceback
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
VERIFY = ROOT / ".claude/skills/verify/bin"
sys.path.insert(0, str(VERIFY))
sys.path.insert(0, str(HERE))
from drive import session, sidebar  # noqa: E402
from record import Walk, pin  # noqa: E402

DEVENV = str(ROOT / "scripts/devenv/devenv.sh")
EXTRACT = "**/api/method/nirmaan_stack.api.invoice_autofill.extract_invoice_fields*"
WARNING = "Generated invoice not signed"
PE, ACC = "Procurement Executive", "Accountant"

ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("only", nargs="*")
ap.add_argument("--user", required=True)
ap.add_argument("--after", required=True, help="the env on the branch")
ap.add_argument("--before", required=True, help="the env on develop at the branch's base")
ap.add_argument("--password", default="WalkPw-WoInv")
a = ap.parse_args()
ENVS = {"after": a.after, "before": a.before}
out = Path(a.out)
head = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short=9", "HEAD"], capture_output=True, text=True,
                      check=True).stdout.strip()

w = Walk(out, pr={"number": "wo/inv-auto", "title": "Work Order invoices approved by the System by three rules "
                  "(ADR-0050, ADR-0014 Amendment C)", "url": "", "author": "",
                  "head": head, "base": "91bb9c3dd"},
         envs=ENVS, data_note="a test copy of the production backup of 2026-11-17")

w.change("d1", "1 · Rule 1: a generated invoice's signed copy is approved by the System",
         "On a GST-off WO, Upload signed copy is approved by the System at once. Add Invoice whose AI-read number "
         "is a generated invoice still Generated (amount ± ₹1) is linked to it, counted once, and approved when the "
         "AI finds the Authorized Signature box signed or stamped. Found empty, the dialog warns \"Generated invoice "
         "not signed\" above its button (never blocks), and rules 2 and 3 decide. A number already Signed or "
         "Approved is refused as a duplicate.")
w.change("d2", "2 · Rule 2: Approved WO invoices + this one = the WO total (± ₹1)",
         "The invoice that brings the Approved invoices to the WO's total amount (GST incl.) is approved by the "
         "System, even when only part is paid.")
w.change("d3", "3 · Rule 3: Approved WO invoices + this one = Amount Paid (± ₹1)",
         "Exactly equal to Amount Paid incl. vendor TDS, ± ₹1; on a GST-on WO base invoiced vs base paid.")
w.change("d4", "4 · \"Approved WO invoices\" means Approved only",
         "Pending invoices are not counted in the sums, so a Pending one later rejected never carries another.")
w.change("d5", "5 · When it runs: upload, the 05:00 re-check, and Re-check on the WO tab",
         "At upload; again in the 05:00 daily re-check, which now takes WO invoices; and Re-check on Pending "
         "Invoice Approvals › WO runs the same check now, preview first. The PO tab's Re-check stays the PO checks.")
w.change("d6", "6 · The System needs no role",
         "The approval carries the server-only SYSTEM_DECISION_FLAG, so it passes the WO decision guard whoever "
         "uploaded. Approved by = System, auto_approved = 1.")
w.change("d7", "7 · Rules 2 and 3 compare amounts only",
         "No check on the file (AI read, typed by hand, duplicate number): a typed amount that matches is approved.")
w.change("d8", "8 · Why not, and which rule, on screen",
         "When no rule matches, the Not Auto-Approved Reason column says why with the figures (WO total vs Approved "
         "+ this; Amount Paid vs the same; \"Generated invoice not signed\" first), replacing not_procurement_order "
         "for WO invoices. Re-check's preview names the matching rule with the two figures it compared.")
w.change("d9", "9 · No \"waiting for approval\" notice for an approved signed copy",
         "After a signed copy upload the project's Accountants are told only when the WO invoice is still Pending.")
w.change("d10", "10 · Nothing else changes",
         "PO auto-approval, the invoice check, WO payment limits, the Generate Invoice range, and who may upload, "
         "generate, edit or approve by hand: all as before.")
w.change("amend_c", "ADR-0014 Amendment C: the System may approve a WO invoice",
         "The System's own decision passes the Work Order guard. A person's approve and reject stay with invoice "
         "approvers only; edit rules are unchanged.")


# ---------------------------------------------------------------- helpers

def db(task: str, name: str, *args: str) -> dict:
    """Run a verify-skill DB script on the env and keep its output under the walk's db/ folder."""
    res = subprocess.run([DEVENV, "script", task, str(VERIFY / name), *args], capture_output=True, text=True,
                         timeout=600)
    (out / "db").mkdir(exist_ok=True)
    (out / "db" / f"{task}-{name}-{len(list((out / 'db').iterdir()))}.txt").write_text(
        " ".join(args) + "\n\n" + res.stdout + res.stderr)
    line = next((ln for ln in reversed(res.stdout.splitlines()) if ln.startswith("{")), None)
    if line is None:
        raise RuntimeError(f"{name} on {task} printed no JSON:\n{res.stdout[-800:]}\n{res.stderr[-800:]}")
    return json.loads(line)


def notices(task: str, user: str, wo: str) -> list[str]:
    """The descriptions of the Nirmaan Notifications `user` has about `wo`, newest first."""
    src = out / "db" / "notices.py"
    src.parent.mkdir(exist_ok=True)
    src.write_text("import json, sys\nimport frappe\nprint(json.dumps(frappe.get_all('Nirmaan Notifications', "
                   "filters={'recipient': sys.argv[1], 'docname': sys.argv[2]}, pluck='description', "
                   "order_by='creation desc')))\n")
    res = subprocess.run([DEVENV, "script", task, str(src), user, wo], capture_output=True, text=True, timeout=300)
    line = next((ln for ln in reversed(res.stdout.splitlines()) if ln.startswith("[")), None)
    if line is None:
        raise RuntimeError(f"notices.py on {task} printed no list:\n{res.stdout[-800:]}\n{res.stderr[-800:]}")
    return json.loads(line)


def can_see(task: str, user: str, wo: str) -> int:
    """How many of the Work Order `wo` `user` sees through frappe.get_list (1, or 0 when their projects leave it out)."""
    src = out / "db" / "can_see.py"
    src.parent.mkdir(exist_ok=True)
    src.write_text("import sys\nimport frappe\nfrappe.set_user(sys.argv[1])\n"
                   "print('COUNT', len(frappe.get_list('Service Requests', filters={'name': sys.argv[2]})))\n")
    res = subprocess.run([DEVENV, "script", task, str(src), user, wo], capture_output=True, text=True, timeout=300)
    m = re.search(r"^COUNT (\d+)$", res.stdout, re.M)
    return int(m.group(1)) if m else -1


def rupees(amount: float) -> str:
    """₹ in Indian grouping, rounded to the rupee, as the reason column shows it."""
    whole = str(int(abs(amount) + 0.5))  # half up, as the screen rounds (Python round() goes half to even)
    head, tail = whole[:-3], whole[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    return ("-" if amount < 0 else "") + "₹" + ",".join(([head] if head else []) + groups + [tail])


def money(text: str) -> float:
    return float(text.replace("₹", "").replace(",", ""))


def scan(no: str) -> str:
    """A one-page PDF of its own for `no` (the upload refuses a file that is not a readable PDF, and Frappe reuses
    the URL of a File with the same bytes)."""
    stream = f"BT /F1 14 Tf 60 760 Td (Walk invoice {no}) Tj ET"
    objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
               "/Resources << /Font << /F1 5 0 R >> >> >>",
               f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
               "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    body, offsets = "%PDF-1.4\n", []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(body))
        body += f"{i} 0 obj\n{obj}\nendobj\n"
    xref = len(body)
    body += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offsets)
    body += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    path = out / "files" / f"{no}.pdf"
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(body.encode("latin-1"))
    return str(path)


answer: dict = {}


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


def loaded(page) -> None:
    page.get_by_text("Loading data...").wait_for(state="hidden", timeout=60_000)
    page.wait_for_load_state("networkidle")


def open_work_order(page, side: str, cid: str, wo: str, ready: str) -> None:
    """Sidebar Work Orders › All WO › search by WO ID › the WO's link, as the Procurement Executive does."""
    sidebar(page, "Work Orders")
    page.get_by_role("button", name=re.compile(r"^All WO\s*\d+$")).click()
    page.locator("a[href*='/service-requests/SR-']").first.wait_for(timeout=60_000)
    page.get_by_role("combobox").filter(has_text="Item in WO").click()
    page.get_by_role("option", name="WO ID", exact=True).click()
    page.get_by_role("textbox", name=re.compile(r"^Search by WO ID")).fill(wo)
    link = page.locator(f"a[href*='/service-requests/{wo}']").first
    link.wait_for(timeout=30_000)
    w.step(page, cid, side, PE, a.user, f"Work Orders › All WO, searched by WO ID: open {wo}.", click=link)
    loaded(page)
    page.get_by_role("button", name=f"Print {ready}", exact=True).wait_for(timeout=60_000)


def generated_row(page, no: str):
    return page.get_by_role("row").filter(has=page.get_by_role("button", name=f"Print {no}", exact=True))


def invoice_row(page, no: str):
    return page.get_by_role("row").filter(has=page.get_by_role("button", name=no, exact=True))


def row_text(loc) -> str:
    return loc.first.inner_text() if loc.count() else ""


def toast(page, text: str):
    loc = page.get_by_text(re.compile(re.escape(text))).first
    try:
        loc.wait_for(timeout=30_000)
        return loc
    except Exception:
        return None


def add_invoice(page, side: str, cid: str, no: str, amount: float, signature: str | None, what: str) -> bool:
    """Add Invoice of `no` as the AI reads it; shoots the filled dialog with its button boxed, then saves.
    Returns whether the unsigned-copy warning showed."""
    answer.update(no=no, amount=amount, signature=signature)
    page.get_by_role("button", name="Add Invoice", exact=True).first.click()
    dialog = page.get_by_role("alertdialog")
    dialog.get_by_text("Upload your invoice").wait_for()
    dialog.locator("input[type=file]").set_input_files(scan(no))
    dialog.locator("#invoice_no").wait_for(timeout=60_000)
    button = dialog.get_by_role("button", name="Add Invoice", exact=True)
    box = dialog.locator("div.rounded-md").filter(has_text=WARNING)
    try:
        box.first.wait_for(timeout=8_000)
    except Exception:
        pass
    for _ in range(40):   # greyed for about a second while the duplicate-number check runs
        if button.is_enabled():
            break
        page.wait_for_timeout(500)
    shown = box.count() > 0 and box.first.is_visible()
    w.check(cid, PE, f"Add Invoice: the AI's number {no} fills in", dialog.locator("#invoice_no").input_value(),
            dialog.locator("#invoice_no").input_value() == no, kind="info")
    pins = []
    if shown:
        pins.append(pin(box, "\"Generated invoice not signed\" above the button; the button stays enabled.", "info"))
    w.step(page, cid, side, PE, a.user, f"Add Invoice of {no} ({rupees(amount)}), {what}. The AI read fills the "
           f"number{'; the dialog warns the copy looks unsigned' if shown else ''}. Save it.", click=button, pins=pins)
    toast(page, "Success")
    dialog.wait_for(state="hidden", timeout=30_000)
    page.reload()
    loaded(page)
    return shown


def accountant_rows(page) -> None:
    sidebar(page, "Vendor Invoice Recon")
    page.get_by_role("button", name="Pending Invoice Approvals", exact=True).click()
    page.wait_for_url(re.compile(r"tab=pending(&|$)"))
    page.get_by_role("button", name="WO", exact=True).click()
    page.wait_for_load_state("networkidle")


# ---------------------------------------------------------------- the walk

state: dict = {}


def pe_part(side: str) -> None:
    """Seed the side's WO, then as the Procurement Executive: Upload signed copy of A; Add Invoice of B (signed),
    C (unsigned) and an ordinary bill D; and Vendor Invoice Recon without its Pending tab. Reads the DB after."""
    task = ENVS[side]
    seed = db(task, "wo_invoice_auto_approve_seed.py", a.user)
    for user in (a.user, seed["accountant"]):
        subprocess.run([DEVENV, "run", task, "set-password", user, a.password], check=True, capture_output=True)
    wo = seed["wo"]
    A, B, C = seed["records"]
    d_no = f"WALK-{date.today():%y%m%d}-RA{A['name'].rsplit('-', 1)[1]}"
    d_amount = 1_234
    st = state[side] = {"seed": seed, "wo": wo, "A": A, "B": B, "C": C, "D": d_no, "d_amount": d_amount}
    w.check("d1", ACC, "the Accountant is the seed's made-up one: free_users.py lists none, every Accountant "
            "copied from production holds an asset to declare, which locks them",
            seed["accountant"], seed["accountant"] == "walk-accountant@example.com", kind="info")
    for role, user in ((PE, a.user), (ACC, seed["accountant"])):
        n = can_see(task, user, wo)
        w.check("d1", role, f"{user} can see {wo} before the walk", f"get_list count {n}", n == 1)

    with session(task, a.user, a.password) as (page, _):
        page.route(EXTRACT, ai_read)
        open_work_order(page, side, "d1", wo, A["invoice_no"])

        # Upload signed copy of A
        up = page.get_by_role("button", name=f"Upload signed copy of {A['invoice_no']}")
        w.step(page, "d1", side, PE, a.user,
               f"The Invoices card lists the three generated invoices the seed made ({A['invoice_no']}, "
               f"{B['invoice_no']}, {C['invoice_no']}). Upload the signed copy of {A['invoice_no']}.", click=up)
        dlg = page.get_by_role("dialog")
        desc = dlg.locator("p").filter(has_text="books the vendor's signed invoice").first
        desc_text = desc.inner_text() if desc.count() else ""
        dlg.locator("input[type=file]").set_input_files(scan(A["invoice_no"]))
        page.wait_for_timeout(1500)
        w.step(page, "d1", side, PE, a.user,
               "The dialog says " + ("the System approves it." if "approved by the System" in desc_text
                                      else "a Pending Vendor Invoice goes to Accountants for approval.") + " Upload.",
               click=dlg.get_by_role("button", name="Upload", exact=True),
               pins=[pin(desc, desc_text, "info")] if desc.count() else [])
        t = toast(page, f"{A['invoice_no']} is ")
        toast_text = t.inner_text() if t else ""
        if side == "after":
            w.check("d1", PE, "Upload signed copy: the toast says the System approved it", toast_text,
                    "approved by the System" in toast_text)
        w.step(page, "d1", side, PE, a.user, f"The toast: \"{toast_text}\".",
               pins=[pin(t, toast_text, "info")] if t else [])
        page.reload()
        loaded(page)
        a_row = invoice_row(page, A["invoice_no"])
        a_row.first.wait_for(timeout=60_000)
        approved = "Approved" in row_text(a_row)
        if side == "after":
            w.check("d1", PE, f"{A['invoice_no']}'s Vendor Invoice row reads Approved", row_text(a_row)[:120], approved)
        w.step(page, "d1", side, PE, a.user,
               f"{A['invoice_no']}'s Vendor Invoice row reads {'Approved' if approved else 'Pending'}"
               + (", and it left the generated invoices table." if approved and not generated_row(page, A['invoice_no']).count()
                  else "."), pins=[pin(a_row, f"{A['invoice_no']}: {'Approved' if approved else 'Pending'}",
                                       "info")])
        if side == "after" and approved:
            w.step(page, "d6", side, PE, a.user,
                   f"{A['invoice_no']} was uploaded by this Procurement Executive, who may not approve, and its row "
                   "reads Approved: the System approved it (DB: approved_by System, auto_approved 1).",
                   pins=[pin(a_row, "Uploaded by the Procurement Executive; Approved by the System.", "info")])

        # Add Invoice of B's signed copy
        add_invoice(page, side, "d1", B["invoice_no"], B["amount"], "signed", "the vendor's signed copy of a generated invoice")
        b_rows = invoice_row(page, B["invoice_no"])
        b_rows.first.wait_for(timeout=60_000)
        b_gen = row_text(generated_row(page, B["invoice_no"]))
        b_ok = "Approved" in row_text(b_rows) and not generated_row(page, B["invoice_no"]).count()
        if side == "after":
            w.check("d1", PE, f"{B['invoice_no']}: approved and gone from the generated invoices table",
                    row_text(b_rows)[:120], b_ok)
        w.step(page, "d1", side, PE, a.user,
               f"{B['invoice_no']}: " + ("its Vendor Invoice reads Approved, and the generated invoice is gone "
                                         "from its table (linked and approved)." if b_ok else
                                         f"a Vendor Invoice of its own, Pending; the generated invoice still reads "
                                         f"{'Generated' if 'Generated' in b_gen else b_gen[:40]}, so the amount counts twice."),
               pins=[pin(b_rows, f"{B['invoice_no']}: {'Approved' if b_ok else 'Pending'}", "info")]
               + ([pin(generated_row(page, B["invoice_no"]), "Still Generated: not linked to the upload.",
                       "info")] if not b_ok and b_gen else []))

        # Add Invoice of C's copy, not signed
        warned = add_invoice(page, side, "d1", C["invoice_no"], C["amount"], "not_signed",
                             "a copy whose Authorized Signature box is empty")
        if side == "after":
            w.check("d1", PE, "the unsigned copy shows the \"Generated invoice not signed\" warning", str(warned), warned)
        else:
            w.check("d1", PE, "before: no unsigned-copy warning", str(warned), not warned, kind="info")
        c_gen = generated_row(page, C["invoice_no"])
        c_inv = invoice_row(page, C["invoice_no"])
        c_inv.first.wait_for(timeout=60_000)
        c_gen_text = row_text(c_gen)
        if side == "after":
            w.check("d1", PE, f"{C['invoice_no']}: linked (generated reads Signed), Vendor Invoice Pending",
                    f"generated: {c_gen_text[:60]} | invoice: {row_text(c_inv)[:60]}",
                    "Signed" in c_gen_text and "Pending" in row_text(c_inv))
        w.step(page, "d1", side, PE, a.user,
               f"{C['invoice_no']}: its Vendor Invoice reads Pending; the generated invoice reads "
               f"{'Signed (linked)' if 'Signed' in c_gen_text else 'Generated (not linked)'}.",
               pins=[pin(c_gen, f"generated: {'Signed' if 'Signed' in c_gen_text else 'Generated'}", "info")])

        # Add Invoice of an ordinary bill D
        add_invoice(page, side, "d8", d_no, d_amount, None, "an ordinary bill (no generated invoice has its number)")
        d_row = invoice_row(page, d_no)
        d_row.first.wait_for(timeout=60_000)
        w.step(page, "d8", side, PE, a.user, f"{d_no} is Pending.", pins=[pin(d_row, f"{d_no}: Pending", "info")])

        # Amendment C: a person's approve and reject stay with invoice approvers
        sidebar(page, "Vendor Invoice Recon")
        page.get_by_role("button", name="All Invoices", exact=True).wait_for(timeout=30_000)
        page.wait_for_timeout(1000)
        tabs = page.get_by_role("button", name="Pending Invoice Approvals", exact=True)
        w.check("amend_c", PE, "the Procurement Executive's Vendor Invoice Recon has no Pending Invoice Approvals "
                "(where Approve and Reject are)", "present" if tabs.count() else "absent", not tabs.count())
        w.step(page, "amend_c", side, PE, a.user,
               "The Procurement Executive's Vendor Invoice Recon opens on All Invoices, with no Pending Invoice "
               "Approvals tab: they may upload but not approve or reject.",
               pins=[pin(page.get_by_role("button", name="All Invoices", exact=True),
                         "No Pending Invoice Approvals tab beside it.", "info")])

    rows = db(task, "wo_invoice_auto_approve_db.py", wo, A["invoice_no"], B["invoice_no"], C["invoice_no"], d_no)
    st["db"] = rows
    total, paid, approved0 = seed["total"], seed["paid"], seed["approved"]
    for rec in (A, B):
        inv = rows[rec["invoice_no"]]["invoice"] or {}
        got = (inv.get("status"), inv.get("approved_by"), inv.get("auto_approved"))
        if side == "after":
            w.check("d6", PE, f"DB: {rec['invoice_no']} (uploaded by the Procurement Executive) Approved by System, "
                    "auto_approved 1", str(got), got == ("Approved", "System", 1))
            w.check("amend_c", PE, f"DB: the System's approval of {rec['invoice_no']} passed the WO guard though its "
                    "uploader may not approve", str(got), got[0] == "Approved")
        else:
            w.check("d1", PE, f"before: {rec['invoice_no']} stays Pending",
                    f"{got[0]} / reasons {inv.get('auto_approve_skip_reasons')}", got[0] == "Pending", kind="info")
    c_inv = rows[C["invoice_no"]]["invoice"] or {}
    d_inv = rows[d_no]["invoice"] or {}
    if side == "after":
        c_sum = approved0 + A["amount"] + B["amount"] + C["amount"]
        want_c = (f"wo_generated_copy_not_signed,wo_total_mismatch:{total:.2f}:{c_sum:.2f},"
                  f"wo_paid_mismatch:{paid:.2f}:{c_sum:.2f}")
        w.check("d8", PE, f"DB: {C['invoice_no']} reasons = {want_c}", str(c_inv.get("auto_approve_skip_reasons")),
                c_inv.get("auto_approve_skip_reasons") == want_c)
        d_sum = approved0 + A["amount"] + B["amount"] + d_amount
        want_d = f"wo_total_mismatch:{total:.2f}:{d_sum:.2f},wo_paid_mismatch:{paid:.2f}:{d_sum:.2f}"
        w.check("d8", PE, f"DB: {d_no} reasons = {want_d}", str(d_inv.get("auto_approve_skip_reasons")),
                d_inv.get("auto_approve_skip_reasons") == want_d)
        w.check("d4", PE, f"{d_no}'s sum leaves out Pending {C['invoice_no']} ({rupees(C['amount'])}): Approved "
                f"{rupees(approved0 + A['amount'] + B['amount'])} + {rupees(d_amount)} = {rupees(d_sum)}",
                str(d_inv.get("auto_approve_skip_reasons")), f":{d_sum:.2f}" in (d_inv.get("auto_approve_skip_reasons") or ""))
        st.update(c_sum=c_sum, d_sum=d_sum)
    else:
        for no, inv in ((C["invoice_no"], c_inv), (d_no, d_inv)):
            w.check("d8", PE, f"before: {no} Pending with not_procurement_order",
                    f"{inv.get('status')} / {inv.get('auto_approve_skip_reasons')}",
                    "not_procurement_order" in (inv.get("auto_approve_skip_reasons") or ""), kind="info")


def acc_part(side: str) -> None:
    """As the Accountant: Notifications, the Not Auto-Approved Reason of D and C, and Re-check on the WO tab."""
    task, st = ENVS[side], state[side]
    wo, A, C, d_no, seed = st["wo"], st["A"], st["C"], st["D"], st["seed"]
    acc = seed["accountant"]
    told = notices(task, acc, wo)
    with session(task, acc, a.password) as (page, _):
        # Decision 9: the Accountant's notifications
        bell = page.locator('[data-sidebar="menu-button"]').filter(has_text="Notifications")
        w.step(page, "d9", side, ACC, acc, "As the Accountant: open Notifications in the sidebar.", click=bell)
        page.wait_for_timeout(1000)
        menu = page.get_by_role("menu")
        on_screen = menu.first.inner_text() if menu.count() else ""
        about_a = [d for d in told if A["invoice_no"] in d]
        a_shown = A["invoice_no"] in on_screen
        if side == "after":
            w.check("d9", ACC, f"the Notifications menu has no \"waiting for approval\" notice for {A['invoice_no']} "
                    "(approved by the System)", "listed" if a_shown else "not listed", not a_shown)
            w.check("d9", ACC, f"DB: no notice for {A['invoice_no']}", "; ".join(about_a) or "none", not about_a)
        else:
            w.check("d9", ACC, f"before: the Notifications menu says {A['invoice_no']} is waiting for approval",
                    "listed" if a_shown else "not listed", a_shown, kind="info")
        listed = page.get_by_role("menu").get_by_text(re.compile(re.escape(A["invoice_no"]) + "|" + re.escape(C["invoice_no"])))
        w.step(page, "d9", side, ACC, acc,
               f"Notifications about {wo}: " + ("; ".join(told) if told else "none") + ".",
               pins=[pin(listed, ("Only the still-Pending unsigned copy is announced." if side == "after" else
                                  "The signed copy waits for an Accountant."), "info")] if listed.count() else [])
        page.keyboard.press("Escape")

        # Decision 8: the reason column
        accountant_rows(page)
        search = page.get_by_role("textbox", name=re.compile(r"^Search"))
        search.first.fill(wo)
        page.wait_for_load_state("networkidle")
        if side == "after":
            labels = {d_no: [f"Invoices + this {rupees(st['d_sum'])} ≠ WO total {rupees(seed['total'])}",
                             f"Invoices + this {rupees(st['d_sum'])} ≠ Amount Paid {rupees(seed['paid'])}"],
                      C["invoice_no"]: ["Generated invoice not signed",
                                        f"Invoices + this {rupees(st['c_sum'])} ≠ WO total {rupees(seed['total'])}",
                                        f"Invoices + this {rupees(st['c_sum'])} ≠ Amount Paid {rupees(seed['paid'])}"]}
        else:
            # The cell shows the top reason; with the walk's AI answer that is amounts_incomplete, and the hover
            # card lists not_procurement_order too.
            labels = {no: ["AI couldn't read enough amounts to cross-check",
                           "Work Order invoice — auto-approval is PO-only"] for no in (d_no, C["invoice_no"])}
        for no in (d_no, C["invoice_no"]):
            row = page.get_by_role("row").filter(has_text=no).first
            try:
                row.wait_for(timeout=30_000)
            except Exception:
                w.check("d8", ACC, f"Pending Invoice Approvals › WO lists {no}", "not listed", False,
                        kind="must" if side == "after" else "info")
                continue
            trigger = row.get_by_text(labels[no][0]).first
            try:
                trigger.hover(timeout=10_000)
                card = page.locator("[data-radix-popper-content-wrapper]").filter(has_text="Not auto-approved because")
                card.first.wait_for(timeout=10_000)
            except Exception:
                card = page.locator("[data-radix-popper-content-wrapper]")
            shown = row.inner_text() + "\n" + (card.first.inner_text() if card.count() else "")
            for label in labels[no][0 if side == "after" else 1:]:
                w.check("d8", ACC, f"{no}'s reason shows {label!r}", "shown" if label in shown else shown[-200:],
                        label in shown, kind="must" if side == "after" else "info")
            if side == "after" and no == d_no:
                w.check("d5", ACC, "the hover says WO figures are checked again daily at 5 AM",
                        "shown" if "checked again daily at 5 AM" in shown else "absent",
                        "checked again daily at 5 AM" in shown)
            shows_d4 = side == "after" and no == d_no
            # Hover again just before the shot: the card can close while the checks above read it.
            # Pin the card by the box measured now: a locator pin would scroll first, and the card closes.
            target = trigger
            try:
                page.mouse.move(0, 0)
                card.first.wait_for(state="hidden", timeout=5_000)
                trigger.hover(timeout=5_000)
                card.first.wait_for(timeout=5_000)
                page.wait_for_timeout(700)
                card.first.wait_for(timeout=1_000)
                b = card.first.bounding_box()
                target = {"x": round(b["x"]), "y": round(b["y"]), "w": round(b["width"]), "h": round(b["height"])}
            except Exception:
                pass
            w.step(page, "d4" if shows_d4 else "d8", side, ACC, acc,
                   f"Pending Invoice Approvals › WO, searched {wo}: {no}'s Not Auto-Approved Reason, hovered: "
                   + " · ".join(labels[no][0 if side == "after" else 1:]) + "."
                   + (f" The invoiced figure is Approved + {d_no}; the Pending {C['invoice_no']} "
                      f"({rupees(C['amount'])}) is not in it." if shows_d4 else ""),
                   pins=[pin(target,
                             "The reasons with their figures." if side == "after" else
                             "Every WO invoice gets the same \"PO-only\" reason.", "info")], settle_ms=200)
            page.mouse.move(0, 0)
            page.wait_for_timeout(600)

        # Decision 5 and 8: Re-check on the WO tab, preview only
        search.first.fill("")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1500)
        if side == "after":
            old = page.get_by_text("Work Order invoice — waits for the daily re-check")
            if old.count():
                w.step(page, "d5", side, ACC, acc,
                       f"WO invoices filed before this branch still read \"Work Order invoice — waits for the daily "
                       f"re-check\" ({old.count()} on this page): the 05:00 job has not run on this env yet.",
                       pins=[pin(old, "The old not_procurement_order reason, reworded: rewritten with figures at the "
                                      "05:00 job's first run (decision 5).", "info")])
        recheck = page.get_by_role("button", name="Re-check", exact=True)
        w.step(page, "d5", side, ACC, acc, "Pending Invoice Approvals › WO: press Re-check (preview first).",
               click=recheck)
        dlg = page.get_by_role("dialog")
        dlg.get_by_text("Re-check results").wait_for(timeout=60_000)
        page.wait_for_timeout(1500)
        text = dlg.inner_text()
        (out / f"recheck-{side}.txt").write_text(text)
        is_wo = "Work Order invoice" in text and "PO-value" not in text
        rules = re.findall(r"Rule (\d) · invoiced (₹[\d,]+) = (WO total|Amount Paid) (₹[\d,]+)", text)
        if side == "after":
            w.check("d5", ACC, "the WO tab's Re-check runs the Work Order check", text.splitlines()[2][:140] if
                    len(text.splitlines()) > 2 else text[:140], is_wo)
            w.check("d8", ACC, "the preview lists invoices it will approve, each naming its rule",
                    "; ".join(f"Rule {r} {x} = {k} {y}" for r, x, k, y in rules) or "none listed (no invoice matched "
                    "on this env's data)", bool(rules), kind="info")
            if rules:
                w.check("d8", ACC, "each rule's two figures are within ₹1",
                        "; ".join(f"{x} vs {y}" for _, x, _, y in rules),
                        all(abs(money(x) - money(y)) <= 1 for _, x, _, y in rules), kind="nit")
            for r, x, k, y in rules:
                if r == "3":
                    state["rule3_seen"] = True
                    w.check("d3", ACC, "Re-check's preview approves an invoice by rule 3 (= Amount Paid)",
                            f"Rule 3 · invoiced {x} = {k} {y}", abs(money(x) - money(y)) <= 1)
        else:
            w.check("d5", ACC, "before: the WO tab's Re-check runs the PO-value checks", text[:160],
                    "PO-value" in text, kind="info")
        first_rule = dlg.get_by_text(re.compile(r"Rule \d · ")).first
        po_note = dlg.get_by_text(re.compile("PO-value check")).first
        mark = ([pin(first_rule, "The rule and the two figures it compared.", "info")] if first_rule.count() else
                [pin(po_note, "PO checks on the WO tab.", "info")] if po_note.count() else [])
        w.step(page, "d5", side, ACC, acc,
               ("The preview: " + (f"{len(rules)} Work Order invoice(s) will be approved, each naming its rule."
                                   if is_wo else "the PO-value checks, on PO invoices.")) + " Cancel: nothing is applied.",
               click=dlg.get_by_role("button", name="Cancel", exact=True),
               pins=mark)


def match_part(side: str) -> None:
    """Reject the WO's Pending invoices, generate its FINAL E, and Add Invoice of E's unsigned copy (rule 2)."""
    task, st = ENVS[side], state[side]
    wo, acc = st["wo"], st["seed"]["accountant"]
    match = db(task, "wo_invoice_auto_approve_match_setup.py", wo, acc)
    E = match["record"]
    amount = float(E["amount"])
    with session(task, a.user, a.password) as (page, _):
        page.route(EXTRACT, ai_read)
        open_work_order(page, side, "d2", wo, E["invoice_no"])
        warned = add_invoice(page, side, "d2", E["invoice_no"], amount, "not_signed",
                             f"the WO's FINAL: Approved {rupees(match['approved'])} + it = WO total "
                             f"{rupees(match['total'])}, copy unsigned")
        e_row = invoice_row(page, E["invoice_no"])
        e_row.first.wait_for(timeout=60_000)
        ok = "Approved" in row_text(e_row)
        if side == "after":
            w.check("d2", PE, f"{E['invoice_no']} ({rupees(amount)}) approved by rule 2 though unsigned",
                    row_text(e_row)[:100], ok and warned)
        w.step(page, "d2", side, PE, a.user,
               f"{E['invoice_no']}: Approved {rupees(match['approved'])} + {rupees(amount)} = WO total "
               f"{rupees(match['total'])} (Amount Paid {rupees(match['paid'])}). Its Vendor Invoice reads "
               f"{'Approved' if ok else 'Pending'}. (Figures are this env's own: the before env counted no "
               f"generated copy as Approved, so its FINAL differs.)",
               pins=[pin(e_row, 'Approved' if ok else 'Pending', "info")])
    e = db(task, "wo_invoice_auto_approve_db.py", wo, E["invoice_no"])[E["invoice_no"]]
    inv = e["invoice"] or {}
    got = (inv.get("status"), inv.get("approved_by"), inv.get("auto_approved"))
    if side == "after":
        w.check("d2", PE, f"DB: {E['invoice_no']} Approved by System, auto_approved 1 (rule 2, only part paid: "
                f"{rupees(match['paid'])} of {rupees(match['total'])})", str(got), got == ("Approved", "System", 1))
    else:
        w.check("d2", PE, f"before: {E['invoice_no']} stays Pending", f"{got} {inv.get('auto_approve_skip_reasons')}",
                got[0] == "Pending", kind="info")


def guarded(cids: tuple, fn, side: str) -> bool:
    """Run one part on one side. A part that stops fails every claim it feeds (its evidence so far is kept), and
    returns False so the later parts of that side, which need its records, do not run."""
    steps = len(w.data["steps"])
    try:
        fn(side)
        return True
    except Exception as e:
        traceback.print_exc()
        why = f"{side} walk stopped in {fn.__name__} after {len(w.data['steps']) - steps} screen(s): " \
              f"{type(e).__name__}: {str(e).splitlines()[0][:160]}"
        for cid in cids:
            w.status(cid, "failed", why)
        return False


PLAN = [(("d1", "d4", "d6", "d8", "amend_c"), pe_part), (("d5", "d8", "d9"), acc_part), (("d2",), match_part)]
for side in ("before", "after"):
    for cids, fn in PLAN:
        if (not a.only or fn.__name__ in a.only) and (fn is pe_part or side in state):
            if not guarded(cids, fn, side):
                state.pop(side, None)
                break

NOT_WALKED = {
    "d3": "The walk set up no WO where Approved invoices + one more = Amount Paid, and the WO tab's Re-check "
          "preview listed no rule-3 match. The reasons show the Amount Paid figure (decision 8). Pinned by "
          "services/test_work_order_invoice_rules.TestRuleThreeAmountPaid, TestRuleThreeOnAGstOnWorkOrder and "
          "api/invoices/test_wo_auto_approve.TestRuleThreeAtUpload.",
    "d7": "A typed (not AI-read) matching amount was not driven. Pinned by "
          "api/invoices/test_wo_auto_approve.TestRuleThreeAtUpload.test_a_typed_invoice_equal_to_amount_paid_is_approved.",
    "d10": "\"Nothing else changes\" has no one screen, and this walk compared no PO invoice (commit 4016a5f3f's "
           "message reports 400 of 400 PO decisions unchanged). Pinned by api/invoices/test_wo_auto_approve."
           "TestWhyNotAtUpload.test_a_purchase_order_invoice_still_gets_its_gates and "
           "TestReCheckOnTheWorkOrderTab.test_the_po_tabs_re_check_leaves_it_alone.",
}
PARTLY = {
    "d1": "Not walked: the duplicate refusal (api/service_requests/test_add_invoice_signed_copy.TestADuplicate), the "
          "± ₹1 amount match (services/test_work_order_invoice_rules.TestAddInvoiceOfAGeneratedInvoice."
          "test_the_amount_may_differ_by_a_rupee), a copy ahead of Amount Paid (test_add_invoice_signed_copy."
          "TestUploadSignedCopy.test_even_ahead_of_amount_paid) and a WO turned GST-on "
          "(TestASignedCopyFromBeforeAdr0050).",
    "d5": "Walked: Re-check's preview (cancelled) and the 5 AM note. Not walked: the 05:00 job itself, which runs on "
          "the scheduler (api/invoices/test_wo_auto_approve.TestTheDailyRecheck); WO invoices from before still wait "
          "for its first run on this env.",
    "amend_c": "Walked: a Procurement Executive has no Pending Invoice Approvals. Not walked: the edit rules and the "
               "signed copy's lock (services/test_work_order_invoice_access.TestTheSystemsDecision."
               "test_the_flag_does_not_open_the_edit_rules).",
}
for c in w.data["changes"]:
    if c["status"] == "failed" and c["reason"].startswith(("before walk stopped", "after walk stopped")):
        continue
    bad = [k for k in w.data["checks"] if k["change"] == c["id"] and not k["ok"] and k["kind"] == "must"]
    musts = [p for s in w.data["steps"] if s["change"] == c["id"] for p in s["pins"] if p["kind"] == "must"]
    walked = any(x["change"] == c["id"] for x in w.data["steps"] + w.data["checks"])
    if c["id"] in NOT_WALKED and not (c["id"] == "d3" and state.get("rule3_seen")):
        w.status(c["id"], "not_walked", NOT_WALKED[c["id"]])
        continue
    if not walked:
        w.status(c["id"], "not_walked", "no step or check reached it")
        continue
    w.status(c["id"], "failed" if bad or musts else "seen",
             "; ".join(f"{k['role']}: expected {k['expect']}, saw {k['seen']}" for k in bad) or PARTLY.get(c["id"], ""))
print(w.save())
