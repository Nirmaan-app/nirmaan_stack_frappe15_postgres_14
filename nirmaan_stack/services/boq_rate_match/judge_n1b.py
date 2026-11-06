# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""N1b, THE SIZE CHECK AFTER THE JUDGE (DEV2-B3 S2; owner R-H2AH "the Haiku judge ... + N1b", R-H2AC), and the view of
the pricer's own output the judge's payload carries ("values after the pricing rules").

Ported unchanged from DEV2-S8's scratch n1.py / n1b.py, which the bench measured (DEV2-S6 .. S8). A SAME the judge
gave becomes CLOSE when:
  (a) both rows have a PRICED reading by the pricing rules and a field the rules READ (the record's `finals`) has
      different final values, or a priced item family is on one side only. Not compared: __unit__, __family__ (as a
      field), unit_class, family, item, *_as_written; a blank ("None", "", null, "Unclear") on either side.
  (b) otherwise, when the TARGET has NO pricing config: a T2 conflict (lanes.compare3, the DEV2-S4 fix) on a NUMBER the
      target's own row or nearest heading states (level <= 1), of the same kind on both sides.
  (c) otherwise (the target HAS a config, at least one row has no priced reading): the same T2 conflict counts only
      if a differing number is a value of a field the rules read on a row whose rules ran (the candidate's numbers
      against its own finals, the target's against its own). No finals on either side: it does not fire.
R-H2T: a spec the rules do not read is not in `finals`, so (a) never fires on it.

The records come from B2's server pricing step (`pricing_step.price_rows` -> each row's `rec`: priced, lines, finals),
which runs the browser's own pricing code; nothing here prices. This module only READS that output.
"""
import re

from nirmaan_stack.services.boq_rate_match import lanes as L
from nirmaan_stack.services.boq_rate_match import match_text as MT

SKIP = re.compile(r'^(__unit__|__family__|unit_class|family|item)$|_as_written$')
BLANK = (None, '', 'None', 'none', 'Unclear', 'unclear')

# the payload's "values after the pricing rules" (DEV2-S6 j8_common.after_of_rec, unchanged)
_AFTER_SKIP_FIELD = re.compile(r'^(__qty__|__unit__|__family__|family|unit_class|item)$')


def after_values(rec):
    """The pricer's output as the judge reads it: {"items": ["<SKU name> x <qty>", ...], "fields": {"<item>: <id>":
    value}}, or None when the rules did not price the row. Pipeline lines and bare identifiers are not items."""
    if not rec or not rec.get('priced'):
        return None
    items, seen = [], set()
    for line, uid, name, qty in rec.get('lines') or []:
        if str(uid).startswith('(pipeline') or re.fullmatch(r'[a-z0-9_]+', str(name)):
            continue
        s = f'{name} x {qty}'
        if s not in seen:
            seen.add(s)
            items.append(s)
    fields = {}
    for f in rec.get('finals') or []:
        v = f['value']
        if v in (None, '', 'None') or _AFTER_SKIP_FIELD.match(f['id']):
            continue
        fields[(f['item'] + ': ' if f['item'] else '') + f['id']] = v
    return {'items': items, 'fields': fields}


# ---- rule (a): the rules' own reading ----
def nv(v):
    if isinstance(v, (int, float)):
        return str(float(v))
    s = str(v).strip().lower()
    try:
        return str(float(s))
    except ValueError:
        return re.sub(r'\s+', ' ', s)


def fields(rec):
    out = {}
    for f in rec['finals']:
        i = f['id']
        if SKIP.search(i):
            continue
        out[(f['item'], i)] = f['value']   # the selection comes after the read value in finals: the last one stands
    return out


def families(rec):
    return {f['value'] for f in rec['finals'] if f['id'] == '__family__' and f['value'] not in BLANK}


def rule_a(ta, ca):
    fa, fb = families(ta), families(ca)
    if fa and fb and fa != fb:
        return {'rule': 'a', 'field': '__family__', 'target': sorted(map(str, fa)), 'candidate': sorted(map(str, fb))}
    A, B = fields(ta), fields(ca)
    for k in sorted(set(A) & set(B), key=str):
        va, vb = A[k], B[k]
        if va in BLANK or vb in BLANK:
            continue
        if nv(va) != nv(vb):
            return {'rule': 'a', 'field': f'{k[0] + "." if k[0] else ""}{k[1]}', 'target': va, 'candidate': vb}
    return None


# ---- rules (b) and (c): the text's numbers ----
def tok(payload):
    return MT.tok(MT.nz_payload(payload))


def rule_b(tp, cp):
    a, b = tok(tp), tok(cp)
    _v, conflicts, _agreed = L.compare3(a, b)
    for t, va, vb in conflicts:
        if t.startswith('w:'):
            continue
        if a[t][1] > 1:
            continue
        return {'rule': 'b', 'token': t, 'target': va, 'candidate': vb, 'target_level': a[t][1]}
    return None


def nums(v):
    return {float(x) for x in re.findall(r'\d+(?:\.\d+)?', str(v))}


def read_numbers(rec):
    out = {}
    for (item, fid), v in fields(rec).items():
        if v in BLANK:
            continue
        for n in nums(v):
            out.setdefault(n, f'{item + "." if item else ""}{fid}')
    return out


def rule_c(ta, ca, tp, cp):
    a, b = tok(tp), tok(cp)
    _v, conflicts, _agreed = L.compare3(a, b)
    rt = read_numbers(ta) if ta else {}
    rc = read_numbers(ca) if ca else {}
    for t, va, vb in conflicts:
        if t.startswith('w:'):
            continue
        if a[t][1] > 1:
            continue
        sa = set().union(*[nums(x) for x in va]) if va else set()
        sb = set().union(*[nums(x) for x in vb]) if vb else set()
        for n in sorted(sa - sb):
            if n in rt:
                return {'rule': 'c', 'token': t, 'target': va, 'candidate': vb, 'read_field': rt[n], 'side': 'target', 'number': n}
        for n in sorted(sb - sa):
            if n in rc:
                return {'rule': 'c', 'token': t, 'target': va, 'candidate': vb, 'read_field': rc[n], 'side': 'candidate', 'number': n}
    return None


def check(trec, crec, tpayload, cpayload, target_has_config):
    """None, or the reason a SAME is not SAME: {'rule': 'a' | 'b' | 'c', ...}. `trec` / `crec` are the pricing step's
    records ({priced, finals, ...}) or None (no reading); `target_has_config`: the target's category has a pricing
    config in the rate asset."""
    if trec and crec and trec.get('priced') and crec.get('priced'):
        return rule_a(trec, crec)
    if not target_has_config:
        return rule_b(tpayload, cpayload)
    return rule_c(trec, crec, tpayload, cpayload)


def note(r):
    """One line for the panel and the reports: what N1b found."""
    if not r:
        return None
    what = r.get('field') or r.get('read_field') or r.get('token')
    return f"size check ({r['rule']}): {what} {r.get('target')} vs {r.get('candidate')}"
