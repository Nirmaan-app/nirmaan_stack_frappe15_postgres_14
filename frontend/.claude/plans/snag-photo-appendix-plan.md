# Snag List PDF — photo pages at the end (plan, 2026-10-08)

Follow-up to `snag-attachments-plan.md` (one photo per snag, 50×50 thumbnail column). That slice is
still uncommitted and its print format is not yet pasted into the DB, so this one rides the same paste.

## 1. What is asked

After the last category page of the **full report**, add **photo pages**:

1. A page header (the running Nirmaan header already repeats on every page) plus a banner:
   **PROJECT** on the left, **PHOTOS · n** on the right.
2. The snag photos as a **grid, 4 per row**, at a readable size (not the 50×50 thumbnail), uncropped.
3. **Clicking the thumbnail in a snag row jumps to that photo** in the grid. A link under each grid
   photo jumps back to its row.

The Master Summary (`mode=master`) and "Summary only" downloads get no photo pages.

## 2. Layout

```
[ running header: logo · company · address ─────────────── ]
┌▌ PROJECT                              │ PHOTOS          ┐
│  <project name>                       │ 320             │
└──────────────────────────────────────────────────────────┘
ELECTRICAL · 12 PHOTOS
┌─────────────┬─────────────┬─────────────┬─────────────┐
│ ┌─────────┐ │ ┌─────────┐ │ ┌─────────┐ │ ┌─────────┐ │
│ │  photo  │ │ │  photo  │ │ │  photo  │ │ │  photo  │ │
│ └─────────┘ │ └─────────┘ │ └─────────┘ │ └─────────┘ │
│ S.No 2 [Completed]  │ S.No 5 [WIP]                    │
│ Food Box - General  │ Lobby                           │
│ LED light drivers…  │ …                               │
│ ↑ Row · Full size · Map                                │
└─────────────┴─────────────┴─────────────┴─────────────┘
PLUMBING · 4 PHOTOS
…
```

- **Starts on a new page** after the last category page. Only rendered when at least one printed
  snag has a photo, so a report with no photos gets no blank page.
- **Grouped by category, in the same order as the category pages.** Groups FLOW one after another;
  no page break per category. The category label is the first row of its grid table, so it can't be
  left alone at the bottom of a page.
- **Which photos:** every printed snag (same filters as the rest of the report) that has a photo,
  whatever its status. Order inside a category = the table's order (area → source row).
- **Cell:** the photo in a square box (~45 mm), **padded, not cropped**. A defect at the edge of the
  photo must not be cut off. Below it:
  - **S.No** (the same number the row shows) and the status badge;
  - **Area**;
  - **Description**, cut to ~70 characters;
  - links: **↑ Row** (jump back), **Full size** (opens the original; needs a login), **Map** (only when
    the photo has a location).
- **About 4 rows per page, so 16 photos per page.** 320 photos come to ~20 pages.
- **A photo that could not be fetched** keeps its cell, with a grey "Photo unavailable" box and the
  Full size link. Its row's jump link still lands on that cell.
- **Snag table change:** the thumbnail's link now goes to the grid cell instead of the full-size URL.
  Full size moves to the grid caption. The table's "Map" link stays.

wkhtmltopdf's WebKit has no flex, grid or `object-fit`. So the grid is a `<table>` with 4 fixed 25%
cells, and the padding to a square is done server-side.

Trap from the Vendor Ledger work: do not wrap cell contents in `<div>`s. Frappe's
`table td div { page-break-inside: avoid }` then pushes rows down at random. Use spans and `<br>`.

## 3. Click-to-jump: two Frappe obstacles (verified 2026-10-08)

Probed in the dev container (wkhtmltopdf 0.12.6.1, pypdf 6.13.3):

1. **`scrub_urls` turns `href="#ph-X"` into `http://localhost:8000/#ph-X`.** That makes it a
   website link, not a jump. (`frappe/utils/data.py` `expand_relative_urls`.)
2. **`get_pdf` re-saves every PDF through pypdf** (`writer.append_pages_from_reader(reader)`), and
   that drops the catalog's `/Dests`. Raw wkhtmltopdf output **does** have the jump targets; Frappe's
   output does not. So **no Frappe PDF can carry a working in-document link today**, whatever the
   template does.
3. **Download All:** pypdf `append` keeps the links and their names, but after the merge the targets
   no longer point at a page of the merged file (`get_destination_page_number` → None). `add_page`
   (what `bulk_download.py` uses now) loses them completely.

**Fix, without touching Frappe:** `get_print` already supports a `pdf_generator` hook. When the
request carries `pdf_generator=<value>` other than `wkhtmltopdf`, it hands the HTML to the app's hook
before falling back to `get_pdf` (`frappe/utils/print_utils.py`).

- New hook `nirmaan_stack.api.snags.print_pdf.keep_links_pdf`. It answers only to
  `pdf_generator == "nirmaan_keep_links"` and returns None otherwise, so every other print is untouched.
  It does what `get_pdf` does, minus the pypdf re-save:
  - protect fragment-only `href="#…"` from `scrub_urls`;
  - `prepare_options` (header extraction, margins);
  - the same `disable-javascript` / `disable-local-file-access` / smart-shrinking flags;
  - pdfkit, then `cleanup`;
  - the same "missing image" tolerance.
  It reuses `frappe.utils.pdf`'s own `scrub_urls`, `prepare_options` and `cleanup`, so it does not
  drift from Frappe.
- **Single Download:** the frontend adds `pdf_generator=nirmaan_keep_links` to the existing
  `download_pdf` URL. One query param, same endpoint.
- **Download All:** `_render` sets the same value. Each section's pages are appended and every
  named target is re-pointed to its merged page (section page offset + source page index).
  wkhtmltopdf names each target after its own temp file, so names never collide across sections.
- **Fallback:** a Desk print or Desk PDF of this format goes through the normal path. There the links
  open the site home page: harmless. If the hook route fails in the browser check, the plan still
  ships the grid, with S.No + Area as the cross-reference on paper.

## 4. Changes

| File | Change |
|---|---|
| `api/snags/print_photos.py` | Same single download per photo, **two encodes**: the 150 px square `thumb` (unchanged) plus a new `grid`, padded to a `GRID_PX` square (start at 400 px, JPEG q70; see §5). JPEG `draft` targets the larger size. The return dict gains `grid`. The Jinja signature is unchanged. |
| `api/snags/print_pdf.py` (new) | `keep_links_pdf` hook (§3) + `merge_keeping_links(pdfs)` for Download All. |
| `hooks.py` | `pdf_generator = ["nirmaan_stack.api.snags.print_pdf.keep_links_pdf"]`. |
| `api/snags/bulk_download.py` | Render with `pdf_generator=nirmaan_keep_links`; merge via `merge_keeping_links` instead of `add_page`. |
| `frontend/.../download/snagDownloadConstants.ts` (or `snagDownloadParams.ts`) | Add the `pdf_generator` param to the single Download URL. |
| `snag-printformat.html` (DB paste + mirror; fixture kept identical, as in the last slice) | Row anchor in the S.No cell; thumbnail `href="#ph-<snag>"`; new section 4.7 (photo pages); CSS for `.photos-page`, `.photo-grid`, the caption and the placeholder. The data comes from the existing `cat_index` + `snag_photos`, with no new query. |

No schema, no new doctype, no migrate. The `hooks.py` change needs a bench restart.

## 5. Size and time budget

Baseline from the last slice: BENGALURU-PROJ-00103, 733 snags, 320 photos → 2.9 MB, 17 s (8.2 s of
it fetching photos).

- **Estimate:** a 400 px padded JPEG ≈ 25–35 KB, so +8–11 MB for 320 photos, plus a few seconds of
  encoding. Downloads stay one per photo.
- **Budget: ≤ 15 MB and ≤ 45 s for that project.** If the measurement exceeds it, lower `GRID_PX`
  (360) or the quality before shipping. 360 px across 45 mm is still ~200 dpi.
- **Download All** renders each batch separately, so its total stays about the same as one big
  render. It runs as a synchronous request, so its time goes into the measurement too.

## 6. Test plan (try to break it)

Rolled-back tests, own fixtures only, no suite sweep:

- `print_photos`: a reachable photo gives both `thumb` and a `GRID_PX` square `grid`; an unreachable
  one gives neither and logs once.
- Padding: a tall portrait (9:16) and a wide panorama come out square and uncropped, with the whole
  image inside.
- `keep_links_pdf`: a 2-page HTML with an anchor gives a PDF whose link resolves to page 2. Any other
  `pdf_generator` value returns None.
- `merge_keeping_links`: 2 sections, each with its own anchor, give each link landing on its OWN
  section's page (offset correct), not the first section's.

Real-data render (in-memory format swap, no DB write, per the render harness):

- BENGALURU-PROJ-00103: size, time, page count against §5.
- Filters: area / status / search narrow the photo pages exactly like the table.
- Edge cases:
  - 0 photos gives no photo page;
  - a category with no photos gives no heading;
  - an N/A snag with a photo appears when N/A is in scope;
  - two snags sharing one file (Frappe dedups identical bytes) are fetched once and shown twice, with
    distinct anchors;
  - a failed fetch shows a placeholder and its jump still lands.

Viewer check (owner's test login, incognito):

- Click a thumbnail → photo, then ↑ Row → back, in **Chrome's PDF viewer** and **one phone viewer**.
  Some in-app previews (e.g. WhatsApp) don't follow in-document links; the grid still reads fine there.
- Done for both single Download and Download All.

## 7. Defaults taken

| # | Default | Why |
|---|---|---|
| D1 | Grouped by category, flowing (no page per category) | Matches the table's order; saves ~1 page per category |
| D2 | Padded square, never cropped | Evidence photo: the defect may be at the edge |
| D3 | Caption = S.No, status, area, cut description, links | Enough to identify the row on paper; no new numbering |
| D4 | Thumbnail jumps to the grid; Full size moves to the grid | One click target per place |
| D5 | `GRID_PX` 400, tuned down only if over budget | Sharp at ~45 mm; PDF size is the cost |

## 8. Not in this slice

- More than 4 per row, or a per-row size choice.
- Photo pages in the Master Summary.
- Thumbnails/grids for Desk prints of this format (they work, only the jump links don't).
- Making Frappe's own `get_pdf` keep links app-wide.

---

## 9. As-built (2026-10-08, branch `develop`, uncommitted, unstaged)

Owner said "go ahead" on the plan and the diagram page.

**Changed:**
- `api/snags/print_photos.py`: `encode_photo` (pure) makes both copies from one download.
  The grid copy is `ImageOps.pad` to 400 px, JPEG q70, padded with #F3F4F6.
  The return dict gains `grid`.
- `api/snags/print_pdf.py` (new):
  - `keep_links_pdf` (the `pdf_generator` hook, answers only to `nirmaan_keep_links`; a password
    print returns None);
  - `html_to_pdf_keeping_links`;
  - `append_keeping_links`.
- `hooks.py`: `pdf_generator = [...]`.
- `bulk_download.py`: `form_dict["pdf_generator"]` is set per render; it merges via
  `append_keeping_links`.
- Frontend: the `pdf_generator` param goes on the single Download URL (`snagDownloadConstants.ts`,
  `snagDownloadParams.ts`).
- Print format:
  - jump-target ids on the S.No cell and the grid cell;
  - the thumbnail jumps to the grid;
  - section 4.7 (photo pages).
- The mirror and `fixtures/print_format.json` are identical (only the `html` line changed). The DB
  still has the photo-column version: **the owner pastes the mirror into Desk**.

**Deviations from the plan, all measured:**
- **wkhtmltopdf 0.12.6 never places an empty `<a name="x"></a>`.** Its target points at the top of
  page 1. So the ids sit on cells that have content.
- **wkhtmltopdf writes a target's page as a NUMBER, not a page reference.** So the generator DOES a
  pypdf re-save. It copies `/Dests` and rewrites each target as a real page reference. Cost ~1 s.
- **An inline `<a>` around a `display:block` image has no box.** wkhtmltopdf then puts its click area
  on page 1 with zero size. Fixed by making the links blocks (`.photo-jump`, `.grid-link`).
- **Frappe forces `td { padding: 6px !important }` and a 9pt font.** With those, only 3 rows fit a
  page. Overridden on `.print-format .photo-row td`, so 4 rows (16 photos) fit, as planned.

**Verified:**
- `test_snag_print` 6/6:
  - the padding, tall and wide;
  - the cropped thumbnail;
  - the generator gate;
  - a jump landing on the right page;
  - a 2-section merge landing in its own section.
- `test_snag_api` print test: OK, with `grid` asserted.
- No leftovers. One render-caused Error Log, a GCS read timeout, was deleted.
- In-memory renders, no DB write:
  - ERNAKULAM-PROJ-00203 (6 real photos): all 12 jumps correct both ways.
  - BENGALURU-PROJ-00103 (733 snags, 320 injected DPR photos), single Download: 7.9 MB, 86 pages
    (21 of them photo pages), 25–40 s. The spread is mostly GCS fetch time: 11–16 s for photos.
    All 640 jumps were correct and every round trip matched.
  - The same project through Download All (master + 3 batches): 8.2 MB, 107 pages, 29 s,
    640/640 jumps inside their own section.
  - Frappe's own path on the same content takes 33.6 s: the photo pages cost wkhtmltopdf time,
    the generator ~1 s.
- tsc: 0 errors in the changed files.
- `residence_check`: F5 122/117 is pre-existing. The changed files add no `updateDoc`.

**Not verified:** clicking in a real PDF viewer (Chrome, phone). That needs the owner's test login.

---

## 10. Revision 2 (owner, 2026-10-08 evening): leaner photo pages + a signed "Full size" link

### 10.1 What the owner asked for
1. **"Full size" fails.** The link is the private-file URL (`generate_file`), which needs a login on the
   same site address. Without one it returns 403. A PDF opened on a phone, from WhatsApp, or by a client
   never has that login. On localhost it also points at `127.0.0.1:8000` while the login is on
   `localhost:8080`. **Owner chose the signed no-login link (option B).**
2. **No category names** on the photo pages: banner, then the grid.
3. **3 photos per row.**
4. **Caption = `↑ Row · Full size` only.** S.No, status, area, description and Map are removed (Map stays
   in the table's Attachment column).
5. **Download All: ONE photo section at the very END of the whole PDF**, not one per file. Photos follow
   the PDF's order: file 1's, then file 2's, and so on.

### 10.2 Signed link (`api/snags/photo_link.py`, new)
- **URL:** `/api/method/nirmaan_stack.api.snags.photo_link.open_photo?f=<File name>&s=<signature>`.
- **Signature:** HMAC-SHA256 of the File name.
  - The key is derived from the site's EXISTING `encryption_key` plus a label and `LINK_VERSION`.
    So no new secret is stored anywhere, and bumping `LINK_VERSION` (a deploy) kills every old link.
  - The check is constant-time (`hmac.compare_digest`).
- **`open_photo`:** guest, GET only, rate-limited per IP. It opens the photo only when ALL hold:
  - the signature is valid;
  - the File is attached to a Project Snag;
  - it is STILL that snag's photo. A replaced or removed photo's link stops working: that is how one
    photo's link is revoked.

  Then it redirects to a fresh GCS signed URL, which expires after the bucket's
  `signed_url_expiry_time` (120 s default). Every failure shows the same plain "link not valid" page,
  so it never reveals whether a file exists.
- `snag_print_photos` builds the link (one File query per render). With no File row, there is no Full
  size link.

### 10.3 Photo pages
- **Single Download:** report, then the photo pages, in the PDF's order (category pages order).
- **Download All:** master, then each file's report (`photo_pages=0`, no photo pages), then ONE
  `mode=photos` render covering the rendered files in import order.
- **Links across renders:** wkhtmltopdf DROPS a link whose target is not in the same render (tested). So:
  - a file section gives each thumbnail a self-target;
  - the photo render gives each "↑ Row" a self-target;
  - `append_keeping_links` renames every target to its bare `#fragment`, real targets beat self-targets,
    and the merged links point at the real ones.
- **Cost:** a request-level cache in `snag_print_photos` means each photo is downloaded once per Download
  All, not once per render. If the photo render contains no photo, it is not appended, so no blank page.
- **Layout:** 3 per row, each photo about 52 mm square, about 12 per page.

### 10.4 Leaks and breaches (owner asked)
- **What B exposes:** a full-size snag photo, to whoever holds a PDF containing it. They already see a
  400 px copy in that PDF.
- **What B does not expose:** any other file or data.
  - The link cannot be forged or edited (HMAC).
  - The GCS storage key no longer appears in the PDF (today's link prints it).
- **Pre-existing finding, separate from B:** `frappe_gcp_attachment.controller.generate_file` signs ANY
  storage key for ANY logged-in user, with no check that they may see that file. Not changed in this
  slice: it is reported to the owner.

### 10.5 As-built (revision 2, 2026-10-08, uncommitted, unstaged)
- **New:** `api/snags/photo_link.py`: `signed_photo_url` + guest `open_photo`, rate-limited 120/min per IP.
- **`print_photos`:**
  - `url` = the signed link, found through one raw-SQL File lookup (no `get_all` IN list);
  - a request cache: `frappe.local.snag_print_photo_cache`. Failures are cached too.
- **`print_pdf`:** `LinkedPdf` replaces `append_keeping_links`.
  - Targets are renamed to bare fragments.
  - `stubs=` self-targets never replace a real target.
  - `jump_targets(pdf)`.
- **`bulk_download`:**
  - batch renders use `photo_pages="0"` and `stubs=("snag-photo-",)`;
  - then one `mode=photos` render over the RENDERED batches, appended with `stubs=("snag-row-",)`,
    and only if it holds a `snag-photo-` target;
  - a failed photo render is logged and skipped.
- **Print format:**
  - params `mode=photos` and `photo_pages=0`;
  - 3 per row, no headings, `↑ Row · Full size` only;
  - self-target ids are added only in the split renders;
  - invisible `.target-ref` self-links.
  - Mirror == fixture (`html` line only). The **DB paste is pending**.
- **New wkhtmltopdf fact (measured):** a target is written ONLY if a link in the SAME render points at
  it. The real targets that only another render links to (rows in a file section, photos in the photo
  render) each get an invisible `&nbsp;` self-link.

**Verified:**
- `test_snag_print` 7/7 (adds the cross-render round trip).
- `test_snag_api`: the print test plus 2 new signed-link tests. The second covers a forged signature,
  a missing signature, an unknown file, a signed non-snag file, and a replaced photo. All OK.
- No leftovers.
- **HTTP, guest:**
  - a valid link: 302 to `storage.googleapis.com`, then 200 `image/jpeg`;
  - a tampered link: 404 "This photo link is not valid…";
  - 130 rapid bad requests: 117×404, then 13×429.
- **Renders:**

  | Project | Download | Size | Time | Pages | Jumps | Full size links |
  |---|---|---|---|---|---|---|
  | ERNAKULAM | single | 1.19 MB | 10 s | 61 | 6/6 | 12 |
  | ERNAKULAM | Download All | 1.39 MB | 13 s | 70, photos on the last page only | 6/6 | 12 |
  | BENGALURU, 320 injected | Download All | 7.7 MB | 36 s | 106, photos pp. 80–106 | 320/320 across renders | — |
  | BENGALURU, 320 injected | single | 7.4 MB | 26 s | 92 | 320/320 | — |

  The photo render takes 0.0 s of photo fetching (cache). 12 photos per page.

---

## 11. Revision 3 (owner, 2026-10-08 late): no Full size; photos per category

**Owner decisions:**
1. No Full size link in the PDF. Clicking a photo jumps back to its snag row, and there is no caption
   text.
2. Photos are not gathered at the end any more. **Each category's photos start on the page right after
   that category's table**: 3 per row, under a "PHOTOS · n" label (no category name).

**Removed:**
- `api/snags/photo_link.py` (the signed link). Its full design and code are kept in
  `snag-photo-signed-link-design.md`, for reuse.
- The `url` value and File lookup in `print_photos`.
- The per-request photo cache in `print_photos`.
- From the print format: the end-of-PDF photo section, `mode=photos` and `photo_pages=0`, the
  self-target ids, and the invisible `.target-ref` links.
- From `bulk_download`: the final photos render.
- From `print_pdf`: `LinkedPdf` stubs and `jump_targets`.
- Tests: the 2 signed-link tests and the cross-render test.

**Why it is simpler now:** a thumbnail and its photo are always in the SAME render, and wkhtmltopdf
drops a link whose target is in another render. `LinkedPdf` only re-points targets when Download All
merges its sections.

**Verified:**
- `test_snag_print` 6/6; the print test passes.
- Renders, in-memory template swap:

  | Project | Download | Pages | Size | Time | Jumps |
  |---|---|---|---|---|---|
  | ERNAKULAM (16 photos) | single | 65 | 1.38 MB | 9 s | 16/16 round trips |
  | ERNAKULAM | Download All | 76 | 1.57 MB | 11 s | 16/16 |
  | BENGALURU (320 injected) | single | 92 | 7.35 MB | 40 s | 320/320 |
  | BENGALURU | Download All | 107 | 7.6 MB | 31 s | 320/320 |

  0 Full size links and 0 broken links in every render.
- Visual check: an Electrical table page is followed by a "PHOTOS · 3" page.

**Open:** the localhost DB still holds the revision-2 HTML (with Full size), so the owner needs to paste.
The mirror equals the fixture.

**Later the same day:**
- The PDF's Map link was removed (owner). `print_photos` no longer returns `map`, and the print format
  no longer fetches `location`.
- The photo-page label became one line: `<CATEGORY> · n photo(s)` on the left, with a grey hint on the
  right, "Click a photo to go to its snag row". It is a two-cell table with the forced td padding
  overridden.
- Render check (EXL Kochi, now 23 photos): 23/23 round trips, 0 broken links, singular "1 PHOTO"
  correct.
- **Bug fixed:** the single Download failed with FrappeTypeError.
  - **Cause:** since 13:00 the frontend added `pdf_generator=nirmaan_keep_links` to Frappe's
    `download_pdf` URL, and that endpoint types the argument as `Literal["wkhtmltopdf", "chrome"]`.
  - **Why it was missed:** tests called the function directly (no web type-check), and Download All
    uses our own endpoint.
  - **Fix:** a new `bulk_download.download_snag_pdf` (GET) sets the generator inside `_render`. The
    permission is unchanged: `get_print` checks read or print. The frontend single URL now points to it.
  - **Verified:** browser-style calls with the DB format (All tab 23/23 jumps, one file tab 6/6,
    Summary only OK), a new test `test_the_single_download_builds_a_pdf_that_keeps_its_jump_links`,
    and tsc clean on the changed files.
- The photo-page header is now `<CATEGORY> · n PHOTOS` in black bold, followed by
  "(Click a photo to go to its snag row)" in small grey.
- **The jump-link PDF step is now SHARED** (owner: other print formats will want content jumps too).
  `api/snags/print_pdf.py` moved to `api/pdf_helper/keep_links.py`, with a "HOW TO USE IT IN ANOTHER
  PRINT FORMAT" guide in its docstring. The `pdf_generator` hook in `hooks.py` points there. Its
  tests moved to `api/pdf_helper/test_keep_links.py`; `test_snag_print.py` keeps the photo-copy
  tests. Verified: 3 + 3 + 2 tests OK, and single Download and Download All give 24/24 photo jumps.
  (Earlier entries in this file that say `print_pdf.py` mean this module.)
