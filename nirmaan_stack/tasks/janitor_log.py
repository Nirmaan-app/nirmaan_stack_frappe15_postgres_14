# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Single logging seam for the disk janitors.

`frappe.logger()` sets its level from `frappe.log_level or default_log_level`,
which is WARNING unless the site config carries a `logging` key. Neither
localhost nor prod sets one, so a plain `frappe.logger().info(...)` is DROPPED —
a janitor's only feedback channel would be silent. We therefore own a dedicated
`logs/janitor.log` and pin the level explicitly, without changing verbosity for
the rest of the bench.
"""

import logging

import frappe

LOGGER_MODULE = "janitor"


def janitor_log(message: str) -> None:
    logger = frappe.logger(LOGGER_MODULE)
    logger.setLevel(logging.INFO)
    logger.info(message)
