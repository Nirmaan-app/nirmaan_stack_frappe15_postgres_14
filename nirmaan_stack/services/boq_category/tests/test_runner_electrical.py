# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""Unit tests for the electrical category rule runner.

Pure unittest, NO frappe, runnable without a live site (boq_parser style):

    python -m unittest nirmaan_stack.services.boq_category.tests.test_runner_electrical

The fixture line strings are illustrative SHAPES grounded in the real committed
electrical vocabulary mined from the corpus (work_header='Electrical'); they are
not copied verbatim from any one BoQ.
"""
import unittest

from nirmaan_stack.services.boq_category.runner import classify_line, load_ruleset


class TestPerCategory(unittest.TestCase):
    """Each category: a representative line resolves to that category."""

    # (description, ancestor_texts, expected_category, allowed_bands)
    CASES = [
        ("Set of six light points controlled by MCB", ["POINT WIRING"],
         "point_wiring", {"HIGH"}),
        ("3.5C x 240 sq.mm XLPE armoured aluminium cable", ["LT CABLES"],
         "wiring_cabling", {"HIGH"}),
        ("6/16A modular switch socket with face plate", ["SOCKET OUTLETS"],
         "switches_sockets", {"HIGH"}),
        ("Outgoing : 36 Nos. 16A SP MCB of 'D' curve", [],
         "db_switchgear", {"HIGH"}),
        ("CAT6 UTP data cable with RJ45 jack and patch panel", [],
         "networking", {"HIGH", "MED"}),
        ("Supply of 30 KVA online UPS with SMF battery", ["UPS SYSTEM"],
         "ups", {"HIGH"}),
        ("25mm dia MS conduit with flexible conduit", ["CONDUITING"],
         "conduit_piping", {"HIGH"}),
        ("63A 5 pin industrial socket with plug top, IP67, metal clad",
         ["INDUSTRIAL SOCKETS"], "industrial_sockets", {"HIGH"}),
        ("300mm perforated GI cable tray with cover", ["CABLE TRAY"],
         "cabletray_raceway", {"HIGH"}),
        ("End termination with lug and gland", ["END TERMINATION"],
         "termination", {"HIGH"}),
        ("GI earth strip 25x3mm laid in earth pit", ["EARTHING"],
         "earthing", {"HIGH"}),
        ("Supply of LT Panel, CRCA floor mounted, with bus bar and feeder", [],
         "panels", {"HIGH"}),
    ]

    def test_each_category_resolves(self):
        for desc, anc, cat, bands in self.CASES:
            with self.subTest(category=cat):
                r = classify_line(desc, anc)
                self.assertEqual(r["category_id"], cat,
                                 msg=f"{desc!r} -> {r['category_id']} ({r['all_scores']})")
                self.assertIn(r["band"], bands,
                              msg=f"{desc!r} band={r['band']} score={r['score']}")


class TestDbVsPanels(unittest.TestCase):
    """The headline ambiguity: standalone DB/switchgear vs built panel assembly."""

    def test_schedule_is_db_high(self):
        r = classify_line("Outgoing : 36 Nos. 16A SP MCB of 'D' curve", [])
        self.assertEqual(r["category_id"], "db_switchgear")
        self.assertEqual(r["band"], "HIGH")

    def test_assembly_is_panels_high(self):
        r = classify_line("LT Panel CRCA floor mounted with bus bar", [])
        self.assertEqual(r["category_id"], "panels")
        self.assertEqual(r["band"], "HIGH")

    def test_bare_breaker_is_med(self):
        r = classify_line("63A 4P MCCB", [])
        self.assertEqual(r["category_id"], "db_switchgear")
        self.assertEqual(r["band"], "MED")

    def test_led_panel_excluded_to_novel(self):
        r = classify_line("2X2 LED panel, CRCA housing, recessed mounted", [])
        self.assertEqual(r["category_id"], "novel")
        self.assertEqual(r["band"], "ABSTAIN")
        self.assertEqual(r["all_scores"].get("panels", 0.0), 0.0)


class TestFalseFriends(unittest.TestCase):
    """Exclusion guards for known false friends."""

    def test_socket_earth_pin_not_earthing(self):
        r = classify_line("Earthing of 16A socket outlet with 3 pin and earth", [])
        self.assertNotEqual(r["category_id"], "earthing")
        # earthing signal must be zeroed by the pin/socket exclusion
        self.assertEqual(r["all_scores"].get("earthing", 0.0), 0.0)


class TestConflict(unittest.TestCase):
    """A genuine two-category contest -> penalised band + runner_up + both named."""

    def test_breaker_in_panel_is_contested(self):
        r = classify_line("MCCB in panel", [])
        self.assertIsNotNone(r["runner_up"])
        self.assertEqual(r["band"], "LOW")
        self.assertEqual(r["category_id"], "db_switchgear")
        self.assertEqual(r["runner_up"]["category_id"], "panels")
        # reason must name the competing category and flag review
        self.assertIn("Panels", r["reason"])
        self.assertIn("review", r["reason"].lower())


class TestAbstain(unittest.TestCase):
    """No signal -> ABSTAIN -> novel."""

    def test_no_signal_abstains(self):
        r = classify_line("Providing all labour and supervision as per general conditions", [])
        self.assertEqual(r["category_id"], "novel")
        self.assertEqual(r["band"], "ABSTAIN")
        self.assertEqual(r["score"], 0.0)
        self.assertEqual(r["signals_fired"], [])
        self.assertIn("novel", r["reason"].lower())


class TestContract(unittest.TestCase):
    """Output-contract invariants: score range, band thresholds, determinism, reason."""

    def test_score_in_unit_interval(self):
        for desc in ["Outgoing : 12 Nos 16A SP MCB of 'C' curve",
                     "3C x 2.5 sq.mm FRLS copper cable",
                     "random text with no signal at all"]:
            r = classify_line(desc, [])
            self.assertGreaterEqual(r["score"], 0.0)
            self.assertLessEqual(r["score"], 1.0)
            for v in r["all_scores"].values():
                self.assertGreaterEqual(v, 0.0)
                self.assertLessEqual(v, 1.0)

    def test_band_matches_thresholds(self):
        scoring = load_ruleset()["scoring"]["bands"]
        for desc, anc in [("GI earth strip in earth pit", ["EARTHING"]),
                          ("63A 4P MCCB", []),
                          ("MCCB in panel", []),
                          ("no signal here", [])]:
            r = classify_line(desc, anc)
            s, band = r["score"], r["band"]
            if band == "HIGH":
                self.assertGreaterEqual(s, scoring["high"])
            elif band == "MED":
                self.assertTrue(scoring["med"] <= s < scoring["high"])
            elif band == "LOW":
                self.assertTrue(0.0 < s < scoring["med"])
            else:
                self.assertEqual(band, "ABSTAIN")
                self.assertEqual(s, 0.0)

    def test_deterministic(self):
        args = ("Outgoing : 36 Nos. 16A SP MCB of 'D' curve", ["DISTRIBUTION BOARDS"])
        self.assertEqual(classify_line(*args), classify_line(*args))

    def test_reason_contains_fired_plain(self):
        r = classify_line("Outgoing : 36 Nos. 16A SP MCB of 'D' curve", [])
        self.assertTrue(r["reason"])
        # the reason is composed from fired rules' plain text
        self.assertIn("distribution-board schedule", r["reason"])
        self.assertTrue(any(f["plain"] in r["reason"] for f in r["signals_fired"]))


class TestAssetsWellFormed(unittest.TestCase):
    """The 12 categories + novel are present and rules reference valid categories."""

    def test_thirteen_categories(self):
        cats = {c["category_id"] for c in load_ruleset()["categories"]}
        expected = {
            "point_wiring", "wiring_cabling", "switches_sockets", "db_switchgear",
            "networking", "ups", "conduit_piping", "industrial_sockets",
            "cabletray_raceway", "termination", "earthing", "panels", "novel",
        }
        self.assertEqual(cats, expected)

    def test_every_rule_targets_a_known_category(self):
        rs = load_ruleset()
        cats = {c["category_id"] for c in rs["categories"]}
        for rule in rs["rules"]:
            self.assertIn(rule["category_id"], cats)
            self.assertTrue(rule.get("rule_id"))
            self.assertTrue(rule.get("source"))
            self.assertTrue(rule.get("plain"))


class TestTuningFixes(unittest.TestCase):
    """The five fixes from the 2026-06-30 proving-run findings."""

    # FIX 1 -- junction box now reads as cabletray_raceway (was ABSTAIN -> novel)
    def test_fix1_junction_box_is_cabletray(self):
        r = classify_line("100 x 100 x 60mm junction box with 2 mm thick cover", [])
        self.assertEqual(r["category_id"], "cabletray_raceway")
        self.assertNotEqual(r["band"], "ABSTAIN")

    # FIX 2 -- panel/board false friends excluded from panels
    def test_fix2_fire_extinguisher_panel_not_panels(self):
        r = classify_line("SITC of Automatic Fire Extinguisher Panel for electrical room", [])
        self.assertNotEqual(r["category_id"], "panels")
        self.assertEqual(r["all_scores"].get("panels", 0.0), 0.0)

    def test_fix2_danger_board_not_panels(self):
        r = classify_line("Electrical Danger Board 200x150mm as per norms", [])
        self.assertNotEqual(r["category_id"], "panels")

    # FIX 3 -- 'Wiring for ... point(s)' is point_wiring, not wiring_cabling
    def test_fix3_wiring_for_points_is_point_wiring(self):
        r = classify_line(
            "Wiring for Ceiling / Wall fan points with 3x2.5 Sq.mm FRLS PVC copper conductor", [])
        self.assertEqual(r["category_id"], "point_wiring")
        self.assertEqual(r["all_scores"].get("wiring_cabling", 0.0), 0.0)

    # FIX 4 -- a bare dimension fragment inherits its cable-tray parent (down-weighted).
    # The ancestor names the tray via an item-style token ('perforated') that no
    # ANCESTOR rule catches, so normal scoring abstains and the inheritance fallback
    # is what resolves it (an ancestor saying 'cable tray' would be caught directly).
    def test_fix4_fragment_inherits_cabletray(self):
        r = classify_line("250 x 100mm", ["Supply of perforated hot-dip galvanised tray 300mm wide"])
        self.assertEqual(r["category_id"], "cabletray_raceway")
        self.assertIn(r["band"], {"LOW", "MED"})  # inherited is never HIGH
        self.assertIn("inherited", r["reason"].lower())

    def test_fix4_no_inheritance_without_ancestor_signal(self):
        # truly novel line with no category-bearing ancestor stays novel
        r = classify_line("supervision and general conditions", ["Electrical"])
        self.assertEqual(r["category_id"], "novel")
        self.assertEqual(r["band"], "ABSTAIN")

    # FIX 5a -- an industrial socket on a DB sheet beats db_switchgear (breaker excluded)
    def test_fix5_industrial_socket_under_db_ancestor(self):
        r = classify_line(
            "16 Amps 3 pin moulded industrial type socket with plug controlled by 16 Amps DP MCB",
            ["DISTRIBUTION BOARDS"])
        self.assertEqual(r["category_id"], "industrial_sockets")
        self.assertEqual(r["all_scores"].get("db_switchgear", 0.0), 0.0)

    # FIX 5b -- direct-signal bonus: a direct hit beats an equal ancestor-only competitor
    def test_fix5_direct_beats_ancestor_only(self):
        r = classify_line("bus bar", ["EARTHING"])
        self.assertEqual(r["category_id"], "panels")  # direct PNL-ENCLOSURE over ancestor-only earthing


class TestNoRegression(unittest.TestCase):
    """The rock-solid proving-run cases must STAY solid after tuning."""

    def test_db_schedule_still_high(self):
        r = classify_line("6 Way TPN DB, each phase consisting of 4 Nos. 10A SP MCB of 'D' curve", [])
        self.assertEqual(r["category_id"], "db_switchgear")
        self.assertEqual(r["band"], "HIGH")

    def test_earthing_still_high(self):
        r = classify_line("75 x 10mm GI strip", ["EARTHING"])
        self.assertEqual(r["category_id"], "earthing")
        self.assertEqual(r["band"], "HIGH")

    def test_conduit_still_resolves(self):
        r = classify_line("25mm dia conduit", [])
        self.assertEqual(r["category_id"], "conduit_piping")

    def test_plain_cable_still_wiring(self):
        r = classify_line("3.5C x 240 sq.mm XLPE armoured aluminium cable", ["LT CABLES"])
        self.assertEqual(r["category_id"], "wiring_cabling")
        self.assertEqual(r["band"], "HIGH")

    def test_led_panel_still_excluded(self):
        r = classify_line("2X2 LED panel, CRCA housing, recessed mounted", [])
        self.assertEqual(r["category_id"], "novel")


if __name__ == "__main__":
    unittest.main()
