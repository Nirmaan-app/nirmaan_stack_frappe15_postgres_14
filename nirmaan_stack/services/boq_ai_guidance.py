# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Guidance inputs for the guided Claude review prompt (slice S1b, prompt v2).

The guided prompt (services/boq_ai_assist.PROMPT_VERSION "v2") shows the model two aids
per row, in a GUIDANCE block after the rows:
  - similar_reviewed_rows: up to 5 rows from OTHER BoQs whose row type is already
    committed (the EXAMPLES LIBRARY), found by text similarity;
  - candidate_parents: the earlier rows of the SAME sheet most likely to be the parent
    (SHORTLIST RULE v4).

This module owns both aids and NOTHING else: no AI call, no prompt text, no write to any
doctype. The AI-2c worker calls `build_guidance` once per pass and hands the result to
`boq_ai_assist.run_ai_pass(..., guidance=...)`.

THE EXAMPLES LIBRARY (owner rulings R4 / R7)
  - Built from committed data: every current `BoQ Sheet` with current `BOQ Nodes` counts
    as reviewed; the row type is the committed node's `row_class`; the text comes from the
    committed grid's sl_no / description / unit / qty columns. NEVER a rate or amount
    column (the build keeps only those four roles), and a quantity only as has_qty
    true / false.
  - Lives in ONE file under the site's own folder (filesystem only -- deliberately NOT a
    Frappe File record, so it never reaches the cloud bucket).
  - Rebuilt ON DEMAND only: a Claude run that finds the file missing or older than 24 h
    rebuilds it first. There is NO scheduled job. One rebuild at a time: a run that finds
    a rebuild in progress waits for it (up to 3 minutes) and then uses the new file.
  - If the library cannot be had (rebuild failed, wait timed out, unreadable file) the
    pass STILL RUNS, without examples, and the boq_ai log says why.
  - Exclusions are applied at LOOK-UP, so one file serves every sheet: the checked BoQ and
    its revision family (the BOQs.source_boq chain, read live) and TestProject BoQs.

The similarity, the truth rule and the shortlist are ported UNCHANGED from the measured
scratch code (jev_exploration: sepoct_f1/phase1_f1.py, s1a2/build_library_s1a2.py,
sepoct_f1/shortlist_rule_v4.py). Do not "improve" them: the accuracy figures the owner
ruled on were measured with exactly this arithmetic.
"""
from __future__ import annotations

import collections
import gc
import json
import math
import os
import pickle
import re
import time
from array import array
from typing import Any

import frappe
from filelock import FileLock

from nirmaan_stack.services.boq_ai_assist import _get, _row_has_qty

logger = frappe.logger("boq_ai")

LIBRARY_MAX_AGE_SEC = 24 * 3600     # older than this -> the next Claude run rebuilds first
REBUILD_WAIT_SEC = 180              # a run waits this long for another run's rebuild
EXAMPLES_PER_ROW = 5
_LIBRARY_FORMAT = 2                 # bump when the saved state's shape changes (2 = compact, S2)
_EXAMPLE_DESC_MAX = 120             # an example's description is cut to this on the wire
_CANDIDATE_DESC_MAX = 120           # so is a candidate parent's
_TOP_LEVEL = "none (top level)"
_SAVEPOINT = "boq_ai_guidance"

# The committed-grid column roles the library may read. A rate / amount role is never read.
_ALLOWED_ROLE_PREFIXES = ("sl_no", "description", "unit", "qty")


# ---------------------------------------------------------------------------
# Shortlist rule v4 (candidate parents) -- ported UNCHANGED
# ---------------------------------------------------------------------------
# Candidates for row i, in this order, over the NON-SPACER (by parser) earlier rows,
# de-duplicated, capped at 5:
#   1. the PARSER's parent of row i (if it has one);
#   2. the serial-number parent: if sl_no of row i has a dotted / lettered shape with a
#      prefix ("1.01" -> "1", "2.3.4" -> "2.3", "A.1" -> "A"), the NEAREST earlier row whose
#      normalised sl_no equals that prefix;
#   3. the nearest earlier row the PARSER calls preamble;
#   4. the second-nearest earlier row the PARSER calls preamble;
#   5. the nearest earlier row the PARSER calls note that LOOKS LIKE A HEADING: no unit and
#      a description of <= 60 characters;
#   6. the nearest earlier row whose sl_no is a single letter (A, B, c ...);
# plus "none (top level)" always (added by the caller).
# sl_no normalisation: strip, lower, drop a trailing ".", ")" or ":", collapse "28.0" -> "28".

def norm_sl(s):
    s = (s or '').strip().lower().rstrip('.):')
    if re.fullmatch(r'\d+\.0+', s):
        s = s.split('.')[0]
    return s


def sl_prefix(s):
    s = norm_sl(s)
    m = re.fullmatch(r'(.+)[.\-](\d+|[a-z]|[ivx]+)', s)
    return m.group(1) if m else None


def sl_shape(s):
    s = norm_sl(s)
    if not s:
        return 'blank'
    if re.fullmatch(r'\d+', s):
        return 'int'
    if re.fullmatch(r'[\d]+([.\-][\d]+)+', s):
        return 'dotted'
    if re.fullmatch(r'[a-z]', s):
        return 'alpha'
    if re.fullmatch(r'[ivx]+', s):
        return 'roman'
    if re.fullmatch(r'[a-z][.\-]?\d+', s) or re.fullmatch(r'\d+[.\-]?[a-z]', s):
        return 'alnum'
    return 'other'


def shortlist(rows, i, parser_type, parser_parent_excel, cap=5):
    """rows: list of dicts in sheet order with keys excel_row, sl_no, description, unit (all
    rows, spacers included); parser_type(excel_row) -> parser classification;
    parser_parent_excel(excel_row) -> parent excel row or None.
    Returns an ordered list of candidate excel rows (max cap)."""
    me = rows[i]
    earlier = [r for r in rows[:i] if parser_type(r['excel_row']) != 'spacer']
    out = []

    def add(ex):
        if ex is not None and ex not in out and len(out) < cap:
            out.append(ex)

    add(parser_parent_excel(me['excel_row']))                    # 1 parser parent
    pre = sl_prefix(me['sl_no'])
    if pre:                                                      # 2 serial-number parent
        for r in reversed(earlier):
            if norm_sl(r['sl_no']) == pre:
                add(r['excel_row'])
                break
    pres = [r['excel_row'] for r in reversed(earlier) if parser_type(r['excel_row']) == 'preamble']
    for ex in pres[:2]:                                          # 3,4 two nearest parser-preambles
        add(ex)
    for r in reversed(earlier):                                  # 5 nearest heading-like parser-note
        if (parser_type(r['excel_row']) == 'note' and not (r.get('unit') or '').strip()
                and len((r.get('description') or '').strip()) <= 60):
            add(r['excel_row'])
            break
    for r in reversed(earlier):                                  # 6 nearest lettered-serial row
        if sl_shape(r['sl_no']) == 'alpha':
            add(r['excel_row'])
            break
    return out


# ---------------------------------------------------------------------------
# The examples library: similarity index -- ported UNCHANGED
# ---------------------------------------------------------------------------

def _nonzero(v) -> bool:
    try:
        return v is not None and str(v).strip() != '' and float(v) != 0.0
    except (TypeError, ValueError):
        return False


def _cell_text(cells: dict, roles: dict, role: str) -> str:
    """The text of every column mapped to `role`, in Excel column order, joined by ' | '."""
    cols = sorted([c for c, r in roles.items() if r == role], key=lambda c: (len(c), c))
    return ' | '.join(
        str(cells.get(c)).strip() for c in cols
        if cells.get(c) not in (None, '') and str(cells.get(c)).strip()
    )


def _toks(description) -> collections.Counter:
    """Lower-cased words plus 3-character pieces of the description."""
    d = (description or '').lower()
    words = re.findall(r'\w+', d)
    s = re.sub(r'\s+', ' ', d).strip()
    return collections.Counter(
        words + (['#' + s[i:i + 3] for i in range(len(s) - 2)] if len(s) >= 3 else [])
    )


def _pack(strings) -> tuple[bytes, array]:
    """Many short strings as ONE UTF-8 blob + an offsets array (no per-string Python object)."""
    blob = bytearray()
    offsets = array('I', [0])
    for s in strings:
        blob += ('' if s is None else str(s)).encode('utf-8')
        offsets.append(len(blob))
    return bytes(blob), offsets


def _unpack(blob: bytes, offsets: array, j: int) -> str:
    return blob[offsets[j]:offsets[j + 1]].decode('utf-8')


def _intern(values) -> tuple[list, array]:
    """A column with few distinct values as (distinct values, one small index per row)."""
    names: list = []
    index: dict = {}
    ix = array('I')
    for v in values:
        i = index.get(v)
        if i is None:
            i = index[v] = len(names)
            names.append(v)
        ix.append(i)
    return names, ix


class ExamplesLibrary:
    """Committed rows + a TF-IDF index over their descriptions.

    Similarity = TF-IDF cosine (words + character trigrams) + 0.15 when has_qty is equal
    + 0.10 when the serial-number shape is equal; the best 5. A row with no usable text is
    matched against the blank-description rows.

    Each row: {boq, sheet, excel_row, sl_no, description, unit, has_qty, truth_type}.

    COMPACT IN MEMORY (S2, file format 2): no per-row dict and no per-token Python object.
    Rows are columns (packed UTF-8 text + small index arrays); the index is ONE postings table
    (row id + the token's count in that row) addressed through a sorted, packed vocabulary.
    A posting's weight is recomputed at look-up as (count * idf) / row_norm -- the SAME
    arithmetic, in the same order, that produced the stored weight of format 1, so every score
    and therefore the order of the examples is identical to the last bit. A description is kept
    only up to _EXAMPLE_DESC_MAX characters: the index is built from the full text, and nothing
    after the build reads more than that.
    """

    _COLUMNS = (
        "N", "boq_names", "boq_ix", "sheet_names", "sheet_ix", "excel", "sl_blob", "sl_off",
        "desc_blob", "desc_off", "unit_blob", "unit_off", "has_qty", "truth_names", "truth_ix",
        "shape_names", "shape_ix", "blank", "tok_blob", "tok_off", "idf", "norm",
        "post_start", "post_ids", "post_cnt",
    )

    def __init__(self, rows: list[dict], testproject=(), built_at: float | None = None,
                 _state: dict | None = None):
        self.testproject = frozenset(testproject)
        self.built_at = built_at if built_at is not None else time.time()
        if _state is not None:
            for name in self._COLUMNS:
                setattr(self, name, _state[name])
        else:
            self._build(rows)
        self.logN = math.log(self.N) if self.N else 0.0
        self._shape_id = {s: i for i, s in enumerate(self.shape_names)}

    def _build(self, rows: list[dict]) -> None:
        self.N = n_rows = len(rows)
        self.boq_names, self.boq_ix = _intern(b['boq'] for b in rows)
        self.sheet_names, self.sheet_ix = _intern(b['sheet'] for b in rows)
        self.truth_names, self.truth_ix = _intern(b['truth_type'] for b in rows)
        self.shape_names, self.shape_ix = _intern(sl_shape(b['sl_no']) for b in rows)
        self.excel = array('q', (-1 if b.get('excel_row') is None else int(b['excel_row'])
                                 for b in rows))
        self.sl_blob, self.sl_off = _pack(b['sl_no'] for b in rows)
        self.desc_blob, self.desc_off = _pack(
            (b['description'] or '')[:_EXAMPLE_DESC_MAX] for b in rows
        )
        self.unit_blob, self.unit_off = _pack(b['unit'] for b in rows)
        self.has_qty = [b['has_qty'] for b in rows]
        self.blank = array(
            'I', (j for j, b in enumerate(rows) if not (b['description'] or '').strip())
        )

        # Pass 1: in how many rows each token occurs, and the largest count of one token in a row.
        df: collections.Counter = collections.Counter()
        max_count = 1
        for b in rows:
            tf = _toks(b['description'])
            if tf:
                df.update(tf.keys())
                max_count = max(max_count, max(tf.values()))
        tokens = sorted(df, key=lambda k: k.encode('utf-8'))
        token_id = {k: i for i, k in enumerate(tokens)}
        self.tok_blob, self.tok_off = _pack(tokens)
        self.idf = array('d', (math.log(n_rows / df[k]) for k in tokens))
        self.post_start = array('I', [0])
        total = 0
        for k in tokens:
            total += df[k]
            self.post_start.append(total)
        del tokens, df

        # Pass 2: fill the postings, token by token in row order, and each row's norm.
        count_type = 'B' if max_count <= 0xFF else 'H' if max_count <= 0xFFFF else 'I'
        self.post_ids = array('I', bytes(4 * total))
        self.post_cnt = array(count_type, bytes(array(count_type).itemsize * total))
        self.norm = array('d', bytes(8 * n_rows))
        cursor = array('I', self.post_start[:-1])
        idf = self.idf
        for j, b in enumerate(rows):
            tf = _toks(b['description'])
            self.norm[j] = math.sqrt(sum(x * x for x in [c * idf[token_id[k]] for k, c in tf.items()])) or 1.0
            for k, c in tf.items():
                t = token_id[k]
                pos = cursor[t]
                self.post_ids[pos] = j
                self.post_cnt[pos] = c
                cursor[t] = pos + 1

    def _token_id(self, token: str) -> int:
        """The token's position in the sorted vocabulary, or -1 when the library has never seen it."""
        key = token.encode('utf-8')
        blob, off = self.tok_blob, self.tok_off
        lo, hi = 0, len(off) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            cur = blob[off[mid]:off[mid + 1]]
            if cur < key:
                lo = mid + 1
            elif cur > key:
                hi = mid
            else:
                return mid
        return -1

    def _row(self, j: int) -> dict:
        return {
            'boq': self.boq_names[self.boq_ix[j]], 'sheet': self.sheet_names[self.sheet_ix[j]],
            'excel_row': None if self.excel[j] < 0 else self.excel[j],
            'sl_no': _unpack(self.sl_blob, self.sl_off, j),
            'description': _unpack(self.desc_blob, self.desc_off, j),
            'unit': _unpack(self.unit_blob, self.unit_off, j),
            'has_qty': self.has_qty[j], 'truth_type': self.truth_names[self.truth_ix[j]],
        }

    @property
    def rows(self) -> list[dict]:
        """Every row as a dict (built on demand -- for inspection and tests, not for look-ups)."""
        return [self._row(j) for j in range(self.N)]

    def top5(self, query: dict, exclude=frozenset()) -> list[dict]:
        """The best EXAMPLES_PER_ROW library rows for `query` ({description, sl_no, has_qty}),
        never from a BoQ in `exclude`."""
        tf = _toks(query['description'])
        idf, norm = self.idf, self.norm
        ids = {k: self._token_id(k) for k in tf}
        v = {k: c * (idf[ids[k]] if ids[k] >= 0 else self.logN) for k, c in tf.items()}
        n = math.sqrt(sum(x * x for x in v.values())) or 1.0
        acc: collections.defaultdict = collections.defaultdict(float)
        post_start, post_ids, post_cnt = self.post_start, self.post_ids, self.post_cnt
        for k, x in v.items():
            t = ids[k]
            if t < 0:
                continue
            x = x / n
            w = idf[t]
            s, e = post_start[t], post_start[t + 1]
            for j, c in zip(post_ids[s:e], post_cnt[s:e]):
                acc[j] += x * ((c * w) / norm[j])
        cand = list(acc.items()) if acc else [(j, 0.0) for j in self.blank]
        excluded = {i for i, name in enumerate(self.boq_names) if name in exclude}
        boq_ix, has_qty, shape_ix = self.boq_ix, self.has_qty, self.shape_ix
        qs = self._shape_id.get(sl_shape(query['sl_no']), -1)
        qh = query['has_qty']
        scored = sorted(
            (
                (cos + (0.15 if has_qty[j] == qh else 0.0)
                 + (0.10 if shape_ix[j] == qs else 0.0), j)
                for j, cos in cand if boq_ix[j] not in excluded
            ),
            key=lambda x: -x[0],
        )[:EXAMPLES_PER_ROW]
        out = []
        for sc, j in scored:
            row = self._row(j)
            out.append({
                'boq': row['boq'], 'sheet': row['sheet'], 'sl_no': row['sl_no'],
                'description': row['description'][:_EXAMPLE_DESC_MAX],
                'unit': row['unit'], 'has_qty': row['has_qty'],
                'correct_row_type': row['truth_type'], 'score': round(sc, 4),
            })
        return out

    def state(self) -> dict:
        return {
            "format": _LIBRARY_FORMAT, "built_at": self.built_at,
            "testproject": sorted(self.testproject),
            **{name: getattr(self, name) for name in self._COLUMNS},
        }

    @classmethod
    def from_state(cls, state: dict) -> "ExamplesLibrary":
        if not isinstance(state, dict) or state.get("format") != _LIBRARY_FORMAT:
            raise ValueError("examples library file has an unknown format")
        return cls([], state["testproject"], state["built_at"], _state=state)


# ---------------------------------------------------------------------------
# Build from committed data (reads only) -- the s1a2 rule, UNCHANGED
# ---------------------------------------------------------------------------

def build_library() -> ExamplesLibrary:
    """Build the examples library from this site's committed BoQ data. READS ONLY.

    Truth = the committed node's row_class, keyed by excel row. Blank rows are added as
    "spacer" only when the sheet verifies one to one (every non-spacer review row is a
    node). TestProject BoQs stay IN the file and are excluded at look-up.
    """
    boqs = {
        b.name: b
        for b in frappe.db.sql('SELECT name, project FROM "tabBOQs"', as_dict=True)
    }
    projects = {
        p.name: (p.project_name or '')
        for p in frappe.db.sql('SELECT name, project_name FROM "tabProjects"', as_dict=True)
    }
    testproject = frozenset(
        n for n, b in boqs.items()
        if 'testproject' in projects.get(b.project, '').lower().replace(' ', '')
    )
    sheets = frappe.db.sql(
        'SELECT name, boq, sheet_name, column_role_map FROM "tabBoQ Sheet" '
        'WHERE is_current=1 ORDER BY boq, sheet_name',
        as_dict=True,
    )
    rows: list[dict] = []
    for s in sheets:
        nodes = frappe.db.sql(
            'SELECT source_row_number, row_class FROM "tabBOQ Nodes" '
            'WHERE sheet=%s AND is_current=1',
            (s.name,), as_dict=True,
        )
        if not nodes or s.boq not in boqs:
            continue
        role_map = s.column_role_map
        if not isinstance(role_map, dict):
            role_map = json.loads(role_map or '{}')
        roles = {c: (spec or {}).get('role') for c, spec in role_map.items()}
        # Only these roles are ever read below; a rate / amount column is dropped HERE.
        roles = {c: r for c, r in roles.items() if r and r.startswith(_ALLOWED_ROLE_PREFIXES)}
        review_rows = frappe.db.sql(
            'SELECT source_row_number, classification, human_classification '
            'FROM "tabBoQ Review Row" WHERE boq=%s AND sheet_name=%s AND is_excluded=0 '
            'ORDER BY row_index',
            (s.boq, s.sheet_name), as_dict=True,
        )
        grid = frappe.db.get_value(
            'BoQ Committed Sheet Grid',
            {'boq': s.boq, 'source_sheet_name': s.sheet_name, 'is_current': 1},
            'name',
        )
        cells: dict = {}
        if grid:
            for g in frappe.db.sql(
                'SELECT row_number, cells FROM "tabBoQ Committed Sheet Grid Row" WHERE parent=%s',
                (grid,), as_dict=True,
            ):
                c = json.loads(g.cells) if isinstance(g.cells, str) else (g.cells or {})
                cells[int(g.row_number)] = {
                    k: c.get(k) for k in roles if c.get(k) not in (None, '')
                }
        truth = {
            n.source_row_number: n.row_class
            for n in nodes if n.source_row_number and n.row_class
        }

        def effective(r):
            return r.human_classification or r.classification

        verified = {
            r.source_row_number for r in review_rows
            if effective(r) != 'spacer' and r.source_row_number
        } == set(truth)
        for r in review_rows:
            ex = r.source_row_number
            if ex in truth:
                truth_type = truth[ex]
            elif verified and effective(r) == 'spacer' and ex:
                truth_type = 'spacer'
            else:
                continue
            c = cells.get(ex, {})
            rows.append({
                'boq': s.boq, 'sheet': s.sheet_name, 'excel_row': ex,
                'sl_no': _cell_text(c, roles, 'sl_no'),
                'description': _cell_text(c, roles, 'description'),
                'unit': _cell_text(c, roles, 'unit'),
                'has_qty': any(
                    _nonzero(val) for col, val in c.items()
                    if roles.get(col, '').startswith('qty')
                ),
                'truth_type': truth_type,
            })
    return ExamplesLibrary(rows, testproject)


# ---------------------------------------------------------------------------
# The file: save / load / on-demand rebuild under ONE lock
# ---------------------------------------------------------------------------

def library_path() -> str:
    """The library file, under the site's own private folder (filesystem only)."""
    # The name carries the format: a format-1 file (about 190 MB, about 590 MiB once loaded) is
    # never opened again, not even to find out that it is old.
    return frappe.get_site_path("private", "boq_ai", f"examples_library_v{_LIBRARY_FORMAT}.pkl")


def is_fresh(path: str) -> bool:
    """True when the file exists and is younger than LIBRARY_MAX_AGE_SEC."""
    try:
        return (time.time() - os.path.getmtime(path)) < LIBRARY_MAX_AGE_SEC
    except OSError:
        return False


def save_library(library: ExamplesLibrary, path: str) -> None:
    """Write to a temp name, then rename: a reader never sees a half-written file."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    try:
        with open(tmp, "wb") as f:
            pickle.dump(library.state(), f, protocol=5)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def load_library(path: str) -> ExamplesLibrary:
    # The file is written only by save_library, under the site's private folder.
    with open(path, "rb") as f:
        return ExamplesLibrary.from_state(pickle.load(f))


def _load_if_fresh(path: str) -> ExamplesLibrary | None:
    if not is_fresh(path):
        return None
    try:
        return load_library(path)
    except Exception as exc:
        logger.warning(
            "boq_ai guidance: examples library file unreadable, rebuilding: %s: %s",
            type(exc).__name__, exc,
        )
        return None


def get_library(path: str | None = None) -> tuple[ExamplesLibrary, bool]:
    """Return (library, rebuilt_by_this_call).

    A fresh file is loaded. A missing / stale file is rebuilt ON DEMAND under one lock: a
    second run arriving meanwhile waits up to REBUILD_WAIT_SEC, then loads the file the
    first one wrote. A timed-out wait or a failed build RAISES -- `build_guidance` turns
    that into "continue without examples".
    """
    path = path or library_path()
    library = _load_if_fresh(path)
    if library is not None:
        return library, False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with FileLock(path + ".lock", timeout=REBUILD_WAIT_SEC):
        library = _load_if_fresh(path)      # another run rebuilt it while this one waited
        if library is not None:
            return library, False
        library = build_library()
        save_library(library, path)
        return library, True


# ---------------------------------------------------------------------------
# Look-up for one sheet
# ---------------------------------------------------------------------------

def revision_family(boq_name: str) -> frozenset:
    """The checked BoQ and every BoQ linked to it through BOQs.source_boq (either
    direction, any depth). Read LIVE, so a revision uploaded after the library was built
    is still excluded."""
    links = frappe.db.sql('SELECT name, source_boq FROM "tabBOQs"', as_dict=True)
    parent = {b.name: b.name for b in links}
    parent.setdefault(boq_name, boq_name)

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for b in links:
        if b.source_boq and b.source_boq in parent:
            parent[find(b.name)] = find(b.source_boq)
    root = find(boq_name)
    return frozenset(n for n in parent if find(n) == root)


def _text(v: Any) -> str:
    return '' if v is None else str(v).strip()


def guidance_for_rows(rows: list, library: ExamplesLibrary | None = None,
                      exclude=frozenset()) -> dict:
    """{excel_row: {"similar_reviewed_rows": [...], "candidate_parents": [...]}} for every
    review row of ONE sheet (rows in sheet order). PURE: no database, no file.

    The shortlist reads the PARSER's own classification and parent (never the human / AI
    layer) -- that is the rule as measured. `library` None -> no examples, candidates only.
    """
    excel_of = {
        _get(r, "row_index"): _get(r, "source_row_number")
        for r in rows if _get(r, "source_row_number") is not None
    }
    rule_rows, parser_type, parser_parent, has_qty = [], {}, {}, {}
    for r in rows:
        ex = _get(r, "source_row_number")
        if ex is None:
            continue
        rule_rows.append({
            'excel_row': ex, 'sl_no': _text(_get(r, "sl_no_value")),
            'description': _text(_get(r, "description")), 'unit': _text(_get(r, "unit")),
        })
        parser_type[ex] = _get(r, "classification")
        pi = _get(r, "parent_index")
        parser_parent[ex] = None if pi in (None, -1) else excel_of.get(pi)
        has_qty[ex] = _row_has_qty(r)
    by_excel = {r['excel_row']: r for r in rule_rows}

    seen: dict = {}     # identical (description, has_qty, sl shape) -> identical examples
    guidance: dict = {}
    for i, r in enumerate(rule_rows):
        ex = r['excel_row']
        similar: list = []
        if library is not None:
            key = (r['description'], has_qty[ex], sl_shape(r['sl_no']))
            if key not in seen:
                seen[key] = library.top5(
                    {'description': r['description'], 'sl_no': r['sl_no'], 'has_qty': has_qty[ex]},
                    exclude,
                )
            similar = [
                {
                    'sl_no': e['sl_no'], 'description': e['description'][:_EXAMPLE_DESC_MAX],
                    'unit': e['unit'], 'has_qty': bool(e['has_qty']),
                    'correct_row_type': e['correct_row_type'],
                }
                for e in seen[key]
            ]
        candidates = shortlist(rule_rows, i, parser_type.get, parser_parent.get)
        guidance[ex] = {
            'similar_reviewed_rows': similar,
            'candidate_parents': [
                f"row {c} | sl {by_excel[c]['sl_no']} | "
                f"{(by_excel[c]['description'] or '')[:_CANDIDATE_DESC_MAX]}"
                for c in candidates
            ] + [_TOP_LEVEL],
        }
    return guidance


def _memory_mib(field: str) -> float | None:
    """This process's VmRSS (now) or VmHWM (peak so far) in MiB; None where /proc is absent."""
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith(field + ":"):
                    return round(int(line.split()[1]) / 1024.0, 1)
    except (OSError, ValueError, IndexError):
        pass
    return None


def _release_memory() -> None:
    """Hand the freed library back to the operating system (best effort)."""
    gc.collect()
    try:
        import ctypes

        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:
        pass


def build_guidance(boq_name: str, rows: list, info: dict | None = None) -> dict:
    """The worker's ONE entry point: the guidance for every row of the sheet being checked.

    The library is RELEASED before this returns (S2), so it is not in memory during the Claude
    calls that follow. `info`, when given, is filled with what happened -- library_status
    ("ok" / "rebuilt" / "no-examples fallback"), library_seconds, lookup_seconds, and the
    process memory in MiB before the load, after the look-up, after the release and at its
    peak (library_memory_peak_mib) -- for the worker's run-log record.

    Never raises for a library problem: on any failure the pass continues WITHOUT examples
    (candidate parents only) and the boq_ai log says why. The library work sits inside a
    savepoint so a failed read cannot poison the worker's transaction (PostgreSQL aborts
    the whole transaction on an error).
    """
    t0 = time.monotonic()
    memory_before = _memory_mib("VmRSS")
    library = None
    rebuilt = False
    exclude: frozenset = frozenset()
    frappe.db.savepoint(_SAVEPOINT)
    try:
        library, rebuilt = get_library()
        exclude = revision_family(boq_name) | library.testproject
    except Exception as exc:
        library = None
        try:
            frappe.db.rollback(save_point=_SAVEPOINT)
        except Exception:
            pass
        # ERROR on purpose: the boq_ai logger writes ERROR and above only (Frappe's default
        # outside the dev server), so a warning here would never reach the log.
        logger.error(
            "boq_ai guidance: examples library unavailable for %s -- the pass continues "
            "WITHOUT examples: %s: %s", boq_name, type(exc).__name__, exc,
        )
    t1 = time.monotonic()
    guidance = guidance_for_rows(rows, library, exclude)
    t2 = time.monotonic()
    had_library = library is not None
    library_rows = library.N if had_library else 0
    memory_after_lookup = _memory_mib("VmRSS")
    memory_peak = _memory_mib("VmHWM")
    library = None      # the only reference: the examples are already copied into `guidance`
    _release_memory()
    if info is not None:
        info.update({
            "library_status": (
                "no-examples fallback" if not had_library else "rebuilt" if rebuilt else "ok"
            ),
            "library_rows": library_rows,
            "library_seconds": round(t1 - t0, 2),
            "lookup_seconds": round(t2 - t1, 2),
            "library_memory_peak_mib": memory_peak,
            "memory_before_mib": memory_before,
            "memory_after_lookup_mib": memory_after_lookup,
            "memory_after_release_mib": _memory_mib("VmRSS"),
        })
    logger.info(
        "boq_ai guidance: boq=%s rows=%s examples=%s library_rows=%s rebuilt=%s "
        "library_s=%.2f lookup_s=%.2f",
        boq_name, len(guidance), "yes" if had_library else "no",
        library_rows, rebuilt, t1 - t0, t2 - t1,
    )
    return guidance
