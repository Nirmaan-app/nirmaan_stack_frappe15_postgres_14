"""Every batch's snag report, merged into ONE PDF -- the "Download All" button.

It produces THE SAME DOCUMENT THE TAB'S OWN DOWNLOAD PRODUCES, once per batch, and
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
`api/milestone/print_milestone_reports.py`).

⚠️ MANUALLY ADDED SNAGS ARE NOT IN THIS FILE unless they were filed into a batch. The
loop is per batch, so a snag with none appears in no section. The print format cannot
express "has no batch" either -- its `batches` param becomes `["batch", "in", [...]]` --
which is the same limitation that leaves Download disabled on the "Added manually" tab.
The button's tooltip names the count rather than the rows going missing quietly.
"""

from __future__ import annotations

import io
import json

import frappe
from pypdf import PdfReader, PdfWriter

from nirmaan_stack.api.snags import require_read_access

#: The one print format this merges. Same format the single Download prints, so the
#: pages are identical to what the user already gets per tab.
PRINT_FORMAT = "Project Snag"

#: The filter params the print format reads, passed through VERBATIM from the caller.
#: They arrive as JSON strings because that is what the Jinja `json.loads`es -- this
#: module never re-encodes them, so the merged report narrows exactly like the screen.
_PASSTHROUGH_PARAMS = ("statuses", "areas", "categories", "search", "search_field")


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


@frappe.whitelist()
def download_all_batches(
    project=None,
    statuses=None,
    areas=None,
    categories=None,
    search=None,
    search_field=None,
):
    """One PDF holding every batch's report, in import order.

    READ-guarded on the same tier as `get_snag_stats`: this exposes the same defect
    data, just for every batch at once, so it cannot be the looser door.

    THE CALLER'S FILTERS RIDE ALONG. Status / area / category / search narrow every
    batch's section exactly as they narrow the screen -- the ONE axis this overrides is
    the batch itself, which is the point of the button. A control that ignored the
    filters sitting directly above it would be the odd one out on this screen.
    """
    if not project:
        frappe.throw("project is required.", title="Missing field: project")
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

    merged = PdfWriter()
    rendered = 0
    for batch in batches:
        # The format reads these off `form_dict` at render time. Rebuilt per batch --
        # `batches` is the only one this module authors; the rest pass through as sent,
        # so each section narrows exactly like the screen the button was pressed on.
        frappe.local.form_dict["batches"] = json.dumps([batch.name])
        for key in _PASSTHROUGH_PARAMS:
            frappe.local.form_dict[key] = supplied.get(key)
        _drop_jinja_cache()

        try:
            pdf_bytes = frappe.get_print(
                "Projects",
                project,
                print_format=PRINT_FORMAT,
                as_pdf=True,
                no_letterhead=1,
            )
            for page in PdfReader(io.BytesIO(pdf_bytes)).pages:
                merged.add_page(page)
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

    if not rendered:
        frappe.throw(
            "None of this project's batches could be rendered. Nothing was downloaded.",
            title="Download failed",
        )

    output = io.BytesIO()
    merged.write(output)
    merged.close()

    project_label = frappe.db.get_value("Projects", project, "project_name") or project
    frappe.local.response.filename = _merged_filename(project_label)
    frappe.local.response.filecontent = output.getvalue()
    frappe.local.response.type = "download"


def _merged_filename(project_label: str) -> str:
    """`Snag_List_ALL_<project>_09-09-2026.pdf`.

    ALL is in the name on purpose: this file and a single-tab download otherwise land
    in a downloads folder looking identical.
    """
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in (project_label or ""))
    return f"Snag_List_ALL_{safe}_{frappe.utils.formatdate(frappe.utils.nowdate(), 'dd-MM-yyyy')}.pdf"
