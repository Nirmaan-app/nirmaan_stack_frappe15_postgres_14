# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Page breaks written into library text. PURE.

The owner's O&M manuals are laid out page by page -- the contents list alone on page 1, each later page
opening on a chosen heading (owner 2026-10-06, Electrical). Left to the renderer, the text is cut
wherever a page happens to fill, mid-list or with a heading stranded at the foot. So the author marks
where a new page starts, with Frappe's own page-break element written into the text:

    <div class="page-break"></div>

and the print format prints each piece as its own page. Text without a marker is one piece and prints
exactly as before. A piece longer than a page still runs on to the next -- a marker chooses where a page
STARTS, it never cuts text off.

Not a `[...]` token: square brackets are the library's blanks (`blanks.BLANK_RE`).
"""

import html as html_lib
import re
import unicodedata

PAGE_BREAK = '<div class="page-break"></div>'

# Any div carrying the `page-break` class, empty or holding only whitespace -- the editor is a plain text
# box, so the attribute order, extra classes or a stray space must not stop it from being recognised.
_PAGE_BREAK_RE = re.compile(
	r"<div\b[^>]*\bclass\s*=\s*[\"'][^\"']*\bpage-break\b[^\"']*[\"'][^>]*>\s*</div>",
	re.IGNORECASE,
)


def split_pages(html) -> list:
	"""`html` cut at every page-break marker, empty pieces dropped.

	A marker at the very start or end, or two in a row, would otherwise print a page holding nothing.
	Always at least one piece, so a block with no text still prints the page it always did.
	"""
	text = str(html or "")
	pieces = [p for p in _PAGE_BREAK_RE.split(text) if p.strip()]
	return pieces or [text]


# How a printed page is recognised: the first characters of its text, letters and digits only, so the
# renderer's spacing, bullets, punctuation and ligatures ("ﬂ" for "fl") cannot stop a match. Long enough
# to tell the manuals' titles apart -- they all open "Operation and Maintenance Manual...".
KEY_LEN = 48


def start_key(text) -> str:
	"""The recognisable start of `text` -- library HTML or a page's extracted text alike."""
	plain = html_lib.unescape(re.sub(r"<[^>]+>", " ", str(text or "")))
	plain = unicodedata.normalize("NFKC", plain)
	return "".join(ch for ch in plain if ch.isalnum()).lower()[:KEY_LEN]


def overflowing(blocks: list, page_keys: list) -> set:
	"""The marked blocks whose pages did NOT each print on exactly one sheet.

	`blocks`: in print order, `{"name", "starts": [start_key of each page's first text]}` -- the first
	page's start is its title band. A block with one start (no marker) is a flowing block: it locates
	where the blocks around it end, and is never reported. A trailing `{"name": None, "starts": [...]}`
	marks a page that follows the manual (its pictures).
	`page_keys`: `start_key` of every printed page that holds text, in order.

	A page is found by scanning forward from the last one found, so text repeated on a later page cannot
	be mistaken for an earlier start. A start that cannot be found at all fails its block -- not knowing
	is never read as fitting.
	"""
	found = []  # (block name, page index or None), in print order
	pos = 0
	for block in blocks:
		for key in block["starts"]:
			at = next((j for j in range(pos, len(page_keys)) if key and page_keys[j].startswith(key)), None)
			found.append((block["name"], at))
			if at is not None:
				pos = at + 1
	bad = set()
	for block in blocks:
		if block["name"] is None or len(block["starts"]) < 2:
			continue
		mine = [i for i, (name, _) in enumerate(found) if name == block["name"]]
		pages_at = [found[i][1] for i in mine]
		after = next((found[i][1] for i in range(mine[-1] + 1, len(found)) if found[i][1] is not None), len(page_keys))
		if None in pages_at or any(b != a + 1 for a, b in zip(pages_at, pages_at[1:] + [after])):
			bad.add(block["name"])
	return bad
