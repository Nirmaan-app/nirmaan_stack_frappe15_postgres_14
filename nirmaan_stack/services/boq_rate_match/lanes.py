# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""The MATCHING LANES and the MERGE (DEV2-B2 S3): for one target row, the ordered candidate list from the pool.

    candidates(target, pool)  -> {"entries": [...], "lanes": {...}, "rules": "ok" | "off" | "unavailable: <reason>"}

Ported from DEV2-S8's scratch lane step (t5_score.mjs scores, t8_final.py lanes and merge), which the bench, the
held-out set and four real BoQs measured; owner R-H2AH fixed the lanes and caps, G5 dropped MEAN, G22 (a) keeps EXACT
first. Nothing here calls a model or writes anything.

THE LANES (each a list of GROUPS, a group being one set of copies -- pool.py's group key):
  EXACT  the target's own group key: an exact copy (same normalised text, every heading, unit) that may be offered.
  W1     SCORE = 0.6 V2 + 0.4 C3 + 30 A + 0.3 V1. V2 = TF-IDF over row / parent / higher headings (0.6 / 0.25 / 0.15);
         C3 = character 3-grams of the description; A = the share of the target's own-row spec numbers the candidate
         agrees with (T2, with the DEV2-S4 fix: a number stated on one side only never demotes); V1 = the readings
         agreement (pool.py's readings view; no readings -> 0). Same discipline only; another category only at V2 >= 85
         with every shared reading equal. DEMOTED below every other row: a T2 conflict on a number the target's own row
         states, or a readings conflict. Top 30 groups, the first 10 enter the list.
  WORD   BM25 (k1 1.2, b 0.75) over all heading levels, any category. Top 10 groups, the first 3 enter.
  CARD   cards with the same head (kind + the name's last word), compared by DEV2-S3's rule (a scope exclusion, and
         dim / rating / count / material values: equal scores, a difference rejects). Top 5 groups, the first 3 enter.
         Indexed by head (owner G6 (a)); a target with no card has no CARD lane.
  RULES  rows whose server-priced signature AND values after the rules equal the target's (R-H2Q, R-H2U). Top 10, the
         first 5 enter. The target's values come from the server pricing step (pricing_step.py); a target with no
         readings has no RULES lane ("off"), and when the step is unavailable the lane says so and the rest run on.
THE MERGE: lanes in DEV2-S8's measured order EXACT, W1, WORD, CARD, RULES (LANE_ORDER; DEV2-B2 Q3 (B)), each capped (W1 10, WORD 3, CARD 3, RULES 5),
de-duplicated by group. A group's REPRESENTATIVE: a trap's original when in the group, else a member with a card, then
the most recently priced BoQ, then the key. A group with no member the target may be offered is skipped. The BoQ's own
identical rows are judged once: `dedupe_targets` groups a BoQ's targets by group key, one list per group.

WHICH ROWS A TARGET MAY BE OFFERED (pool.py): W1 and WORD (and CARD, which reads only rows W1/WORD's scan touched) use
`Pool.offered` (kept, not the target's own BoQ, not WIP, or a 2X extra); EXACT, RULES and the representatives use
`Pool.allowed` (the same without the WIP test), exactly as DEV2-S8 did.
"""
import collections
import math
import re

from nirmaan_stack.services.boq_rate_match import pool as P

CC_MIN = 85
BM_K1, BM_B = 1.2, 0.75
W1_GROUPS, WORD_GROUPS, CARD_GROUPS, RULES_GROUPS, BM_KEEP = 30, 10, 5, 10, 120
CAPS = {"W1": 10, "WORD": 3, "CARD": 3, "RULES": 5}
LANE_ORDER = ("EXACT", "W1", "WORD", "CARD", "RULES")   # DEV2-S8 t8_final.py's measured order (owner answer to DEV2-B2 Q3: "Q3:ok" -> (B))
SCOPE_EXCL = {"supply_only", "installation_only"}


# ---- T2 with the DEV2-S4 fix (w3_t2.compare3) ----
def compare3(a, b):
    conflicts, agreed = [], []
    for t in sorted(set(a) & set(b)):
        va, la = a[t]
        vb, lb = b[t]
        if any('~' in v for v in va) or any('~' in v for v in vb):
            pa, ra = P.split_ranges(va)
            pb, rb = P.split_ranges(vb)
            pa = {v for v in pa if not P.covered({v}, ra)} if ra else pa
            pb = {v for v in pb if not P.covered({v}, rb)} if rb else pb
            ok = True
            if ra and rb:
                ok = any(x[0] <= y[1] and y[0] <= x[1] for x in ra for y in rb)
            if ra and pb:
                ok = ok and P.covered(pb, ra)
            if rb and pa:
                ok = ok and P.covered(pa, rb)
            if ok:
                agreed.append((t, sorted((set(pa) & set(pb)) or (pa | pb) or {f'{x[0]}~{x[1]}' for x in ra + rb})))
                continue
            conflicts.append((t, sorted(va), sorted(vb)))
            continue
        if la < 1 and lb < 1:
            bad = bool(va - vb) and bool(vb - va)      # the S4 fix: a value left on EACH side
        else:
            bad = not (va & vb)
        if bad:
            conflicts.append((t, sorted(va), sorted(vb)))
        else:
            agreed.append((t, sorted(va & vb)))
    if conflicts:
        return 'CONFLICT', conflicts, agreed
    if agreed:
        return 'AGREE', conflicts, agreed
    return 'NO-TOKENS', conflicts, agreed


def _own_numbers(a):
    return [t for t, (vals, lvl) in a.items() if not t.startswith('w:') and lvl < 1]


def _spec(a, own, b):
    """(A, the first T2 conflict on a number of the target's own row or None)."""
    _v, conflicts, agreed = compare3(a, b)
    tc = None
    for t, va, vb in conflicts:
        if not t.startswith('w:') and a[t][1] < 1:
            tc = [t, va, vb]
            break
    if not own:
        return 0.0, tc
    ag = {t for t, _ in agreed}
    return sum(1 for t in own if t in ag) / len(own), tc


def _v1score(a, b):
    if not a or not b:
        return 0
    agree, uni = 0, len(a)
    for k, v in b.items():
        if k in a:
            if a[k] == v:
                agree += 1
        else:
            uni += 1
    return (100 * agree) / uni


def _reading_conflict(a, b):
    if not a or not b:
        return None
    for k, va in a.items():
        vb = b.get(k)
        if not vb:
            continue
        if not (va & vb):
            return [k, sorted(va), sorted(vb)]
    return None


def _card_score(tc, tv, cc, cv):
    tk, tn = P.card_head(tc)
    ck, cn = P.card_head(cc)
    if tk != ck or (tn and cn and tn != cn):
        return None
    sa, sb = (tc.get('scope') or {}).get('v'), (cc.get('scope') or {}).get('v')
    if sa and sb and sa != sb and (sa in SCOPE_EXCL or sb in SCOPE_EXCL):
        return None
    score = 0
    for k, va in tv.items():
        vb = cv.get(k)
        if not vb:
            continue
        if any(_val_eq(x, y) for x in va for y in vb):
            score += 2 if k[0] in ('dim', 'rating', 'count') else 1
        elif k[0] in ('dim', 'rating', 'count', 'material'):
            return None
    return score


def _num_set(s):
    return {float(x) for x in re.findall(r'\d+(?:\.\d+)?', s)}


def _val_eq(a, b):
    if a == b:
        return True
    na, nb = _num_set(a), _num_set(b)
    if na and nb:
        rng = lambda s: re.search(r'\d+(?:\.\d+)?to\d+(?:\.\d+)?', s)  # noqa: E731
        if rng(a) or rng(b):
            lo = min(na if rng(a) else nb), max(na if rng(a) else nb)
            return all(lo[0] <= v <= lo[1] for v in (nb if rng(a) else na))
        return na == nb
    return False


# ---- the target ----
def target_from_row(pool, key, **over):
    """A pool row as a target (its own BoQ excluded, its readings view, its server-priced values, its card)."""
    r = pool.rows[pool.byk[key]]
    t = {'key': key, 'id': key, 'kind': 'target', 'own_boq': r['boq'], 'payload': r['payload'], 'cat': r['cat'],
         'disc': r['disc'], 'project': r['project'], 'fam': r['fam'], 'unit': r['unit'], 'v1': r['v1'],
         'rules_key': r['rules_key'], 'has_readings': r['readings'] is not None, 'card': pool.index['cards'].get(key)}
    t.update(over)
    return t


def _texts(t):
    if all(f in t for f in ('self', 'parent', 'upper', 'desc')):
        return t['self'], t['parent'], t['upper'], t['desc']
    np = P.nz_payload(t['payload'])
    s, p, u = P.row_texts(np)
    return s, p, u, np.get('description') or ''


# ---- t5_score.mjs: every touched row's V2 / C3 / V1 / W1 flag, and BM25 ----
def _prep(pool):
    """Per-process work arrays and per-row constants, made once per pool (and again if its kept set is replaced)."""
    c = getattr(pool, '_lane_prep', None)
    if c is None or c['kept_id'] != id(pool.kept):
        rows, ix = pool.rows, pool.index
        n = len(rows)
        c = pool._lane_prep = {
            'kept_id': id(pool.kept), 'stamp': 0,
            'acc': [0.0] * n, 'accc': [0.0] * n, 'bm': [0.0] * n, 'mark': [0] * n,
            'boq': [r['boq'] for r in rows], 'keys': [r['key'] for r in rows], 'cat': [r['cat'] for r in rows],
            # t5_score.mjs: keptSet[j] && !wip[j] (the own-BoQ test is per target)
            'base': bytearray(1 if (r['key'] in pool.kept and not r['wip']) else 0 for r in rows),
            # BM25's per-row denominator part, K1 * (1 - B + (B * len) / avgdl), computed as t5_score.mjs computes it
            'bmden': [BM_K1 * (1 - BM_B + (BM_B * ln) / ix['avgdl']) for ln in ix['bm_len']] if n else [],
        }
    return c


def score(target, pool):
    ix, rows, n = pool.index, pool.rows, pool.index['n']
    pr = _prep(pool)
    pr['stamp'] += 1
    st = pr['stamp']
    mark, acc, accc, bmv = pr['mark'], pr['acc'], pr['accc'], pr['bm']
    i = pool.byk.get(target.get('key'), -1)
    src = rows[i] if i >= 0 else None
    selft, par, up, desc = (src['self'], src['parent'], src['upper'], src['desc']) if src else _texts(target)
    texts = {'self': selft, 'parent': par, 'upper': up}
    cat = target.get('cat') if src is None else src['cat']
    disc = target.get('disc') if src is None else src['disc']
    dset = set((disc or '').split('+'))
    v1t = P._tok_map(target.get('v1') or [])
    vst = P._tok_sets(target.get('v1') or [])
    own = target['own_boq']
    extra = target.get('extra')
    if extra is None:
        extra = pool.extra_for(own)
    allow_orig = pool.byk.get(target['of'], -1) if target.get('of') else -1
    touched = []
    vecs = {f: P.tfidf_vec(ix['vec'][f][0], n, P.toks(texts[f])) for f in P.FIELDS}
    present = [f for f in P.FIELDS if vecs[f]]
    wsum = sum(P.FIELD_WEIGHT[f] for f in present) or 1
    for f in present:
        w = P.FIELD_WEIGHT[f] / wsum
        off, ids, ws = ix['vec'][f][1]
        for tk, wt in vecs[f]:
            span = off.get(tk)
            if span is None:
                continue
            c = w * wt          # t5_score.mjs: acc[j] += w * wt * p  ==  (w * wt) * p
            a, b = span
            for j, pw in zip(ids[a:b], ws[a:b]):
                if mark[j] != st:
                    mark[j] = st
                    touched.append(j)
                acc[j] += c * pw
    off, ids, ws = ix['c3'][1]
    for tk, wt in P.tfidf_vec(ix['c3'][0], n, P.grams(desc)):
        span = off.get(tk)
        if span is None:
            continue
        a, b = span
        for j, pw in zip(ids[a:b], ws[a:b]):
            if mark[j] != st:
                mark[j] = st
                touched.append(j)
            accc[j] += wt * pw
    off, ids, cs = ix['bm_post']
    bmden = pr['bmden']
    k1p = BM_K1 + 1
    for tk in dict.fromkeys(P.wtok(f"{selft} {par} {up}")):
        span = off.get(tk)
        if span is None:
            continue
        a, b = span
        df = b - a
        idf = math.log(1 + (n - df + 0.5) / (df + 0.5))
        for j, c in zip(ids[a:b], cs[a:b]):
            bmv[j] += (idf * c * k1p) / (c + bmden[j])
            if mark[j] != st:
                mark[j] = st
                touched.append(j)
    out_rows, bm_rank, bm_val = [], [], {}
    V1, VS, discs = ix['v1'], ix['vs'], ix['discs']
    base, boqs, keys, cats = pr['base'], pr['boq'], pr['keys'], pr['cat']
    fixed = P.js_fixed
    for j in touched:
        if j == i:
            continue
        if not (j == allow_orig or (base[j] and boqs[j] != own) or keys[j] in extra):
            continue
        bm_rank.append(j)
        bm_val[j] = bmv[j]
        v2 = min(100, 100 * acc[j])
        cc = min(100, 100 * accc[j])
        same_cat = bool(cat) and cats[j] == cat
        v1 = _v1score(v1t, V1[j]) if same_cat else 0
        rc = _reading_conflict(vst, VS[j]) if same_cat else None
        w1ok = not dset.isdisjoint(discs[j])
        if w1ok and cat and cats[j] and cat != cats[j]:
            lineup = False
            if v2 >= CC_MIN and v1t and V1[j]:
                shared = eq = 0
                for k, v in v1t.items():
                    if k in V1[j]:
                        shared += 1
                        eq += V1[j][k] == v
                lineup = shared > 0 and eq == shared
            w1ok = lineup
        if j == allow_orig:
            w1ok = True
        row = [j, fixed(v2, 2), fixed(cc, 2), fixed(v1, 1), 1 if w1ok else 0]
        if rc:
            row.append(rc)
        out_rows.append(row)
    for j in touched:           # the work arrays go back to zero for the next target
        acc[j] = 0.0
        accc[j] = 0.0
        bmv[j] = 0.0
    bm_rank.sort(key=lambda j: (-bm_val[j], j))
    return {'rows': out_rows, 'bm': [[j, fixed(bm_val[j], 2)] for j in bm_rank[:BM_KEEP]]}


# ---- t8_final.py: the lanes and the merge ----
def candidates(target, pool, scored=None):
    """The target's ordered candidate list. `target`: key (a pool row's, or the new row's own), own_boq, payload, cat,
    disc, project, fam, v1 (readings view; [] = none), rules_key (signature + values from the server step; None),
    has_readings, rules_unavailable (the step's reason, if it could not run), card, and for a trap `of`."""
    ix, rows, byk = pool.index, pool.rows, pool.byk
    x = scored if scored is not None else score(target, pool)
    own_boq = target['own_boq']
    extra = target.get('extra')
    if extra is None:
        extra = pool.extra_for(own_boq)
    ori = target.get('of')
    tkey = target.get('key')

    def allowed(k):
        return pool.allowed(k, own_boq, extra, tkey, ori)

    a = P.tok(P.nz_payload(target['payload']))
    own = _own_numbers(a)
    t2 = ix['t2']
    rws = [list(r) + [0.6 * r[1] + 0.4 * r[2]] for r in x['rows']]
    text = {rows[r[0]]['key']: r[-1] for r in rws}
    wrows = [r for r in rws if r[4]]
    v1max = max((r[3] for r in wrows), default=0)
    wrows.sort(key=lambda r: -r[-1])
    scored_w1, best, scanned = {}, {}, 0
    for r in wrows:
        k = rows[r[0]]['key']
        tx = r[-1]
        if len(best) >= W1_GROUPS and scanned % 100 == 0:
            th = sorted(best.values(), reverse=True)[W1_GROUPS - 1]
            if tx + 30 + 0.3 * v1max < th:
                break
        scanned += 1
        A, tc = _spec(a, own, t2[r[0]])
        rc = r[5] if len(r) == 7 else None
        s = tx + 30 * A + 0.3 * r[3]
        why = ([{'t2': tc}] if tc else []) + ([{'reading': rc}] if rc else [])
        scored_w1[k] = {'score': round(s, 3), 'v2': r[1], 'c3': r[2], 'v1': r[3], 'a': round(A, 3), 'demoted': bool(why), 'why': why}
        if not why:
            g = rows[r[0]]['group']
            if s > best.get(g, -1):
                best[g] = s
    if len(best) < W1_GROUPS:
        for r in wrows:
            k = rows[r[0]]['key']
            if k in scored_w1:
                continue
            A, tc = _spec(a, own, t2[r[0]])
            rc = r[5] if len(r) == 7 else None
            why = ([{'t2': tc}] if tc else []) + ([{'reading': rc}] if rc else [])
            scored_w1[k] = {'score': round(r[-1] + 30 * A + 0.3 * r[3], 3), 'v2': r[1], 'c3': r[2], 'v1': r[3], 'a': round(A, 3), 'demoted': bool(why), 'why': why}
    rec_of = lambda k: rows[byk[k]]['rec'] or ''  # noqa: E731
    order = sorted(scored_w1, key=lambda k: (scored_w1[k]['demoted'], -scored_w1[k]['score'], tuple(-ord(c) for c in rec_of(k)[:19]), k))
    lane_w1, seen = [], set()
    for k in order:
        g = rows[byk[k]]['group']
        if g in seen:
            continue
        seen.add(g)
        lane_w1.append(g)
        if len(lane_w1) == W1_GROUPS:
            break
    lane_word = []
    for j, _s in x['bm']:
        g = rows[j]['group']
        if g not in lane_word:
            lane_word.append(g)
        if len(lane_word) == WORD_GROUPS:
            break
    lane_card = []
    tc = target.get('card')
    if tc:
        tv = P.card_values(tc)
        kind, name = P.card_head(tc)
        cards, cvals, by_head = ix['cards'], ix['card_vals'], ix['card_by_head']
        heads = [h for h in by_head if h[0] == kind and (not name or not h[1] or h[1] == name)]
        hits = {}
        for h in heads:
            for ck in by_head[h]:
                if ck not in byk or ck == tkey or ck not in text:
                    continue
                s = _card_score(tc, tv, cards[ck], cvals[ck])
                if s:
                    g = rows[byk[ck]]['group']
                    v = (s, text.get(ck, 0))
                    if v > hits.get(g, (0, 0)):
                        hits[g] = v
        lane_card = sorted(hits, key=lambda g: (-hits[g][0], -hits[g][1], g))[:CARD_GROUPS]
    lane_rules = []
    if target.get('rules_unavailable'):
        rules_status = f"unavailable: {target['rules_unavailable']}"
    elif not target.get('has_readings', True) or not target.get('rules_key'):
        rules_status = 'off'
    else:
        rules_status = 'ok'
        hits = {}
        for ck in ix['by_sig'].get(target['rules_key'], ()):
            if ck == tkey or not allowed(ck):
                continue
            g = rows[byk[ck]]['group']
            v = text.get(ck, 0)
            if v >= hits.get(g, -1):
                hits[g] = v
        lane_rules = sorted(hits, key=lambda g: (-hits[g], g))[:RULES_GROUPS]
    s_, p_, u_, _d = _texts({**target, **({k: rows[byk[tkey]][k] for k in ('self', 'parent', 'upper', 'desc')} if tkey in byk else {})})
    unit = rows[byk[tkey]]['unit'] if tkey in byk else target.get('unit', '')
    g0 = ix['group_of'].get(P.gkey_digest(P.group_key(s_, p_, u_, unit)))
    exact = [g0] if g0 is not None and any(allowed(k) for k in ix['members'][g0]) else []
    lanes = {'EXACT': exact, 'W1': lane_w1[:CAPS['W1']], 'WORD': lane_word[:CAPS['WORD']], 'CARD': lane_card[:CAPS['CARD']], 'RULES': lane_rules[:CAPS['RULES']]}
    merged = []
    for name in LANE_ORDER:
        for g in lanes[name]:
            if g not in merged:
                merged.append(g)
    cards = ix['cards']
    entries = []
    for g in merged:
        mem = [k for k in ix['members'][g] if allowed(k)]
        if ori and ori in byk and rows[byk[ori]]['group'] == g:
            mem = [ori] + [k for k in mem if k != ori]
            rep = ori
        elif not mem:
            continue
        else:
            rep = sorted(mem, key=lambda k: (k not in cards, tuple(-ord(c) for c in rec_of(k)[:19]), k))[0]
        r = rows[byk[rep]]
        s = scored_w1.get(rep) or next((scored_w1[k] for k in mem if k in scored_w1), None)
        entries.append({'key': rep, 'group': g, 'lanes': [nm for nm in LANE_ORDER if g in lanes[nm]], 'copies': [k for k in mem if k != rep],
                        'same_project': r['project'] == target.get('project'), 'own_family': r['fam'] == target.get('fam'),
                        'w1': s})
    return {'entries': entries, 'lanes': {**lanes, 'W1_all': lane_w1, 'WORD_all': lane_word, 'CARD_all': lane_card, 'RULES_all': lane_rules},
            'rules': rules_status, 'scanned': scanned, 'rows_scored': len(rws)}


def dedupe_targets(targets, pool):
    """A BoQ's identical rows (one group key) are judged once: {group key: [targets]} in sheet order, first = the one
    that gets a list (DEV2-S5 t3_logic.dedupe)."""
    groups = collections.OrderedDict()
    for t in targets:
        s, p, u, _d = _texts(t)
        groups.setdefault(P.group_key(s, p, u, t.get('unit', '')), []).append(t)
    return groups
