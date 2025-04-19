import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SITEURL from "@/constants/siteURL";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { Projects } from "@/types/NirmaanStack/Projects";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, {formatToRoundedIndianRupee} from "@/utils/FormatPrice";
import { Radio } from "antd";
import { useFrappeGetCall } from "frappe-react-sdk";
import React, { Suspense, useCallback, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";

interface CustomerFinancialsProps {
  customerId?: string
  tab: string
  onClick: (value: string) => void
}

interface FinancialDetailsResponse {
  projects: Projects[];
  // project_payments: ProjectPayments[];
  project_inflows: ProjectInflows[];
  // procurement_orders: ProcurementOrder[];
  // service_requests: ServiceRequests[];
  totals: {
    total_amount_paid: number;
    total_inflow_amount: number;
    total_po_amount_with_gst: number;
    total_sr_amount_with_gst: number;
    total_amount_due: number;
  };
}

// const AccountantTabs = React.lazy(() => import("../ProjectPayments/AccountantTabs"));
const AllPayments = React.lazy(() => import("../ProjectPayments/AllPayments"));
const ProjectPaymentsList = React.lazy(() => import("../ProjectPayments/project-payments-list"));

export const CustomerFinancials : React.FC<CustomerFinancialsProps> = ({customerId, tab, onClick}) => {

  const [inflowPaymentsDialog, setInflowPaymentsDialog] = useState(false)

  const {data: customerFinancialsData, isLoading: customerFinancialsDataLoading} = useFrappeGetCall<{message : FinancialDetailsResponse}>("nirmaan_stack.api.customers.customer_financials.get_customer_financial_details_api", {customer_id: customerId})

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

const toggleInflowPaymentsDialog = useCallback(() => {
      setInflowPaymentsDialog((prevState) => !prevState);
  }, [setInflowPaymentsDialog]);

const amountsSummaryItems = useMemo(() => [
  ...(customerFinancialsData ? [
    {
      label: "Total Amount Received",
      value: customerFinancialsData.message.totals.total_inflow_amount,
      style: "text-green-600 underline",
      onClick: () => toggleInflowPaymentsDialog()
    },
    {
      label: "Total Amount Paid",
      value: customerFinancialsData.message.totals.total_amount_paid,
      style: "text-red-600"
    },
    {
      label: "Total Amount Due",
      value: customerFinancialsData.message.totals.total_amount_due,
      style: "text-red-600"
    },
    {
      label: "Total PO Amount",
      value: customerFinancialsData.message.totals.total_po_amount_with_gst,
      style: ""
    },
    {
      label: "Total SR Amount",
      value: customerFinancialsData.message.totals.total_sr_amount_with_gst,
      style: ""
    },
    // {
    //   label: "Project Value",
    //   value: 0,
    //   style: ""
    // },
  ] : [])
  ], [customerFinancialsData])

  if(customerFinancialsDataLoading) {
    return <div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>
  }


  return (
        <div className="flex-1 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Summary</CardTitle>
            </CardHeader>
              <CardContent className="grid grid-cols-3 gap-6">
                    {amountsSummaryItems.map((item) => (
                      <div key={item.label} className="flex flex-col gap-2">
                        <p className="text-gray-700 tracking-tight">
                          {item.label}
                        </p>
                        <p onClick={item.onClick} className={`text-sm font-bold text-gray-900 ${item.style}`}>
                          {formatToRoundedIndianRupee(item.value)}
                        </p>
                      </div>
                    ))}
              </CardContent>
          </Card> 

            {financialTabs && (
                  <Radio.Group
                      options={financialTabs}
                      defaultValue="All Payments"
                      optionType="button"
                      buttonStyle="solid"
                      value={tab}
                      onChange={(e) => onClick(e.target.value)}
                  />
              )}

               <Suspense fallback={<div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>}>
                   {tab === "All Payments" ? (
                    <AllPayments tab="Payments Done" customerId={customerId} />
                  ) : (
                  
                    <ProjectPaymentsList customerId={customerId} />
                  )}
                </Suspense>

                      <Dialog open={inflowPaymentsDialog} onOpenChange={toggleInflowPaymentsDialog}>
                              <DialogContent className="text-start">
                                  <DialogHeader className="py-4">
                                    <DialogTitle className="text-center">Inflow Payments</DialogTitle>
                                  </DialogHeader>
                                      <div className="flex items-center justify-between mb-4">
                                          <div className="flex items-center gap-2">
                                              {/* <Label className=" text-red-700">Customer:</Label> */}
                                              {/* <span className="text-xs">{projectCustomer?.company_name || "--"}</span> */}
                                          </div>
                                          <div className="flex items-center gap-2">
                                              <Label className=" text-red-700">Total Inflow:</Label>
                                              <span className="text-xs text-green-600">{formatToRoundedIndianRupee(customerFinancialsData?.message?.totals?.total_inflow_amount)}</span>
                                          </div>
                                      </div>
              
                                      <Table>
                                          <TableHeader className="bg-gray-300">
                                              <TableRow>
                                                  <TableHead>Date</TableHead>
                                                  <TableHead>Project</TableHead>
                                                  <TableHead>Payment Ref.</TableHead>
                                                  <TableHead>Amount</TableHead>
                                              </TableRow>
                                          </TableHeader>
                                          <TableBody>
                                              {(customerFinancialsData?.message?.project_inflows || []).length > 0 ? (
                                                  customerFinancialsData?.message?.project_inflows?.map((payment) => {
                                                      return (
                                                          <TableRow key={payment?.name}>
                                                              <TableCell className="font-semibold">{formatDate(payment?.payment_date || payment?.creation)}</TableCell>
                                                              <TableCell className="font-semibold">{customerFinancialsData?.message?.projects?.find(i => i?.name === payment?.project)?.project_name}</TableCell>
                                                              {payment?.inflow_attachment ? (
                                                                <TableCell className="font-semibold text-blue-500 underline">
                                                                      <a href={`${SITEURL}${payment?.inflow_attachment}`} target="_blank" rel="noreferrer">
                                                                          {payment?.utr}
                                                                    </a>
                                                              </TableCell>
                                                              ) : (
                                                                  <TableCell className="font-semibold">{payment?.utr}</TableCell>
                                                              )}
                                                              <TableCell className="font-semibold">{formatToRoundedIndianRupee(payment?.amount)}</TableCell>
                                                          </TableRow>
                                                      )
                                                  })
                                              ) : (
                                                  <TableRow>
                                                    <TableCell colSpan={4} className="text-center py-2">
                                                      No Payments Found
                                                    </TableCell>
                                                  </TableRow>
                                              )}
                                          </TableBody>
                                      </Table>
                              </DialogContent>
                          </Dialog>
        </div>
  )
}

export default CustomerFinancials;