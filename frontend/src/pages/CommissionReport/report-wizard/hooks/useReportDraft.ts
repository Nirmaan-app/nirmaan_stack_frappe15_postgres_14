// Lightweight localStorage draft for the wizard. Mirrors useProjectDraftManager
// but stripped down — we don't have the cross-doc draft semantics (we always
// know which child row we're filling, so the draft key is simple).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';

const KEY_PREFIX = 'commission-wizard-draft';
const AUTO_SAVE_DELAY_MS = 1500;
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface DraftPayload<T> {
    values: T;
    currentStep: number;
    savedAt: number;
}

interface UseReportDraftParams<T extends Record<string, unknown>> {
    parent: string;
    childRowName: string;
    form: UseFormReturn<T>;
    currentStep: number;
    setCurrentStep: (n: number) => void;
    /** When true (after Submit), discard draft + stop autosaving. */
    isCommitted: boolean;
    /** When false, do nothing (e.g. mode=view). */
    enabled: boolean;
}

export interface UseReportDraftResult {
    lastSavedText: string;
    isSaving: boolean;
    hasDraft: boolean;
    showResumeDialog: boolean;
    setShowResumeDialog: (b: boolean) => void;
    resumeDraft: () => void;
    discardDraft: () => void;
    saveDraftNow: () => void;
    clearDraftAfterSubmit: () => void;
}

const draftKey = (parent: string, childRow: string) => `${KEY_PREFIX}::${parent}::${childRow}`;

const formatRelative = (ts: number | null): string => {
    if (!ts) return '';
    const delta = Date.now() - ts;
    if (delta < 30_000) return 'Saved just now';
    if (delta < 60_000) return 'Saved 1m ago';
    const mins = Math.floor(delta / 60_000);
    if (mins < 60) return `Saved ${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Saved ${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `Saved ${days}d ago`;
};

export function useReportDraft<T extends Record<string, unknown>>({
    parent,
    childRowName,
    form,
    currentStep,
    setCurrentStep,
    isCommitted,
    enabled,
}: UseReportDraftParams<T>): UseReportDraftResult {
    const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [hasDraft, setHasDraft] = useState(false);
    const [showResumeDialog, setShowResumeDialog] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const draftedRef = useRef<DraftPayload<T> | null>(null);

    const key = enabled && parent && childRowName ? draftKey(parent, childRowName) : null;

    // Detect existing draft on mount.
    useEffect(() => {
        if (!key) return;
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return;
            const parsed = JSON.parse(raw) as DraftPayload<T>;
            if (Date.now() - (parsed.savedAt || 0) > DRAFT_TTL_MS) {
                localStorage.removeItem(key);
                return;
            }
            draftedRef.current = parsed;
            setHasDraft(true);
            setShowResumeDialog(true);
        } catch {
            /* corrupt draft — discard silently */
        }
    }, [key]);

    // Auto-save on form change.
    useEffect(() => {
        if (!enabled || !key || isCommitted) return;
        const sub = form.watch((values) => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
                setIsSaving(true);
                try {
                    const payload: DraftPayload<T> = {
                        values: values as T,
                        currentStep,
                        savedAt: Date.now(),
                    };
                    localStorage.setItem(key, JSON.stringify(payload));
                    setLastSavedAt(payload.savedAt);
                } catch {
                    /* quota exceeded — silently ignore */
                } finally {
                    setIsSaving(false);
                }
            }, AUTO_SAVE_DELAY_MS);
        });
        return () => {
            sub.unsubscribe();
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [currentStep, enabled, form, isCommitted, key]);

    // Tick the relative-time label every 30s.
    const [, forceTick] = useState(0);
    useEffect(() => {
        if (!lastSavedAt) return;
        const id = setInterval(() => forceTick((n) => n + 1), 30_000);
        return () => clearInterval(id);
    }, [lastSavedAt]);

    const resumeDraft = useCallback(() => {
        if (!draftedRef.current) return;
        form.reset(draftedRef.current.values);
        setCurrentStep(draftedRef.current.currentStep || 0);
        setShowResumeDialog(false);
    }, [form, setCurrentStep]);

    const discardDraft = useCallback(() => {
        if (!key) return;
        localStorage.removeItem(key);
        draftedRef.current = null;
        setHasDraft(false);
        setShowResumeDialog(false);
    }, [key]);

    const saveDraftNow = useCallback(() => {
        if (!key) return;
        try {
            const payload: DraftPayload<T> = {
                values: form.getValues(),
                currentStep,
                savedAt: Date.now(),
            };
            localStorage.setItem(key, JSON.stringify(payload));
            setLastSavedAt(payload.savedAt);
        } catch {
            /* ignore */
        }
    }, [currentStep, form, key]);

    const clearDraftAfterSubmit = useCallback(() => {
        if (!key) return;
        localStorage.removeItem(key);
        draftedRef.current = null;
        setHasDraft(false);
    }, [key]);

    return {
        lastSavedText: formatRelative(lastSavedAt),
        isSaving,
        hasDraft,
        showResumeDialog,
        setShowResumeDialog,
        resumeDraft,
        discardDraft,
        saveDraftNow,
        clearDraftAfterSubmit,
    };
}
