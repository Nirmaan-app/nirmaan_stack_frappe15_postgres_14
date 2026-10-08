"""The snag photo rules: when a photo is required, and where its Directions link points.

Pure (ADR-0010 B1): no `frappe.db`, no request context. Owners of each rule's enforcement:
  - `integrations/controllers/project_snag.before_save` refuses a save that breaks the rule,
    whichever path made it (dialog, Desk, REST);
  - `api/snags/tracking.bulk_update_snag_status` asks the same question to SKIP a row instead
    of failing the whole bulk change;
  - `directions_url` is the Python twin of `frontend/src/utils/snagPhoto.ts`, which builds the
    snag table's Directions link. Keep the two location parsers in step. (The PDF showed a Map
    link until the owner removed it, 2026-10-08.)

One photo per snag (owner 2026-10-08), stored on `Project Snag.attachment`, with its
`location` in the DPR `CameraCapture` format: "<address> (Lat: 12.9716, Lon: 77.5946)".
"""

import re
import urllib.parse

#: The one status that needs the snag's photo (owner 2026-10-08).
PHOTO_REQUIRED_STATUS = "Completed"

#: The coordinates DPR's `CameraCapture` appends to the address: "(Lat: x, Lon: y)".
_LAT_LON = re.compile(r"\(\s*Lat:\s*(-?\d+(?:\.\d+)?)\s*,\s*Lon:\s*(-?\d+(?:\.\d+)?)\s*\)\s*$")

_DIRECTIONS = "https://www.google.com/maps/dir/?api=1&destination="


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


def coordinates(location):
    """`(lat, lon)` from a stored location string, or None when it carries none."""
    match = _LAT_LON.search(location or "")
    if not match:
        return None
    return float(match.group(1)), float(match.group(2))


def directions_url(location):
    """Google Maps directions to the photo's location, or None when there is no location.

    The coordinates win when the string has them -- an address alone can resolve to the
    middle of a street. Only a location with no coordinates falls back to its text.
    """
    location = (location or "").strip()
    if not location:
        return None
    coords = coordinates(location)
    destination = f"{coords[0]},{coords[1]}" if coords else location
    return _DIRECTIONS + urllib.parse.quote(destination, safe=",")
