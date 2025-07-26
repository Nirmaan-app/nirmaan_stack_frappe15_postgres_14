import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { Customers } from "@/types/NirmaanStack/Customers";
import { ProcurementOrder as ProcurementOrdersType } from "@/types/NirmaanStack/ProcurementOrders";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { ProjectEstimates as ProjectEstimatesType } from '@/types/NirmaanStack/ProjectEstimates';
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { ProjectExpenses } from "@/types/NirmaanStack/ProjectExpenses"; // Import new type
import { AmountBreakdownHoverCard } from "./components/AmountBreakdownHoverCard"; // Import new hover card
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { getAllSRsTotal } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";
import {
  ConfigProvider,
  Menu,
  MenuProps
} from "antd";
import {
  FrappeDoc,
  useFrappeDocumentEventListener,
  useFrappeGetCall,
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappeUpdateDoc
} from "frappe-react-sdk";
import {
  ChevronsUpDown,
  CircleCheckBig,
  FilePenLine,
  HardHat,
  OctagonMinus
} from "lucide-react";
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import {
  useParams
} from "react-router-dom";
import { useReactToPrint } from "react-to-print";
// import { Component as ProjectEstimates } from './add-project-estimates';
import { CustomHoverCard } from "./CustomHoverCard";
import { EditProjectForm } from "./edit-project-form";
// import { ProjectFinancialsTab } from "./ProjectFinancialsTab";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
// import { ProjectMakesTab } from "./ProjectMakesTab";
// import ProjectOverviewTab from "./ProjectOverviewTab";
// import ProjectSpendsTab from "./ProjectSpendsTab";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { urlStateManager } from "@/utils/urlStateManager";
import { Projects, ProjectWPCategoryMake } from "@/types/NirmaanStack/Projects";
// import ProjectPRSummaryTable from "./components/ProjectPRSummaryTable";
// import ProjectSRSummaryTable from "./components/ProjectSRSummaryTable";

const ProjectSRSummaryTable = React.lazy(() => import("./components/ProjectSRSummaryTable"));
const ProjectPRSummaryTable = React.lazy(() => import("./components/ProjectPRSummaryTable"));
const ProjectFinancialsTab = React.lazy(() => import("./ProjectFinancialsTab"));
const ProjectMakesTab = React.lazy(() => import("./ProjectMakesTab"));
const ProjectOverviewTab = React.lazy(() => import("./ProjectOverviewTab"));
const ProjectSpendsTab = React.lazy(() => import("./ProjectSpendsTab"));
const ProjectEstimates = React.lazy(() => import("./add-project-estimates"));
const ProjectPOSummaryTable = React.lazy(() => import("./components/ProjectPOSummaryTable"));
const ProjectMaterialUsageTab = React.lazy(() => import("./components/ProjectMaterialUsageTab"));
import { ProjectExpensesTab } from "./components/ProjectExpenseTab"; // NEW

import { KeyedMutator } from "swr";
import { useUrlParam } from "@/hooks/useUrlParam";

const projectStatuses = [
  { value: "WIP", label: "WIP", color: "text-yellow-500", icon: HardHat },
  {
    value: "Completed",
    label: "Completed",
    color: "text-green-500",
    icon: CircleCheckBig,
  },
  {
    value: "Halted",
    label: "Halted",
    color: "text-red-500",
    icon: OctagonMinus,
  },
];

export interface po_item_data_item {
  po_number: string
  vendor_id: string
  vendor_name: string
  creation: string
  item_id: string
  quote: number
  quantity: number
  received_quantity: number
  category: string
  tax: number
  unit: string
  item_name: string
  work_package: string
}

export interface FilterParameters {
  fields?: string[]
  filters?: any
  limit?: number
  orderBy?: { field: string, order: string }
  limit_start?: number
}

export const ProjectQueryKeys = {
  project: (projectId: string) => ['projects', 'single', projectId],
  customer: (customerId: string) => ['customers', 'single', customerId],
  quotes: (parameters: FilterParameters) => ['Approved Quotations', 'list', { ...parameters }],
  estimates: (parameters: FilterParameters) => ['Project Estimates', 'list', { ...parameters }]
}

const Project: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();

  if (!projectId) return <div>No Project ID Provided</div>

  const { data, isLoading, mutate: project_mutate } = useFrappeGetDoc<Projects>("Projects", projectId, projectId ? ProjectQueryKeys.project(projectId) : null);

  useFrappeDocumentEventListener("Projects", projectId, (event) => {
    console.log("Project document updated (real-time):", event);
    toast({
      title: "Document Updated",
      description: `Project ${event.name} has been modified.`,
    });
    project_mutate();
  },
    true // emitOpenCloseEventsOnMount
  );

  const { data: projectCustomer, isLoading: projectCustomerLoading, mutate: projectCustomerMutate } = useFrappeGetDoc<Customers>("Customers", data?.customer, data?.customer ? ProjectQueryKeys.customer(data?.customer) : null);

  useFrappeDocumentEventListener("Customers", data?.customer!, (event) => {
    console.log("Customer document updated (real-time):", event);
    toast({
      title: "Document Updated",
      description: `Customer ${event.name} has been modified.`,
    });
    projectCustomerMutate();
  },
    true // emitOpenCloseEventsOnMount
  );

  const { data: po_item_data, isLoading: po_item_loading } = useFrappeGetCall<{
    message: {
      po_items: po_item_data_item[],
      custom_items: po_item_data_item[]
    }
  }>(
    "nirmaan_stack.api.procurement_orders.generate_po_summary",
    { project_id: projectId }
  );

  if (isLoading || projectCustomerLoading || po_item_loading) {
    return <LoadingFallback />
  }

  if (isLoading || projectCustomerLoading) {
    return <LoadingFallback />
  }


  return (
    data && (
      <ProjectView
        projectId={projectId}
        data={data}
        project_mutate={project_mutate}
        projectCustomer={projectCustomer}
        po_item_data={[
          ...po_item_data?.message?.po_items.map(item => ({ ...item, isCustom: false })) || [],
          ...po_item_data?.message?.custom_items.map(item => ({ ...item, isCustom: true })) || [],
        ]}
      />
    )
  );
};

interface ProjectViewProps {
  projectId: string;
  data: Projects;
  project_mutate: KeyedMutator<FrappeDoc<Projects>>;
  projectCustomer?: Customers;
  po_item_data?: po_item_data_item[];
}

export const Component = Project;

// const chartConfig = {
//   visitors: {
//     label: "Visitors",
//   },
//   category1: {
//     label: "Category 1",
//     color: "hsl(var(--chart-1))",
//   },
//   category2: {
//     label: "Category 2",
//     color: "hsl(var(--chart-2))",
//   },
//   category3: {
//     label: "Category 3",
//     color: "hsl(var(--chart-3))",
//   },
// } satisfies ChartConfig;


export const PROJECT_PAGE_TABS = {
  OVERVIEW: 'overview',
  PR_SUMMARY: 'prsummary',
  SR_SUMMARY: 'srsummary',
  PO_SUMMARY: 'posummary',
  FINANCIALS: 'projectfinancials',
  SPENDS: 'projectspends',
  MAKES: 'projectmakes',
  ESTIMATES: 'projectestimates',
  MATERIAL_USAGE: 'projectmaterialusage',
  PROJECT_EXPENSES: 'projectexpenses', // --- (Indicator) NEW TAB KEY ---
} as const;

type ProjectPageTabValue = typeof PROJECT_PAGE_TABS[keyof typeof PROJECT_PAGE_TABS];


const ProjectView = ({ projectId, data, project_mutate, projectCustomer, po_item_data }: ProjectViewProps) => {

  // console.log("modified-call", po_item_data)

  const { role } = useUserData();

  const [newStatus, setNewStatus] = useState<string>("");
  const [showStatusChangeDialog, setShowStatusChangeDialog] = useState(false);
  const { updateDoc, loading: updateDocLoading } = useFrappeUpdateDoc();
  // const [statusCounts, setStatusCounts] = useState<{ [key: string]: number }>({ "New PR": 0, "Open PR": 0, "Approved PO": 0 });
  const [editSheetOpen, setEditSheetOpen] = useState(false);

  const [options, setOptions] = useState<{ label: string; value: string }[]>([]);

  const [makeOptions, setMakeOptions] = useState<{ label: string; value: string }[]>([]);

  const toggleEditSheet = useCallback(() => {
    setEditSheetOpen((prevState) => !prevState);
  }, []);

  // --- Tab State Management using urlStateManager ---
  const initialActivePage = useMemo(() => {
    return getUrlStringParam("page", PROJECT_PAGE_TABS.OVERVIEW) as ProjectPageTabValue;
  }, []); // Calculate once

  const [activePage, setActivePage] = useState<ProjectPageTabValue>(initialActivePage);

  // Effect to sync activePage state TO URL
  useEffect(() => {
    if (urlStateManager.getParam("page") !== activePage) {
      urlStateManager.updateParam("page", activePage);
    }
  }, [activePage]);

  // Effect to sync URL "page" param TO activePage state (for popstate/direct URL load)
  useEffect(() => {
    const unsubscribe = urlStateManager.subscribe("page", (_, value) => {
      const newPage = (value || PROJECT_PAGE_TABS.OVERVIEW) as ProjectPageTabValue;
      if (activePage !== newPage) {
        setActivePage(newPage);
      }
    });
    // Ensure initial sync if URL already has the param
    const currentUrlPage = urlStateManager.getParam("page") as ProjectPageTabValue | null;
    if (currentUrlPage && activePage !== currentUrlPage) {
      setActivePage(currentUrlPage);
    }
    return unsubscribe;
  }, [activePage, initialActivePage]); // Rerun if initialTab logic changes or tab changes externally

  const makesTab = useUrlParam("makesTab") || makeOptions?.[0]?.value

  // const [makesTab] = useStateSyncedWithParams<string>("makesTab", makeOptions?.[0]?.value)

  const handlePageChange: MenuProps['onClick'] = useCallback((e) => {
    const newPage = e.key as ProjectPageTabValue;
    if (activePage !== newPage) {
      setActivePage(newPage);
      // If changing main page/tab, you might want to clear sub-tabs or specific filters
      // Example: Clearing 'makesTab', 'eTab', 'fTab' when switching main 'page'
      // urlStateManager.updateParam("makesTab", null);
      // urlStateManager.updateParam("eTab", null);
      // urlStateManager.updateParam("fTab", null);
    }
  }, [activePage]);

  type MenuItem = Required<MenuProps>["items"][number];

  const items: MenuItem[] = useMemo(() => [
    {
      label: "Overview",
      key: PROJECT_PAGE_TABS.OVERVIEW,
    },
    // role === "Nirmaan Admin Profile"
    //   ? {
    //     label: "Project Tracking",
    //     key: "projectTracking",
    //   }
    //   : null,
    // {
    //   label: "PR Summary",
    //   key: PROJECT_PAGE_TABS.PR_SUMMARY,
    // },
     {
      label: "Financials",
      key: PROJECT_PAGE_TABS.FINANCIALS,
    },
    {
      label: "SR Summary",
      key: PROJECT_PAGE_TABS.SR_SUMMARY,
    },
    {
      label: "PO Summary",
      key: PROJECT_PAGE_TABS.PO_SUMMARY,
    },
    // ["Nirmaan Admin Profile", "Nirmaan Estimates Executive Profile"].includes(
    //   role
    // )
    //   ? {
    //     label: "Project Spends",
    //     key: "projectspends",
    //   }
    //   : null,
    {
      label: "Project Spends",
      key: PROJECT_PAGE_TABS.SPENDS,
    },
     {
      label: "PR Summary",
      key: PROJECT_PAGE_TABS.PR_SUMMARY,
    },
    // {
    //   label: "Financials",
    //   key: PROJECT_PAGE_TABS.FINANCIALS,
    // },
    {
      label: "Project Estimates",
      key: PROJECT_PAGE_TABS.ESTIMATES
    },
    {
      label: "Project Makes",
      key: PROJECT_PAGE_TABS.MAKES
    },
    {
      label: "Material Usage",
      key: PROJECT_PAGE_TABS.MATERIAL_USAGE
    },
    // --- (Indicator) NEW MENU ITEM ---
    {
      label: "Misc. Project Expenses",
      key: PROJECT_PAGE_TABS.PROJECT_EXPENSES
    }
  ], [role]);

  // Define tabs available based on role or other logic
  // const availableTabs = useMemo(() => {
  //   const tabs = [
  //       { label: "Overview", value: PROJECT_PAGE_TABS.OVERVIEW },
  //       { label: "PR Summary", value: PROJECT_PAGE_TABS.PR_SUMMARY },
  //       { label: "SR Summary", value: PROJECT_PAGE_TABS.SR_SUMMARY },
  //       { label: "PO Summary", value: PROJECT_PAGE_TABS.PO_SUMMARY },
  //       { label: "Project Spends", value: PROJECT_PAGE_TABS.SPENDS },
  //       { label: "Financials", value: PROJECT_PAGE_TABS.FINANCIALS },
  //       { label: "Project Estimates", value: PROJECT_PAGE_TABS.ESTIMATES },
  //       { label: "Project Makes", value: PROJECT_PAGE_TABS.MAKES }, // Assuming makes are per project
  //   ];
  //   return tabs;
  // }, [role]);


  // const getTabsToRemove = useMemo(() => memoize((newPage: string) => {
  //   const tabsToRemove = newPage === 'projectspends' ? ['eTab', 'makesTab', 'fTab'] : newPage === 'projectmakes' ? ['tab', 'eTab', 'fTab'] : newPage === 'projectestimates' ? ['tab', 'makesTab', 'fTab'] : newPage === 'projectfinancials' ? ['tab', 'makesTab', 'eTab'] : ['tab', 'eTab', 'makesTab', 'fTab'];
  //   return tabsToRemove;
  // }, (newPage: string) => newPage), [])

  // const onClick: MenuProps['onClick'] = useCallback(
  //   (e) => {
  //     if (activePage === e.key) return;
  //     const newPage = e.key;
  //     const tabsToRemove = getTabsToRemove(newPage)
  //     setActivePage(newPage, tabsToRemove)
  //   }
  //   , [activePage, getTabsToRemove]);

  // const onClick: MenuProps['onClick'] = useCallback(
  //   (e) => {
  //     if (activePage === e.key) return;

  //     const newPage = e.key;

  //     if (newPage === 'projectspends') {
  //       setTab("All", ['eTab', 'makesTab', 'fTab']);
  //       // updateURL({ page: newPage, tab: 'All' }, ['eTab', 'makesTab', 'fTab']);
  //     } else if (newPage === 'projectmakes') {
  //       setMakesTab(makeOptions?.[0]?.value || '', ['eTab', 'tab', 'fTab']);
  //       // updateURL({ page: newPage, makesTab: makeOptions?.[0]?.value || '' }, ['eTab', 'tab', 'fTab']);
  //     } else if (newPage === 'projectestimates'){
  //       setETab("All", ['tab', 'makesTab', 'fTab']);
  //       // updateURL({page: newPage, eTab: 'All'}, ['tab', 'makesTab', 'fTab'])
  //     } else if (newPage === "projectfinancials") {
  //       setFTab("All Payments", ['tab', 'makesTab', 'eTab']);
  //       // updateURL({page: newPage, fTab: 'All Payments'}, ['tab', 'makesTab', 'eTab'])
  //     } 
  //     // else {
  //     //   setMakesTab('');
  //     //    updateURL({ page: newPage }, ['tab', 'eTab', 'makesTab', 'fTab']);
  //     // }
  //     setActivePage(newPage);
  //   }, [activePage, updateURL]);


  // const { data: mile_data } = useFrappeGetDocList(
  //   "Project Work Milestones",
  //   {
  //     fields: ["*"],
  //     filters: [["project", "=", projectId]],
  //     limit: 1000,
  //     orderBy: { field: "start_date", order: "asc" },
  //   },
  //   `Project Work MileStones ${projectId}`,
  //   {
  //     revalidateIfStale: false,
  //   }
  // );

  const {
    data: project_estimates,
  } = useFrappeGetDocList<ProjectEstimatesType>("Project Estimates", {
    fields: ["work_package", "quantity_estimate", "rate_estimate", "name"],
    filters: [["project", "=", projectId]],
    limit: 0,
  }, projectId ? ProjectQueryKeys.estimates({ fields: ["work_package", "quantity_estimate", "rate_estimate", "name"], filters: [["project", "=", projectId]], limit: 0 }) : null);

  const { data: projectPayments, isLoading: projectPaymentsLoading } = useFrappeGetDocList<ProjectPayments>("Project Payments", {
    fields: ["document_type", "amount", "document_name", "status", "name"],
    filters: [['project', '=', projectId], ['status', '=', 'Paid']],
    limit: 0
  })

  // --- (Indicator) NEW: Fetch Project Expenses for this specific project ---
  const { data: projectExpenses, isLoading: projectExpensesLoading } = useFrappeGetDocList<ProjectExpenses>("Project Expenses", {
    fields: ["name", "amount"], // Only need amount for calculation
    filters: [['projects', '=', projectId]],
    limit: 0
  });

  // const { data: usersList } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
  //   fields: ["*"],
  //   limit: 1000,
  // }, 'Nirmaan Users');

  const { data: pr_data, isLoading: prData_loading } = useFrappeGetDocList<ProcurementRequest>(
    "Procurement Requests",
    {
      fields: ["name", "work_package"],
      filters: [["project", "=", `${projectId}`]],
      limit: 0,
    },
    projectId ? `Procurement Requests ${projectId}` : null
  );

  const { data: po_data, isLoading: po_loading } = useFrappeGetDocList<ProcurementOrdersType>(
    "Procurement Orders",
    {
      fields: ["name", "procurement_request", "status", "amount", "tax_amount", "total_amount", "invoice_data"] as const,
      filters: [
        ["project", "=", projectId],
        ["status", "!=", "Merged"],
      ], // removed ["status", "!=", "PO Approved"] for now
      limit: 0,
      orderBy: { field: "creation", order: "desc" },
    }
  );

  // console.log("ProjectOverView DATA", po_data)

  const { data: approvedServiceRequestsData, isLoading: approvedServiceRequestsDataLoading } = useFrappeGetDocList<ServiceRequests>("Service Requests", {
    fields: ["gst", "name", "service_order_list"],
    filters: [
      ["status", "=", "Approved"],
      ["project", "=", projectId],
    ],
    limit: 0,
  });

  // const { data: vendorsList } = useFrappeGetDocList<Vendors>("Vendors", {
  //   fields: ["vendor_name", "vendor_type"],
  //   filters: [["vendor_type", "in", ["Material", "Material & Service"]]],
  //   limit: 10000,
  // });

  // const vendorOptions = useMemo(() => vendorsList?.map((ven) => ({
  //   label: ven.vendor_name,
  //   value: ven.vendor_name,
  // })), [vendorsList]);

  // --- (Indicator) MODIFIED: Update the getTotalAmountPaid calculation ---
  const getTotalAmountPaid = useMemo(() => {
    if (!projectPayments) {
      return { poAmount: 0, srAmount: 0, projectExpensesAmount: 0, totalAmount: 0 };
    }

    const poAmount = projectPayments.filter(p => p?.document_type === "Procurement Orders").reduce((acc, p) => acc + parseNumber(p.amount), 0);
    const srAmount = projectPayments.filter(p => p?.document_type === "Service Requests").reduce((acc, p) => acc + parseNumber(p.amount), 0);
    const projectExpensesAmount = projectExpenses?.reduce((acc, e) => acc + parseNumber(e.amount), 0) || 0;

    return { poAmount, srAmount, projectExpensesAmount, totalAmount: poAmount + srAmount + projectExpensesAmount };
  }, [projectPayments, projectExpenses]);

  const totalPosRaised = useMemo(() => {
    // 1. Guard Clause: This part is correct and should be kept.
    if (!po_data || po_data.length === 0) {
      return 0;
    }

    // 2. Corrected `reduce` implementation
    return po_data.reduce((accumulator, currentOrder) => {
      // For each order, add its 'amount' to the running total (accumulator).
      // The parseNumber helper gracefully handles cases where 'amount' might be null or not a number.
      return accumulator + parseNumber(currentOrder.amount);
    }, 0); // <-- 3. CRITICAL FIX: The initial value for the sum is now correctly set to 0.

  }, [po_data]);

  const [workPackageTotalAmounts, setWorkPackageTotalAmounts] = useState<{ [key: string]: any }>({});

  const today = new Date();

  const formattedDate = today.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const componentRef = React.useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({
    content: () => {
      // console.log("Print Report button Clicked");
      return componentRef.current || null;
    },
    documentTitle: `${formattedDate}_${data?.project_name}_${data?.project_city}_${data?.project_state}_${data?.owner}_${data?.creation}`,
  });
  const componentRef2 = React.useRef<HTMLDivElement>(null);
  const handlePrint2 = useReactToPrint({
    content: () => {
      // console.log("Print Schedule button Clicked");
      return componentRef2.current || null;
    },
    documentTitle: `${data?.project_name}_${data?.project_city}_${data?.project_state}_${data?.owner}_${data?.creation}`,
  });

  const componentRef3 = React.useRef<HTMLDivElement>(null);
  const handlePrint3 = useReactToPrint({
    content: () => {
      return componentRef3.current || null;
    },
    documentTitle: `${data?.project_name}_${data?.project_city}_${data?.project_state
      }_${data?.owner}_${formatDate(new Date())}`,
  });

  const groupItemsByWorkPackageAndCategory = useMemo(() => (
    items: po_item_data_item[] | undefined
  ) => {
    const totals: {
      [key: string]: {
        amountWithTax: number;
        amountWithoutTax: number;
        total_estimated_amount?: number;
        total_amount_paid?: number;
      };
    } = {};

    const allItemIds: string[] = [];

    const groupedData = items?.reduce((acc: { [workPackage: string]: { [category: string]: any[] } }, item: po_item_data_item & { isCustom?: boolean }) => {
      const isCustom = item?.isCustom === true;
      const work_package = isCustom ? "Custom" : item.work_package;

      const baseAmount = parseNumber(item.quote * item.quantity);
      const taxAmount = baseAmount * (parseNumber(item.tax) / 100);
      const amountPlusTax = baseAmount + taxAmount;

      if (totals[work_package]) {
        const { amountWithTax, amountWithoutTax } = totals[work_package];
        totals[work_package] = {
          amountWithTax: amountWithTax + amountPlusTax,
          amountWithoutTax: amountWithoutTax + baseAmount,
        };
      } else {
        totals[work_package] = {
          amountWithTax: amountPlusTax,
          amountWithoutTax: baseAmount,
        };
      }

      if (!acc[work_package]) acc[work_package] = {};
      if (!acc[work_package][item.category]) {
        acc[work_package][item.category] = [];
      }

      const existingItem = acc[work_package][item.category].find(
        (i) => i.item_id === item.item_id
      );

      if (existingItem) {
        existingItem.quantity += item.quantity;
        existingItem.received += item.received;
        existingItem.amount += baseAmount;
        existingItem.amountWithTax += amountPlusTax;
        existingItem.averageRate = Math.floor((existingItem.averageRate + item.quote) / 2);
        existingItem.po_number = `${existingItem.po_number},${item.po_number}`;
      } else {
        allItemIds.push(item.item_id);
        acc[work_package][item.category].push({
          ...item,
          amount: baseAmount,
          amountWithTax: amountPlusTax,
          averageRate: item.quote,
        });
      }

      return acc;
    }, {}) || {};

    return { groupedData, totals };
  }, [items]);

  const poToWorkPackageMap = useMemo(() => {
    if (!po_data || !pr_data) return {};

    const map: { [poName: string]: string } = {};

    po_data.forEach((po) => {
      const pr = pr_data.find((pr) => pr.name === po.procurement_request);
      const workPackage = pr?.work_package?.trim() ? pr.work_package : "Custom";
      map[po.name] = workPackage;
    });

    return map;
  }, [po_data, pr_data]);

  useEffect(() => {
    if (!po_item_data || !project_estimates || !projectPayments) return;

    const { totals } = groupItemsByWorkPackageAndCategory(po_item_data);

    const totalAmountPaidWPWise: { [key: string]: number } = {};

    projectPayments
      ?.filter((payment) => payment.document_type === "Procurement Orders")
      .forEach((payment) => {
        const workPackage = poToWorkPackageMap[payment.document_name] || "Custom";

        if (!totalAmountPaidWPWise[workPackage]) {
          totalAmountPaidWPWise[workPackage] = 0;
        }
        totalAmountPaidWPWise[workPackage] += parseNumber(payment.amount);
      });

    Object.keys(totals || {}).forEach((key) => {
      const estimates = project_estimates?.filter((i) => i?.work_package === key) || [];
      const totalEstimatedAmount = estimates.reduce(
        (acc, i) => acc + parseNumber(i.quantity_estimate) * parseNumber(i.rate_estimate),
        0
      );

      totals[key]['total_estimated_amount'] = totalEstimatedAmount || 0;
      totals[key]['total_amount_paid'] = totalAmountPaidWPWise[key] || 0;
    });

    setWorkPackageTotalAmounts(totals);
  }, [po_item_data, project_estimates, projectPayments, poToWorkPackageMap]);

  const { groupedData: categorizedData } =
    groupItemsByWorkPackageAndCategory(po_item_data);

  const totalPOAmountWithGST: number = useMemo(() => Object.keys(workPackageTotalAmounts || {}).reduce((acc, key) => {
    const { amountWithTax } = workPackageTotalAmounts[key];
    return acc + amountWithTax;
  }, 0), [workPackageTotalAmounts])

  // console.log("total-po-amt-with-gst", totalPOAmountWithGST)

  // const categoryTotals = po_item_data?.reduce((acc, item) => {
  //   const category = acc[item.category] || { withoutGst: 0, withGst: 0 };

  //   const itemTotal = parseFloat(item.quantity) * parseFloat(item.quote);
  //   const itemTotalWithGst = itemTotal * (1 + parseFloat(item.tax) / 100);

  //   category.withoutGst += itemTotal;
  //   category.withGst += itemTotalWithGst;

  //   acc[item.category] = category;
  //   return acc;
  // }, {});

  // const overallTotal = Object.values(categoryTotals || [])?.reduce(
  //   (acc, totals) => ({
  //     withoutGst: acc.withoutGst + totals.withoutGst,
  //     withGst: acc.withGst + totals.withGst,
  //   }),
  //   { withoutGst: 0, withGst: 0 }
  // );

  // const pieChartData = Object.keys(categoryTotals || []).map((category) => ({
  //   name: category,
  //   value: categoryTotals[category].withGst,
  //   fill: `#${Math.floor(Math.random() * 16777215).toString(16)}`, // Random colors
  // }));

  // const getChartData = (po_item_data) => {
  //   const aggregatedData = {};

  //   po_item_data?.forEach((item) => {
  //     const date = formatDate(item.creation.split(" ")[0]); // Extract date only
  //     const baseTotal = parseFloat(item.quote) * parseFloat(item.quantity);
  //     const totalWithGST = baseTotal * (1 + parseFloat(item.tax) / 100);

  //     if (!aggregatedData[date]) {
  //       aggregatedData[date] = { withGST: 0, withoutGST: 0 };
  //     }
  //     aggregatedData[date].withoutGST += baseTotal;
  //     aggregatedData[date].withGST += totalWithGST;
  //   });

  //   return Object.keys(aggregatedData || []).map((date) => ({
  //     date,
  //     withoutGST: aggregatedData[date].withoutGST,
  //     withGST: aggregatedData[date].withGST,
  //   }));
  // };

  // const chartData = getChartData(po_item_data); // Now ready for use in Recharts

  const [popOverOpen, setPopOverOpen] = useState(false);

  const setPopOverStatus = useCallback(() => {
    setPopOverOpen((prevState) => !prevState);
  }, []);

  useEffect(() => {
    if (data && data.project_wp_category_makes) {
      // Step 1: Extract unique procurement package DocNames from the child table
      const uniqueWPDocNames = new Set<string>();
      data.project_wp_category_makes.forEach((item: ProjectWPCategoryMake) => {
        if (item.procurement_package) {
          uniqueWPDocNames.add(item.procurement_package);
        }
      });

      // Step 2: Create options from these unique DocNames
      // For the label, you'd ideally use the display name (e.g., work_package_name)
      // For now, let's assume the DocName itself can be used as a label,
      // or you have a way to map it (e.g., from a fetched list of all Procurement Packages).

      // --- Placeholder for mapping DocName to Display Name ---
      // Example: if you fetched 'allProcurementPackages'
      // const wpNameMap = new Map<string, string>();
      // allProcurementPackages?.forEach(pkg => {
      //     if (pkg.name && pkg.work_package_name) {
      //         wpNameMap.set(pkg.name, pkg.work_package_name);
      //     }
      // });
      // --- End Placeholder ---

      const workPackageOptions = Array.from(uniqueWPDocNames).map(wpDocName => {
        // const label = wpNameMap.get(wpDocName) || wpDocName; // Use display name if available
        const label = wpDocName; // Using DocName as label for now
        return { label: label, value: wpDocName };
      });

      // Step 3: Construct the full options list including "All", "Services"
      const finalOptions = [
        { label: "All", value: "All" },
        ...workPackageOptions,
        // { label: "Tool & Equipments", value: "Tool & Equipments" }, // This was commented out
        { label: "Services", value: "Services" }, // Assuming "Services" is always an option
      ].sort((a, b) => {
        if (a.label === "All") return -1;
        if (b.label === "All") return 1;
        return a.label.localeCompare(b.label);
      });

      setOptions(finalOptions);

      // Step 4: Set makeOptions (which seems to be a filtered version of finalOptions)
      // Your original logic for makeOptions: options?.filter(i => !["All", "Tool & Equipments", "Services"].includes(i.label))
      // Since "Tool & Equipments" is commented out, it might just be:
      const filteredMakeOptions = finalOptions.filter(
        option => !["All", "Services"].includes(option.label)
      );
      setMakeOptions(filteredMakeOptions);

      // setSelectedPackage("All"); // If you need to reset a selection

    } else if (data && !data.project_wp_category_makes) {
      // Handle case where project data is loaded but the child table is empty or missing
      // This might mean no work packages are configured for the project yet.
      const defaultOptions = [
        { label: "All", value: "All" },
        { label: "Services", value: "Services" },
      ].sort((a, b) => {
        if (a.label === "All") return -1;
        if (b.label === "All") return 1;
        return a.label.localeCompare(b.label);
      });
      setOptions(defaultOptions);
      setMakeOptions(defaultOptions.filter(opt => !["All", "Services"].includes(opt.label)));
    }
  }, [data, setOptions, setMakeOptions]); // Add setOptions and setMakeOptions to dependencies if they are stable
  // If allProcurementPackages is fetched, add it to dependencies too.


  const handleStatusChange = useCallback((value: string) => {
    if (value === data?.status) {
      setPopOverStatus();
      return;
    }
    if (projectStatuses.some((s) => s.value === value)) {
      setNewStatus(value);
      setShowStatusChangeDialog(true);
    }
  }, [data?.status, projectStatuses]);

  const totalServiceOrdersAmt = useMemo(() => getAllSRsTotal(approvedServiceRequestsData || [])?.withoutGST, [approvedServiceRequestsData])

  const getAllSRsTotalWithGST = useMemo(() => getAllSRsTotal(approvedServiceRequestsData || [])?.withGST, [approvedServiceRequestsData])

  const handleConfirmStatus = async () => {
    try {
      await updateDoc("Projects", data?.name, { status: newStatus });
      await project_mutate();
      toast({
        title: "Success!",
        description: `Successfully changed status to ${newStatus}.`,
        variant: "success",
      });
    } catch (error) {
      console.log("error", error);
      toast({
        title: "Failed!",
        description: `Failed to change status to ${newStatus}.`,
        variant: "destructive",
      });
    } finally {
      setShowStatusChangeDialog(false);
    }
  };

  const handleCancelStatus = () => {
    setNewStatus("");
    setShowStatusChangeDialog(false);
  };

  const statusIcon = useMemo(() => projectStatuses.find(
    (s) => s.value === data?.status
  )?.icon, [data?.status]);

  const estimatesTotal = useMemo(() => project_estimates?.reduce((acc, i) => acc + (parseNumber(i?.quantity_estimate) * parseNumber(i?.rate_estimate)), 0) || 0, [project_estimates]);

  if (po_loading || projectPaymentsLoading || approvedServiceRequestsDataLoading || prData_loading) {
    return <LoadingFallback />
  }


  // --- Render specific tab content ---
  const renderTabContent = () => {
    if (!projectId) return <div>Project ID is missing.</div>;

    switch (activePage) {
      case PROJECT_PAGE_TABS.OVERVIEW:
        // Pass necessary data to ProjectOverviewTab
        return <ProjectOverviewTab projectData={data} estimatesTotal={estimatesTotal} projectCustomer={projectCustomer} totalPOAmountWithGST={totalPOAmountWithGST} getAllSRsTotalWithGST={getAllSRsTotalWithGST} getTotalAmountPaid={getTotalAmountPaid} />;
      case PROJECT_PAGE_TABS.PR_SUMMARY:
        return <ProjectPRSummaryTable projectId={projectId} />;
      case PROJECT_PAGE_TABS.SR_SUMMARY:
        return <ProjectSRSummaryTable projectId={projectId} />;
      case PROJECT_PAGE_TABS.PO_SUMMARY:
        return <ProjectPOSummaryTable projectId={projectId} />;
      case PROJECT_PAGE_TABS.FINANCIALS:
        return <ProjectFinancialsTab projectData={data} projectCustomer={projectCustomer}
          totalPOAmountWithGST={totalPOAmountWithGST} getTotalAmountPaid={getTotalAmountPaid} getAllSRsTotalWithGST={getAllSRsTotalWithGST} />;
      case PROJECT_PAGE_TABS.SPENDS:
        return <ProjectSpendsTab projectId={data?.name} po_data={po_data} options={options}
          categorizedData={categorizedData} getTotalAmountPaid={getTotalAmountPaid} workPackageTotalAmounts={workPackageTotalAmounts} totalServiceOrdersAmt={totalServiceOrdersAmt} />; // Example
      case PROJECT_PAGE_TABS.MAKES:
        return <ProjectMakesTab projectData={data} project_mutate={project_mutate} options={makeOptions} initialTab={makesTab} />; // Example
      case PROJECT_PAGE_TABS.ESTIMATES:
        return <ProjectEstimates projectTab />; // Example
      case PROJECT_PAGE_TABS.MATERIAL_USAGE:
        return <ProjectMaterialUsageTab projectId={projectId} projectPayments={projectPayments} />;
      // --- (Indicator) NEW CASE FOR THE NEW TAB ---
      case PROJECT_PAGE_TABS.PROJECT_EXPENSES:
        return <ProjectExpensesTab projectId={projectId} />;
      default:
        return <div>Select a tab.</div>;
    }
  };

  return (
    <div className="flex-1 space-y-4">
      <div className="flex items-center justify-between max-md:flex-col max-md:gap-2 max-md:items-start">
        <div className="inline-block">
          <span className="text-xl md:text-3xl font-bold tracking-tight text-wrap mr-1 md:ml-2">
            {data?.project_name.toUpperCase()}
          </span>
          {role === "Nirmaan Admin Profile" && (
            <Sheet open={editSheetOpen} onOpenChange={toggleEditSheet} modal={false}>
              <SheetTrigger>
                <FilePenLine className="max-md:w-4 max-md:h-4 text-blue-300 hover:-translate-y-1 transition hover:text-blue-600 cursor-pointer inline-block -mt-3 max-md:-mt-1" />
              </SheetTrigger>
              <SheetContent className="overflow-auto">
                <EditProjectForm toggleEditSheet={toggleEditSheet} />
              </SheetContent>
            </Sheet>
          )}
        </div>
        {/* </div> */}
        <div className="flex max-sm:text-xs max-md:text-sm items-center max-md:justify-between max-md:w-full">
          {role === "Nirmaan Admin Profile" && (
            <>
              <Popover open={popOverOpen} onOpenChange={setPopOverStatus}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-48 md:py-6 flex justify-between"
                  >
                    <span className="font-bold text-md">Status: </span>
                    <div
                      className={`flex items-center gap-2 ${projectStatuses.find((s) => s.value === data?.status)
                        ?.color || "text-gray-500"
                        }`}
                    >
                      {statusIcon &&
                        React.createElement(statusIcon, {
                          className: "h-4 w-4",
                        })}
                      {projectStatuses.find((s) => s.value === data?.status)
                        ?.label || "Not Set"}
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-40 p-0">
                  <Command>
                    <CommandList>
                      <CommandGroup>
                        {projectStatuses.map((s) => (
                          <CommandItem
                            key={s.value}
                            value={s.value}
                            onSelect={() => handleStatusChange(s.value)}
                          >
                            {/* <Check className={cn("mr-2 h-4 w-4", status === s.value ? "opacity-100" : "opacity-0")} /> */}
                            {s.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <AlertDialog
                open={showStatusChangeDialog}
                onOpenChange={setShowStatusChangeDialog}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action will change the status from "{data.status} "
                      to "
                      {projectStatuses.find((s) => s.value === newStatus)
                        ?.label || "Unknown"}
                      ".
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    {updateDocLoading ? (
                      <TailSpin color="red" width={26} height={26} />
                    ) : (
                      <>
                        <AlertDialogCancel onClick={handleCancelStatus}>
                          Cancel
                        </AlertDialogCancel>
                        <Button onClick={handleConfirmStatus}>
                          Continue
                        </Button>
                      </>
                    )}
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          <div className="flex flex-col items-start ml-2 text-sm max-sm:text-xs">
            <CustomHoverCard
              totalPosRaised={totalPosRaised}
              totalServiceOrdersAmt={totalServiceOrdersAmt}
              categorizedData={categorizedData}
              workPackageTotalAmounts={workPackageTotalAmounts}
            />
            <div>
              <span className="whitespace-nowrap">Total Estimates: </span>
              <span className="max-sm:text-end max-sm:w-full text-primary">
                {formatToRoundedIndianRupee(estimatesTotal)}
              </span>
            </div>
            <div>
              <span className="whitespace-nowrap">Total Amt Paid: </span>
              {/* --- (Indicator) MODIFIED: Wrap the amount in the new hover card --- */}
              <AmountBreakdownHoverCard
                poAmount={getTotalAmountPaid.poAmount}
                srAmount={getTotalAmountPaid.srAmount}
                projectExpensesAmount={getTotalAmountPaid.projectExpensesAmount}
              >
                <span className="max-sm:text-end max-sm:w-full text-primary cursor-pointer border-b border-dashed">
                  {formatToRoundedIndianRupee(getTotalAmountPaid.totalAmount)}
                </span>
              </AmountBreakdownHoverCard>
            </div>
          </div>
        </div>
      </div>


      <div className="w-full">
        <ConfigProvider
          theme={{
            components: {
              Menu: {
                horizontalItemSelectedColor: "#D03B45",
                itemSelectedBg: "#FFD3CC",
                itemSelectedColor: "#D03B45",
              },
            },
          }}
        >
          <Menu
            selectedKeys={[activePage]}
            onClick={handlePageChange}
            mode="horizontal"
            items={items}
          />
        </ConfigProvider>
      </div>

      {/* Content Area for the Active Tab */}
      <Suspense fallback={<LoadingFallback />}>
        {renderTabContent()}
      </Suspense>

      {/* Overview Section */}

      {/* {activePage === "overview" && (
        <ProjectOverviewTab projectData={data} estimatesTotal={estimatesTotal} projectCustomer={projectCustomer} totalPOAmountWithGST={totalPOAmountWithGST} getAllSRsTotalWithGST={getAllSRsTotalWithGST} getTotalAmountPaid={getTotalAmountPaid} />
      )
      } */}

      {/* {activePage === "projectTracking" && (
        <div className="pr-2">
          <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-2">
            <Button
              variant="outline"
              className=" cursor-pointer flex items-center gap-1"
              onClick={() => handlePrint()}
            >
              Download Report
              <Download className="w-4" />
            </Button>
            <Button
              variant="outline"
              className="cursor-pointer flex items-center gap-1"
              onClick={() => handlePrint2()}
            >
              Download Schedule
              <Download className="w-4" />
            </Button>
            <Button
              variant="outline"
              className="cursor-pointer flex items-center gap-1"
              onClick={() => handlePrint3()}
            >
              Download Today's Report
              <Download className="w-4" />
            </Button>
          </div>
          {mile_isloading ? (
            <TableSkeleton />
          ) : (
            <DataTable columns={columns} data={mile_data || []} />
          )}
        </div>
      )} */}

      {/* {activePage === "prsummary" && (
          <Suspense fallback={<LoadingFallback />}>
            <ProjectPRSummaryTable projectId={projectId} />
          </Suspense>
      )} */}

      {/* {activePage === "posummary" && (
        <>

          <Card>
            <CardContent className="flex flex-row items-center justify-between p-4">
              <CardDescription>
                <p className="text-lg font-semibold text-gray-700">Summary</p>
                <p className="text-sm text-gray-500">
                  Overview of totals across all work packages
                </p>
              </CardDescription>
              <CardDescription className="text-right">
                <div className="flex flex-col items-start">
                  <p className="text-gray-700">
                    <span className="font-bold">Total inc. GST:</span>{" "}
                    <span className="text-blue-600">
                      {formatToRoundedIndianRupee(totalPOAmountWithGST)}
                    </span>
                  </p>
                  <p className="text-gray-700">
                    <span className="font-bold">Total exc. GST:</span>{" "}
                    <span className="text-blue-600">
                      {formatToRoundedIndianRupee(totalPosRaised)}
                    </span>
                  </p>
                  <p className="text-gray-700">
                    <span className="font-bold">Total Amt Paid:</span>{" "}
                    <span className="text-blue-600">
                      {formatToRoundedIndianRupee(getTotalAmountPaid.poAmount)}
                    </span>
                  </p>
                </div>
              </CardDescription>
            </CardContent>
          </Card>
          <div>
            {
              po_data_for_posummary_loading ? (
                <TableSkeleton />
              ) : (
                <DataTable
                  columns={poColumns}
                  data={po_data_for_posummary || []}
                  vendorOptions={vendorOptions}
                  itemSearch={true}
                  wpOptions={
                    wpOptions
                    
                  }
                />
              )
            }
          </div>
        </>
      )} */}

      {/* {activePage === "projectspends" && (
        <ProjectSpendsTab projectId={projectId} po_data={po_data} options={options}
          categorizedData={categorizedData} getTotalAmountPaid={getTotalAmountPaid} workPackageTotalAmounts={workPackageTotalAmounts} totalServiceOrdersAmt={totalServiceOrdersAmt} />
      )} */}


      {/* {activePage === "projectfinancials" && (
        <Suspense fallback={<LoadingFallback />}>
          <ProjectFinancialsTab projectData={data} projectCustomer={projectCustomer}
            totalPOAmountWithGST={totalPOAmountWithGST} getTotalAmountPaid={getTotalAmountPaid} getAllSRsTotalWithGST={getAllSRsTotalWithGST} />
        </Suspense>
      )} */}

      {/* {activePage === "projectestimates" && (
        <ProjectEstimates projectTab />
      )} */}

      {/* {activePage === "projectmakes" && (
        <ProjectMakesTab projectData={data} project_mutate={project_mutate} options={makeOptions} initialTab={makesTab} />
      )} */}

      {/* {activePage === "SRSummary" && (
        <>
          <Card>
            <CardContent className="flex flex-row items-center justify-between p-4">
              <CardDescription>
                <p className="text-lg font-semibold text-gray-700">Summary</p>
                <p className="text-sm text-gray-500">
                  Overview of Service Order totals
                </p>
              </CardDescription>
              <CardDescription className="text-right">
                <div className="flex flex-col items-start">
                  <p className="text-gray-700">
                    <span className="font-bold">Total inc. GST:</span>{" "}
                    <span className="text-blue-600">
                      {formatToRoundedIndianRupee(getAllSRsTotalWithGST)}
                    </span>
                  </p>
                  <p className="text-gray-700">
                        <span className="font-bold">Total exc. GST:</span>{" "}
                        <span className="text-blue-600">
                          {formatToIndianRupee(totalServiceOrdersAmt)}
                        </span>
                      </p>
                  <p className="text-gray-700">
                    <span className="font-bold">Total Amt Paid:</span>{" "}
                    <span className="text-blue-600">
                      {formatToRoundedIndianRupee(getTotalAmountPaid?.srAmount)}
                    </span>
                  </p>
                </div>
              </CardDescription>
            </CardContent>
          </Card>
          <DataTable
            columns={srSummaryColumns}
            data={allServiceRequestsData || []}
          />
        </>
      )} */}

      {/* {activePage === "srsummary" && (
        <Suspense fallback={<LoadingFallback />}>
          <ProjectSRSummaryTable projectId={projectId} />
        </Suspense>
      )} */}

      {/* <div className="hidden">
        <div ref={componentRef} className="px-4 pb-1">
          <div className="overflow-x-auto">
            <table className="w-full my-4">
              <thead className="w-full">
                <tr>
                  <th colSpan={5 + areaNames?.length} className="p-0">
                    <div className="mt-1 flex justify-between">
                      <div>
                        <img src={logo} alt="Nirmaan" width="180" height="52" />
                        <div className="pt-1 text-lg text-gray-500 font-semibold">
                          Nirmaan(Stratos Infra Technologies Pvt. Ltd.)
                        </div>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr>
                  <th colSpan={5 + areaNames?.length} className="p-0">
                    <div className="py-1 border-b-2 border-gray-600 pb-2 mb-1">
                      <div className="flex justify-between">
                        <div className="text-xs text-gray-500 font-normal">
                          1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR
                          Layout, Bengaluru - 560102, Karnataka
                        </div>
                        <div className="text-xs text-gray-500 font-normal">
                          GST: 29ABFCS9095N1Z9
                        </div>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr>
                  <th colSpan={5 + areaNames?.length} className="p-0">
                    <div className="grid grid-cols-6 gap-4 justify-between border border-gray-100 rounded-lg px-3 py-1 mb-1">
                      <div className="border-0 flex flex-col col-span-2">
                        <p className="text-left py-1 font-medium text-xs text-gray-500">
                          Name and address
                        </p>
                        <p className="text-left font-bold font-semibold text-sm text-black">
                          {data?.project_name}
                        </p>
                        <p className="text-left py-1 font-medium text-xs text-gray-500">
                          Date : {formattedDate}
                        </p>
                      </div>
                      <div className="border-0 flex flex-col col-span-2">
                        <p className="text-left py-1 font-medium text-xs text-gray-500">
                          Start Date & End Date
                        </p>
                        <p className="text-left font-bold font-semibold text-sm text-black">
                          {formatDate(data?.project_start_date)} to{" "}
                          {formatDate(data?.project_end_date)}
                        </p>
                      </div>
                      <div className="border-0 flex flex-col col-span-2">
                        <p className="text-left py-1 font-medium text-xs text-gray-500">
                          Work Package
                        </p>
                        <p className="text-left font-bold font-semibold text-sm text-black">
                          {data &&
                            JSON.parse(data?.project_work_packages!)
                              .work_packages.map(
                                (item) => item.work_package_name
                              )
                              .join(", ")}
                        </p>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50"
                  >
                    Work Package
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50"
                  >
                    Scope of Work
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50"
                  >
                    Milestone
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50"
                  >
                    Start Date
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50"
                  >
                    End Date
                  </th>
                  {areaNames?.map((area) => (
                    <th
                      scope="col"
                      className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50"
                    >
                      {area}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {mile_data?.map((item) => {
                  return (
                    <tr className="">
                      <td className="px-6 py-2 text-sm whitespace-normal border border-gray-100">
                        {item.work_package}
                      </td>
                      <td className="px-2 py-2 text-sm whitespace-normal border border-gray-100">
                        {item.scope_of_work}
                      </td>
                      <td className="px-2 py-2 text-sm whitespace-normal border border-gray-100">
                        {item.milestone}
                      </td>
                      <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">
                        {formatDate(item.start_date)}
                      </td>
                      <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">
                        {formatDate(item.end_date)}
                      </td>
                      {item.status_list?.list.map((area) => (
                        <td
                          className={`px-2 py-2 text-sm whitespace-normal border border-gray-100 ${area.status === "WIP"
                              ? "text-yellow-500"
                              : area.status === "Completed"
                                ? "text-green-800"
                                : area.status === "Halted"
                                  ? "text-red-500"
                                  : ""
                            }`}
                        >
                          {area.status && area.status !== "Pending"
                            ? area.status
                            : "--"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div ref={componentRef2} className="px-4 pb-1">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="w-full">
                <tr>
                  <th colSpan={5} className="p-0">
                    <div className="mt-1 flex justify-between">
                      <div>
                        <img src={logo} alt="Nirmaan" width="180" height="52" />
                        <div className="pt-1 text-lg text-gray-500 font-semibold">
                          Nirmaan(Stratos Infra Technologies Pvt. Ltd.)
                        </div>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr>
                  <th colSpan={5} className="p-0">
                    <div className="py-1 border-b-2 border-gray-600 pb-2 mb-1">
                      <div className="flex justify-between">
                        <div className="text-xs text-gray-500 font-normal">
                          1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR
                          Layout, Bengaluru - 560102, Karnataka
                        </div>
                        <div className="text-xs text-gray-500 font-normal">
                          GST: 29ABFCS9095N1Z9
                        </div>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr>
                  <th colSpan={5} className="p-0">
                    <div className="grid grid-cols-6 gap-4 justify-between border border-gray-100 rounded-lg px-3 py-1 mb-1">
                      <div className="border-0 flex flex-col col-span-2">
                        <p className="text-left py-1 font-medium text-xs text-gray-500">
                          Name and address
                        </p>
                        <p className="text-left font-bold font-semibold text-sm text-black">
                          {data?.project_name}
                        </p>
                      </div>
                      <div className="border-0 flex flex-col col-span-2">
                        <p className="text-left py-1 font-medium text-xs text-gray-500">
                          Start Date & End Date
                        </p>
                        <p className="text-left font-bold font-semibold text-sm text-black">
                          {formatDate(data?.project_start_date)} to{" "}
                          {formatDate(data?.project_end_date)}
                        </p>
                      </div>
                      <div className="border-0 flex flex-col col-span-2">
                        <p className="text-left py-1 font-medium text-xs text-gray-500">
                          Work Package
                        </p>
                        <p className="text-left font-bold font-semibold text-sm text-black">
                          {data &&
                            JSON.parse(data?.project_work_packages!)
                              .work_packages.map(
                                (item) => item.work_package_name
                              )
                              .join(", ")}
                        </p>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50"
                  >
                    Work Package
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50"
                  >
                    Scope of Work
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50"
                  >
                    Milestone
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50"
                  >
                    Start Date
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50"
                  >
                    End Date
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {mile_data?.map((item) => {
                  return (
                    <tr className="">
                      <td className="px-6 py-2 text-sm whitespace-normal border border-gray-100">
                        {item.work_package}
                      </td>
                      <td className="px-2 py-2 text-sm whitespace-normal border border-gray-100">
                        {item.scope_of_work}
                      </td>
                      <td className="px-2 py-2 text-sm whitespace-normal border border-gray-100">
                        {item.milestone}
                      </td>
                      <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">
                        {formatDate(item.start_date)}
                      </td>
                      <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">
                        {formatDate(item.end_date)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div ref={componentRef3} className="px-4 pb-1">
          <div className="overflow-x-auto">
            <table className="w-full my-4">
              <thead className="w-full">
                <tr>
                  <th colSpan={6 + areaNames?.length} className="p-0">
                    <div className="mt-1 flex justify-between">
                      <div>
                        <img src={logo} alt="Nirmaan" width="180" height="52" />
                        <div className="pt-1 text-lg text-gray-500 font-semibold">
                          Nirmaan(Stratos Infra Technologies Pvt. Ltd.)
                        </div>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr>
                  <th colSpan={6 + areaNames?.length} className="p-0">
                    <div className="py-1 border-b-2 border-gray-600 pb-2 mb-1">
                      <div className="flex justify-between">
                        <div className="text-xs text-gray-500 font-normal">
                          1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR
                          Layout, Bengaluru - 560102, Karnataka
                        </div>
                        <div className="text-xs text-gray-500 font-normal">
                          GST: 29ABFCS9095N1Z9
                        </div>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr>
                  <th colSpan={6 + areaNames?.length} className="p-0">
                    <div className="grid grid-cols-6 gap-4 justify-between border border-gray-100 rounded-lg px-3 py-1 mb-1">
                      <div className="border-0 flex flex-col col-span-2">
                        <p className="text-left py-1 font-medium text-xs text-gray-500">
                          Name and address
                        </p>
                        <p className="text-left font-bold font-semibold text-sm text-black">
                          {data?.project_name}
                        </p>
                        <p className="text-left py-1 font-medium text-xs text-gray-500">
                          Date : {formattedDate}
                        </p>
                      </div>
                      <div className="border-0 flex flex-col col-span-2">
                        <p className="text-left py-1 font-medium text-xs text-gray-500">
                          Start Date & End Date
                        </p>
                        <p className="text-left font-bold font-semibold text-sm text-black">
                          {formatDate(data?.project_start_date)} to{" "}
                          {formatDate(data?.project_end_date)}
                        </p>
                      </div>
                      <div className="border-0 flex flex-col col-span-2">
                        <p className="text-left py-1 font-medium text-xs text-gray-500">
                          Work Package
                        </p>
                        <p className="text-left font-bold font-semibold text-sm text-black">
                          {data &&
                            JSON.parse(data?.project_work_packages!)
                              .work_packages.map(
                                (item) => item.work_package_name
                              )
                              .join(", ")}
                        </p>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50"
                  >
                    Work Package
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50"
                  >
                    Scope of Work
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50"
                  >
                    Milestone
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50"
                  >
                    Start Date
                  </th>
                  <th
                    scope="col"
                    className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50"
                  >
                    End Date
                  </th>
                  {areaNames?.map((area) => (
                    <th
                      scope="col"
                      className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50"
                    >
                      {area}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {mile_data?.filter((item) => {
                  const today = new Date().toISOString().split("T")[0];
                  const modifiedDate = new Date(item.modified)
                    .toISOString()
                    .split("T")[0];
                  const equal = item.modified !== item.creation;
                  return modifiedDate === today && equal;
                }).length > 0 ? (
                  mile_data.map((item, index) => {
                    const today = new Date().toISOString().split("T")[0];
                    const modifiedDate = new Date(item.modified)
                      .toISOString()
                      .split("T")[0];
                    if (modifiedDate === today) {
                      return (
                        <tr key={index}>
                          <td className="px-6 py-2 text-sm whitespace-normal border border-gray-100">
                            {item.work_package}
                          </td>
                          <td className="px-2 py-2 text-sm whitespace-normal border border-gray-100">
                            {item.scope_of_work}
                          </td>
                          <td className="px-2 py-2 text-sm whitespace-normal border border-gray-100">
                            {item.milestone}
                          </td>
                          <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">
                            {formatDate(item.start_date)}
                          </td>
                          <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">
                            {formatDate(item.end_date)}
                          </td>
                          {item.status_list?.list.map((area, areaIndex) => (
                            <td
                              key={areaIndex}
                              className={`px-2 py-2 text-sm whitespace-normal border border-gray-100 ${area.status === "WIP"
                                  ? "text-yellow-500"
                                  : area.status === "Completed"
                                    ? "text-green-800"
                                    : area.status === "Halted"
                                      ? "text-red-500"
                                      : ""
                                }`}
                            >
                              {area.status && area.status !== "Pending"
                                ? area.status
                                : "--"}
                            </td>
                          ))}
                        </tr>
                      );
                    }
                    return null;
                  })
                ) : (
                  <tr>
                    <td colSpan="6" className="text-center py-4">
                      No milestones updated for today yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div> */}
    </div>
  );
};