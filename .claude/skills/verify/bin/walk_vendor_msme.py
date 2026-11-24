"""Walk a vendor's MSME details (PR #1731) as Admin: Edit Vendor's MSME Details block, the rule that the MSME ID and
the Udyam certificate are saved together or not at all, the saved pair in the DB, and the Overview's MSME ID opening
the certificate. Uploading the certificate also asks Document AI to read it and fill the MSME ID. A certificate
picked and then cancelled is never attached to the vendor (PR #1736).

    python3 -I .claude/skills/verify/bin/walk_vendor_msme.py <env> <out dir> [function ...]

It writes: each run gives one vendor that has no MSME ID and no certificate yet (picked from the env DB, db/)
a made-up certificate image and a made-up Udyam number, both made at run time under files/. The read is a real model
call when the env's Document AI key works; when the read fails on the env, that claim is reported not walked with the
error the screen showed.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from feature_walk import FeatureWalk, pin, settle  # noqa: E402


ROLE = "Admin"
NEEDS_CERTIFICATE = "Upload the MSME certificate for this MSME ID."
NEEDS_ID = "Enter the MSME ID from the certificate."

FACTS_SQL = r'''
# Two vendors still in the starting state: no MSME fields and no file attached (one to save, one to cancel on).
v = frappe.db.sql("""
    SELECT v.name, v.vendor_name FROM "tabVendors" v
    WHERE COALESCE(v.msme_id, '') = '' AND COALESCE(v.msme_attachment, '') = ''
      AND NOT EXISTS (SELECT 1 FROM "tabFile" f WHERE f.attached_to_doctype = 'Vendors' AND f.attached_to_name = v.name)
    ORDER BY v.creation DESC, v.name LIMIT 2""", as_dict=True)
emit({**v[0], "cancel": v[1]})
'''

ATTACHED_SQL = r'''
emit(frappe.get_all("File", filters={"attached_to_doctype": "Vendors", "attached_to_name": sys.argv[1]},
                    fields=["name", "file_name", "attached_to_field"]))
'''

SAVED_SQL = r'''
emit(frappe.db.get_value("Vendors", sys.argv[1], ["msme_id", "msme_attachment"], as_dict=True))
'''

fw = FeatureWalk("Vendors › MSME details", "vendors.md")
w = fw.w
w.change("msme", "Vendors › MSME ID and certificate",
         "New / Edit Vendor get MSME Details: an Udyam certificate upload and an MSME ID. ID and certificate go "
         "together or not at all. Vendor Overview shows the MSME ID, which opens the certificate.")
w.change("msme_cancel", "Vendors › Cancel leaves no certificate on the vendor",
         "The certificate is attached to the vendor on Update only: pick one in Edit Vendor, Cancel, and the vendor "
         "holds no file.")
w.change("msme_read", "Vendors › Document AI reads the MSME certificate",
         "Uploading the certificate sends it to Gemini, which reads it and fills the MSME ID.")
USER = fw.pick([ROLE])[ROLE]
facts = fw.db("facts", FACTS_SQL)
VENDOR, VENDOR_NAME = facts["name"], facts["vendor_name"]
MSME_ID = f"UDYAM-KR-03-{int(hashlib.sha1(VENDOR.encode()).hexdigest(), 16) % 10_000_000:07d}"
CERT = fw.out / "files" / "udyam-certificate.png"


def server_message(response) -> str:
    """What the server said back: its message, else its thrown messages, else the start of the body."""
    try:
        body = response.json()
    except Exception:
        return response.text()[:200]
    if "message" in body:
        return json.dumps(body["message"])[:200]
    msgs = [json.loads(m).get("message", m) for m in json.loads(body.get("_server_messages") or "[]")]
    return "; ".join(msgs)[:200] or body.get("exc_type", "")


def make_certificate() -> None:
    from PIL import Image, ImageDraw, ImageFont

    CERT.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (1240, 1754), "white")
    draw = ImageDraw.Draw(img)
    big, body = ImageFont.load_default(size=44), ImageFont.load_default(size=30)
    draw.text((120, 140), "UDYAM REGISTRATION CERTIFICATE", font=big, fill="black")
    lines = [("UDYAM REGISTRATION NUMBER", MSME_ID), ("NAME OF ENTERPRISE", VENDOR_NAME.upper()),
             ("TYPE OF ENTERPRISE", "MICRO"), ("MAJOR ACTIVITY", "SERVICES"),
             ("DATE OF UDYAM REGISTRATION", "01/04/2024")]
    for i, (label, value) in enumerate(lines):
        draw.text((120, 320 + i * 90), f"{label}:  {value}", font=body, fill="black")
    draw.text((120, 1600), "Made up by a test walk on a test copy of the data; not a real certificate.",
              font=ImageFont.load_default(size=20), fill="gray")
    img.save(CERT)


def msme() -> None:
    make_certificate()
    with fw.session(USER) as page:
        fw.open_vendor(page, "msme", ROLE, VENDOR, VENDOR_NAME)
        item = page.get_by_text("MSME ID", exact=True).first.locator("..")
        shown = item.inner_text().split("\n")[-1].strip() if item.count() else "no MSME ID row"
        w.check("msme", ROLE, "Overview shows an MSME ID row, empty (--) before any is saved", shown, shown == "--")
        w.step(page, "msme", "after", ROLE, USER, f"{VENDOR_NAME}: the Overview shows MSME ID \"{shown}\". Open Edit.",
               click=page.get_by_role("button", name="Edit Vendor Details"),
               pins=[pin(item, "MSME ID on the Overview.", "info")])
        settle(page, 1500)
        sheet = page.get_by_role("dialog")
        sec = sheet.get_by_text("MSME Details", exact=True)
        w.check("msme", ROLE, "Edit Vendor has an MSME Details block", "present" if sec.count() else "absent",
                sec.count() > 0)
        sec.scroll_into_view_if_needed()
        w.step(page, "msme", "after", ROLE, USER, "Edit Vendor has an MSME Details block: certificate and MSME ID.",
               pins=[pin(sec.locator(".."), "MSME Details", "info")])

        sheet.get_by_label("MSME ID").fill(MSME_ID)
        w.step(page, "msme", "after", ROLE, USER, f"Type an MSME ID ({MSME_ID}) with no certificate, then Update.",
               click=sheet.get_by_role("button", name="Update"))
        settle(page, 1200)
        err = sheet.get_by_text(NEEDS_CERTIFICATE)
        w.check("msme", ROLE, f"ID only: Update blocked with \"{NEEDS_CERTIFICATE}\"",
                "shown" if err.count() else "not shown", err.count() > 0)
        still = page.get_by_role("dialog").count() > 0
        w.check("msme", ROLE, "ID only: the form stays open, nothing saved", "open" if still else "closed", still)
        w.step(page, "msme", "after", ROLE, USER, "Blocked: the ID needs its certificate.",
               pins=[pin(err, "ID without certificate.", "info")] if err.count() else [])

        with page.expect_response(lambda r: "msme_autofill.extract_msme_fields" in r.url, timeout=180_000) as resp:
            sheet.locator("input[type=file]").first.set_input_files(str(CERT))
        answer = f"HTTP {resp.value.status}: {server_message(resp.value)}"
        sheet.get_by_text("Reading certificate…").wait_for(state="hidden", timeout=60_000)
        settle(page, 1000)
        read_id = sheet.get_by_label("MSME ID").input_value()
        read_err = sheet.locator("p.text-red-600").first
        read_err_text = read_err.inner_text().strip() if read_err.count() else ""
        sec.scroll_into_view_if_needed()
        if read_err_text:
            w.status("msme_read", "not_walked", f"The read failed on this env (the read call answered {answer}; the "
                                                f"form said \"{read_err_text}\"): the env's Document AI key is missing "
                                                "or refused. Never add a key to an env yourself.")
            w.step(page, "msme_read", "after", ROLE, USER, "Upload a certificate. The read fails on this env, so the "
                                                           "form asks for the ID by hand.",
                   pins=[pin(read_err, "The env cannot reach the reader.", "info")])
        else:
            w.check("msme_read", ROLE, f"the read fills the MSME ID printed on the certificate ({MSME_ID})",
                    read_id or "left empty", read_id == MSME_ID)
            w.step(page, "msme_read", "after", ROLE, USER,
                   f"Upload a certificate. Document AI read it and filled the MSME ID: \"{read_id}\".",
                   pins=[pin(sheet.get_by_label("MSME ID"), "Filled by the read.", "info")])

        sheet.get_by_label("MSME ID").fill("")
        page.wait_for_timeout(600)
        need_id = sheet.get_by_text(NEEDS_ID)
        w.check("msme", ROLE, f"certificate only: \"{NEEDS_ID}\"", "shown" if need_id.count() else "not shown",
                need_id.count() > 0)
        w.step(page, "msme", "after", ROLE, USER, "With the certificate and no ID, the form asks for the ID.",
               pins=[pin(need_id, "Certificate without ID.", "info")] if need_id.count() else [])

        sheet.get_by_label("MSME ID").fill(MSME_ID)
        w.step(page, "msme", "after", ROLE, USER, "Type the ID and Update.",
               click=sheet.get_by_role("button", name="Update"))
        settle(page, 3000)
        saved = fw.db("msme_saved", SAVED_SQL, VENDOR)
        w.check("msme", ROLE, f"DB: MSME ID {MSME_ID} and a certificate saved together", json.dumps(saved),
                saved.get("msme_id") == MSME_ID and bool(saved.get("msme_attachment")))
        if page.get_by_role("dialog").count():
            page.keyboard.press("Escape")
        page.reload()
        settle(page, 2500)
        link = page.get_by_role("link", name=re.compile(re.escape(MSME_ID)))
        href, target = (link.get_attribute("href"), link.get_attribute("target")) if link.count() else (None, None)
        w.check("msme", ROLE, "Overview: the MSME ID opens the saved certificate in a new tab",
                f"{href} target={target}", bool(href) and href == saved.get("msme_attachment") and target == "_blank")
        w.step(page, "msme", "after", ROLE, USER, "Saved. On the Overview the MSME ID is a link to the certificate.",
               pins=[pin(link, "Opens the certificate in a new tab.", "info")] if link.count() else [])


def msme_cancel() -> None:
    vendor, name = facts["cancel"]["name"], facts["cancel"]["vendor_name"]
    make_certificate()
    with fw.session(USER) as page:
        fw.open_vendor(page, "msme_cancel", ROLE, vendor, name)
        w.step(page, "msme_cancel", "after", ROLE, USER, f"{name} has no MSME details. Open Edit.",
               click=page.get_by_role("button", name="Edit Vendor Details"))
        settle(page, 1500)
        sheet = page.get_by_role("dialog")
        sheet.locator("input[type=file]").first.set_input_files(str(CERT))
        view = sheet.get_by_role("link", name="View Certificate")
        view.wait_for(timeout=180_000)
        sheet.get_by_text("Reading certificate…").wait_for(state="hidden", timeout=180_000)
        settle(page, 1000)
        sheet.get_by_text("MSME Details", exact=True).scroll_into_view_if_needed()
        w.check("msme_cancel", ROLE, "the picked certificate is uploaded (View Certificate shows)",
                "shown" if view.count() else "not shown", view.count() > 0)
        w.step(page, "msme_cancel", "after", ROLE, USER, "Pick a certificate, then Cancel instead of Update.",
               click=sheet.get_by_role("button", name="Cancel"), pins=[pin(view, "Uploaded.", "info")])
        settle(page, 1500)
        attached = fw.db("msme_cancel_files", ATTACHED_SQL, vendor)
        saved = fw.db("msme_cancel_saved", SAVED_SQL, vendor)
        w.check("msme_cancel", ROLE, "DB after Cancel: no file attached to the vendor, MSME fields still empty",
                f"{len(attached)} attached; {json.dumps(saved)}",
                not attached and not saved.get("msme_id") and not saved.get("msme_attachment"))
        page.reload()
        settle(page, 2500)
        w.step(page, "msme_cancel", "after", ROLE, USER,
               f"After Cancel the DB holds {len(attached)} file{'s' if len(attached) != 1 else ''} on {vendor}.",
               pins=[pin(page.get_by_text("MSME ID", exact=True).first.locator(".."), "Still empty.", "info")])


fw.run([("msme", msme), ("msme_cancel", msme_cancel)])
fw.finish()
