import { useMemo } from "react";

export const CustomerFinancials : React.FC = () => {

  const financialTabs = useMemo(() => [
          {
            label: "All Payments",
            value: "All Payments"
          },
          {
            label: "All Orders",
            value: "All Orders"
          },
      ], [])
  return (
    <div>
      Customers Financials
    </div>
  )
}

export default CustomerFinancials;