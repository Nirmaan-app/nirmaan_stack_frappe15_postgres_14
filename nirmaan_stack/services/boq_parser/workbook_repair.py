"""
workbook_repair — make openpyxl-hostile .xlsx/.xlsm workbooks readable.

WHY THIS EXISTS
---------------
Excel opens some real BoQ workbooks happily that openpyxl flatly refuses. openpyxl
validates parts of the OOXML package more strictly than Excel does, and a single
out-of-spec attribute aborts `load_workbook()` for the WHOLE file -- not the one
sheet, not the one cell. Two such defects were measured on real customer BoQs
(2026-08-20):

  1. `xl/styles.xml` carrying `<family val="38"/>`. openpyxl's Font.family is
     MinMax(0, 14), so it raises `ValueError: Max value is 14`, surfacing as
     "could not read stylesheet". (Fidelity Chennai Electrical BoQ.)

  2. `xl/workbook.xml` carrying `<definedName name="_xlnm.Print_Titles" ...>#N/A
     </definedName>`. openpyxl parses print titles eagerly and raises
     "#N/A is not a valid print titles definition", surfacing as "could not assign
     names". (FR. Coimbatore Combined BoQ - MEP.)

Neither file is corrupt. Both were produced by a non-Excel tool that wrote slightly
out-of-spec XML. Before this module they failed at EVERY phase that opens the
workbook -- upload, config preview, parse, commit, and both rate exports.

DESIGN
------
Two rules, deliberately narrow. This is NOT a general "strip anything openpyxl
dislikes" pass: a broad rewriter risks silently altering good workbooks, and a
defect we have not measured is better surfaced (and logged) than guessed at.

`needs_repair()` is a CHEAP scan -- it reads only the two small XML parts out of the
zip and never rewrites. Measured 0.6 ms on a healthy 6.7 MB workbook, so the fetch
path can call it unconditionally. `repair_in_place()` only rewrites when the scan
fires (23-221 ms on the measured defective files).

LOAD-BEARING INVARIANTS
-----------------------
* **The repair must never touch bold, fill or indent.** `classifier.py` reads those
  three style attributes to detect section headers, so altering them would silently
  change parse results. `<family>` is a cosmetic font-classification hint that
  nothing downstream reads -- that is exactly what makes clamping it safe.
* **Every zip entry except the two targeted parts is copied BYTE-FOR-BYTE**, with
  its original `ZipInfo` (so compression type is preserved). This is what keeps an
  `.xlsm` workbook's `xl/vbaProject.bin` intact, and it is asserted by test.
* **A healthy workbook is a NO-OP.** `needs_repair()` returns False and nothing is
  written. Proven on the 6.7 MB MEP BOM workbook: forcing a rewrite anyway changed
  zero entries.
* **No frappe imports.** This module is pure and unit-testable in isolation, matching
  `reader.py`. Callers in `api/` own the logging.
"""
from __future__ import annotations

import os
import re
import shutil
import tempfile
import zipfile

# Rule 1 -- openpyxl's Font.family is MinMax(min=0, max=14); anything above aborts
# the stylesheet read. 2 ("swiss") is the neutral fallback Excel itself assumes for
# an unrecognised family, and nothing in the parser reads this attribute.
_STYLES_PART = "xl/styles.xml"
_FAMILY_RE = re.compile(r'<family val="(\d+)"\s*/>')
_FAMILY_MAX = 14
_FAMILY_FALLBACK = 2

# Rule 2 -- a built-in (`_xlnm.*`) defined name whose value is the #N/A error.
#
# `localSheetId` IS PART OF THE RULE, and getting this wrong is the difference between
# a fix and a false positive. openpyxl's `assign_names()` only resolves a built-in name
# against a worksheet when it is SHEET-LOCAL; a GLOBAL `_xlnm.Print_Titles` is never
# parsed as print titles and so can never raise. Measured on the repo's own fixtures:
#   * R0_CIVIL INTERIOR & MEP_TABLESPACE...xlsx -- sheet-local #N/A  -> genuinely FAILS
#   * Kohler-BOQ- 06-04-26.xlsx                 -- global #N/A       -> OPENS FINE
# Matching the global form too would rewrite Kohler on every fetch for no benefit.
#
# Deliberately does NOT match user-defined names or `#REF!` values: openpyxl tolerates
# both, and every measured file opens without touching them. Kohler carries dozens of
# `______xlnm.Print_Titles_2`-style user names -- similar-looking, harmless, left alone.
_WORKBOOK_PART = "xl/workbook.xml"
_BAD_DEFINED_NAME_RE = re.compile(
    r'<definedName\s+name="_xlnm\.[^"]*"[^>]*\blocalSheetId="\d+"[^>]*>'
    r"#N/A</definedName>"
)


def _clamp_font_family(xml: str) -> tuple[str, bool]:
    """Clamp out-of-range <family val="N"/> values. Returns (xml, changed)."""

    def _sub(match: re.Match) -> str:
        value = int(match.group(1))
        if value <= _FAMILY_MAX:
            return match.group(0)
        return f'<family val="{_FAMILY_FALLBACK}"/>'

    repaired = _FAMILY_RE.sub(_sub, xml)
    return repaired, repaired != xml


def _drop_bad_defined_names(xml: str) -> tuple[str, bool]:
    """Drop built-in defined names whose value is #N/A. Returns (xml, changed)."""
    repaired = _BAD_DEFINED_NAME_RE.sub("", xml)
    return repaired, repaired != xml


def _read_part(zf: zipfile.ZipFile, part: str) -> str | None:
    """Return a zip member decoded as text, or None when absent/undecodable."""
    try:
        return zf.read(part).decode("utf-8", "replace")
    except KeyError:
        return None


def needs_repair(path: str) -> bool:
    """True when `path` carries a defect this module knows how to repair.

    Cheap by design: opens the zip central directory and reads at most two small
    XML parts. Never rewrites. Safe to call on every workbook fetch -- measured
    0.6 ms on a healthy 6.7 MB workbook.

    Returns False (rather than raising) for anything that is not a readable zip;
    such a file is genuinely broken and belongs to the caller's error path.
    """
    try:
        with zipfile.ZipFile(path) as zf:
            styles = _read_part(zf, _STYLES_PART)
            if styles is not None:
                if any(int(v) > _FAMILY_MAX for v in _FAMILY_RE.findall(styles)):
                    return True

            workbook = _read_part(zf, _WORKBOOK_PART)
            if workbook is not None and _BAD_DEFINED_NAME_RE.search(workbook):
                return True
    except (zipfile.BadZipFile, OSError):
        return False

    return False


def repair_in_place(path: str) -> list[str]:
    """Repair `path` in place. Returns the rule names that fired ([] = untouched).

    In place is deliberate: every caller already owns `path` as a private
    NamedTemporaryFile it will unlink itself, so rewriting it introduces no new
    file lifecycle and nothing to leak.

    Runs the cheap `needs_repair()` scan first and returns `[]` immediately when a
    workbook is healthy, so the common path never pays for a zip rewrite. The
    rewrite goes to a sibling tempfile and is moved over `path` only on success --
    an exception mid-rewrite therefore leaves the original intact.
    """
    if not needs_repair(path):
        return []

    fired: list[str] = []
    tmp_fd, tmp_path = tempfile.mkstemp(
        suffix=".xlsx", dir=os.path.dirname(path) or None
    )
    os.close(tmp_fd)

    try:
        with zipfile.ZipFile(path) as zin, zipfile.ZipFile(
            tmp_path, "w", zipfile.ZIP_DEFLATED
        ) as zout:
            for info in zin.infolist():
                data = zin.read(info.filename)

                if info.filename == _STYLES_PART:
                    repaired, changed = _clamp_font_family(data.decode("utf-8", "replace"))
                    if changed:
                        fired.append("font_family_clamped")
                        data = repaired.encode("utf-8")

                elif info.filename == _WORKBOOK_PART:
                    repaired, changed = _drop_bad_defined_names(
                        data.decode("utf-8", "replace")
                    )
                    if changed:
                        fired.append("bad_defined_names_dropped")
                        data = repaired.encode("utf-8")

                # Every other part is copied byte-for-byte with its ORIGINAL ZipInfo,
                # which preserves compression type -- this is what keeps an .xlsm
                # workbook's vbaProject.bin intact.
                zout.writestr(info, data)

        shutil.move(tmp_path, path)
        return fired
    except Exception:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise
