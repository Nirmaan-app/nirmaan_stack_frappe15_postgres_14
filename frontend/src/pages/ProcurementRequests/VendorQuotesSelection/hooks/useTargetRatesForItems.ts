import { useFrappeGetCall } from 'frappe-react-sdk';
import { useMemo } from 'react';
import { FrappeTargetRateApiResponse, TargetRateDetailFromAPI } from '../../ApproveVendorQuotes/types'; // Adjust path
import { queryKeys } from '@/config/queryKeys';

export const useTargetRatesForItems = (itemIds: string[], prId?: string) => {
    const apiArgs = {
        item_ids_json: itemIds.length > 0 ? JSON.stringify(itemIds) : undefined,
    };
    // SWR key should depend on itemIds to refetch if they change significantly
    // Adding prId makes it specific to this PR context if target rates could vary per PR for same items.
    const swrKey = (itemIds.length > 0 && prId) ? queryKeys.targetRates(prId, itemIds) : null;

    const {
        data: apiResponse,
        isLoading,
        error,
        mutate,
    } = useFrappeGetCall<FrappeTargetRateApiResponse>(
        'nirmaan_stack.api.target_rates.get_target_rates_for_item_list.get_target_rates_for_item_list',
        apiArgs,
        swrKey ? JSON.stringify(swrKey) : null, // SWR key
        // { revalidateOnFocus: false, isPaused: () => !itemIds.length } // Pause if no items
    );

    const targetRatesDataMap = useMemo(() => {
        const map = new Map<string, TargetRateDetailFromAPI>();
        apiResponse?.message?.forEach(tr => {
            if (tr.item_id) map.set(tr.item_id, tr);
        });
        return map;
    }, [apiResponse]);

    return {
        targetRatesDataMap,
        isLoading,
        error,
        mutateTargetRates: mutate,
    };
};