"""PDFs that keep their in-document links: a click that jumps to another spot INSIDE the PDF.

SHARED, for any print format that needs such jumps. First user: the Snag List (thumbnail -> photo
on the category's photo page, and photo -> back to its row, `api/snags/bulk_download.py`).

HOW TO USE IT IN ANOTHER PRINT FORMAT:
  1. In the print format:
       - the target is an element WITH CONTENT carrying an id: `<td id="item-photo-{{ name }}">`;
       - the link is `<a href="#item-photo-{{ name }}">`; if it wraps an image, make the `<a>` a
         block (`display: block`), or its click area is empty;
       - keep the link and its target in the SAME render (the same `get_print` call);
       - make ids unique (include the record name).
  2. In your own download endpoint, before `frappe.get_print(..., as_pdf=True)`:
         frappe.local.form_dict["pdf_generator"] = KEEP_LINKS
     NEVER put it on the URL of Frappe's own `download_pdf`: that endpoint types its
     `pdf_generator` argument as "wkhtmltopdf" | "chrome" and refuses anything else.
  3. Merging several renders into one file: `pdf = LinkedPdf()`, `pdf.append(render)` for each,
     then `pdf.to_bytes()`.
  A Desk print of the same format takes Frappe's normal path, where the jumps open the site
  instead. Harmless.

WHY THIS EXISTS: no PDF made by Frappe's own `get_pdf` can carry a working jump link
(verified 2026-10-08, wkhtmltopdf 0.12.6.1 + pypdf 6.13):
  1. `scrub_urls` rewrites `href="#ph-x"` to `http://<site>/#ph-x` -- a website link;
  2. `get_pdf` re-saves wkhtmltopdf's output through pypdf (`append_pages_from_reader`), which
     drops the catalog's `/Dests`, so every link name points nowhere.

`get_print` already has the way around both: when the request carries a `pdf_generator` other
than "wkhtmltopdf", it hands the rendered HTML to the apps' `pdf_generator` hooks first
(`frappe/utils/print_utils.py`). `keep_links_pdf` is that hook. It answers ONLY to
`pdf_generator=nirmaan_keep_links` -- every other print returns None and takes Frappe's normal
path -- and does what `get_pdf` does, except that its pypdf re-save KEEPS the jump targets.

Three wkhtmltopdf 0.12.6 traits shape the rest (all measured):
  - a target must be an element WITH CONTENT (`<td id=...>`, `<a name=...>text</a>`). An empty
    `<a name="x"></a>` is never placed: its target silently points at the top of page 1;
  - a target's page is written as a page NUMBER (`[2 /XYZ x y 0]`), not a page reference.
    `LinkedPdf` rewrites each one as a reference to the real page, the form every viewer reads;
  - a link whose target is NOT in the same render is dropped, and a target no link in its own
    render points at is never written. Hence rule 1's "same render".

`LinkedPdf` merges several renders: it adds each render's pages AND points its targets at those
merged pages (pypdf's own `append` keeps the links but leaves the targets pointing at no page of
the merged file -- tested).
"""

from __future__ import annotations

import io
import re

import pdfkit
from packaging.version import Version
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, NameObject

import frappe
from frappe import _
from frappe.utils import scrub_urls
# Also what swaps in Frappe's PDFKit subclass (no options read from <meta> tags) for `pdfkit`.
from frappe.utils.pdf import PDF_CONTENT_ERRORS, cleanup, get_wkhtmltopdf_version, prepare_options

#: The `pdf_generator` value that routes a print through `keep_links_pdf`. A download endpoint sets
#: it INSIDE the request (see "HOW TO USE" above; e.g. `api/snags/bulk_download._render`). Never put
#: it on the URL of Frappe's own `download_pdf`: that endpoint types its `pdf_generator` argument as
#: "wkhtmltopdf" | "chrome" and refuses anything else with FrappeTypeError.
KEEP_LINKS = "nirmaan_keep_links"

_DESTS = NameObject("/Dests")

# A fragment-only link. `scrub_urls` matches `href` case-sensitively, so writing it as `HREF`
# keeps it out of the rewrite; attribute names are case-insensitive in HTML, and
# `prepare_options` re-serialises the document with lower-case names anyway.
_FRAGMENT_HREF = re.compile(r"\bhref(\s*=\s*[\"']?#)")


def keep_links_pdf(html=None, options=None, pdf_generator=None, **kwargs):
    """`hooks.py` `pdf_generator` entry: the PDF bytes, or None when this print is not ours.

    A password-protected print also returns None, so Frappe's own path encrypts it.
    """
    if pdf_generator != KEEP_LINKS or (options or {}).get("password"):
        return None
    pdf = LinkedPdf()
    pdf.append(html_to_pdf_keeping_links(html, options))
    return pdf.to_bytes()


def html_to_pdf_keeping_links(html: str, options: dict | None = None) -> bytes:
    """wkhtmltopdf's raw output: `frappe.utils.pdf.get_pdf`, step for step, minus its pypdf
    re-save -- and with fragment-only links kept out of `scrub_urls`. Same options,
    header/footer handling and "broken image" error as Frappe's.
    """
    html = scrub_urls(_FRAGMENT_HREF.sub(r"HREF\1", html))
    html, options = prepare_options(html, options)
    options.update({"disable-javascript": "", "disable-local-file-access": ""})
    if Version(get_wkhtmltopdf_version()) > Version("0.12.3"):
        options.update({"disable-smart-shrinking": ""})

    try:
        return pdfkit.from_string(html, options=options or {}, verbose=True)
    except OSError as e:
        if any(error in str(e) for error in PDF_CONTENT_ERRORS):
            frappe.throw(_("PDF generation failed because of broken image links"))
        raise
    finally:
        cleanup(options)


class LinkedPdf:
    """Pages from one or more wkhtmltopdf renders, with each render's jump links still working.

    Every target is renamed to its bare fragment (`#item-photo-X`; wkhtmltopdf prefixes it with its
    own temp file), and each link with it. Ids must be unique across the merged renders (include
    the record name), or one target overwrites another.
    """

    def __init__(self):
        self.writer = PdfWriter()
        self._dests = DictionaryObject()

    def append(self, pdf: bytes) -> None:
        """Add every page of `pdf`, with its targets pointing at those pages.

        A target's page may be a page NUMBER (wkhtmltopdf) or a page reference (a PDF already
        made here); either way it becomes a reference to the page's copy in this PDF. A target
        whose page cannot be found is dropped: its link then does nothing.
        """
        reader = PdfReader(io.BytesIO(pdf))
        offset = len(self.writer.pages)
        page_of = {page.indirect_reference.idnum: i for i, page in enumerate(reader.pages)}
        for page in reader.pages:
            for annot in self.writer.add_page(page).get("/Annots") or []:
                annot = annot.get_object()
                if annot.get("/Dest") is not None and not isinstance(annot["/Dest"], ArrayObject):
                    annot[NameObject("/Dest")] = _fragment(annot["/Dest"])

        source = reader.trailer["/Root"].get_object().get(_DESTS)
        for name, target in (source.get_object() if source is not None else {}).items():
            name = _fragment(name)
            target = target.get_object()
            if isinstance(target, DictionaryObject):
                target = target["/D"]
            page = target[0]
            index = page if isinstance(page, int) else page_of.get(getattr(page, "idnum", None))
            if index is not None and 0 <= index < len(reader.pages):
                new_page = self.writer.pages[offset + index].indirect_reference
                self._dests[name] = ArrayObject([new_page, *list(target)[1:]])

    def to_bytes(self) -> bytes:
        """The finished PDF. Closes this object."""
        if self._dests:
            self.writer.root_object[_DESTS] = self._dests
        output = io.BytesIO()
        self.writer.write(output)
        self.close()
        return output.getvalue()

    def close(self) -> None:
        self.writer.close()


def _fragment(name) -> NameObject:
    """`/file:///tmp/wktemp-1a2b.html#item-photo-X` -> `/item-photo-X`."""
    return NameObject("/" + str(name).lstrip("/").rsplit("#", 1)[-1])
