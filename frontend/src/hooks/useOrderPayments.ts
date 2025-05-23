import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import {  getTotalAmountPaid } from "@/utils/getAmounts";
import { useFrappeGetDocList } from "frappe-react-sdk";
import memoize from "lodash/memoize";
import { useMemo } from "react";

export const useOrderPayments = () => {
  const { data: projectPayments, isLoading: projectPaymentsLoading, error: projectPaymentsError } = useFrappeGetDocList<ProjectPayments>(
    'Project Payments',
    {
      fields: ['name', "document_name", "document_type", "amount", "status", "tds"],
      limit: 0,
      orderBy: { field: 'creation', order: 'desc' },
    },
    "All_Payments_for_order_payments"
  );

  const getAmount = useMemo(
    () => memoize((orderId: string, statuses: string[]) => {
      const payments = projectPayments?.filter(i => i?.document_name === orderId && statuses.includes(i?.status));
      if (payments &&  payments?.length > 0) {
        const total = getTotalAmountPaid(payments);
        return total;
      }
      return 0;
    },
    (orderId: string, statuses: string[]) => orderId + statuses),[projectPayments]
  );

  return {
    projectPayments,
    projectPaymentsLoading,
    projectPaymentsError,
    getAmount,
  };
};
