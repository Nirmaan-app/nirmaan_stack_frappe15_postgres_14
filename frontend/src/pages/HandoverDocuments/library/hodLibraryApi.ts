// The HOD library, read and written from Packages Settings → Handover Documents.
// One read (`get_hod_library`) feeds the whole screen; writes are ordinary document calls, so the
// doctype permissions and the controllers apply exactly as they do in Desk.

import {
  useFrappeCreateDoc,
  useFrappeDeleteDoc,
  useFrappeGetCall,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";

import { useApiErrorLogger } from "@/utils/sentry/useApiErrorLogger";

import type { HodDocumentMeta } from "../types";

export const HOD_SYSTEM_DOCTYPE = "HOD System";
export const HOD_CONTENT_DOCTYPE = "HOD Library Content";

export const HOD_LIBRARY_METHOD = "nirmaan_stack.api.hod.library.get_hod_library";
export const HOD_LIBRARY_KEY = "hod-library";

/** The three kinds of library text; the API sends the same list. */
export type LibraryDocument =
  | "O&M Manual"
  | "Do's & Don'ts"
  | "Maintenance Checklist";

export interface HodLibraryBlockAdmin {
  name: string;
  hod_system: string;
  document: LibraryDocument;
  sub_system: string | null;
  title: string;
  content: string | null;
  list_1: string | null;
  list_2: string | null;
  display_order: number | null;
  modified: string;
}

export interface HodSystemAdmin {
  name: string;
  system_name: string;
  display_name: string;
  work_package: string;
  is_active: number;
  tools: string | null;
  warranty_equipment: string | null;
  default_disabled_documents: string | null;
  source_keywords: string | null;
  modified: string;
  contents: HodLibraryBlockAdmin[];
  /** How many projects already hand this system over (it cannot be deleted while any does). */
  projects: number;
  /** `default_disabled_documents` as valid document keys, in index order. */
  default_disabled: string[];
}

export interface HodLibraryPayload {
  systems: HodSystemAdmin[];
  documents: HodDocumentMeta[];
  library_documents: LibraryDocument[];
  work_packages: string[];
  can_edit: boolean;
}

export const useHodLibrary = () => {
  const { data, error, isLoading, mutate } = useFrappeGetCall<{
    message: HodLibraryPayload;
  }>(HOD_LIBRARY_METHOD, undefined, HOD_LIBRARY_KEY, {
    revalidateOnFocus: false,
  });
  useApiErrorLogger(error, {
    hook: "useHodLibrary",
    api: "get_hod_library",
    feature: "handover-documents",
  });
  return { library: data?.message, error, isLoading, mutate };
};

export interface HodPreviewRow {
  name?: string;
  project?: string;
  project_name?: string;
}

/** The row the library screen prints to show how a document downloads (empty when no project has it). */
export const useHodPreviewRow = (
  hodSystem: string,
  document: string,
  enabled: boolean,
) => {
  const { data, isLoading } = useFrappeGetCall<{ message: HodPreviewRow }>(
    "nirmaan_stack.api.hod.library.preview_row",
    { hod_system: hodSystem, document },
    enabled ? ["hod-preview-row", hodSystem, document] : null,
    { revalidateOnFocus: false },
  );
  return { preview: data?.message, isLoading };
};

export const useHodLibraryMutations = () => {
  const { createDoc, loading: creating } = useFrappeCreateDoc();
  const { updateDoc, loading: updating } = useFrappeUpdateDoc();
  const { deleteDoc, loading: deleting } = useFrappeDeleteDoc();
  return {
    createDoc,
    updateDoc,
    deleteDoc,
    saving: creating || updating || deleting,
  };
};

/** A Small Text "one entry per line" value as its non-empty lines (services/hod/checklist.parse_lines). */
export const lines = (value: string | null | undefined): string[] =>
  (value ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** What a block holds, for the list: "12 Do's · 9 Don'ts", "11 six-monthly · 8 yearly", "4.2 KB of text". */
export function blockSummary(block: HodLibraryBlockAdmin): string {
  if (block.document === "O&M Manual") {
    const chars = (block.content ?? "").length;
    return chars
      ? `${chars < 1024 ? `${chars} characters` : `${Math.round(chars / 1024)} KB`} of text`
      : "no text yet";
  }
  const [a, b] = [lines(block.list_1).length, lines(block.list_2).length];
  if (block.document === "Do's & Don'ts")
    return `${a} Do's · ${b} Don'ts`;
  return `${a} six-monthly · ${b} yearly checks`;
}

/** What the printed name of a from-app source is, for the row that reads it. */
const SOURCE_LABEL: Record<string, string> = {
  commission: "Commission Report",
  tds: "Material TDS",
  snag: "Snag List",
  design: "Design Tracker",
  mtc: "Material Test Certificates",
};

/** Which editor one of the 16 documents needs at library level. */
export type LibrarySetup = "blocks" | "lines" | "none";

export interface DocumentSetup {
  setup: LibrarySetup;
  /** What the library holds for this document on this system, for the list. */
  holds: string;
  /** For `lines`: the HOD System field it edits. */
  field?: "tools" | "warranty_equipment";
  /** For `lines`: what the textarea is called. */
  label?: string;
}

/** The library side of one document: the three text-block documents, the two line lists, or nothing
 *  (a form filled on the project, or a document read live from another Nirmaan feature). */
export function documentSetup(
  meta: HodDocumentMeta,
  system: HodSystemAdmin,
): DocumentSetup {
  if (meta.library) {
    const n = system.contents.filter((c) => c.document === meta.library).length;
    return {
      setup: "blocks",
      holds: n ? `${n} text block${n === 1 ? "" : "s"}` : "nothing yet",
    };
  }
  if (meta.key === "recommended_tools") {
    const n = lines(system.tools).length;
    return {
      setup: "lines",
      field: "tools",
      label: "Recommended tools (one per line)",
      holds: n ? `${n} tool${n === 1 ? "" : "s"}` : "nothing yet",
    };
  }
  if (meta.key === "equipment_warranty") {
    const n = lines(system.warranty_equipment).length;
    return {
      setup: "lines",
      field: "warranty_equipment",
      label: "Warranty equipment (one per line)",
      holds: n ? `${n} item${n === 1 ? "" : "s"}` : "nothing yet",
    };
  }
  if (meta.source)
    return {
      setup: "none",
      holds: `Read from ${SOURCE_LABEL[meta.source] ?? meta.source}`,
    };
  return { setup: "none", holds: "Filled on the project" };
}
