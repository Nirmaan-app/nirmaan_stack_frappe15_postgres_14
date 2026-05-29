import { create } from "zustand";

/* ──────────────────────────────────────────────────────
   TYPE DEFINITIONS
   ────────────────────────────────────────────────────── */

export type GstChoice = "pre" | "post";

/**
 * Expanded in 1b-ii-b once upload/parse lifecycle values are added.
 * Kept as a union type alias so callers can exhaust it with a switch.
 */
export type UploadStatus = "idle";

export interface DroppedFile {
  name: string;
  size: number;
}

export interface PanelValues {
  boqName: string;
  /** V-prefixed display string, e.g. "V1". */
  version: string;
  gst: GstChoice;
  notes: string;
}

/**
 * Tracks which required fields the user has explicitly interacted with.
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
  panelValues: PanelValues;
  confirmedFields: ConfirmedFields;
}

interface BoqWizardStore extends BoqWizardState {
  setSelectedProject: (id: string) => void;
  setDroppedFile: (file: DroppedFile) => void;
  clearFile: () => void;
  setPanelValue: <K extends keyof PanelValues>(key: K, value: PanelValues[K]) => void;
  confirmField: (field: keyof ConfirmedFields) => void;
  reset: () => void;
}

/* ──────────────────────────────────────────────────────
   DEFAULTS
   ────────────────────────────────────────────────────── */

const DEFAULT_PANEL: PanelValues = {
  boqName: "",
  version: "V1",
  gst: "pre",
  notes: "",
};

const DEFAULT_CONFIRMED: ConfirmedFields = {
  boqName: false,
  version: false,
  gst: false,
};

/* ──────────────────────────────────────────────────────
   ZUSTAND STORE  (transient — no localStorage persistence)
   ────────────────────────────────────────────────────── */

export const useBoqWizardStore = create<BoqWizardStore>()((set) => ({
  selectedProjectId: "",
  droppedFile: null,
  uploadStatus: "idle",
  panelValues: { ...DEFAULT_PANEL },
  confirmedFields: { ...DEFAULT_CONFIRMED },

  setSelectedProject: (id) => set({ selectedProjectId: id }),

  setDroppedFile: (file) => set({ droppedFile: file }),

  clearFile: () => set({ droppedFile: null }),

  setPanelValue: (key, value) =>
    set((s) => ({ panelValues: { ...s.panelValues, [key]: value } })),

  confirmField: (field) =>
    set((s) => ({ confirmedFields: { ...s.confirmedFields, [field]: true } })),

  reset: () =>
    set({
      selectedProjectId: "",
      droppedFile: null,
      uploadStatus: "idle",
      panelValues: { ...DEFAULT_PANEL },
      confirmedFields: { ...DEFAULT_CONFIRMED },
    }),
}));

export default useBoqWizardStore;
