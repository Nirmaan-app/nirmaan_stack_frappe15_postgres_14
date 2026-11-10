#!/usr/bin/env python3
"""Walk Vendor Invoice Recon. Two parts (`--part`, default both):

- `uploader`: the uploader column as an Accountant: "Invoice Added By" (#1647) and "Invoice Uploaded By" on the
  2B Recon tabs (#1650).
- `decisions`: who may approve or reject a Purchase Order invoice (#1638). See `decisions_part` below.

    devenv.sh run <task> set-password walk-accountant@example.com <pw>     # after the seed's first run
    python3 .claude/skills/verify/bin/walk_vendor_invoice_recon.py --task <task> --password <pw> [--shots <dir>]

It runs `vendor_invoice_recon_seed.py` first (idempotent): two Pending invoices, and two Approved ones per document
type, get a made-up uploader each, one with a long full name, one with no name (the column shows the email). Then,
as the Accountant, for each tab that shows the column (sidebar Vendor Invoice Recon -> Pending Invoice Approvals,
then All Invoices, its search box narrowed to the PO; then PO Invoices 2B Recon and WO Invoices 2B Recon, their
search box narrowed to the invoice no):

- the cell shows the uploader's full name (or the email), one line, cut with "…" (`text-overflow: ellipsis` and
  the text wider than its box), ending inside its own cell, never under the Vendor column;
- a hover opens a tooltip with the whole text;
- the DB row: the invoice's `uploaded_by`, and the Nirmaan Users full name (none for the email row).

Every check prints `ok …`; a miss raises, saves `FAIL.*` and exits 1. Evidence: `$VERIFY_OUT`, else
~/claude-artifacts/verify/<task>/<UTC time>/. With `--shots`, each hovered cell is also saved there at half scale.
"""

import argparse
import json
import re
import subprocess
from pathlib import Path

from drive import save, session, sidebar
from playwright.sync_api import Page

ROOT = Path(__file__).resolve().parents[4]
BIN = ROOT / ".claude/skills/verify/bin"

ap = argparse.ArgumentParser()
ap.add_argument("--task", required=True)
ap.add_argument("--password", required=True)
ap.add_argument("--shots", type=Path)
ap.add_argument("--part", choices=("all", "uploader", "decisions"), default="all")
a = ap.parse_args()


def expect(ok: bool, what: str) -> None:
    if not ok:
        raise AssertionError(f"MISS: {what}")
    print(f"ok   {what}")


def env_script(name: str, *args: str) -> str:
    res = subprocess.run([str(ROOT / "scripts/devenv/devenv.sh"), "script", a.task, str(BIN / name), *args],
                         capture_output=True, text=True, check=True)
    return res.stdout.strip().splitlines()[-1]


def uploader_part() -> None:
    picked = json.loads(env_script("vendor_invoice_recon_seed.py"))
    ACCOUNTANT, LONG_NAME, NO_NAME_EMAIL = picked["accountant"], picked["long_text"], picked["no_name_email"]
    PREFIXES = ("", "po_", "wo_")  # Pending (both tables), then the Approved ones on each 2B Recon tab
    db = json.loads(env_script("vendor_invoice_recon_db.py", *(picked[f"{p}{k}"] for p in PREFIXES for k in ("long_name", "email"))))


    def cases(prefix: str) -> list[tuple[dict, str, str]]:
        return [(db[picked[f"{prefix}long_name"]], LONG_NAME, "full-name"), (db[picked[f"{prefix}email"]], NO_NAME_EMAIL, "email")]


    CASES = cases("")
    for prefix, status, doctype in (("", "Pending", None), ("po_", "Approved", "Procurement Orders"), ("wo_", "Approved", "Service Requests")):
        long_row, email_row = db[picked[f"{prefix}long_name"]], db[picked[f"{prefix}email"]]
        for row in (long_row, email_row):
            expect(row["status"] == status and (doctype is None or row["document_type"] == doctype),
                   f"DB: {row['document_name']} invoice {row['invoice_no']} is {status} {row['document_type']}")
        expect(long_row["uploaded_by"] == picked["long_user"] and long_row["full_name"] == LONG_NAME,
               f"DB: {picked[prefix + 'long_name']} uploaded by {LONG_NAME}")
        expect(email_row["uploaded_by"] == NO_NAME_EMAIL and email_row["full_name"] is None,
               f"DB: {picked[prefix + 'email']} uploaded by {NO_NAME_EMAIL}, who has no Nirmaan Users name")


    def check_cell(page: Page, out: Path, tab: str, row_db: dict, shown: str, slug: str, doc_is_link: bool = True) -> None:
        # Approval tables link the document id; the 2B Recon tables show it as plain text with an info link beside it.
        rows = page.get_by_role("row")
        if doc_is_link:
            row = rows.filter(has=page.get_by_role("link", name=row_db["document_name"], exact=True))
        else:
            row = rows.filter(has_text=row_db["document_name"]).filter(has_text=row_db["invoice_no"])
        row = row.filter(has=page.get_by_role("cell", name=shown, exact=True)).first
        cell = row.get_by_role("cell", name=shown, exact=True)
        cell.wait_for(timeout=30_000)
        text = cell.get_by_text(shown, exact=True)
        # A late redraw of the table (data or search arriving) can detach the element between finding and measuring
        # it; it then has no `td`. Measure again on the redrawn one.
        for _ in range(20):
            m = text.evaluate("""el => { const td = el.closest('td'); if (!td) return null;
                const s = getComputedStyle(el), r = el.getBoundingClientRect(), c = td.getBoundingClientRect();
                return {ellipsis: s.textOverflow, nowrap: s.whiteSpace, scroll: el.scrollWidth, client: el.clientWidth,
                        right: r.right, cellRight: c.right}; }""")
            if m:
                break
            page.wait_for_timeout(250)
        else:
            expect(False, f"{tab}, {row_db['document_name']}: the cell holding {shown!r} stays in the table")
        where = f"{tab}, {row_db['document_name']}"
        expect(m["ellipsis"] == "ellipsis" and m["nowrap"] == "nowrap", f"{where}: {shown!r} is one line, cut with an ellipsis")
        expect(m["scroll"] > m["client"], f"{where}: the text is wider than its box, so the ellipsis shows")
        expect(m["right"] <= m["cellRight"], f"{where}: the text ends inside its own cell ({m['right']:.0f} <= {m['cellRight']:.0f})")

        text.hover()
        tip = page.get_by_role("tooltip")
        tip.wait_for(timeout=5_000)
        expect(tip.inner_text().strip() == shown, f"{where}: hover shows the whole text {shown!r}")
        save(page, out, f"{tab.lower().replace(' ', '-')}-{slug}")
        if a.shots:
            a.shots.mkdir(parents=True, exist_ok=True)
            box = row.bounding_box()
            page.screenshot(path=str(a.shots / f"_{tab}-{slug}.png"), scale="css",
                            clip={"x": 0, "y": max(box["y"] - 120, 0), "width": 1440, "height": box["height"] + 240})
        page.keyboard.press("Escape")
        tip.wait_for(state="hidden", timeout=5_000)


    with session(a.task, ACCOUNTANT, a.password) as (page, out):
        (out / "db.json").write_text(json.dumps(db, indent=2))
        sidebar(page, "Vendor Invoice Recon")
        page.get_by_role("button", name="Pending Invoice Approvals", exact=True).click()
        page.wait_for_url(re.compile(r"tab=pending(&|$)"))
        page.wait_for_load_state("networkidle")
        for row_db, shown, slug in CASES:
            # Pending Approval is split into pills by document type (#1644): open the invoice's own.
            is_po = row_db["document_type"] == "Procurement Orders"
            page.get_by_role("button", name="PO" if is_po else "WO", exact=True).click()
            page.wait_for_load_state("networkidle")
            check_cell(page, out, "Pending Invoice Approvals", row_db, shown, slug)

        page.get_by_role("button", name="All Invoices", exact=True).click()
        page.wait_for_url(re.compile(r"tab=history(&|$)"))
        page.wait_for_load_state("networkidle")
        search = page.get_by_role("textbox", name=re.compile(r"^Search by PO"))
        for row_db, shown, slug in CASES:
            search.fill(row_db["document_name"])
            # The search is debounced: wait until every row is the PO's, or the redraw closes the hover's tooltip.
            page.wait_for_function("""doc => { const rows = [...document.querySelectorAll('tbody tr')]
                .filter(r => r.querySelector('a')); return rows.length > 0 && rows.every(r => r.textContent.includes(doc)); }""",
                                   arg=row_db["document_name"], timeout=30_000)
            page.wait_for_load_state("networkidle")
            check_cell(page, out, "All Invoices", row_db, shown, slug)

        # The 2B Recon tabs list Approved invoices, one tab per document type (#1650); search narrows by Invoice No.
        for tab, url_tab, prefix in (("PO Invoices 2B Recon", "po_invoices", "po_"), ("WO Invoices 2B Recon", "sr_invoices", "wo_")):
            page.get_by_role("button", name=tab, exact=True).click()
            page.wait_for_url(re.compile(rf"tab={url_tab}(&|$)"))
            page.wait_for_load_state("networkidle")
            search = page.get_by_role("textbox", name=re.compile(r"^Search by Invoice No"))
            for row_db, shown, slug in cases(prefix):
                search.fill(row_db["invoice_no"])
                # This search matches loosely (an amount can hold the number too), so wait for the table to be filtered
                # (the summary's chip) and to hold the invoice's row, not for every row to be the invoice's.
                page.get_by_text(f'"{row_db["invoice_no"]}"', exact=True).last.wait_for(timeout=30_000)
                page.wait_for_function("""([no, doc]) => [...document.querySelectorAll('tbody tr')]
                    .some(r => r.textContent.includes(no) && r.textContent.includes(doc))""",
                                       arg=[row_db["invoice_no"], row_db["document_name"]], timeout=30_000)
                page.wait_for_load_state("networkidle")
                check_cell(page, out, tab, row_db, shown, slug, doc_is_link=False)
        print(f"evidence: {out}")


APPROVE_API = "/api/method/nirmaan_stack.api.invoices.approve_vendor_invoice.approve_vendor_invoice"
PO_DECIDE_REFUSAL = "Only Admin and Accountants can approve or reject a Purchase Order invoice."


def shot(page: Page, out: Path, name: str) -> None:
    """Evidence `name`, and with `--shots` a half-scale copy there named for the criterion it proves."""
    save(page, out, name)
    if a.shots:
        a.shots.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(a.shots / f"{name}.png"), scale="css", full_page=False)


def decision_db(out: Path, step: str, *names: str) -> dict:
    db = json.loads(env_script("vendor_invoice_recon_db.py", *names))
    (out / f"{step}.db.json").write_text(json.dumps(db, indent=2))
    return db


def call(page: Page, method: str, url: str, body: dict) -> list:
    """Call the server from the page's own session, as a script in the browser would: [status, body text]."""
    return page.evaluate(
        """async ([method, url, body]) => {
            const r = await fetch(url, {method, body: JSON.stringify(body),
                headers: {'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': window.csrf_token}});
            return [r.status, await r.text()];
        }""",
        [method, url, body],
    )


def show_answer(page: Page, who: str, what: str, answer: list) -> None:
    """Put the server's real answer on the page for the screenshot (the user has no screen for this call)."""
    page.set_content(
        "<body style='font:14px monospace;padding:24px'><h3>{}</h3><p>{}</p><p>HTTP {}</p><pre style='white-space:pre-wrap'>{}</pre></body>"
        .format(who, what, answer[0], answer[1].replace("<", "&lt;")[:2000])
    )


def decisions_part() -> None:
    """Who may approve or reject a Purchase Order invoice (#1638), as the ticket's criteria name them.

    It runs `po_invoice_decision_seed.py` first: three Pending `WALK-1638-…` PO invoices and the made-up users.

    1. As the Accountant, through the screen (sidebar Vendor Invoice Recon -> Pending Invoice Approvals -> PO, the
       PO searched): the green tick, then Approve in "Confirm Approval", approves one; the red cross, a reason,
       then Reject in "Reject Invoice", rejects another. Each row leaves the queue; the DB row is Approved (by the
       Accountant) or Rejected (with the reason).
    2. As a procurement user and as an HR user, a direct call of the approve endpoint is refused (HTTP 403, the
       message names the rule), for approve and reject; a REST save of the status (`PUT /api/resource`) is refused
       too. The DB row stays Pending.
    """
    seeded = json.loads(env_script("po_invoice_decision_seed.py"))
    with session(a.task, seeded["accountant"], a.password) as (page, out):
        db = decision_db(out, "00-before", seeded["approve"], seeded["reject"], seeded["refuse"])
        for key in ("approve", "reject", "refuse"):
            expect(db[seeded[key]]["status"] == "Pending", f"DB: {key} invoice {db[seeded[key]]['invoice_no']} is Pending")

        sidebar(page, "Vendor Invoice Recon")
        page.get_by_role("button", name="Pending Invoice Approvals", exact=True).click()
        page.wait_for_url(re.compile(r"tab=pending(&|$)"))
        page.get_by_role("button", name="PO", exact=True).click()
        page.wait_for_load_state("networkidle")

        def row_of(key: str):
            inv = db[seeded[key]]
            search = page.get_by_role("textbox", name=re.compile(r"^Search by PO"))
            search.fill(inv["document_name"])
            row = page.get_by_role("row").filter(has_text=inv["invoice_no"]).first
            row.wait_for(timeout=30_000)
            page.wait_for_load_state("networkidle")
            return inv, page.get_by_role("row").filter(has_text=inv["invoice_no"]).first

        def left_queue(invoice_no: str, button: str) -> None:
            rows = page.get_by_role("row").filter(has_text=invoice_no)
            rows.first.wait_for(state="detached", timeout=30_000)
            expect(rows.count() == 0, f"Accountant: invoice {invoice_no} left the Pending queue after {button}")

        inv, row = row_of("approve")
        row.locator("button.text-green-600").click()
        dialog = page.get_by_role("alertdialog", name="Confirm Approval")
        dialog.wait_for(timeout=10_000)
        expect(inv["invoice_no"] in dialog.inner_text(), f"Confirm Approval names invoice {inv['invoice_no']}")
        dialog.get_by_role("button", name="Approve", exact=True).click()
        left_queue(inv["invoice_no"], "Approve")
        shot(page, out, "1-accountant-approves")
        after = decision_db(out, "01-after-approve", seeded["approve"])[seeded["approve"]]
        expect(after["status"] == "Approved", f"DB: {inv['invoice_no']} is Approved")
        expect(after["approved_by"] == seeded["accountant"], f"DB: approved by {after['approved_by']}")

        inv, row = row_of("reject")
        row.locator("button.text-red-600").click()
        dialog = page.locator("[role=dialog], [role=alertdialog]").filter(has_text="Reject Invoice")
        dialog.wait_for(timeout=10_000)
        dialog.get_by_role("textbox").fill("Walk #1638: wrong bill")
        dialog.get_by_role("button", name="Reject", exact=True).click()
        left_queue(inv["invoice_no"], "Reject")
        shot(page, out, "1-accountant-rejects")
        after = decision_db(out, "02-after-reject", seeded["reject"])[seeded["reject"]]
        expect(after["status"] == "Rejected", f"DB: {inv['invoice_no']} is Rejected")
        expect(after["rejection_reason"] == "Walk #1638: wrong bill", "DB: the rejection reason is stored")
        print(f"evidence: {out}")

    target = seeded["refuse"]
    for key, label in (("procurement", "Procurement Executive"), ("hr", "HR Executive")):
        with session(a.task, seeded[key], a.password) as (page, out):
            for action, reason in (("Approved", None), ("Rejected", "walk tries")):
                answer = call(page, "POST", APPROVE_API, {"invoice_id": target, "action": action, "rejection_reason": reason})
                (out / f"{key}-{action}.json").write_text(json.dumps(answer))
                expect(answer[0] == 403 and PO_DECIDE_REFUSAL in answer[1],
                       f"{label}: the approve endpoint refuses {action} ({answer[0]}, names the rule)")
            show_answer(page, f"As {seeded[key]} ({label})",
                        f"POST approve_vendor_invoice(invoice_id={target}, action=Approved)",
                        json.loads((out / f"{key}-Approved.json").read_text()))
            shot(page, out, f"1-{key}-refused")
            rest = call(page, "PUT", f"/api/resource/Vendor%20Invoices/{target}", {"status": "Approved"})
            (out / f"{key}-rest.json").write_text(json.dumps(rest))
            expect(rest[0] in (403, 417), f"{label}: a REST save of status Approved is refused ({rest[0]})")
            if key == "procurement":
                show_answer(page, f"As {seeded[key]} ({label})", f"PUT /api/resource/Vendor Invoices/{target} {{status: Approved}}", rest)
                shot(page, out, "2-rest-refused")
            after = decision_db(out, f"after-{key}", target)[target]
            expect(after["status"] == "Pending", f"DB: {after['invoice_no']} is still Pending after the {label}'s calls")
            print(f"evidence: {out}")


if a.part in ("all", "uploader"):
    uploader_part()
if a.part in ("all", "decisions"):
    decisions_part()
