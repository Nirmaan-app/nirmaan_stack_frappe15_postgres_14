import { create } from "zustand";

/* ──────────────────────────────────────────────────────
   TYPE DEFINITIONS
   ────────────────────────────────────────────────────── */

export type GstChoice = "pre" | "post" | "";

/**
 * Full upload / parse lifecycle for the wizard upload screen.
 *   idle        - no file dropped yet
 *   uploading   - POST to upload_file in flight
 *   parsing     - job enqueued; waiting for boq:wizard_parse_done socket event
 *   done        - parser succeeded; BOQs row created
 *   error-E     - corrupted workbook (error_code "corrupted")
 *   error-F     - zero sheets (error_code "zero_sheets")
 *   error-internal - unexpected server error
 */
export type UploadStatus =
  | "idle"
  | "uploading"
  | "parsing"
  | "done"
  | "error-E"
  | "error-F"
  | "error-internal";

export interface DroppedFile {
  name: string;
  size: number;
}

export interface PanelValues {
  boqName: string;
  /** V-prefixed display string, e.g. "V1". Empty string pre-parse (blank-until-parsed). */
  version: string;
  /** Empty string pre-parse; "pre" or "post" after fillFromParse. */
  gst: GstChoice;
  notes: string;
}

/**
 * Tracks which required fields the user has explicitly confirmed.
 * Read-only fields (Project, Customer) and optional Notes are excluded per M1.19/M1.32.
 */
export interface ConfirmedFields {
  boqName: boolean;
  version: boolean;
  gst: boolean;
}

interface BoqWizardState {
  selectedProjectId: string;
  droppedFile: DroppedFile | null;
  uploadStatus: UploadStatus;
  /** RQ job id returned synchronously from upload_file. Informational only. */
  jobId: string | null;
  /** BOQs docname set on socket success; drives useFrappeGetDoc for panel fill. */
  boqDocName: string | null;
  panelValues: PanelValues;
  confirmedFields: ConfirmedFields;
}

interface BoqWizardStore extends BoqWizardState {
  setSelectedProject: (id: string) => void;
  setDroppedFile: (file: DroppedFile) => void;
  clearFile: () => void;
  setUploadStatus: (status: UploadStatus) => void;
  setJobId: (id: string | null) => void;
  setBoqDocName: (name: string | null) => void;
  setPanelValue: <K extends keyof PanelValues>(key: K, value: PanelValues[K]) => void;
  confirmField: (field: keyof ConfirmedFields) => void;
  /**
   * Called on socket parse-done success. Merges detected values into panelValues
   * and resets ALL confirmedFields to false so the user sees the unconfirmed
   * (sparkle + opacity) treatment on the real values.
   */
  fillFromParse: (values: Partial<PanelValues>) => void;
  /**
   * Clears the upload/parse lifecycle state and panel values back to defaults
   * WITHOUT clearing selectedProjectId. Used by "Replace file" and "Try again".
   */
  resetUpload: () => void;
  /** Full reset including selectedProjectId. Called on project change. */
  reset: () => void;
}

/* ──────────────────────────────────────────────────────
   DEFAULTS
   ────────────────────────────────────────────────────── */

const DEFAULT_PANEL: PanelValues = {
  boqName: "",
  version: "",
  gst: "",
  notes: "",
};

const DEFAULT_CONFIRMED: ConfirmedFields = {
  boqName: false,
  version: false,
  gst: false,
};

/* ──────────────────────────────────────────────────────
   ZUSTAND STORE  (transient -- no localStorage persistence)
   ────────────────────────────────────────────────────── */

export const useBoqWizardStore = create<BoqWizardStore>()((set) => ({
  selectedProjectId: "",
  droppedFile: null,
  uploadStatus: "idle",
  jobId: null,
  boqDocName: null,
  panelValues: { ...DEFAULT_PANEL },
  confirmedFields: { ...DEFAULT_CONFIRMED },

  setSelectedProject: (id) => set({ selectedProjectId: id }),

  setDroppedFile: (file) => set({ droppedFile: file }),

  clearFile: () => set({ droppedFile: null }),

  setUploadStatus: (status) => set({ uploadStatus: status }),

  setJobId: (id) => set({ jobId: id }),

  setBoqDocName: (name) => set({ boqDocName: name }),

  setPanelValue: (key, value) =>
    set((s) => ({ panelValues: { ...s.panelValues, [key]: value } })),

  confirmField: (field) =>
    set((s) => ({ confirmedFields: { ...s.confirmedFields, [field]: true } })),

  fillFromParse: (values) =>
    set((s) => ({
      panelValues: { ...s.panelValues, ...values },
      confirmedFields: { ...DEFAULT_CONFIRMED },
    })),

  resetUpload: () =>
    set({
      droppedFile: null,
      uploadStatus: "idle",
      jobId: null,
      boqDocName: null,
      panelValues: { ...DEFAULT_PANEL },
      confirmedFields: { ...DEFAULT_CONFIRMED },
    }),

  reset: () =>
    set({
      selectedProjectId: "",
      droppedFile: null,
      uploadStatus: "idle",
      jobId: null,
      boqDocName: null,
      panelValues: { ...DEFAULT_PANEL },
      confirmedFields: { ...DEFAULT_CONFIRMED },
    }),
}));

export default useBoqWizardStore;
