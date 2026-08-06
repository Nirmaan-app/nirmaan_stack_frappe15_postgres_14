import { useCallback, useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
    useTdsRequestDraftStore,
    TdsDraftCartItem,
} from "@/zustand/useTdsRequestDraftStore";

/* ─────────────────────────────────────────────────────────────
   Draft manager for the "New Request" TDS cart.

   Mirrors `hooks/useApproveNewPRDraftManager.ts`: all draft behaviour lives in
   the hook so the form stays a form. Same 1.5 s debounce, same resume-dialog
   shape, same clear-after-submit.

   Scope is deliberately narrow — ONLY `cartItems` is persisted. The Work
   Package filter and the pickers above it are transient navigation state; a
   resumed draft restores the staged rows, not where the user happened to be
   browsing.
   ───────────────────────────────────────────────────────────── */

const AUTO_SAVE_DELAY_MS = 1500;
const SAVING_INDICATOR_MS = 600;

interface UseTdsRequestDraftManagerArgs<T extends TdsDraftCartItem> {
    projectId: string;
    cartItems: T[];
    setCartItems: (items: T[]) => void;
    /** Skip everything when the tab is not active / no project yet. */
    enabled?: boolean;
}

export function useTdsRequestDraftManager<T extends TdsDraftCartItem>({
    projectId,
    cartItems,
    setCartItems,
    enabled = true,
}: UseTdsRequestDraftManagerArgs<T>) {
    const { setDraft, getDraft, removeDraft, hasDraft } = useTdsRequestDraftStore();

    const [showResumeDialog, setShowResumeDialog] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

    // Until the resume decision is made, saving MUST NOT run. On mount the cart
    // is empty, so a debounced save would write [] over the stored draft and
    // destroy it before the user is ever offered it.
    const [isInitialized, setIsInitialized] = useState(false);

    // Summary of the STORED draft, for the resume dialog. It cannot be derived
    // from `cartItems` — at the moment the dialog asks, the live cart is still
    // empty and the draft has not been loaded.
    const [pendingSummary, setPendingSummary] = useState({ itemCount: 0, needsReattachCount: 0 });

    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const savingIndicatorRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const initialisedForProject = useRef<string | null>(null);

    /* ── Mount: offer the draft, or start clean ─────────────────────────── */
    useEffect(() => {
        if (!enabled || !projectId) return;
        // Re-run only when the project actually changes.
        if (initialisedForProject.current === projectId) return;
        initialisedForProject.current = projectId;

        setIsInitialized(false);
        setShowResumeDialog(false);

        const draft = getDraft(projectId);
        if (draft && draft.cartItems.length > 0) {
            setLastSavedAt(draft.lastSavedAt);
            setPendingSummary({
                itemCount: draft.cartItems.length,
                needsReattachCount: draft.cartItems.filter(i => i._needsReattach).length,
            });
            setShowResumeDialog(true); // decision pending → still not initialized
        } else {
            setLastSavedAt(null);
            setPendingSummary({ itemCount: 0, needsReattachCount: 0 });
            setIsInitialized(true);
        }
    }, [enabled, projectId, getDraft]);

    /* ── Debounced autosave ─────────────────────────────────────────────── */
    useEffect(() => {
        if (!enabled || !projectId || !isInitialized) return;

        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

        saveTimeoutRef.current = setTimeout(() => {
            if (cartItems.length === 0) {
                // An emptied cart is not a draft — drop it rather than persist [].
                removeDraft(projectId);
                setLastSavedAt(null);
                return;
            }
            setDraft(projectId, { projectId, cartItems });
            setLastSavedAt(new Date().toISOString());

            setIsSaving(true);
            if (savingIndicatorRef.current) clearTimeout(savingIndicatorRef.current);
            savingIndicatorRef.current = setTimeout(() => setIsSaving(false), SAVING_INDICATOR_MS);
        }, AUTO_SAVE_DELAY_MS);

        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        };
    }, [enabled, projectId, isInitialized, cartItems, setDraft, removeDraft]);

    // Clear the indicator timer on unmount.
    useEffect(() => () => {
        if (savingIndicatorRef.current) clearTimeout(savingIndicatorRef.current);
    }, []);

    /* ── Resume-dialog actions ──────────────────────────────────────────── */
    const resumeDraft = useCallback(() => {
        const draft = getDraft(projectId);
        if (draft) setCartItems(draft.cartItems as T[]);
        setShowResumeDialog(false);
        setIsInitialized(true);
    }, [getDraft, projectId, setCartItems]);

    const startFresh = useCallback(() => {
        removeDraft(projectId);
        setCartItems([]);
        setLastSavedAt(null);
        setShowResumeDialog(false);
        setIsInitialized(true);
    }, [removeDraft, projectId, setCartItems]);

    /** Call ONLY after a successful submit — a failed one must keep the draft. */
    const clearDraftAfterSubmit = useCallback(() => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        removeDraft(projectId);
        setLastSavedAt(null);
    }, [removeDraft, projectId]);

    /* ── Derived ────────────────────────────────────────────────────────── */
    // Rows whose datasheet was a File and so could not be persisted. The cart is
    // not editable, so the only remedy is remove-and-re-request; submit stays
    // blocked until none are left.
    const needsReattachCount = cartItems.filter(i => i._needsReattach).length;

    const lastSavedText = lastSavedAt
        ? (() => {
            try {
                return formatDistanceToNow(new Date(lastSavedAt), { addSuffix: true });
            } catch {
                return null;
            }
        })()
        : null;

    return {
        hasDraft: enabled && !!projectId ? hasDraft(projectId) : false,
        lastSavedText,
        isSaving,
        isInitialized,
        showResumeDialog,
        setShowResumeDialog,
        resumeDraft,
        startFresh,
        clearDraftAfterSubmit,
        needsReattachCount,
        draftDate: lastSavedAt,
        // For the resume dialog — describes the STORED draft, not the live cart.
        pendingItemCount: pendingSummary.itemCount,
        pendingNeedsReattachCount: pendingSummary.needsReattachCount,
    };
}

export default useTdsRequestDraftManager;
