"""Walk PR #1731 (ITMs in Material Usage, vendor Work Orders PDF and links, MTC for PM / PL, Revised PO Date, MSME on
vendors) on its env and its base env.

    python3 -I walk_pr_1731.py <out dir> [function ...]   # from the checkout root, with pr-1731 and pr-1731-base served

Expected numbers are read from the env DB at the start (db_facts.txt in the out dir), so a rerun compares the screen
with the data it is walking, not with numbers copied from an earlier run.
"""

from __future__ import annotations

import base64
import json
import re
import subprocess
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
from drive import session, sidebar  # noqa: E402
from record import Walk, pin  # noqa: E402

AFTER, BEFORE = "pr-1731", "pr-1731-base"
PW = "WalkPw-1731"
DEVENV = "scripts/devenv/devenv.sh"
USERS = {
    "Admin": "admins@nirmaan.app",
    "Project Manager": "abdul.hannan@nirmaan.app",
    "PMO": "deven@nirmaan.app",
    "Accountant": "swathi@nirmaan.app",
    "Procurement Lead": "sowmya@nirmaan.app",
}
PROJECT = "THRISSUR-PROJ-00105"
ITEM_ID, ITEM = "ITEM-000732", "Ducting Insulation Adhesive / Gum"
ITM_PROJECT, ITM_WAREHOUSE = "ITM-2026-00017", "ITM-2026-00019"
WO_VENDOR = "VEN-Service-0103"
MTC_PROJECT_PO = "PO/125/00187/26-27"
MTC_NEW_CANDIDATES = ["PO/191/00187/26-27", "PO/178/00187/26-27", "PO/171/00187/26-27", "PO/166/00187/26-27"]
MTC_NONBILLABLE_PO = "PO/013/00187/26-27"
REV_PO = "PO/010/00286/26-27"
MSME_VENDORS = ["VEN-Material-0296", "VEN-Material-0295", "VEN-Material-0294", "VEN-Material-0293"]

out = Path(sys.argv[1])
w = Walk(out, pr={"number": 1731, "title": "Feat/vendor wo",
                  "url": "https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/pull/1731",
                  "author": "madhubalan17js", "head": "3d2a323c4", "base": "42313959a"},
         envs={"after": AFTER, "before": BEFORE},
         data_note="a test copy of the production backup of 2026-11-17")
CERT = out / "files" / "walk-certificate.pdf"
CERT.parent.mkdir(parents=True, exist_ok=True)
w.change("mu_ordered", "Material Usage › Ordered Qty counts ITMs",
         "Ordered Qty = PO qty + ITM qty, counting an ITM from status Approved onward. Hovering shows the split: "
         "PO Ordered Quantity / Internal Transfer Memo Qty.")
w.change("mu_numbers", "Material Usage › PO / ITM Number(s)",
         "ITM ids are listed with the POs (\"2 POs · 1 ITM\"). An ITM's paid badge reads Fully Paid once Delivered, "
         "Unpaid before that.")
w.change("mu_docs", "Material Usage › DCs / MIRs include ITM documents",
         "The DC and MIR popovers list documents filed against an ITM, each with an ITM tag and a link to the ITM.")
w.change("mu_powise", "Material Usage › PO/ITM Wise tab",
         "ITMs get their own rows, and a new Type column (PO / ITM filter) is the second column. ITM rows show "
         "\"From <source project>\" and \"-\" for Rate.")
w.change("wo_pdf", "Vendor › Work Orders › Download PDF",
         "The vendor's Work Orders tab gets Download PDF: the \"Vendor Work Orders\" print format of what the table "
         "shows (All / Approved / Finalized).")
w.change("wo_links", "Work Order lists › Project and Vendor links",
         "Project and Vendor cells get an ⓘ link: Project to /projects/<id>?page=overview, Vendor to /vendors/<id>. "
         "The Vendor link is hidden on the Vendor page.")
w.change("mtc", "PO › Material Test Certificates for PM / PL",
         "Project Managers and Project Leads may upload (their assigned projects only), edit only their own MTCs and "
         "never delete. Accountant: no Upload; PMO: Edit and Delete. No Upload on a Non-Billable PO.")
w.change("po_date", "PO preview and PDFs › Revised PO Date",
         "A PO with an Approved PO Revision shows \"Revised PO Date\" = the latest approval date in its preview and "
         "both PO PDFs; a never-revised PO still shows \"PO Date\".")
w.change("msme", "Vendors › MSME ID and certificate",
         "New / Edit Vendor get MSME Details: an Udyam certificate upload and an MSME ID. ID and certificate go "
         "together or not at all. Vendor Overview shows the MSME ID, which opens the certificate.")
w.change("msme_read", "Vendors › Document AI reads the MSME certificate",
         "Uploading the certificate sends it to Gemini, which reads it and fills the MSME ID.")


def base_of(page) -> str:
    return re.match(r"(https?://[^/]+)", page.url).group(1)


def settle(page, ms: int = 1500) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(ms)


def po_url(page, po: str) -> str:
    return f"{base_of(page)}/purchase-orders/{po.replace('/', '&=')}"


def db(task: str, name: str, code: str, *args: str) -> str:
    """Run a Python snippet on the env DB (devenv script) and keep it and its output beside the screenshots."""
    src = out / "db" / f"{name}.py"
    src.parent.mkdir(exist_ok=True)
    src.write_text("import json, sys\nimport frappe\n" + code)
    res = subprocess.run([DEVENV, "script", task, str(src), *args], capture_output=True, text=True, timeout=300)
    (out / "db" / f"{name}.txt").write_text(res.stdout + res.stderr)
    return res.stdout


def db_json(task: str, name: str, code: str, *args: str) -> dict:
    line = next(l for l in db(task, name, code, *args).splitlines() if l.startswith("JSON "))
    return json.loads(line[5:])


FACTS_SQL = r'''
a = json.loads(sys.argv[1])
P, ITEM_ID, ITM_P, REV_PO = a["project"], a["item_id"], a["itm"], a["rev_po"]
VEN = next(v for v in a["vendors"] if not frappe.db.get_value("Vendors", v, "msme_id"))
PLAIN_PO = next(po for po in a["pos"] if not frappe.db.count("PO Revisions", {"revised_po": po, "status": "Approved"}))
MTC_PO = next((po for po in a["pos"] if not frappe.db.count("Material Test Certificate", {"procurement_order": po})), None)
ok = ("Approved", "Dispatched", "Partially Delivered", "Delivered")
itm_item = frappe.db.sql("""SELECT itm.name, itm.status, i.transfer_quantity q FROM "tabInternal Transfer Memo Item" i
    JOIN "tabInternal Transfer Memo" itm ON itm.name = i.parent
    WHERE itm.target_project = %s AND i.item_id = %s AND itm.status IN %s""", (P, ITEM_ID, ok), as_dict=1)
itm_p = frappe.db.sql("""SELECT SUM(i.transfer_quantity) q, MAX(src.project_name) src FROM "tabInternal Transfer Memo Item" i
    JOIN "tabInternal Transfer Memo" itm ON itm.name = i.parent LEFT JOIN "tabProjects" src ON src.name = itm.source_project
    WHERE itm.name = %s""", ITM_P, as_dict=1)[0]
rev = frappe.db.sql("""SELECT MAX(approval_date) d, COUNT(*) n FROM "tabPO Revisions" WHERE revised_po = %s AND status = 'Approved'""", REV_PO, as_dict=1)[0]
plain = frappe.db.count("PO Revisions", {"revised_po": PLAIN_PO, "status": "Approved"})
print("JSON " + json.dumps({
    "itm_item": [dict(r) for r in itm_item],
    "itm_item_qty": float(sum(r.q for r in itm_item)),
    "itm_count": frappe.db.count("Internal Transfer Memo", {"target_project": P, "status": ["in", ok]}),
    "itm_p_qty": float(itm_p.q), "itm_p_src": itm_p.src,
    "rev_date": rev.d.strftime("%d-%b-%Y") if rev.d else None, "rev_n": rev.n,
    "rev_created": frappe.db.get_value("Procurement Orders", REV_PO, "creation").strftime("%d-%b-%Y"),
    "plain_po": PLAIN_PO, "plain_po_revisions": plain, "mtc_po": MTC_PO,
    "msme_vendor": frappe.db.get_value("Vendors", VEN, ["name", "vendor_name", "msme_id", "msme_attachment"], as_dict=1),
}, default=str))
'''

facts = db_json(AFTER, "facts", FACTS_SQL, json.dumps({"project": PROJECT, "item_id": ITEM_ID, "itm": ITM_PROJECT,
                                                       "rev_po": REV_PO, "pos": MTC_NEW_CANDIDATES,
                                                       "vendors": MSME_VENDORS}))
MSME_VENDOR = facts["msme_vendor"]["name"]
MSME_ID = f"UDYAM-KR-03-{int(MSME_VENDOR.rsplit('-', 1)[-1]):07d}"


def make_certificate() -> None:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (850, 1100), "white")
    ImageDraw.Draw(img).text((60, 60), "TEST CERTIFICATE (PR walk fixture, not a real Udyam certificate)", fill="black")
    img.save(CERT)


make_certificate()
seen_before: dict = {}


def guarded(cid: str, fn, tries: int = 2) -> None:
    for attempt in range(1, tries + 1):
        steps, checks = len(w.data["steps"]), len(w.data["checks"])
        try:
            fn()
            return
        except Exception as e:
            traceback.print_exc()
            del w.data["steps"][steps:], w.data["checks"][checks:]
            if attempt == tries:
                w.status(cid, "failed", f"walk stopped: {type(e).__name__}: {str(e).splitlines()[0][:160]}")


def num(s: str) -> float:
    return float(s.replace(",", "").replace("₹", "").strip())


def popper(page):
    return page.locator("[data-radix-popper-content-wrapper]").first


def show_pdf(page, pdf: Path, find: str | None = None):
    """Open page 1 of a downloaded PDF as an image in a new tab of the same browser; box `find` on it if given."""
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(str(pdf))
    first, scale = doc[0], 1.5
    img = pdf.with_suffix(".p1.jpg")
    first.render(scale=scale).to_pil().convert("RGB").save(img, quality=80)
    box = None
    if find:
        tp = first.get_textpage()
        hit = tp.search(find).get_next()
        if hit:
            boxes = [tp.get_charbox(i) for i in range(hit[0], hit[0] + hit[1])]
            l, b, r, t = min(x[0] for x in boxes), min(x[1] for x in boxes), max(x[2] for x in boxes), max(x[3] for x in boxes)
            h = first.get_height()
            box = {"x": round(l * scale) - 4, "y": round((h - t) * scale) - 4,
                   "w": round((r - l) * scale) + 8, "h": round((t - b) * scale) + 8}
    text = "\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc)))
    view = page.context.new_page()
    view.set_viewport_size(page.viewport_size)
    data = base64.b64encode(img.read_bytes()).decode()
    view.set_content(f'<body style="margin:0;background:#e5e7eb"><img style="display:block" '
                     f'src="data:image/jpeg;base64,{data}"></body>')
    return view, box, text, len(doc)


def item_row(page):
    page.get_by_placeholder(re.compile("Search", re.I)).first.fill(ITEM.split(" /")[0])
    page.wait_for_timeout(2000)
    return page.locator("tbody tr").filter(has_text=ITEM).first


def open_material_usage(page, role: str, user: str, side: str, caption: str) -> None:
    page.goto(f"{base_of(page)}/projects/{PROJECT}?page=overview")
    settle(page, 2500)
    w.step(page, "mu_ordered", side, role, user, caption,
           click=page.get_by_role("button", name="Material Usage", exact=True))
    settle(page, 2500)


def mu_before() -> None:
    role, user = "Admin", USERS["Admin"]
    with session(BEFORE, user, PW) as (page, _):
        open_material_usage(page, role, user, "before", "Before this PR: open Qburst's Material Usage tab.")
        row = item_row(page)
        cells = [c.strip() for c in row.locator("td").all_inner_texts()]
        seen_before.update(ordered=num(cells[4]), delivered=num(cells[5]), dcs=int(cells[13]), label=cells[12])
        hdr = page.get_by_role("columnheader", name=re.compile(r"^PO Number"))
        w.step(page, "mu_ordered", "before", role, user,
               f"Before: {ITEM} shows Ordered {cells[4]} but Delivery Note Qty {cells[5]}. The incoming ITM is not "
               f"counted as ordered.",
               pins=[pin(row.locator("td").nth(4), f"Ordered {cells[4]} is less than the {cells[5]} delivered: "
                                                     "the ITM's quantity arrived but was never ordered here.", "info")])
        w.step(page, "mu_numbers", "before", role, user,
               f"Before: the column is \"PO Number(s)\" and lists only POs (\"{cells[12]}\"); DCs shows {cells[13]}.",
               pins=[pin(hdr, "PO Number(s): POs only.", "info")])
        tab = page.get_by_role("tab", name="PO Wise").or_(page.get_by_role("button", name="PO Wise", exact=True)).first
        w.step(page, "mu_powise", "before", role, user, "Before: the second view is called PO Wise.", click=tab)
        page.get_by_placeholder(re.compile("Search", re.I)).first.fill("")
        settle(page, 2000)
        heads = [h.strip() for h in page.get_by_role("columnheader").all_inner_texts()]
        seen_before.update(powise_heads=heads)
        w.step(page, "mu_powise", "before", role, user, "Before: PO Wise lists only POs, and has no Type column.")


def mu_after() -> None:
    role, user = "Admin", USERS["Admin"]
    with session(AFTER, user, PW) as (page, _):
        open_material_usage(page, role, user, "after", "Open Qburst's Material Usage tab.")
        row = item_row(page)
        cells = [c.strip() for c in row.locator("td").all_inner_texts()]
        ordered = num(cells[4])
        row.locator("td").nth(4).locator("span.underline").first.hover()
        page.wait_for_timeout(800)
        tip = popper(page).inner_text()
        m = re.search(r"PO Ordered Quantity\s*([\d.,]+)\s*Internal Transfer Memo Qty\s*([\d.,]+)", tip)
        po_q, itm_q = (num(m.group(1)), num(m.group(2))) if m else (None, None)
        w.check("mu_ordered", role, f"ITM part = DB ITM qty {facts['itm_item_qty']:g} (ITM status Approved or later)",
                f"tooltip ITM {itm_q}", itm_q is not None and abs(itm_q - facts["itm_item_qty"]) < 0.01)
        if "ordered" in seen_before:
            w.check("mu_ordered", role, f"PO part = the Ordered Qty before this PR ({seen_before['ordered']:g})",
                    f"tooltip PO {po_q}", po_q is not None and abs(po_q - seen_before["ordered"]) < 0.01)
        w.check("mu_ordered", role, "Ordered Qty = PO part + ITM part", f"{po_q} + {itm_q} vs {ordered}",
                po_q is not None and abs(po_q + itm_q - ordered) < 0.01)
        w.step(page, "mu_ordered", "after", role, user,
               f"Ordered Qty is now {cells[4]} and underlined. Hovering splits it: PO {m.group(1) if m else '?'} + "
               f"ITM {m.group(2) if m else '?'}.",
               pins=[pin(popper(page), "The hover split the PR describes.", "info")])
        page.mouse.move(5, 5)
        page.wait_for_timeout(500)

        trig = row.get_by_role("button", name=re.compile(r"POs? · \d+ ITMs?"))
        label = trig.inner_text().strip() if trig.count() else cells[12]
        w.check("mu_numbers", role, "PO / ITM Number(s) counts both (\"n POs · m ITM\")", label,
                bool(re.fullmatch(r"\d+ POs? · \d+ ITMs?", label)))
        trig.first.hover()
        page.wait_for_timeout(800)
        tip = popper(page).inner_text()
        statuses = {s["name"]: s["status"] for s in facts["itm_item"]}
        badge_ok, seen = True, []
        for name, st in statuses.items():
            mm = re.search(re.escape(name) + r".*?·\s*([A-Za-z ]+?)\s*\n\s*(Fully Paid|Unpaid|Partially Paid)", tip, re.S)
            want = "Fully Paid" if st == "Delivered" else "Unpaid"
            seen.append(f"{name} {st}: {mm.group(2) if mm else 'not listed'}")
            badge_ok &= bool(mm) and mm.group(2) == want
        w.check("mu_numbers", role, "ITM badge: Fully Paid once Delivered, Unpaid before", "; ".join(seen), badge_ok)
        w.step(page, "mu_numbers", "after", role, user,
               f"The column is now \"PO / ITM Number(s)\": \"{label}\". Hovering lists each PO and the ITM with its "
               "source project and paid badge.",
               pins=[pin(popper(page).get_by_text(re.compile(r"^ITM-")).first.locator("../.."),
                         "The ITM is still Partially Delivered, so it reads Unpaid. An ITM has no payments: "
                         "\"Unpaid\" here means \"not fully received\", which a reader could misread.", "info")])
        page.keyboard.press("Escape")
        page.mouse.move(5, 5)
        popper(page).wait_for(state="detached", timeout=5000)

        dcs = row.locator("td").nth(13).get_by_role("button")
        n_dcs = int(dcs.inner_text().strip())
        w.step(page, "mu_docs", "after", role, user, f"DCs shows {n_dcs}. Open it.", click=dcs)
        settle(page, 800)
        dlg = page.get_by_role("dialog")
        itm_doc = dlg.locator("tr").filter(has_text=ITM_PROJECT).first
        has_tag = itm_doc.count() > 0 and "ITM" in itm_doc.inner_text()
        w.check("mu_docs", role, f"the ITM's DC is listed, tagged ITM, linking to {ITM_PROJECT}",
                "listed with tag and link" if has_tag and itm_doc.get_by_role("link", name=ITM_PROJECT).count()
                else "not listed", has_tag and itm_doc.get_by_role("link", name=ITM_PROJECT).count() > 0)
        if "dcs" in seen_before:
            w.check("mu_docs", role, f"DC count = before ({seen_before['dcs']}) + the ITM's DC",
                    str(n_dcs), n_dcs == seen_before["dcs"] + 1)
        w.step(page, "mu_docs", "after", role, user,
               "The challan filed against the ITM is in the list, tagged ITM, with a link to the ITM.",
               pins=[pin(itm_doc, "ITM tag and link", "info")])
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)

        page.get_by_placeholder(re.compile("Search", re.I)).first.fill("")
        tab = page.get_by_role("tab", name="PO/ITM Wise").or_(page.get_by_role("button", name="PO/ITM Wise", exact=True)).first
        w.step(page, "mu_powise", "after", role, user, "The second view is now PO/ITM Wise. Open it.", click=tab)
        settle(page, 2500)
        heads = [h.strip() for h in page.get_by_role("columnheader").all_inner_texts()]
        named = [h for h in heads if h]
        w.check("mu_powise", role, "Type is the column after PO / ITM Number", " | ".join(named[:4]),
                len(named) > 1 and named[0] == "PO / ITM Number" and named[1] == "Type")
        type_hdr = page.get_by_role("columnheader", name=re.compile(r"^Type"))
        w.step(page, "mu_powise", "after", role, user, "Open the Type filter.", click=type_hdr.locator("svg").first)
        settle(page, 600)
        w.step(page, "mu_powise", "after", role, user, "Filter to ITM.", click=page.get_by_role("option", name="ITM"))
        page.keyboard.press("Escape")
        settle(page, 1500)
        types = [r.split("\t") for r in page.locator("tbody tr").all_inner_texts()]
        itm_rows = [r for r in types if len(r) > 2 and r[2].strip() == "ITM"]
        w.check("mu_powise", role, f"ITM filter shows every incoming ITM (DB: {facts['itm_count']})",
                f"{len(itm_rows)} ITM rows of {len(types)}", len(itm_rows) == len(types) == facts["itm_count"])
        w.step(page, "mu_powise", "after", role, user, f"Type = ITM: {len(itm_rows)} rows, one per incoming ITM.")

        page.get_by_placeholder(re.compile("Search", re.I)).first.fill(ITM_PROJECT)
        settle(page, 1500)
        r = page.locator("tbody tr").filter(has_text=ITM_PROJECT).first
        c = [x.strip() for x in r.locator("td").all_inner_texts()]
        w.check("mu_powise", role, f"ITM row shows \"From {facts['itm_p_src']}\" and \"-\" for Rate",
                f"Vendor \"{c[3]}\", Rate \"{c[10]}\"", c[3] == f"From {facts['itm_p_src']}" and c[10] == "-")
        w.check("mu_powise", role, f"ITM Ordered Qty = DB transfer qty {facts['itm_p_qty']:.2f}", c[6],
                abs(num(c[6]) - facts["itm_p_qty"]) < 0.01, kind="nit")
        dc_q, ord_q = num(c[8]), num(c[6])
        w.step(page, "mu_powise", "after", role, user,
               f"{ITM_PROJECT}: Type ITM, \"{c[3]}\", Rate \"-\".",
               pins=[pin(r.locator("td").nth(8), f"DC Qty {c[8]} is {dc_q / ord_q:.1f}× the {c[6]} ordered. The DB "
                                                  "has one challan line of 1116.8 NOS of GI Sheet - 24G against 11 "
                                                  "NOS on the ITM: a keying error in the data, which this view now "
                                                  "brings to light. Not caused by the PR.", "info")]
               if dc_q > ord_q * 1.5 else [])

        page.get_by_placeholder(re.compile("Search", re.I)).first.fill(ITM_WAREHOUSE)
        settle(page, 1500)
        r = page.locator("tbody tr").filter(has_text=ITM_WAREHOUSE).first
        c = [x.strip() for x in r.locator("td").all_inner_texts()]
        w.step(page, "mu_powise", "after", role, user,
               f"{ITM_WAREHOUSE} comes from the warehouse, not a project.",
               pins=[pin(r.locator("td").nth(3), f"The source shows \"{c[3]}\". The PR only describes \"From <source "
                                                  "project>\"; for a warehouse ITM, \"From Warehouse\" would tell the "
                                                  "reader where it came from.", "nit")] if c[3] in ("-", "", "From")
               else [])


def mu_roles() -> None:
    role, user = "Procurement Lead", USERS["Procurement Lead"]
    with session(AFTER, user, PW) as (page, _):
        page.goto(f"{base_of(page)}/projects/{PROJECT}?page=projectmaterialusage")
        settle(page, 2500)
        row = item_row(page)
        cells = [c.strip() for c in row.locator("td").all_inner_texts()]
        want = seen_before.get("ordered", 0) + facts["itm_item_qty"]
        w.check("mu_ordered", role, f"the same Ordered Qty as Admin ({want:g})", cells[4], abs(num(cells[4]) - want) < 0.01)
        w.check("mu_numbers", role, "the same PO / ITM label", cells[12], bool(re.fullmatch(r"\d+ POs? · \d+ ITMs?", cells[12])))
        w.step(page, "mu_ordered", "after", role, user, f"As Procurement Lead: Ordered {cells[4]}, \"{cells[12]}\".")


def wo_pdf() -> None:
    role, user = "Admin", USERS["Admin"]
    with session(AFTER, user, PW) as (page, _):
        page.goto(f"{base_of(page)}/vendors/{WO_VENDOR}?tab=overview")
        settle(page, 2500)
        w.step(page, "wo_pdf", "after", role, user, "Open the vendor, then its Work Orders tab.",
               click=page.get_by_role("button", name="Work Orders", exact=True).last)
        settle(page, 2500)
        count = next(int(m.group(1)) for t in page.get_by_role("button").all_inner_texts()
                     for m in [re.match(r"^All WO\s*(\d+)$", t.strip())] if m)
        icons = page.locator("tbody a[aria-label='View Vendor']").count()
        w.check("wo_links", role, "no Vendor ⓘ on the Vendor page", f"{icons} Vendor links", icons == 0)
        first = [x.strip() for x in page.locator("tbody tr").first.locator("td").all_inner_texts()]
        dl = page.get_by_role("button", name="Download PDF")
        with page.expect_download(timeout=180_000) as d:
            w.step(page, "wo_pdf", "after", role, user, f"All WO ({count}). Download PDF sits beside Export.", click=dl,
                   pins=[pin(page.locator("tbody tr").first.locator("td").nth(2),
                             "Project cells carry the ⓘ link; the Vendor cell has none on the vendor page.", "info")])
        pdf = out / "files" / "vendor-work-orders.pdf"
        pdf.parent.mkdir(exist_ok=True)
        d.value.save_as(str(pdf))
        view, box, text, pages = show_pdf(page, pdf, "VENDOR WORK ORDERS")
        ids = re.findall(r"SR-\d{5}-\d{6}", text)
        w.check("wo_pdf", role, f"the PDF lists every WO the tab counts ({count})", f"{len(ids)} WOs on {pages} pages",
                len(set(ids)) == count)
        wo = first[0].split()[0] if first else ""
        line = next((l for l in text.splitlines() if wo and l.split(" ")[1:2] and l.split(" ")[1].endswith(wo)), "")
        amount = next((x for x in first if x.startswith("₹")), "")
        w.check("wo_pdf", role, f"row 1 matches the screen (WO {wo}, {amount})", line.strip() or "row not found",
                bool(line) and f"{num(amount):,.2f}" in line)
        w.step(view, "wo_pdf", "after", role, user,
               f"Page 1 of the downloaded PDF \"{d.value.suggested_filename}\" ({pages} pages), rendered as an image.",
               pins=[pin(box, "The print format's title names the sub-tab: ALL.", "info")] if box else [])
        view.close()


def wo_before() -> None:
    role, user = "Admin", USERS["Admin"]
    with session(BEFORE, user, PW) as (page, _):
        page.goto(f"{base_of(page)}/vendors/{WO_VENDOR}?tab=overview")
        settle(page, 2500)
        page.get_by_role("button", name="Work Orders", exact=True).last.click()
        settle(page, 2500)
        has = page.get_by_role("button", name="Download PDF").count()
        w.check("wo_pdf", role, "before this PR: no Download PDF", "present" if has else "absent", not has, kind="info")
        w.step(page, "wo_pdf", "before", role, user, "Before this PR: the vendor's Work Orders tab has Export only.",
               pins=[pin(page.get_by_role("button", name="Export"), "Export only, no PDF.", "info")])
        sidebar(page, "Work Orders")
        settle(page, 1500)
        page.get_by_role("button", name=re.compile(r"^All WO")).first.click()
        settle(page, 2500)
        w.step(page, "wo_links", "before", role, user, "Before: Work Orders › All WO. Project and Vendor are plain text.",
               pins=[pin(page.locator("tbody tr").first.locator("td").nth(2), "No link to the project.", "info")])


def wo_links() -> None:
    role, user = "Admin", USERS["Admin"]
    with session(AFTER, user, PW) as (page, _):
        sidebar(page, "Work Orders")
        settle(page, 1500)
        w.step(page, "wo_links", "after", role, user, "Work Orders from the sidebar. Open All WO.",
               click=page.get_by_role("button", name=re.compile(r"^All WO")).first)
        settle(page, 2500)
        proj = page.locator("tbody a[aria-label='View Project']").first
        ven = page.locator("tbody a[aria-label='View Vendor']").first
        href = proj.get_attribute("href") or ""
        w.check("wo_links", role, "Project ⓘ goes to /projects/<id>?page=overview", href,
                bool(re.search(r"/projects/[^/?]+\?page=overview$", href)))
        w.check("wo_links", role, "Vendor ⓘ goes to /vendors/<id>", ven.get_attribute("href") or "",
                bool(re.search(r"/vendors/VEN-[\w-]+$", ven.get_attribute("href") or "")))
        w.step(page, "wo_links", "after", role, user, "Each Project and Vendor cell has an ⓘ link. Click a project's.",
               click=proj, pins=[pin(ven, "Vendor ⓘ", "info")])
        settle(page, 2500)
        w.check("wo_links", role, "the click lands on the project's overview", page.url.split("/", 3)[-1],
                "page=overview" in page.url and "/projects/" in page.url)
        w.step(page, "wo_links", "after", role, user, "The ⓘ opened the project's Overview.")


def open_attachments(page) -> None:
    page.get_by_text("PO Attachments", exact=True).first.click()
    settle(page, 1500)


def mtc_actions(row) -> list[str]:
    return [a for a in row.locator("[aria-label]").evaluate_all("els => els.map(e => e.getAttribute('aria-label'))")
            if "certificate" in a]


def mtc_row(page, has: str | None = None):
    rows = page.locator("tr").filter(has=page.get_by_role("link", name="View certificate file"))
    return rows.filter(has_text=has).first if has else rows.first


def mtc_pm() -> None:
    role, user = "Project Manager", USERS["Project Manager"]
    with session(AFTER, user, PW) as (page, _):
        page.goto(po_url(page, MTC_PROJECT_PO))
        settle(page, 2500)
        w.step(page, "mtc", "after", role, user,
               f"As Project Manager, on {MTC_PROJECT_PO} (Telus GIFT City, one of their 2 projects). Open PO Attachments.",
               click=page.get_by_text("PO Attachments", exact=True).first)
        settle(page, 1500)
        row = mtc_row(page)
        acts = mtc_actions(row)
        owner = row.locator("td").nth(4).inner_text().strip()
        w.check("mtc", role, "on another user's MTC: View only", ", ".join(acts),
                acts == ["View certificate file"])
        w.step(page, "mtc", "after", role, user, f"An MTC uploaded by {owner}: the Project Manager can only View it.",
               pins=[pin(row.locator("td").last, "View only: no Edit, no Delete.", "info")])

        po = facts["mtc_po"]
        page.goto(po_url(page, po))
        settle(page, 2500)
        up = page.get_by_role("button", name="Upload Test Certificate").first
        w.step(page, "mtc", "after", role, user, f"{po} has no MTC yet. Upload Test Certificate is offered.", click=up)
        settle(page, 800)
        dlg = page.get_by_role("dialog")
        dlg.locator("input[type=file]").set_input_files(str(CERT))
        dlg.get_by_role("button", name=re.compile("Certificate Date")).click()
        page.wait_for_timeout(600)
        page.get_by_role("grid").get_by_role("gridcell", name="10", exact=True).first.click()
        page.wait_for_timeout(500)
        dlg.get_by_role("checkbox", name="Select all items").check()
        w.step(page, "mtc", "after", role, user, "Pick a file, a date and the items, then Upload.",
               click=dlg.get_by_role("button", name="Upload"))
        settle(page, 3000)
        open_attachments(page)
        mine = mtc_row(page, "Abdul Hannan")
        acts = mtc_actions(mine)
        w.check("mtc", role, "on their own MTC: Edit, never Delete", ", ".join(acts),
                "Edit certificate" in acts and "Delete certificate" not in acts)
        dbrow = db_json(AFTER, "mtc_upload", 'print("JSON " + json.dumps(frappe.get_all("Material Test Certificate", '
                        'filters={"procurement_order": sys.argv[1]}, fields=["name", "owner", "project"]), default=str))',
                        po)
        w.check("mtc", role, "DB: the new MTC is owned by the Project Manager", json.dumps(dbrow),
                any(r["owner"] == user for r in dbrow))
        w.step(page, "mtc", "after", role, user, "Uploaded. On their own MTC the Project Manager gets Edit, and no Delete.",
               pins=[pin(mine.locator("td").last, "Edit (pencil), no Delete.", "info")])

        page.goto(po_url(page, MTC_NONBILLABLE_PO))
        settle(page, 2500)
        n = page.get_by_role("button", name="Upload Test Certificate").count()
        w.check("mtc", role, "no Upload on a Non-Billable PO", f"{n} Upload buttons", n == 0)
        w.step(page, "mtc", "after", role, user, f"{MTC_NONBILLABLE_PO} is Non-Billable: no Upload Test Certificate.",
               pins=[pin(page.get_by_text("Non-Billable", exact=True).first, "Non-Billable", "info")])


def mtc_roles() -> None:
    want = {"PMO": True, "Procurement Lead": True, "Accountant": False}
    for role in ("PMO", "Accountant", "Procurement Lead"):
        user = USERS[role]
        with session(AFTER, user, PW) as (page, _):
            page.goto(po_url(page, MTC_PROJECT_PO))
            settle(page, 2500)
            up = page.get_by_role("button", name="Upload Test Certificate").count()
            open_attachments(page)
            row = mtc_row(page)
            acts = mtc_actions(row)
            manage = "Edit certificate" in acts and "Delete certificate" in acts
            w.check("mtc", role, "Upload, Edit and Delete" if want[role] else "no Upload; View only",
                    f"{up} Upload buttons; {', '.join(acts)}",
                    (up > 0 and manage) if want[role] else (up == 0 and acts == ["View certificate file"]))
            w.step(page, "mtc", "after", role, user,
                   f"As {role}: {'Upload, Edit and Delete' if manage else 'View only, no Upload'}.",
                   pins=[pin(row.locator("td").last, ", ".join(a.replace(' certificate file', '').replace(' certificate', '')
                                                                for a in acts), "info")])


def mtc_before() -> None:
    role, user = "Project Manager", USERS["Project Manager"]
    with session(BEFORE, user, PW) as (page, _):
        page.goto(po_url(page, facts["mtc_po"]))
        settle(page, 2500)
        n = page.get_by_role("button", name="Upload Test Certificate").count()
        w.check("mtc", role, "before this PR: no Upload for a Project Manager", f"{n} Upload buttons", n == 0, kind="info")
        w.step(page, "mtc", "before", role, user, f"Before this PR: the Project Manager on {facts['mtc_po']} has no "
                                                  "Upload Test Certificate.",
               pins=[pin(page.get_by_role("button", name="Preview", exact=True).first.locator(".."),
                         "Upload DC, Upload MIR, Preview: no certificate upload.", "info")])


def header_date(page) -> str:
    text = page.get_by_text(re.compile(r"PO Date:")).first.locator("..").inner_text()
    m = re.search(r"((?:Revised )?PO Date:\s*\S+)", text)
    return m.group(1) if m else text.strip()


def po_date_after() -> None:
    role, user = "Admin", USERS["Admin"]
    with session(AFTER, user, PW) as (page, _):
        page.goto(po_url(page, REV_PO))
        settle(page, 2500)
        w.step(page, "po_date", "after", role, user,
               f"{REV_PO}: created {facts['rev_created']}, {facts['rev_n']} approved revisions. Open Preview.",
               click=page.get_by_role("button", name="Preview", exact=True).first)
        settle(page, 3000)
        shown = header_date(page)
        want = f"Revised PO Date: {facts['rev_date']}"
        w.check("po_date", role, f"preview shows \"{want}\" (DB: latest approved revision)", shown, shown == want)
        dl = page.get_by_role("button", name="Download", exact=True).first
        with page.expect_download(timeout=180_000) as d:
            w.step(page, "po_date", "after", role, user, f"The preview's header: \"{shown}\". Download the PDF.",
                   click=dl, pins=[pin(page.get_by_text(re.compile(r"PO Date:")).first.locator(".."),
                                       "Revised PO Date", "info")])
        pdf = out / "files" / "po-orders.pdf"
        pdf.parent.mkdir(exist_ok=True)
        d.value.save_as(str(pdf))
        view, box, text, pages = show_pdf(page, pdf, "Revised PO Date")
        w.check("po_date", role, f"the \"PO Orders\" PDF says \"{want}\"", "found" if want in text.replace("\r", "") else
                "not found", want in text.replace("\r", ""))
        w.step(view, "po_date", "after", role, user, f"Page 1 of the downloaded PDF ({pages} pages), rendered as an image.",
               pins=[pin(box, want, "info")] if box else [])
        view.close()

        page.goto(po_url(page, facts["plain_po"]))
        settle(page, 2500)
        page.get_by_role("button", name="Preview", exact=True).first.click()
        settle(page, 3000)
        shown = header_date(page)
        expect = "Revised PO Date" if facts["plain_po_revisions"] else "PO Date"
        w.check("po_date", role, f"a PO with {facts['plain_po_revisions']} approved revisions shows \"{expect}\"", shown,
                shown.split(":")[0] == expect)
        w.step(page, "po_date", "after", role, user,
               f"{facts['plain_po']} has {facts['plain_po_revisions']} approved revisions: \"{shown}\".",
               pins=[pin(page.get_by_text(re.compile(r"PO Date:")).first.locator(".."), "PO Date", "info")])


def po_date_before() -> None:
    role, user = "Admin", USERS["Admin"]
    with session(BEFORE, user, PW) as (page, _):
        page.goto(po_url(page, REV_PO))
        settle(page, 2500)
        page.get_by_role("button", name="Preview", exact=True).first.click()
        settle(page, 3000)
        shown = header_date(page)
        w.step(page, "po_date", "before", role, user, f"Before this PR: the same PO's preview says \"{shown}\", its "
                                                      "creation date, though it was revised since.",
               pins=[pin(page.get_by_text(re.compile(r"PO Date:")).first.locator(".."), "The creation date.", "info")])


def msme_after() -> None:
    role, user = "Admin", USERS["Admin"]
    with session(AFTER, user, PW) as (page, _):
        page.goto(f"{base_of(page)}/vendors/{MSME_VENDOR}?tab=overview")
        settle(page, 2500)
        item = page.get_by_text("MSME ID", exact=True).first.locator("..")
        w.step(page, "msme", "after", role, user, f"{facts['msme_vendor']['vendor_name']}: Overview shows MSME ID "
                                                  f"\"{item.inner_text().split(chr(10))[-1].strip()}\". Open Edit.",
               click=page.get_by_role("button", name="Edit Vendor Details"),
               pins=[pin(item, "New: MSME ID on the Overview.", "info")])
        settle(page, 1500)
        sheet = page.get_by_role("dialog")
        sec = sheet.get_by_text("MSME Details", exact=True)
        sec.scroll_into_view_if_needed()
        w.step(page, "msme", "after", role, user, "Edit Vendor has a new MSME Details block: certificate and MSME ID.",
               pins=[pin(sec.locator(".."), "MSME Details", "info")])
        sheet.get_by_label("MSME ID").fill(MSME_ID)
        w.step(page, "msme", "after", role, user, f"Type an MSME ID ({MSME_ID}) with no certificate, then Update.",
               click=sheet.get_by_role("button", name="Update"))
        settle(page, 1200)
        err = sheet.get_by_text("Upload the MSME certificate for this MSME ID.")
        w.check("msme", role, "ID only: Update blocked, \"Upload the MSME certificate for this MSME ID.\"",
                "shown" if err.count() else "not shown", err.count() > 0)
        still = page.get_by_role("dialog").count() > 0
        w.check("msme", role, "ID only: the vendor is not saved (the form stays open)", "open" if still else "closed", still)
        w.step(page, "msme", "after", role, user, "Blocked: the ID needs its certificate.",
               pins=[pin(err, "The pair rule, ID without certificate.", "info")] if err.count() else [])

        sheet.locator("input[type=file]").first.set_input_files(str(CERT))
        page.wait_for_timeout(9000)
        read_err = sheet.get_by_text(re.compile(r"could not be read|Udyam number|not look like", re.I)).first
        need_id = sheet.get_by_text("Enter the MSME ID from the certificate.")
        w.check("msme", role, "certificate only: \"Enter the MSME ID from the certificate.\"",
                "shown" if need_id.count() else "not shown", need_id.count() > 0)
        sec.scroll_into_view_if_needed()
        w.step(page, "msme", "after", role, user,
               "Upload a certificate. The read fails on this env (no Gemini key), the ID is cleared, and the form asks "
               "for the ID.",
               pins=[pin(read_err, "This env has no Gemini key, so the certificate is never read here.", "info"),
                     pin(sheet.get_by_role("link", name="View Certificate"),
                         "The file is uploaded and attached to the vendor as soon as it is picked, before Update. A "
                         "user who then cancels leaves the file behind (the vendor's own MSME fields stay empty).",
                         "nit")])
        sheet.get_by_label("MSME ID").fill(MSME_ID)
        w.step(page, "msme", "after", role, user, "Type the ID by hand and Update.",
               click=sheet.get_by_role("button", name="Update"))
        settle(page, 3000)
        saved = db_json(AFTER, "msme_saved", 'print("JSON " + json.dumps(frappe.db.get_value("Vendors", sys.argv[1], '
                        '["msme_id", "msme_attachment"], as_dict=1)))', MSME_VENDOR)
        w.check("msme", role, "DB: both MSME ID and certificate saved", json.dumps(saved),
                saved.get("msme_id") == MSME_ID and bool(saved.get("msme_attachment")))
        if page.get_by_role("dialog").count():
            page.keyboard.press("Escape")
        page.reload()
        settle(page, 2500)
        link = page.get_by_role("link", name=re.compile(MSME_ID))
        href, target = (link.get_attribute("href"), link.get_attribute("target")) if link.count() else (None, None)
        w.check("msme", role, "Overview: the MSME ID opens the certificate in a new tab", f"{href} target={target}",
                bool(href) and href == saved.get("msme_attachment") and target == "_blank")
        w.step(page, "msme", "after", role, user, "Saved. On the Overview the MSME ID is now a link ↗ to the certificate.",
               pins=[pin(link, "Opens the certificate in a new tab.", "info")] if link.count() else [])


def msme_before() -> None:
    role, user = "Admin", USERS["Admin"]
    with session(BEFORE, user, PW) as (page, _):
        page.goto(f"{base_of(page)}/vendors/{MSME_VENDOR}?tab=overview")
        settle(page, 2500)
        w.step(page, "msme", "before", role, user, "Before this PR: the vendor Overview has no MSME ID.",
               click=page.get_by_role("button", name="Edit Vendor Details"))
        settle(page, 1500)
        has = page.get_by_role("dialog").get_by_text("MSME Details", exact=True).count()
        w.check("msme", role, "before this PR: no MSME Details in Edit Vendor", "present" if has else "absent", not has,
                kind="info")
        w.step(page, "msme", "before", role, user, "Before: Edit Vendor has no MSME Details.")


PLAN = [("mu_ordered", mu_before), ("mu_ordered", mu_after), ("mu_ordered", mu_roles),
        ("wo_pdf", wo_before), ("wo_pdf", wo_pdf), ("wo_links", wo_links),
        ("mtc", mtc_before), ("mtc", mtc_pm), ("mtc", mtc_roles),
        ("po_date", po_date_before), ("po_date", po_date_after),
        ("msme", msme_before), ("msme", msme_after)]
only = set(sys.argv[2:])
for cid, fn in PLAN:
    if not only or fn.__name__ in only:
        guarded(cid, fn)

w.status("msme_read", "not_walked", "This env has no Gemini key, so the certificate read fails by design here (seen in "
                                    "the MSME walk). A paid call to Gemini is out of scope for a test env; the PR says "
                                    "the owner confirmed the real read on localhost.")
for c in w.data["changes"]:
    if c["status"] == "failed" or c["id"] == "msme_read":
        continue
    bad = [k for k in w.data["checks"] if k["change"] == c["id"] and not k["ok"] and k["kind"] == "must"]
    musts = [p for s in w.data["steps"] if s["change"] == c["id"] for p in s["pins"] if p["kind"] == "must"]
    if not any(s["change"] == c["id"] for s in w.data["steps"]):
        continue
    w.status(c["id"], "failed" if bad or musts else "seen",
             "; ".join(f"{k['role']}: expected {k['expect']}, saw {k['seen']}" for k in bad))
print(w.save())
