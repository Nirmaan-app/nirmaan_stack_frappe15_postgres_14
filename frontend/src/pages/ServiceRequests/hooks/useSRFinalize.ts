import { useFrappeGetCall, useFrappePostCall } from 'frappe-react-sdk';
import { useCallback, useMemo } from 'react';
import { toast } from '@/components/ui/use-toast';
import { useCEOHoldGuard } from '@/hooks/useCEOHoldGuard';

// API response types
interface FinalizePermissionsResponse {
    can_finalize: boolean;
    can_revert: boolean;
    is_finalized: boolean;
    finalized_by: string | null;
    finalized_on: string | null;
    is_admin: boolean;
    is_owner: boolean;
    error?: string;
}

interface FinalizeActionResponse {
    status: 'success' | 'error';
    message: string;
    data?: {
        is_finalized: boolean;
        finalized_by?: string;
        finalized_on?: string;
    };
}

interface UseSRFinalizePermissionsReturn {
    /** Whether the current user can finalize this SR */
    canFinalize: boolean;
    /** Whether the current user can revert finalization */
    canRevert: boolean;
    /** Whether the SR is currently finalized */
    isFinalized: boolean;
    /** Name of who finalized (if finalized) */
    finalizedBy: string | null;
    /** Datetime when finalized (if finalized) */
    finalizedOn: string | null;
    /** Whether user has admin role */
    isAdmin: boolean;
    /** Whether user is the owner/creator */
    isOwner: boolean;
    /** Loading state */
    isLoading: boolean;
    /** Error state */
    error: unknown;
    /** Refetch permissions */
    refetch: () => void;
}

interface UseFinalizeSRReturn {
    /** Function to finalize the SR */
    finalize: (srId: string) => Promise<boolean>;
    /** Loading state */
    isLoading: boolean;
}

interface UseRevertFinalizeSRReturn {
    /** Function to revert finalization */
    revert: (srId: string) => Promise<boolean>;
    /** Loading state */
    isLoading: boolean;
}

interface UseFinalizeSROptions {
    projectId?: string;
    onSuccess?: () => void;
}

interface UseRevertFinalizeSROptions {
    projectId?: string;
    onSuccess?: () => void;
}

/**
 * Hook to check finalization permissions for a Service Request.
 * Fetches permission data from the backend.
 */
export function useSRFinalizePermissions(srId: string | undefined): UseSRFinalizePermissionsReturn {
    const { data, isLoading, error, mutate } = useFrappeGetCall<{ message: FinalizePermissionsResponse }>(
        'nirmaan_stack.api.sr_finalize.check_finalize_permissions',
        { sr_id: srId || '' },
        srId ? `sr_finalize_permissions_${srId}` : null,
        {
            revalidateOnFocus: false,
            revalidateOnReconnect: false,
        }
    );

    const result = useMemo(() => {
        const response = data?.message;
        return {
            canFinalize: response?.can_finalize ?? false,
            canRevert: response?.can_revert ?? false,
            isFinalized: response?.is_finalized ?? false,
            finalizedBy: response?.finalized_by ?? null,
            finalizedOn: response?.finalized_on ?? null,
            isAdmin: response?.is_admin ?? false,
            isOwner: response?.is_owner ?? false,
        };
    }, [data]);

    return {
        ...result,
        isLoading,
        error,
        refetch: () => mutate(),
    };
}

/**
 * Hook to finalize a Service Request.
 * Returns a function to trigger finalization.
 */
export function useFinalizeSR(options?: UseFinalizeSROptions | (() => void)): UseFinalizeSRReturn {
    // Support both old signature (onSuccess callback) and new signature (options object)
    const { projectId, onSuccess } = typeof options === 'function'
        ? { projectId: undefined, onSuccess: options }
        : (options || {});

    const { isCEOHold, showBlockedToast } = useCEOHoldGuard(projectId);

    const { call, loading: isLoading } = useFrappePostCall<FinalizeActionResponse>(
        'nirmaan_stack.api.sr_finalize.finalize_sr'
    );

    const finalize = useCallback(async (srId: string): Promise<boolean> => {
        // CEO Hold guard
        if (isCEOHold) {
            showBlockedToast();
            return false;
        }

        if (!srId) {
            toast({
                title: 'Error',
                description: 'Service Request ID is required',
                variant: 'destructive',
            });
            return false;
        }

        try {
            await call({ sr_id: srId });
            toast({
                title: 'Success',
                description: 'Work Order has been finalized',
                variant: 'success',
            });
            onSuccess?.();
            return true;
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to finalize Work Order';
            toast({
                title: 'Error',
                description: errorMessage,
                variant: 'destructive',
            });
            return false;
        }
    }, [call, onSuccess, isCEOHold, showBlockedToast]);

    return {
        finalize,
        isLoading,
    };
}

/**
 * Hook to revert finalization of a Service Request.
 * Returns a function to trigger revert.
 */
export function useRevertFinalizeSR(options?: UseRevertFinalizeSROptions | (() => void)): UseRevertFinalizeSRReturn {
    // Support both old signature (onSuccess callback) and new signature (options object)
    const { projectId, onSuccess } = typeof options === 'function'
        ? { projectId: undefined, onSuccess: options }
        : (options || {});

    const { isCEOHold, showBlockedToast } = useCEOHoldGuard(projectId);

    const { call, loading: isLoading } = useFrappePostCall<FinalizeActionResponse>(
        'nirmaan_stack.api.sr_finalize.revert_finalize_sr'
    );

    const revert = useCallback(async (srId: string): Promise<boolean> => {
        // CEO Hold guard
        if (isCEOHold) {
            showBlockedToast();
            return false;
        }

        if (!srId) {
            toast({
                title: 'Error',
                description: 'Service Request ID is required',
                variant: 'destructive',
            });
            return false;
        }

        try {
            await call({ sr_id: srId });
            toast({
                title: 'Success',
                description: 'Work Order finalization has been reverted',
                variant: 'success',
            });
            onSuccess?.();
            return true;
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to revert finalization';
            toast({
                title: 'Error',
                description: errorMessage,
                variant: 'destructive',
            });
            return false;
        }
    }, [call, onSuccess, isCEOHold, showBlockedToast]);

    return {
        revert,
        isLoading,
    };
}
