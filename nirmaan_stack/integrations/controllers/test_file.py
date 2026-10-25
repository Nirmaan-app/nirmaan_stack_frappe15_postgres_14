"""A damaged PDF upload is refused with a message a person can act on (spec #1528 walk 3, Z1).

Frappe reads every uploaded PDF for scripts (`File.check_content`, `frappe.utils.pdf.pdf_contains_js`); a
file pypdf can't parse made that read raise `PdfReadError`, a raw 500 on the upload (the signed copy of a
generated invoice, and every other upload)."""

import frappe
from frappe.tests.utils import FrappeTestCase


class TestADamagedPdf(FrappeTestCase):
    def _upload(self, content: bytes):
        return frappe.get_doc({
            "doctype": "File",
            "file_name": f"z1-{frappe.generate_hash(length=8)}.pdf",
            "content": content,
            "is_private": 1,
        }).insert(ignore_permissions=True)

    def test_a_pdf_that_cannot_be_read_is_refused_readably(self):
        for content in (b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\n",   # cut off: no xref, no trailer
                        b"a photo saved with a .pdf name"):               # the walk's: "startxref not found"
            with self.subTest(content=content[:12]):
                with self.assertRaisesRegex(frappe.ValidationError, "can't be read"):
                    self._upload(content)

    def test_a_readable_pdf_still_uploads(self):
        import io

        from pypdf import PdfWriter

        writer, out = PdfWriter(), io.BytesIO()
        writer.add_blank_page(width=200, height=200)
        writer.write(out)
        doc = self._upload(out.getvalue())
        self.assertTrue(frappe.db.exists("File", doc.name))
