# Signed "Full size" photo link: design record

**Status:** built, tested and then **removed** on 2026-10-08. The owner no longer wants a Full size link in
the Snag List PDF. This file keeps the design and the exact code, so it can be restored or reused when a
future requirement needs one.

**Reuse it when:** someone **without a login**, such as a client, a phone PDF viewer or a forwarded PDF,
must open a **private** file through a link printed in a document.

Related: `snag-photo-appendix-plan.md` (§10 has the PDF photo pages and the owner's Option B choice),
`snag-attachments-plan.md` (one photo per snag).

---

## 1. The problem it solved

A snag photo is a private file in Google Cloud Storage (GCS). Its stored address is
`/api/method/frappe_gcp_attachment.controller.generate_file?key=<storage key>`.

- That endpoint opens only for someone **logged in on the same site address**. Everyone else gets
  HTTP 403 "Login to access".
- A PDF is opened from Downloads, a phone, WhatsApp or by a client, usually **without** that login, so a
  "Full size" link built on the stored address failed.

The owner was offered two options:

| Option | How | Trade-off |
|---|---|---|
| A. Login-only | keep the stored address | fails on phones, WhatsApp, and for clients |
| **B. Signed link (chosen)** | our own public endpoint plus a signature | anyone holding the PDF can open those photos at full size; they already see a 400 px copy in the PDF |

---

## 2. How it worked

### 2.1 Two links; only the second expires

| | Link 1: printed in the PDF | Link 2: made at click time |
|---|---|---|
| Example | `https://<site>/api/method/nirmaan_stack.api.snags.photo_link.open_photo?f=eccb900367&s=f745…40f5` | `https://storage.googleapis.com/<bucket>/<key>?X-Goog-Date=…&X-Goog-Expires=300&X-Goog-Signature=…` |
| Created | once, when the PDF is built | fresh on **every click**, by our server |
| Expires | never | after the bucket's `signed_url_expiry_time` (300 s on localhost) |
| Points to | our server | GCS |

```
click Link 1 (any time later)
   ↓
open_photo: is the signature valid? is it still this snag's current photo?
   ↓ yes
GCS signed URL made NOW, valid 300 s → 302 redirect
   ↓
GCS → 200 image/jpeg
```

**Measured:** the same Link 1, clicked twice 3 s apart, gave two different Link 2s (created 09:46:20 and
09:46:23 UTC, each valid 300 s, different signatures).

### 2.2 Anatomy of Link 1

| Part | Meaning |
|---|---|
| `/api/method/nirmaan_stack.api.snags.photo_link.open_photo` | Frappe's address for the `open_photo` function |
| `f` | the photo's **File record name**: a random Frappe ID, not the storage key |
| `s` | HMAC-SHA256 signature of `f`, 64 hex characters |

`f` names the **file**, not the snag, on purpose. A replaced photo is a new File, so old links point to
the old file and die at check 4 below. The link means "the photo that was printed".

### 2.3 The signature (`_signature`)

```
key = HMAC_SHA256(site encryption_key, "nirmaan-snag-photo-link-v{LINK_VERSION}")   # purpose-only key
s   = HMAC_SHA256(key, f).hexdigest()
```
- **No new secret.** The site's existing `encryption_key` is used, and the label scopes it to this one
  purpose.
- **No date in the signature,** so the link never expires. Signatures are deterministic: all 6 links in a
  14:01 PDF matched signatures recomputed at 15:14.
- **`LINK_VERSION`:** bump it and deploy, and every printed link dies at once.
- **Never rotate `encryption_key` to revoke links.** Frappe also uses it for stored passwords.

### 2.4 The endpoint (`open_photo`)

```python
@frappe.whitelist(allow_guest=True, methods=["GET"])   # no login; GET only
@rate_limit(limit=120, seconds=60)                      # per IP, then HTTP 429
```

**Checks, in order** (`_photo_file`). Any failure shows the same plain 404 page "Photo not available":

| # | Check | Why |
|---|---|---|
| 1 | `f` and `s` are present and are strings | junk in, out fast |
| 2 | `hmac.compare_digest(s, _signature(f))` | stops forged or edited links. Runs **before** any DB lookup, so probing can't reveal which files exist. The comparison takes constant time, so timing can't leak the signature. |
| 3 | the File exists, `attached_to_doctype == "Project Snag"`, and has a URL | a signed ID of any other file is refused |
| 4 | `Project Snag.attachment == File.file_url` | a replaced or removed photo, or a deleted snag, kills the link |

**Response, by stored address:**

| Stored `file_url` | Response |
|---|---|
| contains `frappe_gcp_attachment.controller.generate_file` (production) | read `key` and `file_name` from it → `GCPOperations().get_url(key, file_name)` → 302 |
| public file | 302 to `get_url(file_url)` |
| private file on local disk (site without the bucket; tests) | send the bytes, `response.type = "download"` |

### 2.5 How the site address got into Link 1

`signed_photo_url` → `frappe.utils.get_url(path)` (`frappe/utils/data.py:1603`), in this order:
1. `host_name` in site config, if set;
2. otherwise the **current request's** `Host` header, with `https://` only if `X-Forwarded-Proto: https`;
3. with no request (a background job): protocol + site name;
4. on a dev bench (not production mode), `:webserver_port` is appended.

Consequences:
- The address is **frozen into the PDF** at download time.
- On the localhost dev setup, the Vite proxy rewrites `Host` to `127.0.0.1:8000`, so links said
  `http://127.0.0.1:8000/...` and got 404 "127.0.0.1 does not exist". The site is named `localhost`.
  Fix for dev: `bench --site localhost set-config host_name "http://localhost:8080"`.
- If PDFs ever move to a background job, set `host_name` in production, or links will carry the bare
  site name.

---

## 3. Security properties

| Property | Status |
|---|---|
| Forge or edit a link | impossible without the server key (HMAC) |
| Use a signed ID of a non-snag file | refused (check 3) |
| Open a replaced or removed photo | refused (check 4); this is how one photo's link is revoked |
| Storage key or credentials in the PDF | none; Link 2 is signed with the current storage key at click time, so storage-key renewal never breaks old PDFs |
| Copied Link 2 | dies after 300 s |
| Flooding | 120 requests/min per IP, then 429 (measured: 130 bad requests → 117×404, 13×429). The rate limiter does nothing outside a web request, so tests can call `open_photo` directly. |
| Probing whether a file exists | same 404 for every failure |
| Who opened it | unknown (no login); only the IP in the server access logs |
| Expiry | none (owner decision). Revoke one photo by replacing it; revoke all with `LINK_VERSION`. |
| Forwarded PDF | the recipient can open Full size (by design) |

---

## 4. Verified before removal

- **Unit tests** (`test_snag_api.py`):
  - `test_a_signed_photo_link_opens_the_snags_photo_without_a_login`;
  - `test_a_signed_photo_link_is_refused_when_forged_or_no_longer_the_snags_photo`: flipped signature,
    missing signature, unknown file, signed non-snag file, replaced photo;
  - the print test asserted `url` is a signed link and never a `private/files` URL.
- **HTTP as a guest, localhost:**
  - valid link → 302 to `storage.googleapis.com` → 200 `image/jpeg` (60,218 bytes);
  - tampered link → 404 page "This photo link is not valid…";
  - rate limit as above.
- **Real PDFs:** 12 signed links in single Download and Download All (6 photos), and links from a downloaded
  PDF still opened 70 minutes later.
- **Not covered by automated tests:** the GCS redirect branch. The suite keeps test photos local through
  `ignore_gcs_upload_for_doctype`, so only the HTTP check exercised it.

---

## 5. The code, exactly as it was

### 5.1 `nirmaan_stack/api/snags/photo_link.py` (whole file)

```python
"""Signed "Full size" links for snag photos: they open WITHOUT a login.

WHY: the Snag List PDF goes to clients and site teams, mostly on phones. A photo's own URL
(`frappe_gcp_attachment...generate_file`) needs a login on the same site address, so "Full size"
in a PDF opened from WhatsApp, a phone's PDF viewer or by a client returned 403. The owner chose a
signed link over login-only (2026-10-08).

HOW IT STAYS SAFE:
  - the link carries the photo's File name plus an HMAC-SHA256 signature of it. The key is derived
    from the site's EXISTING `encryption_key` (nothing new is stored), so a link can be neither
    forged nor edited to open another file;
  - `open_photo` opens a File only while it is STILL its snag's photo: replacing or removing the
    photo kills that photo's link;
  - it answers with a redirect to a short-lived GCS signed URL (the bucket's
    `signed_url_expiry_time`), so the storage key never appears in the PDF;
  - every refusal is the same page, so it never tells whether a file exists;
  - it is rate-limited per IP.
Bump LINK_VERSION to kill every link already printed (takes a deploy).
"""

from __future__ import annotations

import hashlib
import hmac
import urllib.parse

import frappe
from frappe.rate_limiter import rate_limit
from frappe.utils.password import get_encryption_key

from nirmaan_stack.api.pdf_helper.pdf_merger_api import fetch_attachment_content

LINK_VERSION = 1

_ENDPOINT = "/api/method/nirmaan_stack.api.snags.photo_link.open_photo"
_GCS_PROXY = "frappe_gcp_attachment.controller.generate_file"


def signed_photo_url(file_name: str) -> str:
    """The absolute "Full size" link for one snag photo's `File`."""
    query = urllib.parse.urlencode({"f": file_name, "s": _signature(file_name)})
    return frappe.utils.get_url(f"{_ENDPOINT}?{query}")


def _signature(file_name: str) -> str:
    # A key of its own, derived from the site secret: these links can never be mistaken for, or
    # used as, anything else signed with it.
    key = hmac.new(
        get_encryption_key().encode(),
        f"nirmaan-snag-photo-link-v{LINK_VERSION}".encode(),
        hashlib.sha256,
    ).digest()
    return hmac.new(key, file_name.encode(), hashlib.sha256).hexdigest()


@frappe.whitelist(allow_guest=True, methods=["GET"])
@rate_limit(limit=120, seconds=60)
def open_photo(f=None, s=None):
    """Open the photo behind a signed link, or show one plain "not valid" page."""
    file = _photo_file(f, s)
    if file is None:
        frappe.respond_as_web_page(
            "Photo not available",
            "This photo link is not valid, or the photo has been replaced or removed.",
            http_status_code=404,
            indicator_color="red",
        )
        return

    if _GCS_PROXY in file.file_url:
        from frappe_gcp_attachment.controller import GCPOperations

        query = urllib.parse.parse_qs(urllib.parse.urlparse(file.file_url).query)
        location = GCPOperations().get_url(query["key"][0], (query.get("file_name") or [None])[0])
    elif not file.is_private:
        location = frappe.utils.get_url(file.file_url)
    else:
        # A private file on local disk (a site without the bucket): send the bytes themselves.
        frappe.local.response.filename = file.file_name
        frappe.local.response.filecontent = fetch_attachment_content(file.file_url)
        frappe.local.response.type = "download"
        return

    frappe.local.response.type = "redirect"
    frappe.local.response.location = location


def _photo_file(file_name, signature):
    """The `File` a signed link may open, or None: a bad signature, a file that is not a snag's
    photo, and a photo since replaced or removed all look the same to the caller."""
    if not (isinstance(file_name, str) and isinstance(signature, str) and file_name and signature):
        return None
    if not hmac.compare_digest(signature, _signature(file_name)):
        return None
    file = frappe.db.get_value(
        "File",
        file_name,
        ["file_url", "file_name", "is_private", "attached_to_doctype", "attached_to_name"],
        as_dict=True,
    )
    if not file or file.attached_to_doctype != "Project Snag" or not file.file_url:
        return None
    if frappe.db.get_value("Project Snag", file.attached_to_name, "attachment") != file.file_url:
        return None
    return file
```

### 5.2 `nirmaan_stack/api/snags/print_photos.py`: the parts that built the link

Import, plus a module-docstring paragraph:
```python
from nirmaan_stack.api.snags.photo_link import signed_photo_url

# docstring paragraph:
# "Full size" is a SIGNED link (`photo_link.signed_photo_url`) that opens without a login: the photo's
# own URL needs one, which a PDF opened on a phone or by a client never has.
```

Inside `snag_print_photos(rows)`, after `photos` is built:
```python
    files = _photo_files(photos)
    images = _encoded({p["attachment"] for p in photos.values()})
    result = {}
    for name, p in photos.items():
        thumb, grid = images.get(p["attachment"]) or (None, None)
        file_name = files.get((name, p["attachment"]))
        result[name] = {
            "thumb": thumb,
            "grid": grid,
            "url": signed_photo_url(file_name) if file_name else None,
            "map": p["map"],
        }
    return result
```

The File lookup. It is raw SQL on purpose: a big `IN` list in `get_all` trips sqlparse's 10k-token cap in
production.
```python
def _photo_files(photos) -> dict:
    """`{(snag, file_url): File name}` for the photos' `File` rows. Raw SQL: a project's snags can
    run to thousands, and a list that long in `get_all` trips sqlparse's token cap."""
    rows = frappe.db.sql(
        """
        SELECT name, attached_to_name, file_url FROM "tabFile"
        WHERE attached_to_doctype = 'Project Snag' AND attached_to_name IN %(snags)s
        """,
        {"snags": list(photos)},
        as_dict=True,
    )
    return {(r.attached_to_name, r.file_url): r.name for r in rows}
```

Docstring line for the return value: `url` is the signed "Full size" link (opens without a login), or None
when the photo has no `File` attached to its snag.

### 5.3 Print format "Project Snag": the photo cell with the link (section 4.7)

```html
{% for chunk in photo_cells | batch(3) %}
<table class="photo-row">
    <tr>
        {% for p in chunk %}
        <td id="snag-photo-{{ p.row.name }}">
            {% if p.ph.grid and p.ph.url %}
                <a class="grid-link" href="{{ p.ph.url }}"><img class="grid-photo" src="{{ p.ph.grid }}" alt="Photo"></a>
            {% elif p.ph.grid %}
                <span class="grid-link"><img class="grid-photo" src="{{ p.ph.grid }}" alt="Photo"></span>
            {% else %}
                <span class="grid-missing"><span>Photo unavailable</span></span>
            {% endif %}
            <span class="cap-links"><a {% if is_photos_only %}id="snag-row-{{ p.row.name }}" {% endif %}href="#snag-row-{{ p.row.name }}">&uarr; Row</a>{% if p.ph.url %} &middot; <a href="{{ p.ph.url }}">Full size</a>{% endif %}{% if is_photos_only %}<a class="target-ref" href="#snag-photo-{{ p.row.name }}">&nbsp;</a>{% endif %}</span>
        </td>
        {% endfor %}
        {% for _ in range(3 - chunk | length) %}<td></td>{% endfor %}
    </tr>
</table>
{% endfor %}
```
CSS used: `.cap-links a { font-size: 8px; font-weight: 600; color: #0369A1; text-decoration: none; }`.

The link must sit on a block-level `<a>` (`.grid-link { display: block }`). wkhtmltopdf sizes a link by
the `<a>`'s own box, and an inline `<a>` around a block `<img>` gets a zero-size click area on page 1.

### 5.4 Tests (`nirmaan_stack/api/snags/test_snag_api.py`)

The file imports `urllib.parse` and `from nirmaan_stack.api.snags import ... photo_link ...`.

In `test_the_print_embeds_a_reachable_photo_and_skips_an_unreachable_one`:
```python
        # "Full size" is the SIGNED link to the photo's File, never the private URL itself.
        self.assertIn("photo_link.open_photo?f=", photos[snag]["url"])
        self.assertNotIn("private/files", photos[snag]["url"])
        ...
        self.assertIsNone(photos["SNAG-MISSING"]["url"], "no File, so no Full size link")
```

Helpers and tests:
```python
    def _signed(self, url):
        """`(f, s)` from the signed "Full size" link to the `File` behind `url`."""
        link = photo_link.signed_photo_url(frappe.db.get_value("File", {"file_url": url}, "name"))
        query = urllib.parse.parse_qs(urllib.parse.urlparse(link).query)
        return query["f"][0], query["s"][0]

    def _open_as_guest(self, f, s):
        frappe.local.response = frappe._dict()
        frappe.set_user("Guest")
        try:
            photo_link.open_photo(f=f, s=s)
        finally:
            frappe.set_user("Administrator")
        return frappe.local.response

    def test_a_signed_photo_link_opens_the_snags_photo_without_a_login(self):
        snag = self._a_snag("PhotoLink", "Photo link batch")
        url = self._photo(snag)
        self._details(snag, attachment=url)

        response = self._open_as_guest(*self._signed(url))

        # A LOCAL private file (the suite keeps test photos out of the bucket) is sent as-is;
        # a bucket photo is a redirect to a short-lived signed URL instead.
        self.assertEqual(response.type, "download")
        self.assertTrue(response.filecontent.startswith(b"\xff\xd8"), "the JPEG itself")

    def test_a_signed_photo_link_is_refused_when_forged_or_no_longer_the_snags_photo(self):
        snag = self._a_snag("PhotoLinkRefused", "Photo link refused batch")
        first = self._photo(snag)
        self._details(snag, attachment=first)
        f, s = self._signed(first)
        flipped = s[:-1] + ("0" if s[-1] != "0" else "1")
        not_a_snag_photo = frappe.get_all(
            "File", filters={"attached_to_doctype": ["!=", "Project Snag"]}, pluck="name", limit=1
        )[0]

        for f_, s_ in (
            (f, flipped),
            (f, None),
            ("not-a-file", photo_link._signature("not-a-file")),
            # Correctly signed, but not a snag's photo.
            (not_a_snag_photo, photo_link._signature(not_a_snag_photo)),
        ):
            response = self._open_as_guest(f_, s_)
            self.assertEqual(response.get("http_status_code"), 404, f_)
            self.assertIsNone(response.get("filecontent"), f_)

        # Replaced: the old photo's link dies; the new photo's link works.
        second = self._photo(snag)
        self._details(snag, attachment=second)
        self.assertEqual(self._open_as_guest(f, s).get("http_status_code"), 404)
        self.assertEqual(self._open_as_guest(*self._signed(second)).type, "download")
```

---

## 6. How to restore it

1. Recreate `photo_link.py` from §5.1.
2. Put the §5.2 parts back into `print_photos.py`.
3. Put a `Full size` link back in the print format's photo cell (§5.3), using `{{ p.ph.url }}`.
   Remember the block-level `<a>` rule.
4. Put back the §5.4 tests and run them (targeted, never the whole suite on localhost):
   ```
   bench --site localhost run-tests --module nirmaan_stack.api.snags.test_snag_api \
     --test test_a_signed_photo_link_opens_the_snags_photo_without_a_login \
     --test test_a_signed_photo_link_is_refused_when_forged_or_no_longer_the_snags_photo \
     --test test_the_print_embeds_a_reachable_photo_and_skips_an_unreachable_one
   ```
5. Exercise the GCS branch over HTTP (not covered by the tests): build a link with `signed_photo_url`
   for a real snag photo File, then `curl -I` it. Expect 302 to `storage.googleapis.com`, and the
   redirect target should answer 200 `image/jpeg`.
6. Production: confirm `signed_url_expiry_time`, the nginx `X-Forwarded-Proto`, and either set
   `host_name` or rely on the request host.

## 7. Reusing it for other documents (HOD, invoices, …)

- **Keep:** `_signature` (give it its **own label**, e.g. `nirmaan-hod-file-link-v1`, so links from two
  features can never stand in for each other), the decorators, and the GCS redirect.
- **Change:** checks 3–4 in `_photo_file`, to the new feature's rule: which doctype the File must be
  attached to, and what "still current" means there.
- **Decide with the owner first:** expiry (put a date in the signed text and check it), who may see the
  file, and whether forwarding is acceptable.
