"""Walk the Revised PO Date in a PO's preview and its downloaded PDF (graduated from PR #1731's walk).

    python3 -I .claude/skills/verify/bin/walk_revised_po_date.py <env> <out dir> [po_date ...]

It picks the most recently revised PO (an Approved PO Revision on a later day than the PO was made, so the two dates
differ) and a PO never revised, and reads from the env DB the date each must show: the latest revision's approval
date, else the PO's creation date.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from feature_walk import FeatureWalk, open_po, pin, settle, show_pdf  # noqa: E402

fw = FeatureWalk("Revised PO Date", "purchase-orders.md")
w = fw.w
w.change("po_date", "PO preview and PDFs › Revised PO Date",
         "A PO with an Approved PO Revision shows \"Revised PO Date\" = the latest approval date in its preview and "
         "PDFs (with and without rates); a never-revised PO still shows \"PO Date\" = its creation date.")

facts = fw.db("facts", r'''
LIVE = ("Merged", "Cancelled", "Inactive", "PO Amendment")
rev = frappe.db.sql("""SELECT r.revised_po po, MAX(r.approval_date) d, COUNT(*) n FROM "tabPO Revisions" r
    JOIN "tabProcurement Orders" po ON po.name = r.revised_po
    WHERE r.status = 'Approved' AND r.approval_date IS NOT NULL AND po.status NOT IN %s
    GROUP BY r.revised_po, po.creation HAVING MAX(r.approval_date)::date != po.creation::date
    ORDER BY MAX(r.approval_date) DESC LIMIT 1""", (LIVE,), as_dict=1)[0]
plain = frappe.db.sql("""SELECT po.name, po.creation FROM "tabProcurement Orders" po WHERE po.status = 'Delivered'
    AND NOT EXISTS (SELECT 1 FROM "tabPO Revisions" r WHERE r.revised_po = po.name AND r.status = 'Approved')
    ORDER BY po.creation DESC LIMIT 1""", as_dict=1)[0]


def project_name(po):
    return frappe.db.get_value("Projects", frappe.db.get_value("Procurement Orders", po, "project"), "project_name")


emit({"rev_po": rev.po, "rev_date": rev.d.strftime("%d-%b-%Y"), "rev_n": rev.n, "rev_project": project_name(rev.po),
      "rev_created": frappe.db.get_value("Procurement Orders", rev.po, "creation").strftime("%d-%b-%Y"),
      "plain_po": plain.name, "plain_date": plain.creation.strftime("%d-%b-%Y"), "plain_project": project_name(plain.name),
      "admins": candidates("Nirmaan Admin Profile")})
''')


def header_date(page) -> str:
    text = page.get_by_text(re.compile(r"PO Date:")).first.locator("..").inner_text()
    m = re.search(r"((?:Revised )?PO Date:\s*\S+)", text)
    return m.group(1) if m else text.strip()


def po_date() -> None:
    role = "Admin"
    user = fw.user(role, facts["admins"])
    with fw.session(user) as page:
        po = facts["rev_po"]
        open_po(page, po, facts["rev_project"])
        w.step(page, "po_date", "after", role, user,
               f"Purchase Orders › All POs › {po}: created {facts['rev_created']}, {facts['rev_n']} approved "
               "revision(s). Open Preview.", click=page.get_by_role("button", name="Preview", exact=True).first)
        settle(page, 3000)
        shown = header_date(page)
        want = f"Revised PO Date: {facts['rev_date']}"
        w.check("po_date", role, f"preview shows \"{want}\" (DB: latest approved revision)", shown, shown == want)
        for button, file in (("Download", "po-orders.pdf"), ("Download Without Rate", "po-orders-without-rate.pdf")):
            with page.expect_download(timeout=180_000) as d:
                w.step(page, "po_date", "after", role, user, f"The preview's header: \"{shown}\". Click {button}.",
                       click=page.get_by_role("button", name=button, exact=True).first,
                       pins=[pin(page.get_by_text(re.compile(r"PO Date:")).first.locator(".."), "Revised PO Date",
                                 "info")])
            pdf = fw.out / "files" / file
            pdf.parent.mkdir(parents=True, exist_ok=True)
            d.value.save_as(str(pdf))
            view, box, text, pages = show_pdf(page, pdf, "Revised PO Date")
            found = want in text.replace("\r", "")
            w.check("po_date", role, f"the {button} PDF says \"{want}\"", "found" if found else "not found", found)
            w.step(view, "po_date", "after", role, user,
                   f"Page 1 of the {button} PDF ({pages} pages), rendered as an image.",
                   pins=[pin(box, want, "info")] if box else [])
            view.close()

        po = facts["plain_po"]
        open_po(page, po, facts["plain_project"])
        page.get_by_role("button", name="Preview", exact=True).first.click()
        settle(page, 3000)
        shown = header_date(page)
        want = f"PO Date: {facts['plain_date']}"
        w.check("po_date", role, f"a PO never revised shows \"{want}\" (its creation date)", shown, shown == want)
        w.step(page, "po_date", "after", role, user, f"{po} was never revised: \"{shown}\".",
               pins=[pin(page.get_by_text(re.compile(r"PO Date:")).first.locator(".."), "PO Date", "info")])


fw.run([("po_date", po_date)])
fw.finish()
