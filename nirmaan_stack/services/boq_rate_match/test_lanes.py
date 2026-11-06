# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for the matching lanes and the merge (DEV2-B2, T1). Fixtures only: a small in-memory pool built with the real
index builder (pool.build_index). No live data, no database, no model call.

  EXACT       an exact copy in another BoQ is first in the list  /  a copy only in the target's own BoQ is not offered
  W1          the same discipline is scored  /  another discipline is not; another category passes only the gate
  T2 fix      a number on one side only never demotes  /  a real difference on both sides demotes below the rest
  WORD        BM25 reaches another category
  CARD        same head + equal values -> in the lane  /  a differing dimension or head -> not; no target card -> no lane
  RULES       equal signature + values -> in the lane  /  other values -> not; unavailable -> named, the rest run on;
              no readings -> off
  caps        W1 10, WORD 3, CARD 3, RULES 5 enter the list
  de-dup      one entry per group; its representative is a member with a card, then the most recent, then the key
  targets     a BoQ's identical rows are judged once
"""
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_match import lanes as L
from nirmaan_stack.services.boq_rate_match import pool as P


def _rows(specs):
    rows, gid = [], {}
    for sp in specs:
        payload = {"description": sp["desc"], "ancestor_chain": [{"distance": 1, "description": sp.get("parent", "Cable tray")}]}
        np = P.nz_payload(payload)
        s, p, u = P.row_texts(np)
        unit = P.unit_norm(sp.get("unit", "Rmt"))
        r = {"key": sp["key"], "boq": sp["key"].split("|")[0], "payload": payload, "self": s, "parent": p, "upper": u,
             "desc": np["description"], "unit": unit, "disc": sp.get("disc", "Electrical"), "cat": sp.get("cat", "cabletray_raceway"),
             "v1": list(sp.get("v1", [])), "rules_key": sp.get("rules_key"), "rec": sp.get("rec", "2026-01-01 00:00:00"),
             "project": sp.get("project", "P-" + sp["key"].split("|")[0]), "fam": sp["key"].split("|")[0], "wip": sp.get("wip", False),
             "readings": {} if sp.get("v1") or sp.get("rules_key") else None, "test": False}
        r["group"] = gid.setdefault(P.group_key(s, p, u, unit), len(gid))
        rows.append(r)
    return rows


def _pool(specs, cards=None, kept=None):
    rows = _rows(specs)
    cards = cards or {}
    return P.Pool({"rows": rows, "kept": set(kept) if kept is not None else {r["key"] for r in rows}, "sel": {}, "nxt": {},
                   "index": P.build_index(rows, cards)})


def _card(kind="tray", name="cable tray", width=300, scope=None):
    c = {"kind": {"v": kind, "name": name}, "dim": [{"n": "width", "v": width, "u": "mm"}]}
    if scope:
        c["scope"] = {"v": scope}
    return c


TRAYS = [
    {"key": "T|S|1", "desc": "GI perforated cable tray 300 x 50 mm"},                                   # the target
    {"key": "A|S|1", "desc": "GI perforated cable tray 300 x 50 mm"},                                   # an exact copy elsewhere
    {"key": "B|S|1", "desc": "GI perforated cable tray 300 x 50 mm with cover"},
    {"key": "C|S|1", "desc": "GI perforated cable tray 600 x 50 mm"},
    {"key": "D|S|1", "desc": "GI perforated cable tray 300 x 50 mm", "parent": "HVAC cable tray", "disc": "HVAC"},   # same row text, other discipline (own group)
    {"key": "E|S|1", "desc": "PVC conduit 25 mm dia", "cat": "conduit_piping", "parent": "Conduits"},
]


class TestLanes(FrappeTestCase):
    def _cands(self, pool, key="T|S|1", **over):
        return L.candidates(L.target_from_row(pool, key, **over), pool)

    # ---- EXACT ----
    def test_exact_copy_in_another_boq_comes_first(self):
        pool = _pool(TRAYS)
        c = self._cands(pool)
        g = pool.rows[pool.byk["A|S|1"]]["group"]
        self.assertEqual(c["lanes"]["EXACT"], [g])
        self.assertEqual(c["entries"][0]["group"], g)
        self.assertIn("EXACT", c["entries"][0]["lanes"])

    def test_exact_copy_only_in_the_own_boq_is_not_offered(self):
        specs = [{"key": "T|S|1", "desc": "GI perforated cable tray 300 x 50 mm"}, {"key": "T|S|2", "desc": "GI perforated cable tray 300 x 50 mm"},
                 {"key": "B|S|1", "desc": "GI perforated cable tray 300 x 50 mm with cover"}]
        c = self._cands(_pool(specs))
        self.assertEqual(c["lanes"]["EXACT"], [])
        self.assertNotIn("T|S|2", [e["key"] for e in c["entries"]] + [k for e in c["entries"] for k in e["copies"]])

    # ---- W1 ----
    def test_w1_scores_the_same_discipline_only(self):
        pool = _pool(TRAYS)
        c = self._cands(pool)
        w1_keys = {pool.rows[i]["key"] for g in c["lanes"]["W1"] for i, r in enumerate(pool.rows) if r["group"] == g}
        self.assertIn("B|S|1", w1_keys)
        self.assertNotIn("D|S|1", [e["key"] for e in c["entries"] if "W1" in e["lanes"] and e["key"] == "D|S|1"])
        scored = L.score(L.target_from_row(pool, "T|S|1"), pool)
        flag = {pool.rows[r[0]]["key"]: r[4] for r in scored["rows"]}
        self.assertEqual(flag["B|S|1"], 1)
        self.assertEqual(flag["D|S|1"], 0)        # another discipline: no W1

    def test_another_category_needs_the_gate(self):
        specs = TRAYS + [{"key": "F|S|1", "desc": "GI perforated cable tray 300 x 50 mm", "cat": "hvac_raceway"}]
        pool = _pool(specs)
        flag = {pool.rows[r[0]]["key"]: r[4] for r in L.score(L.target_from_row(pool, "T|S|1"), pool)["rows"]}
        self.assertEqual(flag["F|S|1"], 0)        # V2 high but no readings to line up: the gate keeps it out
        pool2 = _pool([dict(s, v1=["width_mm=300"]) if s["key"] in ("T|S|1",) else s for s in TRAYS] + [{"key": "F|S|1", "desc": "GI perforated cable tray 300 x 50 mm", "cat": "hvac_raceway", "v1": ["width_mm=300"]}])
        flag2 = {pool2.rows[r[0]]["key"]: r[4] for r in L.score(L.target_from_row(pool2, "T|S|1"), pool2)["rows"]}
        self.assertEqual(flag2["F|S|1"], 1)       # every shared reading equal and V2 >= 85: admitted

    # ---- the T2 fix ----
    def test_a_number_on_one_side_only_never_demotes(self):
        a = P.tok(P.nz_payload({"description": "13 mm, 19 mm and 28.6 mm pipe"}))
        b = P.tok(P.nz_payload({"description": "28.6 mm pipe"}))
        self.assertNotEqual(L.compare3(a, b)[0], "CONFLICT")

    def test_a_real_difference_demotes_below_the_rest(self):
        a = P.tok(P.nz_payload({"description": "10 mm thick plate"}))
        b = P.tok(P.nz_payload({"description": "9 mm thick plate"}))
        self.assertEqual(L.compare3(a, b)[0], "CONFLICT")
        pool = _pool(TRAYS)
        c = self._cands(pool)
        w1 = {e["key"]: e["w1"] for e in c["entries"] if e["w1"]}
        self.assertTrue(w1["C|S|1"]["demoted"])                   # 600 vs 300 on the row: demoted
        self.assertFalse(w1["B|S|1"]["demoted"])
        order = [e["key"] for e in c["entries"] if "W1" in e["lanes"]]
        self.assertLess(order.index("B|S|1"), order.index("C|S|1"))

    # ---- WORD ----
    def test_word_reaches_another_category(self):
        specs = TRAYS + [{"key": "G|S|1", "desc": "perforated tray support channel", "cat": "miscellaneous", "disc": "HVAC"}]
        pool = _pool(specs)
        c = self._cands(pool)
        g = pool.rows[pool.byk["G|S|1"]]["group"]
        self.assertIn(g, c["lanes"]["WORD_all"])

    # ---- CARD ----
    def test_card_lane_same_head_and_values(self):
        cards = {"T|S|1": _card(), "B|S|1": _card(), "C|S|1": _card(width=600), "E|S|1": _card(kind="conduit", name="pvc conduit")}
        pool = _pool(TRAYS, cards=cards)
        c = self._cands(pool, card=cards["T|S|1"])
        g = lambda k: pool.rows[pool.byk[k]]["group"]  # noqa: E731
        self.assertIn(g("B|S|1"), c["lanes"]["CARD"])
        self.assertNotIn(g("C|S|1"), c["lanes"]["CARD"])          # a differing dimension rejects
        self.assertNotIn(g("E|S|1"), c["lanes"]["CARD"])          # another head is never compared

    def test_no_target_card_no_card_lane(self):
        cards = {"B|S|1": _card()}
        pool = _pool(TRAYS, cards=cards)
        self.assertEqual(self._cands(pool, card=None)["lanes"]["CARD"], [])

    def test_a_scope_exclusion_rejects(self):
        cards = {"B|S|1": _card(scope="supply_only")}
        pool = _pool(TRAYS, cards=cards)
        c = self._cands(pool, card=_card(scope="supply_and_install"))
        self.assertEqual(c["lanes"]["CARD"], [])

    # ---- RULES ----
    def test_rules_lane_equal_signature_and_values(self):
        specs = [dict(s, rules_key="SIG|{\"supply_rate\": 10}") if s["key"] in ("T|S|1", "C|S|1") else s for s in TRAYS]
        specs = [dict(s, rules_key="SIG|{\"supply_rate\": 11}") if s["key"] == "B|S|1" else s for s in specs]
        pool = _pool(specs)
        c = self._cands(pool)
        g = lambda k: pool.rows[pool.byk[k]]["group"]  # noqa: E731
        self.assertEqual(c["rules"], "ok")
        self.assertIn(g("C|S|1"), c["lanes"]["RULES"])
        self.assertNotIn(g("B|S|1"), c["lanes"]["RULES"])          # same signature, other values (R-H2U): not

    def test_rules_unavailable_leaves_the_rest(self):
        pool = _pool(TRAYS)
        c = self._cands(pool, rules_key="X", rules_unavailable="node not found on the worker's PATH")
        self.assertEqual(c["rules"], "unavailable: node not found on the worker's PATH")
        self.assertEqual(c["lanes"]["RULES"], [])
        self.assertTrue(c["lanes"]["W1"])
        self.assertTrue(c["lanes"]["EXACT"])

    def test_no_readings_turns_rules_off(self):
        pool = _pool(TRAYS)
        c = self._cands(pool, has_readings=False, rules_key="SIG")
        self.assertEqual(c["rules"], "off")

    # ---- caps ----
    def test_caps(self):
        specs = [{"key": "T|S|1", "desc": "GI perforated cable tray 300 x 50 mm", "rules_key": "R"}]
        specs += [{"key": f"X{n:02d}|S|1", "desc": f"GI perforated cable tray 300 x 50 mm type {n}", "rules_key": "R"} for n in range(40)]
        cards = {s["key"]: _card() for s in specs}
        pool = _pool(specs, cards=cards)
        c = self._cands(pool, card=cards["T|S|1"])
        self.assertEqual(len(c["lanes"]["W1"]), 10)
        self.assertEqual(len(c["lanes"]["WORD"]), 3)
        self.assertEqual(len(c["lanes"]["CARD"]), 3)
        self.assertEqual(len(c["lanes"]["RULES"]), 5)
        self.assertEqual(len(c["lanes"]["W1_all"]), 30)
        self.assertEqual(len(c["lanes"]["CARD_all"]), 5)
        self.assertEqual(len(c["lanes"]["RULES_all"]), 10)
        self.assertLessEqual(len(c["entries"]), 10 + 3 + 3 + 5)

    # ---- de-dup and the representative ----
    def test_one_entry_per_group_and_its_representative(self):
        specs = TRAYS + [{"key": "A2|S|1", "desc": "GI perforated cable tray 300 x 50 mm", "rec": "2026-05-01 00:00:00"},
                         {"key": "A3|S|1", "desc": "GI perforated cable tray 300 x 50 mm", "rec": "2026-03-01 00:00:00"}]
        pool = _pool(specs)
        c = self._cands(pool)
        g = pool.rows[pool.byk["A|S|1"]]["group"]
        es = [e for e in c["entries"] if e["group"] == g]
        self.assertEqual(len(es), 1)
        self.assertEqual(es[0]["key"], "A2|S|1")                   # the most recent
        self.assertEqual(sorted(es[0]["copies"]), ["A3|S|1", "A|S|1"])
        pool_c = _pool(specs, cards={"A3|S|1": _card()})
        es_c = [e for e in self._cands(pool_c)["entries"] if e["group"] == g]
        self.assertEqual(es_c[0]["key"], "A3|S|1")                 # a member with a card wins over the most recent

    def test_a_group_with_no_offered_member_is_skipped(self):
        pool = _pool(TRAYS, kept={"T|S|1", "B|S|1", "C|S|1", "D|S|1", "E|S|1"})   # the exact copy's BoQ is not kept
        c = self._cands(pool)
        g = pool.rows[pool.byk["A|S|1"]]["group"]
        self.assertNotIn(g, [e["group"] for e in c["entries"]])

    def test_wip_rows_are_not_offered_to_w1(self):
        specs = [dict(s, wip=True) if s["key"] == "B|S|1" else s for s in TRAYS]
        pool = _pool(specs)
        keys = {pool.rows[r[0]]["key"] for r in L.score(L.target_from_row(pool, "T|S|1"), pool)["rows"]}
        self.assertNotIn("B|S|1", keys)
        self.assertIn("C|S|1", keys)

    def test_merge_order(self):
        self.assertEqual(L.LANE_ORDER, ("EXACT", "W1", "WORD", "CARD", "RULES"))
        self.assertEqual(L.CAPS, {"W1": 10, "WORD": 3, "CARD": 3, "RULES": 5})

    # ---- the BoQ's own identical rows ----
    def test_identical_rows_of_a_boq_are_judged_once(self):
        pool = _pool(TRAYS)
        ts = [L.target_from_row(pool, k) for k in ("T|S|1", "A|S|1", "B|S|1")]
        groups = L.dedupe_targets(ts, pool)
        self.assertEqual([len(v) for v in groups.values()], [2, 1])
