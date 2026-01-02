export interface CriticalPOTask {
  name: string;
  project: string;
  critical_po_category: string;
  project_name: string;
  item_name: string;
  sub_category?: string;
  po_release_date: string; // ISO date string
  status: "Not Released" | "Partially Released" | "Released" | "Not Applicable";
  associated_pos?: {
    pos: string[];
  };
  revised_date?: string;
  remarks?: string;
  creation?: string;
  modified?: string;
}

export interface AssociatedPOs {
  pos: string[];
}
