import memoize from 'lodash/memoize';
import { parseNumber } from "./parseNumber";

/**
 * This function is used to get the lowest quote filled for a given item
 * @param orderData - The order data
 * @param itemId - The item id
 * @returns The lowest quote filled for the given item
 */

const getLowestQuoteFilled = memoize(
  (orderData : any, itemId: string) => {
      const filtered : number[] = []
      Object.values(orderData?.rfq_data?.details?.[itemId]?.vendorQuotes || {})?.forEach(i => {
      if(i?.quote) {
        filtered.push(parseNumber(i?.quote))
      }
    })
       
    if (filtered.length) return Math.min(...filtered);
    return 0;
}, (orderData : any, itemId: string) => JSON.stringify(orderData) + itemId);

export default getLowestQuoteFilled;