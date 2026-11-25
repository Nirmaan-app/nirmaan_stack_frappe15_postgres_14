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

Decisions 3, 7 and 10 (`pick_part`, `limits_part`, `rule3_pe_part`, `rule3_acc_part`) first pick their Work Orders
by query from the same data on each side, before anything is written: GST-off ones the user sees with Amount Paid
above their Approved invoices (a rule-3 match, a ₹50 near miss, a typed match, a typed rule-2 match), a GST-on one
for the base-vs-base case, one read and never written (Request Payment, Generate Invoice), and a Pending PO
invoice. The after side checks that what decision 10 keeps reads the same as on the before side. `--sides after`
walks one side only, for a probe; the page needs both.
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
ap.add_argument("--sides", nargs="+", default=["before", "after"], choices=["before", "after"],
                help="walk only these sides (a probe run); the page needs both")
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
    if answer.get("empty"):
        route.fulfill(json={"message": None})   # the AI read nothing: the person types every field
        return
    no, amount, signature = answer["no"], answer["amount"], answer["signature"]
    base, gst = answer.get("base", amount), answer.get("gst", 0)
    entities = [{"type": "invoice_id", "value": no, "confidence": 1.0},
                {"type": "total_amount", "value": str(amount), "confidence": 1.0}]
    if signature:
        entities.append({"type": "authorized_signature", "value": signature, "confidence": 1.0})
    route.fulfill(json={"message": {
        "invoice_no": no, "invoice_date": date.today().isoformat(), "amount": str(amount),
        "net_amount": str(base), "base_amount": str(base), "gst_amount": str(gst), "gst_note": "",
        "supplier_gstin": "", "receiver_gstin": "", "entities": entities, "line_items": [],
        "confidence": {k: 1.0 for k in ("invoice_no", "invoice_date", "amount", "net_amount", "base_amount",
                                        "gst_amount")},
        "line_item_validation": None, "line_match": None, "credit_note_detected": False,
    }})


def loaded(page) -> None:
    page.get_by_text("Loading data...").wait_for(state="hidden", timeout=60_000)
    page.wait_for_load_state("networkidle")


def open_work_order(page, side: str, cid: str, wo: str, ready: str | None) -> None:
    """Sidebar Work Orders › All WO › search by WO ID › the WO's link, as the Procurement Executive does. Waits
    for the generated invoice `ready`'s Print button, or with None for the Invoices card's Add Invoice."""
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
    page.get_by_role("button", name=f"Print {ready}" if ready else "Add Invoice", exact=True).first.wait_for(
        timeout=60_000)


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


def add_invoice(page, side: str, cid: str, no: str, amount: float, signature: str | None, what: str,
                base: float | None = None, gst: float = 0) -> bool:
    """Add Invoice of `no` as the AI reads it; shoots the filled dialog with its button boxed, then saves.
    Returns whether the unsigned-copy warning showed."""
    answer.clear()
    answer.update(no=no, amount=amount, signature=signature, base=amount if base is None else base, gst=gst)
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
    st = state[side]
    st.update({"seed": seed, "wo": wo, "A": A, "B": B, "C": C, "D": d_no, "d_amount": d_amount})
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


# ---------------------------------------------------------------- decisions 3, 7 and 10

PICK = '''"""Pick the Work Orders the walk of decisions 3, 7 and 10 uses, from the env's own data, with their figures."""
import json, sys
import frappe
from frappe.utils import flt
from nirmaan_stack.api.service_requests import generated_invoices as gi_api
from nirmaan_stack.services import payment_tds
from nirmaan_stack.services.amount_paid import amount_paid_of

SR = "Service Requests"


def paid_sum(wo, gst_only=False):
    """The WO's Paid payments, or their GST payments only (`gst_part_of_amount_paid` on the branch; develop has
    no such helper, so the walk reads it the same way on both sides)."""
    return flt(frappe.db.sql("""SELECT COALESCE(SUM(amount), 0) FROM "tabProject Payments" WHERE document_type = %s
        AND document_name = %s AND status = 'Paid'""" + (" AND is_gst_payment = 1" if gst_only else ""), (SR, wo))[0][0])
pe = sys.argv[1]
projects = frappe.get_all("User Permission", filters={"user": pe, "allow": "Projects"}, pluck="for_value")
frappe.set_user(pe)
visible = sorted(frappe.get_list(SR, filters={"status": "Approved", "project": ("in", projects)}, pluck="name",
                                 limit_page_length=0))
frappe.set_user("Administrator")


def figures(wo):
    sr = frappe.get_doc(SR, wo)
    by = {s: (flt(a), flt(g), n) for s, a, g, n in frappe.db.sql(
        """SELECT status, COALESCE(SUM(invoice_amount), 0), COALESCE(SUM(invoice_gst_amount), 0), COUNT(*)
           FROM "tabVendor Invoices" WHERE document_type = %s AND document_name = %s GROUP BY status""", (SR, wo))}
    tds = payment_tds.borne_tds_by_order(SR, [wo]).get(wo)
    state = gi_api._billing_state(sr)
    f = {"wo": wo, "gst_on": sr.gst == "true", "total": flt(sr.total_amount), "paid": flt(sr.amount_paid),
         "paid_from_source": flt(amount_paid_of(SR, wo)),
         "paid_payments": paid_sum(wo), "vendor_tds": flt(tds.vendor) if tds else 0.0,
         "gst_paid": paid_sum(wo, gst_only=True),
         "approved": by.get("Approved", (0, 0, 0))[0], "approved_gst": by.get("Approved", (0, 0, 0))[1],
         "pending": by.get("Pending", (0, 0, 0))[0], "pending_count": by.get("Pending", (0, 0, 0))[2],
         "open_generated": frappe.db.count("WO Generated Invoice", {"work_order": wo, "status": "Generated"}),
         "min_amount": state["min_amount"], "max_amount": state["max_amount"]}
    f["need"] = round(f["paid"] - f["approved"], 2)
    f["base_need"] = round((f["paid"] - f["gst_paid"]) - (f["approved"] - f["approved_gst"]), 2)
    return f


def room(f, amount):   # the upload's overage check: Pending + Approved + this <= total + 10
    return f["approved"] + f["pending"] + amount <= f["total"] + 10


# Still in the starting state: no invoice waiting (an earlier run's upload leaves one) and no generated invoice
# not yet uploaded (so no number of the walk's can be a generated one's).
rows = [f for f in map(figures, visible) if f["total"] > 0 and not f["open_generated"] and not f["pending_count"]]
off = [f for f in rows if not f["gst_on"] and f["need"] > 100 and abs(f["paid"] - f["total"]) > 100
       and room(f, f["need"] + 60)]
# The one read on both sides and never written: the last by name, so a rerun reads the same one.
limits = max(off, key=lambda f: f["wo"]) if off else None
rest = sorted((f for f in off if f is not limits), key=lambda f: (f["vendor_tds"] <= 0, f["wo"]))
match, near, typed = (rest + [None] * 3)[:3]
rule2 = next((f for f in rest[3:] if room(f, f["total"] - f["approved"])), None)
on = next((f for f in rows if f["gst_on"] and f["base_need"] > 100
           and room(f, round(f["base_need"] * 1.18, 2))
           and abs(f["approved"] + round(f["base_need"] * 1.18, 2) - f["total"]) > 1), None)
po = frappe.db.sql("""SELECT name, invoice_no, document_name, auto_approve_skip_reasons FROM "tabVendor Invoices"
    WHERE document_type = 'Procurement Orders' AND status = 'Pending' AND COALESCE(auto_approve_skip_reasons, '') != ''
    ORDER BY name LIMIT 1""", as_dict=True)
print(json.dumps({"limits": limits, "match": match, "near": near, "typed": typed, "rule2": rule2, "gst_on": on,
                  "po": po[0] if po else None, "candidates": len(off)}, default=str))
'''

INVOICE = '''import json, sys
import frappe
rows = frappe.get_all("Vendor Invoices", filters={"invoice_no": ("in", sys.argv[1:])},
                      fields=["name", "invoice_no", "status", "approved_by", "auto_approved", "autofill_used",
                              "invoice_amount", "invoice_gst_amount", "auto_approve_skip_reasons", "document_name"])
print(json.dumps({r.invoice_no: r for r in rows}, default=str))
'''


def py(task: str, label: str, source: str, *args: str) -> dict:
    """Run `source` on the env with its site connected; keep the script and its output under db/; its last JSON line."""
    (out / "db").mkdir(exist_ok=True)
    src = out / "db" / f"{label}.py"
    src.write_text(source)
    res = subprocess.run([DEVENV, "script", task, str(src), *args], capture_output=True, text=True, timeout=600)
    (out / "db" / f"{task}-{label}-{len(list((out / 'db').iterdir()))}.txt").write_text(
        " ".join(args) + "\n\n" + res.stdout + res.stderr)
    line = next((ln for ln in reversed(res.stdout.splitlines()) if ln.startswith("{")), None)
    if line is None:
        raise RuntimeError(f"{label} on {task} printed no JSON:\n{res.stdout[-800:]}\n{res.stderr[-800:]}")
    return json.loads(line)


def invoices(task: str, *numbers: str) -> dict:
    return py(task, "invoices", INVOICE, *numbers)


def walk_no(tag: str, wo: str) -> str:
    """A made-up invoice number of its own (no generated invoice has it, so rule 1 cannot apply)."""
    return f"WALK-{date.today():%y%m%d}-{tag}{wo.rsplit('-', 1)[1]}"


def hover_card(page, trigger):
    """Hover a Not Auto-Approved Reason cell; its card's text and its box measured now (a locator pin would scroll
    first, and the card closes). ("", the trigger) when no card opens."""
    try:
        trigger.hover(timeout=10_000)
        card = page.locator("[data-radix-popper-content-wrapper]").first
        card.wait_for(timeout=10_000)
        page.wait_for_timeout(700)
        b = card.bounding_box()
        return card.inner_text(), {"x": round(b["x"]), "y": round(b["y"]), "w": round(b["width"]),
                                   "h": round(b["height"])}
    except Exception:
        return "", trigger


def pick_part(side: str) -> None:
    """Pick the records of decisions 3, 7 and 10 from this env's data before anything is written, and check the
    figures ADR-0050 decision 3 states."""
    task = ENVS[side]
    got = py(task, "pick", PICK, a.user)
    state[side] = {"pick": got}
    if side == "after" and "before" in state:
        then = state["before"]["pick"]
        for key in ("limits", "match", "near", "typed", "rule2", "gst_on", "po"):
            ids = [(x or {}).get("wo") or (x or {}).get("name") for x in (got[key], then[key])]
            w.check("d10" if key in ("limits", "po") else "d3", PE, f"both sides picked the same {key} record",
                    f"after {ids[0]} | before {ids[1]}", ids[0] == ids[1])
    m = got["match"]
    if not m:
        return
    seen = can_see(task, a.user, m["wo"])
    w.check("d3", PE, f"{a.user} sees {m['wo']} (GST-off, Approved)", f"get_list count {seen}", seen == 1,
            kind="info")   # `visible` is that user's own get_list: every picked WO passes it
    w.check("d3", PE, f"DB: {m['wo']}'s Amount Paid includes vendor TDS: Paid payments {rupees(m['paid_payments'])} "
            f"+ TDS {rupees(m['vendor_tds'])}", f"Amount Paid {m['paid']:.2f}",
            m["vendor_tds"] > 0 and abs(m["paid_payments"] + m["vendor_tds"] - m["paid"]) <= 0.01)
    w.check("d3", PE, f"DB: {m['wo']}'s stored Amount Paid = recomputed from source",
            f"{m['paid']:.2f} vs {m['paid_from_source']:.2f}", abs(m["paid"] - m["paid_from_source"]) <= 0.01,
            kind="info")
    w.check("d3", PE, f"DB: {m['wo']}'s Approved WO invoices (status Approved only) {rupees(m['approved'])}, its "
            f"Pending {rupees(m['pending'])} left out; the new invoice = Amount Paid − Approved = {rupees(m['need'])}",
            f"{m['paid']:.2f} − {m['approved']:.2f} = {m['need']:.2f}",
            abs(m["approved"] + m["need"] - m["paid"]) <= 0.01, kind="info")
    w.check("d3", PE, f"rule 2 cannot be what approves it: Amount Paid {rupees(m['paid'])} ≠ WO total "
            f"{rupees(m['total'])} by more than ₹1", f"{abs(m['paid'] - m['total']):.2f}",
            abs(m["paid"] - m["total"]) > 1, kind="info")


def typed_invoice(page, side: str, cid: str, no: str, amount: float, base: float, gst: float, what: str) -> None:
    """Add Invoice whose AI read returns nothing, so the Procurement Executive types the number, date and amounts.
    Shoots the filled dialog with the amount field pinned and the button boxed, then saves."""
    answer.clear()
    answer["empty"] = True
    page.get_by_role("button", name="Add Invoice", exact=True).first.click()
    dialog = page.get_by_role("alertdialog")
    dialog.get_by_text("Upload your invoice").wait_for()
    dialog.locator("input[type=file]").set_input_files(scan(no))
    dialog.locator("#invoice_no").wait_for(timeout=60_000)
    dialog.locator("#invoice_no").fill(no)
    dialog.locator("#invoice_date").fill(date.today().isoformat())
    for field, value in (("#invoice_amount", amount), ("#invoice_base_amount", base), ("#invoice_gst_amount", gst)):
        dialog.locator(field).fill(f"{value:.2f}")
    button = dialog.get_by_role("button", name="Add Invoice", exact=True)
    for _ in range(40):
        if button.is_enabled():
            break
        page.wait_for_timeout(500)
    amount_box = dialog.locator("#invoice_amount")
    marked = "amber" in (amount_box.get_attribute("class") or "")
    w.check(cid, PE, "the typed amount carries no AI mark (AI-filled fields are amber)",
            "amber" if marked else "plain", not marked, kind="info")
    w.step(page, cid, side, PE, a.user, f"Add Invoice of {no}: the AI read nothing, so the number, date and amount "
           f"{rupees(amount)} are typed by hand ({what}). Save it.", click=button,
           pins=[pin(amount_box, f"Typed: {rupees(amount)}, " + ("marked amber." if marked else "no amber AI mark."),
                     "info")])
    toast(page, "Success")
    dialog.wait_for(state="hidden", timeout=30_000)
    page.reload()
    loaded(page)


def no_decision_buttons(row) -> bool:
    """The row offers no Approve or Reject (by name, or the check and cross icon buttons)."""
    return not (row.get_by_role("button", name=re.compile(r"approve|reject", re.I)).count()
                or row.locator("button:has(svg.lucide-check), button:has(svg.lucide-x)").count())


def rule3_pe_part(side: str) -> None:
    """As the Procurement Executive: Add Invoice on the rule-3 match, the near miss, the typed match, the typed
    rule-2 match and the GST-on match, each on its own WO picked by `pick_part`."""
    task, st = ENVS[side], state[side]
    p = st["pick"]
    plan = []   # (claim, record, tag, amount, base, gst, typed, what)
    if p["match"]:
        m = p["match"]
        plan.append(("d3", m, "R3M", m["need"], m["need"], 0, False,
                     f"Approved {rupees(m['approved'])} + it = Amount Paid {rupees(m['paid'])} (incl. TDS "
                     f"{rupees(m['vendor_tds'])}); WO total {rupees(m['total'])}"))
    if p["near"]:
        n = p["near"]
        plan.append(("d3", n, "R3N", n["need"] + 50, n["need"] + 50, 0, False,
                     f"a near miss: Approved {rupees(n['approved'])} + it = Amount Paid {rupees(n['paid'])} + ₹50"))
    if p["typed"]:
        t = p["typed"]
        plan.append(("d7", t, "R3T", t["need"], t["need"], 0, True,
                     f"Approved {rupees(t['approved'])} + it = Amount Paid {rupees(t['paid'])}"))
    if p["rule2"]:
        r = p["rule2"]
        amount = round(r["total"] - r["approved"], 2)
        plan.append(("d7", r, "R2T", amount, amount, 0, True,
                     f"Approved {rupees(r['approved'])} + it = WO total {rupees(r['total'])}; Amount Paid "
                     f"{rupees(r['paid'])}, so only rule 2 can match"))
    if p["gst_on"]:
        g = p["gst_on"]
        base = g["base_need"]
        gst = round(base * 0.18, 2)
        plan.append(("d3", g, "R3G", round(base + gst, 2), base, gst, False,
                     f"GST-on: base Approved {rupees(g['approved'] - g['approved_gst'])} + base {rupees(base)} = "
                     f"base paid {rupees(g['paid'] - g['gst_paid'])} (GST payments {rupees(g['gst_paid'])} left out)"))
    done = st["rule3"] = []
    with session(task, a.user, a.password) as (page, _):
        page.route(EXTRACT, ai_read)
        for cid, rec, tag, amount, base, gst, typed, what in plan:
            no = walk_no(tag, rec["wo"])
            open_work_order(page, side, cid, rec["wo"], None)
            if typed:
                typed_invoice(page, side, cid, no, amount, base, gst, what)
            else:
                add_invoice(page, side, cid, no, amount, None, what, base=base, gst=gst)
            row = invoice_row(page, no)
            row.first.wait_for(timeout=60_000)
            approved = "Approved" in row_text(row)
            pins = [pin(row, f"{no}: {'Approved' if approved else 'Pending'}", "info")]
            if tag == "R3N":
                bare = no_decision_buttons(row.first)
                w.check("d10", PE, f"the Procurement Executive's row of Pending {no} offers no Approve or Reject",
                        "none" if bare else "offered", bare)
                pins.append(pin(row.first.locator("td").last, "No Approve or Reject for the Procurement Executive.",
                                "info"))
            w.step(page, "d10" if tag == "R3N" else cid, side, PE, a.user,
                   f"{no} ({rupees(amount)}): its Vendor Invoice reads {'Approved' if approved else 'Pending'}"
                   + (", and its row offers the Procurement Executive no Approve or Reject." if tag == "R3N" else "."),
                   pins=pins)
            done.append({"cid": cid, "tag": tag, "no": no, "wo": rec["wo"], "amount": amount, "rec": rec,
                         "screen": "Approved" if approved else "Pending"})
    db_rows = invoices(task, *[d["no"] for d in done])
    labels = {"R3M": "rule 3", "R3T": "rule 3, typed", "R2T": "rule 2, typed", "R3G": "rule 3, GST-on base"}
    for d in done:
        inv = db_rows.get(d["no"]) or {}
        got = (inv.get("status"), inv.get("approved_by"), inv.get("auto_approved"))
        rec, tag = d["rec"], d["tag"]
        if side == "before":
            w.check(d["cid"], PE, f"before: {d['no']} stays Pending (no WO auto-approval on develop)",
                    f"{got[0]} / {inv.get('auto_approve_skip_reasons')}", got[0] == "Pending", kind="info")
            continue
        if tag == "R3N":
            want = f"wo_paid_mismatch:{rec['paid']:.2f}:{rec['approved'] + d['amount']:.2f}"
            reasons = inv.get("auto_approve_skip_reasons") or ""
            w.check("d3", PE, f"DB: near miss {d['no']} stays Pending with {want}", f"{got[0]} / {reasons}",
                    got[0] == "Pending" and want in reasons)
            w.check("d3", PE, "± ₹1: the near miss is ₹50 over Amount Paid, outside ₹1",
                    f"{rec['approved'] + d['amount'] - rec['paid']:.2f}",
                    abs(rec["approved"] + d["amount"] - rec["paid"]) > 1, kind="info")
            continue
        w.check(d["cid"], PE, f"DB: {d['no']} ({labels[tag]}) Approved by System, auto_approved 1", str(got),
                got == ("Approved", "System", 1))
        w.check(d["cid"], PE, f"screen: {d['no']}'s row reads Approved", d["screen"], d["screen"] == "Approved")
        if tag in ("R3T", "R2T"):
            w.check("d7", PE, f"DB: {d['no']} was typed (autofill_used 0)", str(inv.get("autofill_used")),
                    not inv.get("autofill_used"))
        if tag == "R2T":
            w.check("d7", PE, f"only rule 2 can match {d['no']}: Approved + it {rupees(rec['approved'] + d['amount'])} "
                    f"vs Amount Paid {rupees(rec['paid'])} differ by more than ₹1",
                    f"{abs(rec['approved'] + d['amount'] - rec['paid']):.2f}",
                    abs(rec["approved"] + d["amount"] - rec["paid"]) > 1, kind="info")
        if tag in ("R3M", "R3T"):
            w.check("d3", PE, f"± ₹1: {d['no']}'s Approved + it vs Amount Paid within ₹1",
                    f"{rec['approved'] + d['amount']:.2f} vs {rec['paid']:.2f}",
                    abs(rec["approved"] + d["amount"] - rec["paid"]) <= 1, kind="info")


def search_tab(page, tab: str, text: str):
    page.get_by_role("button", name=tab, exact=True).click()
    page.wait_for_load_state("networkidle")
    search = page.get_by_role("textbox", name=re.compile(r"^Search")).first
    search.fill(text)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)
    return search


def kept(side: str, role: str, key: str, now: str, what: str) -> str:
    """Decision 10: keep `now` under `key`; on the after side check it reads as the before side's did. The kind of
    pin the step shows it with: `must` when they differ (ADR-0050 decisions 1-9 change none of these screens)."""
    state[side][key] = now
    (out / f"{key}-{side}.txt").write_text(now)
    if side != "after" or "before" not in state:
        return "info"
    then = state["before"].get(key)
    w.check("d10", role, f"{what} reads the same before and after",
            "same" if now == then else f"after: {now[:200]} | before: {str(then)[:200]}", now == then)
    return "info" if now == then else "must"


def preview(page, side: str, cid: str, acc: str, tab: str, caption: str, pin_text: str, pattern: str,
            keep: str | None = None) -> str:
    """Re-check on the tab open now, preview only: shoot it with the first `pattern` match pinned, Cancel. With
    `keep`, the preview's text is decision 10's, compared across the sides (`kept`)."""
    page.get_by_role("button", name="Re-check", exact=True).click()
    dlg = page.get_by_role("dialog")
    dlg.get_by_text("Re-check results").wait_for(timeout=60_000)
    page.wait_for_timeout(1500)
    text = dlg.inner_text()
    (out / f"recheck-{tab}-{cid}-{side}.txt").write_text(text)
    kind = kept(side, ACC, keep, text, "the PO tab's Re-check preview text and counts") if keep else "info"
    mark = dlg.get_by_text(re.compile(pattern)).first
    w.step(page, cid, side, ACC, acc, caption(text) + " Cancel: nothing is applied.",
           click=dlg.get_by_role("button", name="Cancel", exact=True),
           pins=[pin(mark, pin_text if kind == "info" else "Differs from develop's preview.", kind)]
           if mark.count() else [])
    return text


def rule3_acc_part(side: str) -> None:
    """As the Accountant: the rule-3 match is not waiting, the near miss's reason, Re-check's preview, the PO tab's
    reason and Re-check (decision 10), and an approval by hand (after only)."""
    task, st = ENVS[side], state[side]
    acc = st["seed"]["accountant"]
    by_tag = {d["tag"]: d for d in st.get("rule3", [])}
    po = st["pick"]["po"]
    m, n = by_tag.get("R3M"), by_tag.get("R3N")
    with session(task, acc, a.password) as (page, _):
        accountant_rows(page)
        if m:
            search = search_tab(page, "WO", m["wo"])
            row = page.get_by_role("row").filter(has_text=m["no"])
            listed = row.count() > 0
            if side == "after":
                w.check("d3", ACC, f"Pending Invoice Approvals › WO does not list {m['no']} (approved by the System)",
                        "listed" if listed else "not listed", not listed)
            w.step(page, "d3", side, ACC, acc, f"As the Accountant, Pending Invoice Approvals › WO, searched "
                   f"{m['wo']}: {m['no']} is " + ("listed, waiting for an Accountant." if listed else
                                                  "not here: nothing waits for an Accountant."),
                   pins=[pin(row if listed else search, f"{m['no']} {'waits' if listed else 'is not listed'}.",
                             "info")])
        if n:
            search_tab(page, "WO", n["wo"])
            row = page.get_by_role("row").filter(has_text=n["no"]).first
            row.wait_for(timeout=30_000)
            rec = n["rec"]
            label = f"Invoices + this {rupees(rec['approved'] + n['amount'])} ≠ Amount Paid {rupees(rec['paid'])}"
            card, target = hover_card(page, row.locator("div.cursor-default.rounded").first)
            shown = row.inner_text() + "\n" + card
            if side == "after":
                w.check("d3", ACC, f"{n['no']}'s reason shows {label!r} (the figures the walk computed)",
                        "shown" if label in shown else shown[-240:], label in shown)
            w.step(page, "d3", side, ACC, acc,
                   f"Pending Invoice Approvals › WO, searched {n['wo']}: the near miss {n['no']}'s Not Auto-Approved "
                   "Reason, hovered" + (f": {label}." if side == "after" else "."),
                   pins=[pin(target, "The reason on develop." if side == "before" else
                             "The Amount Paid reason with its figures." if label in shown else
                             f"Not the figures the walk computed: {label}.", "must" if side == "after" and label
                             not in shown else "info")], settle_ms=200)
            page.mouse.move(0, 0)
            page.wait_for_timeout(600)
        # Re-check on the WO tab after the walk's uploads: does a Pending WO invoice match by rule 3 now?
        search_tab(page, "WO", "")
        text = preview(page, side, "d3", acc, "wo", lambda t: "Re-check on the WO tab after the walk's uploads: the "
                       "preview " + (f"names {len(re.findall('Rule 3 · ', t))} invoice(s) by rule 3." if "Rule 3 · "
                                     in t else "names no invoice by rule 3."),
                       "Rule 3 and its two figures.", r"Rule 3 · ")
        rule3 = re.findall(r"Rule 3 · invoiced (₹[\d,]+) = Amount Paid (₹[\d,]+)", text)
        if side == "after":
            st["rule3_recheck"] = rule3
            if rule3:
                state["rule3_seen"] = True
                w.check("d3", ACC, "Re-check's preview names a Pending WO invoice matching rule 3",
                        "; ".join(f"{x} = {y}" for x, y in rule3),
                        all(abs(money(x) - money(y)) <= 1 for x, y in rule3))

        # Decision 10: the PO tab, the same PO invoice on both sides
        if po:
            search = search_tab(page, "PO", po["document_name"])
            row = page.get_by_role("row").filter(has_text=po["invoice_no"]).first
            row.wait_for(timeout=30_000)
            trigger = row.locator("div.cursor-default.rounded").first
            cell = trigger.inner_text() if trigger.count() else row.inner_text()
            card, target = hover_card(page, trigger if trigger.count() else row)
            kind = kept(side, ACC, "po_reason", cell + "\n---\n" + card, "the PO invoice's reason cell and hover")
            w.step(page, "d10", side, ACC, acc,
                   f"Pending Invoice Approvals › PO, searched {po['document_name']}: {po['invoice_no']}'s Not "
                   f"Auto-Approved Reason \"{cell}\", hovered.",
                   pins=[pin(target, "The PO invoice's reasons." if kind == "info" else "Differs from develop.",
                             kind)], settle_ms=200)
            page.mouse.move(0, 0)
            page.wait_for_timeout(600)
            search.fill("")
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(1500)
            preview(page, side, "d10", acc, "po", lambda t: "Pending Invoice Approvals › PO: Re-check's preview.",
                    "The PO tab's preview: the PO-value checks.", r"PO-value", keep="po_recheck")

        # Decision 10: a person approves by hand (after only)
        if side == "after" and n:
            search_tab(page, "WO", n["wo"])
            row = page.get_by_role("row").filter(has_text=n["no"]).first
            row.wait_for(timeout=30_000)
            w.step(page, "d10", side, ACC, acc, f"As the Accountant, approve the near miss {n['no']} by hand: its "
                   "row's Approve.", click=row.locator("button:has(svg.lucide-check)").first)
            confirm = page.get_by_role("alertdialog").filter(has_text="Confirm Approval").get_by_role(
                "button", name=re.compile(r"^\s*Approve\s*$"))
            confirm.wait_for(timeout=30_000)
            page.wait_for_timeout(2000)   # the comparison inside it loads
            w.step(page, "d10", side, ACC, acc, "Confirm Approval: Approve.", click=confirm)
            toast(page, "Success")
            page.wait_for_timeout(2000)
    if side == "after" and n:
        inv = invoices(task, n["no"]).get(n["no"]) or {}
        got = (inv.get("status"), inv.get("approved_by"), inv.get("auto_approved"))
        w.check("d10", ACC, f"DB: {n['no']} approved by hand: Approved, approved_by the Accountant, auto_approved 0",
                str(got), got[0] == "Approved" and got[1] == acc and not got[2])


def limits_part(side: str) -> None:
    """Decision 10 as the Procurement Executive, on one WO read and never written: Request Payment's invoice check
    and limit, and Generate Invoice's range. The after side compares with the before side's text."""
    task, st = ENVS[side], state[side]
    lim = st["pick"]["limits"]
    if not lim:
        return
    w.check("d10", PE, f"{lim['wo']}'s Approved invoices {rupees(lim['approved'])} are below its Amount Paid "
            f"{rupees(lim['paid'])}", f"{lim['approved']:.2f} < {lim['paid']:.2f}", lim["approved"] < lim["paid"],
            kind="info")
    with session(task, a.user, a.password) as (page, _):
        open_work_order(page, side, "d10", lim["wo"], None)
        req = page.get_by_role("button", name="Request Payment", exact=True).first
        req.wait_for(timeout=30_000)
        w.step(page, "d10", side, PE, a.user, f"{lim['wo']}: Request Payment.", click=req)
        dlg = page.get_by_role("alertdialog").filter(has_text="Request Payment")
        dlg.wait_for(timeout=30_000)
        page.wait_for_timeout(2500)
        kind = kept(side, PE, "payment", dlg.inner_text(), f"Request Payment's invoice check and limit on {lim['wo']}")
        pins = [pin(x, x.inner_text() if kind == "info" else "Differs from develop: " + x.inner_text(), kind) for x in (dlg.get_by_text(re.compile(r"^Raised ₹")).first,
                                                         dlg.get_by_text(re.compile(r"in approved invoices")).first)
                if x.count()]
        w.step(page, "d10", side, PE, a.user, "Request Payment on a WO whose Approved invoices are below its Amount "
               "Paid: the invoice check and the limit it shows. Cancel.", pins=pins,
               click=dlg.get_by_role("button", name="Cancel", exact=True))
        page.wait_for_timeout(1000)
        gen = page.get_by_role("button", name="Generate Invoice", exact=True).first
        gen.wait_for(timeout=30_000)
        w.step(page, "d10", side, PE, a.user, f"{lim['wo']}'s Invoices card: Generate Invoice.", click=gen)
        gdlg = page.get_by_role("dialog").filter(has_text="Generate Invoice for")
        gdlg.wait_for(timeout=30_000)
        page.wait_for_timeout(1500)
        rng = gdlg.get_by_text(re.compile(r"^Bill ")).first
        text = rng.inner_text() if rng.count() else gdlg.inner_text()
        kind = kept(side, PE, "generate", text, f"Generate Invoice's range on {lim['wo']}")
        w.step(page, "d10", side, PE, a.user, f"Generate Invoice's range: \"{text}\". Close it.",
               pins=[pin(rng, "The allowed range." if kind == "info" else "Differs from develop.", kind)]
               if rng.count() else [])
        page.keyboard.press("Escape")


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


PLAN = [(("d3", "d7", "d10"), pick_part), (("d1", "d4", "d6", "d8", "amend_c"), pe_part),
        (("d5", "d8", "d9"), acc_part), (("d2",), match_part), (("d10",), limits_part),
        (("d3", "d7", "d10"), rule3_pe_part), (("d3", "d10"), rule3_acc_part)]
for side in ("before", "after"):
    if side not in a.sides:
        continue
    for cids, fn in PLAN:
        if (fn is pick_part or side in state) and (not a.only or fn.__name__ in a.only or fn is pick_part):
            if not guarded(cids, fn, side):
                state.pop(side, None)
                break

after = state.get("after", {})
tags = {d["tag"] for d in after.get("rule3", [])}
NOT_WALKED = {}
if "R3M" not in tags:
    NOT_WALKED["d3"] = ("No GST-off WO on the Procurement Executive's projects had Amount Paid above its Approved "
                        "invoices with room under its total, so no rule-3 match was set up. Pinned by "
                        "services/test_work_order_invoice_rules.TestRuleThreeAmountPaid and "
                        "api/invoices/test_wo_auto_approve.TestRuleThreeAtUpload.")
if not tags & {"R3T", "R2T"}:
    NOT_WALKED["d7"] = ("No WO was left for a typed match. Pinned by api/invoices/test_wo_auto_approve."
                        "TestRuleThreeAtUpload.test_a_typed_invoice_equal_to_amount_paid_is_approved.")
d3_left = []
if "R3G" not in tags:
    d3_left.append("the GST-on base-vs-base case: no GST-on WO on the Procurement Executive's projects has base paid "
                   "above base Approved with room under its total (services/test_work_order_invoice_rules."
                   "TestRuleThreeOnAGstOnWorkOrder)")
if not state.get("rule3_seen"):
    d3_left.append("Re-check naming rule 3: no Pending WO invoice in this env's data equals Amount Paid, so the "
                   "preview names none (the step shows it; api/invoices/test_wo_auto_approve."
                   "TestReCheckOnTheWorkOrderTab)")
d10_walked = [what for what, key in (("the PO tab's reason and Re-check", "po_recheck"),
                                     ("Request Payment's invoice check", "payment"),
                                     ("Generate Invoice's range", "generate")) if key in after]
if "R3N" in tags:
    d10_walked.append("an approval by hand")
PARTLY = {
    "d3": "Not walked: " + "; ".join(d3_left) + "." if d3_left else "",
    "d7": "" if "R2T" in tags else ("Not walked: a typed amount matching rule 2 (no WO was left where only rule 2 "
                                    "can match; api/invoices/test_wo_auto_approve.TestRuleTwoAtUpload)."),
    "d10": "Walked on the same records before and after: " + (", ".join(d10_walked) or "none") + ". Not walked: who may "
           "upload, generate or edit, beyond the Procurement Executive's row offering no Approve or Reject "
           "(services/test_work_order_invoice_access).",
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
    if c["id"] in NOT_WALKED and not (bad or musts):   # a failed check is never hidden as "not walked"
        w.status(c["id"], "not_walked", NOT_WALKED[c["id"]])
        continue
    if not walked:
        w.status(c["id"], "not_walked", "no step or check reached it")
        continue
    w.status(c["id"], "failed" if bad or musts else "seen",
             "; ".join(f"{k['role']}: expected {k['expect']}, saw {k['seen']}" for k in bad) or PARTLY.get(c["id"], ""))
print(w.save())
