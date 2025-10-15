import { useFrappeGetCall } from 'frappe-react-sdk';
import { useMemo } from 'react';
import { FrappeTargetRateApiResponse, TargetRateDetailFromAPI } from '../../ApproveVendorQuotes/types'; // Adjust path
import { queryKeys } from '@/config/queryKeys';

const KEY_DELIMITER = "::"; 

    // Helper function (optional, but good practice)
export const getTargetRateKey = (itemId: string, unit: string): string => {
    return `${itemId}${KEY_DELIMITER}${unit}`;
};


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
       
       // Ensure the API response is valid and is an array (message)
       if (apiResponse?.message && Array.isArray(apiResponse.message)) {
           apiResponse.message.forEach(tr => {
               // Check for valid item_id and unit before creating the key
               if (tr.item_id && tr.unit) {
                   // 1. Create the unique, composite key
                   const key = getTargetRateKey(tr.item_id, tr.unit);
                   
                   // 2. Set the data using the composite key
                   map.set(key, tr);
               }
           });
       }
   
       return map;
   }, [apiResponse]);

    // console.log("apiResponse", targetRatesDataMap)

    return {
        targetRatesDataMap,
        isLoading,
        error,
        mutateTargetRates: mutate,
    };
};