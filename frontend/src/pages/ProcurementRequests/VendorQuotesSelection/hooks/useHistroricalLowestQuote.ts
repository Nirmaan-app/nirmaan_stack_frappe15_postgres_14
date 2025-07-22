// In: src/hooks/useHistoricalLowestQuote.ts

import { ApprovedQuotations } from '@/types/NirmaanStack/ApprovedQuotations';
import { parseNumber } from '@/utils/parseNumber';
import { useFrappeGetDocList } from 'frappe-react-sdk';
import memoize from 'lodash/memoize';
import { useMemo } from 'react';

// Define the return type for our new function for clarity
interface HistoricalLowest {
  lowestRate: number;
  make: string;
}

export const useHistoricalLowestQuote = () => {
  // 1. Fetch all historical approved quotes (same as your old hook)
  const { data: allApprovedQuotes } = useFrappeGetDocList<ApprovedQuotations>(
    'Approved Quotations',
    {
      fields: ['item_id', 'rate', 'make'], // Only fetch the fields we absolutely need
      limit: 0, // Fetch all records
    },
    'approved_quotations_for_lowest_rate' // Unique SWR key
  );

  // 2. Create the memoized function to perform the calculation
  const getHistoricalLowest = useMemo(
    () =>
      memoize(
        (itemId: string): HistoricalLowest | undefined => {
          if (!allApprovedQuotes || allApprovedQuotes.length === 0) {
            return undefined;
          }

          // Filter all quotes to find those matching the item ID
          const relevantQuotes = allApprovedQuotes.filter(
            (quote) => quote.item_id === itemId
          );

          if (relevantQuotes.length === 0) {
            return undefined;
          }

          // Find the single quote with the absolute lowest rate
          const lowestQuote = relevantQuotes.reduce(
            (lowest, current) => {
              const currentRate = parseNumber(current.rate);
              if (currentRate > 0 && currentRate < lowest.rate) {
                return { rate: currentRate, make: current.make };
              }
              return lowest;
            },
            { rate: Infinity, make: '' } // Initial value for the reduction
          );

          // If a lowest quote was found (i.e., rate is not Infinity), return it
          if (lowestQuote.rate !== Infinity) {
            return {
              lowestRate: lowestQuote.rate,
              make: lowestQuote.make,
            };
          }

          return undefined; // No valid quotes found
        }
      ),
    [allApprovedQuotes] // Dependency array: re-memoize only when the source data changes
  );

  return { getHistoricalLowest };
};