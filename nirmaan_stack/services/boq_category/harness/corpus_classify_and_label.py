#!/usr/bin/env python
"""
corpus_classify_and_label.py -- backend corpus classify + ground-truth label loader (D3a).

A frappe-dependent operational tool with three independent modes over a labelled corpus folder
(the Set2_Verdicts_Relabeled format; BoQ id from the filename prefix, sheet_name from the
verbatim sheet_name column -- same parsing as harness/decay_sweep, whose helpers are reused):

  resolve  -- DRY. Resolve every corpus file to its is_current=1 committed sheet by
              (boq, VERBATIM sheet_name, TRIM fallback); print a per-sheet table (file Line
              Items vs committed eligible rows) and flag gaps. NO writes.
  classify -- Run the PRODUCTION classify path per resolved sheet
              (orchestrator.classify_sheet_rows). REFUSES to start if the AI toggle
              ("BOQ Upload Review AI Settings".enabled) is OFF -- otherwise the whole corpus
              would classify AI-off (rule-only, every row Needs review). Hard-asserts
              summary["ai_status"] == "ran" per sheet; a miss marks the sheet FAILED and the run
              CONTINUES (per-sheet isolation). NO snapshot writes. Emits per-BATCH progress: one
              stdout line per orchestrator progress_cb (sheet i/N <name>: batch done/total rows) +
              a run-level _PROGRESS.json (in progress_out, default a '<corpus>_classify_progress'
              sibling folder; never inside _classification_review/) refreshed per batch + per-sheet
              terminal -- mirrors the HV-2 harness _PROGRESS.json pattern.
  label    -- Load the team's Excel labels (team_classification on LINE ITEM rows) into the
              PERMANENT "BoQ Category Truth Snapshot" store (NOT into human_category_id -- live
              BoQ Row Category rows are untouched working state). Validates every label against
              the discipline vocabulary FIRST (aborts on out-of-vocab), mints ONE snapshot_batch
              for the load, skips labels whose excel_row is not a current eligible node (a small
              skip report is expected on re-committed sheets, e.g. BOQ-26-00007), and is
              idempotent: refuses a second bulk load that already covers a sheet unless
              force_new_batch=True.

The three modes are INDEPENDENT (snapshots do not depend on classification rows -- order-free);
classify-then-label is the recommended operational order so the machine + human verdicts sit on
the same current committed version.

Corpus folder via env BOQ_CORPUS_INPUT or the `corpus` kwarg. NEVER defaulted; NEVER inside the
repo tree / _classification_review/.

Canonical invocation (bench execute -- provides the frappe/DB context):
  bench --site localhost execute \\
      nirmaan_stack.services.boq_category.harness.corpus_classify_and_label.run \\
      --kwargs "{'mode': 'resolve', 'corpus': '/tmp/electrical_verdicts'}"
  # classify: {'mode': 'classify', ...}   label: {'mode': 'label', ...}
  # force a fresh bulk batch over already-covered sheets: {'mode': 'label', 'force_new_batch': True}
"""
import json
import os

import frappe

from nirmaan_stack.services.boq_category import orchestrator
from nirmaan_stack.services.boq_category.harness import decay_sweep as ds
from nirmaan_stack.services.boq_category.runner import load_ruleset

_SNAPSHOT = "BoQ Category Truth Snapshot"
_AI_TOGGLE = '"BOQ Upload Review AI Settings".enabled'
_BULK_SOURCE = "Bulk-loaded ground truth"


# --------------------------------------------------------------------------- shared resolution
def _verbatim_sheet_name(rows):
    """The file's sheet_name column, kept VERBATIM (#152 -- NEVER stripped; trailing spaces are
    load-bearing identity). Every data row carries the same value; pick the longest raw value so a
    trailing-space variant is never lost. Used only to LOOK UP the committed sheet; the authoritative
    verbatim name for storage is the committed BoQ Sheet.sheet_name (see _resolve_sheets)."""
    vals = [str(r.get("sheet_name")) for r in rows
            if r.get("sheet_name") is not None and str(r.get("sheet_name")).strip()]
    return sorted(vals, key=len)[-1] if vals else ""


def _resolve_sheets(corpus, discipline):
    """Resolve every corpus file to its is_current=1 committed sheet. Returns a list of dicts:
    {file, boq, sheet_name(verbatim), matched(bool), sheet_doc, cv, file_li, file_labelled,
    elig, elig_li}. No writes."""
    files = ds.corpus_files(corpus)
    out = []
    for p in files:
        boq = os.path.basename(p).split("__")[0]
        _hdr, rows = ds.load_file(p)
        sn = _verbatim_sheet_name(rows)
        file_li = sum(1 for r in rows if ds._norm(r.get("node_type")) == "Line Item")
        file_lab = sum(1 for r in rows if ds._norm(r.get("node_type")) == "Line Item"
                       and ds._norm(r.get("team_classification")))
        rec = {"file": os.path.basename(p), "boq": boq, "sheet_name": sn, "matched": False,
               "sheet_doc": None, "cv": None, "file_li": file_li, "file_labelled": file_lab,
               "elig": 0, "elig_li": 0}
        sh = frappe.db.sql(
            '''SELECT name, sheet_name, commit_version FROM "tabBoQ Sheet"
               WHERE boq=%s AND is_current=1 AND (sheet_name=%s OR TRIM(sheet_name)=TRIM(%s))''',
            (boq, sn, sn), as_dict=True)
        if sh:
            rec["matched"] = True
            rec["sheet_doc"] = sh[0]["name"]
            rec["cv"] = sh[0]["commit_version"]
            # AUTHORITATIVE verbatim (#152): store/join on the COMMITTED sheet_name from the DB, not
            # the file's column, so a snapshot row's sheet_name is byte-identical to BoQ Row Category's.
            rec["sheet_name"] = sh[0]["sheet_name"]
            rec["elig"] = frappe.db.sql(
                '''SELECT COUNT(*) FROM "tabBOQ Nodes" WHERE boq=%s AND sheet=%s AND is_current=1
                   AND node_type IN ('Line Item','Preamble')''', (boq, rec["sheet_doc"]))[0][0]
            rec["elig_li"] = frappe.db.sql(
                '''SELECT COUNT(*) FROM "tabBOQ Nodes" WHERE boq=%s AND sheet=%s AND is_current=1
                   AND node_type='Line Item' ''', (boq, rec["sheet_doc"]))[0][0]
        out.append(rec)
    return out


def _eligible_excel_rows(boq, sheet_doc):
    """The set of current eligible source_row_numbers (Line Item + Preamble) for a committed sheet."""
    rows = frappe.db.sql(
        '''SELECT source_row_number FROM "tabBOQ Nodes" WHERE boq=%s AND sheet=%s AND is_current=1
           AND node_type IN ('Line Item','Preamble')''', (boq, sheet_doc))
    return {int(r[0]) for r in rows if r[0] is not None}


# --------------------------------------------------------------------------- modes
def _mode_resolve(corpus, discipline):
    sheets = _resolve_sheets(corpus, discipline)
    misses = [s for s in sheets if not s["matched"]]
    tot_li = tot_elig = 0
    print(f"corpus: {len(sheets)} files in {corpus}   discipline: {discipline}\n")
    hdr = f"{'boq':13} {'sheet(verbatim)':32} {'fLI':>4} {'flab':>4} {'cv':>4} {'elig':>5} {'eLI':>5}  gap"
    print(hdr)
    print("-" * len(hdr))
    for s in sheets:
        if not s["matched"]:
            print(f"{s['boq']:13} {s['sheet_name'][:32]:32} {s['file_li']:>4} {s['file_labelled']:>4} "
                  f"{'MISS':>4} {'-':>5} {'-':>5}  UNRESOLVED")
            continue
        tot_li += s["file_li"]
        tot_elig += s["elig"]
        gap = "" if abs(s["elig_li"] - s["file_li"]) <= 1 else f"GAP fileLI {s['file_li']} -> committedLI {s['elig_li']}"
        print(f"{s['boq']:13} {s['sheet_name'][:32]:32} {s['file_li']:>4} {s['file_labelled']:>4} "
              f"{('v'+str(s['cv'])):>4} {s['elig']:>5} {s['elig_li']:>5}  {gap}")
    print("-" * len(hdr))
    print(f"\nTOTALS: files={len(sheets)}  resolved={len(sheets)-len(misses)}  misses={len(misses)}  "
          f"file LineItems={tot_li}  committed eligible(LI+Preamble)={tot_elig}")
    if misses:
        print("UNRESOLVED files:", [s["file"] for s in misses])
    return {"files": len(sheets), "misses": len(misses)}


def _default_progress_dir(corpus):
    """A /tmp-style sibling of the corpus folder (NEVER inside _classification_review/): the run's
    OWN progress folder, holding _PROGRESS.json. Mirrors the HV-2 harness runtime-artifact pattern."""
    base = os.path.abspath(corpus).rstrip(os.sep)
    return base + "_classify_progress"


def _write_progress(progress_dir, state):
    """Write/overwrite _PROGRESS.json in the run's OWN progress folder (a runtime artifact only --
    stamps updated_at each call). Mirrors electrical_classification_harness._write_progress."""
    state["updated_at"] = frappe.utils.now()
    with open(os.path.join(progress_dir, "_PROGRESS.json"), "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2, default=str)


def _mode_classify(corpus, discipline, progress_out=None):
    # PRE-FLIGHT (before ANY classify work): refuse if the AI toggle is off.
    from nirmaan_stack.api.boq.wizard.ai_settings import get_boq_ai_settings
    settings = get_boq_ai_settings()
    if not settings.get("enabled"):
        frappe.throw(
            f"AI toggle {_AI_TOGGLE} is OFF -- refusing to classify (the whole corpus would come "
            f"back AI-off: rule-only, every row Needs review). Enable it, then re-run.",
            title="AI disabled")

    progress_dir = progress_out or _default_progress_dir(corpus)
    if "_classification_review" in os.path.abspath(progress_dir).split(os.sep):
        frappe.throw("--progress-out must not be inside _classification_review/ (untouchable).",
                     title="Bad progress-out")
    os.makedirs(progress_dir, exist_ok=True)

    sheets = [s for s in _resolve_sheets(corpus, discipline) if s["matched"]]
    total_sheets = len(sheets)
    state = {
        "run_started_at": frappe.utils.now(),
        "sheets_total": total_sheets,
        "sheets_done": 0,
        "sheets_failed": [],
        "current_sheet": None,
        "current_batch_done": 0,
        "current_batch_total": 0,
        "rows_done_total": 0,
        "updated_at": None,
    }
    _write_progress(progress_dir, state)

    ok, failed = [], []
    rows_base = 0  # rows classified in already-finished sheets (base for the current sheet's counter)
    for i, s in enumerate(sheets, start=1):
        tag = f"[{s['boq']}] {s['sheet_name'].strip()}"
        state["current_sheet"] = f"{i}/{total_sheets} {tag}"
        state["current_batch_done"] = 0
        state["current_batch_total"] = 0

        def _progress(done, total, _tag=tag, _i=i, _base=rows_base):
            print(f"  sheet {_i}/{total_sheets} {_tag}: batch {done}/{total} rows", flush=True)
            state["current_batch_done"] = done
            state["current_batch_total"] = total
            state["rows_done_total"] = _base + done
            _write_progress(progress_dir, state)

        try:
            summary = orchestrator.classify_sheet_rows(
                s["boq"], s["sheet_name"], discipline, progress_cb=_progress)
            if summary.get("ai_status") != "ran":
                failed.append((tag, f"ai_status={summary.get('ai_status')!r}"))
                state["sheets_failed"].append({"sheet": f"{i}/{total_sheets} {tag}",
                                               "error": f"ai_status={summary.get('ai_status')!r}"})
                print(f"  FAILED {tag}: ai_status={summary.get('ai_status')!r} (not 'ran')", flush=True)
            else:
                ok.append(tag)
                state["sheets_done"] += 1
                print(f"  OK {tag}: classified={summary.get('eligible_classified')} "
                      f"auto={summary.get('auto_accepted')} review={summary.get('needs_review')}", flush=True)
            rows_base += (summary.get("eligible_classified") or 0)
        except Exception as exc:
            failed.append((tag, repr(exc)))
            state["sheets_failed"].append({"sheet": f"{i}/{total_sheets} {tag}", "error": repr(exc)})
            print(f"  FAILED {tag}: {exc!r}", flush=True)
        # per-sheet terminal update
        state["rows_done_total"] = rows_base
        state["current_batch_done"] = 0
        state["current_batch_total"] = 0
        _write_progress(progress_dir, state)

    progress_path = os.path.join(progress_dir, "_PROGRESS.json")
    print(f"\nCLASSIFY DONE: ok={len(ok)}  failed={len(failed)}  progress={progress_path}")
    if failed:
        print("FAILED sheets:")
        for tag, why in failed:
            print(f"  {tag}: {why}")
    return {"ok": len(ok), "failed": len(failed), "progress": progress_path}


def _mode_label(corpus, discipline, force_new_batch):
    valid_ids = {c["category_id"] for c in load_ruleset(discipline=discipline)["categories"]}
    sheets = [s for s in _resolve_sheets(corpus, discipline) if s["matched"]]

    # Gather per-sheet (excel_row, label) for LINE ITEM rows with a non-blank team_classification,
    # and validate the whole corpus vocabulary BEFORE any write.
    per_sheet = []
    oov = {}
    for s in sheets:
        _hdr, rows = ds.load_file(os.path.join(corpus, s["file"]))
        labels = []
        for r in rows:
            if ds._norm(r.get("node_type")) != "Line Item":
                continue
            lab = ds._norm(r.get("team_classification"))
            if not lab:
                continue
            er = ds._to_int(r.get("excel_row"))
            if er is None:
                continue
            if lab not in valid_ids:
                oov[lab] = oov.get(lab, 0) + 1
            labels.append((er, lab))
        per_sheet.append((s, labels))
    if oov:
        frappe.throw(f"Out-of-vocabulary labels for {discipline}: {oov} -- aborting (no rows written).",
                     title="Invalid labels")

    # Idempotence: refuse if any target sheet already has bulk-loaded snapshot rows.
    if not force_new_batch:
        covered = []
        for s, _labels in per_sheet:
            n = frappe.db.count(_SNAPSHOT, {"boq": s["boq"], "sheet_name": s["sheet_name"],
                                            "discipline": discipline, "source": _BULK_SOURCE})
            if n:
                covered.append(f"{s['boq']}/{s['sheet_name'].strip()} ({n} rows)")
        if covered:
            frappe.throw(
                "Bulk ground-truth already covers: " + "; ".join(covered) +
                " -- pass force_new_batch=True to bank a new snapshot batch anyway.",
                title="Already loaded")

    batch = "gtbulk-" + frappe.generate_hash(length=12)
    now = frappe.utils.now()
    inserted_total = skipped_total = 0
    per_sheet_report = []
    for s, labels in per_sheet:
        eligible = _eligible_excel_rows(s["boq"], s["sheet_doc"])
        ins = skip = 0
        skipped_rows = []
        for er, lab in labels:
            if er not in eligible:
                skip += 1
                skipped_rows.append(er)
                continue
            doc = frappe.new_doc(_SNAPSHOT)
            doc.boq = s["boq"]
            doc.sheet_name = s["sheet_name"]  # VERBATIM (#152)
            doc.excel_row = er
            doc.discipline = discipline
            doc.committed_version = s["cv"]
            doc.label_category_id = lab
            doc.snapshot_batch = batch
            doc.source = _BULK_SOURCE
            doc.snapshot_at = now
            doc.snapshot_by = "ground-truth-bulk"
            doc.insert(ignore_permissions=True)
            ins += 1
        frappe.db.commit()  # one commit per sheet
        inserted_total += ins
        skipped_total += skip
        per_sheet_report.append((s, ins, skip, skipped_rows))

    print(f"LABEL LOAD: batch={batch}  source={_BULK_SOURCE!r}  discipline={discipline}")
    print(f"  inserted={inserted_total}  skipped(no current eligible node)={skipped_total}\n")
    for s, ins, skip, skipped_rows in per_sheet_report:
        note = f"  SKIPPED excel_rows={skipped_rows}" if skip else ""
        print(f"  [{s['boq']}] {s['sheet_name'].strip():32} inserted={ins:>4} skipped={skip:>2}{note}")
    return {"batch": batch, "inserted": inserted_total, "skipped": skipped_total}


# --------------------------------------------------------------------------- entrypoint
def run(mode="resolve", corpus=None, discipline="Electrical", force_new_batch=False, progress_out=None):
    """bench-execute entrypoint. mode in {resolve, classify, label}. corpus via arg or env
    BOQ_CORPUS_INPUT. progress_out (classify only, optional) = the folder for the run-level
    _PROGRESS.json; defaults to a sibling '<corpus>_classify_progress' folder, never inside
    _classification_review/. See the module docstring for the canonical invocation."""
    corpus = corpus or os.environ.get("BOQ_CORPUS_INPUT")
    if not corpus:
        frappe.throw("No corpus folder -- pass corpus=... or set BOQ_CORPUS_INPUT.", title="Missing corpus")
    if not os.path.isdir(corpus):
        frappe.throw(f"corpus folder not found: {corpus!r}", title="Missing corpus")
    if "_classification_review" in os.path.abspath(corpus).split(os.sep):
        frappe.throw("corpus must not be inside _classification_review/ (untouchable).", title="Bad corpus")
    try:
        load_ruleset(discipline=discipline)
    except Exception as exc:
        frappe.throw(f"discipline {discipline!r} has no ruleset ({exc}).", title="Bad discipline")
    force_new_batch = force_new_batch in (True, "True", "true", 1, "1")

    if mode == "resolve":
        return _mode_resolve(corpus, discipline)
    if mode == "classify":
        return _mode_classify(corpus, discipline, progress_out=progress_out)
    if mode == "label":
        return _mode_label(corpus, discipline, force_new_batch)
    frappe.throw(f"Unknown mode {mode!r} (expected resolve | classify | label).", title="Bad mode")
