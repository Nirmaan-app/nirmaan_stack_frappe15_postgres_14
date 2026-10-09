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

from nirmaan_stack.api.hod import header_roles
from nirmaan_stack.api.hod.from_app import included_library, sources_for, system_meta
from nirmaan_stack.api.hod.project_info import VENDOR, as_dict, project_info
from nirmaan_stack.api.pdf_helper.pdf_merger_api import fetch_attachment_content
from nirmaan_stack.api.tds.status_label import with_status_labels
from nirmaan_stack.services.hod import (
	blanks,
	checklist,
	dates,
	escalation,
	header_logos,
	index,
	maintenance,
	pages,
	sources,
)

DOCTYPE = "Project HOD Document"
DATE_FORMAT = "dd-MMM-yyyy"

# `frappe.flags[LAYOUT_FLAG]`: `{block name: layout}` for this render, a layout being one step of
# `om_fit.LADDERS` for the document. Chosen by `om_fit`, which measures the PDF; a block it does not name
# (and every block on a Desk print or any other caller) is compact, the layout every page is known to fit.
LAYOUT_FLAG = "hod_om_layout"

# Blank rows printed when nothing is entered at all. For the Attic Stock List this is the SAME number
# the dialog starts with (`RowsTable minRows`, via `hodRules.visibleRows`) -- the sheet prints exactly
# the rows the dialog showed, so a document nobody opened must not print a different count either.
BLANK_ROWS = {"attic_stock_list": 5, "key_list": 8, "inventory_list": 8}

# The Inventory List FOLLOWS ITS DATA (owner 2026-09-25): a project with four materials prints four
# columns. These are only what an EMPTY sheet falls back to, so there is something to write on -- they
# are not a minimum, and entered data is never padded up to them. The print format is sized to carry
# 12+ columns when a project actually has them.
BLANK_INVENTORY_COLUMNS = 6


def _fmt(value) -> str:
	if not value:
		return ""
	try:
		return formatdate(getdate(value), DATE_FORMAT)
	except Exception:
		return str(value)


def top_of_page(project: str, document: str = "") -> dict:
	"""`{"letterhead": bool, "logos": [{role, label, name, src}]}` -- what heads a page of the handover.

	`role` is how the signature band finds Nirmaan's column (`mep_contractor`) to put the seal over.

	`document` picks the letterhead for the two that carry it; pass "" for a page that belongs to no
	single document (the cover, the checklist, the binder's divider pages), which always takes the strip.

	The logos are EMBEDDED, like the O&M pictures: a stored file has no session behind it at print
	time (and a public URL does not work on this site at all), so a `src` that fails to fetch is
	dropped rather than printed as a broken image."""
	top = header_roles.header_context(project, document)
	if top["letterhead"]:
		return {"letterhead": True, "logos": []}
	logos = []
	for item in top["logos"]:
		# An absolute url (Nirmaan's own logo) is left for the renderer to fetch, exactly as the TDS
		# report does with the same one. A STORED file has to be embedded (`_embedded`).
		src = _embedded(item["logo"])
		if src:
			logos.append({"role": item["role"], "label": item["label"], "name": item["name"], "src": src})
	return {"letterhead": False, "logos": logos}


def _embedded(logo: str) -> str | None:
	"""A logo as the renderer can fetch it: an absolute url as it is (Nirmaan's own), a stored file
	embedded -- there is no session behind a print, and this site's public file urls do not work."""
	if not logo:
		return None
	return logo if logo.startswith("http") else _data_uri(logo, shrink=True)


def stakeholder_page(project: str) -> list:
	"""The cards of the stakeholder logo page after the cover (owner 2026-10-06):
	`[{role, label, name, src}]`, one per logo picked for the project's header. A logo that fails to fetch
	drops its card rather than printing a broken image."""
	cards = []
	for item in header_roles.stakeholder_cards(project):
		src = _embedded(item["logo"])
		if src:
			cards.append({"role": item["role"], "label": item["label"], "name": item["name"], "src": src})
	return cards


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
	materials = [str(m or "") for m in (form_data.get("materials") or [])]
	# Blank headers, not the old "Material" repeated three times -- a blank header is a column to write
	# one in, whereas a repeated word reads as real data (and got saved into projects as exactly that).
	if not materials:
		materials = [""] * BLANK_INVENTORY_COLUMNS
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
		html = embed_stored_images(blanks.fill_blanks(c.content, values) if fill else (c.content or ""))
		out.append(
			{
				"name": c.name,
				"title": c.title,
				"sub_system": c.sub_system or "",
				"html": html,
				# The O&M Manual prints one page per piece -- see `services/hod/pages`.
				"pages": pages.split_pages(html),
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
		# The form's own date, or BLANK (owner 2026-10-06): an empty date is written on the paper by hand,
		# never filled with the day it happened to be downloaded.
		"header": _header(info, system, fd.get("date") or None),
		# The strip of stakeholder logos across the top -- or the letterhead flag, for the two
		# documents that carry the company letterhead instead (owner 2026-09-24).
		"top": top_of_page(doc.project, key),
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
		layouts = frappe.flags.get(LAYOUT_FLAG) or {}
		for block in ctx["library"]:
			block["layout"] = layouts.get(block["name"]) or ""
		ctx["pictures"] = _pictures(doc)
	elif key == "dos_donts":
		ctx["library"] = _library(doc.project, doc, index.LIB_DOS, fill=False)
		layouts = frappe.flags.get(LAYOUT_FLAG) or {}
		for block in ctx["library"]:
			# "one-roomy" -> one sheet, roomy rhythm; "split-medium" -> the Don'ts on a sheet of their own.
			parts = (layouts.get(block["name"]) or "").split("-")
			block["split"] = parts[0] == "split"
			block["rhythm"] = parts[1] if len(parts) == 2 else ""
	elif key == "maintenance_checklist":
		ctx["library"] = _library(doc.project, doc, index.LIB_MAINT, fill=False)
		ctx["sheets"] = maintenance.sheets(ctx["library"], fd)
		# The six-monthly and the yearly checks are separate VISITS, so each sheet prints its own date
		# (owner 2026-09-25) -- `maintenance.sheets` picked it, this formats it. Blank when the team
		# entered none, to be written by hand on the visit.
		for sheet in ctx["sheets"]:
			sheet["date"] = _fmt(sheet["date"])
	elif key == "recommended_tools":
		ctx["tools"] = checklist.parse_lines(system.tools)
		# The Remarks column prints EMPTY, written in by hand (owner 2026-10-06): the screen no longer takes a
		# remark per tool, so an old `form_data.tool_remarks` is not printed either.
		ctx["tool_rows"] = [{"tool": t, "remarks": ""} for t in ctx["tools"]]
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
		if entry.get("source") == index.SRC_TDS:
			# The template prints `tds_status` as is; it prints the words TDS History shows.
			src["items"] = with_status_labels(src["items"])
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
				# The checklist answer IS the on/off switch (owner 2026-10-06), and only switched-on rows
				# are printed -- so every printed row reads YES. The document's own progress
				# (Not Started / WIP / Done) stays on the screen.
				"status": "YES",
				# Remarks left the SCREEN, not the paper: the column prints so it can be written on by
				# hand at the handover (owner 2026-09-24). Nothing on the tab fills it any more.
				"remarks": r.remarks or "",
			}
		)
	return {
		"project_name": info["project_name"],
		"display_name": system.display_name,
		"system_name": system.system_name,
		"consultant_label": f"{(system.system_name or '').upper()} CONSULTANT",
		"header": _header(info, system, today()),
		# The same strip the documents carry, on the cover and the checklist page (owner 2026-09-25).
		"top": top_of_page(project),
		# The page of stakeholder logos between the cover and the checklist (owner 2026-10-06), and the
		# Nirmaan mark its heading carries -- HIDDEN on that page by the owner's ruling, kept in the markup.
		"stakeholders": stakeholder_page(project),
		"nirmaan_logo": header_logos.BUNDLED_LOGO,
		"rows": printed,
		"counts": checklist.counts(rows),
		"generated_on": _fmt(date.today()),
	}
