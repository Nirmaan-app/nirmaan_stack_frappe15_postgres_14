import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations";
import memoize from 'lodash/memoize';
import { parseNumber } from "./parseNumber";

/**
 * Calculates the lowest quote for a given item ID within the last three months.
 * @param quotes_data The quotes data to use for calculation.
 * @param itemId The ID of the item to calculate the lowest quote for.
 * @param threshold The threshold for the standard deviation. Default is 2.
 * @returns The lowest quote within the last three months.
 */

const getThreeMonthsLowestFiltered = memoize(
  (quotes_data : ApprovedQuotations[] | undefined, itemId: string, threshold = 2) => {
    // 1. Extract and parse quotes for the item from quotes_data.
    const quotesForItem: number[] =
      quotes_data
        ?.filter(
          (value) =>
            value?.item_id === itemId &&
            ![null, "0", 0, undefined].includes(value?.quote)
        )
        ?.map((value) => parseNumber(value?.quote)) || [];
  
    if (quotesForItem.length === 0) return 0;
  
    // 2. Calculate the mean.
    const mean =
      quotesForItem.reduce((sum, quote) => sum + quote, 0) /
      quotesForItem.length;
  
    // 3. Calculate the standard deviation.
    const stdDev = Math.sqrt(
      quotesForItem.reduce((sum, quote) => sum + Math.pow(quote - mean, 2), 0) /
        quotesForItem.length
    );
  
    // 4. Define the lower and upper bounds.
    const lowerBound = mean - threshold * stdDev;
    const upperBound = mean + threshold * stdDev;
  
    // 5. Filter the quotes within the defined bounds.
    const filteredQuotes = quotesForItem.filter(
      (quote) => quote >= lowerBound && quote <= upperBound
    );
  
    // 6. If no quotes remain after filtering, fall back to the original list.
    const quotesToConsider =
      filteredQuotes.length > 0 ? filteredQuotes : quotesForItem;
  
    // 7. Return the minimum value.
    return Math.min(...quotesToConsider);
  }, (quotes_data : ApprovedQuotations[] | undefined, itemId: string, threshold = 2) => JSON.stringify(quotes_data) + itemId + threshold);

  export default getThreeMonthsLowestFiltered;