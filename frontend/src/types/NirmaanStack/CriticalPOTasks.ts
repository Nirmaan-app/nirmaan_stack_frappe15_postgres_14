export interface CriticalPOTask {
  name: string;
  project: string;
  critical_po_category: string;
  project_name: string;
  item_name: string;
  sub_category?: string;
  po_release_date: string; // ISO date string
  status: "PR Not Released" | "Not Released" | "Partially Released" | "Released" | "Not Applicable";
  /** How many POs are linked -- stored on the task, recomputed from the PO child table on every link change. */
  linked_po_count?: number;
  /** POs linked to this task through `Critical PO Task Child Table` rows on the PO. Attached client-side by
   *  useProjectPOTaskLinks -- not a DocType field. */
  linked_pos?: string[];
  revised_date?: string;
  remarks?: string;
  creation?: string;
  modified?: string;
}

