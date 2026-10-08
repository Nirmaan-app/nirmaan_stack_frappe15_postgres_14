"""Every batch's snag report, merged into ONE PDF -- the "Download All" button.

Also serves the single "Download" (`download_snag_pdf`): Frappe's own `download_pdf` cannot carry
the jump-link generator (see that function).

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


@frappe.whitelist()
def download_all_batches(
    project=None,
    statuses=None,
    areas=None,
    categories=None,
    search=None,
    search_field=None,
    mode=None,
):
    """One PDF: a MASTER SUMMARY first, then (in `full` mode) every batch's report in
    import order.

    `mode` -- `"full"` (default when omitted) or `"summary"`. Anything else is refused
    rather than guessed at: a typo that fell back to `full` would hand the user a
    many-page file when they asked for one page, with nothing saying why.

    READ-guarded on the same tier as `get_snag_stats`: this exposes the same defect
    data, just for every batch at once, so it cannot be the looser door.

    THE CALLER'S FILTERS RIDE ALONG. Status / area / category / search narrow every
    batch's section exactly as they narrow the screen -- the ONE axis this overrides is
    the batch itself, which is the point of the button. A control that ignored the
    filters sitting directly above it would be the odd one out on this screen.
    """
    if not project:
        frappe.throw("project is required.", title="Missing field: project")
    mode = (mode or "full").strip().lower()
    if mode not in _MODES:
        frappe.throw(
            f"mode must be one of {', '.join(_MODES)} (got {mode!r}).",
            title="Invalid download mode",
        )
    require_read_access("view this project's snag list")

    if not frappe.db.exists("Projects", project):
        frappe.throw(f"Project '{project}' not found.", title="Not found")

    batches = frappe.get_all(
        "Project Snag Batch",
        filters={"project": project},
        fields=["name", "batch_name"],
        # Import order, so the merged file reads oldest-first like the tab strip.
        order_by="uploaded_on asc, creation asc",
        limit_page_length=0,
    )
    if not batches:
        frappe.throw(
            "This project has no imported batches to download.",
            title="Nothing to download",
        )

    supplied = {
        "statuses": statuses,
        "areas": areas,
        "categories": categories,
        "search": search,
        "search_field": search_field,
    }

    merged = LinkedPdf()

    # --- The MASTER SUMMARY: always first, in both modes ---------------------------
    # `batches=None` = every batch (the Jinja's own default); the caller's filters ride
    # along, so the summary counts exactly what the sections below it contain.
    # (Until the `mode=master` section is pasted into the format in Desk, this prints
    # the ordinary project-wide report -- see the module docstring.)
    try:
        master_bytes = _render(
            project, supplied, mode=_MASTER_RENDER_MODE, batches=None
        )
        merged.append(master_bytes)
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

    # --- The per-batch sections: `full` mode only ----------------------------------
    rendered = 0
    for batch in batches if mode == "full" else []:
        try:
            # `mode=None` -- a batch section renders normally, never as a summary.
            # `batches` is the only filter this module authors; the rest pass through
            # as sent, so each section narrows exactly like the screen.
            pdf_bytes = _render(
                project, supplied, mode=None, batches=json.dumps([batch.name])
            )
            merged.append(pdf_bytes)
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

    # Summary mode renders no sections by design, so "none rendered" is only a failure
    # when sections were asked for.
    if mode == "full" and not rendered:
        merged.close()
        frappe.throw(
            "None of this project's batches could be rendered. Nothing was downloaded.",
            title="Download failed",
        )

    output = merged.to_bytes()

    project_label = frappe.db.get_value("Projects", project, "project_name") or project
    frappe.local.response.filename = (
        _summary_filename(project_label) if mode == "summary" else _merged_filename(project_label)
    )
    frappe.local.response.filecontent = output
    frappe.local.response.type = "download"


@frappe.whitelist(methods=["GET"])
def download_snag_pdf(
    project=None,
    statuses=None,
    areas=None,
    categories=None,
    batches=None,
    search=None,
    search_field=None,
    mode=None,
):
    """ONE Snag List PDF of the screen as it stands: the single "Download" button, and its
    "Summary only" choice (`mode="master"`). Filters arrive exactly as the Jinja reads them.

    WHY NOT FRAPPE'S `download_pdf`: it takes `pdf_generator` as an argument typed
    `Literal["wkhtmltopdf", "chrome"]`, and every web request is type-checked, so
    `pdf_generator=nirmaan_keep_links` on its URL failed with FrappeTypeError before any PDF
    was made (2026-10-08). Here, as in Download All, `_render` sets the generator INSIDE the
    request, so the photo <-> row jump links survive.

    PERMISSION: the snag read tier first, as Download All asks it -- the PDF carries every
    snag photo, and Accountant is denied the snag list (`READ_DENIED_ROLES`) even where it
    may read the project. Then Frappe's own, unchanged from `download_pdf`: `get_print`
    refuses a user who can neither read nor print the project
    (`printview.validate_print_permission`).
    """
    if not project:
        frappe.throw("project is required.", title="Missing field: project")
    require_read_access("view this project's snag list")
    if not frappe.db.exists("Projects", project):
        frappe.throw(f"Project '{project}' not found.", title="Not found")
    if mode not in (None, "", _MASTER_RENDER_MODE):
        frappe.throw(
            f"mode must be '{_MASTER_RENDER_MODE}' or absent (got {mode!r}).",
            title="Invalid download mode",
        )

    supplied = {
        "statuses": statuses,
        "areas": areas,
        "categories": categories,
        "search": search,
        "search_field": search_field,
    }
    frappe.local.response.filecontent = _render(
        project, supplied, mode=mode or None, batches=batches or None
    )
    # The screen names the saved file itself (`buildSnagPdfFilename`).
    frappe.local.response.filename = f"{_safe_label(project)}.pdf"
    frappe.local.response.type = "pdf"


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
