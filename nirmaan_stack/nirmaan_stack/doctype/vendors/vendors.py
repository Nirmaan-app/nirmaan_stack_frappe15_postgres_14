# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

import json

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.model.naming import getseries

from nirmaan_stack.services.vendor_msme import UDYAM_EXAMPLE, is_valid_udyam, normalize_udyam
from nirmaan_stack.services.vendor_tds import rate_to_store

class VendorGSTExistError(frappe.ValidationError):
	pass


class Vendors(Document):
	def validate(self):
		# The PAN sets the TDS rate when a vendor is created or its PAN / rate is edited: always 1% for
		# an Individual / HUF; anyone else keeps the rate the user set, 2% by default
		# (services/vendor_tds.py).
		# Every other save leaves the rate alone -- the 04:30 credit job saves every vendor nightly
		# and must not move anyone's rate.
		if self.is_new() or self.has_value_changed("vendor_pan") or self.has_value_changed("tds_deduction_percentage"):
			self.tds_deduction_percentage = rate_to_store(self.vendor_pan, self.tds_deduction_percentage)
		self._validate_msme()

	def on_update(self):
		self._attach_msme_file()

	def _validate_msme(self):
		"""MSME ID and certificate: optional, but they come together (owner, 2026-11-19), and the ID
		is a well-formed Udyam number (services/vendor_msme.py). Mirrors the forms' `refineMsmePair`.

		Checked only when either changes, so the nightly job that saves every vendor never trips on it.
		"""
		id_changed = self.is_new() or self.has_value_changed("msme_id")
		if id_changed:
			self.msme_id = normalize_udyam(self.msme_id) or None
			if self.msme_id and not is_valid_udyam(self.msme_id):
				frappe.throw(_("MSME ID must be a Udyam Registration Number, e.g. {0}.").format(UDYAM_EXAMPLE))
		if id_changed or self.has_value_changed("msme_attachment"):
			if self.msme_id and not self.msme_attachment:
				frappe.throw(_("Upload the MSME certificate for this MSME ID."))
			if self.msme_attachment and not self.msme_id:
				frappe.throw(_("Enter the MSME ID from the certificate."))
		# What Document AI read belongs to the certificate: it goes when the certificate goes. The
		# field is Long Text, like the invoices' `autofill_all_entities_json`: an object sent by the
		# form is stored as its JSON text.
		if not self.msme_attachment:
			self.autofill_all_entities_json = None
		elif isinstance(self.autofill_all_entities_json, (dict, list)):
			self.autofill_all_entities_json = json.dumps(self.autofill_all_entities_json, ensure_ascii=False)

	def _attach_msme_file(self):
		"""Attach the MSME certificate's File to this vendor.

		On New Vendor the certificate is uploaded before the vendor exists, so its File is
		unattached and private: only its uploader could open it. Frappe's own
		`attach_files_to_document` does this for `/files/...` URLs only, not the cloud storage
		app's. Only a File the current user uploaded is claimed, never someone else's.
		"""
		if not self.msme_attachment or not self.has_value_changed("msme_attachment"):
			return
		unattached = frappe.db.get_value(
			"File",
			{"file_url": self.msme_attachment, "attached_to_name": ("is", "not set"), "owner": frappe.session.user},
			"name",
		)
		if unattached:
			frappe.db.set_value(
				"File",
				unattached,
				{"attached_to_doctype": self.doctype, "attached_to_name": self.name, "attached_to_field": "msme_attachment"},
				update_modified=False,
			)

	def before_insert(self):
		# if not self.vendor_gst:
		# 	pass
		# else:
		# 	vendor_gsts = frappe.db.get_list("Vendors")
		# 	for vendor_gst in vendor_gsts:
		# 		vendor = frappe.get_doc("Vendors", vendor_gst)
		# 		if self.vendor_gst == vendor.vendor_gst:
		# 			frappe.throw(_("Vendor with this GST already exist."), exc=VendorGSTExistError)
		pass

	def autoname(self):
		vendor_type = self.vendor_type
		
		prefix = f"VEN-{vendor_type}-"
		self.name = f"{prefix}{getseries(prefix, 4)}"
	# def get_project_address(self):
	# 	address = frappe.get_doc("Address", self.vendor_address)
	# 	return {
	# 		"city":address.city,
	# 		"state":address.state
	# 	  }
