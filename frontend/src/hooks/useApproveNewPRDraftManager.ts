import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from '@/components/ui/use-toast';
import {
  useApproveNewPRDraftStore,
  DraftItem,
  DraftCategory,
  ApproveNewPRDraft,
} from '@/zustand/useApproveNewPRDraftStore';
import { PRItemUIData, PRCategory } from '@/pages/ProcurementRequests/ApproveNewPR/types';

/* ─────────────────────────────────────────────────────────────
   INTERFACE DEFINITIONS
   ───────────────────────────────────────────────────────────── */

export interface UseApproveNewPRDraftManagerParams {
  prId: string;
  projectId: string;
  workPackage: string;
  serverData: {
    orderList: PRItemUIData[];
    categoryList: PRCategory[];
    modifiedAt: string;
  };
  enabled?: boolean;
}

export interface UseApproveNewPRDraftManagerReturn {
  // State
  hasDraft: boolean;
  lastSavedText: string | null;  // e.g., "5 minutes ago"
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  isInitialized: boolean;  // Whether the draft manager has been initialized with data

  // Data (from draft or initial server data)
  orderList: DraftItem[];
  categoryList: DraftCategory[];
  universalComment: string;
  undoStack: DraftItem[];

  // Mutations (local only, auto-saved to localStorage)
  addItem: (item: DraftItem) => void;
  updateItem: (itemName: string, updates: Partial<DraftItem>) => void;
  deleteItem: (itemName: string) => DraftItem | null;  // Returns deleted item for undo
  undoDelete: () => void;
  setUniversalComment: (comment: string) => void;
  updateOrderList: (items: DraftItem[]) => void;  // Bulk update
  updateCategoryList: (categories: DraftCategory[]) => void;

  // Draft lifecycle
  saveDraftNow: () => void;  // Force immediate save
  resumeDraft: () => void;   // Accept draft and use it
  discardDraft: () => void;  // Discard draft and use server data
  clearDraftAfterSubmit: () => void;

  // Dialogs
  showResumeDialog: boolean;
  showCancelDialog: boolean;
  setShowResumeDialog: (show: boolean) => void;
  setShowCancelDialog: (show: boolean) => void;

  // For final submission
  getDataForSubmission: () => { orderList: DraftItem[], categoryList: DraftCategory[] };
}

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
   ───────────────────────────────────────────────────────────── */

const AUTO_SAVE_DELAY_MS = 1500; // 1.5 seconds debounce
const RELATIVE_TIME_UPDATE_MS = 30000; // Update "X minutes ago" every 30 seconds
const SAVING_INDICATOR_DURATION_MS = 600; // How long to show "Saving..." indicator
const FEATURE_FLAG_DISABLED = 'nirmaan-draft-disabled';

/* ─────────────────────────────────────────────────────────────
   HELPER FUNCTIONS
   ───────────────────────────────────────────────────────────── */

/**
 * Check if draft system is disabled via feature flag
 */
const isDraftDisabled = (): boolean => {
  try {
    return localStorage.getItem(FEATURE_FLAG_DISABLED) === 'true';
  } catch {
    return false;
  }
};

/**
 * Convert PRItemUIData to DraftItem format
 */
const toDraftItem = (item: PRItemUIData): DraftItem => ({
  name: item.name || '',
  item_id: item.item_id || '',
  item_name: item.item_name || '',
  unit: item.unit || '',
  quantity: item.quantity || 0,
  category: item.category || '',
  procurement_package: item.procurement_package,
  make: item.make,
  status: item.status || 'Pending',
  tax: item.tax,
  comment: item.comment,
  vendor: item.vendor,
  quote: item.quote,
  _originalQuantity: item.quantity,
  _originalComment: item.comment,
});

/**
 * Convert PRCategory to DraftCategory format
 */
const toDraftCategory = (cat: PRCategory): DraftCategory => ({
  name: cat.name,
  makes: cat.makes,
  status: cat.status,
});

/* ─────────────────────────────────────────────────────────────
   HOOK IMPLEMENTATION
   ───────────────────────────────────────────────────────────── */

export function useApproveNewPRDraftManager({
  prId,
  projectId,
  workPackage,
  serverData,
  enabled = true,
}: UseApproveNewPRDraftManagerParams): UseApproveNewPRDraftManagerReturn {
  // Check if drafts are disabled
  const draftsDisabled = isDraftDisabled() || !enabled;

  // Zustand store
  const {
    getDraft,
    setDraft,
    removeDraft,
    hasDraft: checkHasDraft,
  } = useApproveNewPRDraftStore();

  // Local state - working copies of the data
  const [orderList, setOrderList] = useState<DraftItem[]>([]);
  const [categoryList, setCategoryList] = useState<DraftCategory[]>([]);
  const [universalComment, setUniversalCommentState] = useState<string>('');
  const [undoStack, setUndoStack] = useState<DraftItem[]>([]);

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedText, setLastSavedText] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [isUsingDraft, setIsUsingDraft] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Refs for debouncing and lifecycle management
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingIndicatorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitializedRef = useRef(false);
  const lastSavedAtRef = useRef<string | null>(null);

  // Ref to hold the latest saveToStore function - fixes stale closure in debounced save
  const saveToStoreRef = useRef<() => void>(() => {});

  /* ─────────────────────────────────────────────────────────────
     UPDATE RELATIVE TIME
     ───────────────────────────────────────────────────────────── */

  const updateRelativeTime = useCallback(() => {
    const savedAt = lastSavedAtRef.current;
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
  }, []);

  // Update relative time periodically
  useEffect(() => {
    updateRelativeTime();
    const interval = setInterval(updateRelativeTime, RELATIVE_TIME_UPDATE_MS);
    return () => clearInterval(interval);
  }, [updateRelativeTime]);

  /* ─────────────────────────────────────────────────────────────
     SAVE TO STORE
     ───────────────────────────────────────────────────────────── */

  const saveToStore = useCallback(() => {
    if (draftsDisabled) return;

    const draftData: ApproveNewPRDraft = {
      prId,
      projectId,
      workPackage,
      orderList,
      categoryList,
      universalComment,
      undoStack,
      lastSavedAt: new Date().toISOString(),
      createdAt: getDraft(prId)?.createdAt || new Date().toISOString(),
      serverModifiedAt: serverData.modifiedAt,
    };

    setDraft(prId, draftData);
    lastSavedAtRef.current = draftData.lastSavedAt;
    setHasUnsavedChanges(false);
    updateRelativeTime();
  }, [
    draftsDisabled,
    prId,
    projectId,
    workPackage,
    orderList,
    categoryList,
    universalComment,
    undoStack,
    serverData.modifiedAt,
    getDraft,
    setDraft,
    updateRelativeTime,
  ]);

  // Keep the saveToStore ref updated - this fixes the stale closure bug
  // where the debounced timeout would capture an old version of saveToStore
  useEffect(() => {
    saveToStoreRef.current = saveToStore;
  }, [saveToStore]);

  /* ─────────────────────────────────────────────────────────────
     DEBOUNCED SAVE
     ───────────────────────────────────────────────────────────── */

  const triggerDebouncedSave = useCallback(() => {
    if (draftsDisabled) return;

    setHasUnsavedChanges(true);

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new debounced save - uses ref to always get latest saveToStore
    saveTimeoutRef.current = setTimeout(() => {
      setIsSaving(true);

      // Save to store using ref to get the latest version with current state
      // This prevents stale closure issues where old state would be saved
      saveToStoreRef.current();
      setHasDraft(true);

      // Clear saving indicator after a brief delay
      if (savingIndicatorTimeoutRef.current) {
        clearTimeout(savingIndicatorTimeoutRef.current);
      }
      savingIndicatorTimeoutRef.current = setTimeout(() => {
        setIsSaving(false);
      }, SAVING_INDICATOR_DURATION_MS);
    }, AUTO_SAVE_DELAY_MS);
  }, [draftsDisabled]); // Removed saveToStore from deps - using ref instead

  /* ─────────────────────────────────────────────────────────────
     INITIALIZE FROM SERVER DATA
     ───────────────────────────────────────────────────────────── */

  const initializeFromServerData = useCallback(() => {
    // CRITICAL: Only proceed if server data has actual items
    // This prevents initializing with empty data and marking as "ready"
    if (serverData.orderList.length === 0) {
      return;
    }

    const draftOrderList = serverData.orderList.map(toDraftItem);
    const draftCategoryList = serverData.categoryList.map(toDraftCategory);

    setOrderList(draftOrderList);
    setCategoryList(draftCategoryList);
    setUniversalCommentState('');
    setUndoStack([]);
    setIsUsingDraft(false);
    setIsInitialized(true);
  }, [serverData.orderList, serverData.categoryList]);

  /* ─────────────────────────────────────────────────────────────
     CHECK FOR EXISTING DRAFT ON MOUNT
     ───────────────────────────────────────────────────────────── */

  useEffect(() => {
    // Skip if already processed or disabled
    if (isInitializedRef.current || draftsDisabled) {
      return;
    }

    // Skip if no server data available yet - will be handled by re-init useEffect
    if (serverData.orderList.length === 0) {
      return;
    }

    // Mark as processed to prevent re-running
    isInitializedRef.current = true;

    const existingDraft = getDraft(prId);
    const draftExists = checkHasDraft(prId);

    if (existingDraft && draftExists) {
      // Check if draft is stale (server data is newer)
      if (existingDraft.serverModifiedAt && serverData.modifiedAt) {
        const draftTime = new Date(existingDraft.serverModifiedAt).getTime();
        const serverTime = new Date(serverData.modifiedAt).getTime();

        if (serverTime > draftTime) {
          // Server data is newer - auto-discard draft and notify user
          removeDraft(prId);
          initializeFromServerData();
          toast({ title: 'Draft discarded', description: 'PR was updated on the server' });
          setHasDraft(false);
          return;
        }
      }

      // Draft is valid - show resume dialog
      setHasDraft(true);
      lastSavedAtRef.current = existingDraft.lastSavedAt;
      updateRelativeTime();
      setShowResumeDialog(true);

      // Initialize with server data until user decides
      initializeFromServerData();
    } else {
      // No draft - initialize from server data
      initializeFromServerData();
      setHasDraft(false);
    }
  }, [
    prId,
    draftsDisabled,
    getDraft,
    checkHasDraft,
    removeDraft,
    serverData.modifiedAt,
    serverData.orderList.length, // Added to re-run when data arrives
    initializeFromServerData,
    updateRelativeTime,
  ]);

  // Re-initialize when server data changes (unless using draft or already initialized)
  // This ONLY handles the case where server data arrives late (was empty on first render)
  // CRITICAL: Use ref check to absolutely prevent any re-initialization after first load
  useEffect(() => {
    // MOST IMPORTANT CHECK: Once we've processed initialization, NEVER run again
    // This uses the ref which is more reliable than state for preventing re-runs
    if (isInitializedRef.current) {
      return;
    }

    // Skip if using a draft (user chose to resume their draft)
    if (isUsingDraft) {
      return;
    }

    // Skip if drafts are disabled
    if (draftsDisabled) {
      return;
    }

    // Skip if no server data available yet
    if (serverData.orderList.length === 0) {
      return;
    }

    // Initialize the data
    const draftOrderList = serverData.orderList.map(toDraftItem);
    const draftCategoryList = serverData.categoryList.map(toDraftCategory);

    setOrderList(draftOrderList);
    setCategoryList(draftCategoryList);
    setIsInitialized(true);
  }, [serverData.orderList, serverData.categoryList, isUsingDraft, draftsDisabled]);

  /* ─────────────────────────────────────────────────────────────
     MUTATION FUNCTIONS
     ───────────────────────────────────────────────────────────── */

  const addItem = useCallback((item: DraftItem) => {
    setOrderList((prev) => [...prev, { ...item, _isNew: true }]);
    triggerDebouncedSave();
  }, [triggerDebouncedSave]);

  const updateItem = useCallback((itemName: string, updates: Partial<DraftItem>) => {
    setOrderList((prev) =>
      prev.map((item) => {
        if (item.name === itemName || (item.item_id === itemName && !item.name)) {
          const updatedItem = { ...item, ...updates };

          // Check if quantity or comment changed from original
          const quantityChanged = updatedItem.quantity !== item._originalQuantity;
          const commentChanged = updatedItem.comment !== item._originalComment;

          return {
            ...updatedItem,
            _isModified: quantityChanged || commentChanged || item._isNew,
          };
        }
        return item;
      })
    );
    triggerDebouncedSave();
  }, [triggerDebouncedSave]);

  const deleteItem = useCallback((itemName: string): DraftItem | null => {
    let deletedItem: DraftItem | null = null;

    setOrderList((prev) =>
      prev.map((item) => {
        if (item.name === itemName || (item.item_id === itemName && !item.name)) {
          deletedItem = { ...item };
          return { ...item, _isDeleted: true };
        }
        return item;
      })
    );

    // Only add non-Request items to undo stack
    // Request items are permanently removed when rejected/approved to prevent duplicates
    if (deletedItem !== null && (deletedItem as DraftItem).status !== 'Request') {
      setUndoStack((prev) => [...prev, deletedItem as DraftItem]);
    }

    triggerDebouncedSave();
    return deletedItem;
  }, [triggerDebouncedSave]);

  const undoDelete = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;

      const itemToRestore = prev[prev.length - 1];
      const newStack = prev.slice(0, -1);

      // Restore the item
      setOrderList((orderPrev) =>
        orderPrev.map((item) => {
          if (
            item.name === itemToRestore.name ||
            (item.item_id === itemToRestore.item_id && !item.name)
          ) {
            return { ...item, _isDeleted: false };
          }
          return item;
        })
      );

      return newStack;
    });

    triggerDebouncedSave();
  }, [triggerDebouncedSave]);

  const setUniversalComment = useCallback((comment: string) => {
    setUniversalCommentState(comment);
    triggerDebouncedSave();
  }, [triggerDebouncedSave]);

  const updateOrderList = useCallback((items: DraftItem[]) => {
    setOrderList(items);
    triggerDebouncedSave();
  }, [triggerDebouncedSave]);

  const updateCategoryList = useCallback((categories: DraftCategory[]) => {
    setCategoryList(categories);
    triggerDebouncedSave();
  }, [triggerDebouncedSave]);

  /* ─────────────────────────────────────────────────────────────
     DRAFT LIFECYCLE FUNCTIONS
     ───────────────────────────────────────────────────────────── */

  const saveDraftNow = useCallback(() => {
    if (draftsDisabled) return;

    // Clear any pending debounced save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    setIsSaving(true);
    saveToStore();
    setHasDraft(true);

    // Clear saving indicator after a brief delay
    if (savingIndicatorTimeoutRef.current) {
      clearTimeout(savingIndicatorTimeoutRef.current);
    }
    savingIndicatorTimeoutRef.current = setTimeout(() => {
      setIsSaving(false);
    }, SAVING_INDICATOR_DURATION_MS);
  }, [draftsDisabled, saveToStore]);

  const resumeDraft = useCallback(() => {
    const existingDraft = getDraft(prId);
    if (!existingDraft) {
      setShowResumeDialog(false);
      return;
    }

    // Load draft data into local state
    setOrderList(existingDraft.orderList);
    setCategoryList(existingDraft.categoryList);
    setUniversalCommentState(existingDraft.universalComment);
    setUndoStack(existingDraft.undoStack);
    setIsUsingDraft(true);

    lastSavedAtRef.current = existingDraft.lastSavedAt;
    updateRelativeTime();
    setShowResumeDialog(false);
    setHasDraft(true);

    toast({ title: 'Draft restored', description: 'Your previous changes have been loaded' });
  }, [prId, getDraft, updateRelativeTime]);

  const discardDraft = useCallback(() => {
    // Clear any pending saves
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    if (savingIndicatorTimeoutRef.current) {
      clearTimeout(savingIndicatorTimeoutRef.current);
    }

    removeDraft(prId);
    initializeFromServerData();
    setHasDraft(false);
    setLastSavedText(null);
    lastSavedAtRef.current = null;
    setShowResumeDialog(false);
    setShowCancelDialog(false);
    setIsSaving(false);
    setHasUnsavedChanges(false);

    toast({ title: 'Draft discarded' });
  }, [prId, removeDraft, initializeFromServerData]);

  const clearDraftAfterSubmit = useCallback(() => {
    // Clear any pending saves
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    if (savingIndicatorTimeoutRef.current) {
      clearTimeout(savingIndicatorTimeoutRef.current);
    }

    removeDraft(prId);
    setHasDraft(false);
    setLastSavedText(null);
    lastSavedAtRef.current = null;
    setIsSaving(false);
    setHasUnsavedChanges(false);
    setIsUsingDraft(false);
  }, [prId, removeDraft]);

  /* ─────────────────────────────────────────────────────────────
     GET DATA FOR SUBMISSION
     ───────────────────────────────────────────────────────────── */

  const getDataForSubmission = useCallback(() => {
    return {
      orderList: orderList.filter((item) => !item._isDeleted),
      categoryList,
    };
  }, [orderList, categoryList]);

  /* ─────────────────────────────────────────────────────────────
     CLEANUP ON UNMOUNT
     ───────────────────────────────────────────────────────────── */

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (savingIndicatorTimeoutRef.current) {
        clearTimeout(savingIndicatorTimeoutRef.current);
      }
    };
  }, []);

  /* ─────────────────────────────────────────────────────────────
     MEMOIZED RETURN VALUE
     ───────────────────────────────────────────────────────────── */

  return useMemo(
    () => ({
      // State
      hasDraft,
      lastSavedText,
      isSaving,
      hasUnsavedChanges,
      isInitialized,

      // Data
      orderList,
      categoryList,
      universalComment,
      undoStack,

      // Mutations
      addItem,
      updateItem,
      deleteItem,
      undoDelete,
      setUniversalComment,
      updateOrderList,
      updateCategoryList,

      // Draft lifecycle
      saveDraftNow,
      resumeDraft,
      discardDraft,
      clearDraftAfterSubmit,

      // Dialogs
      showResumeDialog,
      showCancelDialog,
      setShowResumeDialog,
      setShowCancelDialog,

      // Submission
      getDataForSubmission,
    }),
    [
      hasDraft,
      lastSavedText,
      isSaving,
      hasUnsavedChanges,
      isInitialized,
      orderList,
      categoryList,
      universalComment,
      undoStack,
      addItem,
      updateItem,
      deleteItem,
      undoDelete,
      setUniversalComment,
      updateOrderList,
      updateCategoryList,
      saveDraftNow,
      resumeDraft,
      discardDraft,
      clearDraftAfterSubmit,
      showResumeDialog,
      showCancelDialog,
      getDataForSubmission,
    ]
  );
}

export default useApproveNewPRDraftManager;
