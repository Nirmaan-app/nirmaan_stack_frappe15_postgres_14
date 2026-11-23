"""Walk Material Test Certificates on a PO page for each role (graduated from PR #1731's walk).

    python3 -I .claude/skills/verify/bin/walk_mtc.py <env> <out dir> [mtc_pm | mtc_roles ...]

A Project Manager uploads an MTC on a Billable PO of their project that has none yet (picked fresh each run, so a
rerun never reuses a PO an earlier run filled), gets Edit and no Delete on it, View only on another user's MTC, and
no Upload on a Non-Billable PO. PMO and Procurement Lead may upload, edit and delete; an Accountant only views.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from feature_walk import FeatureWalk, open_po, pin, settle  # noqa: E402

fw = FeatureWalk("Material Test Certificates by role", "material-test-certificates.md")
w = fw.w
w.change("mtc", "PO › Material Test Certificates for PM / PL",
         "Project Managers and Project Leads may upload (their assigned projects only), edit only their own MTCs and "
         "never delete. Accountant: no Upload; PMO: Edit and Delete. No Upload on a Non-Billable PO.")

facts = fw.db("facts", r'''
OPEN = "po.status NOT IN ('Merged', 'Cancelled', 'Inactive')"
BILLABLE_LINE = """EXISTS (SELECT 1 FROM "tabPurchase Order Item" i WHERE i.parent = po.name
                   AND i.billing_status = 'Billable' AND COALESCE(i.item_id, '') != '')"""


def first(sql, *args):
    r = frappe.db.sql(sql, args)
    return r[0][0] if r else None


options = []
for pm in candidates("Nirmaan Project Manager Profile"):
    projects = tuple(frappe.get_all("User Permission", filters={"user": pm, "allow": "Projects"}, pluck="for_value"))
    other = first(f"""SELECT po.name FROM "tabProcurement Orders" po WHERE po.project IN %s AND po.billing_status = 'Billable'
        AND {OPEN} AND EXISTS (SELECT 1 FROM "tabMaterial Test Certificate" m WHERE m.procurement_order = po.name AND m.owner != %s)
        ORDER BY po.creation DESC""", projects, pm)
    fresh = first(f"""SELECT po.name FROM "tabProcurement Orders" po WHERE po.project IN %s AND po.billing_status = 'Billable'
        AND po.status = 'Delivered' AND {BILLABLE_LINE}
        AND NOT EXISTS (SELECT 1 FROM "tabMaterial Test Certificate" m WHERE m.procurement_order = po.name)
        ORDER BY po.creation DESC""", projects)
    nonbill = first(f"""SELECT po.name FROM "tabProcurement Orders" po WHERE po.project IN %s
        AND po.billing_status = 'Non-Billable' AND {OPEN} ORDER BY po.creation DESC""", projects)
    if other and fresh and nonbill:
        pos = {k: {"po": v, "project_name": frappe.db.get_value("Projects", frappe.db.get_value("Procurement Orders", v, "project"),
                                                              "project_name")}
               for k, v in (("other", other), ("fresh", fresh), ("nonbill", nonbill))}
        options.append({"pm": pm, "pm_name": frappe.db.get_value("User", pm, "full_name"), **pos,
                        "other_project": frappe.db.get_value("Procurement Orders", other, "project")})
emit({"options": options,
      "pmos": candidates("Nirmaan PMO Executive Profile"),
      "accountants": candidates("Nirmaan Accountant Profile"),
      "leads_by_pm": {o["pm"]: candidates("Nirmaan Procurement Lead Profile", [o["other_project"]]) for o in options}})
''')
CERT = fw.out / "files" / "walk-certificate.pdf"


def make_certificate() -> None:
    from PIL import Image, ImageDraw

    CERT.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (850, 1100), "white")
    ImageDraw.Draw(img).text((60, 60), "TEST CERTIFICATE (feature walk fixture, not a real test certificate)", fill="black")
    img.save(CERT)


def mtc_actions(row) -> list[str]:
    return [a for a in row.locator("[aria-label]").evaluate_all("els => els.map(e => e.getAttribute('aria-label'))")
            if "certificate" in a]


def mtc_row(page, has: str | None = None):
    rows = page.locator("tr").filter(has=page.get_by_role("link", name="View certificate file"))
    return rows.filter(has_text=has).first if has else rows.first


def open_attachments(page) -> None:
    page.get_by_text("PO Attachments", exact=True).first.click()
    settle(page, 1500)


PM = None


def pm_option() -> dict:
    global PM
    if PM is None:
        email = fw.user("Project Manager", [o["pm"] for o in facts["options"]])
        PM = next(o for o in facts["options"] if o["pm"] == email)
    return PM


def mtc_pm() -> None:
    role, o = "Project Manager", pm_option()
    user = o["pm"]
    make_certificate()
    with fw.session(user) as page:
        open_po(page, o["other"]["po"], o["other"]["project_name"])
        w.step(page, "mtc", "after", role, user,
               f"Projects › {o['other']['project_name']} › PO Summary › {o['other']['po']}. Open PO Attachments.",
               click=page.get_by_text("PO Attachments", exact=True).first)
        settle(page, 1500)
        row = mtc_row(page)
        acts = mtc_actions(row)
        w.check("mtc", role, "on another user's MTC: View only", ", ".join(acts), acts == ["View certificate file"])
        w.step(page, "mtc", "after", role, user, "An MTC another user uploaded: the Project Manager can only View it.",
               pins=[pin(row.locator("td").last, "View only: no Edit, no Delete.", "info")])

        po = o["fresh"]["po"]
        open_po(page, po, o["fresh"]["project_name"])
        w.step(page, "mtc", "after", role, user, f"{po} has no MTC yet. Upload Test Certificate is offered.",
               click=page.get_by_role("button", name="Upload Test Certificate").first)
        settle(page, 800)
        dlg = page.get_by_role("dialog")
        dlg.locator("input[type=file]").set_input_files(str(CERT))
        dlg.get_by_role("button", name=re.compile("Certificate Date")).click()
        page.wait_for_timeout(600)
        page.get_by_role("grid").get_by_role("gridcell", name="1", exact=True).first.click()
        page.wait_for_timeout(500)
        dlg.get_by_role("checkbox", name="Select all items").check()
        w.step(page, "mtc", "after", role, user, "Pick a file, a date and the items, then Upload.",
               click=dlg.get_by_role("button", name="Upload"))
        settle(page, 3000)
        open_attachments(page)
        mine = mtc_row(page, o["pm_name"])
        acts = mtc_actions(mine)
        w.check("mtc", role, "on their own MTC: Edit, never Delete", ", ".join(acts),
                "Edit certificate" in acts and "Delete certificate" not in acts)
        saved = fw.db("mtc_upload", 'emit(frappe.get_all("Material Test Certificate", filters={"procurement_order": '
                      'sys.argv[1]}, fields=["name", "owner", "project"]))', po)
        w.check("mtc", role, "DB: the PO's new MTC is owned by the Project Manager", str(saved),
                any(r["owner"] == user for r in saved))
        w.step(page, "mtc", "after", role, user, "Uploaded. On their own MTC the Project Manager gets Edit, and no Delete.",
               pins=[pin(mine.locator("td").last, "Edit, no Delete.", "info")])

        po = o["nonbill"]["po"]
        open_po(page, po, o["nonbill"]["project_name"])
        n = page.get_by_role("button", name="Upload Test Certificate").count()
        badge = page.get_by_text("Non-Billable", exact=True).count()
        w.check("mtc", role, "no Upload on a Non-Billable PO", f"{n} Upload buttons; Non-Billable shown: {badge > 0}",
                n == 0 and badge > 0)
        w.step(page, "mtc", "after", role, user, f"{po} is Non-Billable: no Upload Test Certificate.",
               pins=[pin(page.get_by_text("Non-Billable", exact=True).first, "Non-Billable", "info")])


def mtc_roles() -> None:
    o = pm_option()
    pools = {"PMO": facts["pmos"], "Procurement Lead": facts["leads_by_pm"][o["pm"]], "Accountant": facts["accountants"]}
    manages = {"PMO": True, "Procurement Lead": True, "Accountant": False}
    for role, pool in pools.items():
        user = fw.user(role, pool)
        with fw.session(user) as page:
            open_po(page, o["other"]["po"], o["other"]["project_name"])
            up = page.get_by_role("button", name="Upload Test Certificate").count()
            open_attachments(page)
            row = mtc_row(page)
            acts = mtc_actions(row)
            manage = "Edit certificate" in acts and "Delete certificate" in acts
            w.check("mtc", role, "Upload, Edit and Delete" if manages[role] else "no Upload; View only",
                    f"{up} Upload buttons; {', '.join(acts)}",
                    (up > 0 and manage) if manages[role] else (up == 0 and acts == ["View certificate file"]))
            w.step(page, "mtc", "after", role, user,
                   f"As {role} on {o['other']['po']}: {'Upload, Edit and Delete' if manage else 'View only, no Upload'}.",
                   pins=[pin(row.locator("td").last, ", ".join(acts), "info")])


if not facts["options"]:
    w.status("mtc", "not_walked", "no Project Manager on this env has, in their projects, a Billable PO with another "
                                  "user's MTC, a Delivered Billable PO with none, and a Non-Billable PO")
else:
    fw.run([("mtc", mtc_pm), ("mtc", mtc_roles)])
fw.finish()
