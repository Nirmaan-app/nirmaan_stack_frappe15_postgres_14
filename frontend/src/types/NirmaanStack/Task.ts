export interface InvoiceApprovalTask {
  name: string; // Task Doc Name
  creation: string;
  modified: string;
  owner: string;
  task_doctype: "Procurement Orders" | "Service Requests";
  task_docname: string;
  status: "Pending" | "Approved" | "Rejected"; // We filter by this
  reference_field_1?: string;
  reference_value_1?: string;
  reference_field_2?: string;
  reference_value_2?: string; 
  reference_field_3?: string;
  reference_value_3?: string; 
  task_type?: string; 
  assignee?: string;
  assignee_role?: string;
}