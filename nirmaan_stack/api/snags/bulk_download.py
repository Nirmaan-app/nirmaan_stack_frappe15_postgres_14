"""Snag List PDFs: every batch's report merged into ONE PDF (the "Download All" button), and the
tab's own "Download". Both are BUILT IN A BACKGROUND JOB (`enqueue_snag_pdf`): a big project's
PDF outlasted the web request. Frappe's own `download_pdf` cannot carry the jump-link generator
either (see `_build_tab_pdf`).

THE FILE ALWAYS OPENS ON A MASTER SUMMARY. Before any batch section, the same print
format is rendered once with `mode="master"` and NO `batches` param -- the project-wide
view: per-file status and category counts. Then, by `mode`:

    mode="full"     (default) -> master summary + every batch's section, as below.
    mode="summary"            -> the master summary ALONE; no batch sections at all.

The master is not optional decoration: it is the file's first page, so a master render
that fails FAILS THE DOWNLOAD (logged, then thrown) rather than shipping a file that
silently starts somewhere else. A single BATCH that fails is still skipped-and-logged,
exactly as before -- the other sections are worth having.

⚠️ THE `mode=master` JINJA SECTION IS NOT IN THE PRINT FORMAT YET -- it is pasted in via
Desk separately. Until it is, the master render ignores `mode` and prints the ordinary
project-wide report (every batch, the same filters). That is expected, not a bug here.

Each batch section is THE SAME DOCUMENT THE TAB'S OWN DOWNLOAD PRODUCES, once per batch, and
concatenates them. Not a lookalike: it calls `frappe.get_print` with the same print
format and the same `batches` filter the tab sends, so letterhead handling, print
style, page size and margins are all Frappe's -- there is nothing here that can drift
away from what a user sees when they download a single tab.

⚠️ `frappe.get_print` CACHES ITS JINJA ENVIRONMENT, AND THAT IS THE WHOLE DIFFICULTY.
This format reads its filters off `frappe.form_dict`, and a second call in the same
request reuses the cached env: batch two rendered batch ONE's report, cover and all --
a merged PDF of N plausible, wrong sections. Measured, not assumed:

    SNAGB-26-00002: own file on cover = True
    SNAGB-26-00007: own file on cover = False     <- rendered batch 1

Dropping `frappe.local.jenv*` between batches fixes it (measured: both True). That
single `_drop_jinja_cache()` call is load-bearing -- remove it and the bug returns
silently, because every section still renders and still looks right.

`api/commission_report/bulk_download_reports.py` met the same trap with `task_row` and
worked around it by rendering the template by hand. That works, but it hands `get_pdf`
a FRAGMENT rather than a document, and the format's leading `<!-- ... -->` banner
comments then printed as visible text above the logo. Clearing the cache keeps
`get_print` -- and with it Frappe's own document wrapper -- so that cannot happen here.

`pypdf` is the merge library this app already uses (`api/pdf_helper/`,
`api/milestone/print_milestone_reports.py`). Every render goes through `keep_links_pdf` (the
shared `pdf_generator` hook, `api/pdf_helper/keep_links.py`) and is merged by its `LinkedPdf`, so
each section's
thumbnail -> photo links (the photos follow each category's table) still land after the merge.
Copying pages one by one, as this module used to, loses every jump target.

⚠️ MANUALLY ADDED SNAGS ARE NOT IN THIS FILE unless they were filed into a batch. The
loop is per batch, so a snag with none appears in no section. The print format cannot
express "has no batch" either -- its `batches` param becomes `["batch", "in", [...]]` --
which is the same limitation that leaves Download disabled on the "Added manually" tab.
The button's tooltip names the count rather than the rows going missing quietly.
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import time

import frappe
from frappe.utils import strip_html
from frappe.www.printview import validate_print_permission

from nirmaan_stack.api.snags import require_read_access
from nirmaan_stack.api.pdf_helper.keep_links import KEEP_LINKS, LinkedPdf

#: The one print format this merges. Same format the single Download prints, so the
#: pages are identical to what the user already gets per tab.
PRINT_FORMAT = "Project Snag"

#: The filter params the print format reads, passed through VERBATIM from the caller.
#: They arrive as JSON strings because that is what the Jinja `json.loads`es -- this
#: module never re-encodes them, so the merged report narrows exactly like the screen.
_PASSTHROUGH_PARAMS = ("statuses", "areas", "categories", "search", "search_field")

#: What the caller may ask for. `full` is the default and keeps the pre-summary file
#: shape (plus the master page in front); `summary` is the master page alone.
_MODES = ("full", "summary")

#: The `form_dict["mode"]` value that switches the print format into its master-summary
#: section. Distinct from `_MODES` on purpose: THOSE describe the FILE the caller wants,
#: this describes ONE RENDER. A batch render carries `mode=None` (see `_render`).
_MASTER_RENDER_MODE = "master"


def _drop_jinja_cache() -> None:
    """Force the NEXT `get_print` to re-render instead of reusing its cached env.

    ⚠️ LOAD-BEARING. Without it the second and later batches come back as copies of the
    first -- see the module docstring for the measurement. It is deliberately narrow:
    only the request-local Jinja environments, never `frappe.clear_cache()`, which is
    site-wide and would evict every other user's caches on a button press.
    """
    for attr in ("jenv", "jenv_restricted", "jenv_unrestricted"):
        if hasattr(frappe.local, attr):
            try:
                delattr(frappe.local, attr)
            except Exception:  # noqa: BLE001 - a cache that will not drop must not fail the download
                pass


def _render(project: str, supplied: dict, *, mode, batches) -> bytes:
    """ONE `frappe.get_print` of the format, with every param it reads set EXPLICITLY.

    Both `mode` and `batches` are always written, even as `None`: `form_dict` is the
    live request dict, so a key this function does not set would carry over from the
    PREVIOUS render -- or from the request itself, which arrives holding the caller's
    own `mode=full|summary`. A batch section must see `mode=None` (render normally) and
    the master must see `batches=None` (every batch); leaving either to chance is how
    the master quietly becomes batch N's report, or a batch quietly becomes a summary.
    """
    frappe.local.form_dict["mode"] = mode
    frappe.local.form_dict["batches"] = batches
    # Keeps the in-document links (`api/pdf_helper/keep_links`); `get_print` reads it off form_dict.
    frappe.local.form_dict["pdf_generator"] = KEEP_LINKS
    for key in _PASSTHROUGH_PARAMS:
        frappe.local.form_dict[key] = supplied.get(key)
    # ⚠️ LOAD-BEARING -- see `_drop_jinja_cache`. Before EVERY render, the master included.
    _drop_jinja_cache()

    return frappe.get_print(
        "Projects",
        project,
        print_format=PRINT_FORMAT,
        as_pdf=True,
        no_letterhead=1,
    )


# ---------------------------------------------------------------------------
# The request: checked at once, built in the background, collected by its owner
# ---------------------------------------------------------------------------

#: The two documents. `tab` = the tab's own "Download" (one render of the screen as it stands);
#: `all` = "Download All" (a master summary, then every batch, merged).
KIND_TAB = "tab"
KIND_ALL = "all"
_KINDS = (KIND_TAB, KIND_ALL)

#: How long one job may run: the `long` queue's own default. A whole project's Snag List, every
#: photo included, fits well inside it.
JOB_TIMEOUT_SECONDS = 25 * 60
#: One snag PDF in flight per user. Outlives a job plus a wait in the queue, so the JOB releases
#: it; the clock only does when a job dies.
LOCK_TTL_SECONDS = JOB_TIMEOUT_SECONDS + 5 * 60
#: How long a request's status, and its finished file, wait to be collected.
KEEP_SECONDS = 2 * 60 * 60
#: Where finished files wait. PRIVATE and unserved -- a snag PDF carries private photos, so
#: never `public/files/temp_downloads`, which the web server hands to anyone with the URL.
_PDF_DIR = ("private", "snag_pdf_downloads")
_REQUEST_ID = re.compile(r"[0-9a-f]{20}")


def _normal_mode(kind, mode):
    """`all` takes the FILE's mode (`full` default / `summary`); `tab` takes the RENDER's
    (`master` = Summary only, or none)."""
    if kind == KIND_ALL:
        return (mode or "full").strip().lower()
    return mode or None


def _check_request(kind, project, mode):
    """Everything a download is refused for. Asked twice: BEFORE it is queued, so the user hears
    at once, and again when the job runs as that user -- roles or the project may have changed.

    PERMISSION: the snag read tier first -- the PDF carries every snag photo, and Accountant is
    denied the snag list (`READ_DENIED_ROLES`) even where it may read the project. Then Frappe's
    own print rule, as `get_print` applies it: read OR print on the project.
    """
    if kind not in _KINDS:
        frappe.throw(f"kind must be one of {', '.join(_KINDS)} (got {kind!r}).", title="Invalid download")
    if not project:
        frappe.throw("project is required.", title="Missing field: project")
    if kind == KIND_ALL and mode not in _MODES:
        frappe.throw(
            f"mode must be one of {', '.join(_MODES)} (got {mode!r}).",
            title="Invalid download mode",
        )
    if kind == KIND_TAB and mode not in (None, _MASTER_RENDER_MODE):
        frappe.throw(
            f"mode must be '{_MASTER_RENDER_MODE}' or absent (got {mode!r}).",
            title="Invalid download mode",
        )
    require_read_access("view this project's snag list")
    if not frappe.db.exists("Projects", project):
        frappe.throw(f"Project '{project}' not found.", title="Not found")
    validate_print_permission(frappe.get_doc("Projects", project))
    if kind == KIND_ALL and not _project_batches(project):
        frappe.throw(
            "This project has no imported batches to download.",
            title="Nothing to download",
        )


def _project_batches(project):
    return frappe.get_all(
        "Project Snag Batch",
        filters={"project": project},
        fields=["name", "batch_name"],
        # Import order, so the merged file reads oldest-first like the tab strip.
        order_by="uploaded_on asc, creation asc",
        limit_page_length=0,
    )


@frappe.whitelist(methods=["POST"])
def enqueue_snag_pdf(
    kind=None,
    project=None,
    mode=None,
    statuses=None,
    areas=None,
    categories=None,
    batches=None,
    search=None,
    search_field=None,
):
    """Queue ONE Snag List PDF and return at once with `{"request_id"}`.

    WHY A JOB: a big project's PDF -- every photo fetched, shrunk and embedded, then the
    whole page through wkhtmltopdf -- outlasted the web request's time limit, and held a web
    worker the whole time. The job runs the same `_render` on the `long` queue instead.

    The screen then asks `get_snag_pdf_status` every few seconds and, once it reads `ready`,
    collects the file from `fetch_snag_pdf`. Polling, not realtime events: a missed or dropped
    event would leave the screen waiting forever, and each tab asks only about its own request.

    Filters arrive exactly as the Jinja reads them. `kind="tab"` also takes `batches` (the tab)
    and `mode="master"` (Summary only); `kind="all"` takes `mode="full"|"summary"` and owns
    `batches` itself. ONE snag PDF in flight per user: a second request is refused while the
    first is queued or running.
    """
    mode = _normal_mode(kind, mode)
    _check_request(kind, project, mode)

    user = frappe.session.user
    cache = frappe.cache()
    # ATOMIC set-if-absent with a TTL -- the commission bulk download's lock, and its reason:
    # a get_value-then-set_value on one key in one request silently fails to set.
    lock = cache.make_key(_lock_name(user))
    if not cache.set(lock, "1", ex=LOCK_TTL_SECONDS, nx=True):
        frappe.throw(
            "A snag PDF is already being prepared for you. Wait for it to finish, then try again.",
            title="Download in progress",
        )

    request_id = frappe.generate_hash(length=20)
    params = {
        "mode": mode,
        "batches": batches if kind == KIND_TAB else None,
        "statuses": statuses,
        "areas": areas,
        "categories": categories,
        "search": search,
        "search_field": search_field,
    }
    try:
        _save_status(request_id, {"user": user, "state": "queued", "done": 0, "total": 0})
        frappe.enqueue(
            "nirmaan_stack.api.snags.bulk_download.run_snag_pdf_job",
            queue="long",
            timeout=JOB_TIMEOUT_SECONDS,
            # NOT `job_id`: that is `frappe.enqueue`'s OWN parameter, so the job would get None.
            request_id=request_id,
            user=user,
            kind=kind,
            project=project,
            params=params,
        )
    except Exception:
        # Never queued: free the user now rather than after the whole TTL.
        cache.delete(lock)
        raise
    return {"request_id": request_id}


@frappe.whitelist(methods=["GET"])
def get_snag_pdf_status(request_id=None):
    """`{state, done, total, message}` of the caller's OWN request.

    `state`: `queued` -> `running` -> `ready` | `failed`. `done` / `total` count renders
    (Download All: the master summary, then one per batch). `message` explains a `failed`.
    """
    record = _own_status(request_id)
    return {key: record.get(key) for key in ("state", "done", "total", "message")}


@frappe.whitelist(methods=["GET"])
def fetch_snag_pdf(request_id=None):
    """The finished PDF, ONCE: the file and its status are deleted as it is handed over."""
    record = _own_status(request_id)
    if record.get("state") != "ready":
        frappe.throw("This PDF is not ready yet.", title="Not ready")
    path = _pdf_path(request_id)
    if not os.path.exists(path):
        frappe.throw("This download has expired or was already collected.", title="Expired")
    with open(path, "rb") as f:
        content = f.read()
    with contextlib.suppress(OSError):
        os.remove(path)
    cache = frappe.cache()
    cache.delete(cache.make_key(_status_name(request_id)))

    frappe.local.response.filename = record.get("filename") or "Snag_List.pdf"
    frappe.local.response.filecontent = content
    frappe.local.response.type = "download"


def run_snag_pdf_job(request_id=None, user=None, kind=None, project=None, params=None):
    """The background half of `enqueue_snag_pdf`: build the PDF as `user`, keep it privately,
    and mark the request `ready` -- or `failed`, with a message the screen can show.

    The checks run AGAIN here, as the user: the request may have waited in the queue.
    Whatever happens, the user's lock is released, so they are never locked out.
    """
    params = params or {}
    record = {"user": user, "state": "running", "done": 0, "total": 0}
    _save_status(request_id, record)

    def progress(done, total):
        record.update(done=done, total=total)
        _save_status(request_id, record)

    try:
        frappe.set_user(user)
        _sweep_old_pdfs()
        _check_request(kind, project, params.get("mode"))
        if kind == KIND_ALL:
            pdf, filename = _build_all_pdf(project, params, progress)
        else:
            progress(0, 1)
            pdf, filename = _build_tab_pdf(project, params)
            progress(1, 1)
        with open(_pdf_path(request_id), "wb") as f:
            f.write(pdf)
        record.update(state="ready", filename=filename)
    except (frappe.ValidationError, frappe.PermissionError) as e:
        # A refusal the user can act on (`frappe.throw`): pass its own words on.
        record.update(state="failed", message=strip_html(str(e)) or "The PDF could not be generated.")
    except Exception:
        frappe.log_error(
            title="Snag PDF job failed",
            message=f"project={project!r} kind={kind!r}\n\n{frappe.get_traceback()}",
        )
        record.update(
            state="failed",
            message="The PDF could not be generated. The error has been logged.",
        )
    finally:
        _save_status(request_id, record)
        cache = frappe.cache()
        cache.delete(cache.make_key(_lock_name(user)))


def _build_tab_pdf(project, params):
    """ONE Snag List PDF of the screen as it stands: the tab's "Download", and its "Summary
    only" (`mode="master"`).

    WHY NOT FRAPPE'S `download_pdf`: it takes `pdf_generator` as an argument typed
    `Literal["wkhtmltopdf", "chrome"]`, and every web request is type-checked, so
    `pdf_generator=nirmaan_keep_links` on its URL failed with FrappeTypeError before any PDF
    was made (2026-10-08). `_render` sets the generator itself, so the photo <-> row jump links
    survive.
    """
    pdf = _render(
        project,
        _supplied(params),
        mode=params.get("mode") or None,
        batches=params.get("batches") or None,
    )
    # The screen names the saved file itself (`buildSnagPdfFilename`).
    return pdf, f"{_safe_label(project)}.pdf"


def _build_all_pdf(project, params, progress):
    """One PDF: a MASTER SUMMARY first, then (in `full` mode) every batch's report in import
    order. `progress(done, total)` is called after each render.

    THE CALLER'S FILTERS RIDE ALONG. Status / area / category / search narrow every batch's
    section exactly as they narrow the screen -- the ONE axis this overrides is the batch
    itself, which is the point of the button.
    """
    mode = params.get("mode")
    supplied = _supplied(params)
    batches = _project_batches(project)
    total = 1 + (len(batches) if mode == "full" else 0)

    merged = LinkedPdf()

    # --- The MASTER SUMMARY: always first, in both modes ---------------------------
    # `batches=None` = every batch (the Jinja's own default); the caller's filters ride
    # along, so the summary counts exactly what the sections below it contain.
    try:
        merged.append(_render(project, supplied, mode=_MASTER_RENDER_MODE, batches=None))
    except Exception:
        # NOT skipped like a batch: the master is the file's first page, and a file
        # that silently opens on batch 1 instead reads as complete when it is not.
        # Logged FIRST, so the traceback survives the throw below.
        frappe.log_error(
            title="Snag bulk download: master summary failed to render",
            message=f"project={project!r} mode={mode!r}\n\n{frappe.get_traceback()}",
        )
        merged.close()
        frappe.throw(
            "The master summary could not be generated, so nothing was downloaded. "
            "The error has been logged.",
            title="Download failed",
        )
    progress(1, total)

    # --- The per-batch sections: `full` mode only ----------------------------------
    rendered = 0
    for index, batch in enumerate(batches if mode == "full" else [], start=2):
        try:
            # `mode=None` -- a batch section renders normally, never as a summary.
            # `batches` is the only filter this module authors; the rest pass through
            # as sent, so each section narrows exactly like the screen.
            merged.append(
                _render(project, supplied, mode=None, batches=json.dumps([batch.name]))
            )
            rendered += 1
        except Exception:
            # One unrenderable batch must not cost the user the whole download -- the
            # others are still worth having. It IS logged: a section missing from a file
            # called "all" is exactly the kind of gap that must not pass silently.
            frappe.log_error(
                title="Snag bulk download: one batch failed to render",
                message=(
                    f"project={project!r} batch={batch.name!r}\n\n{frappe.get_traceback()}"
                ),
            )
        progress(index, total)

    # Summary mode renders no sections by design, so "none rendered" is only a failure
    # when sections were asked for.
    if mode == "full" and not rendered:
        merged.close()
        frappe.throw(
            "None of this project's batches could be rendered. Nothing was downloaded.",
            title="Download failed",
        )

    project_label = frappe.db.get_value("Projects", project, "project_name") or project
    filename = (
        _summary_filename(project_label) if mode == "summary" else _merged_filename(project_label)
    )
    return merged.to_bytes(), filename


def _supplied(params) -> dict:
    return {key: params.get(key) for key in _PASSTHROUGH_PARAMS}


def _lock_name(user):
    return f"snag_pdf_lock:{user}"


def _status_name(request_id):
    return f"snag_pdf_status:{request_id}"


def _save_status(request_id, record):
    """The request's whole record, rewritten each time (only its job writes after it is queued).
    Raw redis, like the lock: nothing here should be served from a process-local cache."""
    cache = frappe.cache()
    cache.set(cache.make_key(_status_name(request_id)), json.dumps(record), ex=KEEP_SECONDS)


def _own_status(request_id):
    """The caller's own request, or a refusal: an id that is malformed, unknown, expired or
    someone else's all read the same, so no request is confirmed to a stranger."""
    raw = None
    if isinstance(request_id, str) and _REQUEST_ID.fullmatch(request_id):
        cache = frappe.cache()
        raw = cache.get(cache.make_key(_status_name(request_id)))
    record = json.loads(raw) if raw else None
    if not record or record.get("user") != frappe.session.user:
        frappe.throw("This download has expired or was already collected.", title="Expired")
    return record


def _pdf_path(request_id):
    folder = frappe.get_site_path(*_PDF_DIR)
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, f"{request_id}.pdf")


def _sweep_old_pdfs():
    """Delete finished files nobody collected within KEEP_SECONDS (a closed tab, a lost
    connection). Runs at the start of every job, so the folder never grows without bound."""
    folder = frappe.get_site_path(*_PDF_DIR)
    if not os.path.isdir(folder):
        return
    cutoff = time.time() - KEEP_SECONDS
    for entry in os.scandir(folder):
        with contextlib.suppress(OSError):
            if entry.is_file() and entry.stat().st_mtime < cutoff:
                os.remove(entry.path)


def _safe_label(project_label: str) -> str:
    """The project name with anything a filesystem would rather not see replaced."""
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in (project_label or ""))


def _today() -> str:
    return frappe.utils.formatdate(frappe.utils.nowdate(), "dd-MM-yyyy")


def _merged_filename(project_label: str) -> str:
    """`Snag_List_ALL_<project>_09-09-2026.pdf` -- the `full` file.

    ALL is in the name on purpose: this file and a single-tab download otherwise land
    in a downloads folder looking identical.
    """
    return f"Snag_List_ALL_{_safe_label(project_label)}_{_today()}.pdf"


def _summary_filename(project_label: str) -> str:
    """`Snag_Summary_<project>_09-09-2026.pdf` -- the `summary` file.

    A different STEM, not a suffix: a one-page summary saved beside a full merge must
    not be mistaken for it (the frontend's local fallback name mirrors this).
    """
    return f"Snag_Summary_{_safe_label(project_label)}_{_today()}.pdf"
