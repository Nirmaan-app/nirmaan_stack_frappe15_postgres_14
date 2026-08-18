#!/usr/bin/env python3
"""Backfill `item_uid` on ACTIVE BoQ Rate Master Item rows, and stamp the SAME uid into the
matching item of the committed asset, so the asset and the database agree.

WHY A STAMPED UID AND NOT A CONTENT HASH
----------------------------------------
A content-derived id CHANGES when an attribute is edited. An edited row would then come back from a
CSV round trip carrying a DIFFERENT id, be read as an insert, and leave the original active -- a
silent duplicate on every rename, which is the exact failure the id exists to prevent. So the uid is
stamped once, opaquely, and never re-derived.

WHY NOT `name`
--------------
Freeze-and-supersede RETAINS the superseded row, so its `name` stays occupied; a new row reusing it
is a primary-key collision. A separate field has no such constraint -- and MANY ROWS SHARING ONE UID
IS THE POINT: every historical version of an item can carry the same uid.

ACTIVE ROWS ONLY (owner ruling 2026-08-13)
------------------------------------------
History is DELIBERATELY EXCLUDED. A superseded row has no reliable key to its successor: the only
handle is content, and content is exactly what changes between versions, so a historical backfill
could only ever be approximate. There is no hook here for one, on purpose.

PAIRING
-------
DB row <-> asset item by (kind, brand, canonicalised attributes). `brand` is LOAD-BEARING in that
tuple: six lms_item pairs are identical on (kind, attributes) and differ ONLY by brand -- Lutron vs
Zen Control, at materially different prices -- so pairing without it would mis-assign six uids.
If any active row does not pair to EXACTLY ONE asset item, or vice versa, the script REFUSES and
writes nothing.

IDEMPOTENT
----------
A row that already carries a uid keeps it, and its asset twin is stamped with that same value. Run
it twice and nothing moves. It is a one-off maintenance script, NOT a patch -- it seeds data, it
does not migrate structure.

USAGE (inside the container, from the bench directory)
    env/bin/python scripts/backfill_rate_master_item_uid.py            # dry run, writes nothing
    env/bin/python scripts/backfill_rate_master_item_uid.py --apply    # writes DB + asset
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import sys

os.chdir("/workspace/development/frappe-bench/sites")
import frappe  # noqa: E402

APP = "/workspace/development/frappe-bench/apps/nirmaan_stack/nirmaan_stack"
# F-20 sweep (2026-08-14): v30 -> v31. This was the THIRD place naming an asset version, found by
# the F-20 recon. The uids it stamps are UNAFFECTED by the bump: pairing is on
# (kind, brand, attributes), and F-16 changed only a RATE key (`install_rate`) plus the retirement
# of `tray_install_rate`, so every active row still pairs to exactly one asset item -- and v31
# inherited v30's uids anyway. `CURRENT_EALL_ASSET` in test_rate_master.py is the ONE authoritative
# current pin; any new file naming a version must justify itself against it.
ASSET = os.path.join(APP, "services", "boq_rate_master", "data",
                     "rate_master_electrical_all_v31.json")
ITEM_DOCTYPE = "BoQ Rate Master Item"

# `rmi-` + 12 lowercase hex. Opaque so it never has to change when an attribute is edited; the
# prefix mirrors the module's existing `rmbulk-` / `manual-` provenance prefixes so a uid is
# recognisable on sight in a spreadsheet cell; 16 chars sits in a CSV cell without wrapping.
UID_PREFIX = "rmi-"
UID_HEX_LEN = 12

NORMALIZE_ATTRS = ("material", "insulation")


def canon(attrs: dict) -> dict:
    """Mirror loader._canonicalize_attributes so the asset side keys identically to the stored side."""
    out = dict(attrs)
    for k in NORMALIZE_ATTRS:
        v = out.get(k)
        if isinstance(v, str):
            out[k] = v.upper()
    return out


def J(x) -> str:
    return json.dumps(x, sort_keys=True, separators=(",", ":"))


def parsed(v):
    return v if isinstance(v, (dict, list)) else json.loads(v or "{}")


def pair_key(kind: str, brand, attributes: dict) -> str:
    return J([kind, brand, canon(attributes)])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write; otherwise dry run")
    ap.add_argument("--asset", default=ASSET)
    args = ap.parse_args()

    frappe.init(site="localhost")
    frappe.connect()
    frappe.set_user("Administrator")

    with open(args.asset, encoding="utf-8") as fh:
        payload = json.load(fh)
    asset_items = payload["items"]

    rows = frappe.get_all(ITEM_DOCTYPE, filters={"active": 1},
                          fields=["name", "kind", "brand", "attributes", "item_uid"])

    # ---- build both sides' indexes, refusing on any ambiguity -------------------------------
    db_by_key: dict[str, list] = collections.defaultdict(list)
    for r in rows:
        db_by_key[pair_key(r["kind"], r["brand"], parsed(r["attributes"]))].append(r)
    asset_by_key: dict[str, list] = collections.defaultdict(list)
    for it in asset_items:
        asset_by_key[pair_key(it["kind"].strip(), it.get("brand"), it["attributes"])].append(it)

    print("active DB rows      : %d  (distinct keys %d)" % (len(rows), len(db_by_key)))
    print("asset items         : %d  (distinct keys %d)" % (len(asset_items), len(asset_by_key)))

    problems = []
    for k, v in db_by_key.items():
        if len(v) != 1:
            problems.append("DB key maps to %d rows: %s" % (len(v), k[:120]))
    for k, v in asset_by_key.items():
        if len(v) != 1:
            problems.append("ASSET key maps to %d items: %s" % (len(v), k[:120]))
    only_db = set(db_by_key) - set(asset_by_key)
    only_asset = set(asset_by_key) - set(db_by_key)
    for k in sorted(only_db)[:10]:
        problems.append("DB row with NO asset twin: %s" % k[:120])
    for k in sorted(only_asset)[:10]:
        problems.append("ASSET item with NO DB twin: %s" % k[:120])

    if problems:
        print("\n*** REFUSING -- pairing is not 1:1 ***")
        for p in problems[:20]:
            print("   " + p)
        print("\nNothing written.")
        frappe.destroy()
        return 1
    print("pairing             : 1:1 on (kind, brand, attributes) -- VERIFIED")

    # ---- assign uids: reuse an existing one (idempotence), else mint ------------------------
    assigned, minted, reused = {}, 0, 0
    seen_uids = set()
    for k in sorted(db_by_key):
        row = db_by_key[k][0]
        uid = (row.get("item_uid") or "").strip()
        if uid:
            reused += 1
        else:
            uid = UID_PREFIX + frappe.generate_hash(length=UID_HEX_LEN)
            while uid in seen_uids:                       # belt and braces
                uid = UID_PREFIX + frappe.generate_hash(length=UID_HEX_LEN)
            minted += 1
        seen_uids.add(uid)
        assigned[k] = uid

    if len(seen_uids) != len(assigned):
        print("*** REFUSING -- uid collision ***")
        frappe.destroy()
        return 1
    print("uids                : %d reused, %d minted, %d distinct" % (reused, minted, len(seen_uids)))

    if not args.apply:
        print("\nDRY RUN -- nothing written. Re-run with --apply.")
        for k in sorted(assigned)[:3]:
            print("   %s  ->  %s" % (assigned[k], k[:110]))
        frappe.destroy()
        return 0

    # ---- write the DB side ------------------------------------------------------------------
    # set_value(update_modified=False): this seeds an identity, it is not a content edit, and the
    # doctype is track_changes:1 -- a doc.save() would mint 1,382 Version rows recording a field
    # that had no prior value.
    wrote = 0
    for k, uid in assigned.items():
        row = db_by_key[k][0]
        if (row.get("item_uid") or "") != uid:
            frappe.db.set_value(ITEM_DOCTYPE, row["name"], "item_uid", uid, update_modified=False)
            wrote += 1
    frappe.db.commit()
    print("DB rows stamped     : %d" % wrote)

    # ---- write the ASSET side, same uid, same pairing ---------------------------------------
    for k, uid in assigned.items():
        asset_by_key[k][0]["item_uid"] = uid
    with open(args.asset, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print("asset items stamped : %d  -> %s" % (len(assigned), os.path.basename(args.asset)))

    # ---- prove they agree --------------------------------------------------------------------
    fresh = frappe.get_all(ITEM_DOCTYPE, filters={"active": 1},
                           fields=["kind", "brand", "attributes", "item_uid"])
    db_map = {pair_key(r["kind"], r["brand"], parsed(r["attributes"])): r["item_uid"] for r in fresh}
    with open(args.asset, encoding="utf-8") as fh:
        reread = json.load(fh)
    as_map = {pair_key(i["kind"].strip(), i.get("brand"), i["attributes"]): i.get("item_uid")
              for i in reread["items"]}
    blank_db = [k for k, v in db_map.items() if not v]
    blank_as = [k for k, v in as_map.items() if not v]
    mismatch = [k for k in db_map if db_map[k] != as_map.get(k)]
    print("\nPROOF")
    print("  DB rows with a uid    : %d / %d" % (len(db_map) - len(blank_db), len(db_map)))
    print("  asset items with a uid: %d / %d" % (len(as_map) - len(blank_as), len(as_map)))
    print("  keys where DB uid != asset uid: %d" % len(mismatch))
    print("  RESULT:", "PASS -- asset and DB agree on every item"
          if not (blank_db or blank_as or mismatch) else "FAIL")
    frappe.destroy()
    return 0 if not (blank_db or blank_as or mismatch) else 1


if __name__ == "__main__":
    sys.exit(main())
