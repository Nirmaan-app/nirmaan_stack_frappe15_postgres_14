"""AC5 corpus dump -- every stored row of every ACTIVE run (both disciplines) with the context the BoQ page
would hand the panel helper, plus every active config and item. Read-only.

Tracked in ADP-1 (2026-10-19) from container scratch (`/tmp/scratch12e6b/`, 12d-8 AC7 / 12e-4d AC6); the only
change is that the output directory is a parameter: argv[1], else $REPLAY_DIR, else /tmp/replay17883.
Run with bench python from `frappe-bench` (the script changes directory to `sites/` itself)."""
import os, sys, json, collections

OUT = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("REPLAY_DIR", "/tmp/replay17883")
os.makedirs(OUT, exist_ok=True)
os.chdir('/workspace/development/frappe-bench/sites')
import frappe; frappe.init(site='localhost'); frappe.connect()
from nirmaan_stack.services.boq_category.context_builder import build_sheet_context
from nirmaan_stack.services.boq_rate_master.extraction import _resolved_categories

configs = {}
for c in frappe.db.sql('select discipline, category_id, config from "tabBoQ Rate Category Config" where active=1', as_dict=True):
    cfg = json.loads(c['config']) if isinstance(c['config'], str) else c['config']
    configs[c['category_id']] = cfg
items = []
for it in frappe.db.sql('select name, discipline, kind, brand, unit, attributes, rates, item_uid from "tabBoQ Rate Master Item" where active=1 order by name', as_dict=True):
    for k in ('attributes', 'rates'):
        if isinstance(it[k], str): it[k] = json.loads(it[k])
    items.append(it)
json.dump(configs, open(os.path.join(OUT, 'ac5_configs.json'), 'w'))
json.dump(items, open(os.path.join(OUT, 'ac5_items.json'), 'w'), default=str)

runs = frappe.db.sql('select boq, sheet_name, committed_version, run_id, status, ai_status, results from "tabBoQ Rate Suggestion Run" where active=1', as_dict=True)
out = open(os.path.join(OUT, 'ac5_rows.jsonl'), 'w')
n = 0; per_cat = collections.Counter(); skipped = collections.Counter()
for r in runs:
    boq, sn = r['boq'], r['sheet_name']
    cur = frappe.db.get_value('BoQ Sheet', {'boq': boq, 'sheet_name': sn, 'is_current': 1}, ['name', 'commit_version'], as_dict=True)
    if not cur or cur['commit_version'] != r['committed_version']:
        skipped['run not at current version'] += 1; continue
    ctx = build_sheet_context(boq, sn)
    by_row = {x['excel_row']: x for x in ctx['rows']}
    resolved = _resolved_categories(boq, sn, cur['commit_version'])
    nodes = {nd['source_row_number']: nd for nd in frappe.get_all('BOQ Nodes', filters={'boq': boq, 'sheet': cur['name'], 'is_current': 1}, fields=['source_row_number', 'unit', 'notes', 'attached_notes', 'node_type'])}
    res = r['results']; res = json.loads(res) if isinstance(res, str) else res
    rows = res if isinstance(res, list) else (res or {}).get('rows', [])
    for x in rows:
        er = x.get('excel_row')
        if er is None: skipped['no excel_row'] += 1; continue
        cx = by_row.get(er); nd = nodes.get(er) or {}
        cat, disc = resolved.get(er, (x.get('category_id'), None))
        headings = [a.get('description') or '' for a in (cx or {}).get('ancestors') or []]
        own_notes = []
        if nd.get('notes'): own_notes.append(str(nd['notes']))
        an = nd.get('attached_notes')
        if isinstance(an, str):
            try: an = json.loads(an)
            except Exception: an = [an]
        for a in an or []:
            if isinstance(a, str): own_notes.append(a)
        rec = {'boq': boq, 'sheet_name': sn, 'excel_row': er, 'run_id': r['run_id'], 'category_id': x.get('category_id'), 'resolved_category': cat, 'discipline': disc,
               'description': x.get('description') or (cx or {}).get('description') or '', 'unit': nd.get('unit'), 'headings': headings, 'ownNotes': own_notes,
               'attributes': x.get('attributes') or {}, 'items': x.get('items')}
        out.write(json.dumps(rec, default=str) + '\n'); n += 1; per_cat[x.get('category_id')] += 1
out.close()
print('runs', len(runs), 'rows', n, 'skipped', dict(skipped)); print('per category', per_cat.most_common())
frappe.destroy()
