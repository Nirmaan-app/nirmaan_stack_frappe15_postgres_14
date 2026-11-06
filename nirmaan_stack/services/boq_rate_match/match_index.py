# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""The READINGS VIEW, the CARD interface and the lanes' INDEX (DEV2-B2; split out of pool.py by the 500-line rule). See
pool.py's docstring for what each is; built by pool.build_pool and cached with the pool."""
import collections
import hashlib
import json
import math
import re
from array import array
from decimal import ROUND_HALF_UP, Decimal

import frappe

from nirmaan_stack.services.boq_rate_match.match_text import nz, nz_payload, tok, group_key


# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# THE READINGS VIEW (DEV2-B2 Q4 (A)): DEV2-R2 h2_fields2.ts pass 2, over the server step's output; the driving
# fields are MEASURED by the pricer at every pool build (pricing_step.measure_driving_fields), never stored here
# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_LIST_SKIP = ('family', 'item_name', 'item', 'pipe_type')


def _js_str(v):
    """String(v) as JavaScript writes the values these fields hold (JSON numbers, strings, booleans)."""
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, float) and v == int(v) and abs(v) < 1e21:
        return str(int(v))
    return str(v)


def _h2_norm(v):
    return None if v is None else re.sub(r'\s+', ' ', _js_str(v).strip().lower())


def readings_view(cat, rec, ac7, row, driving):
    """W1's readings tokens for one row (h2_fields2.ts pass 2): `rec` / `ac7` are the server step's records for the
    row, `row` its stored readings (for an item list's raw fallback), `driving` {category: [field ids]} as the pricer
    measured them at this pool build."""
    drv = (driving or {}).get(cat or '', ())
    toks = []
    lst = (ac7 or {}).get('list')
    if lst:
        for i, blk in enumerate(lst.get('items') or []):
            fam = _h2_norm(blk.get('family'))
            fam = '?' if fam is None else fam
            toks.append(f'family={fam}')
            shown = {}
            for f in blk.get('fields') or []:
                v = f.get('value')
                if v is None:
                    v = f.get('typed')
                shown[f['id']] = v
            raw_items = (row or {}).get('items') or []
            raw = ((raw_items[i] if i < len(raw_items) else None) or {}).get('attributes') or {}
            for fid in drv:
                if fid in _LIST_SKIP:
                    continue
                v = shown[fid] if fid in shown else ((raw.get(fid) or {}).get('value') if isinstance(raw.get(fid), dict) else None)
                if v is not None and _js_str(v).strip() != '':
                    toks.append(f'{fam}.{fid}={_h2_norm(v)}')
    elif (rec or {}).get('mode') == 'attr':
        dset = set(drv)
        for f in rec.get('finals') or []:
            if f.get('item') is not None or f['id'] not in dset:
                continue
            v = f.get('value')
            if v is not None and _js_str(v).strip() != '':
                toks.append(f"{f['id']}={_h2_norm(v)}")
    return toks


# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# THE CARD INTERFACE: the CARD lane reads cards through one small interface
# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
class CardSource:
    """{row key: card dict} for the rows asked about. Production reads the BoQ Row Spec Card store."""

    def cards_for(self, rows):  # rows: [(key, payload)]
        raise NotImplementedError


class StoredCards(CardSource):
    """The production reader: a `BoQ Row Spec Card` with status ok, by the row's payload_sha256 + the card prompt's
    version + the card model from the AI settings (never a model name in code)."""

    def __init__(self, model=None):
        self.model = model

    def cards_for(self, rows):
        from nirmaan_stack.api.boq.wizard import ai_settings
        from nirmaan_stack.services.boq_rate_match import cards as C

        model = self.model or ai_settings.get_boq_match_settings().get('match_card_model')
        if not model:
            return {}
        version = C.prompt_version()
        by_sha = collections.defaultdict(list)
        for key, payload in rows:
            by_sha[C.payload_sha256(payload)].append(key)
        out = {}
        shas = list(by_sha)
        for i in range(0, len(shas), 500):
            for r in frappe.get_all(C.CARD_DOCTYPE, filters={'payload_sha256': ['in', shas[i:i + 500]], 'prompt_version': version,
                                                             'model': model, 'status': 'ok'}, fields=['payload_sha256', 'card_json']):
                card = json.loads(r['card_json']) if isinstance(r['card_json'], str) else r['card_json']
                if card:
                    for key in by_sha[r['payload_sha256']]:
                        out[key] = card
        return out


def card_head(c):
    """(kind value, the last word of the kind's name): the CARD lane compares only cards with equal heads."""
    kind = c.get('kind') or {}
    name = (kind.get('name') or '').strip().lower()
    return kind.get('v'), (name.split()[-1] if name else None)


def card_values(c):
    out = {}
    for sec in ('dim', 'rating', 'count', 'material', 'type', 'finish'):
        for e in c.get(sec) or []:
            if not isinstance(e, dict) or e.get('v') in (None, ''):
                continue
            k = (sec, str(e.get('n') or '').lower())
            out.setdefault(k, []).append(nz(f"{e.get('v')} {e.get('u') or ''}".strip()))
    return out


# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# THE INDEX: t5_score.mjs's TF-IDF / 3-gram / BM25 and t8_final.py's tables, in Python
# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
FIELDS = ('self', 'parent', 'upper')
FIELD_WEIGHT = {'self': 0.6, 'parent': 0.25, 'upper': 0.15}
_TOK_RE = re.compile(r'[a-z]+|\d+(?:\.\d+)?')
_WTOK_RE = re.compile(r'\d+(?:\.\d+)?to\d+(?:\.\d+)?|[a-z]+|\d+(?:\.\d+)?')


def toks(s):
    w = _TOK_RE.findall(s or '')
    o = [x for x in w if len(x) > 1 or any(ch.isdigit() for ch in x)]
    n = len(o)
    for i in range(n - 1):
        o.append(o[i] + '_' + o[i + 1])
    return o


def squeeze(s):
    s = (s or '').lower()
    s = re.sub('[×*]', 'x', s)
    s = re.sub(r'(\d)\.(\d)', '\\1\u0001\\2', s)
    s = re.sub('[^a-z0-9\u0001]+', '', s)
    return s.replace('\u0001', '.')


def grams(desc):
    s = squeeze(desc)
    if not s:
        return []
    if len(s) < 3:
        return [s]
    return [s[i:i + 3] for i in range(len(s) - 2)]


def wtok(s):
    return _WTOK_RE.findall(s or '')


def _tf(tokens):
    m = {}
    for t in tokens:
        m[t] = m.get(t, 0) + 1
    return m


def tfidf_build(token_lists):
    """(df, postings) over the documents, exactly as t5_score.mjs build(): w = (1 + ln c) * ln(N / df), unit length per
    document. Postings are compact: {token: (start, end)} into `ids` (array of row indexes) and `ws` (array of weights),
    in row order -- the order t5_score.mjs appends them. A document's own vector is never stored: `tfidf_vec` rebuilds
    it from its tokens with the same formula, in the same order, so it is the same numbers."""
    n = len(token_lists)
    df, tfs = {}, []
    for tl in token_lists:
        m = _tf(tl)
        tfs.append(m)
        for t in m:
            df[t] = df.get(t, 0) + 1
    lists = {}
    for i, m in enumerate(tfs):
        v, nn = [], 0.0
        for t, c in m.items():
            w = (1 + math.log(c)) * math.log(n / df[t])
            if w > 0:
                v.append((t, w))
                nn += w * w
        nn = math.sqrt(nn) or 1
        for t, w in v:
            lists.setdefault(t, []).append((i, w / nn))
    return df, _csr(lists, 'd')


def _csr(lists, kind):
    offsets, ids, vals = {}, array('i'), array(kind)
    for t, entries in lists.items():
        a = len(ids)
        for i, x in entries:
            ids.append(i)
            vals.append(x)
        offsets[t] = (a, len(ids))
    return offsets, ids, vals


def tfidf_vec(df, n, tokens):
    """A document's vector over an existing index (t5_score.mjs vecOf; for a pool row it equals build()'s own)."""
    v, nn = [], 0.0
    for t, c in _tf(tokens).items():
        d = df.get(t)
        if not d:
            continue
        w = (1 + math.log(c)) * math.log(n / d)
        if w > 0:
            v.append([t, w])
            nn += w * w
    nn = math.sqrt(nn) or 1
    for e in v:
        e[1] /= nn
    return v


def _tok_map(lst):
    m = {}
    for t in lst or []:
        k = t.index('=')
        key, val = t[:k], t[k + 1:]
        if key == 'family':
            m['family:' + val] = '1'
        else:
            m[key] = val
    return m


def _tok_sets(lst):
    m = {}
    for t in lst or []:
        k = t.index('=')
        m.setdefault(t[:k], set()).add(t[k + 1:])
    return m


def gkey_digest(gk):
    return hashlib.sha1(gk.encode('utf-8')).digest()


def build_index(rows, cards):
    """The lanes' index over every pool row (t5_score.mjs top + t8_final.py tables)."""
    n = len(rows)
    vec = {f: tfidf_build([toks(r[f]) for r in rows]) for f in FIELDS}
    c3 = tfidf_build([grams(r['desc']) for r in rows])
    bm_docs = [wtok(f"{r['self']} {r['parent']} {r['upper']}") for r in rows]
    avgdl = sum(len(d) for d in bm_docs) / n if n else 0.0
    bm_lists = {}
    for i, d in enumerate(bm_docs):
        for t, c in _tf(d).items():
            bm_lists.setdefault(t, []).append((i, c))
    group_of, members, by_sig = {}, collections.defaultdict(list), collections.defaultdict(list)
    for r in rows:
        # one group = one group key: the exact-copy table maps the key (by digest) to its group
        group_of[gkey_digest(group_key(r['self'], r['parent'], r['upper'], r['unit']))] = r['group']
        members[r['group']].append(r['key'])
        if r.get('rules_key'):
            by_sig[r['rules_key']].append(r['key'])
    card_vals = {k: card_values(c) for k, c in cards.items()}
    by_head = collections.defaultdict(list)
    for k, c in cards.items():
        by_head[card_head(c)].append(k)
    return {
        'n': n, 'vec': vec, 'c3': c3, 'bm_len': array('i', (len(d) for d in bm_docs)), 'avgdl': avgdl, 'bm_post': _csr(bm_lists, 'i'),
        'v1': [_tok_map(r['v1']) for r in rows], 'vs': [_tok_sets(r['v1']) for r in rows],
        't2': [tok(nz_payload(r['payload'])) for r in rows],   # each row's T2 spec tokens (W1's number check), built once
        'discs': [set((r['disc'] or '').split('+')) for r in rows],
        'group_of': group_of, 'members': dict(members), 'by_sig': dict(by_sig),
        'cards': cards, 'card_vals': card_vals, 'card_by_head': dict(by_head),
    }


def js_fixed(x, places):
    """+x.toFixed(places) as JavaScript computes it: the exact binary value, a tie rounded up. Python's round() is
    correctly rounded too and differs only on an exact tie (it rounds half to even), so only a value that may sit on a
    tie takes the exact Decimal path."""
    m = 10 ** places
    if (x * m) % 1 != 0.5:
        return round(x, places)
    return float(Decimal(x).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))

