"""Snag List PDFs: every batch's report merged into ONE PDF (the "Download All" button), and the
tab's own "Download". Both are BUILT IN A BACKGROUND OPERATION (`start_snag_pdf`, ADR 0047): a big
project's PDF outlasted the web request. Frappe's own `download_pdf` cannot carry the jump-link generator
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

import json

import frappe
from frappe.www.printview import validate_print_permission

from nirmaan_stack.api.snags import require_read_access
from nirmaan_stack.api.pdf_helper.keep_links import KEEP_LINKS, LinkedPdf
from nirmaan_stack.services import background_ops

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

#: How long one operation may run once it starts: the `long` queue's own default. A whole project's
#: Snag List, every photo included, fits well inside it.
JOB_TIMEOUT_SECONDS = 25 * 60


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
def start_snag_pdf(
    op_id=None,
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
    """Start ONE Snag List PDF as the background operation `op_id` (the browser makes it) and return its status
    record at once.

    WHY IN THE BACKGROUND: a big project's PDF -- every photo fetched, shrunk and embedded, then the
    whole page through wkhtmltopdf -- outlasted the web request's time limit, and held a web
    worker the whole time. The operation runs the same `_render` on the `long` queue instead.

    The screen follows the operation's status record (`api/background_ops.get_status`, ADR 0047) and, once it
    is finished, collects the file (`api/background_ops.collect_result`). Only the user who started it may read
    either: the PDF carries every snag photo.

    Filters arrive exactly as the Jinja reads them. `kind="tab"` also takes `batches` (the tab)
    and `mode="master"` (Summary only); `kind="all"` takes `mode="full"|"summary"` and owns
    `batches` itself. ONE snag PDF queued or running per user (`_take_users_slot`): a second start is refused
    while the first is.
    """
    earlier = background_ops.started_before(op_id)
    if earlier:
        return earlier
    mode = _normal_mode(kind, mode)
    _check_request(kind, project, mode)

    record = background_ops.start(
        "snag_pdf",
        "nirmaan_stack.api.snags.bulk_download.snag_pdf_op",
        op_id=op_id,
        timeout=JOB_TIMEOUT_SECONDS,
        document=kind,  # not `kind`: that is `start`'s own parameter, the operation's kind
        project=project,
        params={
            "mode": mode,
            "batches": batches if kind == KIND_TAB else None,
            "statuses": statuses,
            "areas": areas,
            "categories": categories,
            "search": search,
            "search_field": search_field,
        },
    )
    # After the start: the refusal rolls the request back, which ends this record failed and queues nothing.
    if not _take_users_slot(frappe.session.user, op_id):
        frappe.throw(
            "A snag PDF is already being prepared for you. Wait for it to finish, then try again.",
            title="Download in progress",
        )
    return record


def _slot_name(user):
    return f"snag_pdf_slot:{user}"


def _take_users_slot(user, op_id):
    """Make `op_id` the user's one snag PDF. True when the slot was free, already held `op_id`, or held an
    operation that has ended (finished, failed, lost, or expired) -- so however an operation ends, its user is
    free again, with no lock for a dead worker to leave behind. A compare-and-set on the slot: of two starts
    racing, one takes it.
    """
    cache = frappe.cache()
    key = cache.make_key(_slot_name(user))
    taken = {}

    def attempt(pipe):
        taken.clear()
        raw = pipe.get(key)
        holder = raw.decode() if isinstance(raw, bytes) else raw
        if holder and holder != op_id and _still_working(holder):
            return
        pipe.multi()
        pipe.set(key, op_id, ex=background_ops.KEEP_SECONDS)
        taken["ok"] = True

    cache.transaction(attempt, key)
    return bool(taken)


def _still_working(op_id):
    """Is the caller's operation `op_id` queued or running (a dead worker's reads as lost)?"""
    try:
        return background_ops.status(op_id)["state"] in (background_ops.QUEUED, background_ops.RUNNING)
    except (frappe.ValidationError, frappe.PermissionError):
        return False  # not an operation id this user can hold: nothing of theirs is running under it


def snag_pdf_op(document=None, project=None, params=None):
    """The work of `start_snag_pdf` (runs as the user who started it, under `background_ops.run`): build the
    PDF and keep it as the operation's finished file, for that user alone. `document` is the request's `kind`.

    The checks run AGAIN here, as the user: the request may have waited in the queue. A refusal
    (`frappe.throw`) fails the operation in its own words; anything else is logged and fails it with a plain
    message (`background_ops.run`).
    """
    params = params or {}

    def progress(done, total):
        background_ops.set_progress(
            round(100 * done / total) if total else 0, None, detail={"done": done, "total": total}
        )

    _check_request(document, project, params.get("mode"))
    if document == KIND_ALL:
        pdf, filename = _build_all_pdf(project, params, progress)
    else:
        progress(0, 1)
        pdf, filename = _build_tab_pdf(project, params)
        progress(1, 1)
    background_ops.write_result_file(pdf, filename)


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
