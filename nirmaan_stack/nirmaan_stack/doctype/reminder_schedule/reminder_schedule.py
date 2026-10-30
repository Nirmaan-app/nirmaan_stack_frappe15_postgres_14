# Copyright (c) 2026, Nirmaan and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

from nirmaan_stack.integrations.controllers.reminder_schedule import done_due_dates
from nirmaan_stack.services import reminders as reminders_service


class ReminderSchedule(Document):
	def validate(self):
		# End month is derived from the start month for span-based schedules.
		reminders_service.fill_end_months(self.schedule_type, self.due_dates)
		# Same rule as refresh_next_due (which keeps these current between saves): the next
		# due date not already Done.
		self.next_due_date = reminders_service.next_open_due_date(
			self.schedule_type, self.due_day, self.due_dates, done_due_dates(self.name)
		)
		self.reminds_on = reminders_service.reminds_on(self.next_due_date, self.notify_before_days)

	def on_update(self):
		from nirmaan_stack.tasks.reminders import send_due_reminders
		frappe.enqueue(send_due_reminders)
		frappe.publish_realtime("reminder_logs_updated", after_commit=True)
