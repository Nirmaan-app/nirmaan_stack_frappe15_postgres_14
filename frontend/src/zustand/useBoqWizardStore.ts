import { create } from "zustand";

/* ──────────────────────────────────────────────────────
   TYPE DEFINITIONS
   ────────────────────────────────────────────────────── */

export type GstChoice = "pre" | "post" | "";

/**
 * Upload entry mode (ADR-0014 D1). "new" is a fresh BoQ upload (default, byte-identical
 * to the pre-revision flow); "revise" uploads a revision of an already-committed original
 * in the same project (sourceBoq holds the picked original's docname).
 */
export type RevisionMode = "new" | "revise";

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
  /** Entry mode (ADR-0014 D1). "new" = fresh upload (default); "revise" = revision. */
  revisionMode: RevisionMode;
  /** In revise mode, the picked original's BOQs docname (sent as source_boq); null until picked. */
  sourceBoq: string | null;
  droppedFile: DroppedFile | null;
  panelValues: PanelValues;
  confirmedFields: ConfirmedFields;
}

interface BoqWizardStore extends BoqWizardState {
  setSelectedProject: (id: string) => void;
  /** Switch entry mode. Switching to "new" clears any picked original (D1: New is a plain upload). */
  setRevisionMode: (mode: RevisionMode) => void;
  /** Set the picked original (revise mode). */
  setSourceBoq: (name: string | null) => void;
  setDroppedFile: (file: DroppedFile) => void;
  clearFile: () => void;
  setPanelValue: <K extends keyof PanelValues>(key: K, value: PanelValues[K]) => void;
  confirmField: (field: keyof ConfirmedFields) => void;
  /**
   * Called once the upload's parse is done. Merges detected values into panelValues
   * and resets ALL confirmedFields to false so the user sees the unconfirmed
   * (sparkle + opacity) treatment on the real values.
   */
  fillFromParse: (values: Partial<PanelValues>) => void;
  /**
   * Clears the dropped file and panel values back to defaults WITHOUT clearing
   * selectedProjectId. (The upload's own lifecycle is its background operation, followed by
   * BoqUploadScreen.) Used by "Replace file" and "Try again".
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
  revisionMode: "new",
  sourceBoq: null,
  droppedFile: null,
  panelValues: { ...DEFAULT_PANEL },
  confirmedFields: { ...DEFAULT_CONFIRMED },

  setSelectedProject: (id) => set({ selectedProjectId: id }),

  setRevisionMode: (mode) =>
    set((s) => ({
      revisionMode: mode,
      // Leaving revise mode drops the picked original so a New upload never carries source_boq.
      sourceBoq: mode === "revise" ? s.sourceBoq : null,
    })),

  setSourceBoq: (name) => set({ sourceBoq: name }),

  setDroppedFile: (file) => set({ droppedFile: file }),

  clearFile: () => set({ droppedFile: null }),

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
      panelValues: { ...DEFAULT_PANEL },
      confirmedFields: { ...DEFAULT_CONFIRMED },
    }),

  reset: () =>
    set({
      selectedProjectId: "",
      revisionMode: "new",
      sourceBoq: null,
      droppedFile: null,
      panelValues: { ...DEFAULT_PANEL },
      confirmedFields: { ...DEFAULT_CONFIRMED },
    }),
}));

export default useBoqWizardStore;
