import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Customers } from "@/types/NirmaanStack/Customers"
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows"
import { formatDate } from "@/utils/FormatDate"
import formatToIndianRupee from "@/utils/FormatPrice"
import { getTotalInflowAmount } from "@/utils/getAmounts"
import { Radio } from "antd"
import { useFrappeGetDocList } from "frappe-react-sdk"
import { useCallback, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { AccountantTabs } from "../ProjectPayments/AccountantTabs"
import { ProjectPaymentsList } from "../ProjectPayments/project-payments-list"

interface ProjectFinancialsTabProps {
  projectData?: any
  projectCustomer?: Customers;
  updateURL: (params: Record<string, string>, removeParams?: string[]) => void;
  getTotalAmountPaid: {
    poAmount: number;
    srAmount: number;
    totalAmount: number;
    }
  totalPOAmountWithGST : number;
  getAllSRsTotalWithGST: number;
}
export const ProjectFinancialsTab : React.FC<ProjectFinancialsTabProps> = ({projectData, projectCustomer, updateURL, getTotalAmountPaid, totalPOAmountWithGST, getAllSRsTotalWithGST}) => {

  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<string>(searchParams.get("fTab") || "All Payments")
  const [inflowPaymentsDialog, setInflowPaymentsDialog] = useState(false)
  
  const toggleInflowPaymentsDialog = () => {
      setInflowPaymentsDialog((prevState) => !prevState);
  };

  const {data : projectInflows, isLoading: projectInflowsLoading} = useFrappeGetDocList<ProjectInflows>("Project Inflows", {
    fields: ["*"],
    filters: [["project", "=", projectData?.name]],
    limit: 1000
  })

  const totalInflowAmount = getTotalInflowAmount(projectInflows || [])

  const amountsSummaryItems = useMemo(() => [
    {
      label: "Total Amount Received",
      value: totalInflowAmount,
      style: "text-green-600 underline",
      onClick: () => toggleInflowPaymentsDialog()
    },
    {
      label: "Total Amount Paid",
      value: getTotalAmountPaid.totalAmount,
      style: "text-red-600"
    },
    {
      label: "Total Amount Due",
      value: (totalPOAmountWithGST + getAllSRsTotalWithGST) - getTotalAmountPaid.totalAmount,
      style: "text-red-600"
    },
    {
      label: "Total PO Amount",
      value: totalPOAmountWithGST,
      style: ""
    },
    {
      label: "Total SR Amount",
      value: getAllSRsTotalWithGST,
      style: ""
    },
    {
      label: "Project Value",
      value: 0,
      style: ""
    },
  ], [projectInflows])


  const tabs = useMemo(() => [
      {
        label: "All Payments",
        value: "All Payments"
      },
      {
        label: "All Orders",
        value: "All Orders"
      },
    ], [])

  const onClick = useCallback(
    (value : string) => {
      if (value !== tab){
        setTab(value);
        updateURL({ fTab: value });
      }
    }
    , [tab, updateURL]);

    const siteUrl = `${window.location.protocol}//${window.location.host}`;

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
                          {formatToIndianRupee(item.value)}
                        </p>
                      </div>
                    ))}
              </CardContent>
          </Card> 

            {tabs && (
                  <Radio.Group
                      options={tabs}
                      defaultValue="All Payments"
                      optionType="button"
                      buttonStyle="solid"
                      value={tab}
                      onChange={(e) => onClick(e.target.value)}
                  />
              )}

              {tab === "All Payments" ? (
                <AccountantTabs tab="Fulfilled Payments" projectsView />
              ) : (

                <ProjectPaymentsList tab="All Orders" projectsView />
              )}

                      <Dialog open={inflowPaymentsDialog} onOpenChange={toggleInflowPaymentsDialog}>
                              <DialogContent className="text-start">
                                  <DialogHeader className="text-start py-8 overflow-auto">
                                    <DialogTitle>Inflow Payments</DialogTitle>
                                  </DialogHeader>
                                      <div className="flex items-center justify-between mb-4">
                                          <div className="flex items-center gap-2">
                                              <Label className=" text-red-700">Customer:</Label>
                                              <span className="text-xs">{projectCustomer?.company_name || "--"}</span>
                                          </div>
                                          <div className="flex items-center gap-2">
                                              <Label className=" text-red-700">Total Inflow:</Label>
                                              <span className="text-xs text-green-600">{formatToIndianRupee(totalInflowAmount)}</span>
                                          </div>
                                      </div>
              
                                      <Table>
                                          <TableHeader className="bg-gray-300">
                                              <TableRow>
                                                  <TableHead>Date</TableHead>
                                                  <TableHead>UTR No.</TableHead>
                                                  <TableHead>Amount</TableHead>
                                              </TableRow>
                                          </TableHeader>
                                          <TableBody>
                                              {(projectInflows || []).length > 0 ? (
                                                  projectInflows?.map((payment) => {
                                                      return (
                                                          <TableRow key={payment?.name}>
                                                              <TableCell className="font-semibold">{formatDate(payment?.payment_date || payment?.creation)}</TableCell>
                                                              {payment?.inflow_attachment ? (
                                                                <TableCell className="font-semibold text-blue-500 underline">
                                                                  {import.meta.env.MODE === "development" ? (
                                                                      <a href={`http://localhost:8000${payment?.inflow_attachment}`} target="_blank" rel="noreferrer">
                                                                          {payment?.utr}
                                                                      </a>
                                                                  ) : (
                                                                      <a href={`${siteUrl}${payment?.inflow_attachment}`} target="_blank" rel="noreferrer">
                                                                          {payment?.utr}
                                                                      </a>
                                                                  )}
                                                              </TableCell>
                                                              ) : (
                                                                  <TableCell className="font-semibold">{payment?.utr}</TableCell>
                                                              )}
                                                              <TableCell className="font-semibold">{formatToIndianRupee(payment?.amount)}</TableCell>
                                                          </TableRow>
                                                      )
                                                  })
                                              ) : (
                                                  <TableRow>
                                                    <TableCell colSpan={3} className="text-center py-2">
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