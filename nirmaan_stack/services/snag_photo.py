"""The snag photo rule: when a photo is required.

Pure (ADR-0010 B1): no `frappe.db`, no request context. Owners of its enforcement:
  - `integrations/controllers/project_snag.before_save` refuses a save that breaks the rule,
    whichever path made it (dialog, Desk, REST);
  - `api/snags/tracking.bulk_update_snag_status` asks the same question to SKIP a row instead
    of failing the whole bulk change.

The location's parsing and its Location (maps) link live in the frontend only
(`frontend/src/utils/snagPhoto.ts`): the PDF's Map link was removed (owner 2026-10-08), and with
it the Python copy.

One photo per snag (owner 2026-10-08), stored on `Project Snag.attachment`, with its
`location` in the DPR `CameraCapture` format: "<address> (Lat: 12.9716, Lon: 77.5946)".
"""

#: The one status that needs the snag's photo (owner 2026-10-08).
PHOTO_REQUIRED_STATUS = "Completed"


def photo_rule_violation(previous_status, status, previous_photo, photo):
    """Why this change breaks the photo rule, or None.

    The rule fires on exactly TWO transitions, and deliberately not on a bare save:
      - a move INTO Completed (a new snag created as Completed counts: `previous_status` None)
        with no photo;
      - a Completed snag's photo being REMOVED. Replacing it is fine -- `photo` is then set.

    A snag that was ALREADY Completed with no photo -- every Completed snag from before the
    photo existed -- is left alone, so its area / description / remark stay editable. Refusing
    every save of such a row would lock the whole legacy set until someone photographed it.
    """
    if status != PHOTO_REQUIRED_STATUS or photo:
        return None
    if previous_status != status:
        return (
            f"A photo is required to mark a snag {PHOTO_REQUIRED_STATUS}. Add the photo, "
            "then set the status."
        )
    if previous_photo:
        return (
            f"A {PHOTO_REQUIRED_STATUS} snag must keep its photo. Replace it instead, or move "
            f"the snag out of {PHOTO_REQUIRED_STATUS} first."
        )
    return None

