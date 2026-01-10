import { useCallback, useEffect, useRef, useState } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { formatDistanceToNow } from 'date-fns';
import {
  useProjectDraftStore,
  ProjectDraft,
  ProjectDraftFormValues,
  AreaName,
} from '@/zustand/useProjectDraftStore';

/* ─────────────────────────────────────────────────────────────
   TYPE DEFINITIONS
   ───────────────────────────────────────────────────────────── */

/**
 * Form values as they exist in React Hook Form (with Date objects)
 */
interface ProjectFormValues {
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
  project_start_date: Date;
  project_end_date?: Date;
  project_lead?: string;
  project_manager?: string;
  design_lead?: string;
  procurement_lead?: string;
  estimates_exec?: string;
  accountant?: string;
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

interface UseProjectDraftManagerOptions {
  form: UseFormReturn<ProjectFormValues>;
  areaNames: AreaName[];
  setAreaNames: (names: AreaName[]) => void;
  currentStep: number;
  section: string;
  setCurrentStep: (step: number) => void;
  setSection: (section: string) => void;
}

interface UseProjectDraftManagerReturn {
  // State
  hasDraft: boolean;
  lastSavedText: string | null;
  isSaving: boolean;
  draftProjectName: string | null;
  draftLastSavedAt: string | null;

  // Dialog controls
  showResumeDialog: boolean;
  setShowResumeDialog: (show: boolean) => void;
  showCancelDialog: boolean;
  setShowCancelDialog: (show: boolean) => void;

  // Actions
  saveDraftNow: () => void;
  resumeDraft: () => void;
  discardDraft: () => void;
  clearDraftAfterSubmit: () => void;
}

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
   ───────────────────────────────────────────────────────────── */

const AUTO_SAVE_DELAY_MS = 1500; // 1.5 seconds debounce
const RELATIVE_TIME_UPDATE_MS = 30000; // Update "X minutes ago" every 30 seconds

/* ─────────────────────────────────────────────────────────────
   CONVERSION UTILITIES
   ───────────────────────────────────────────────────────────── */

/**
 * Convert form values (with Date objects) to draft format (with ISO strings)
 */
const formToDraft = (
  values: Partial<ProjectFormValues>
): Partial<ProjectDraftFormValues> => {
  const { project_start_date, project_end_date, ...rest } = values;
  return {
    ...rest,
    project_start_date: project_start_date?.toISOString() || null,
    project_end_date: project_end_date?.toISOString() || null,
  } as Partial<ProjectDraftFormValues>;
};

/**
 * Convert draft format (with ISO strings) to form values (with Date objects)
 */
const draftToForm = (
  draft: Partial<ProjectDraftFormValues>
): Partial<ProjectFormValues> => {
  const { project_start_date, project_end_date, ...rest } = draft;
  return {
    ...rest,
    project_start_date: project_start_date
      ? new Date(project_start_date)
      : new Date(),
    project_end_date: project_end_date
      ? new Date(project_end_date)
      : undefined,
  } as Partial<ProjectFormValues>;
};

/* ─────────────────────────────────────────────────────────────
   HOOK IMPLEMENTATION
   ───────────────────────────────────────────────────────────── */

export function useProjectDraftManager({
  form,
  areaNames,
  setAreaNames,
  currentStep,
  section,
  setCurrentStep,
  setSection,
}: UseProjectDraftManagerOptions): UseProjectDraftManagerReturn {
  // Zustand store
  const {
    saveDraft,
    clearDraft,
    hasDraft: checkHasDraft,
    getDraft,
    getLastSavedAt,
  } = useProjectDraftStore();

  // Local state
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedText, setLastSavedText] = useState<string | null>(null);
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);

  // Refs for debouncing
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitializedRef = useRef(false);

  // Get draft metadata for dialogs
  const draft = getDraft();
  const draftProjectName = draft?.formValues?.project_name || null;
  const draftLastSavedAt = getLastSavedAt();

  /* ─────────────────────────────────────────────────────────────
     UPDATE RELATIVE TIME
     ───────────────────────────────────────────────────────────── */

  const updateRelativeTime = useCallback(() => {
    const savedAt = getLastSavedAt();
    if (savedAt) {
      try {
        const relativeTime = formatDistanceToNow(new Date(savedAt), {
          addSuffix: true,
        });
        setLastSavedText(relativeTime);
      } catch {
        setLastSavedText(null);
      }
    } else {
      setLastSavedText(null);
    }
  }, [getLastSavedAt]);

  // Update relative time periodically
  useEffect(() => {
    updateRelativeTime();
    const interval = setInterval(updateRelativeTime, RELATIVE_TIME_UPDATE_MS);
    return () => clearInterval(interval);
  }, [updateRelativeTime]);

  /* ─────────────────────────────────────────────────────────────
     CHECK FOR EXISTING DRAFT ON MOUNT
     ───────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    const existingDraft = checkHasDraft();
    setHasDraft(existingDraft);

    if (existingDraft) {
      // Show resume dialog on mount if draft exists
      setShowResumeDialog(true);
    }
  }, [checkHasDraft]);

  /* ─────────────────────────────────────────────────────────────
     AUTO-SAVE WITH DEBOUNCE
     ───────────────────────────────────────────────────────────── */

  useEffect(() => {
    // Don't auto-save if resume dialog is open (user hasn't decided yet)
    if (showResumeDialog) return;

    const subscription = form.watch((values) => {
      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Set new debounced save
      saveTimeoutRef.current = setTimeout(() => {
        setIsSaving(true);

        const draftData: ProjectDraft = {
          formValues: formToDraft(values as ProjectFormValues),
          areaNames,
          currentStep,
          section,
          lastSavedAt: new Date().toISOString(),
        };

        saveDraft(draftData);
        setHasDraft(true);
        setIsSaving(false);
        updateRelativeTime();
      }, AUTO_SAVE_DELAY_MS);
    });

    return () => {
      subscription.unsubscribe();
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    form,
    areaNames,
    currentStep,
    section,
    saveDraft,
    showResumeDialog,
    updateRelativeTime,
  ]);

  /* ─────────────────────────────────────────────────────────────
     ACTIONS
     ───────────────────────────────────────────────────────────── */

  /**
   * Save draft immediately (bypasses debounce)
   */
  const saveDraftNow = useCallback(() => {
    // Clear any pending debounced save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    setIsSaving(true);

    const values = form.getValues();
    const draftData: ProjectDraft = {
      formValues: formToDraft(values),
      areaNames,
      currentStep,
      section,
      lastSavedAt: new Date().toISOString(),
    };

    saveDraft(draftData);
    setHasDraft(true);
    setIsSaving(false);
    updateRelativeTime();
  }, [form, areaNames, currentStep, section, saveDraft, updateRelativeTime]);

  /**
   * Resume from saved draft
   */
  const resumeDraft = useCallback(() => {
    const draft = getDraft();
    if (!draft) {
      setShowResumeDialog(false);
      return;
    }

    // Restore form values
    if (draft.formValues) {
      const formValues = draftToForm(draft.formValues);
      form.reset(formValues as ProjectFormValues);
    }

    // Restore area names
    if (draft.areaNames?.length) {
      setAreaNames(draft.areaNames);
    }

    // Restore step/section
    if (draft.currentStep !== undefined) {
      setCurrentStep(draft.currentStep);
    }
    if (draft.section) {
      setSection(draft.section);
    }

    setShowResumeDialog(false);
    updateRelativeTime();
  }, [
    getDraft,
    form,
    setAreaNames,
    setCurrentStep,
    setSection,
    updateRelativeTime,
  ]);

  /**
   * Discard draft and start fresh
   */
  const discardDraft = useCallback(() => {
    clearDraft();
    setHasDraft(false);
    setLastSavedText(null);
    setShowResumeDialog(false);
    setShowCancelDialog(false);
  }, [clearDraft]);

  /**
   * Clear draft after successful form submission
   */
  const clearDraftAfterSubmit = useCallback(() => {
    // Clear any pending saves
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    clearDraft();
    setHasDraft(false);
    setLastSavedText(null);
  }, [clearDraft]);

  return {
    // State
    hasDraft,
    lastSavedText,
    isSaving,
    draftProjectName,
    draftLastSavedAt,

    // Dialog controls
    showResumeDialog,
    setShowResumeDialog,
    showCancelDialog,
    setShowCancelDialog,

    // Actions
    saveDraftNow,
    resumeDraft,
    discardDraft,
    clearDraftAfterSubmit,
  };
}

export default useProjectDraftManager;
