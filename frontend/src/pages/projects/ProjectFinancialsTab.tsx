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
import { useUserData } from "@/hooks/useUserData"
import { Customers } from "@/types/NirmaanStack/Customers"
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows"
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice"
import { formatDate } from "@/utils/FormatDate"
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice"
import { getTotalInflowAmount, getTotalProjectInvoiceAmount } from "@/utils/getAmounts"
import { urlStateManager } from "@/utils/urlStateManager"
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { AmountBreakdownHoverCard } from "./components/AmountBreakdownHoverCard"
import { CustomerPODetailsCard } from "./components/CustomerPODeatilsCard";
import {
  useProjectFinancialsTabData,
} from "./data/tab/financials/useProjectFinancialsTabApi";
import { useProjectAllCredits } from "./hooks/useProjectAllCredits";

const AllPayments = React.lazy(() => import("../ProjectPayments/AllPayments"));
const ProjectPaymentsList = React.lazy(() => import("../ProjectPayments/project-payments-list"));
const ProjectWiseInvoices = React.lazy(() => import("./ProjectWiseInvoices"));
const ProjectInvoices = React.lazy(() => import("../ProjectInvoices/ProjectInvoices"));
const InFlowPayments = React.lazy(() => import("../inflow-payments/InFlowPayments"));
// const CustomerPODeatilsCard = React.lazy(() => import("./components/CustomerPODeatilsCard"));

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
  poPaymentAgainstDelivery: number;
  advanceAgainstPO: number

}
// Sales users (Executive / Lead) only see these financial sub-tabs.
const SALES_ALLOWED_TABS = ["Project Invoices", "Inflow", "Client PO"];

// PMO Executive does NOT see these financial sub-tabs (owner ruling), leaving
// All Payments + All PO Invoices + Client PO.
//
// Deliberately separate from SALES_ALLOWED_TABS: the two are opposite in
// polarity -- one is an allow-list, the other a deny-list -- and they answer
// different questions. Aliasing them would mean a later change to what Sales
// may see silently changes what PMO may not.
const PMO_HIDDEN_TABS = ["Project Invoices", "Inflow"];

type SummaryItem = {
  label: string;
  value: string | number;
  style?: string;
  info?: string;
  onClick?: () => void;
  breakdown?: {
    poAmount: number;
    srAmount: number;
    projectExpensesAmount: number;
  };
};

/**
 * The client-facing money: what the project is worth and what the client has
 * invoiced and paid. Shown as its own first row, above a divider, separate from
 * the operational figures (PO/SR spend, credit, liabilities).
 *
 * This list is BOTH the membership test and the display ORDER of that group --
 * the render maps over these labels, so reordering here reorders the row.
 *
 * Partitioning by LABEL means every item lands in exactly one group and nothing
 * can be dropped: rename a label in `amountsSummaryItems` without updating this
 * list and the tile falls into the operational block, still visible, just
 * ungrouped. That is the safe direction to fail.
 */
const CLIENT_SUMMARY_LABELS: readonly string[] = [
  "Total Inflow Amount",
  "Total Client Invoiced (Incl. GST)",
  "Project Value (Excl. GST)",
  "Project Value (Incl. GST)",
];

const SummaryTile: React.FC<{ item: SummaryItem }> = ({ item }) => (
  <div className="flex flex-col gap-2">
    <p className="text-gray-700 tracking-tight">
      <HoverCard>
        <HoverCardTrigger asChild>
          <span className="inline-flex items-center gap-1">
            {item.label}
            <Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" />
          </span>
        </HoverCardTrigger>
        <HoverCardContent className="text-xs w-auto p-1.5">{item.info || ""}</HoverCardContent>
      </HoverCard>
    </p>

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
);

export const ProjectFinancialsTab: React.FC<ProjectFinancialsTabProps> = ({ projectData, projectCustomer, getTotalAmountPaid, totalPOAmountWithGST, getAllSRsTotalWithGST, getAllPODeliveredAmount, poPaymentAgainstDelivery, advanceAgainstPO }) => {

  const { role } = useUserData();
  const isSales = role === "Nirmaan Sales Executive Profile" || role === "Nirmaan Sales Lead Profile";
  const isPMO = role === "Nirmaan PMO Executive Profile";

  const initialTab = useMemo(() => {
    const urlTab = getUrlStringParam("fTab", "All Payments");
    // Sales users default to (and are confined to) their allowed sub-tabs.
    if (isSales && !SALES_ALLOWED_TABS.includes(urlTab)) {
      return "Project Invoices";
    }
    // A stale ?fTab pointing at a hidden tab must not open it for PMO.
    if (isPMO && PMO_HIDDEN_TABS.includes(urlTab)) {
      return "All Payments";
    }
    return urlTab;
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

  // const { data: CreditData } = useCredits()
  // console.log("CreditData financials",CreditData)
  // const creditsByProject = memoize((projId: string) => CreditData.filter(cr => cr.project == projId));
  // const dueByProject = memoize((projId: string) => CreditData.filter(cr => cr.project == projId && cr.term_status == "Paid"));

  // const relatedTotalBalanceCredit = creditsByProject(projectData?.name).reduce((sum, term) => sum + parseNumber(term.amount), 0);
  // const relatedTotalCreditPaid = dueByProject(projectData?.name).reduce((sum, term) => sum + parseNumber(term.amount), 0);

  const { creditTerms } = useProjectAllCredits(projectData?.name);

  const relatedTotalBalanceCredit = useMemo(() =>
    creditTerms.reduce((sum, term) => sum + parseNumber(term.amount), 0),
    [creditTerms]);

  const relatedTotalCreditPaid = useMemo(() =>
    creditTerms
      .filter(cr => cr.term_status === "Paid")
      .reduce((sum, term) => sum + parseNumber(term.amount), 0),
    [creditTerms]);


  const { inflowsResponse, invoicesResponse } = useProjectFinancialsTabData(projectData?.name);
  const { data: projectInflows, isLoading: projectInflowsLoading } = inflowsResponse;

  const totalInflowAmount = useMemo(() => getTotalInflowAmount(projectInflows || []), [projectInflows])



  // console.log("totalInflowAmount", projectInflows)

  const { data: projectInvoiceData, isLoading: projectInvoicesLoading } = invoicesResponse;


  const totalProjectInvoiceAmount = useMemo(() => getTotalProjectInvoiceAmount(projectInvoiceData || []), [projectInvoiceData])

  const amountsSummaryItems = useMemo(() => [
    {
      label: "Total Inflow Amount",
      value: totalInflowAmount,
      style: "text-green-600 underline",
      onClick: () => toggleInflowPaymentsDialog(),
      info: "Amount received from the client for this project"

    },
    {
      label: "Total PO Amount (Incl. GST)",
      value: totalPOAmountWithGST,
      style: "",
      info: "Total value of all purchase orders raised, including GST."

    },
    {
      label: "Total SR Amount (Incl. GST)",
      value: getAllSRsTotalWithGST,
      style: "",
      info: "Total value of all service requests raised, including GST."

    },
    {
      label: "Total Client Invoiced (Incl. GST)",
      value: totalProjectInvoiceAmount,
      style: "",
      info: "Amount we have invoiced to the client for this project."
    },
    {
      label: "Total Purchase Over Credit",
      value: relatedTotalBalanceCredit,
      style: "",
      info: " Total value of credit POs Purchase for this Project."
    },


    // {
    //   label: "Total Amount Due",
    //   value: (totalPOAmountWithGST + getAllSRsTotalWithGST) - getTotalAmountPaid.totalAmount,
    //   style: "text-red-600"
    // },



    {
      label: "Total Credit Amount Paid",
      value: relatedTotalCreditPaid,
      style: "",
      info: "Total value of credit POs that are paid."
    },
    {
      label: "Project Value (Excl. GST)",
      value: `${projectData?.project_value}`,
      style: "",
      info: "Total project value excluding GST."
    },
    {
      label: "Project Value (Incl. GST)",
      value: `${projectData?.project_value_gst}`,
      style: "",
      info: "Total project value including GST."
    },
    {
      // label: "Total Amount Paid",
      label: "Total OutFlow Amount",

      value: getTotalAmountPaid.totalAmount,
      info: "Total expenses recorded for the project. (Hover for breakdown)",
      style: "text-red-600",

      // --- (Indicator) NEW: Add breakdown data for hover card ---
      breakdown: {
        poAmount: getTotalAmountPaid.poAmount,
        srAmount: getTotalAmountPaid.srAmount,
        projectExpensesAmount: getTotalAmountPaid.projectExpensesAmount
      },

    },
    {
      label: "Payable Amount Against Delivered Items in PO",
      value: getAllPODeliveredAmount,
      style: "",
      info: "Total amount for delivered POs that are now payable."
    },
    {
      label: "Amount Paid Against Delivered Items in PO",
      value: poPaymentAgainstDelivery,
      style: "",
      info: "Amount paid against delivered items in this project’s POs."
    },
    {
      label: "Advance Against PO",
      value: advanceAgainstPO,
      style: "",
      info: "Advance amount paid before delivery for this project’s POs."
    },
    {
      label: "Current Liabilities",
      value: getAllPODeliveredAmount - poPaymentAgainstDelivery,
      style: "",
      info: "PO Payable Amount - PO Payment Against Delivery"
    },

  ], [totalInflowAmount, totalProjectInvoiceAmount, getTotalAmountPaid, totalPOAmountWithGST, getAllSRsTotalWithGST, projectData?.project_value, relatedTotalBalanceCredit, relatedTotalCreditPaid, getAllPODeliveredAmount, poPaymentAgainstDelivery, advanceAgainstPO])


  // Ordered by CLIENT_SUMMARY_LABELS, not by position in amountsSummaryItems.
  //
  // Withheld entirely from PMO (owner ruling): Total Inflow Amount, Total Client
  // Invoiced and both Project Value figures. Returning [] rather than filtering
  // the labels keeps the group an all-or-nothing block -- the render gates the
  // divider on this being non-empty, so PMO gets no stray rule above the
  // operational tiles.
  const clientSummaryItems = useMemo(
    () =>
      isPMO
        ? []
        : (CLIENT_SUMMARY_LABELS
            .map((label) => amountsSummaryItems.find((item) => item.label === label))
            .filter(Boolean) as SummaryItem[]),
    [amountsSummaryItems, isPMO]
  );

  const operationalSummaryItems = useMemo(
    () => amountsSummaryItems.filter((item) => !CLIENT_SUMMARY_LABELS.includes(item.label)) as SummaryItem[],
    [amountsSummaryItems]
  );

  const tabs = useMemo(() => {
    const allTabs = [
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
      {
        label: "Inflow",
        value: "Inflow"
      },
      {
        label: "Client PO",
        value: "Client PO"
      },
    ];
    // Sales users only see Project Invoices, Inflow, and Client PO.
    if (isSales) return allTabs.filter((t) => SALES_ALLOWED_TABS.includes(t.value));
    // PMO loses Project Invoices + Inflow, keeping All Payments + All PO Invoices + Client PO.
    if (isPMO) return allTabs.filter((t) => !PMO_HIDDEN_TABS.includes(t.value));
    return allTabs;
  }, [isSales, isPMO])

  const onClick = useCallback(
    (value: string) => {
      if (value !== tab) {
        setTab(value);
        // updateURL({ fTab: value });
      }
    }
    , [tab]);

  // Keep Sales users confined to their allowed sub-tabs even if `tab` ends up
  // on a restricted value (e.g. a stale fTab URL param).
  useEffect(() => {
    if (isSales && !SALES_ALLOWED_TABS.includes(tab)) {
      setTab("Project Invoices");
    } else if (isPMO && PMO_HIDDEN_TABS.includes(tab)) {
      setTab("All Payments");
    }
  }, [isSales, isPMO, tab]);

  return (
    <div className="flex-1 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Client-facing money first: project value, what we invoiced, what came in.
              The divider belongs to this block -- without the group there is nothing
              to divide, so both are gated on the same condition. */}
          {clientSummaryItems.length > 0 && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                {clientSummaryItems.map((item) => (
                  <SummaryTile key={item.label} item={item} />
                ))}
              </div>

              <div className="border-t border-gray-200" />
            </>
          )}

          {/* Operational money: PO/SR spend, credit, delivery and liabilities. */}
          <div className="grid grid-cols-3 gap-6">
            {operationalSummaryItems.map((item) => (
              <SummaryTile key={item.label} item={item} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tab Navigation - Custom Tailwind buttons matching ServiceRequestsTabs */}
      <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-thin">
        <div className="flex gap-1.5 sm:flex-wrap pb-1 sm:pb-0">
          {tabs.map((option) => {
            const isActive = tab === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onClick(option.value)}
                className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded
                    transition-colors flex items-center gap-1.5 whitespace-nowrap
                    ${isActive
                    ? "bg-sky-500 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <Suspense fallback={<LoadingFallback />}>
        {tab === "All Payments" ? (
          <AllPayments tab="Payments Done" projectId={projectData?.name} />
        ) : tab === "All Orders" ? (
          <ProjectPaymentsList projectId={projectData?.name} />
        ) : tab === "All PO Invoices" ? (
          <ProjectWiseInvoices projectId={projectData?.name} />
        ) : tab === "Project Invoices" ? (
          <ProjectInvoices projectId={projectData?.name} customerId={projectData?.customer} />
        ) : tab === "Inflow" ? (
          <InFlowPayments projectId={projectData?.name} urlContext="project_financials" />
        ) : (
          <CustomerPODetailsCard projectId={projectData?.name} refetchProjectData={async () => { }} role={""} />
        )}
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
