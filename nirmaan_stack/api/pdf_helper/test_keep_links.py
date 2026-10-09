"""Tests for the shared jump-link PDF step (`api/pdf_helper/keep_links.py`).

No fixtures and no DB writes: the PDFs are rendered straight from HTML through the real
wkhtmltopdf (the site context is needed only for Print Settings).
"""

import io

from frappe.tests.utils import FrappeTestCase
from pypdf import PdfReader

from nirmaan_stack.api.pdf_helper import keep_links


def _page_with_a_jump(target_page, token):
    """HTML: a link on page 1 to a cell `target_page` pages in, which holds `token`."""
    breaks = "".join(
        f'<div style="page-break-before: always">page {n}</div>' for n in range(2, target_page)
    )
    return (
        f'<div class="print-format"><p><a href="#{token}">jump</a></p>{breaks}'
        f'<div style="page-break-before: always"><table><tr><td id="{token}">target</td></tr></table></div></div>'
    )


def _jumps(pdf):
    """`[(page the link is on, page it lands on)]` for every in-document link of `pdf`."""
    reader = PdfReader(io.BytesIO(pdf))
    page_of = {page.indirect_reference.idnum: i for i, page in enumerate(reader.pages)}
    dests = reader.trailer["/Root"].get_object()["/Dests"].get_object()
    jumps = []
    for i, page in enumerate(reader.pages):
        for annot in page.get("/Annots") or []:
            dest = annot.get_object().get("/Dest")
            if dest is not None:
                jumps.append((i, page_of[dests[dest].get_object()[0].idnum]))
    return jumps


class TestKeepLinksPdf(FrappeTestCase):
    def test_it_answers_only_to_its_own_generator_and_never_to_a_password_print(self):
        html = _page_with_a_jump(2, "t")

        self.assertIsNone(keep_links.keep_links_pdf(html=html, options={}, pdf_generator="wkhtmltopdf"))
        self.assertIsNone(keep_links.keep_links_pdf(html=html, options={}, pdf_generator=None))
        self.assertIsNone(
            keep_links.keep_links_pdf(
                html=html, options={"password": "x"}, pdf_generator=keep_links.KEEP_LINKS
            )
        )

    def test_a_jump_link_lands_on_the_page_of_its_target(self):
        pdf = keep_links.keep_links_pdf(
            html=_page_with_a_jump(3, "item-photo-X"), options={}, pdf_generator=keep_links.KEEP_LINKS
        )

        self.assertEqual(len(PdfReader(io.BytesIO(pdf)).pages), 3)
        self.assertEqual(_jumps(pdf), [(0, 2)])

    def test_a_merge_points_each_sections_links_at_its_own_pages(self):
        merged = keep_links.LinkedPdf()
        merged.append(keep_links.html_to_pdf_keeping_links(_page_with_a_jump(2, "a")))
        merged.append(keep_links.html_to_pdf_keeping_links(_page_with_a_jump(3, "b")))

        # Section one is pages 0-1, section two pages 2-4.
        self.assertEqual(sorted(_jumps(merged.to_bytes())), [(0, 1), (2, 4)])
