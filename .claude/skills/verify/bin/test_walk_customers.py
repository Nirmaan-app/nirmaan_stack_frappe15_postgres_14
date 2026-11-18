"""Tests for walk_customers.py's choice of customers, on made-up list reads (no browser, no DB).

    cd .claude/skills/verify/bin && python3 -m unittest test_walk_customers
"""

import contextlib
import io
import unittest

from walk_customers import MADE_UP_PREFIX, pick_customers


def row(name, company, age_sec=3600):
    return {"name": name, "company_name": company, "age_sec": age_sec}


def pick(*rows):
    with contextlib.redirect_stdout(io.StringIO()):
        return pick_customers({"total": len(rows), "newest": list(rows)})


class PickCustomers(unittest.TestCase):
    def test_it_lists_the_rows_past_the_cache_and_opens_the_newest_real_customer(self):
        made_up = row("CUST-000003", f"{MADE_UP_PREFIX} 1112", 4000)
        listed, real = pick(made_up, row("CUST-000002", "Orchid Test Infra"), row("CUST-000001", "Lotus Test Works"))
        self.assertEqual([r["name"] for r in listed], ["CUST-000003", "CUST-000002", "CUST-000001"])
        self.assertEqual(real["name"], "CUST-000002")

    def test_no_customers_at_all_is_a_clear_failure(self):
        with self.assertRaisesRegex(SystemExit, "no customer"):
            pick()

    def test_every_customer_inside_the_list_cache_is_a_clear_failure(self):
        with self.assertRaisesRegex(SystemExit, "5-minute cache"):
            pick(row("CUST-000001", "Lotus Test Works", 10))

    def test_only_made_up_customers_is_a_clear_failure(self):
        with self.assertRaisesRegex(SystemExit, "made-up"):
            pick(row("CUST-000001", f"{MADE_UP_PREFIX} 1112"))


if __name__ == "__main__":
    unittest.main()
