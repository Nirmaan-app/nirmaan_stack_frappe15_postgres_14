"""Walk Work Orders on a vendor's page and in the Work Orders list (PR #1731): the vendor's Work Orders tab downloads
the "Vendor Work Orders" PDF of what its sub-tab shows, and the lists' Project and Vendor cells carry an ⓘ link (the
Vendor one hidden on the vendor's own page). As Admin.

    python3 -I .claude/skills/verify/bin/walk_vendor_work_orders.py <env> <out dir> [function ...]

The vendor is the service vendor with the most approved Work Orders, up to 30 so the PDF stays short, read from the
env DB at the start (db/facts.txt). Each PDF is saved under files/ with page 1 rendered as an image.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vendor_walk import PW, VendorWalk, num, session, settle, show_pdf, table_total  # noqa: E402

from record import pin  # noqa: E402

ROLE = "Admin"

# The vendor tab's counts (pages/vendors/data/useVendorQueries.useVendorServiceRequestCounts): Approved Service
# Requests, split by is_finalized; read through frappe.get_list as the walking user.
FACTS_SQL = r'''
user = sys.argv[1]
vendor = frappe.db.sql("""
    SELECT sr.vendor FROM "tabService Requests" sr JOIN "tabVendors" v ON v.name = sr.vendor
    WHERE sr.status = 'Approved' AND v.vendor_type IN ('Service', 'Material & Service')
    GROUP BY sr.vendor HAVING COUNT(*) >= 2
    ORDER BY (COUNT(*) <= 30) DESC, COUNT(*) DESC, sr.vendor LIMIT 1""")[0][0]
frappe.set_user(user)
wos = frappe.get_list("Service Requests", filters={"status": "Approved", "vendor": vendor},
                      fields=["name", "is_finalized"], limit_page_length=0)
frappe.set_user("Administrator")
print("JSON " + json.dumps({"vendor": vendor, "vendor_name": frappe.db.get_value("Vendors", vendor, "vendor_name"),
                            "wos": sorted(r.name for r in wos),
                            "approved": sum(not r.is_finalized for r in wos),
                            "finalized": sum(bool(r.is_finalized) for r in wos)}))
'''

WO_SQL = r'''
print("JSON " + json.dumps(frappe.db.get_value("Service Requests", sys.argv[1], ["project", "vendor"], as_dict=True)))
'''

vw = VendorWalk("Vendor › Work Orders")
w = vw.w
w.change("wo_pdf", "Vendor › Work Orders › Download PDF",
         "The vendor's Work Orders tab gets Download PDF: the \"Vendor Work Orders\" print format of what the table "
         "shows (All / Approved / Finalized).")
w.change("wo_links", "Work Order lists › Project and Vendor links",
         "Project and Vendor cells get an ⓘ link: Project to /projects/<id>?page=overview, Vendor to /vendors/<id>. "
         "The Vendor link is hidden on the Vendor page.")
users = vw.pick_users([ROLE])
USER = users[ROLE]
facts = vw.db_json("facts", FACTS_SQL, USER)
VENDOR, VENDOR_NAME, WOS = facts["vendor"], facts["vendor_name"], facts["wos"]


def wo_pdf() -> None:
    with session(vw.env, USER, PW) as (page, _):
        vw.open_vendor(page, "wo_pdf", ROLE, VENDOR, VENDOR_NAME)
        w.step(page, "wo_pdf", "after", ROLE, USER, f"{VENDOR_NAME}: open its Work Orders tab.",
               click=page.get_by_role("button", name="Work Orders", exact=True).last)
        settle(page, 2500)
        seen = {}
        for t in page.get_by_role("button").all_inner_texts():
            if m := re.fullmatch(r"(All|Approved|Finalized) WO\s*(\d+)", t.strip()):
                seen[m.group(1)] = int(m.group(2))
        want = {"All": len(WOS), "Approved": facts["approved"], "Finalized": facts["finalized"]}
        w.check("wo_pdf", ROLE, "sub-tab counts = DB: " + " / ".join(f"{k} {v}" for k, v in want.items()),
                " / ".join(f"{k} {v}" for k, v in seen.items()) or "no counts read", seen == want)
        rows = table_total(page) or 0
        w.check("wo_pdf", ROLE, f"All WO lists the vendor's {len(WOS)} approved WOs", f"{rows} rows", rows == len(WOS))

        # The table renders only the rows near the viewport, so count the rendered WO rows, not the footer's total.
        shown = page.locator("tbody tr").filter(has=page.locator("a[href*='/service-requests/']")).count()
        vendor_icons = page.locator("tbody a[aria-label='View Vendor']").count()
        project_icons = page.locator("tbody a[aria-label='View Project']").count()
        w.check("wo_links", ROLE, "on the vendor's page: a Project ⓘ on each row, no Vendor ⓘ",
                f"{project_icons} Project, {vendor_icons} Vendor links on {shown} rendered rows",
                shown > 0 and vendor_icons == 0 and project_icons == shown)

        first = page.locator("tbody tr").first
        first_wo = re.search(r"/service-requests/(SR-[\w-]+)", first.locator("a[href*='/service-requests/']").first
                             .get_attribute("href") or "").group(1)
        amount = next((x.strip() for x in first.locator("td").all_inner_texts() if x.strip().startswith("₹")), "")
        dl = page.get_by_role("button", name="Download PDF")
        with page.expect_download(timeout=180_000) as d:
            w.step(page, "wo_pdf", "after", ROLE, USER, f"All WO ({rows}). Download PDF sits beside Export.", click=dl,
                   pins=[pin(first.locator("a[aria-label='View Project']"),
                             "The Project ⓘ; the Vendor cell has none on the vendor's page.", "info")])
        name = d.value.suggested_filename
        pdf = vw.out / "files" / "vendor-work-orders.pdf"
        pdf.parent.mkdir(exist_ok=True)
        d.value.save_as(str(pdf))
        w.check("wo_pdf", ROLE, f"the file is named {VENDOR_NAME}_All_WO_<date>.pdf", name,
                name.startswith(f"{VENDOR_NAME}_All_WO_") and name.endswith(".pdf"), kind="nit")
        view, box, text, pages = show_pdf(page, pdf, "VENDOR WORK ORDERS")
        ids = sorted(set(re.findall(r"SR-\d{5}-\d{6}", text)))
        missing, extra = sorted(set(WOS) - set(ids)), sorted(set(ids) - set(WOS))
        w.check("wo_pdf", ROLE, f"the PDF lists exactly the vendor's {len(WOS)} approved WOs (DB)",
                f"{len(ids)} WOs on {pages} pages" + (f"; missing {missing[:5]}" if missing else "")
                + (f"; not the vendor's {extra[:5]}" if extra else ""), not missing and not extra)
        line = next((l for l in text.splitlines() if first_wo in l), "")
        value = re.search(r"\b([\d,]+\.\d{2})\b", line)
        w.check("wo_pdf", ROLE, f"WO {first_wo}'s Total WO Value rounds to the screen's {amount}",
                line.strip() or "row not found",
                bool(value) and bool(amount) and abs(num(value.group(1)) - num(amount)) <= 0.5)
        w.step(view, "wo_pdf", "after", ROLE, USER,
               f"Page 1 of the downloaded PDF \"{name}\" ({pages} pages), rendered as an image.",
               pins=[pin(box, "The print format's title names the sub-tab: ALL.", "info")] if box else [])
        view.close()


def wo_links() -> None:
    with session(vw.env, USER, PW) as (page, _):
        settle(page, 1000)
        w.step(page, "wo_links", "after", ROLE, USER, "Open Work Orders from the sidebar.",
               click=page.locator('[data-sidebar="menu-button"]').get_by_text("Work Orders", exact=True))
        settle(page, 1500)
        w.step(page, "wo_links", "after", ROLE, USER, "Open All WO.",
               click=page.get_by_role("button", name=re.compile(r"^All WO")).first)
        settle(page, 2500)
        row = page.locator("tbody tr").filter(has=page.locator("a[aria-label='View Project']")).first
        wo = re.search(r"/service-requests/(SR-[\w-]+)", row.locator("a[href*='/service-requests/']").first
                       .get_attribute("href") or "").group(1)
        db = vw.db_json("wo_links_row", WO_SQL, wo)
        proj, ven = row.locator("a[aria-label='View Project']"), row.locator("a[aria-label='View Vendor']")
        p_href, v_href = proj.get_attribute("href") or "", (ven.get_attribute("href") if ven.count() else "") or ""
        w.check("wo_links", ROLE, f"{wo}'s Project ⓘ goes to /projects/{db['project']}?page=overview (DB)", p_href,
                p_href.endswith(f"/projects/{db['project']}?page=overview"))
        w.check("wo_links", ROLE, f"{wo}'s Vendor ⓘ goes to /vendors/{db['vendor']} (DB)", v_href or "no Vendor ⓘ",
                v_href.endswith(f"/vendors/{db['vendor']}"))
        w.step(page, "wo_links", "after", ROLE, USER, f"Each Project and Vendor cell has an ⓘ link. Click {wo}'s "
                                                      "project ⓘ.", click=proj, pins=[pin(ven, "Vendor ⓘ", "info")])
        settle(page, 2500)
        w.check("wo_links", ROLE, "the click lands on that project's Overview", page.url.split("/", 3)[-1],
                f"/projects/{db['project']}" in page.url and "page=overview" in page.url)
        w.step(page, "wo_links", "after", ROLE, USER, "The ⓘ opened the project's Overview.")

        page.go_back()
        settle(page, 2500)
        ven = page.locator("tbody tr").filter(has=page.locator(f"a[href*='/service-requests/{wo}']")).first \
            .locator("a[aria-label='View Vendor']")
        w.step(page, "wo_links", "after", ROLE, USER, f"Back on All WO, click {wo}'s Vendor ⓘ.", click=ven)
        settle(page, 2500)
        w.check("wo_links", ROLE, "the click lands on that vendor's page", page.url.split("/", 3)[-1],
                f"/vendors/{db['vendor']}" in page.url)
        w.step(page, "wo_links", "after", ROLE, USER, "The ⓘ opened the vendor's page.")


vw.run([("wo_pdf", wo_pdf), ("wo_links", wo_links)])
vw.finish()
