/** One PO line covered by a Material Test Certificate (child table row). */
export interface MTCItem {
  item_id: string;
  item_name?: string;
  make?: string;
  category?: string;
  procurement_package?: string;
}

/** A Material Test Certificate as returned by `mtc_api.get_mtcs`. */
export interface MaterialTestCertificate {
  name: string;
  procurement_order: string;
  project: string;
  vendor?: string;
  /** Joined from Vendors by the endpoint. */
  vendor_name?: string;
  /** The PO's PR, joined by the endpoint -- builds the PM-side PO link. */
  procurement_request?: string | null;
  /** The certificate file URL. */
  attachment: string;
  /** The date printed on the certificate (YYYY-MM-DD). Required; never in the future. */
  certificate_date?: string | null;
  /** The user who uploaded it. */
  owner: string;
  creation: string;
  items: MTCItem[];
}

/** `mtc_api.get_mtc_projects` -- feeds the MTC list page's project picker. */
export interface MTCProjectsResponse {
  /** True for a Project Manager / Project Lead, who see only assigned projects. */
  scoped: boolean;
  /** False when a scoped user has no project assigned at all. */
  has_projects: boolean;
  projects: { project: string; mtc_count: number }[];
}
