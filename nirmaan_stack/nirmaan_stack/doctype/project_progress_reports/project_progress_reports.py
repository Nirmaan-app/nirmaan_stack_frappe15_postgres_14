# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class ProjectProgressReports(Document):
    # pass
    import frappe
from frappe.model.document import Document

class ProjectProgressReports(Document):
    # pass
    def on_update(self):
        try:
            print(f"bfuwbje: on_update called for {self.name}")
            print(f"bfuwbje: Current status: {self}")
            print(f"bfuwbje: Current report_date: {self.report_date}")
            print(f"bfuwbje: Current project: {self.milestones}")
            print(f"bfuwbje: Current project: {self.report_status}")

            # --- Iterate through milestones child table ---
            if self.milestones: # Check if the child table has any entries
                print(f"bfuwbje: Processing {len(self.milestones)} milestones:")
                for i, milestone_doc in enumerate(self.milestones):
                    print(f"bfuwbje:   Milestone {i+1} (Name: {milestone_doc.name}):")
                    print(f"bfuwbje:     Work Milestone Name: {milestone_doc.work_milestone_name}")
                    print(f"bfuwbje:     Work Header: {milestone_doc.work_header}")
                    print(f"bfuwbje:     Status: {milestone_doc.status}")
                    print(f"bfuwbje:     Progress: {milestone_doc.progress}")
                    print(f"bfuwbje:     Expected Start Date: {milestone_doc.expected_starting_date}")
                    print(f"bfuwbje:     Expected Completion Date: {milestone_doc.expected_completion_date}")
                    print(f"bfuwbje:     Remarks: {milestone_doc.remarks}")
                    # If you stored history_json in Frappe, you could parse it here:
                    # if milestone_doc.history_json:
                    #     import json
                    #     history = json.loads(milestone_doc.history_json)
                    #     print(f"bfuwbje:     History Entries: {len(history)}")
            else:
                print(f"bfuwbje: No milestones found for {self.name}")
            

            if self.manpower: # Check if the child table has any entries
                print(f"bfuwbje: Processing {len(self.manpower)} manpower details:")
                for i, manpower_doc in enumerate(self.manpower):
                    print(f"bfuwbje:   Manpower Detail {i+1} (Name: {manpower_doc.name}):")
                    print(f"bfuwbje:     Label: {manpower_doc.label}")
                    print(f"bfuwbje:     Count: {manpower_doc.count}")
            else:
                print(f"bfuwbje: No manpower details found for {self.name}")
            # Add any additional logic here that might potentially fail.
            # For example:
            # if self.status == 'Completed':
            #     # This could fail if there's a problem with `another_doctype`
            #     frappe.get_doc("Another Doctype", "Some Name").set_status("Done").save()

        except Exception as e:
            # Log the exception using Frappe's logging system
            # This is crucial for debugging issues on the server side
            print(f"bfuwbje: Current project error: {e}")
            frappe.log_error(
                message=f"Error in ProjectProgressReports on_update for {self.name}: {e}",
                title="Project Progress Reports Update Error"
            )
            # You might also want to show a message to the user,
            # but generally, on_update errors are handled silently on the backend
            # or lead to a generic server error message.
            # frappe.throw(f"Failed to update Project Progress Report due to an internal error: {e}")

        # finally:
        #     # This block will always execute, whether an exception occurred or not.
        #     # Useful for cleanup operations, like closing files or connections.
        #     print(f"bfuwbje: on_update finished for {self.name}") 





    # def validate(self):
    #     # 1. Find the most recent Project Progress Report for the same project with an earlier report_date.
    #     print(f"bfuwbje:fetching previous report doc '{self.project}' in before_insert for")
    #     previous_report_name_list = frappe.db.get_list(
    #         "Project Progress Reports",
    #         filters={
    #             "project": self.project,
    #             "report_date": ("<", self.report_date) # Strictly older than the current report_date
    #         },
    #         order_by="report_date desc, creation desc",
    #         limit=1,
    #         pluck="name"
    #     )

    #     previous_report_doc = None
    #     if previous_report_name_list:
    #         # If a previous report exists, fetch its full document to get child table data
    #         try:
    #             previous_report_doc = frappe.get_doc("Project Progress Reports", previous_report_name_list[0])
    #         except Exception as e:
    #             # Replace frappe.log_error with print()
    #             print(f"bfuwbje: Error fetching previous report doc '{previous_report_name_list[0]}' in before_insert for {self.name}: {e}")
    #             previous_report_doc = None # Ensure it's None if fetch failed

    #     # 2. If no suitable previous report is found, or if found but has no milestones,
    #     # set all 'previous_' values to empty (None). Otherwise, match and set.

    #     # Prepare a map for quick lookup of previous milestones if a previous report was successfully found
    #     previous_milestones_map = {}
    #     if previous_report_doc and previous_report_doc.milestones:
    #         for prev_milestone in previous_report_doc.milestones:
    #             # Ensure key fields exist for robust mapping
    #             if hasattr(prev_milestone, 'work_milestone_name') and hasattr(prev_milestone, 'work_header'):
    #                 key = f"{prev_milestone.work_milestone_name}::{prev_milestone.work_header}"
    #                 previous_milestones_map[key] = prev_milestone
    #             # else: a print statement could be here for malformed previous milestones if desired
    #             # print(f"bfuwbje: WARNING: Previous milestone from doc '{getattr(previous_report_doc, 'name', 'N/A')}' missing 'work_milestone_name' or 'work_header': {prev_milestone}")

    #     # Iterate through the milestones of the *current* new report being inserted
    #     if self.milestones: # Only iterate if there are milestones in the current report
    #         for current_milestone in self.milestones:
    #             # Ensure key fields exist in the current milestone for robust mapping
    #             if not (hasattr(current_milestone, 'work_milestone_name') and hasattr(current_milestone, 'work_header')):
    #                 # If current milestone is malformed, set its previous fields to None and skip
    #                 print(f"bfuwbje: Current milestone missing key attributes in before_insert for {self.name}. Skipping.")
    #                 current_milestone.previous_status = None
    #                 current_milestone.previous_starting_date = None
    #                 current_milestone.previous_completion_date = None
    #                 current_milestone.previous_progress = None
    #                 current_milestone.previous_remarks = None
    #                 continue # Move to the next milestone

    #             key = f"{current_milestone.work_milestone_name}::{current_milestone.work_header}"
                
    #             if key in previous_milestones_map:
    #                 # If a matching milestone was found in the previous report
    #                 prev_data = previous_milestones_map[key]
                    
    #                 # Set current milestone's 'previous_' fields from the matched 'prev_data'
    #                 current_milestone.previous_status = getattr(prev_data, 'status', None)
    #                 current_milestone.previous_starting_date = getattr(prev_data, 'expected_starting_date', None)
    #                 current_milestone.previous_completion_date = getattr(prev_data, 'expected_completion_date', None)
    #                 current_milestone.previous_progress = getattr(prev_data, 'progress', None)
    #                 current_milestone.previous_remarks = getattr(prev_data, 'remarks', None)
    #             else:
    #                 # If no matching previous milestone was found, set history fields to None
    #                 current_milestone.previous_status = None
    #                 current_milestone.previous_starting_date = None
    #                 current_milestone.previous_completion_date = None
    #                 current_milestone.previous_progress = None
    #                 current_milestone.previous_remarks = None