import { ApprovedQuotations } from '@/types/NirmaanStack/ApprovedQuotations'; // Assuming this type
import getThreeMonthsLowestFiltered from '@/utils/getThreeMonthsLowest';
import { useFrappeGetDocList } from 'frappe-react-sdk';
import memoize from 'lodash/memoize';
import { useMemo } from 'react';

export const useItemEstimate = () => {
  const { data: quote_data } = useFrappeGetDocList<ApprovedQuotations>(
    'Approved Quotations',
    {
      fields: ['*'],
      limit: 100000,
    },
    `Approved Quotations`
  );

  const getItemEstimate = useMemo(
    () => memoize((itemId : string, data: ApprovedQuotations[] | undefined = quote_data) : {averageRate: number, contributingQuotes: ApprovedQuotations[]} | undefined => {
      return getThreeMonthsLowestFiltered(data, itemId)
    }
  , (itemId: string, data: ApprovedQuotations[] | undefined) => JSON.stringify(data) + itemId),[quote_data]);

  return { getItemEstimate };
};