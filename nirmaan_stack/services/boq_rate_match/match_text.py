# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""The NORMALISER historical matching reads (DEV2-B2; split out of pool.py by the 500-line rule): DEV2-R2 t2.py's spec
tokens and DEV2-S3 w2_norm.py's one form for units, sizes, numbers and synonyms, unchanged in behaviour; the group key."""
import re


# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# THE NORMALISER -- DEV2-R2 t2.py (T2 spec tokens) and DEV2-S3 w2_norm.py (G4), unchanged in behaviour.
# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_NUM = r'(\d+(?:\.\d+)?)'


def t2_norm(s):
    s = (s or '').lower().replace('×', 'x').replace('*', ' x ').replace('\u00a0', ' ').replace('’', "'")
    s = s.replace('”', '"').replace('″', '"').replace("''", '"')
    s = s.replace('²', '2').replace('½', '.5').replace('–', '-').replace('—', '-')
    s = re.sub(r'\bsq\s*\.?\s*m\s*\.?\s*m\b\.?|\bsqmm\b\.?|\bsq\.?\s*mm\b\.?|\bmm\s*2\b|\bsqmm\.', ' sqmm ', s)
    s = re.sub(r'(\d)\s*sqmm', r'\1 sqmm', s)
    return re.sub(r'\s+', ' ', s).strip()


def _cnum(v):
    try:
        f = float(v)
    except ValueError:
        return v.replace(' ', '')
    return str(int(f)) if f == int(f) else str(f)


_WORD_NUM = {'single': '1', 'one': '1', 'twin': '2', 'two': '2', 'double': '2', 'three': '3', 'triple': '3', 'four': '4'}
_SIMPLE = {
    'sqmm': _NUM + r'\s*sqmm\b',
    'amp': _NUM + r'\s*(?:a|amp|amps|ampere|amperes)\b',
    'u': _NUM + r'\s*u\b',
    'w': _NUM + r'\s*(?:w|watt|watts)\b',
    'kw': _NUM + r'\s*kw\b',
    'tr': _NUM + r'\s*tr\b',
    'cfm': _NUM + r'\s*cfm\b',
    'kva': _NUM + r'\s*kva\b',
    'way': _NUM + r'\s*-?\s*ways?\b',
    'swg': _NUM + r'\s*(?:swg|g|gauge)\b',
}
_WORDS = {
    'w:conductor': {'cu': r'\b(?:copper|cu)\b', 'al': r'\b(?:aluminium|aluminum|alu|al)\b'},
    'w:armour': {'unarmoured': r'\bun\s*-?\s*armou?red\b', 'armoured': r'(?<![a-z-])(?<!un )armou?red\b'},
    'w:insulation': {'xlpe': r'\bxlpe\b', 'pvc': r'\bpvc\b'},
    'w:sheath': {'frls': r'\bfrls\b', 'lszh': r'\blszh\b', 'fr': r'\bfr\b'},
    'w:metal': {'gi': r'\bg\.?i\.?\b', 'ms': r'\bm\.?s\.?\b', 'ss': r'\bs\.?s\.?\b', 'al': r'\b(?:aluminium|aluminum|al)\b', 'frp': r'\bfrp\b'},
    'w:shape': {'curved': r'\bcurved\b', 'straight': r'\bstraight\b'},
    'w:modular': {'non-modular': r'\bnon\s*-?\s*modular\b', 'modular': r'(?<![a-z-])(?<!non )modular\b'},
    'w:tray': {'perforated': r'\bperforated\b', 'ladder': r'\bladder\b', 'solid': r'\bsolid\b'},
    'w:device': {'mcb': r'\bmcbs?\b', 'mccb': r'\bmccbs?\b', 'rccb': r'\brccbs?\b', 'rcbo': r'\brcbos?\b', 'elcb': r'\belcbs?\b', 'acb': r'\bacbs?\b'},
    'w:mount': {'concealed': r'\b(?:concealed|recessed)\b', 'surface': r'\bsurface\b'},
}
_POLE_WORDS = {'sp': '1', 'dp': '2', 'tp': '3', 'fp': '4', 'spn': '1N', 'tpn': '4', 'sp+n': '1N', 'tp+n': '4', 'sp&n': '1N'}


def t2_tokens_of_text(text):
    """{type: set(values)} -- T2's spec tokens of one text."""
    s = t2_norm(text)
    s = re.sub(r'\bcat\s*-?\s*\d+[a-z]*\b', ' ', s)
    s = re.sub(r'\b(?:t\s*)?568\s*[ab]\b(?:\s*\+\s*b\b)?', ' ', s)
    out = {}

    def add(t, v):
        out.setdefault(t, set()).add(v)

    for t, rx in _SIMPLE.items():
        pre = r'(?<![a-wyz\d.])(?:[bcd]\s*)?' if t == 'amp' else r'(?<![a-wyz\d.])'
        for m in re.finditer(pre + rx, s):
            add(t, _cnum(m.group(1)))
    for m in re.finditer(r'(?<![\d.])(\d+(?:\.\d+)?)\s*/\s*\d+(?:\.\d+)?\s*(?:a|amp|amps)\b', s):
        add('amp', _cnum(m.group(1)))
    for m in re.finditer(r'(?<![a-wyz\d.])' + _NUM + r'\s*(?:c|cr|core|cores)\b(?!\s*(?:deg|\.c))', s):
        add('core', _cnum(m.group(1)))
    for m in re.finditer(r'\b(single|one|twin|two|three|four)\s*-?\s*core\b', s):
        add('core', _WORD_NUM[m.group(1)])
    for m in re.finditer(r'(?<![\d.x] )(?<![\d.x])' + _NUM + r'\s*x\s*' + _NUM + r'\s*sqmm\b', s):
        add('core', _cnum(m.group(1)))
    s2 = s
    for m in re.finditer(_NUM + r'\s*mm\.?\s*(?:thk|thick|thickness)\b', s):
        add('thk_mm', _cnum(m.group(1)))
    for m in re.finditer(r'(?:thk|thick|thickness)\.?\s*(?:of\s*)?[:\-]?\s*' + _NUM + r'\s*mm\b', s):
        add('thk_mm', _cnum(m.group(1)))
    s2 = re.sub(_NUM + r'\s*mm\.?\s*(?:thk|thick|thickness)\b', ' ', s2)
    s2 = re.sub(r'(?:thk|thick|thickness)\.?\s*(?:of\s*)?[:\-]?\s*' + _NUM + r'\s*mm\b', ' ', s2)
    for m in re.finditer(r'(?<![\d.])' + _NUM + r'((?:\s*[x/]\s*\d+(?:\.\d+)?)+)\s*mm\b', s2):
        add('mm', _cnum(m.group(1)))
        for x in re.findall(r'\d+(?:\.\d+)?', m.group(2)):
            add('mm', _cnum(x))
    for m in re.finditer(r'(?<![\d.])' + _NUM + r'\s*mm\b', s2):
        add('mm', _cnum(m.group(1)))
    for m in re.finditer(r'(?<![\d.])' + _NUM + r'\s*(?:mm\.?\s*)?(?:dia\b\.?|diameter\b|ø|φ)', s):
        add('dia', _cnum(m.group(1)))
    for m in re.finditer(r'(?:\bdia\b\.?|\bdiameter\b|ø|φ)\s*(?:of\s*)?[:\-]?\s*' + _NUM, s):
        add('dia', _cnum(m.group(1)))
    for m in re.finditer(r'(?<![\d.])' + _NUM + r'\s*(?:mm\.?\s*)?n\.?b\b\.?', s):
        add('dia', _cnum(m.group(1)))
        add('mm', _cnum(m.group(1)))
    for m in re.finditer(r'(?<![a-wyz\d.])' + _NUM + r'\s*-?\s*(?:p|pole|poles)\b', s):
        add('pole', _cnum(m.group(1)))
    for m in re.finditer(r'\b(single|double|triple|three|four)\s*-?\s*pole\b', s):
        add('pole', _WORD_NUM[m.group(1)])
    for m in re.finditer(r'\b(spn|tpn|sp\s*\+\s*n|tp\s*\+\s*n|sp\s*&\s*n|sp|dp|tp|fp)\b', s):
        add('pole', _POLE_WORDS[m.group(1).replace(' ', '')])
    for m in re.finditer(r'(?<![\d.])(\d+(?:\.\d+)?(?:\s*/\s*\d+)?)\s*(?:inch|inches|"|in\.)', s):
        add('inch', _cnum(m.group(1)))
    for t, opts in _WORDS.items():
        if t == 'w:conductor':
            continue
        for v, rx in opts.items():
            if re.search(rx, s):
                add(t, v)
    for sent in re.split(r'[.;\n|]\s+|\n', s):
        if re.search(r'\b(?:cables?|wires?|conductors?|sqmm|cores?|termination|lugs?)\b|\d\s*c\b', sent):
            for v, rx in _WORDS['w:conductor'].items():
                if re.search(rx, sent):
                    add('w:conductor', v)
    for m in re.finditer(r'\b(a?)(2x|y)(w|f)?y\b', s):
        add('w:conductor', 'al' if m.group(1) else 'cu')
        add('w:insulation', 'xlpe' if m.group(2) == '2x' else 'pvc')
        add('w:armour', 'armoured' if m.group(3) else 'unarmoured')
    for m in re.finditer(r'\b(pvc|g\.?i\.?|m\.?s\.?|hdpe)\b[^.;,]{0,25}\bconduits?\b|\bconduits?\b[^.;,]{0,12}\b(pvc|g\.?i\.?|m\.?s\.?|hdpe)\b', s):
        add('w:conduit', (m.group(1) or m.group(2)).replace('.', ''))
    if re.search(r'\bun\s*\.?\s*ar(?:m)?\b', s):
        add('w:armour', 'unarmoured')
    elif re.search(r'\bar(?:m)?\b\.', s):
        add('w:armour', 'armoured')
    return out


def flat_notes(n):
    """A notes value (dict / list / scalar) as a flat list of its strings (t2._flat / a1_prep.flat_notes)."""
    out = []
    if not n:
        return out
    if isinstance(n, dict):
        for v in n.values():
            if isinstance(v, dict):
                out += [str(x) for x in v.values() if x]
            elif isinstance(v, list):
                out += [str(x) for x in v if x]
            elif v:
                out.append(str(v))
    elif isinstance(n, list):
        out += [str(x) for x in n if x]
    else:
        out.append(str(n))
    return out


def t2_levels_of(payload):
    """[(level, text)]: row description 0, row notes 0.5, parent 1, grandparent 2, ... (a heading by its description)."""
    lv = [(0, payload.get('description') or '')]
    notes = flat_notes(payload.get('notes'))
    if notes:
        lv.append((0.5, ' \n '.join(notes)))
    anc = [a for a in (payload.get('ancestor_chain') or []) if a.get('distance')]
    for a in sorted(anc, key=lambda x: x['distance']):
        lv.append((a['distance'], a.get('description') or ''))
    return lv


# --- w2_norm (G4): one form for units, sizes, numbers, a short synonym list, combined values
SWG = {"0": 8.2, "1": 7.6, "2": 7.0, "3": 6.4, "4": 5.9, "5": 5.4, "6": 4.9, "7": 4.5, "8": 4.1, "9": 3.7, "10": 3.3, "11": 2.9, "12": 2.6, "13": 2.3, "14": 2.0, "15": 1.8, "16": 1.6, "17": 1.4, "18": 1.2, "19": 1.0, "20": 0.9, "21": 0.8, "22": 0.7, "23": 0.6, "24": 0.6, "25": 0.5, "26": 0.5}
_RU = r'(sqmm|mm|kva|kw|tr|cfm|amps|amp|a|w)'
_SYNONYMS = [
    (r'\bs\.?\s*i\.?\s*t\.?\s*c\b\.?', 'sitc'),
    (r'\bsupply\s*[,&]?\s*(?:and\s+)?install(?:ation|ing)?\s*[,&]?\s*(?:and\s+)?test(?:ing)?\s*[,&]?\s*(?:and\s+)?commission(?:ing)?\b', 'sitc'),
    (r'\bsupply\s*(?:,|&|and|\+)\s*(?:fix(?:ing)?|install(?:ation|ing)?|laying)\b', 'supply install'),
    (r'\bflexible\s+hoses?\b', 'flexible pipe'),
    (r'\bhoses?\b', 'pipe'),
    (r'\btrunking\b', 'raceway'),
    (r'\bj\.?\s*b\.?(?=\s|$|,)', 'junction box'),
    (r'\bjunction\s+boxes\b', 'junction box'),
    (r'\bgrounding\b', 'earthing'),
    (r'\b(?:light\s+fitting|light\s+fixture|lighting\s+fixture|luminaires?)s?\b', 'luminaire'),
    (r'\bgalvani[sz]ed\s+iron\b', 'gi'),
    (r'\bmild\s+steel\b', 'ms'),
    (r'\bstainless\s+steel\b', 'ss'),
    (r'\barmored\b', 'armoured'),
    (r'\bunarmored\b', 'unarmoured'),
    (r'\baluminum\b', 'aluminium'),
    (r'\bhot\s*-?\s*dip(?:ped)?\s*(?:galvani[sz]ed)?\b|\bh\.?d\.?g\b\.?', 'hot dip galvanised'),
    (r'\bgalvanized\b', 'galvanised'),
    (r'\bfiber\b', 'fibre'),
    (r'\bcolor\b', 'colour'),
    (r'\bdistribution\s+boards?\b', 'db'),
]
_SYN = [(re.compile(a), b) for a, b in _SYNONYMS]


def _rng(lo, hi, unit):
    a, b = sorted((float(lo), float(hi)))
    fmt = lambda x: str(int(x)) if x == int(x) else str(x)  # noqa: E731
    return f' {fmt(a)}to{fmt(b)} {unit} '


def nz(s):
    """The row or heading text in one normal form (w2_norm.nz)."""
    s = t2_norm(s)
    s = re.sub(r'\b(?:above|over|more\s+than|greater\s+than)\s*(' + _NUM[1:-1] + r')\s*' + _RU + r'?\s*(?:and|&|,)?\s*(?:up\s*to|upto|till|below|less\s+than)\s*(' + _NUM[1:-1] + r')\s*' + _RU + r'\b', lambda m: _rng(m[1], m[3], m[4]), s)
    s = re.sub(r'\bfrom\s*(' + _NUM[1:-1] + r')\s*' + _RU + r'?\s*to\s*(' + _NUM[1:-1] + r')\s*' + _RU + r'\b', lambda m: _rng(m[1], m[3], m[4]), s)
    s = re.sub(r'(?<![\d.x] )(?<![\d.x])(' + _NUM[1:-1] + r')\s*' + _RU + r'?\s*(?:\bto\b|\+)\s*(' + _NUM[1:-1] + r')\s*' + _RU + r'\b', lambda m: _rng(m[1], m[3], m[4]), s)

    def g(m):
        v = SWG.get(str(int(m[1])))
        return f' {v} mm thk ' if v is not None else m[0]
    s = re.sub(r'(?<![\d.])(\d{1,2})\s*(?:swg|s\.w\.g\.?|wg|gauge|ga\b)', g, s)
    s = re.sub(r'\b(?:swg|gauge)\s*[:\-]?\s*(\d{1,2})\b', g, s)
    s = re.sub(r'(?<![\d.])(\d{2})\s*g\b', g, s)
    word = r'(?:nominal\s+(?:dia(?:meter)?|bore)|dia(?:meter)?\.?|ø|φ|n\.?\s*b\b\.?|o\.?\s*d\b\.?|d\.?\s*n\b\.?)'
    s0 = s

    def dia_after(m):
        before = s0[:m.start()].rstrip()
        return m[0] if re.search(r'\d\s*(?:mm\.?)?$', before) else f' {m[1]} mm dia '
    s = re.sub(r'(?<![a-z])' + word + r'\s*(?:of\s*)?[:\-]?\s*(' + _NUM[1:-1] + r')\s*(?:mm\b)?', dia_after, s0)
    s = re.sub(r'(?<![\d.])(' + _NUM[1:-1] + r')\s*(?:mm\.?\s*)?' + word + r'\s*-\s*(?=\d)', r' \1 mm dia and ', s)
    s = re.sub(r'(?<![\d.])(' + _NUM[1:-1] + r')\s*(?:mm\.?\s*)?' + word + r'(?!\s*(?:of\s*)?[:\-]?\s*\d)', r' \1 mm dia ', s)
    for _ in range(3):
        s = re.sub(r'(\d)\s*mm\.?\s*(?:\(\s*[wdhl]\s*\)\s*)?x\s*(?=\d)', r'\1 x ', s)
    for _ in range(2):
        s = re.sub(r'(\d)\s*x\s*(?=\d)', r'\1 x ', s)
    s = re.sub(r'(?<![a-z\d.])(' + _NUM[1:-1] + r')\s*(?:cores?|cr|c)\s*x\s*(?=\d)', r'\1 core x ', s)
    s = re.sub(r'(?<![a-z\d.])(' + _NUM[1:-1] + r')\s*(?:cores|cr|c)\b(?!\s*(?:deg|\.c))', r'\1 core', s)
    s = re.sub(r'(?:\bper\s+|/\s*)(?:running\s+met(?:er|re)s?|r\.?m\.?t?\b\.?|mtr?s?\b\.?|met(?:er|re)s?\b)', ' per rmt ', s)
    s = re.sub(r'(\d)\s*(?:running\s+met(?:er|re)s?|rmt\b|r\.?m\.?\b|mtrs?\b\.?|met(?:er|re)s?\b)', r'\1 rmt ', s)
    s = re.sub(r'(?:\bper\s+|/\s*)(?:nos?\b\.?|numbers?\b|each\b|ea\b\.?)', ' per nos ', s)
    s = re.sub(r'(\d)\s*(?:nos\b\.?|no\.(?=\s|$)|each\b)', r'\1 nos ', s)
    for rx, to in _SYN:
        s = rx.sub(to, s)
    return re.sub(r'\s+', ' ', s).strip()


_UNITS = {'rmt': ['rm', 'rmt', 'r.m', 'r.m.', 'r.m.t', 'r.m.t.', 'rmts', 'mtr', 'mtrs', 'mt', 'mts', 'm', 'meter', 'meters', 'metre', 'metres', 'running meter', 'running metre', 'running mtr', 'lm', 'ln.m'],
          'nos': ['nos', 'no', 'no.', 'nos.', 'each', 'ea', 'number', 'numbers', 'nr', 'nr.', 'unit', 'units', 'pcs', 'pc', 'set of 1'],
          'sqm': ['sqm', 'sq.m', 'sq.m.', 'sq m', 'sqmt', 'sqmtr', 'sq.mtr', 'sq.mt', 'sq mt', 'm2', 'sqmts', 'sq. m', 'sq. m.', 'sq.mtrs']}
_UNIT_OF = {w: k for k, v in _UNITS.items() for w in v}


def unit_norm(u):
    s = re.sub(r'\s+', ' ', (u or '').strip().lower())
    return _UNIT_OF.get(s, s)


def _nz_notes(n):
    if not n:
        return n
    if isinstance(n, dict):
        return {k: _nz_notes(v) for k, v in n.items()}
    if isinstance(n, list):
        return [nz(str(x)) if not isinstance(x, (dict, list)) else _nz_notes(x) for x in n]
    return nz(str(n))


def nz_payload(p):
    """The payload with every string normalised (the group key and T2 read this; the judge never does)."""
    out = dict(p)
    out['description'] = nz(p.get('description'))
    if p.get('notes'):
        out['notes'] = _nz_notes(p['notes'])
    chain = []
    for a in p.get('ancestor_chain') or []:
        b = dict(a)
        b['description'] = nz(a.get('description'))
        if a.get('notes'):
            b['notes'] = _nz_notes(a['notes'])
        chain.append(b)
    out['ancestor_chain'] = chain
    return out


_TYPE_OF_UNIT = {'sqmm': 'sqmm', 'mm': 'mm', 'kva': 'kva', 'kw': 'kw', 'tr': 'tr', 'cfm': 'cfm', 'amps': 'amp', 'amp': 'amp', 'a': 'amp', 'w': 'w'}
_RNG_RE = re.compile(r'(?<![\d.])(' + _NUM[1:-1] + r')to(' + _NUM[1:-1] + r')\s*' + _RU + r'\b')


def tok(np):
    """T2's tokens over an already normalised payload: {type: (values, level)}, the closest level wins; each combined
    value joins its type's values at that level as "lo~hi"."""
    out = {}
    for lvl, txt in t2_levels_of(np):
        t = t2_tokens_of_text(txt)
        for m in _RNG_RE.finditer(txt):
            t.setdefault(_TYPE_OF_UNIT[m[3]], set()).add(f'{m[1]}~{m[2]}')
        for k, vals in t.items():
            if k not in out:
                out[k] = (vals, lvl)
    return out


def split_ranges(vals):
    plain, rng = set(), []
    for v in vals:
        if '~' in v:
            a, b = v.split('~')
            rng.append((float(a), float(b)))
        else:
            plain.add(v)
    return plain, rng


def covered(plain, rng):
    """Every plain value lies inside one of the ranges."""
    for v in plain:
        try:
            f = float(v)
        except ValueError:
            return False
        if not any(a <= f <= b for a, b in rng):
            return False
    return True


def row_texts(np):
    """(self, parent, upper) of a normalised payload: own description + notes; the parent's; every higher level's."""
    flat = lambda n: ' '.join(flat_notes(n))  # noqa: E731
    selft = ' '.join([np.get('description') or '', flat(np.get('notes'))]).strip()
    par, up = '', []
    for a in np.get('ancestor_chain') or []:
        d = a.get('distance')
        if not d:
            continue
        t = ' '.join([a.get('description') or '', flat(a.get('notes'))]).strip()
        if d == 1:
            par = t
        else:
            up.append(t)
    return selft, par, ' '.join(up)


def group_key(selft, parent, upper, unit):
    return selft + '|' + parent + '|' + upper + '|' + unit


def check_swg_table(configs):
    """DEV2-S3's assert, kept: the gauge table the normaliser uses must equal the live cabletray_raceway config's."""
    tbl = configs['cabletray_raceway']['pipelines']['tray_boq_supply']['steps'][0]['params']['table']
    assert tbl == SWG, 'the SWG table differs from the live cabletray_raceway config'

