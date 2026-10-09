# Snag List — one photo per snag (plan, 2026-10-08)

Reverses `snag-list-plan.md` §9 "Closure photos / evidence attachments — NOT in v1".

## 1. What the owner asked for

1. Every snag can carry **one** photo (owner 2026-10-08: "they hold one photo only").
2. The photo can be added from **both** the Edit dialog and the status-change dialog.
3. **Moving a snag to Completed requires the photo.**
4. The photo keeps the **location** it was uploaded from. The table preview shows the location
   and a **directions link** under the image.
5. Snag table: an **Attachment** column with an icon. Hovering it previews the photo.
6. Print format "Project Snag", full report: an **Attachment** column showing the photo as a
   **50×50** thumbnail, with a link.

## 2. Defaults taken (owner to confirm)

| # | Default | Why |
|---|---|---|
| A1 | **REVISED 2026-10-08 (owner removed `exifr`): Take photo = GPS at capture, behind DPR's camera + location permission steps; Upload = NO location.** Original Q7(b) text follows. **Owner chose Q7(b), 2026-10-08.** Two ways to add the photo, each with its own location source. **Take photo** (in-app camera, as in DPR): location = the device's GPS **at the moment of capture**. **Upload** (gallery / file): location = the GPS saved **inside the photo file** (EXIF), if any. Otherwise **no location**. Never the device's position at upload time. In both cases the address is reverse-geocoded with DPR's Map API key, and the link = Google Maps directions to that point. | Upload-time position points at wherever the uploader is sitting (e.g. the office), so the Directions link would be wrong. A wrong link is worse than none. |
| A2 | If camera GPS is denied or times out, or an uploaded file carries no location, the photo is still saved, with no location and no link. The preview reads "Location not available". | The photo is mandatory, so a missing GPS fix must not block Completed. Phones often strip GPS from gallery picks (iOS / Android photo pickers, WhatsApp forwards), so "no location" on Upload will be common. |
| A3 | Images only. Adding a photo when one exists **replaces** it. | One photo per snag. |
| A5 | Admin **bulk** status → Completed **skips** snags with no photo and reports them ("12 updated, 3 skipped — no photo"). | The rule is "Completed needs a photo". Bulk must not be the way around it. |
| A6 | Existing Completed snags with no photo stay as they are and stay editable. The rule fires only (a) on a move **to** Completed and (b) when the photo of a Completed snag is **removed**. Replacing it is fine. | Otherwise every legacy Completed row becomes un-editable. |
| A7 | Project Manager adds or replaces the photo via the **status dialog only**. The Edit dialog stays Admin / PL / PMO, as today. | Owner said "edit and edit status both". PM has never had Edit. |
| A8 | Removing the photo (without replacing it): Edit dialog only, so Admin / PL / PMO. | Follows A7. |
| A9 | No "uploaded by / on" fields. The Version log (`track_changes=1`) already records who set the photo and when. | Smallest schema. |

## 3. Schema — NEEDS APPROVAL (2 fields on the existing doctype, no new doctype)

Owner 2026-10-08: no thumbnail, latitude or longitude fields. The UI and the print render the
photo directly.

New fields on **`Project Snag`**, in a "Photo" section:

| field | type | note |
|---|---|---|
| `attachment` | Attach | private file, compressed client-side (≤1600px JPEG) |
| `location` | Small Text | the **DPR format**: `"<address> (Lat: 12.9716, Lon: 77.5946)"`. Empty when there is no location |

The Directions link reads the Lat/Lon out of `location`. That is the same string DPR's
`CameraCapture` already builds, at 4 decimals (~11 m). If the string has no coordinates, the link
falls back to the address text.

Created through Desk / bench tooling in developer mode, not by hand-writing doctype JSON
(`CODING_STANDARDS.md` § Changing a doctype schema).

## 4. Backend (`nirmaan_stack/api/snags/`, `integrations/controllers/project_snag.py`)

- **Rule, in the existing `before_save`** (it covers every writer, including Desk). Refuse when
  `status == "Completed"` and `attachment` is empty **and** (status changed to Completed **or**
  `attachment` was just cleared). When `attachment` is cleared, also clear `location`.
- `update_snag_status(..., photo=None)`: `photo` = `{attachment, location}`, set in the **same**
  single save as the status. So status and photo
  stay one atomic write.
- `update_snag_details(..., photo=None, remove_photo=False)`: same rule, via the controller.
- `bulk_update_snag_status`: when status is Completed, skip snags without `attachment` and return
  `skipped`.
- The list API fetches both new fields directly (add `attachment`, `location` to
  `SNAG_FIELDS_TO_FETCH`). No extra read call.

## 5. Frontend (`pages/SnagList/`)

- **Shared `SnagPhotoPicker`** (one slot: show current, **Take photo** / **Upload** to replace):
  - **Take photo**: the DPR camera (`components/CameraCapture.tsx`), date/time stamp burned in.
    GPS is read at capture. Its formatted `location` string is stored as-is. It gets one
    additive prop to hide its own remarks box; DPR callers are unaffected.
  - **Upload**: `accept="image/*"`, **no location** (owner removed `exifr`, 2026-10-08).
  - **Take photo is gated like DPR** (`usePermissionCheck`): it opens only once camera AND location
    are granted. Camera / Location step buttons prompt for each; a blocked one shows DPR's
    "Settings → Apps → Browser → Permissions" note.
  - With a photo present the buttons read **Replace photo / Re-upload**. **Remove** shows only on a
    snag that is NOT Completed.
  - Both: compress to ≤1600px JPEG (canvas). Reverse-geocode lat/lon → address, and store it in
    the DPR string format.
    Hold everything in memory and **upload only on Save** (`useFrappeFileUpload`, private,
    attached to the snag), so a cancelled dialog leaves no orphan file. The camera path also
    stops uploading at capture.
  - Under the preview in the dialog, show where the location came from: "📍 Taken here: <address>"
    (camera), "📍 From photo: <address>" (upload with EXIF), or "Location not available".
- **`SnagStatusChangeDialog`**:
  - show the current photo + picker for Pending / WIP / Completed;
  - for Completed, "Set to Completed" stays disabled until there is a photo (existing or new),
    with the hint "A photo is required to complete a snag";
  - Not Applicable is unchanged (direct write, no dialog).
- **`SnagEditDialog`**: a "Photo" section with add, replace and remove, in any status. Removing
  the photo of a Completed snag is blocked with a message.
- **`BulkStatusDialog`**: toast shows the skipped count (A5).
- **`snagColumns.tsx`**: new **Attachment** column after Remarks.
  - Cell: image icon; "—" when there is no photo.
  - HoverCard (tap on touch screens):
    - the photo itself, CSS-scaled (no stored thumbnail; it loads only on hover); click it →
      full image in a new tab;
    - **bottom**: address + lat/lon + **Directions** link
      (`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>`, Lat/Lon parsed from
      `location`).

## 6. Print format "Project Snag" (full report only; `mode=master` untouched)

- Add `attachment`, `location` to the snag `get_all` fields.
- New right-hand column **Attachment**. Widths: S.No 40px · Area 16% · Description 38% ·
  Status 11% · Remarks 21% · Attachment 70px.
- **The photo is rendered directly from the stored file, at print time.** wkhtmltopdf has no
  session, so a private URL cannot go into `<img>` as-is. A Jinja method fetches each photo
  server-side, shrinks it to ~150px and embeds it as a data URI. This reuses HOD's
  `_data_uri` / `fetch_attachment_content` path, with a smaller size. It is shown at 50×50
  `object-fit: cover`.
  - Shrinking at print time keeps the PDF small (~10 KB per photo, not the 250 KB original).
  - All the report's photos are fetched **in parallel, once per render**, not one by one per row.
  - **Cost, accepted:** a report with several hundred photos takes longer to download than it
    does today. A photo that cannot be fetched shows "-" and is logged; it never fails the PDF.
- Each thumbnail links to the full image (absolute site URL, so it opens for a logged-in user).
  Under it, a small "Map" link when `location` has coordinates. "-" when there is no photo.
- Delivered as ready-to-paste HTML. Also update the mirror `snag-printformat.html`.

## 7. Rollout and verification

- **Schema sync** (owner runs): use `reload_doc` for Project Snag rather than a full
  `bench migrate`. A migrate re-imports **every** `fixtures/*.json` with force, which reverts
  DB-only print-format pastes and Expense Type forms.
- Print format: paste into DB. Then a later migrate overwrites it from
  `fixtures/print_format.json`, unless that fixture is updated too (owner's call).
- Tests: new rolled-back cases in `test_snag_api.py` only (no suite sweep):
  - Completed without photo is refused; with photo it passes;
  - a photo sent in the same call as Completed passes;
  - bulk skips no-photo rows;
  - removing the photo of a Completed snag is refused; replacing it passes;
  - the print helper embeds a reachable photo and returns nothing for an unreachable one;
  - a legacy Completed snag with no photo can still have its details edited.
- Frontend: tsc on the changed files. Browser pass (incognito, owner supplies a test login) on
  desktop and a phone-width viewport: upload, location denied, hover, directions, PDF.

## 8. Not in this slice

More than one photo · photo-required for Pending/WIP · falling back to the device's position for
an uploaded photo (rejected, Q7) · photos on the import wizard · deleting the GCS object of a replaced photo (GCS is append-only
today).

---

## 9. As-built (2026-10-08, branch `develop`, uncommitted)

Owner confirmed all six open points ("go"), including updating the fixture.

**Backend**
- `project_snag.json`: `attachment` (Attach, "Photo") + `location` (Small Text, "Photo Location") after
  `remark`. Sanctioned hand-edit, recorded in `CODING_STANDARDS.md` § Don't touch. Synced on localhost
  with `reload_doc(force=True)` (owner ran it).
- `services/snag_photo.py` (pure): `photo_rule_violation`, `coordinates`, `directions_url`.
  Enforced in `integrations/controllers/project_snag.before_save`, which also clears `location` with
  the photo.
- `api/snags/tracking.py`:
  - `update_snag_status(+attachment, location)`;
  - `update_snag_details(+attachment, location, remove_photo)`;
  - `bulk_update_snag_status` returns `skipped`.
  - `_set_photo` refuses a URL that is not a File attached to this snag.
- `api/snags/print_photos.snag_print_photos` (Jinja method via `hooks.py`):
  - one GCS client per render, signs every photo up front;
  - 16 parallel fetches, `(5, 10)` s timeout;
  - `ImageOps.fit` to a 150 px square JPEG data URI;
  - failures are logged once per render, and the cell shows a "Photo" link instead.

**Frontend**
- `utils/snagPhoto.ts` (+ vitest) is the location parser, the TS twin of `services/snag_photo.py`.
- `SnagList/photo/snagPhotoCapture.ts`: compress (≤1600 px JPEG). `exifr` was added and then removed
  by the owner, so an upload carries no location; package.json / yarn.lock are back to HEAD.
- `SnagPhotoField`: Take photo = `CameraCapture` with the new additive `onCaptured` prop, gated by
  DPR's `usePermissionCheck` (camera + location granted); Upload. The upload goes out only on Save,
  attached to the snag with `fieldname: "attachment"`. Labels are Replace photo / Re-upload when a
  photo exists; Remove is hidden on Completed.
- `SnagStatusChangeDialog`: the "Set to Completed" button is disabled until there is a photo.
  `SnagEditDialog`: add / replace / remove the photo; remove is hidden on a Completed snag.
- `BulkStatusDialog`: hint plus a skipped-count toast.
- `SnagPhotoCell` (HoverCard): photo, address, coordinates, Directions, Full size.

**Print**: Attachment column, 84 px. Widths: Area 15% · Description 34% · Status 13% · Remarks 19%.
The fixture and the mirror are identical. The DB still holds the OLD HTML until the owner pastes it.

**Verified**
- `services.test_snag_photo` 9/9.
- 17 targeted `test_snag_api` tests (9 new + 4 adjusted + 4 neighbours), OK, no leftovers, no stray
  Error Logs.
- vitest `snagPhoto.test.ts` 8/8.
- tsc: 0 errors in changed files.
- In-memory PDF render of BENGALURU-PROJ-00103 (733 snags, 320 injected DPR photos; no DB write):
  320/320 embedded, photos 8.2 s, whole PDF 17 s, 2.9 MB.
  - Two earlier runs each hit one GCS read stall at the old 20 s timeout, hence the `(5, 10)`.

**Not verified**: a browser pass of the dialogs, camera, upload and hover (needs a test login).

**Gotchas found**
- Frappe's `attach_files_to_document` copies any `/files` or `/private/files` Attach value into a
  new File. That is harmless for GCS URLs (`/api/method/…`); the tests name `attached_to_field`.
- Frappe dedups identical upload bytes onto one URL, and JPEG erases one-step colour changes, so
  test photos vary their SIZE.
- A Jinja hook method is registered under its function's `__name__`, so a monkeypatch wrapper must
  copy it.
