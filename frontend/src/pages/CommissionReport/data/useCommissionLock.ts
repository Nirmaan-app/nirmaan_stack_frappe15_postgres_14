// Live "editing now" lock for a single Commission Report task row.
//
// Two hooks sharing one set of endpoint/event constants:
//   • useCommissionEditLock  — EDITOR side. Held by the fill/edit wizard while a
//     report is open for editing: acquire on mount, heartbeat every 5 min,
//     release on unmount + a sendBeacon on tab-close.
//   • useCommissionLockStatus — READER side. Used by the approval dialog to learn
//     (and live-track) whether someone else is editing, so it can warn + block.
//
// Backend: nirmaan_stack/api/commission_report/editing_lock.py (isolated from the
// PR-approval lock). Lock key == the child-row name (wizard `childRowName` ===
// approval `task.name`). Reuses the shared `nirmaan-lock-disabled` feature flag.
// All calls degrade gracefully — a lock-API failure NEVER blocks editing.

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { FrappeConfig, FrappeContext, useFrappePostCall } from 'frappe-react-sdk';
import { useUserData } from '@/hooks/useUserData';

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes (matches backend TTL/heartbeat)
const FEATURE_FLAG_DISABLED = 'nirmaan-lock-disabled';

const ACQUIRE = 'nirmaan_stack.api.commission_report.editing_lock.acquire_lock';
const RELEASE = 'nirmaan_stack.api.commission_report.editing_lock.release_lock';
const EXTEND = 'nirmaan_stack.api.commission_report.editing_lock.extend_lock';
const CHECK = 'nirmaan_stack.api.commission_report.editing_lock.check_lock';
const RELEASE_URL = '/api/method/nirmaan_stack.api.commission_report.editing_lock.release_lock';

const EVT_STARTED = 'commission:editing:started';
const EVT_STOPPED = 'commission:editing:stopped';

interface LockApiResponse {
    success: boolean;
    message: string;
    lock_info: { user: string; user_name: string; timestamp: string } | null;
}

const isLockDisabled = (): boolean => {
    try {
        return localStorage.getItem(FEATURE_FLAG_DISABLED) === 'true';
    } catch {
        return false;
    }
};

/* ─────────────────────────────────────────────────────────────
   EDITOR SIDE — hold the lock while the wizard is open for editing
   ───────────────────────────────────────────────────────────── */

export interface UseCommissionEditLockParams {
    taskName: string;
    /** Only acquire while actively editing (edit/fill mode); never in view mode. */
    enabled?: boolean;
}

export function useCommissionEditLock({ taskName, enabled = true }: UseCommissionEditLockParams): void {
    const lockDisabled = isLockDisabled() || !enabled || !taskName;

    const { call: acquireApi } = useFrappePostCall<{ message: LockApiResponse }>(ACQUIRE);
    const { call: releaseApi } = useFrappePostCall<{ message: LockApiResponse }>(RELEASE);
    const { call: extendApi } = useFrappePostCall<{ message: LockApiResponse }>(EXTEND);

    const hasLockRef = useRef(false);
    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const acquire = useCallback(async () => {
        if (lockDisabled) return;
        try {
            const res = await acquireApi({ task_name: taskName });
            if (res?.message?.success) hasLockRef.current = true;
        } catch (error) {
            // Graceful degradation: never block editing on a lock-API failure.
            console.error('Commission lock acquire failed:', error);
        }
    }, [lockDisabled, taskName, acquireApi]);

    const extend = useCallback(async () => {
        if (lockDisabled || !hasLockRef.current) return;
        try {
            const res = await extendApi({ task_name: taskName });
            if (res?.message && !res.message.success) {
                // Lost the lock (expired / taken) — try to re-acquire.
                hasLockRef.current = false;
                await acquire();
            }
        } catch (error) {
            console.error('Commission lock heartbeat failed:', error);
        }
    }, [lockDisabled, taskName, extendApi, acquire]);

    // Acquire on mount + heartbeat.
    useEffect(() => {
        if (lockDisabled) return;
        acquire();
        heartbeatRef.current = setInterval(() => {
            extend();
        }, HEARTBEAT_INTERVAL_MS);
        return () => {
            if (heartbeatRef.current) {
                clearInterval(heartbeatRef.current);
                heartbeatRef.current = null;
            }
        };
    }, [lockDisabled, acquire, extend]);

    // Release on unmount + best-effort release on tab close.
    useEffect(() => {
        if (lockDisabled) return;
        const handleBeforeUnload = () => {
            if (hasLockRef.current) {
                const data = new FormData();
                data.append('task_name', taskName);
                try {
                    navigator.sendBeacon(RELEASE_URL, data);
                } catch (error) {
                    console.warn('sendBeacon failed, commission lock may not be released:', error);
                }
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            if (hasLockRef.current) {
                releaseApi({ task_name: taskName }).catch((error) => {
                    console.warn('Failed to release commission lock on unmount:', error);
                });
                hasLockRef.current = false;
            }
        };
    }, [lockDisabled, taskName, releaseApi]);
}

/* ─────────────────────────────────────────────────────────────
   READER SIDE — observe (no acquire) whether another user is editing
   ───────────────────────────────────────────────────────────── */

export interface CommissionLockStatus {
    isLockedByOther: boolean;
    lockedByName: string | null;
    lockedAt: string | null;
}

/**
 * Read-only lock status for `taskName`, live-tracked while `active` (e.g. an
 * approval dialog is open). Does a one-shot `check_lock` on open, then keeps the
 * status fresh via the broadcast socket events. Returns whether SOMEONE ELSE
 * (not the current user) holds the lock.
 */
export function useCommissionLockStatus(taskName: string, active: boolean): CommissionLockStatus {
    const enabled = !isLockDisabled() && active && !!taskName;
    const { user_id: currentUser } = useUserData();
    const { socket } = useContext(FrappeContext) as FrappeConfig;
    const { call: checkApi } = useFrappePostCall<{ message: LockApiResponse }>(CHECK);

    const [lock, setLock] = useState<LockApiResponse['lock_info']>(null);

    // One-shot read when (re)opened.
    useEffect(() => {
        if (!enabled) {
            setLock(null);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const res = await checkApi({ task_name: taskName });
                if (!cancelled) setLock(res?.message?.lock_info ?? null);
            } catch {
                if (!cancelled) setLock(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [enabled, taskName, checkApi]);

    // Live updates while open.
    useEffect(() => {
        if (!enabled || !socket) return;
        const onStarted = (d: { task_name?: string; user: string; user_name: string; timestamp: string }) => {
            if (d?.task_name === taskName) setLock({ user: d.user, user_name: d.user_name, timestamp: d.timestamp });
        };
        const onStopped = (d: { task_name?: string }) => {
            if (d?.task_name === taskName) setLock(null);
        };
        socket.on(EVT_STARTED, onStarted);
        socket.on(EVT_STOPPED, onStopped);
        return () => {
            socket.off(EVT_STARTED, onStarted);
            socket.off(EVT_STOPPED, onStopped);
        };
    }, [enabled, socket, taskName]);

    const isLockedByOther = !!lock && lock.user !== currentUser;
    return {
        isLockedByOther,
        lockedByName: lock?.user_name ?? null,
        lockedAt: lock?.timestamp ?? null,
    };
}
