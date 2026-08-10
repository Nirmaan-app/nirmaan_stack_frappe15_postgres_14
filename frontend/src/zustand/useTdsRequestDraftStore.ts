import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/* ─────────────────────────────────────────────────────────────
   WHY THIS EXISTS

   The "New Request" tab stages TDS items in a local cart before
   `Send For Approval` writes them. Navigating away lost the whole cart —
   ten picked items gone with no warning.

   Modelled on `useApproveNewPRDraftStore`: MANY drafts keyed by id, a
   30-day TTL, auto-clear on read. Keying matters — the cart is scoped to a
   PROJECT, so a single global draft (the `useProjectDraftStore` shape)
   would let a second project clobber the first.
   ───────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────
   TYPE DEFINITIONS
   ───────────────────────────────────────────────────────────── */

/**
 * One staged cart row. Mirrors `CartItem` in `TdsCreateForm.tsx` MINUS
 * `attachmentFile`.
 *
 * ⚠️ `attachmentFile` is a `File`, and `persist` serialises through
 * `JSON.stringify` — a File becomes `{}`. That empty object is TRUTHY, so the
 * submit path (`if (item.attachmentFile) uploadFile(...)`) would attempt an
 * upload, throw, get swallowed by its catch, and produce a submittal whose
 * datasheet is silently missing.
 *
 * So the File is NEVER persisted (see `partialize`). A row that had one is
 * restored with `_needsReattach: true`, which the form surfaces and blocks
 * submission on until the user re-attaches. Nothing is dropped and nothing is
 * half-saved.
 */
export interface TdsDraftCartItem {
  tds_item_id: string;
  tds_item_name: string;
  make: string;
  work_package: string;
  category?: string;
  description?: string;
  /** Datasheet URL of an existing repository entry — a string, persists fine. */
  tds_attachment?: string;
  tds_boq_line_item?: string;
  /** true ⇒ status "New"; the row carried a File that could not be persisted. */
  is_new_request?: boolean;
  /** A Rejected row this entry replaces on submit. */
  previousDocName?: string;
  /** Set on restore when the row's uploaded datasheet did not survive. */
  _needsReattach?: boolean;
}

/**
 * One project's staged cart.
 */
export interface TdsRequestDraft {
  projectId: string;
  cartItems: TdsDraftCartItem[];

  lastSavedAt: string | null;
  createdAt: string;

  /** Bump to invalidate drafts whose shape this code can no longer read. */
  draftVersion: number;
}

type DraftsState = Record<string, TdsRequestDraft>;

interface TdsRequestDraftStore {
  drafts: DraftsState;

  setDraft: (projectId: string, draft: Partial<TdsRequestDraft> & { projectId: string }) => void;
  getDraft: (projectId: string) => TdsRequestDraft | null;
  removeDraft: (projectId: string) => void;
  clearExpiredDrafts: () => void;
  getAllDrafts: () => DraftsState;
  hasDraft: (projectId: string) => boolean;
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

const DRAFT_VERSION = 1;

/**
 * Make a cart safe to persist. THE serialisation rule, extracted so it is
 * unit-testable without React (ADR-0010 F4) — `partialize` below is its only
 * production caller.
 *
 * Two jobs:
 *   1. DROP `attachmentFile`. It is a `File`, and `JSON.stringify(File)` yields
 *      `{}` — which is TRUTHY, so the submit path's `if (item.attachmentFile)`
 *      would fire, `uploadFile({})` would throw, its catch would swallow it, and
 *      the user would get a submittal with a silently missing datasheet.
 *   2. MARK the rows that just lost their only copy of the datasheet, so the
 *      form can flag them and block submit.
 *
 * A row picked from the repository carries `tds_attachment` (a URL string), so
 * it survives whole and is never flagged.
 */
export function sanitizeCartItemsForStorage(
    items: TdsDraftCartItem[]
): TdsDraftCartItem[] {
    return (items || []).map((item) => {
        const rest = { ...item } as TdsDraftCartItem & { attachmentFile?: unknown };
        delete rest.attachmentFile;
        return {
            ...rest,
            // A "New" request row's datasheet lived only in the File.
            _needsReattach: !!item.is_new_request && !item.tds_attachment,
        };
    });
}

/* ─────────────────────────────────────────────────────────────
   ZUSTAND STORE
   ───────────────────────────────────────────────────────────── */

export const useTdsRequestDraftStore = create<TdsRequestDraftStore>()(
  persist(
    (set, get) => ({
      drafts: {},

      setDraft: (projectId: string, draftData: Partial<TdsRequestDraft> & { projectId: string }) => {
        const existingDraft = get().drafts[projectId];
        const now = new Date().toISOString();

        const defaults: TdsRequestDraft = {
          projectId,
          cartItems: [],
          createdAt: now,
          lastSavedAt: now,
          draftVersion: DRAFT_VERSION,
        };

        const updatedDraft: TdsRequestDraft = {
          ...defaults,
          ...(existingDraft || {}),
          ...draftData,
          lastSavedAt: now,
        };

        set((state) => ({
          drafts: {
            ...state.drafts,
            [projectId]: updatedDraft,
          },
        }));
      },

      getDraft: (projectId: string) => {
        const draft = get().drafts[projectId];
        if (!draft) return null;

        // Auto-clear expired drafts on access
        if (isDraftExpired(draft.createdAt)) {
          set((state) => {
            const newDrafts = { ...state.drafts };
            delete newDrafts[projectId];
            return { drafts: newDrafts };
          });
          return null;
        }

        return draft;
      },

      removeDraft: (projectId: string) => {
        set((state) => {
          const newDrafts = { ...state.drafts };
          delete newDrafts[projectId];
          return { drafts: newDrafts };
        });
      },

      clearExpiredDrafts: () => {
        set((state) => {
          const newDrafts: DraftsState = {};
          for (const [projectId, draft] of Object.entries(state.drafts)) {
            if (!isDraftExpired(draft.createdAt)) {
              newDrafts[projectId] = draft;
            }
          }
          return { drafts: newDrafts };
        });
      },

      getAllDrafts: () => {
        return get().drafts;
      },

      // "Worth offering to resume" — an empty cart is not a draft.
      hasDraft: (projectId: string) => {
        const draft = get().getDraft(projectId);
        return !!draft && draft.cartItems.length > 0;
      },
    }),
    {
      name: 'nirmaan-tds-request-drafts',
      storage: createJSONStorage(() => localStorage),

      // The File strip happens HERE, at the serialisation boundary, so no code
      // path can put one into storage. See `sanitizeCartItemsForStorage`.
      partialize: (state) => ({
        drafts: Object.fromEntries(
          Object.entries(state.drafts).map(([projectId, draft]) => [
            projectId,
            { ...draft, cartItems: sanitizeCartItemsForStorage(draft.cartItems) },
          ])
        ),
      }) as unknown as TdsRequestDraftStore,

      onRehydrateStorage: () => (state) => {
        if (state) {
          state.clearExpiredDrafts();
          // Drop drafts written by an older, unreadable shape.
          const drafts = state.getAllDrafts();
          for (const [projectId, draft] of Object.entries(drafts)) {
            if (!draft.draftVersion || draft.draftVersion < DRAFT_VERSION) {
              state.removeDraft(projectId);
            }
          }
        }
      },
    }
  )
);

export default useTdsRequestDraftStore;
