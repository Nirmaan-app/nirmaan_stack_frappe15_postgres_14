# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Handover PDFs built on the `long` queue: the whole BINDER of a system, or the CONTENT of one document.

    binder  = cover + checklist ("HOD Checklist"), then for every document answered YES, in checklist order:
              a divider page (S.No + title) followed by that document's content
    content = one document's content alone (the row's download button for the six from-app documents)

A document's CONTENT (`_content_steps`), owner rulings 2026-09-22 (the signed-upload case was retired
with the upload itself, 2026-09-24):
    a form / template                            -> its "HOD Document" print
    Demo & Training / Commissioning / Factory    -> each Commission task's signed copy, else its filled report
                                                    (Commission print format), else its uploaded file
    Material TDS                                 -> the project's OWN TDS report over the ticked items
                                                    (`api/hod/tds_pack.py` -> `build_tds_report_pdf`),
                                                    the same document the export dialog downloads
    Snag List                                    -> the Snag List print of each ticked snag batch
    As Built                                     -> each ticked drawing, downloaded from its Google Drive link
                                                    (or its stored file)
A document with NO content blocks the binder: `check_binder` names them and the screen offers to switch
them off first. Switched-off documents are never included.

The Commission reports, TDS sheets, snag batches and drawings that go in are the ones TICKED on the document
(`form_data.selected`, a list of record names; absent = all of them).

Progress is reported per step (every report / file / page), not per document, so a long Commission
section still moves the bar. Every event is ALSO kept in the cache under the job_id (`get_job_status`):
realtime events do not reliably reach the browser on every setup, so the screen polls it as well.
The divider pages are rendered in ONE pass.

Pattern: `api/commission_report/bulk_download_reports.py` (per-user NX lock, enqueue, realtime events
carrying a job_id, temp-file token downloaded through `pdf_helper.bulk_download.fetch_temp_file`).
Rendering goes through `frappe.get_print` with the Jinja cache dropped before every render
(`api/snags/bulk_download._drop_jinja_cache`): the formats read `form_dict` (`hod_system`, `task_row`).
READ-ONLY on every feature it reads.
"""

import io
import json
from concurrent.futures import ThreadPoolExecutor

import frappe
import requests
from frappe import _
from frappe.utils import today
from frappe.utils.pdf import get_pdf
from pypdf import PdfReader, PdfWriter

from nirmaan_stack.api.frappe_s3_attachment import get_s3_temp_url
from nirmaan_stack.api.hod.from_app import included_library, sources_for, system_meta
from nirmaan_stack.api.hod.project_info import as_dict
from nirmaan_stack.api.pdf_helper.bulk_download import ensure_temp_dir, get_temp_path
from nirmaan_stack.api.pdf_helper.pdf_merger_api import fetch_attachment_content
from nirmaan_stack.api.snags.bulk_download import _drop_jinja_cache
from nirmaan_stack.services.hod import checklist, index, sources

DOCTYPE = "Project HOD Document"
PF_DOCUMENT = "HOD Document"
PF_CHECKLIST = "HOD Checklist"
PF_SNAG = "Project Snag"
COMMISSION_PARENT = "Project Commission Report"

LOCK_TTL_SECONDS = 900  # also the job timeout; the lock auto-releases if a worker dies

EV_PROGRESS = "hod_binder_progress"
EV_READY = "hod_binder_ready"
EV_FAILED = "hod_binder_failed"

# A4 at 150 dpi, for fitting an uploaded picture onto a page without stretching it.
_A4_PX = (1240, 1754)
# Attached files (TDS sheets, signed copies) download in parallel while the pages render.
PREFETCH_WORKERS = 6

# Why a switched-on document has nothing to put in a PDF (shown to the user).
EMPTY_REASON = {
	index.SRC_COMMISSION: "no completed report in the Commission Report yet",
	index.SRC_TDS: "no TDS item for this system in the project's TDS list yet",
	"none_selected": "no report ticked for download",
	index.SRC_SNAG: "no completed snag on this project yet",
	index.SRC_DESIGN: "no issued As Built drawing with a downloadable file in the Design Tracker yet",
	index.LIB_OM: "no O&M manual part or picture selected",
	index.LIB_DOS: "no Do's & Don'ts text in the library",
	index.LIB_MAINT: "no maintenance checklist in the library",
	"recommended_tools": "no tools listed for this system",
}


def _lock_key(user):
	return f"hod_binder_lock:{user}"


STATUS_TTL_SECONDS = 3600


def _status_key(job_id):
	return f"hod_binder_status:{job_id}"


def _emit(event: str, data: dict, user: str):
	"""Publish a job event AND keep it as the job's status for the polling fallback."""
	state = {EV_PROGRESS: "running", EV_READY: "ready", EV_FAILED: "failed"}[event]
	frappe.cache().set_value(_status_key(data["job_id"]), {**data, "state": state, "user": user}, expires_in_sec=STATUS_TTL_SECONDS)
	frappe.publish_realtime(event, data, user=user)


@frappe.whitelist()
def get_job_status(job_id: str) -> dict:
	"""The last event of one of the caller's own jobs (the screen polls this; realtime may not arrive)."""
	status = frappe.cache().get_value(_status_key(job_id)) or {}
	if status and status.get("user") != frappe.session.user:
		raise frappe.PermissionError
	return {k: v for k, v in status.items() if k != "user"} or {"state": "queued", "job_id": job_id}


# ------------------------------------------------------------------------------------------- the plan


def _print_step(label, doctype, name, print_format, form=None):
	return {"label": label, "kind": "print", "args": (doctype, name, print_format, form or {})}


def _file_step(label, url):
	return {"label": label, "kind": "file", "args": (url,)}


def _tds_step(label, project, hod_system, form_data):
	"""4 Material Data Sheet: the project's OWN TDS report (cover + table + the data sheets merged in),
	built by the same renderer the export dialog uses -- see `api/hod/tds_pack.py`."""
	return {"label": label, "kind": "tds", "args": (project, hod_system, form_data)}


def _content_steps(project: str, hod_system: str, row, system) -> tuple[list, str | None]:
	"""The steps that make one switched-on document's content, and why it is empty when there are none."""
	entry = index.get(row.document)
	title = entry["title"]
	if entry["kind"] != index.FROM_APP:
		key = entry["key"]
		if entry.get("library"):
			has_text = bool(included_library(project, hod_system, entry["library"], row.form_data))
			has_pictures = key == "om_manual" and bool(as_dict(row.form_data).get("pictures"))
			if not (has_text or has_pictures):
				return [], EMPTY_REASON[entry["library"]]
		if key == "recommended_tools" and not checklist.parse_lines(system.tools):
			return [], EMPTY_REASON[key]
		return [_print_step(title, DOCTYPE, row.name, PF_DOCUMENT)], None

	src_kind = entry["source"]
	src = sources_for(project, hod_system, row.document)
	selected = as_dict(row.form_data).get("selected")
	chosen = (lambda name: name in set(selected)) if isinstance(selected, list) else (lambda name: True)
	steps = []
	if src_kind == index.SRC_COMMISSION:
		for t in src.get("items") or []:
			if not chosen(t.name):
				continue
			pick = sources.commission_binder_source(t)
			label = f"{title}: {t.task_name}"
			if pick == sources.COMMISSION_SIGNED:
				steps.append(_file_step(label, t.approval_proof))
			elif pick == sources.COMMISSION_REPORT:
				steps.append(_print_step(label, COMMISSION_PARENT, t.parent, t.print_format, {"task_row": t.name}))
			elif pick == sources.COMMISSION_FILE:
				steps.append(_file_step(label, t.file_link))
	elif src_kind == index.SRC_TDS:
		# ONE step, not one per sheet: the TDS report is a document in its own right and carries its own
		# cover and table, so it also skips the HOD "(list)" page below.
		if any(chosen(t.name) for t in src.get("items") or []):
			steps.append(_tds_step(title, project, hod_system, row.form_data))
	elif src_kind == index.SRC_SNAG:
		if frappe.db.exists("Print Format", PF_SNAG):
			for b in src.get("items") or []:
				if chosen(b.name):
					steps.append(
						_print_step(
							f"{title}: {b.batch_name}",
							"Projects",
							project,
							PF_SNAG,
							# Completed snags only, exactly what the screen offered (owner 2026-09-23).
							{"batches": json.dumps([b.name]), "statuses": json.dumps([sources.SNAG_DONE])},
						)
					)
	elif src_kind == index.SRC_DESIGN:
		for t in src.get("items") or []:
			if t.download_url and chosen(t.name):
				steps.append(_file_step(f"{title}: {t.task_name}", t.download_url))
	if not steps and isinstance(selected, list) and src.get("items"):
		return steps, EMPTY_REASON["none_selected"]
	if steps and src_kind != index.SRC_TDS:
		# The document's own page first: it says WHICH records follow (item, make, category, report name),
		# then the records themselves. Without it the binder is a stack of data sheets with nothing naming
		# what each one is for (owner 2026-09-23). The TDS report brings its own, so it is left out there.
		steps.insert(0, _print_step(f"{title} (list)", DOCTYPE, row.name, PF_DOCUMENT))
	return steps, (None if steps else EMPTY_REASON[src_kind])


def build_plan(project: str, hod_system: str, document: str | None = None) -> tuple[list, list]:
	"""(sections, empty) for the switched-on documents -- or just `document`.

	sections = [{"sno", "document", "title", "steps"}] in checklist order (S.No closed up);
	empty    = [{"document", "title", "reason"}] for switched-on documents with nothing to include."""
	system = system_meta(hod_system)
	rows = frappe.get_all(
		DOCTYPE,
		filters={"project": project, "hod_system": hod_system},
		fields=["name", "document", "status", "disabled", "remarks", "form_data"],
	)
	parts = checklist.binder_parts(rows)
	# The binder carries what was actually handed over: YES rows only (owner 2026-09-24). NO and NA
	# stay on the printed checklist with their answer, but no pages follow them.
	parts = [p for p in parts if (p[1].status or "").strip().upper() == checklist.STATUS_YES]
	if document:
		parts = [p for p in parts if p[1].document == document]
		if not parts:
			frappe.throw(
				_("{0} is not marked YES for {1}, so there is nothing to hand over for it.").format(
					index.get(document)["title"] if index.get(document) else document, hod_system
				)
			)
	sections, empty = [], []
	for sno, row, _part in parts:
		title = index.get(row.document)["title"]
		steps, reason = _content_steps(project, hod_system, row, system)
		if steps:
			sections.append({"sno": sno, "document": row.document, "title": title, "steps": steps})
		else:
			empty.append({"document": row.document, "title": title, "reason": reason})
	return sections, empty


def _require(project: str, hod_system: str):
	if not project or not hod_system:
		frappe.throw(_("Project and system are required."))
	if not frappe.has_permission("Projects", "read", doc=project):
		raise frappe.PermissionError(_("Not permitted to read this project."))
	if not frappe.has_permission(DOCTYPE, "read"):
		raise frappe.PermissionError(_("Not permitted to read handover documents."))
	if not frappe.db.exists(DOCTYPE, {"project": project, "hod_system": hod_system}):
		frappe.throw(_("{0} is not added to this project.").format(hod_system))


@frappe.whitelist()
def check_binder(project: str, hod_system: str) -> dict:
	"""Which switched-on documents have nothing to include, and how many steps a build takes.

	The screen no longer pre-checks (owner 2026-09-23: the binder button waits until every document is
	Completed, and a Completed document always has its uploaded copy to put in). `enqueue_binder` still
	refuses an empty document on its own; this stays as the read that says WHICH one and why."""
	_require(project, hod_system)
	sections, empty = build_plan(project, hod_system)
	return {"empty": empty, "steps": 2 + sum(len(s["steps"]) for s in sections)}


@frappe.whitelist(methods=["POST"])
def enqueue_binder(project: str, hod_system: str, document: str | None = None) -> dict:
	"""Start building the binder (or, with `document`, that document's content). Returns at once with a
	job_id; progress, the download token and errors arrive as `hod_binder_*` realtime events."""
	_require(project, hod_system)
	sections, empty = build_plan(project, hod_system, document)
	if document and not sections:
		frappe.throw(_("Nothing to download for {0}: {1}.").format(empty[0]["title"], empty[0]["reason"]))
	if not document:
		if empty:
			frappe.throw(
				_("These switched-on documents have nothing to include: {0}. Switch them off and try again.").format(
					", ".join(e["title"] for e in empty)
				)
			)
		for pf in (PF_DOCUMENT, PF_CHECKLIST):
			if not frappe.db.exists("Print Format", pf):
				frappe.throw(_("Print Format '{0}' is missing -- it has to be created first.").format(pf))

	user = frappe.session.user
	cache = frappe.cache()
	if not cache.set(cache.make_key(_lock_key(user)), "1", ex=LOCK_TTL_SECONDS, nx=True):
		frappe.throw(_("A handover download is already being built for you. Please wait for it to finish."))

	job_id = frappe.generate_hash(length=16)
	try:
		frappe.enqueue(
			"nirmaan_stack.api.hod.binder._run_binder_job",
			queue="long",
			timeout=LOCK_TTL_SECONDS,
			# `job_id` is a parameter of enqueue ITSELF (the RQ job id), so it never reaches the function:
			# the job's own id has to travel under another name, or every event is published for job None
			# and the screen -- which polls its own id -- never learns the file is ready.
			job_id=job_id,
			hod_job_id=job_id,
			user=user,
			project=project,
			hod_system=hod_system,
			document=document,
		)
	except Exception:
		cache.delete_value(_lock_key(user))
		raise
	return {"status": "enqueued", "job_id": job_id}


# ----------------------------------------------------------------------------------------- rendering


def _print(doctype: str, name: str, print_format: str, form: dict | None = None) -> bytes:
	"""One `get_print` render with a fresh Jinja env and exactly `form` as the print link's params."""
	frappe.local.form_dict = frappe._dict(form or {})
	_drop_jinja_cache()
	return frappe.get_print(doctype, name, print_format=print_format, as_pdf=True, no_letterhead=1)


def _dividers(sections: list, display_name: str, project_name: str) -> list:
	"""Every section's divider page, rendered in ONE pass (one page each)."""
	esc = frappe.utils.escape_html
	pages = "".join(
		f"""<div class="dv"><div class="no">{s["sno"]:02d}</div><div class="title">{esc(s["title"])}</div>
		<div class="sys">{esc(display_name)} &mdash; {esc(project_name)}</div></div>"""
		for s in sections
	)
	html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
	.print-format {{ margin-top: 15mm; margin-bottom: 15mm; }}
	body {{ font-family: Helvetica, Arial, sans-serif; text-align: center; }}
	.dv {{ page-break-after: always; height: 240mm; }}
	.dv:last-child {{ page-break-after: auto; }}
	.no {{ font-size: 18px; color: #555; padding-top: 95mm; }}
	.title {{ font-size: 30px; font-weight: 700; text-transform: uppercase; margin-top: 10px; }}
	.sys {{ font-size: 14px; margin-top: 14px; color: #333; }}
	</style></head><body>{pages}</body></html>"""
	reader = PdfReader(io.BytesIO(get_pdf(html)))
	if len(reader.pages) != len(sections):
		raise ValueError(f"divider pages: expected {len(sections)}, got {len(reader.pages)}")
	return list(reader.pages)


def _download(signed_url: str) -> bytes:
	"""Worker thread: plain HTTP only -- no frappe calls (there is no site context in the thread)."""
	res = requests.get(signed_url, timeout=60)
	res.raise_for_status()
	return res.content


def _prefetch(sections: list):
	"""Start downloading every attached file at once. URLs are signed here, in the job's thread; a download
	that fails (or whose signature expired while queued) is fetched again the normal way when needed."""
	pool = ThreadPoolExecutor(max_workers=PREFETCH_WORKERS)
	futures = {}
	for sec in sections:
		for st in sec["steps"]:
			url = st["args"][0] if st["kind"] == "file" else None
			if url and url not in futures:
				try:
					signed = get_s3_temp_url(url)
				except Exception:
					continue
				if signed.startswith("http"):
					futures[url] = pool.submit(_download, signed)
	return pool, futures


def _file_pdf(url: str, prefetched=None) -> bytes:
	"""A stored file as PDF bytes: a PDF as it is, a picture fitted onto an A4 page (never stretched)."""
	content = None
	if prefetched is not None:
		try:
			content = prefetched.result()
		except Exception:
			content = None
	if not content:
		content = fetch_attachment_content(url)
	if not content:
		raise ValueError(f"Empty file: {url}")
	try:
		PdfReader(io.BytesIO(content))
		return content
	except Exception:
		pass
	from PIL import Image

	img = Image.open(io.BytesIO(content))
	if img.mode != "RGB":
		img = img.convert("RGB")
	page_w, page_h = _A4_PX if img.width <= img.height else _A4_PX[::-1]
	scale = min(page_w / img.width, page_h / img.height)
	fitted = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))))
	page = Image.new("RGB", (page_w, page_h), "white")
	page.paste(fitted, ((page_w - fitted.width) // 2, (page_h - fitted.height) // 2))
	out = io.BytesIO()
	page.save(out, format="PDF", resolution=150)
	return out.getvalue()


class _Job:
	def __init__(self, user, job_id, total):
		self.user = user
		self.job_id = job_id
		self.total = total
		self.done = 0
		self.writer = PdfWriter()
		self.failed = []

	def step(self, label: str, fn):
		"""Add what `fn()` returns; a part that fails is logged and named, never fatal. Reports progress."""
		try:
			for page in PdfReader(io.BytesIO(fn())).pages:
				self.writer.add_page(page)
		except Exception:
			self.failed.append(label)
			frappe.log_error(title=f"HOD download: {label} failed", message=frappe.get_traceback())
		self.done += 1
		_emit(EV_PROGRESS, {"job_id": self.job_id, "done": self.done, "total": self.total, "label": label}, self.user)


def _render(step: dict, futures: dict) -> bytes:
	if step["kind"] == "print":
		return _print(*step["args"])
	if step["kind"] == "tds":
		from nirmaan_stack.api.hod.tds_pack import build_pack

		return build_pack(*step["args"])
	url = step["args"][0]
	return _file_pdf(url, futures.get(url))


def _run_binder_job(project=None, hod_system=None, document=None, user=None, hod_job_id=None):
	job_id = hod_job_id
	frappe.set_user(user or "Administrator")
	try:
		system = system_meta(hod_system)
		project_name = frappe.db.get_value("Projects", project, "project_name") or project
		sections, _empty = build_plan(project, hod_system, document)
		safe = lambda s: "".join(c if (c.isalnum() or c in "-_") else "_" for c in s)  # noqa: E731
		pool, futures = _prefetch(sections)

		if document:
			if not sections:
				_emit(EV_FAILED, {"job_id": job_id, "message": "Nothing to download for this document."}, user)
				return
			sec = sections[0]
			job = _Job(user, job_id, len(sec["steps"]))
			for st in sec["steps"]:
				job.step(st["label"], lambda st=st: _render(st, futures))
			filename = f"{safe(project_name)}_{safe(hod_system)}_{sec['sno']:02d}_{safe(sec['title'])}_{today()}.pdf"
		else:
			job = _Job(user, job_id, 2 + sum(len(s["steps"]) for s in sections))
			job.step("Cover & checklist", lambda: _print("Projects", project, PF_CHECKLIST, {"hod_system": hod_system}))
			try:
				divider_pages = _dividers(sections, system.display_name, project_name)
			except Exception:
				frappe.log_error(title="HOD binder: divider pages failed", message=frappe.get_traceback())
				divider_pages = [None] * len(sections)
			job.done += 1
			for sec, divider in zip(sections, divider_pages):
				if divider is not None:
					job.writer.add_page(divider)
				for st in sec["steps"]:
					job.step(st["label"], lambda st=st: _render(st, futures))
			filename = f"{safe(project_name)}_{safe(hod_system)}_Handover_{today()}.pdf"

		pool.shutdown(wait=False, cancel_futures=True)
		if not job.writer.pages:
			_emit(EV_FAILED, {"job_id": job_id, "message": "Nothing could be generated."}, user)
			return
		ensure_temp_dir()
		token = frappe.generate_hash(length=32)
		with open(get_temp_path(token), "wb") as f:
			job.writer.write(f)
		job.writer.close()
		_emit(EV_READY, {"job_id": job_id, "token": token, "filename": filename, "failed": job.failed}, user)
	except Exception:
		frappe.log_error(title="HOD download job crashed", message=frappe.get_traceback())
		_emit(EV_FAILED, {"job_id": job_id, "message": "The download could not be built. Please try again."}, user)
	finally:
		frappe.local.form_dict = frappe._dict()
		if user:
			frappe.cache().delete_value(_lock_key(user))
