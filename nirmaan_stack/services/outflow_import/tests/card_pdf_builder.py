# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A test-only PDF of the card statement fixture, so the tests upload a PDF, as the endpoint receives one.

The real statement PDF never enters the repo. This writes the fixture's text, one PDF text line per
line, in Helvetica with WinAnsi encoding (the fixture's only non-ASCII characters, `Á` and `©`, are
Latin-1), so `pypdf` reads the same lines back. `password` locks it, as the bank's own file is locked;
`owner_password` alone encrypts it with an empty user password (it opens without one, as some banks send).
"""

import io

from pypdf import PdfReader, PdfWriter

_LINES_PER_PAGE = 70


def _escape(line: str) -> bytes:
    raw = line.encode("latin-1")
    return raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def pdf_from_text(text: str, password: str | None = None, owner_password: str | None = None) -> bytes:
    lines = text.replace("\f", "\n").split("\n")
    pages = [lines[i : i + _LINES_PER_PAGE] for i in range(0, len(lines), _LINES_PER_PAGE)] or [[]]
    objects: list[bytes] = []

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)

    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    page_ids = []
    pages_id = len(objects) + 1 + 2 * len(pages)
    for page_lines in pages:
        stream = b"".join(
            b"BT /F1 8 Tf 20 %d Td (%s) Tj ET\n" % (820 - 11 * index, _escape(line))
            for index, line in enumerate(page_lines)
        )
        content = add(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream))
        page_ids.append(
            add(
                b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595 842] /Contents %d 0 R "
                b"/Resources << /Font << /F1 %d 0 R >> >> >>" % (pages_id, content, font)
            )
        )
    kids = b" ".join(b"%d 0 R" % page for page in page_ids)
    assert add(b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, len(page_ids))) == pages_id
    catalog = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id)

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n%s\nendobj\n" % (number, body))
    xref = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1))
    for offset in offsets:
        out.write(b"%010d 00000 n \n" % offset)
    out.write(b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, catalog, xref))
    content = out.getvalue()
    if not password and not owner_password:
        return content
    writer = PdfWriter(clone_from=PdfReader(io.BytesIO(content)))
    writer.encrypt(password or "", owner_password=owner_password)
    locked = io.BytesIO()
    writer.write(locked)
    return locked.getvalue()
