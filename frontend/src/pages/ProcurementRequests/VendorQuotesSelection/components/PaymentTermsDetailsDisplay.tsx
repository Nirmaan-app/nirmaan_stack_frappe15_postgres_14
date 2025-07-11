// src/pages/ProcurementRequests/VendorQuotesSelection/components/PaymentTermsDetailsDisplay.tsx

import React from 'react';
import { VendorPaymentTerm } from '../types/paymentTerms';
import formatToIndianRupee from '@/utils/FormatPrice';
interface PaymentTermsDetailsDisplayProps {
  terms: VendorPaymentTerm;
}

export const PaymentTermsDetailsDisplay: React.FC<PaymentTermsDetailsDisplayProps> = ({ terms }) => {
  // Don't render anything if the terms array is missing or empty
  if (!terms || !terms.terms || terms.terms.length === 0) {
    // Fallback to just show the type if no milestones are defined
    return (
      <div className="mt-4 pt-4 border-t border-gray-200/80">
        <p className="text-sm font-medium">
          Payment Term: <span className="font-semibold text-red-500">{terms?.type}</span>
        </p>
      </div>
    );
  }

  return (
    // This is the main container for the payment terms section
    <div className="mt-4 pt-4 border-t border-gray-200/80">
      {/* Header showing the overall payment type */}
      <p className="text-sm font-medium">
        Payment Term: <span className="font-bold text-red-600">{terms?.type}</span>
      </p>

      {/* A list that mimics a table for a clean, modern look */}
      <ul className="mt-2 text-sm space-y-1">
        
        {/* The Header Row for our "table" */}
        <li className="flex justify-between font-semibold text-black-500">
          <span className="w-1/2 text-left">Terms</span>
          {/* <div className="flex w-1/2"> */}
            <span className="w-1/2 text-left">Percentage</span>
            <span className="w-1/2 text-left">Amount</span>
            {terms?.type === "Credit" && <span className="w-1/2 text-left">Due Date</span>}
          {/* </div> */}
        </li>

        {/* Loop through each milestone and render a data row */}
        {terms.terms?.map((milestone) => (
          <li key={milestone.id} className="flex justify-between items-center">
            {/* The term name with a bullet point */}
            <span className="w-1/2 text-left">{milestone.name}</span>
            {/* A container for the right-aligned percentage and amount */}
            {/* <div className="flex w-1/2"> */}
              <span className="w-1/2 text-left">{milestone.percentage.toFixed(0)}%</span>
              <span className="w-1/2 text-left">{formatToIndianRupee(milestone.amount)}</span>
              {terms?.type === "Credit" && <span className="w-1/2 text-left">{milestone.due_date||"--"}</span>}
            {/* </div> */}
          </li>
        ))}
      </ul>
    </div>
  );
};