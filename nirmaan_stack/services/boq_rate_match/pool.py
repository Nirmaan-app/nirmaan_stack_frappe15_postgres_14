# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""The HISTORICAL POOL and its INDEX (DEV2-B2 S2): the priced rows historical matching may offer, cached as one file.

    ensure_pool(as_of=None)       -> Pool   (the cached file; rebuilt when missing, older than 24 h, or stale)
    build_pool(as_of=None, ...)   -> Pool   (a fresh build, written nowhere)
    pool.eligible_for(own_boq)    -> the target's candidate test: R-H2S's selected versions, 2X, own BoQ out, WIP out

WHAT A ROW IS. Every PRICED, RATE-EDITABLE row (a Line Item, or a Preamble carrying a quantity: extraction's
`_rate_editable_excel_rows` predicate) on a current committed sheet, with: its payload block (`extraction._ai_item`,
exactly what Suggest sends), category and discipline, the rate as stored (supply / install / combined, from the current
`BoQ Cell Pricing` records) and when it was priced, unit, its helper-1 readings (the active run's stored row), the
server pricing step's signature and values after the rules (with their stamp; `pricing_step.py`), the readings view W1
reads (`v1`, below) and its GROUP KEY. Every such row is in the file and in the index (the index's statistics are over
all of them, as DEV2-S8's were); which rows a target may be offered is the KEPT set plus the per-target rule.

THE RULES (owner rulings; ported from the DEV2 scratch scripts named in each step, which DEV2-S4 .. S8 measured):
  near copies (R-H2F)   two BoQs sharing >= 60 % of the smaller one's distinct normalised row descriptions (>= 10
                        shared; a description found in more than 40 BoQs says nothing) are near copies; near copies link
                        into sets. Within a set, a row whose (description, parent text) also appears in a NEWER member
                        is out: the newest copy of each row stays.                      (DEV2-R1 q1.py, DEV2-R2 a1_prep.py)
  revision families     `boq_ai_guidance.revision_family`: BoQs linked through BOQs.source_boq, either way, any depth.
  R-H2S + "1a"          per family, the SELECTED version is the latest (by creation) holding a rate whose last TEAM rate
                        change is older than `as_of` - 3 days; only its rows enter. A team rate change = a Cell Pricing
                        row whose rate or filled state differs from the prior pricing_version at the same address (or
                        the first filled one).                     (DEV2-S4 p1_families.py, p1_pool.py, reading A)
  "2x"                  a target IN the selected version also sees the next-latest settled version's rows.  (pool_s4 X)
  own BoQ               the target's own BoQ version never.
  test projects (G15)   out by the APP's rule (boq_ai_guidance.build_library): "testproject" in the project name,
                        lower-cased, spaces removed. (The scratch rule `^\\s*test` is retired.)
  WIP                   a row whose sheet's last pricing is newer than `as_of` - 3 days is not offered. (t5_score.mjs)
  groups                same normalised row text (description + own notes) + every heading level (description + notes)
                        + unit: one group's rows are copies.             (DEV2-S3 w2_prep.py, w2_norm.py)

READINGS VIEW (`v1`): the tokens W1's V1 score and reading-conflict demotion compare are the values the pricer USED for
the category's price-driving fields, read from the server step's output (attribute path: the non-disabled working
attributes; item-list path: `family=<f>` plus each block's shown field), as DEV2-R2's h2_fields2.ts pass 2 built them.
WHICH fields drive the price is MEASURED BY THE PRICER at every build (owner answer 3 to DEV2-B2 Q4, option A: the
bundle's measureDrivingFields on EVERY stored row; DEV2-B4 rule (iii): the price changes on >= 10 % of tested AND >= 5):
nothing is stored in code, so a pricing-config change reaches W1 at the next build. Step unavailable or no readings ->
no v1 tokens (W1 without V1).

THE DAILY REBUILD: `rebuild_pool()` (no arguments, under the same lock) is the one entry point a scheduled job calls;
B4 adds the daily 06:00 IST scheduler entry (cron in the site's time zone - confirm it is Asia/Kolkata). The 24 h age
check in `ensure_pool` stays as the fallback.

THE INDEX (owner G6 (a)) is built with the pool and cached in the same file: per heading level a TF-IDF over word
tokens + bigrams (self / parent / upper), a TF-IDF over character 3-grams of the description, BM25 postings over all
three levels, the readings maps, the exact-copy table, group members, the RULES table (signature + values) and the
CARD table indexed by card head. Built exactly as DEV2-S8's t5_score.mjs / t8_final.py build them.

THE CACHE (owner G7 (a), G16 (a); the examples-library pattern, boq_ai_guidance): one pickle under the site's private
folder, `private/boq_rate_match/match_pool_v<FORMAT>.pkl`, written to a temp name and renamed; read at job start;
rebuilt ON DEMAND under one FileLock when missing, older than 24 h, or its pricing stamp (code hash + asset version) is
no longer current. Nothing is written to the database.
"""
import collections
import datetime
import json
import os
import pickle
import re
import time

import frappe
from filelock import FileLock

from nirmaan_stack.services.boq_rate_match.match_text import (  # noqa: F401 -- re-exported: pool.<name> stays valid
    _NUM, t2_norm, _cnum, _WORD_NUM, _SIMPLE, _WORDS, _POLE_WORDS, t2_tokens_of_text, flat_notes, t2_levels_of, SWG, _RU, _SYNONYMS, _SYN, _rng, nz, _UNITS, _UNIT_OF, unit_norm, _nz_notes, nz_payload, _TYPE_OF_UNIT, _RNG_RE, tok, split_ranges, covered, row_texts, group_key, check_swg_table,
)
from nirmaan_stack.services.boq_rate_match.match_index import (  # noqa: F401 -- re-exported
    _LIST_SKIP, _js_str, _h2_norm, readings_view, CardSource, StoredCards, card_head, card_values, FIELDS, FIELD_WEIGHT, _TOK_RE, _WTOK_RE, toks, squeeze, grams, wtok, _tf, tfidf_build, _csr, tfidf_vec, _tok_map, _tok_sets, gkey_digest, build_index, js_fixed,
)

POOL_FORMAT = 1
POOL_MAX_AGE_SEC = 24 * 3600
REBUILD_WAIT_SEC = 900
WINDOW_DAYS = 3
KINDS = ("supply_rate", "install_rate", "combined_rate")

# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# THE POOL
# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
def is_test_project(project_name):
    """The APP's test-project rule (owner G15; boq_ai_guidance.build_library): 'testproject' in the name, lower-cased,
    spaces removed."""
    return 'testproject' in (project_name or '').lower().replace(' ', '')


def rate_editable(node_type, node_name, qty_bearing):
    """extraction._rate_editable_excel_rows' predicate: a Line Item always; a Preamble only when it carries a quantity."""
    nt = (node_type or '').strip()
    return nt == 'Line Item' or (nt == 'Preamble' and node_name in qty_bearing)


def is_priced(rates):
    return any((rates.get(k) or 0) > 0 for k in KINDS)


def is_wip(sheet_last, at):
    """A sheet priced within the last 3 days (before `at`) is still being worked on: its rows are not offered."""
    return bool(sheet_last) and datetime.datetime.fromisoformat(sheet_last) > at - datetime.timedelta(days=WINDOW_DAYS)


def _norm_text(s):
    return ' '.join(re.sub(r'[^a-z0-9.]+', ' ', (s or '').lower()).split())


def _wh_disc(w):
    w = (w or '').strip()
    if w.startswith('HVAC'):
        return 'HVAC'
    return w or None


def _iso(dt):
    return dt.isoformat(sep=' ') if isinstance(dt, datetime.datetime) else str(dt)


def _as_datetime(as_of):
    if as_of is None:
        return frappe.utils.now_datetime()
    if isinstance(as_of, datetime.datetime):
        return as_of
    return datetime.datetime.fromisoformat(str(as_of))


def near_copy_pairs(desc_by_boq, max_boqs=40, min_overlap=0.6, min_shared=10):
    """[(a, b)] near-copy BoQ pairs (DEV2-R1 q1.py): `desc_by_boq` {boq: Counter of normalised descriptions, len > 8}."""
    inv = collections.defaultdict(set)
    for b, c in desc_by_boq.items():
        for t in c:
            inv[t].add(b)
    pair = collections.Counter()
    for t, bs in inv.items():
        if len(bs) > max_boqs:
            continue
        bs = sorted(bs)
        for i in range(len(bs)):
            for j in range(i + 1, len(bs)):
                pair[(bs[i], bs[j])] += 1
    out = []
    for (a, b), n in pair.items():
        sa, sb = len(desc_by_boq[a]), len(desc_by_boq[b])
        ov = n / min(sa, sb) if min(sa, sb) else 0
        if ov >= min_overlap and n >= min_shared:
            out.append((a, b))
    return sorted(out)


def near_copy_sets(pairs):
    """Union-find over the pairs -> [set of BoQs] with 2+ members (DEV2-R2 a1_prep.py)."""
    par = {}

    def find(x):
        par.setdefault(x, x)
        while par[x] != x:
            par[x] = par[par[x]]
            x = par[x]
        return x

    for a, b in pairs:
        par[find(a)] = find(b)
    sets = collections.defaultdict(set)
    for b in list(par):
        sets[find(b)].add(b)
    return [s for s in sets.values() if len(s) > 1]


def last_team_change(cell_rows):
    """{boq: newest priced_at of a TEAM rate change} (DEV2-S4 p1_families.py). `cell_rows` in address, version order."""
    last = {}
    prev_addr, prev = None, None
    for r in cell_rows:
        addr = (r['boq'], r['sheet_name'], r['excel_row'], r['col_letter'], r['committed_version'])
        p = prev if addr == prev_addr else None
        changed = (p is None and r['is_filled']) or (p is not None and (float(p['rate'] or 0) != float(r['rate'] or 0) or p['is_filled'] != r['is_filled']))
        if changed:
            at = str(r['priced_at'])
            if at > last.get(r['boq'], ''):
                last[r['boq']] = at
        prev_addr, prev = addr, r
    return last


def select_versions(families, created, priced_count, last_change, cut):
    """R-H2S per family: (sel {member: selected version or None}, nxt {member: next-latest settled version or None})."""
    sel, nxt = {}, {}
    for members in families:
        vs = sorted(members, key=lambda b: created[b])
        settled = [b for b in vs if priced_count.get(b, 0) > 0 and (last_change.get(b) or '') <= cut]
        s = settled[-1] if settled else None
        p = settled[-2] if len(settled) > 1 else None
        for m in members:
            sel[m], nxt[m] = s, p
    return sel, nxt


def kept_keys(rows, sel, near_sets, created):
    """KEPT (R-H2S reading A + R-H2F near copies + the test rule): the rows any target may be offered."""
    by_boq = collections.defaultdict(list)
    for r in rows:
        by_boq[r['boq']].append(r)
    test = {r['boq'] for r in rows if r['test']}
    out_ver = {m for m in sel if m != sel[m]}
    e = set(by_boq) - test - out_ver
    dropped = set()
    ident = lambda r: (_norm_text(r['payload'].get('description')), _norm_text(r['parent_raw']))  # noqa: E731
    for s in near_sets:
        real = [m for m in sorted(s) if m in e]
        newest = {}
        for m in sorted(real, key=lambda b: created[b]):
            for r in by_boq.get(m, []):
                newest[ident(r)] = m
        for m in real:
            for r in by_boq.get(m, []):
                if newest.get(ident(r)) != m:
                    dropped.add(r['key'])
    return {r['key'] for r in rows if not (r['test'] or r['boq'] in out_ver or r['key'] in dropped)}


class Pool:
    """The built pool: rows (list, index i), kept keys, the selection, WIP flags, the index."""

    def __init__(self, state):
        self.__dict__.update(state)
        self.byk = {r['key']: i for i, r in enumerate(self.rows)}

    def state(self):
        return {k: v for k, v in self.__dict__.items() if k != 'byk' and not k.startswith('_')}

    def allowed(self, key, own_boq, extra=(), target_key=None, original=None):
        """t8_final.py's eligible(): a trap's original, a 2X extra, or a KEPT row of another BoQ that is not the target."""
        return key == original or key in extra or (key in self.kept and key.split('|')[0] != own_boq and key != target_key)

    def offered(self, i, own_boq, extra=(), original=None):
        """t5_score.mjs's eligible (W1, WORD, and the CARD lane through them): allowed, and not WIP. `i` = row index."""
        key = self.rows[i]['key']
        return key == original or key in extra or (key in self.kept and key.split('|')[0] != own_boq and not self.rows[i]['wip'])

    def extra_for(self, own_boq):
        """2X: a target in its family's selected version also sees the next-latest settled version's rows."""
        if self.sel.get(own_boq) == own_boq and self.nxt.get(own_boq):
            return {r['key'] for r in self.rows if r['boq'] == self.nxt[own_boq] and not r['test'] and r['key'] not in self.kept}
        return set()


def _corpus(progress=None):
    """Every current committed sheet's rows, read only (DEV2-R1 dump_corpus.py + common.load + DEV2-R2 a1_prep.py)."""
    from nirmaan_stack.services.boq_category import persist
    from nirmaan_stack.services.boq_category.context_builder import build_sheet_context
    from nirmaan_stack.services.boq_rate_master.extraction import _ai_item, _resolved_categories

    boqs = {b['name']: b for b in frappe.db.sql('''select b.name, b.project, p.project_name, b.boq_name, b.creation, b.source_boq
        from "tabBOQs" b left join "tabProjects" p on p.name = b.project''', as_dict=True)}
    sheets = frappe.db.sql('select name, boq, sheet_name, commit_version from "tabBoQ Sheet" where is_current=1 order by boq, sheet_name', as_dict=True)
    wh = collections.defaultdict(list)
    for r in frappe.db.sql('select parent, work_header from "tabBoQ Sheet Work Package"', as_dict=True):
        wh[r['parent']].append(r['work_header'])
    hist = collections.defaultdict(list)
    cells = frappe.db.sql('''select name, boq, sheet_name, excel_row, col_letter, committed_version, rate_kind, rate, is_filled, is_current,
        pricing_version, priced_at from "tabBoQ Cell Pricing"
        order by boq, sheet_name, excel_row, col_letter, committed_version, pricing_version, name''', as_dict=True)   # a total key (boq-rate-master.md invariant)
    for r in cells:
        hist[(r['boq'], r['sheet_name'])].append(r)
    votes = collections.defaultdict(set)
    for r in frappe.db.sql('select boq, sheet_name, committed_version, excel_row, discipline from "tabBoQ Row Category" where is_current=1', as_dict=True):
        votes[(r['boq'], r['sheet_name'], r['committed_version'], r['excel_row'])].add(r['discipline'])
    desc_by_boq = collections.defaultdict(collections.Counter)
    sheet_last, rows = {}, []
    for i, s in enumerate(sheets):
        boq, sn, cv = s['boq'], s['sheet_name'], s['commit_version']
        h = hist.get((boq, sn), [])
        if h:
            sheet_last[(boq, sn)] = max(str(x['priced_at']) for x in h)
        cur = collections.defaultdict(dict)
        for r in h:
            if r['committed_version'] == cv and r['is_current']:
                cur[r['excel_row']][r['rate_kind']] = (float(r['rate'] or 0), str(r['priced_at']))
        nodes = frappe.db.sql('''select name, source_row_number, node_type, qty, unit, description, supply_rate, install_rate, combined_rate
            from "tabBOQ Nodes" where boq=%s and sheet=%s and is_current=1''', (boq, s['name']), as_dict=True)
        qtyb = persist._qty_bearing_node_names(nodes)
        by_row = {n['source_row_number']: n for n in nodes}
        ctx = build_sheet_context(boq, sn)
        resolved = _resolved_categories(boq, sn, cv)
        whs = sorted({_wh_disc(w) for w in wh.get(s['name'], []) if _wh_disc(w)})
        for row in ctx['rows']:
            er = row['excel_row']
            nd = by_row.get(er) or {}
            nt = (nd.get('node_type') or '').strip()
            item = _ai_item(row)
            t = _norm_text(item.get('description'))
            if len(t) > 8:
                desc_by_boq[boq][t] += 1
            rates = {k: v[0] for k, v in cur.get(er, {}).items()}
            if not (rate_editable(nt, nd.get('name'), qtyb) and is_priced(rates)):
                continue
            cat, cdisc = resolved.get(er, ('', None))
            vd = sorted(votes.get((boq, sn, cv, er), []))
            disc = cdisc or (vd[0] if len(vd) == 1 else (whs[0] if len(whs) == 1 else ('+'.join(whs) if whs else '(none)')))
            rows.append({'boq': boq, 'sheet': sn, 'row': er, 'cv': cv, 'cat': cat or '', 'disc': disc, 'unit_raw': nd.get('unit'),
                         'node_type': nt, 'rates': {k: v for k, v in rates.items() if v and v > 0},
                         'rate_at': {k: v[1] for k, v in cur.get(er, {}).items()}, 'payload': item})
        if progress and i % 100 == 0:
            progress(i, len(sheets))
    return boqs, sheets, cells, sheet_last, desc_by_boq, rows


def build_pool(as_of=None, card_source=None, row_order=None, asset=None, progress=None):
    """Build the pool and its index from the live data (READ ONLY). `as_of` (default now) sets the 3-day windows.
    `row_order` (a list of keys) only fixes the rows' order -- and so group numbering and index ties -- to reproduce an
    earlier build; production orders rows by key. Nothing is written."""
    from nirmaan_stack.services.boq_ai_guidance import revision_family
    from nirmaan_stack.services.boq_rate_match import pricing_step

    t0 = time.time()
    at = _as_datetime(as_of)
    cut = _iso(at - datetime.timedelta(days=WINDOW_DAYS))
    boqs, sheets, cells, sheet_last, desc_by_boq, raw = _corpus(progress)
    t_corpus = time.time()

    # the rows as matching reads them
    fam_root, fam_sets = {}, {}
    for b in boqs:
        if b not in fam_sets:
            f = revision_family(b)
            for m in f:
                fam_sets[m] = f
        fam_root[b] = min(fam_sets[b])
    boq_last = {}
    for (b, sn), last in sheet_last.items():
        if last > boq_last.get(b, ''):
            boq_last[b] = last
    rows = []
    for r in raw:
        b = boqs[r['boq']]
        npay = nz_payload(r['payload'])
        selft, par, up = row_texts(npay)
        par_raw = ''
        for a in r['payload'].get('ancestor_chain') or []:
            if a.get('distance') == 1:
                par_raw = ' '.join([a.get('description') or ''] + flat_notes(a.get('notes')))
        created = str(b['creation'])[:19]
        rows.append({**r, 'key': f"{r['boq']}|{r['sheet']}|{r['row']}", 'project': b['project'], 'project_name': b['project_name'],
                     'boq_name': b['boq_name'], 'fam': fam_root[r['boq']], 'test': is_test_project(b['project_name']),
                     'created': created, 'rec': boq_last.get(r['boq'], '')[:19] or created,
                     'sheet_last': sheet_last.get((r['boq'], r['sheet']), '')[:19],
                     'self': selft, 'parent': par, 'upper': up, 'desc': npay.get('description') or '', 'unit': unit_norm(r['unit_raw']),
                     'parent_raw': par_raw, 'readings': None, 'v1': [], 'signature': None, 'values_after_rules': None,
                     'priced_by_rules': False, 'rules_key': None, 'pricing_stamp': None})
    if row_order is not None:
        pos = {k: i for i, k in enumerate(row_order)}
        rows.sort(key=lambda r: (pos.get(r['key'], len(pos)), r['key']))
    else:
        rows.sort(key=lambda r: r['key'])
    gid = {}
    for r in rows:
        r['group'] = gid.setdefault(group_key(r['self'], r['parent'], r['upper'], r['unit']), len(gid))

    # readings + the server pricing step (S1) for every row with a stored active run
    asset = asset if asset is not None else pricing_step.load_asset()
    check_swg_table(asset[0]['configs'])
    byk = {r['key']: r for r in rows}
    page_rows, step_rows = {}, []
    for b, sn in frappe.db.sql('select boq, sheet_name from "tabBoQ Rate Suggestion Run" where active=1 order by boq, sheet_name'):
        p, rr = pricing_step.sheet_inputs(b, sn)
        page_rows.update(p)
        step_rows += rr
    t_inputs = time.time()
    step = pricing_step.price_rows(page_rows, step_rows, asset=asset)
    t_priced = time.time()
    driving = pricing_step.measure_driving_fields(page_rows, step_rows, asset=asset)
    t_driving = time.time()
    stored = {f"{x['boq']}|{x['sheet_name']}|{x['excel_row']}": x for x in step_rows}
    for k, x in stored.items():
        r = byk.get(k)
        if r is None:
            continue
        r['readings'] = {'attributes': x.get('attributes'), 'items': x.get('items')}
        got = step['rows'].get(k)
        if got:
            r['v1'] = readings_view(got['rec'].get('cat'), got['rec'], got['ac7'], x, driving['lists'])   # the pricer's category (h2's)
            r['signature'], r['values_after_rules'] = got['signature'], got['values_after_rules']
            r['priced_by_rules'], r['pricing_stamp'] = got['priced'], got['stamp']
            if got['priced'] and got['signature']:
                r['rules_key'] = got['signature'] + '|' + json.dumps(got['values_after_rules'], sort_keys=True)
    t_step = time.time()

    # the selection
    created = {b: str(v['creation']) for b, v in boqs.items()}
    priced_count = collections.Counter(r['boq'] for r in rows)
    families = sorted({frozenset(f) for f in fam_sets.values() if len(f) > 1}, key=lambda f: sorted(f))
    sel, nxt = select_versions([sorted(f) for f in families], created, priced_count, last_team_change(cells), cut)
    near = near_copy_sets(near_copy_pairs(desc_by_boq))
    kept = kept_keys(rows, sel, near, created)
    for r in rows:
        r.pop('parent_raw', None)   # used by the near-copy rule only
    for r in rows:
        r['wip'] = is_wip(r['sheet_last'], at)
    cards = (card_source or StoredCards()).cards_for([(r['key'], r['payload']) for r in rows])
    index = build_index(rows, cards)
    t_end = time.time()
    return Pool({
        'format': POOL_FORMAT, 'as_of': _iso(at), 'cut': cut, 'built_at': _iso(frappe.utils.now_datetime()),
        'rows': rows, 'kept': kept, 'sel': sel, 'nxt': nxt, 'near_sets': [sorted(s) for s in near], 'index': index,
        'pricing': {'available': step['available'], 'reason': step['reason'], 'stamp': step['stamp']},
        'driving': {'available': driving['available'], 'reason': driving['reason'], 'lists': driving['lists'],
                    'categories': {c: {k: v[k] for k in ('rows', 'pricedRows', 'sampled')} for c, v in driving['categories'].items()}},
        'secs': {'corpus': round(t_corpus - t0, 1), 'inputs': round(t_inputs - t_corpus, 1), 'pricing_step': round(t_priced - t_inputs, 1),
                 'driving_fields': round(t_driving - t_priced, 1), 'readings_view': round(t_step - t_driving, 1),
                 'selection_index': round(t_end - t_step, 1), 'total': round(t_end - t0, 1)},
    })


# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# THE CACHE (the examples-library pattern)
# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
def pool_path():
    """The pool file, under the site's own private folder (filesystem only); its name carries the format."""
    return frappe.get_site_path('private', 'boq_rate_match', f'match_pool_v{POOL_FORMAT}.pkl')


def is_fresh(path):
    try:
        return (time.time() - os.path.getmtime(path)) < POOL_MAX_AGE_SEC
    except OSError:
        return False


def save_pool(pool, path):
    """Write to a temp name, then rename: a reader never sees a half-written file."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f'{path}.{os.getpid()}.tmp'
    try:
        with open(tmp, 'wb') as f:
            pickle.dump(pool.state(), f, protocol=5)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def load_pool(path):
    # The file is written only by save_pool, under the site's private folder.
    with open(path, 'rb') as f:
        return Pool(pickle.load(f))


def _current_stamp():
    from nirmaan_stack.services.boq_rate_match import pricing_step
    try:
        code = pricing_step.read_code_stamp()
        return pricing_step.current_stamp(code, pricing_step.load_asset()[1])
    except pricing_step.Unavailable:
        return None


def _usable(path, stamp):
    """The cached pool when it is fresh, readable and was built by the current pricing code on the current asset."""
    if not is_fresh(path):
        return None
    try:
        pool = load_pool(path)
    except Exception as exc:  # noqa: BLE001
        frappe.logger('boq_rate_match').warning('match pool file unreadable, rebuilding: %s: %s', type(exc).__name__, exc)
        return None
    if getattr(pool, 'format', None) != POOL_FORMAT or (pool.pricing or {}).get('stamp') != stamp:
        return None
    return pool


def rebuild_pool():
    """THE DAILY REBUILD (no arguments): build the pool now and replace the cached file, under the same lock as
    ensure_pool. The entry point a scheduled job calls as it is (B4 adds the 06:00 IST entry). -> a short summary."""
    path = pool_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with FileLock(path + '.lock', timeout=REBUILD_WAIT_SEC):
        pool = build_pool()
        save_pool(pool, path)
    return {'path': path, 'rows': len(pool.rows), 'kept': len(pool.kept), 'as_of': pool.as_of, 'secs': pool.secs,
            'pricing': pool.pricing, 'driving': {k: pool.driving[k] for k in ('available', 'reason')}}


def ensure_pool(path=None, builder=None):
    """(pool, rebuilt_by_this_call). A fresh, current file is loaded; a missing / older than 24 h / stale one is rebuilt
    ON DEMAND under one lock (a second caller waits, then loads the file the first one wrote)."""
    path = path or pool_path()
    stamp = _current_stamp()
    pool = _usable(path, stamp)
    if pool is not None:
        return pool, False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with FileLock(path + '.lock', timeout=REBUILD_WAIT_SEC):
        pool = _usable(path, stamp)
        if pool is not None:
            return pool, False
        pool = (builder or build_pool)()
        save_pool(pool, path)
        return pool, True
