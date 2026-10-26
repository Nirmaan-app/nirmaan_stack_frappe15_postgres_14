# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Where each completed Porter order is suggested to go, and why (#1448, ADR-0032).

    devenv.sh unit nirmaan_stack.services.outflow_import.test_porter_placement

Every test goes through `place_orders` over a master built by `build_placement_master`, the two calls the
upload makes. The project master is SYNTHETIC; the table at the end mirrors the remark groups measured on
the real 2026-09 statement (which holds staff contact details and is not committed).
"""

import unittest

from nirmaan_stack.services.outflow_import.porter import (
    EXPENSE_TYPE,
    REASON_ADDRESS,
    REASON_CONFLICT,
    REASON_HISTORY,
    REASON_INITIALS,
    REASON_NAME,
    REASON_TYPO,
    STRENGTH_CHECK,
    STRENGTH_STRONG,
)
from nirmaan_stack.services.outflow_import.porter_placement import (
    EarlierPlacement,
    OrderFacts,
    SiteAddress,
    build_placement_master,
    place_orders,
)

PROJECTS = [
    ("PROJ-ZEPHYR", "Zephyr Tower"),
    ("PROJ-QUILLON", "Quillon Park"),
    ("PROJ-ORION", "Orion Mall"),
]


def _order(name, remarks="", city="Bangalore", to_address="", from_address=""):
    return OrderFacts(
        name=name, remarks=remarks, city=city, from_address=from_address, to_address=to_address
    )


def _place(orders, projects=PROJECTS, sites=(), earlier=()):
    return place_orders(orders, build_placement_master(projects, sites=sites, earlier=earlier))


def _site(project, line1, line2="", city="Bengaluru", state="Karnataka", pincode=""):
    return SiteAddress(
        project=project,
        address_line1=line1,
        address_line2=line2,
        city=city,
        state=state,
        country="India",
        pincode=pincode,
    )


def _to(words, pincode="560001", city="Bengaluru"):
    """A Porter address end, written the way the statement writes one."""
    return f"{words}  {city}  Karnataka {pincode}  India"


SITES = [
    _site("PROJ-ZEPHYR", "Zephyr Tower Site, Outer Ring Road", "Bellandur", pincode="560103"),
    _site("PROJ-QUILLON", "Plot 7, Brookefield Main Road", "Whitefield", pincode="560066"),
    _site("PROJ-ORION", "Orion Mall, Rajajinagar", "Malleshwaram West", pincode="560055"),
]

#: Each order end below names one project by two pieces of evidence: words unique to its site, or one
#: word and its unique pincode.
TO_ZEPHYR = _to("Gate 2 Bellandur Outer Ring", pincode="560103")
TO_QUILLON = _to("Brookefield Whitefield", pincode="560037")
TO_ORION = _to("Rajajinagar Malleshwaram", pincode="560010")
TO_NOWHERE = _to("12 Test Layout Indiranagar", pincode="560038")


class TestTheNameMatcher(unittest.TestCase):
    def test_a_remark_naming_a_project_in_full_is_a_strong_name_suggestion(self):
        placed = _place([_order("A", "zephyr tower project ")])["A"]
        self.assertEqual(placed.ledger, "Project Expenses")
        self.assertEqual(placed.project, "PROJ-ZEPHYR")
        self.assertEqual(placed.project_name, "Zephyr Tower")
        self.assertEqual(placed.reason, REASON_NAME)
        self.assertEqual(placed.strength, STRENGTH_STRONG)
        self.assertEqual(placed.expense_type, EXPENSE_TYPE)

    def test_a_single_unique_keyword_is_a_name_suggestion_to_check(self):
        placed = _place([_order("A", "quillon site")])["A"]
        self.assertEqual(placed.project, "PROJ-QUILLON")
        self.assertEqual(placed.reason, REASON_NAME)
        self.assertEqual(placed.strength, STRENGTH_CHECK)

    def test_no_project_is_a_non_project_expense_with_no_reason(self):
        placed = _place([_order("A", ""), _order("B", "misc delivery")])
        for name in ("A", "B"):
            self.assertEqual(placed[name].ledger, "Non Project Expenses")
            self.assertIsNone(placed[name].project)
            self.assertEqual(placed[name].reason, "")
            self.assertEqual(placed[name].strength, "")
            self.assertEqual(placed[name].expense_type, EXPENSE_TYPE)


class TestTypos(unittest.TestCase):
    MASTER = [("PROJ-CYGNUS", "Cygnus 2F"), ("PROJ-ORION", "Orion Mall"), ("PROJ-TELUS", "Telus")]

    def test_one_letter_off_a_keyword_unique_to_one_project_is_a_typo_to_check(self):
        placed = _place([_order("A", "cignus")], projects=self.MASTER)["A"]
        self.assertEqual(placed.project, "PROJ-CYGNUS")
        self.assertEqual(placed.reason, REASON_TYPO)
        self.assertEqual(placed.strength, STRENGTH_CHECK)

    def test_a_letter_missing_or_added_is_one_edit_too(self):
        for remark in ("cygns material", "cyggnus"):
            self.assertEqual(_place([_order("A", remark)], projects=self.MASTER)["A"].project, "PROJ-CYGNUS", remark)

    def test_a_keyword_shorter_than_five_letters_is_never_read_with_a_typo(self):
        # "tola" is one edit from "tela" (4 letters); "tekus" off "telus" (5 letters as written) is read.
        self.assertIsNone(_place([_order("A", "tola")], projects=[("P", "Tela Park"), ("Q", "Orion")])["A"].project)
        self.assertEqual(_place([_order("A", "tekus")], projects=self.MASTER)["A"].project, "PROJ-TELUS")

    def test_two_edits_away_is_not_a_typo(self):
        self.assertIsNone(_place([_order("A", "cignos")], projects=self.MASTER)["A"].project)

    def test_a_typo_one_edit_from_two_projects_names_neither(self):
        master = [("P", "Lotus Park"), ("Q", "Lotur Mall")]
        self.assertIsNone(_place([_order("A", "lotuz")], projects=master)["A"].project)

    def test_a_word_of_another_projects_name_is_not_a_typo(self):
        # "lotus" is a real word of the master (two projects share it): never read as a typo of "lotte".
        master = [("P", "Lotus Park"), ("Q", "Lotus Mall"), ("R", "Lotte Tower")]
        self.assertIsNone(_place([_order("A", "lotus")], projects=master)["A"].project)


class TestInitials(unittest.TestCase):
    MASTER = [
        ("PROJ-VR", "VR Mall Food Court"),
        ("PROJ-ORION", "Orion Mall"),
        ("PROJ-EY", "Ernst & Young"),
        ("PROJ-ACME", "Acme Block"),
    ]

    def _project(self, remark, projects=MASTER):
        return _place([_order("A", remark)], projects=projects)["A"]

    def test_spaced_initials_that_are_a_word_of_one_project_name_it(self):
        placed = self._project("v r mall")
        self.assertEqual(placed.project, "PROJ-VR")
        self.assertEqual(placed.reason, REASON_INITIALS)
        self.assertEqual(placed.strength, STRENGTH_CHECK)

    def test_spaced_initials_of_one_project_name_it(self):
        for remark in ("e y", "E Y office", "material to e.y"):
            placed = self._project(remark)
            self.assertEqual(placed.project, "PROJ-EY", remark)
            self.assertEqual(placed.reason, REASON_INITIALS, remark)

    def test_initials_two_projects_share_name_neither(self):
        master = self.MASTER + [("PROJ-EY2", "Eastern Yards")]
        self.assertIsNone(self._project("e y", master).project)

    def test_one_letter_alone_or_unspaced_letters_are_not_initials(self):
        # "a" alone is a word; letters typed together are not read ("to", "at" are initials too).
        for remark in ("a delivery", "ey"):
            self.assertIsNone(self._project(remark).project, remark)


class TestTheSiteAddress(unittest.TestCase):
    def _one(self, order, sites=SITES, projects=PROJECTS):
        return _place([order], projects=projects, sites=sites)[order.name]

    def test_an_order_with_no_remark_is_placed_by_its_address_to_check(self):
        placed = self._one(_order("A", "", to_address=TO_QUILLON, from_address=TO_NOWHERE))
        self.assertEqual(placed.project, "PROJ-QUILLON")
        self.assertEqual(placed.reason, REASON_ADDRESS)
        self.assertEqual(placed.strength, STRENGTH_CHECK)

    def test_the_from_end_counts_as_well_as_the_to_end(self):
        placed = self._one(_order("A", "", from_address=TO_ORION, to_address=TO_NOWHERE))
        self.assertEqual(placed.project, "PROJ-ORION")

    def test_one_piece_of_evidence_is_not_enough(self):
        for address in (_to("Brookefield"), _to("Gate 2", pincode="560103")):
            self.assertIsNone(self._one(_order("A", "", to_address=address)).project, address)

    def test_a_word_and_the_sites_own_pincode_are_two_pieces(self):
        placed = self._one(_order("A", "", to_address=_to("Near Bellandur lake", pincode="560103")))
        self.assertEqual(placed.project, "PROJ-ZEPHYR")

    def test_a_pincode_two_sites_share_is_no_evidence(self):
        sites = SITES + [_site("PROJ-OTHER", "Kadubeesanahalli", pincode="560103")]
        projects = PROJECTS + [("PROJ-OTHER", "Other Works")]
        placed = self._one(_order("A", "", to_address=_to("Near Bellandur", pincode="560103")), sites, projects)
        self.assertIsNone(placed.project)

    def test_a_word_two_sites_share_is_no_evidence(self):
        sites = SITES + [_site("PROJ-OTHER", "Brookefield Annexe", "Whitefield")]
        projects = PROJECTS + [("PROJ-OTHER", "Other Works")]
        placed = self._one(_order("A", "", to_address=TO_QUILLON), sites, projects)
        self.assertIsNone(placed.project)

    def test_the_city_and_state_of_a_site_are_no_evidence(self):
        # The only Hyderabad site: every Hyderabad delivery says "Hyderabad Telangana".
        sites = SITES + [
            _site("PROJ-HYD", "Plot 4, Gachibowli", "Hyderabad, Telangana", city="Hyderabad", state="Telangana")
        ]
        projects = PROJECTS + [("PROJ-HYD", "Deccan Works")]
        address = "Demo Electricals  Begumpet  Hyderabad  Telangana 500016  India"
        self.assertIsNone(self._one(_order("A", "", city="Hyderabad", to_address=address), sites, projects).project)

    def test_two_ends_naming_two_projects_name_neither(self):
        placed = self._one(_order("A", "", from_address=TO_ORION, to_address=TO_QUILLON))
        self.assertIsNone(placed.project)


class TestNameAndAddressTogether(unittest.TestCase):
    def _group(self, remark, *addresses, projects=PROJECTS):
        orders = [_order(f"O{i}", remark, to_address=address) for i, address in enumerate(addresses)]
        return [placed for placed in _place(orders, projects=projects, sites=SITES).values()]

    def test_an_address_agreeing_with_the_name_makes_it_strong(self):
        (placed,) = self._group("quillon site", TO_QUILLON)
        self.assertEqual(placed.project, "PROJ-QUILLON")
        self.assertEqual(placed.reason, f"{REASON_NAME}+{REASON_ADDRESS}")
        self.assertEqual(placed.strength, STRENGTH_STRONG)

    def test_a_group_majority_agreeing_makes_every_order_strong(self):
        placed = self._group("quillon site", TO_QUILLON, TO_QUILLON, TO_NOWHERE, TO_NOWHERE)
        self.assertEqual({p.project for p in placed}, {"PROJ-QUILLON"})
        self.assertEqual({p.strength for p in placed}, {STRENGTH_STRONG})

    def test_a_single_noisy_address_never_overrides_the_name(self):
        placed = self._group("zephyr tower", TO_ZEPHYR, TO_NOWHERE, TO_ORION)
        self.assertEqual([p.project for p in placed], ["PROJ-ZEPHYR"] * 3)
        self.assertEqual(placed[2].reason, REASON_NAME)
        self.assertEqual(placed[2].strength, STRENGTH_STRONG)

    def test_a_group_majority_for_another_project_leaves_the_group_unplaced_to_check(self):
        placed = self._group("zephyr tower", TO_ORION, TO_ORION, TO_ZEPHYR)
        for p in placed:
            self.assertIsNone(p.project)
            self.assertEqual(p.ledger, "Non Project Expenses")
            self.assertEqual(p.reason, REASON_CONFLICT)
            self.assertEqual(p.strength, STRENGTH_CHECK)

    def test_a_majority_needs_two_orders_even_in_a_small_group(self):
        (placed,) = self._group("zephyr tower", TO_ORION)
        self.assertEqual(placed.project, "PROJ-ZEPHYR")

    def test_a_remark_naming_no_project_falls_back_to_each_orders_address(self):
        placed = self._group("site material", TO_ORION, TO_QUILLON, TO_NOWHERE)
        self.assertEqual([p.project for p in placed], ["PROJ-ORION", "PROJ-QUILLON", None])
        self.assertEqual([p.reason for p in placed], [REASON_ADDRESS, REASON_ADDRESS, ""])

    def test_a_remark_naming_two_projects_falls_back_to_the_address(self):
        (placed,) = self._group("zephyr tower and quillon park", TO_ORION)
        self.assertEqual(placed.project, "PROJ-ORION")
        self.assertEqual(placed.reason, REASON_ADDRESS)

    def test_orders_with_no_remark_are_placed_one_by_one(self):
        placed = self._group("", TO_ORION, TO_ORION, TO_QUILLON)
        self.assertEqual([p.project for p in placed], ["PROJ-ORION", "PROJ-ORION", "PROJ-QUILLON"])


class TestTheLikelyProjects(unittest.TestCase):
    """#1563: the projects the signals named for an order's group, for the one-click choices -- the
    remark's project first, then the addresses', most voted first. The same for every order of a group."""

    def _likely(self, remark, *addresses):
        orders = [_order(f"O{i}", remark, to_address=address) for i, address in enumerate(addresses)]
        return {placed.likely for placed in _place(orders, sites=SITES).values()}

    def test_a_name_and_an_address_majority_that_disagree_name_both(self):
        self.assertEqual(
            self._likely("zephyr tower", TO_ORION, TO_ORION, TO_ZEPHYR), {("PROJ-ZEPHYR", "PROJ-ORION")}
        )

    def test_a_remark_naming_no_project_names_each_address_most_voted_first(self):
        self.assertEqual(
            self._likely("site material", TO_QUILLON, TO_ORION, TO_ORION, TO_NOWHERE),
            {("PROJ-ORION", "PROJ-QUILLON")},
        )

    def test_a_loose_name_with_no_address_names_one(self):
        self.assertEqual(self._likely("quillon site", TO_NOWHERE), {("PROJ-QUILLON",)})

    def test_nothing_found_names_none(self):
        self.assertEqual(self._likely("misc delivery", TO_NOWHERE), {()})

    def test_history_kept_non_project_names_only_the_addresses(self):
        earlier = [EarlierPlacement("quillon site", "Bangalore", None)]
        orders = [_order("A", "quillon site", to_address=TO_ORION)]
        placed = _place(orders, sites=SITES, earlier=earlier)["A"]
        self.assertEqual(placed.likely, ("PROJ-ORION",))


class TestEarlierImports(unittest.TestCase):
    """Signal 5: what a person kept in earlier Porter imports -- the live Expense of an earlier Porter
    Order, which a Rectify replaces -- for the same normalised remark and city."""

    def _one(self, remark, earlier, city="Bangalore", to_address=""):
        order = _order("A", remark, city=city, to_address=to_address)
        return _place([order], sites=SITES, earlier=earlier)["A"]

    def test_the_project_kept_last_time_is_suggested_for_the_same_remark_and_city(self):
        placed = self._one("Site Material!", [EarlierPlacement("site material", "Bangalore", "PROJ-ORION")])
        self.assertEqual(placed.project, "PROJ-ORION")
        self.assertEqual(placed.reason, REASON_HISTORY)
        self.assertEqual(placed.strength, STRENGTH_STRONG)

    def test_it_outranks_the_name_so_a_correction_is_made_once(self):
        earlier = [EarlierPlacement("quillon site", "Bangalore", "PROJ-ZEPHYR")] * 2
        self.assertEqual(self._one("quillon site", earlier).project, "PROJ-ZEPHYR")

    def test_another_city_is_another_remark(self):
        placed = self._one("site material", [EarlierPlacement("site material", "Hyderabad", "PROJ-ORION")])
        self.assertIsNone(placed.project)

    def test_an_order_kept_non_project_is_suggested_non_project(self):
        placed = self._one("quillon site", [EarlierPlacement("quillon site", "Bangalore", None)])
        self.assertEqual(placed.ledger, "Non Project Expenses")
        self.assertIsNone(placed.project)
        self.assertEqual(placed.reason, REASON_HISTORY)

    def test_earlier_orders_split_without_a_majority_say_nothing(self):
        earlier = [
            EarlierPlacement("quillon site", "Bangalore", "PROJ-ZEPHYR"),
            EarlierPlacement("quillon site", "Bangalore", "PROJ-ORION"),
        ]
        placed = self._one("quillon site", earlier)
        self.assertEqual((placed.project, placed.reason), ("PROJ-QUILLON", REASON_NAME))

    def test_the_placement_most_earlier_orders_kept_wins(self):
        earlier = [EarlierPlacement("quillon site", "Bangalore", "PROJ-ZEPHYR")] * 2 + [
            EarlierPlacement("quillon site", "Bangalore", None)
        ]
        self.assertEqual(self._one("quillon site", earlier).project, "PROJ-ZEPHYR")

    def test_a_project_no_longer_won_is_never_suggested(self):
        placed = self._one("site material", [EarlierPlacement("site material", "Bangalore", "PROJ-GONE")])
        self.assertIsNone(placed.project)
        self.assertEqual(placed.reason, "")

    def test_an_address_agreeing_is_named_too(self):
        placed = self._one(
            "site material", [EarlierPlacement("site material", "Bangalore", "PROJ-ORION")], to_address=TO_ORION
        )
        self.assertEqual(placed.reason, f"{REASON_HISTORY}+{REASON_ADDRESS}")


class TestTheSeptemberRemarkGroups(unittest.TestCase):
    """The measured cases of the 2026-09 statement (158 completed orders; 144 placed by the prototype: 78
    name+address, 43 name, 11 typo/initials, 12 address only), one row per remark group, over a
    synthetic master that reproduces why each was placed as it was. Names, sites and addresses are
    invented; the remarks are the shapes people typed.

    The two known misplacements must stay VISIBLE: each is a loose name reading, so it is Check.
    """

    MASTER = [
        ("P-TELUS", "Telus GIFT City"),
        ("P-CYGNUS", "Cygnus 2F"),
        ("P-VR", "VR Mall Food Court"),
        ("P-ORION", "Orion Mall"),
        ("P-EY", "Ernst & Young"),
        ("P-SCHNEIDER", "Schneider Innovation"),
        ("P-QBURST", "QBurst Kochi"),
        ("P-EXLK", "EXL Kochi"),
        ("P-EXLN", "EXL Noida"),
        ("P-ZEPHYR", "Zephyr Tower"),
        ("P-FUJITSU", "Fujitsu"),
        ("P-FID1", "Fidelity Chennai"),
        ("P-FID2", "Fidelity Chennai"),
        ("P-ADOBE", "Adobe Prestige"),
    ]
    SITES = [
        _site("P-TELUS", "Telus Campus, Bagmane Tech Park", "CV Raman Nagar", pincode="560093"),
        _site("P-ADOBE", "Prestige Cube, Koramangala", "Hosur Road", pincode="560029"),
        _site("P-FUJITSU", "Embassy Golflinks, Domlur", "Intermediate Ring Road", pincode="560071"),
        _site("P-ORION", "Orion Mall, Rajajinagar", "Malleshwaram West", pincode="560055"),
    ]
    EARLIER = [EarlierPlacement("nirmaan office", "Bangalore", None)] * 3

    TO_TELUS = _to("Bagmane Tech Park CV Raman Nagar", pincode="560093")
    TO_ADOBE = _to("Prestige Cube Koramangala", pincode="560029")
    TO_GOLFLINKS = _to("Embassy Golflinks Domlur", pincode="560071")
    SOMEWHERE = _to("Demo Hardware KR Market", pincode="560002")

    # (remark, [to address of each order], project, reason, strength)
    GROUPS = [
        # name + address: the remark names the project and the deliveries go to its site.
        ("telus project", [TO_TELUS] * 7 + [SOMEWHERE], "P-TELUS", "name+address", STRENGTH_STRONG),
        # name alone, the whole name: strong without an address.
        ("zephyr tower project", [SOMEWHERE, SOMEWHERE], "P-ZEPHYR", "name", STRENGTH_STRONG),
        # typo and initials: loose readings, checked.
        ("cignus", [SOMEWHERE], "P-CYGNUS", "typo", STRENGTH_CHECK),
        ("v r mall", [SOMEWHERE] * 3, "P-VR", "initials", STRENGTH_CHECK),
        ("e y", [SOMEWHERE], "P-EY", "initials", STRENGTH_CHECK),
        # the two known misplacements, each read off ONE word unique to the wrong project: Check.
        ("cheque to xinergy innovation", [SOMEWHERE], "P-SCHNEIDER", "name", STRENGTH_CHECK),
        ("exl and qburst project", [SOMEWHERE, SOMEWHERE], "P-QBURST", "name", STRENGTH_CHECK),
        # a name most of whose orders go to another project's site: nobody's guess, checked.
        ("fujitsu material", [TO_ADOBE, TO_ADOBE, TO_GOLFLINKS], None, "conflict", STRENGTH_CHECK),
        # an ambiguous name (two projects share it) falls back to the address.
        ("fidelity chennai", [TO_ADOBE], "P-ADOBE", "address", STRENGTH_CHECK),
        # no project in the remark, nor in the address: Non-Project.
        ("misc delivery", [SOMEWHERE], None, "", ""),
        # kept Non-Project last month, by a person: suggested so again.
        ("nirmaan office", [SOMEWHERE], None, "history", STRENGTH_STRONG),
        # no remark: one by one, by address.
        ("", [TO_TELUS], "P-TELUS", "address", STRENGTH_CHECK),
        ("", [SOMEWHERE], None, "", ""),
    ]

    def test_each_group_is_placed_as_measured(self):
        orders, expected = [], {}
        for g, (remark, addresses, project, reason, strength) in enumerate(self.GROUPS):
            for o, address in enumerate(addresses):
                name = f"G{g}-O{o}"
                orders.append(_order(name, remark, to_address=address))
                expected[name] = (project, reason, strength)
        placed = place_orders(
            orders, build_placement_master(self.MASTER, sites=self.SITES, earlier=self.EARLIER)
        )
        got = {name: (p.project, p.reason, p.strength) for name, p in placed.items()}
        for name, want in expected.items():
            self.assertEqual(got[name], want, name)

    def test_the_telus_order_going_elsewhere_rides_on_its_groups_majority(self):
        orders = [_order(f"T{i}", "telus project", to_address=self.TO_TELUS) for i in range(2)]
        orders.append(_order("T-ELSEWHERE", "telus project", to_address=self.SOMEWHERE))
        placed = place_orders(orders, build_placement_master(self.MASTER, sites=self.SITES))
        self.assertEqual(placed["T-ELSEWHERE"].strength, STRENGTH_STRONG)


class TestPurity(unittest.TestCase):
    def test_placement_reads_no_database_and_calls_no_ai(self):
        import ast
        import inspect

        from nirmaan_stack.services.outflow_import import porter_placement

        imported = set()
        for node in ast.walk(ast.parse(inspect.getsource(porter_placement))):
            if isinstance(node, ast.Import):
                imported |= {alias.name for alias in node.names}
            elif isinstance(node, ast.ImportFrom):
                imported.add(node.module or "")
        for module in imported:
            self.assertFalse(module.startswith("frappe"), module)
            self.assertNotIn("extraction", module)
            self.assertNotIn("alias", module)


if __name__ == "__main__":
    unittest.main()
