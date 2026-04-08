import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/* ─────────────────────────────────────────────────────────────
   TYPE DEFINITIONS
   ───────────────────────────────────────────────────────────── */

/**
 * Flags to track item modifications in the draft
 */
export interface DraftItemFlags {
  _isNew?: boolean;      // Item added by approver
  _isDeleted?: boolean;  // Item marked for deletion
  _isModified?: boolean; // Item quantity/comment modified
}

/**
 * Draft item structure - based on ProcurementRequestItemDetail with draft flags
 */
export interface DraftItem extends DraftItemFlags {
  name: string;          // Row name (docname) - empty string for new items
  item_id: string;       // Item master ID
  item_name: string;     // Display name
  unit: string;
  quantity: number;
  category: string;
  procurement_package?: string;
  make?: string;
  status: string;
  tax?: number;
  comment?: string;
  vendor?: string;
  quote?: number;
  // Original values for comparison (set when item is first loaded)
  _originalQuantity?: number;
  _originalComment?: string;
}

/**
 * Complete draft structure for a single PR approval session
 */
export interface ApproveNewPRDraft {
  // Identifiers
  prId: string;
  projectId: string;
  workPackage: string;

  // Main data
  orderList: DraftItem[];
  universalComment: string;

  // Undo functionality
  undoStack: DraftItem[];

  // Timestamps
  lastSavedAt: string | null;
  createdAt: string;
  serverModifiedAt: string; // To detect if PR changed on server since draft was created

  // Version for migration
  draftVersion: number;
}

/**
 * Store state - drafts keyed by prId
 */
interface DraftsState {
  [prId: string]: ApproveNewPRDraft;
}

interface ApproveNewPRDraftStore {
  // State
  drafts: DraftsState;

  // Actions
  setDraft: (prId: string, draft: Partial<ApproveNewPRDraft> & { prId: string }) => void;
  getDraft: (prId: string) => ApproveNewPRDraft | null;
  removeDraft: (prId: string) => void;
  clearExpiredDrafts: () => void;
  getAllDrafts: () => DraftsState;

  // Utility - check if draft exists and is valid
  hasDraft: (prId: string) => boolean;
}

/* ─────────────────────────────────────────────────────────────
   DRAFT EXPIRATION (30 days)
   ───────────────────────────────────────────────────────────── */

const DRAFT_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const isDraftExpired = (createdAt: string): boolean => {
  const createdTime = new Date(createdAt).getTime();
  const now = Date.now();
  return now - createdTime > DRAFT_EXPIRATION_MS;
};

/* ─────────────────────────────────────────────────────────────
   ZUSTAND STORE
   ───────────────────────────────────────────────────────────── */

export const useApproveNewPRDraftStore = create<ApproveNewPRDraftStore>()(
  persist(
    (set, get) => ({
      drafts: {},

      setDraft: (prId: string, draftData: Partial<ApproveNewPRDraft> & { prId: string }) => {
        const existingDraft = get().drafts[prId];
        const now = new Date().toISOString();

        // Build defaults first
        const defaults: ApproveNewPRDraft = {
          prId,
          projectId: '',
          workPackage: '',
          orderList: [],
          universalComment: '',
          undoStack: [],
          createdAt: now,
          serverModifiedAt: '',
          lastSavedAt: now,
          draftVersion: 2,
        };

        // Merge: defaults <- existing <- new data <- timestamp
        const updatedDraft: ApproveNewPRDraft = {
          ...defaults,
          ...(existingDraft || {}),
          ...draftData,
          lastSavedAt: now,
        };

        set((state) => ({
          drafts: {
            ...state.drafts,
            [prId]: updatedDraft,
          },
        }));
      },

      getDraft: (prId: string) => {
        const draft = get().drafts[prId];
        if (!draft) return null;

        // Auto-clear expired drafts on access
        if (isDraftExpired(draft.createdAt)) {
          set((state) => {
            const newDrafts = { ...state.drafts };
            delete newDrafts[prId];
            return { drafts: newDrafts };
          });
          return null;
        }

        return draft;
      },

      removeDraft: (prId: string) => {
        set((state) => {
          const newDrafts = { ...state.drafts };
          delete newDrafts[prId];
          return { drafts: newDrafts };
        });
      },

      clearExpiredDrafts: () => {
        set((state) => {
          const newDrafts: DraftsState = {};
          for (const [prId, draft] of Object.entries(state.drafts)) {
            if (!isDraftExpired(draft.createdAt)) {
              newDrafts[prId] = draft;
            }
          }
          return { drafts: newDrafts };
        });
      },

      getAllDrafts: () => {
        return get().drafts;
      },

      hasDraft: (prId: string) => {
        const draft = get().getDraft(prId);
        if (!draft) return false;

        // Check if draft has meaningful changes
        const hasModifiedItems = draft.orderList.some(
          (item) => item._isNew || item._isDeleted || item._isModified
        );
        const hasComment = draft.universalComment.trim().length > 0;
        const hasUndoStack = draft.undoStack.length > 0;

        return hasModifiedItems || hasComment || hasUndoStack;
      },
    }),
    {
      name: 'nirmaan-approve-pr-drafts',
      storage: createJSONStorage(() => localStorage),
      // Clean up expired drafts and migrate old versions on rehydration
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.clearExpiredDrafts();
          // Clear drafts with old version (before category_list elimination)
          const drafts = state.getAllDrafts();
          for (const [prId, draft] of Object.entries(drafts)) {
            if (!draft.draftVersion || draft.draftVersion < 2) {
              state.removeDraft(prId);
            }
          }
        }
      },
    }
  )
);

export default useApproveNewPRDraftStore;
