import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { FrappeConfig, FrappeContext, useFrappePostCall } from 'frappe-react-sdk';
import { useUserData } from '@/hooks/useUserData';

/* ─────────────────────────────────────────────────────────────
   TYPES & INTERFACES
   ───────────────────────────────────────────────────────────── */

export interface LockInfo {
  isLocked: boolean;
  lockedBy: string | null;      // User email
  lockedByName: string | null;  // User full name
  lockedAt: string | null;      // ISO timestamp
}

export interface UseEditingLockParams {
  prName: string;
  enabled?: boolean;
}

export interface UseEditingLockReturn {
  lockInfo: LockInfo;
  isMyLock: boolean;
  canEdit: boolean;
  showLockWarning: boolean;
  acquireLock: () => Promise<boolean>;
  releaseLock: () => Promise<void>;
  forceAcquireLock: () => Promise<boolean>;  // Override soft lock
  isAcquiring: boolean;
  isReleasing: boolean;
}

interface LockApiResponse {
  success: boolean;
  message: string;
  lock_info: {
    user: string;
    user_name: string;
    timestamp: string;
  } | null;
}

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
   ───────────────────────────────────────────────────────────── */

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes (matches backend)
const FEATURE_FLAG_DISABLED = 'nirmaan-lock-disabled';

/* ─────────────────────────────────────────────────────────────
   HELPER FUNCTIONS
   ───────────────────────────────────────────────────────────── */

/**
 * Check if lock system is disabled via feature flag
 */
const isLockDisabled = (): boolean => {
  try {
    return localStorage.getItem(FEATURE_FLAG_DISABLED) === 'true';
  } catch {
    return false;
  }
};

/**
 * Default lock info state
 */
const defaultLockInfo: LockInfo = {
  isLocked: false,
  lockedBy: null,
  lockedByName: null,
  lockedAt: null,
};

/* ─────────────────────────────────────────────────────────────
   HOOK IMPLEMENTATION
   ───────────────────────────────────────────────────────────── */

export function useEditingLock({
  prName,
  enabled = true,
}: UseEditingLockParams): UseEditingLockReturn {
  // Check if lock system is disabled
  const lockDisabled = isLockDisabled() || !enabled || !prName;

  // Get current user info
  const userData = useUserData();
  const currentUser = userData?.user_id;

  // Get socket from FrappeContext
  const { socket } = useContext(FrappeContext) as FrappeConfig;

  // Lock state
  const [lockInfo, setLockInfo] = useState<LockInfo>(defaultLockInfo);
  const [showLockWarning, setShowLockWarning] = useState(false);

  // Loading states
  const [isAcquiring, setIsAcquiring] = useState(false);
  const [isReleasing, setIsReleasing] = useState(false);

  // Refs for lifecycle management
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasAcquiredLockRef = useRef(false);
  const isMountedRef = useRef(true);

  // API calls
  const { call: acquireLockApi } = useFrappePostCall<{ message: LockApiResponse }>(
    'nirmaan_stack.api.pr_editing_lock.acquire_lock'
  );
  const { call: releaseLockApi } = useFrappePostCall<{ message: LockApiResponse }>(
    'nirmaan_stack.api.pr_editing_lock.release_lock'
  );
  // checkLockApi available for manual status checks if needed
  const { call: _checkLockApi } = useFrappePostCall<{ message: LockApiResponse }>(
    'nirmaan_stack.api.pr_editing_lock.check_lock'
  );
  const { call: extendLockApi } = useFrappePostCall<{ message: LockApiResponse }>(
    'nirmaan_stack.api.pr_editing_lock.extend_lock'
  );

  /* ─────────────────────────────────────────────────────────────
     COMPUTED VALUES
     ───────────────────────────────────────────────────────────── */

  const isMyLock = useMemo(() => {
    if (!lockInfo.isLocked || !currentUser) return false;
    return lockInfo.lockedBy === currentUser;
  }, [lockInfo.isLocked, lockInfo.lockedBy, currentUser]);

  const canEdit = useMemo(() => {
    // Can edit if:
    // 1. Lock system is disabled
    // 2. No lock exists
    // 3. User holds the lock
    if (lockDisabled) return true;
    if (!lockInfo.isLocked) return true;
    return isMyLock;
  }, [lockDisabled, lockInfo.isLocked, isMyLock]);

  /* ─────────────────────────────────────────────────────────────
     UPDATE LOCK INFO FROM API RESPONSE
     ───────────────────────────────────────────────────────────── */

  const updateLockInfoFromResponse = useCallback((response: LockApiResponse) => {
    if (response.lock_info) {
      setLockInfo({
        isLocked: true,
        lockedBy: response.lock_info.user,
        lockedByName: response.lock_info.user_name,
        lockedAt: response.lock_info.timestamp,
      });
    } else {
      setLockInfo(defaultLockInfo);
    }
  }, []);

  /* ─────────────────────────────────────────────────────────────
     ACQUIRE LOCK
     ───────────────────────────────────────────────────────────── */

  const acquireLock = useCallback(async (): Promise<boolean> => {
    if (lockDisabled) return true;

    setIsAcquiring(true);
    try {
      const response = await acquireLockApi({ pr_name: prName });
      const result = response?.message;

      if (!result) {
        console.error('Empty response from acquire_lock API');
        // Allow editing on API failure (graceful degradation)
        return true;
      }

      if (!isMountedRef.current) return false;

      updateLockInfoFromResponse(result);

      if (result.success) {
        hasAcquiredLockRef.current = true;
        setShowLockWarning(false);
        return true;
      } else {
        // Lock held by someone else
        setShowLockWarning(true);
        return false;
      }
    } catch (error) {
      console.error('Failed to acquire lock:', error);
      // Allow editing on API failure (graceful degradation)
      return true;
    } finally {
      if (isMountedRef.current) {
        setIsAcquiring(false);
      }
    }
  }, [lockDisabled, prName, acquireLockApi, updateLockInfoFromResponse]);

  /* ─────────────────────────────────────────────────────────────
     FORCE ACQUIRE LOCK (Override soft lock)
     ───────────────────────────────────────────────────────────── */

  const forceAcquireLock = useCallback(async (): Promise<boolean> => {
    if (lockDisabled) return true;

    // First release the existing lock (if we're admin or the lock holder)
    // Then acquire a new lock
    setIsAcquiring(true);
    try {
      // Try to release any existing lock first
      await releaseLockApi({ pr_name: prName }).catch(() => {
        // Ignore errors - we may not be the lock holder
      });

      // Now acquire the lock
      const response = await acquireLockApi({ pr_name: prName });
      const result = response?.message;

      if (!result) {
        console.error('Empty response from force acquire_lock API');
        return true; // Graceful degradation
      }

      if (!isMountedRef.current) return false;

      updateLockInfoFromResponse(result);

      if (result.success) {
        hasAcquiredLockRef.current = true;
        setShowLockWarning(false);
        return true;
      }

      // Still failed - someone else grabbed it in between
      setShowLockWarning(true);
      return false;
    } catch (error) {
      console.error('Failed to force acquire lock:', error);
      return true; // Graceful degradation
    } finally {
      if (isMountedRef.current) {
        setIsAcquiring(false);
      }
    }
  }, [lockDisabled, prName, releaseLockApi, acquireLockApi, updateLockInfoFromResponse]);

  /* ─────────────────────────────────────────────────────────────
     RELEASE LOCK
     ───────────────────────────────────────────────────────────── */

  const releaseLock = useCallback(async (): Promise<void> => {
    if (lockDisabled || !hasAcquiredLockRef.current) return;

    setIsReleasing(true);
    try {
      await releaseLockApi({ pr_name: prName });
      hasAcquiredLockRef.current = false;
      if (isMountedRef.current) {
        setLockInfo(defaultLockInfo);
        setShowLockWarning(false);
      }
    } catch (error) {
      console.error('Failed to release lock:', error);
      // Log but don't throw - releasing should be best-effort
    } finally {
      if (isMountedRef.current) {
        setIsReleasing(false);
      }
    }
  }, [lockDisabled, prName, releaseLockApi]);

  /* ─────────────────────────────────────────────────────────────
     EXTEND LOCK (Heartbeat)
     ───────────────────────────────────────────────────────────── */

  const extendLock = useCallback(async (): Promise<void> => {
    if (lockDisabled || !hasAcquiredLockRef.current) return;

    try {
      const response = await extendLockApi({ pr_name: prName });
      const result = response?.message;

      if (!result?.success && isMountedRef.current) {
        // Lock was lost (expired or taken by someone else)
        hasAcquiredLockRef.current = false;
        if (result) {
          updateLockInfoFromResponse(result);
        }
        // Try to re-acquire
        await acquireLock();
      }
    } catch (error) {
      console.error('Failed to extend lock (heartbeat):', error);
      // Don't throw - heartbeat failures shouldn't interrupt editing
    }
  }, [lockDisabled, prName, extendLockApi, updateLockInfoFromResponse, acquireLock]);

  /* ─────────────────────────────────────────────────────────────
     SOCKET.IO LISTENERS
     ───────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (lockDisabled || !socket) return;

    const handleEditingStarted = (data: any) => {
      // Someone else started editing this PR
      if (data.pr_name === prName && data.user !== currentUser) {
        setLockInfo({
          isLocked: true,
          lockedBy: data.user,
          lockedByName: data.user_name,
          lockedAt: data.timestamp,
        });

        // Only show warning if we don't have the lock
        if (!hasAcquiredLockRef.current) {
          setShowLockWarning(true);
        }
      }
    };

    const handleEditingStopped = (data: any) => {
      // Someone stopped editing this PR
      if (data.pr_name === prName) {
        // If it's someone else's lock being released, clear our warning
        if (data.user !== currentUser) {
          setShowLockWarning(false);

          // If we don't have a lock, check if it's now available
          if (!hasAcquiredLockRef.current) {
            setLockInfo(defaultLockInfo);
          }
        }
      }
    };

    // Subscribe to PR-specific room for targeted events
    socket.on('pr:editing:started', handleEditingStarted);
    socket.on('pr:editing:stopped', handleEditingStopped);

    return () => {
      socket.off('pr:editing:started', handleEditingStarted);
      socket.off('pr:editing:stopped', handleEditingStopped);
    };
  }, [lockDisabled, socket, prName, currentUser]);

  /* ─────────────────────────────────────────────────────────────
     LIFECYCLE: ACQUIRE LOCK ON MOUNT
     ───────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (lockDisabled) return;

    isMountedRef.current = true;

    // Acquire lock on mount
    acquireLock();

    // Set up heartbeat interval
    heartbeatIntervalRef.current = setInterval(() => {
      extendLock();
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;

      // Clear heartbeat
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };
  }, [lockDisabled, acquireLock, extendLock]);

  /* ─────────────────────────────────────────────────────────────
     LIFECYCLE: RELEASE LOCK ON UNMOUNT & BEFOREUNLOAD
     ───────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (lockDisabled) return;

    const handleBeforeUnload = () => {
      // Use sendBeacon for reliable unload requests
      if (hasAcquiredLockRef.current) {
        // sendBeacon is more reliable than fetch during unload
        const url = `/api/method/nirmaan_stack.api.pr_editing_lock.release_lock`;
        const data = new FormData();
        data.append('pr_name', prName);

        try {
          navigator.sendBeacon(url, data);
        } catch (error) {
          // Fallback to synchronous request if sendBeacon fails
          console.warn('sendBeacon failed, lock may not be released:', error);
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);

      // Release lock on unmount (component cleanup)
      if (hasAcquiredLockRef.current) {
        // Fire and forget - don't wait for response during unmount
        releaseLockApi({ pr_name: prName }).catch((error) => {
          console.warn('Failed to release lock on unmount:', error);
        });
        hasAcquiredLockRef.current = false;
      }
    };
  }, [lockDisabled, prName, releaseLockApi]);

  /* ─────────────────────────────────────────────────────────────
     RETURN MEMOIZED VALUE
     ───────────────────────────────────────────────────────────── */

  return useMemo(
    () => ({
      lockInfo,
      isMyLock,
      canEdit,
      showLockWarning,
      acquireLock,
      releaseLock,
      forceAcquireLock,
      isAcquiring,
      isReleasing,
    }),
    [
      lockInfo,
      isMyLock,
      canEdit,
      showLockWarning,
      acquireLock,
      releaseLock,
      forceAcquireLock,
      isAcquiring,
      isReleasing,
    ]
  );
}

export default useEditingLock;
