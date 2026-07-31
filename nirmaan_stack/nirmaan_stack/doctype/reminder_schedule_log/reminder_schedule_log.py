# Copyright (c) 2026, Nirmaan and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class ReminderScheduleLog(Document):
	def validate(self):
		# Rows are born Pending (created when the reminder is raised). When flipped
		# to Done, stamp who/when if the caller didn't set them explicitly.
		if self.status == "Done":
			if not self.completed_by:
				self.completed_by = frappe.session.user
			if not self.completed_at:
				self.completed_at = frappe.utils.now()
		else:
			# Pending rows carry no completion stamp.
			self.completed_by = None
			self.completed_at = None

	def on_update(self):
		frappe.publish_realtime("reminder_logs_updated")
