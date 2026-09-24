// Shapes of the Handover Documents (HOD) API — `nirmaan_stack/api/hod/project_hod.py`.
// The 16-document index itself comes from the server (`documents`); nothing here repeats it.

export type HodDocumentKind = "form" | "template" | "app";
/** Derived by the server from what was done on the row (never picked by hand). */
export type HodStatus = "Pending" | "Form Filled" | "Completed";

export interface HodDocumentMeta {
  key: string;
  no: number;
  title: string;
  kind: HodDocumentKind;
  landscape: boolean;
  /** The document gives users something to fill in (so it passes through "Form Filled"). */
  fill: boolean;
  library: string | null;
  source: "commission" | "tds" | "snag" | "design" | null;
}

/** One `Project HOD Document` row as the API returns it (form_data already parsed). */
export interface HodRow {
  name: string;
  hod_system: string;
  document: string;
  status: HodStatus;
  disabled: 0 | 1;
  remarks: string | null;
  form_data: Record<string, unknown>;
  modified: string;
  creation: string;
}

export interface HodSystemOption {
  name: string;
  display_name: string;
  work_package: string;
  is_active: 0 | 1;
  /** The system's Work Package is one of the project's packages. */
  suggested: boolean;
  added: boolean;
}

export interface HodCounts {
  completed: number;
  filled: number;
  pending: number;
  off: number;
  needed: number;
  /** Rows holding entries (removing the system deletes them). */
  touched: number;
}

export interface HodProjectInfo {
  name: string;
  project_name: string;
  location: string;
  customer: string | null;
  customer_name: string;
}

export interface HodPayload {
  project: HodProjectInfo;
  documents: HodDocumentMeta[];
  packages: string[];
  systems: HodSystemOption[];
  /** Systems with rows, in the order they were added — these are the tabs. */
  added: string[];
  rows: Record<string, HodRow[]>;
  counts: Record<string, HodCounts>;
  can_edit: boolean;
  /** No HOD System exists yet — the library has not been loaded on this site. */
  library_empty: boolean;
  /** May create HOD Systems / library content (the "Edit library" screens). */
  can_edit_library: boolean;
}

export interface HodLibraryBlock {
  name: string;
  sub_system: string;
  title: string;
  content: string;
  list_1: string[];
  list_2: string[];
  blanks: string[];
}

export interface HodSystemLibrary {
  system: {
    name: string;
    display_name: string;
    work_package: string;
    tools: string[];
    warranty_equipment: string[];
  };
  /** Keyed by library document: "O&M Manual" | "Do's & Don'ts" | "Maintenance Checklist". */
  contents: Record<string, HodLibraryBlock[]>;
  default_included: Record<string, string[]>;
  commission_categories: string[];
}

export interface HodCommissionTask {
  name: string;
  parent: string;
  task_name: string;
  commission_category: string;
  task_status: string | null;
  report_type: string | null;
  approval_proof: string | null;
  file_link: string | null;
  has_report: boolean;
  /** The Commission print format (portrait / landscape) that renders the filled report. */
  print_format: string;
}

export interface HodTdsItem {
  name: string;
  tds_item_name: string;
  tds_make: string | null;
  tds_category: string | null;
  tds_status: string | null;
  tds_attachment: string | null;
}

export interface HodDesignTask {
  name: string;
  parent: string;
  design_category: string;
  task_name: string;
  task_status: string | null;
  file_link: string | null;
  task_zone: string | null;
  /** Where the drawing downloads from (Drive's direct link / the stored file); null = link only. */
  download_url: string | null;
}

/** One uploaded snag list of the project (a Project Snag Batch). Only COMPLETED snags are handed over,
 *  so `count` counts those and `total` is what the list holds in all. */
export interface HodSnagBatch {
  name: string;
  batch_name: string;
  uploaded_on: string | null;
  count: number;
  total: number;
  by_status: Record<string, number>;
}

export interface HodSources {
  source: string;
  items?: Array<HodCommissionTask | HodTdsItem | HodDesignTask | HodSnagBatch>;
  summary?: { total: number; by_status: Record<string, number> };
}

// ------------------------------------------------------------------ form_data shapes
// Mirrors what `api/hod/print_context.py` reads. Every field is optional: a blank form prints
// empty cells.

export interface EscalationLevel {
  name?: string;
  designation?: string;
  phone?: string;
  email?: string;
}

export interface AtticRow {
  material?: string;
  make?: string;
  qty?: string;
  remarks?: string;
}

export interface KeyRow {
  description?: string;
  key_no?: string;
  qty?: string;
  remarks?: string;
}

export interface KeyReceiver {
  name?: string;
  designation?: string;
  phone?: string;
  date?: string;
}

export interface InventoryLocation {
  name?: string;
  qty?: Array<number | string | null>;
}

