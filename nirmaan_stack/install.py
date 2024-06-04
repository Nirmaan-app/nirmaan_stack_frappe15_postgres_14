# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

from frappe.desk.page.setup_wizard.setup_wizard import make_records
from __future__ import unicode_literals
# import frappe

def before_install():
	check_frappe_version()

def after_install():
	try:
		print("Adding Administrator to Nirmaan Users")
		create_admin_user()
	except Exception as e:
	    raise e



def check_frappe_version():
	from semantic_version import Version
	from frappe import __version__

	frappe_version = Version(__version__)
	if (frappe_version.major or 0) < 15:
		raise SystemExit('Nirmaan Stack requires Frappe Framework version 15 or above')

def create_admin_user():
    nirmaan_user = [
		{"doctype": "Nirmaan Users", "first_name": "Administrator", "full_name": "Administrator", "email": "Administrator", "role_profile": "Nirmaan Admin Profile" }
    ]
    make_records(nirmaan_user)