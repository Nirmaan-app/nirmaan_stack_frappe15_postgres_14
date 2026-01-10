import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/* ─────────────────────────────────────────────────────────────
   TYPE DEFINITIONS
   ───────────────────────────────────────────────────────────── */

/**
 * Form values with dates serialized as ISO strings for localStorage
 */
export interface ProjectDraftFormValues {
  project_name: string;
  customer: string;
  project_type?: string;
  project_value?: string;
  project_value_gst?: string;
  address_line_1: string;
  address_line_2: string;
  project_city: string;
  project_state: string;
  pin: string;
  email?: string;
  phone?: string;
  project_start_date: string | null; // ISO string
  project_end_date: string | null;   // ISO string
  // Deprecated single fields (kept for backward compatibility)
  project_lead?: string;
  project_manager?: string;
  design_lead?: string;
  procurement_lead?: string;
  estimates_exec?: string;
  // New multi-select assignees structure
  assignees?: {
    project_leads?: Array<{ label: string; value: string }>;
    project_managers?: Array<{ label: string; value: string }>;
    procurement_executives?: Array<{ label: string; value: string }>;
  };
  project_work_packages: {
    work_packages: Array<{
      work_package_name: string;
      category_list: {
        list: Array<{
          name: string;
          makes: Array<{ label: string; value: string }>;
        }>;
      };
    }>;
  };
  project_scopes: {
    scopes: Array<{
      scope_of_work_name: string;
      work_package: string;
    }>;
  };
  project_gst_number: {
    list: Array<{ location: string; gst: string }>;
  };
  carpet_area?: number;
}

export interface AreaName {
  name: string;
  status: string;
}

export interface ProjectDraft {
  formValues: Partial<ProjectDraftFormValues>;
  areaNames: AreaName[];
  currentStep: number;
  section: string;
  lastSavedAt: string | null; // ISO timestamp
}

interface ProjectDraftStore {
  // State
  draft: ProjectDraft | null;

  // Actions
  saveDraft: (draft: ProjectDraft) => void;
  updateFormValues: (values: Partial<ProjectDraftFormValues>) => void;
  updateStep: (step: number, section: string) => void;
  updateAreaNames: (areaNames: AreaName[]) => void;
  clearDraft: () => void;

  // Getters
  hasDraft: () => boolean;
  getDraft: () => ProjectDraft | null;
  getLastSavedAt: () => string | null;
}

/* ─────────────────────────────────────────────────────────────
   DRAFT EXPIRATION (30 days)
   ───────────────────────────────────────────────────────────── */

const DRAFT_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const isDraftExpired = (lastSavedAt: string | null): boolean => {
  if (!lastSavedAt) return true;
  const savedTime = new Date(lastSavedAt).getTime();
  const now = Date.now();
  return now - savedTime > DRAFT_EXPIRATION_MS;
};

/* ─────────────────────────────────────────────────────────────
   ZUSTAND STORE
   ───────────────────────────────────────────────────────────── */

export const useProjectDraftStore = create<ProjectDraftStore>()(
  persist(
    (set, get) => ({
      draft: null,

      saveDraft: (draft: ProjectDraft) => {
        set({
          draft: {
            ...draft,
            lastSavedAt: new Date().toISOString(),
          },
        });
      },

      updateFormValues: (values: Partial<ProjectDraftFormValues>) => {
        const currentDraft = get().draft;
        set({
          draft: {
            formValues: {
              ...(currentDraft?.formValues || {}),
              ...values,
            },
            areaNames: currentDraft?.areaNames || [],
            currentStep: currentDraft?.currentStep || 0,
            section: currentDraft?.section || 'projectDetails',
            lastSavedAt: new Date().toISOString(),
          },
        });
      },

      updateStep: (step: number, section: string) => {
        const currentDraft = get().draft;
        if (currentDraft) {
          set({
            draft: {
              ...currentDraft,
              currentStep: step,
              section,
              lastSavedAt: new Date().toISOString(),
            },
          });
        }
      },

      updateAreaNames: (areaNames: AreaName[]) => {
        const currentDraft = get().draft;
        if (currentDraft) {
          set({
            draft: {
              ...currentDraft,
              areaNames,
              lastSavedAt: new Date().toISOString(),
            },
          });
        }
      },

      clearDraft: () => {
        set({ draft: null });
      },

      hasDraft: () => {
        const draft = get().draft;
        if (!draft) return false;
        if (isDraftExpired(draft.lastSavedAt)) {
          // Auto-clear expired drafts
          set({ draft: null });
          return false;
        }
        // Check if draft has meaningful data
        const hasData = !!(
          draft.formValues?.project_name ||
          draft.formValues?.customer ||
          draft.currentStep > 0
        );
        return hasData;
      },

      getDraft: () => {
        const draft = get().draft;
        if (!draft) return null;
        if (isDraftExpired(draft.lastSavedAt)) {
          set({ draft: null });
          return null;
        }
        return draft;
      },

      getLastSavedAt: () => {
        return get().draft?.lastSavedAt || null;
      },
    }),
    {
      name: 'nirmaan-project-draft',
      storage: createJSONStorage(() => localStorage),
    }
  )
);

export default useProjectDraftStore;
