# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Hourly janitor for bulk-download temp files (Leak A).

`run_bulk_download_job` writes the merged PDF to
`public/files/temp_downloads/{token}.bin` and fires a realtime event; the client
is expected to call `fetch_temp_file`, which deletes the file on read. That
deletion happens ONLY on a successful fetch — a missed socket event, a closed
tab, or a failed request strands the `.bin` forever. There is no File doc and no
TTL behind it, so this filesystem sweep is the only safety net.

A temp download is consumed within minutes, so a 6 h grace can never race an
in-flight download.
"""

import os
import time

import frappe

from nirmaan_stack.tasks.janitor_log import janitor_log

GRACE_HOURS = 6
GRACE_SEC = GRACE_HOURS * 3600
TEMP_EXT = ".bin"


def cleanup_temp_downloads():
    """Hourly cron entry point. Wired in hooks.py scheduler_events.hourly."""
    temp_dir = frappe.utils.get_site_path("public", "files", "temp_downloads")
    if not os.path.isdir(temp_dir):
        return

    cutoff = time.time() - GRACE_SEC
    removed = 0
    freed = 0

    for fname in os.listdir(temp_dir):
        if not fname.endswith(TEMP_EXT):
            continue
        path = os.path.join(temp_dir, fname)
        try:
            if not os.path.isfile(path) or os.path.getmtime(path) >= cutoff:
                continue
            size = os.path.getsize(path)
            os.remove(path)
            removed += 1
            freed += size
        except OSError:
            # File vanished mid-sweep (a concurrent fetch_temp_file won the race)
            # or is unreadable — either way it is not ours to worry about.
            continue

    if removed:
        janitor_log(
            f"[temp_downloads] removed {removed} files, "
            f"{freed / 1048576:.1f} MB reclaimed"
        )
    return {"removed": removed, "mb": round(freed / 1048576, 1)}
