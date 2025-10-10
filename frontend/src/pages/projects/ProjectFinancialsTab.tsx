import LoadingFallback from "@/components/layout/loaders/LoadingFallback"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import memoize from 'lodash/memoize';
import { Download, Info, Edit2, MoreHorizontal } from "lucide-react";
import { parseNumber } from "@/utils/parseNumber";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";

import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import SITEURL from "@/constants/siteURL"
import { getUrlStringParam } from "@/hooks/useServerDataTable"
import { Customers } from "@/types/NirmaanStack/Customers"
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows"
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice"
import { formatDate } from "@/utils/FormatDate"
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice"
import { getTotalInflowAmount, getTotalProjectInvoiceAmount } from "@/utils/getAmounts"
import { urlStateManager } from "@/utils/urlStateManager"
import { Radio } from "antd"
import { useFrappeGetDocList } from "frappe-react-sdk"
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { AmountBreakdownHoverCard } from "./components/AmountBreakdownHoverCard"
import { useCredits } from "../credits/hooks/useCredits";
const AllPayments = React.lazy(() => import("../ProjectPayments/AllPayments"));
const ProjectPaymentsList = React.lazy(() => import("../ProjectPayments/project-payments-list"));
const ProjectWiseInvoices = React.lazy(() => import("./ProjectWiseInvoices"));
const ProjectInvoices = React.lazy(() => import("../ProjectInvoices/ProjectInvoices"));

interface ProjectFinancialsTabProps {
  projectData?: Projects
  projectCustomer?: Customers;
  // updateURL: (params: Record<string, string>, removeParams?: string[]) => void;
  getTotalAmountPaid: {
    poAmount: number;
    srAmount: number;
    projectExpensesAmount: number; // Receive the new field
    totalAmount: number;
  }
  totalPOAmountWithGST: number;
  getAllSRsTotalWithGST: number;
  getAllPODeliveredAmount: number;
}
export const ProjectFinancialsTab: React.FC<ProjectFinancialsTabProps> = ({ projectData, projectCustomer, getTotalAmountPaid, totalPOAmountWithGST, getAllSRsTotalWithGST, getAllPODeliveredAmount }) => {

  const initialTab = useMemo(() => {
    return getUrlStringParam("fTab", "All Payments");
  }, []); // Calculate once

  const [tab, setTab] = useState<string>(initialTab)
  const [inflowPaymentsDialog, setInflowPaymentsDialog] = useState(false)

  const toggleInflowPaymentsDialog = useCallback(() => {
    setInflowPaymentsDialog((prevState) => !prevState);
  }, []);

  // Effect to sync tab state TO URL
  useEffect(() => {
    // Only update URL if the state `tab` is different from the URL's current 'tab' param
    if (urlStateManager.getParam("fTab") !== tab) {
      urlStateManager.updateParam("fTab", tab);
    }
  }, [tab]);

  // Effect to sync URL state TO tab state (for popstate/direct URL load)
  useEffect(() => {
    const unsubscribe = urlStateManager.subscribe("fTab", (_, value) => {
      // Update state only if the new URL value is different from current state
      const newTab = value || initialTab; // Fallback to initial if param removed
      if (tab !== newTab) {
        setTab(newTab);
      }
    });
    return unsubscribe; // Cleanup subscription
  }, [initialTab]); // Depend on `tab` to avoid stale closures

  const { data: CreditData } = useCredits()
  // console.log("CreditData financials",CreditData)
  const creditsByProject = memoize((projId: string) => CreditData.filter(cr => cr.project == projId && cr.term_status !== "Paid"));
  const dueByProject = memoize((projId: string) => CreditData.filter(cr => cr.project == projId && cr.term_status !== "Paid" && cr.term_status !== "Created"));

  const relatedTotalBalanceCredit = creditsByProject(projectData?.name).reduce((sum, term) => sum + parseNumber(term.amount), 0);

  const relatedTotalDue = dueByProject(projectData?.name).reduce((sum, term) => sum + parseNumber(term.amount), 0);


  const { data: projectInflows, isLoading: projectInflowsLoading } = useFrappeGetDocList<ProjectInflows>("Project Inflows", {
    fields: ["*"],
    filters: [["project", "=", projectData?.name]],
    limit: 1000
  })

  const totalInflowAmount = useMemo(() => getTotalInflowAmount(projectInflows || []), [projectInflows])



  // console.log("totalInflowAmount", projectInflows)

  const { data: projectInvoiceData, isLoading: projectInvoicesLoading } = useFrappeGetDocList<ProjectInvoice>("Project Invoices", {
    fields: ["*"],
    filters: [["project", "=", projectData?.name]],
    limit: 1000
  })


  const totalProjectInvoiceAmount = useMemo(() => getTotalProjectInvoiceAmount(projectInvoiceData || []), [projectInvoiceData])

  const amountsSummaryItems = useMemo(() => [
    {
      label: "Total Inflow Amount",
      value: totalInflowAmount,
      style: "text-green-600 underline",
      onClick: () => toggleInflowPaymentsDialog(),
      info:"Amount received from the client for this project"

    },
    {
      label: "Total PO Amount (Incl. GST)",
      value: totalPOAmountWithGST,
      style: "",
      info:"Total value of all purchase orders raised, including GST."

    },
    {
      label: "Total SR Amount (Incl. GST)",
      value: getAllSRsTotalWithGST,
      style: "",
      info:"Total value of all service requests raised, including GST."

    },
    {
      label: "Total Client Invoiced (Incl. GST)",
      value: totalProjectInvoiceAmount,
      style: "",
      info:"Amount we have invoiced to the client for this project."
    },
    {
      label: "Total Liabilities",
      value: relatedTotalBalanceCredit,
      style: "",
      info:"Total value of credit POs scheduled for future payment."
    },


    // {
    //   label: "Total Amount Due",
    //   value: (totalPOAmountWithGST + getAllSRsTotalWithGST) - getTotalAmountPaid.totalAmount,
    //   style: "text-red-600"
    // },



    {
      label: "Total Due Not Paid",
      value: relatedTotalDue,
      style: "",
      info:"Total value of credit POs that are due but not yet paid."
    },
    {
      label: "Project Value (Excl. GST)",
      value: `${projectData?.project_value}`,
      style: "",
      info:"Total project value excluding GST."
    },
    {
      label: "Project Value (Incl. GST)",
      value: `${projectData?.project_value_gst}`,
      style: "",
      info:"Total project value including GST."
    },
    {
      // label: "Total Amount Paid",
      label: "Total OutFlow Amount",

      value: getTotalAmountPaid.totalAmount,
      info:"Total expenses recorded for the project. (Hover for breakdown)",
      style: "text-red-600",
      
      // --- (Indicator) NEW: Add breakdown data for hover card ---
      breakdown: {
        poAmount: getTotalAmountPaid.poAmount,
        srAmount: getTotalAmountPaid.srAmount,
        projectExpensesAmount: getTotalAmountPaid.projectExpensesAmount
      },

    },
    {
      label: "PO Payable Amount",
      value: getAllPODeliveredAmount,
      style: "",
      info:"Total amount for delivered POs that are now payable."
    },
    {
      label: "PO Payment Against Delivery",
      value: Math.min(getTotalAmountPaid.poAmount, getAllPODeliveredAmount),
      style: "",
      info:"Amount paid against delivered items in this project’s POs."
    },
    {
      label: "Advance Against PO",
      // value: getTotalAmountPaid.poAmount-getAllPODeliveredAmount,

      value: Math.max(0, getTotalAmountPaid.poAmount - getAllPODeliveredAmount),
      style: "",
      info:"Advance amount paid before delivery for this project’s POs."
    },





  ], [totalInflowAmount, totalProjectInvoiceAmount, getTotalAmountPaid, totalPOAmountWithGST, getAllSRsTotalWithGST, projectData?.project_value, CreditData])


  const tabs = useMemo(() => [
    {
      label: "All Payments",
      value: "All Payments"
    },
    // {
    //   label: "All Orders",
    //   value: "All Orders"
    // },
    {
      label: "All PO Invoices",
      value: "All PO Invoices"
    },
    {
      label: "Project Invoices",
      value: "Project Invoices"
    },
  ], [])

  const onClick = useCallback(
    (value: string) => {
      if (value !== tab) {
        setTab(value);
        // updateURL({ fTab: value });
      }
    }
    , [tab]);

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
                <HoverCard>
                  <HoverCardTrigger asChild>
                    {/* The original Link was commented out. If you activate it, ensure its Info icon also gets proper styling. */}
                    <span className="inline-flex items-center gap-1"> {/* Use inline-flex to keep the overall element inline */}
                       {item.label}
                  <Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" />
                 
                </span>
                    {/* <Link to={`/vendors/${row.original.vendor}`}><Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" /></Link> */}
                  </HoverCardTrigger>
                  <HoverCardContent className="text-xs w-auto p-1.5">{item.info ||""}</HoverCardContent>
                </HoverCard>
                {/* MODIFIED: Use a flex container for the icon and label */}
                
              </p>

              {/* --- (Indicator) MODIFIED: Conditionally wrap with hover card --- */}
              {item.breakdown ? (
                <AmountBreakdownHoverCard {...item.breakdown}>
                  <p className={`text-sm font-bold text-gray-900 ${item.style} border-b border-dashed cursor-pointer w-fit`}>
                    {formatToRoundedIndianRupee(item.value)}
                  </p>
                </AmountBreakdownHoverCard>
              ) : (
                <p onClick={item.onClick} className={`text-sm font-bold text-gray-900  ${item.style} ${item.onClick ? 'cursor-pointer' : ''}`}>
                  {formatToRoundedIndianRupee(item.value)}
                </p>
              )}
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

      <Suspense fallback={<LoadingFallback />}>
        {tab === "All Payments" ? (
          <AllPayments tab="Payments Done" projectId={projectData?.name} />
        ) : tab === "All Orders" ? (

          <ProjectPaymentsList projectId={projectData?.name} />
        ) : tab === "All PO Invoices" ? (<ProjectWiseInvoices projectId={projectData?.name} />) : <ProjectInvoices projectId={projectData?.name} customerId={projectData?.customer} />}
      </Suspense>

      <Dialog open={inflowPaymentsDialog} onOpenChange={toggleInflowPaymentsDialog}>
        <DialogContent className="text-start max-h-[80vh] overflow-auto">
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
              <span className="text-xs text-green-600">{formatToRoundedIndianRupee(totalInflowAmount)}</span>
            </div>
          </div>

          <Table>
            <TableHeader className="bg-gray-300">
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Payment Ref.</TableHead>
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

export default ProjectFinancialsTab;