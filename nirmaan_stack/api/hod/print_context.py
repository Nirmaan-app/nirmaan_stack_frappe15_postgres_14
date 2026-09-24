# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Data for the two HOD Print Formats, exposed to Jinja through `hooks.jinja`.

  "HOD Document"  (on Project HOD Document)  {%- set ctx = hod_print_context(doc) -%}
  "HOD Checklist" (on Projects, ?hod_system=) {%- set ctx = hod_checklist_context(doc.name) -%}

The print formats hold layout only; every value, default and rule is prepared here, so the same
numbers reach the screen, the single-document PDF and the binder.
"""

import base64
import html as html_lib
import io
import mimetypes
import re
import urllib.parse
from datetime import date

import frappe
from frappe.utils import formatdate, getdate, today

from nirmaan_stack.api.hod.from_app import included_library, sources_for, system_meta
from nirmaan_stack.api.hod.project_info import VENDOR, as_dict, project_info
from nirmaan_stack.api.pdf_helper.pdf_merger_api import fetch_attachment_content
from nirmaan_stack.services.hod import blanks, checklist, dates, escalation, index, maintenance, sources

DOCTYPE = "Project HOD Document"
DATE_FORMAT = "dd-MMM-yyyy"

# Blank rows printed when nothing is entered -- sized so the sheet + header block + signatures fit one page.
BLANK_ROWS = {"attic_stock_list": 14, "key_list": 8, "inventory_list": 8}


def _fmt(value) -> str:
	if not value:
		return ""
	try:
		return formatdate(getdate(value), DATE_FORMAT)
	except Exception:
		return str(value)


def _header(info: dict, system, date_value) -> dict:
	return {
		"vendor": VENDOR,
		"project": (info["project_name"] or "").upper(),
		"location": info["location"],
		"date": _fmt(date_value) if date_value is not None else "",
		"package": system.display_name,
	}


def _pad(rows, n: int) -> list:
	rows = [r for r in (rows or []) if isinstance(r, dict)]
	return rows if rows else [{} for _ in range(n)]


def _row_form(project: str, hod_system: str, key: str) -> dict:
	return as_dict(
		frappe.db.get_value(DOCTYPE, {"project": project, "hod_system": hod_system, "document": key}, "form_data")
	)


def _inventory(form_data: dict) -> dict:
	materials = [str(m or "") for m in (form_data.get("materials") or [])] or ["Material", "Material", "Material"]
	locations = [l for l in (form_data.get("locations") or []) if isinstance(l, dict)]
	filled = bool(locations)
	if not filled:
		locations = [{"name": "", "qty": []} for _ in range(BLANK_ROWS["inventory_list"])]
	rows = []
	totals = [0.0] * len(materials)
	for loc in locations:
		qty = list(loc.get("qty") or [])
		cells = []
		for j in range(len(materials)):
			v = qty[j] if j < len(qty) else None
			cells.append("" if v in (None, "") else v)
			try:
				totals[j] += float(v or 0)
			except (TypeError, ValueError):
				pass
		rows.append({"name": loc.get("name") or "", "cells": cells})
	return {
		"materials": materials,
		"rows": rows,
		"totals": [int(t) if float(t).is_integer() else t for t in totals] if filled else [],
	}


_IMG_SRC = re.compile(r'(<img\b[^>]*?\bsrc=")([^"]+)(")', re.IGNORECASE)
_STORED_FILE = ("/api/method/frappe_gcp_attachment.controller.generate_file", "/private/files/", "/files/")


def _image_mime(url: str) -> str:
	query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
	name = (query.get("file_name") or [urllib.parse.urlparse(url).path])[0]
	return mimetypes.guess_type(name)[0] or "image/png"


PICTURE_MAX_PX = 1600  # an uploaded phone photo is shrunk to this before it goes into a PDF


def _data_uri(url: str, shrink: bool = False) -> str | None:
	"""A stored (private) file as a data URI, or None when it cannot be fetched (logged).

	Neither wkhtmltopdf nor the binder's background job has a session to fetch a private file, so every
	picture is embedded when the document is printed. `shrink` re-encodes a photo as a JPEG no larger than
	PICTURE_MAX_PX, turned upright from its EXIF orientation."""
	try:
		content = fetch_attachment_content(url)
		mime = _image_mime(url)
		if shrink:
			from PIL import Image, ImageOps

			img = ImageOps.exif_transpose(Image.open(io.BytesIO(content)))
			if img.mode != "RGB":
				img = img.convert("RGB")
			img.thumbnail((PICTURE_MAX_PX, PICTURE_MAX_PX))
			out = io.BytesIO()
			img.save(out, format="JPEG", quality=82)
			content, mime = out.getvalue(), "image/jpeg"
		return f"data:{mime};base64,{base64.b64encode(content).decode()}"
	except Exception:
		frappe.log_error(title="HOD print: picture not embedded", message=f"{url}\n{frappe.get_traceback()}")
		return None


def embed_stored_images(content: str) -> str:
	"""Pictures pasted into library content are PRIVATE files (public GCS uploads do not work on this
	site): embed each one. A picture that cannot be fetched is left as it is."""
	fetched = {}

	def repl(m):
		url = html_lib.unescape(m.group(2))
		if not url.startswith(_STORED_FILE):
			return m.group(0)
		if url not in fetched:
			fetched[url] = _data_uri(url)
		return f"{m.group(1)}{fetched[url]}{m.group(3)}" if fetched[url] else m.group(0)

	return _IMG_SRC.sub(repl, content or "")


def _pictures(doc) -> list:
	"""The O&M pictures users uploaded for this project and system (`form_data.pictures`), embedded.

	Only files ATTACHED TO THIS ROW are printed: a URL written into form_data cannot pull another record's
	file into a PDF."""
	items = [p for p in (as_dict(doc.form_data).get("pictures") or []) if isinstance(p, dict) and p.get("url")]
	if not items:
		return []
	attached = set(
		frappe.get_all("File", filters={"attached_to_doctype": DOCTYPE, "attached_to_name": doc.name}, pluck="file_url")
	)
	out = []
	for p in items:
		url = str(p["url"])
		src = _data_uri(url, shrink=True) if url in attached else None
		if src:
			out.append({"src": src, "caption": str(p.get("caption") or "")})
	return out


def _library(project: str, doc, library_document: str, fill: bool) -> list:
	fd = as_dict(doc.form_data)
	values = fd.get("blanks") if isinstance(fd.get("blanks"), dict) else {}
	out = []
	for c in included_library(project, doc.hod_system, library_document, doc.form_data):
		out.append(
			{
				"name": c.name,
				"title": c.title,
				"sub_system": c.sub_system or "",
				"html": embed_stored_images(blanks.fill_blanks(c.content, values) if fill else (c.content or "")),
				"list_1": checklist.parse_lines(c.list_1),
				"list_2": checklist.parse_lines(c.list_2),
			}
		)
	return out


def hod_print_context(doc) -> dict:
	"""Everything the "HOD Document" print format needs for one Project HOD Document row."""
	entry = index.get(doc.document)
	if not entry:
		frappe.throw(f"Unknown handover document: {doc.document}")
	info = project_info(doc.project)
	system = system_meta(doc.hod_system)
	fd = as_dict(doc.form_data)
	key = entry["key"]

	ctx = {
		"key": key,
		"no": entry["no"],
		"title": entry["title"],
		"kind": entry["kind"],
		"landscape": bool(entry.get("landscape")),
		"disabled": int(doc.disabled or 0),
		"system_name": system.system_name,
		"display_name": system.display_name,
		"consultant_label": f"{(system.system_name or '').upper()} CONSULTANT",
		"project_name": info["project_name"],
		"header": _header(info, system, fd.get("date") or today()),
		"form": fd,
	}

	if key == "escalation_chart":
		ctx["levels"] = escalation.levels(fd)
	elif key == "attic_stock_list":
		ctx["rows"] = _pad(fd.get("rows"), BLANK_ROWS[key])
	elif key == "key_list":
		receiver = fd.get("receiver") if isinstance(fd.get("receiver"), dict) else {}
		ctx["rows"] = _pad(fd.get("rows"), BLANK_ROWS[key])
		ctx["receiver"] = {**receiver, "date": _fmt(receiver.get("date"))}
		ctx["belongs_to"] = fd.get("belongs_to") if fd.get("belongs_to") is not None else info["customer_name"]
	elif key == "inventory_list":
		ctx["inventory"] = _inventory(fd)
	elif key == "om_manual":
		ctx["library"] = _library(doc.project, doc, index.LIB_OM, fill=True)
		ctx["pictures"] = _pictures(doc)
	elif key == "dos_donts":
		ctx["library"] = _library(doc.project, doc, index.LIB_DOS, fill=False)
	elif key == "maintenance_checklist":
		ctx["library"] = _library(doc.project, doc, index.LIB_MAINT, fill=False)
		ctx["sheets"] = maintenance.sheets(ctx["library"], fd)
		# The date of the check when the team entered one; otherwise blank, written by hand on the visit.
		ctx["header"]["date"] = _fmt(fd.get("date"))
	elif key == "recommended_tools":
		ctx["tools"] = checklist.parse_lines(system.tools)
		# Remarks per tool (`form_data.tool_remarks`, keyed by the tool's text so an edited library line never
		# inherits a neighbour's remark).
		remarks = fd.get("tool_remarks") if isinstance(fd.get("tool_remarks"), dict) else {}
		ctx["tool_rows"] = [{"tool": t, "remarks": str(remarks.get(t) or "").strip()} for t in ctx["tools"]]
	elif key == "equipment_warranty":
		equipment = fd.get("equipment") if isinstance(fd.get("equipment"), list) else None
		ctx["equipment"] = equipment if equipment is not None else checklist.parse_lines(system.warranty_equipment)
		ctx["commissioning_date"] = _fmt(fd.get("commissioning_date"))
		ctx["levels"] = escalation.levels(_row_form(doc.project, doc.hod_system, "escalation_chart"))
	elif key == "completion_certificate":
		start = fd.get("commissioning_date")
		ctx["handed_over_to"] = (fd.get("handed_over_to") if fd.get("handed_over_to") is not None else info["customer_name"]) or ""
		ctx["dlp_from"] = _fmt(start)
		ctx["dlp_to"] = _fmt(dates.dlp_end(getdate(start))) if start else ""
	elif entry["kind"] == index.FROM_APP:
		src = sources_for(doc.project, doc.hod_system, key)
		# The page introduces what the binder puts behind it, so it lists the ticked records only.
		src["items"] = sources.selected_items(src.get("items"), fd.get("selected"))
		ctx["sources"] = src
	return ctx


def hod_checklist_context(project=None, hod_system=None) -> dict:
	"""The cover page and the checklist for one system of one project ("HOD Checklist" print format).

	`hod_system` comes from the print link (`&hod_system=Electrical`) when not passed in.
	"""
	project = project or frappe.form_dict.get("name")
	hod_system = hod_system or frappe.form_dict.get("hod_system")
	if not project or not hod_system:
		frappe.throw("Print link needs the project and hod_system.")
	info = project_info(project)
	system = system_meta(hod_system)
	rows = frappe.get_all(
		DOCTYPE,
		filters={"project": project, "hod_system": hod_system},
		fields=["document", "status", "disabled", "remarks", "form_data"],
	)
	if not rows:
		frappe.throw(f"{hod_system} is not added to project {project}.")
	printed = []
	for sno, r in checklist.printable_rows(rows):
		printed.append(
			{
				"sno": sno,
				"title": index.get(r.document)["title"],
				"status": "YES" if checklist.derive_status(r.document, r.form_data) == checklist.STATUS_COMPLETED else "",
				"remarks": r.remarks or "",
			}
		)
	return {
		"project_name": info["project_name"],
		"display_name": system.display_name,
		"system_name": system.system_name,
		"consultant_label": f"{(system.system_name or '').upper()} CONSULTANT",
		"header": _header(info, system, today()),
		"rows": printed,
		"counts": checklist.counts(rows),
		"generated_on": _fmt(date.today()),
	}
