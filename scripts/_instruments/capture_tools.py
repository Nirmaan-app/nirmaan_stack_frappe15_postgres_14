"""SLICE 9 -- TEMPORARY, UNTRACKED. Capture surgery for the replay.

Two jobs, kept apart on purpose:

  reconstruct  Build a capture in which every item carries the NEW one-field answer `size_mm`, MECHANICALLY
               RECONSTRUCTED from the three old fields (`face_w_mm`, `face_h_mm`, `depth_mm` joined in that
               order with " x "). This is NOT evidence about the model -- it is what lets the pricing change
               be replayed over rows the paid re-read does not reach, and it is labelled as such everywhere.
               A row whose three fields are all blank gets no `size_mm` at all.

  merge        Replace the reconstructed answer with the REAL new answer for every row the paid re-read
               covered, and record which rows those are.

Usage:
  python _slice9_capture_tools.py reconstruct <in.jsonl> <out.jsonl>
  python _slice9_capture_tools.py merge <reconstructed.jsonl> <reread.json> <out.jsonl> <covered.json>
"""
import json
import sys

SZ = ("face_w_mm", "face_h_mm", "depth_mm")


def _blank(v):
    return v is None or (isinstance(v, str) and v.strip() in ("", "None"))


# The word the FIELD NAME carried. A model that wrote "250 mm" into the HEIGHT field knew it was a height;
# the one-field answer has to carry that the only way a text can -- in words. Reconstructing without it would
# throw away information the old answer held, and would understate the new design.
_AXIS_WORD = {"face_h_mm": "high", "depth_mm": "deep"}


def reconstruct_item(attrs):
    """The one-field answer the model WOULD have given, rebuilt from the three it did give."""
    filled = [f for f in SZ if not _blank(attrs.get(f, {}).get("value"))]
    parts = [str(attrs[f]["value"]).strip() for f in filled]
    if len(filled) == 1 and filled[0] in _AXIS_WORD and not any(
            w in parts[0].lower() for w in ("high", "height", "deep", "depth", "(h)", "(d)")):
        parts = [parts[0] + " " + _AXIS_WORD[filled[0]]]
    if not parts:
        return None
    conf = [attrs.get(f, {}).get("confidence") for f in SZ if not _blank(attrs.get(f, {}).get("value"))]
    conf = [c for c in conf if isinstance(c, (int, float))]
    return {"value": " x ".join(parts), "confidence": min(conf) if conf else None}


def reconstruct(src, dst):
    n_rows = n_items = 0
    out = []
    for line in open(src, encoding="utf-8"):
        if not line.strip():
            continue
        rec = json.loads(line)
        touched = False
        for it in rec.get("MODEL_RETURNED_ITEMS") or []:
            a = it.get("attributes") or {}
            rebuilt = reconstruct_item(a)
            for f in SZ:
                a.pop(f, None)
            if rebuilt is not None:
                a["size_mm"] = rebuilt
                n_items += 1
                touched = True
        if touched:
            n_rows += 1
        out.append(rec)
    with open(dst, "w", encoding="utf-8") as fh:
        for rec in out:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print("reconstructed size_mm on %d items across %d rows (of %d rows)" % (n_items, n_rows, len(out)))


def merge(src, reread_path, dst, covered_path):
    reread = json.load(open(reread_path, encoding="utf-8"))["results"]
    covered, missing = [], []
    out = []
    for line in open(src, encoding="utf-8"):
        if not line.strip():
            continue
        rec = json.loads(line)
        key = "%s|%s|%s" % (rec["boq"], rec["sheet"], rec["excel_row"])
        got = reread.get(key)
        if got is not None and got.get("returned"):
            rec["MODEL_RETURNED_ITEMS"] = got["items"] or []
            rec["SLICE9_REREAD"] = True
            covered.append(key)
        elif got is not None:
            missing.append(key)
        out.append(rec)
    with open(dst, "w", encoding="utf-8") as fh:
        for rec in out:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    json.dump({"covered": covered, "asked_but_no_answer": missing}, open(covered_path, "w"), indent=1)
    print("merged %d re-read rows (%d asked but returned nothing)" % (len(covered), len(missing)))


if __name__ == "__main__":
    if sys.argv[1] == "reconstruct":
        reconstruct(sys.argv[2], sys.argv[3])
    else:
        merge(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
