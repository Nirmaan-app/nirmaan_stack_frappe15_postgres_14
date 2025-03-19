import { parseNumber } from "./parseNumber";

/**
 * This function is used to get the lowest quote filled for a given item
 * @param orderData - The order data
 * @param itemId - The item id
 * @returns The lowest quote filled for the given item
 */

const getLowestQuoteFilled = (orderData : any, itemId: string) => {
      const filtered : number[] = []
      Object.values(orderData?.rfq_data?.details?.[itemId]?.vendorQuotes || {})?.map(i => {
      if(i?.quote) {
        filtered.push(parseNumber(i?.quote))
      }
    })
       
    if (filtered.length) return Math.min(...filtered);
    return 0;
};

export default getLowestQuoteFilled;