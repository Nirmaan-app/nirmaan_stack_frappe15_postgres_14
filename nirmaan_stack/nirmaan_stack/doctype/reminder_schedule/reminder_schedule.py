# Copyright (c) 2026, Nirmaan and contributors
# For license information, please see license.txt

from frappe.model.document import Document

from nirmaan_stack.services import reminders as reminders_service


class ReminderSchedule(Document):
	def validate(self):
		# End month is derived from the start month for span-based schedules.
		reminders_service.fill_end_months(self.schedule_type, self.due_dates)
		# Freeze the display helpers; the live reminders API recomputes against today.
		self.next_due_date = reminders_service.next_due_date(
			self.schedule_type, self.due_day, self.due_dates
		)
		self.reminds_on = reminders_service.reminds_on(self.next_due_date, self.notify_before_days)
