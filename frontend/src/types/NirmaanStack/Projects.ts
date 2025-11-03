interface Category {
	name: string;
	makes: string[]
}

interface CategoryList {
	list: Category[]
}

export interface WorkPackage {
	work_package_name: string
	category_list: CategoryList
}

// Define the interface for a single row in the 'customer_po_details' child table
export interface CustomerPODetail {
		name: string; // Frappe docname of the child record
		idx: number; // Frappe index
		customer_po_number: string;
		customer_po_value_inctax: number;
		customer_po_value_exctax: number;
		customer_po_link: string;
		customer_po_attachment: string; // File URL/Name
		customer_po_payment_terms: string;
}

// Child DocType: Project Work Package Category Make
export interface ProjectWPCategoryMake {
	name: string; // Frappe child row name
	procurement_package: string; // Link to Procurement Packages DocName
	category: string;            // Link to Category DocName
	make?: string | null;          // Link to Makelist DocName (optional)
	// Add other fields from this child doctype if needed by frontend
}

// --- NEW INTERFACE FOR CHILD TABLE ENTRIES ---
export interface ProjectWorkHeaderEntry {
    name: string; // Frappe's default name field for child table rows
    owner?: string;
    project_work_header_name: string; // Link to Work Headers
    enabled: boolean; // Checkbox
}


export interface ProjectGSTNumber {
	location: string;
	gst: string;
}


export interface Projects {
	name: string
	creation: string
	modified: string
	owner: string
	modified_by: string
	docstatus: 0 | 1 | 2
	parent?: string
	parentfield?: string
	parenttype?: string
	idx?: number
	/**	Project Name : Data	*/
	project_name: string
	/**	Customer : Link - Customers	*/
	customer?: string
	/**	Project Type : Link - Project Types	*/
	project_type?: string
	/**	Project Start Date : Date	*/
	project_start_date: string
	/**	Project End Date : Date	*/
	project_end_date: string
	/**	Project Address : Link - Address	*/
	project_address?: string
	/**	Project City : Data	*/
	project_city?: string
	/**	Project State : Data	*/
	project_state?: string
	/**	Project Lead : Data	*/
	project_lead?: string
	/**	Procurement Lead : Data	*/
	procurement_lead?: string
	/**	Design Lead : Data	*/
	design_lead?: string
	/**	Project Manager : Data	*/
	project_manager?: string
	/**	Estimates Executive : Data	*/
	estimates_exec?: string
	/**	Status : Data	*/
	status: string
	/**	Project Work Packages : JSON	*/
	project_work_packages?: {
		work_packages: WorkPackage[]
	}
	/**	Project Scopes : JSON	*/
	project_scopes?: any
	/**	Subdivisions : Data	*/
	subdivisions?: string
	/**	Subdivision List : JSON	*/
	subdivision_list?: any
	/**	Project GST : JSON	*/
	project_gst_number?: {
		list: ProjectGSTNumber[]
	}
	project_value?: string

	project_value_gst?: string

	// NEW Child Table field
	project_wp_category_makes?: ProjectWPCategoryMake[]; // Array of child table rows

	  // --- NEW FIELDS ---
    enable_project_milestone_tracking: boolean;
    project_work_header_entries?: ProjectWorkHeaderEntry[]; // Child table for work headers
		customer_po_details?: CustomerPODetail[]; // Child table for Customer PO Details
}