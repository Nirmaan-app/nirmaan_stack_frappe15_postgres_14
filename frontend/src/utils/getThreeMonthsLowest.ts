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

// const getThreeMonthsLowestFiltered = memoize(
//   (quotes_data : ApprovedQuotations[] | undefined, itemId: string, threshold = 2) => {
//     // 1. Extract and parse quotes for the item from quotes_data.
//     const quotesForItem: number[] =
//       quotes_data
//         ?.filter(
//           (value) =>
//             value?.item_id === itemId &&
//             ![null, "0", 0, undefined].includes(value?.quote)
//         )
//         ?.map((value) => parseNumber(value?.quote)) || [];
  
//     if (quotesForItem.length === 0) return 0;
  
//     // 2. Calculate the mean.
//     const mean =
//       quotesForItem.reduce((sum, quote) => sum + quote, 0) /
//       quotesForItem.length;
  
//     // 3. Calculate the standard deviation.
//     const stdDev = Math.sqrt(
//       quotesForItem.reduce((sum, quote) => sum + Math.pow(quote - mean, 2), 0) /
//         quotesForItem.length
//     );
  
//     // 4. Define the lower and upper bounds.
//     const lowerBound = mean - threshold * stdDev;
//     const upperBound = mean + threshold * stdDev;
  
//     // 5. Filter the quotes within the defined bounds.
//     const filteredQuotes = quotesForItem.filter(
//       (quote) => quote >= lowerBound && quote <= upperBound
//     );
  
//     // 6. If no quotes remain after filtering, fall back to the original list.
//     const quotesToConsider =
//       filteredQuotes.length > 0 ? filteredQuotes : quotesForItem;
  
//     // 7. Return the minimum value.
//     return Math.min(...quotesToConsider);
//   }, (quotes_data : ApprovedQuotations[] | undefined, itemId: string, threshold = 2) => itemId + threshold + JSON.stringify(quotes_data));

  // export default getThreeMonthsLowestFiltered;


interface QuoteWithDate {
    quote: number;
    creationDate: Date;
}

/**
 * Calculates a representative historical lowest quote for an item.
 * Prioritizes quotes within the last 3 months and applies standard deviation
 * outlier removal if sufficient data exists (>= 3 quotes).
 * Falls back to the most recent quote within 3 months if data is limited (1-2 quotes).
 * Falls back to the most recent quote overall if no quotes exist in the last 3 months.
 *
 * @param quotes_data Array of all approved quotations.
 * @param itemId The ID of the item to analyze.
 * @param threshold Standard deviation threshold for outlier removal (default: 2).
 * @param minQuotesForStdDev Minimum number of quotes required in the 3-month window to apply std dev logic (default: 3).
 * @returns The calculated representative lowest quote, or 0 if no valid quotes exist for the item.
 */
const getHistoricalLowestQuote = (
    quotes_data: ApprovedQuotations[] | undefined,
    itemId: string,
    threshold: number = 2,
    minQuotesForStdDev: number = 3 // Configurable minimum for std dev calculation
): number => {
    if (!quotes_data || quotes_data.length === 0) {
        return 0;
    }

    // 1. Filter, Validate, Parse, and Sort quotes for the specific item
    const itemQuotesWithDates: QuoteWithDate[] = quotes_data
        .filter(q =>
            q?.item_id === itemId &&
            q.quote && // Check for null/undefined/0 explicitly
            q.quote !== "0" && // Exclude "0" string
            q.creation // Ensure creation date exists
        )
        .map(q => {
            const quote = parseNumber(q.quote); // Assumes parseNumber handles non-numeric strings -> NaN
            const creationDate = new Date(q.creation);
            return { quote, creationDate };
        })
        .filter(q => !isNaN(q.quote) && !isNaN(q.creationDate.getTime())) // Filter out invalid numbers/dates
        .sort((a, b) => b.creationDate.getTime() - a.creationDate.getTime()); // Sort descending (most recent first)

    // 2. Handle No Valid Quotes for Item
    if (itemQuotesWithDates.length === 0) {
        return 0;
    }

    // 3. Define 3-Month Cutoff Date
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    // 4. Filter for Quotes within the Last 3 Months
    const recentQuotes = itemQuotesWithDates.filter(
        q => q.creationDate >= threeMonthsAgo
    );

    // 5. Analyze 3-Month Data and Apply Logic
    if (recentQuotes.length >= minQuotesForStdDev) {
        // Case A: Sufficient data (>= 3) for std dev in last 3 months
        const recentQuoteValues = recentQuotes.map(q => q.quote);

        const mean = recentQuoteValues.reduce((sum, q) => sum + q, 0) / recentQuoteValues.length;
        // Handle stdDev calculation for single point case (though length check prevents this here)
        const variance = recentQuoteValues.reduce((sum, q) => sum + Math.pow(q - mean, 2), 0) / recentQuoteValues.length;
        const stdDev = Math.sqrt(variance);

        // Avoid division by zero or meaningless bounds if stdDev is 0 (all values are identical)
        if (stdDev === 0) {
            return recentQuoteValues[0]; // All values are the same, return any of them
        }

        const lowerBound = mean - threshold * stdDev;
        const upperBound = mean + threshold * stdDev;

        const filteredRecentQuotes = recentQuoteValues.filter(
            q => q >= lowerBound && q <= upperBound
        );

        // Fallback to minimum of recent quotes if filtering removes everything
        const quotesToConsider = filteredRecentQuotes.length > 0 ? filteredRecentQuotes : recentQuoteValues;

        return Math.min(...quotesToConsider);

    } else if (recentQuotes.length > 0) {
        // Case B: 1 or 2 quotes in last 3 months - return the minimum (most recent if only 1)
        return Math.min(...recentQuotes.map(q => q.quote));

    } else {
        // Case C: 0 quotes in last 3 months - return the most recent quote overall
        // The first item in itemQuotesWithDates is the most recent overall due to sorting
        return itemQuotesWithDates[0].quote;
    }
};

// Memoize the new function
// Consider a more stable memoization key if quotes_data reference changes often but content doesn't
// For now, using itemId and threshold. Add stringified data only if absolutely necessary and profile performance.

/**
 * Calculates the lowest quote for a given item ID within the last three months if available else returns the next immediate lowest date quote if available else returns 0.
 * @param quotes_data The quotes data to use for calculation.
 * @param itemId The ID of the item to calculate the lowest quote for.
 * @param threshold The threshold for the standard deviation. Default is 2.
 * @param minQuotesForStdDev Minimum number of quotes required in the 3-month window to apply std dev logic (default: 3).
 * @returns The lowest quote within the last three months.
 */
const getThreeMonthsLowestFiltered = memoize(
    getHistoricalLowestQuote,
    (quotes_data: ApprovedQuotations[] | undefined, itemId: string, threshold: number = 2, minQuotesForStdDev: number = 3) =>
        `${itemId}_${threshold}_${minQuotesForStdDev}_${JSON.stringify(quotes_data)}` // Simplified key, assumes quotes_data is stable enough per item within renders
);


// Export the memoized version for use
export default getThreeMonthsLowestFiltered;

// --- EXAMPLES ---

// Mock Data (ensure creation dates are realistic strings)
// const today = new Date();
// const oneMonthAgo = new Date(new Date().setMonth(today.getMonth() - 1)).toISOString();
// const twoMonthsAgo = new Date(new Date().setMonth(today.getMonth() - 2)).toISOString();
// const fourMonthsAgo = new Date(new Date().setMonth(today.getMonth() - 4)).toISOString();
// const fiveMonthsAgo = new Date(new Date().setMonth(today.getMonth() - 5)).toISOString();
// const sixMonthsAgo = new Date(new Date().setMonth(today.getMonth() - 6)).toISOString();

// const mockQuotes = [
//     // Item A: Plenty of recent data, one outlier
//     { name: "q1", item_id: "ITEM-A", quote: "100", creation: oneMonthAgo },
//     { name: "q2", item_id: "ITEM-A", quote: "105", creation: oneMonthAgo },
//     { name: "q3", item_id: "ITEM-A", quote: "98", creation: twoMonthsAgo },
//     { name: "q4", item_id: "ITEM-A", quote: "102", creation: twoMonthsAgo },
//     { name: "q5", item_id: "ITEM-A", quote: "150", creation: oneMonthAgo }, // Outlier
//     { name: "q6", item_id: "ITEM-A", quote: "90", creation: sixMonthsAgo }, // Old

//     // Item B: Only 2 recent quotes
//     { name: "q7", item_id: "ITEM-B", quote: "55", creation: oneMonthAgo },
//     { name: "q8", item_id: "ITEM-B", quote: "58", creation: twoMonthsAgo },
//     { name: "q9", item_id: "ITEM-B", quote: "50", creation: fiveMonthsAgo }, // Old

//     // Item C: Only 1 recent quote
//     { name: "q10", item_id: "ITEM-C", quote: "210", creation: oneMonthAgo },
//     { name: "q11", item_id: "ITEM-C", quote: "200", creation: fourMonthsAgo }, // Old

//     // Item D: No recent quotes, only old ones
//     { name: "q12", item_id: "ITEM-D", quote: "75", creation: fourMonthsAgo }, // This is the most recent for D
//     { name: "q13", item_id: "ITEM-D", quote: "78", creation: fiveMonthsAgo },
//     { name: "q14", item_id: "ITEM-D", quote: "70", creation: sixMonthsAgo },

//     // Item E: No valid quotes at all
//     { name: "q15", item_id: "ITEM-E", quote: null, creation: oneMonthAgo },
//     { name: "q16", item_id: "ITEM-E", quote: "0", creation: twoMonthsAgo },

//     // Item F: Multiple recent, all identical (std dev = 0 case)
//     { name: "q17", item_id: "ITEM-F", quote: "300", creation: oneMonthAgo },
//     { name: "q18", item_id: "ITEM-F", quote: "300", creation: twoMonthsAgo },
//     { name: "q19", item_id: "ITEM-F", quote: "300", creation: oneMonthAgo },
// ];

// console.log("--- Example Calculations ---");

// // Example A: >= 3 recent quotes, outlier removal expected
// const lowestA = getThreeMonthsLowestFiltered(mockQuotes, "ITEM-A");
// console.log(`Item A (>=3 recent, w/ outlier): Should be 98. Result: ${lowestA}`); // Expect 98 after outlier 150 is removed

// // Example B: 2 recent quotes
// const lowestB = getThreeMonthsLowestFiltered(mockQuotes, "ITEM-B");
// console.log(`Item B (2 recent): Should be 55 (min of recent). Result: ${lowestB}`); // Expect 55 (min of 55, 58)

// // Example C: 1 recent quote
// const lowestC = getThreeMonthsLowestFiltered(mockQuotes, "ITEM-C");
// console.log(`Item C (1 recent): Should be 210 (the only recent). Result: ${lowestC}`); // Expect 210

// // Example D: 0 recent quotes, fallback to most recent overall
// const lowestD = getThreeMonthsLowestFiltered(mockQuotes, "ITEM-D");
// console.log(`Item D (0 recent): Should be 75 (most recent overall). Result: ${lowestD}`); // Expect 75

// // Example E: No valid quotes
// const lowestE = getThreeMonthsLowestFiltered(mockQuotes, "ITEM-E");
// console.log(`Item E (no valid quotes): Should be 0. Result: ${lowestE}`); // Expect 0

// // Example F: Identical recent quotes (std dev = 0)
// const lowestF = getThreeMonthsLowestFiltered(mockQuotes, "ITEM-F");
// console.log(`Item F (identical recent): Should be 300. Result: ${lowestF}`); // Expect 300

// // Example G: Item not in data
// const lowestG = getThreeMonthsLowestFiltered(mockQuotes, "ITEM-G");
// console.log(`Item G (not present): Should be 0. Result: ${lowestG}`); // Expect 0