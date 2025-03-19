import logo from "@/assets/logo-svg.svg";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ItemsHoverCard } from "@/components/helpers/ItemsHoverCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig
} from "@/components/ui/chart";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  OverviewSkeleton2,
  TableSkeleton
} from "@/components/ui/skeleton";
import StatusBar from "@/components/ui/status-bar";
import { toast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { ApprovedQuotations } from "@/types/NirmaanStack/ApprovedQuotations";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";
import { ProcurementOrder as ProcurementOrdersType } from "@/types/NirmaanStack/ProcurementOrders";
import { ProcurementItem, ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import getThreeMonthsLowestFiltered from "@/utils/getThreeMonthsLowest";
import { parseNumber } from "@/utils/parseNumber";
import { ColumnDef } from "@tanstack/react-table";
import {
  ConfigProvider,
  Menu,
  MenuProps,
  Radio
} from "antd";
import {
  useFrappeCreateDoc,
  useFrappeGetCall,
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappeUpdateDoc,
} from "frappe-react-sdk";
import {
  ArrowDown,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsUpDown,
  CircleCheckBig,
  CirclePlus,
  FilePenLine,
  HardHat,
  ListChecks,
  OctagonMinus
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { v4 as uuidv4 } from "uuid";
import { Component as ProjectEstimates } from '../../components/add-project-estimates';
import { AllTab } from "./AllTab";
import { CategoryAccordion } from "./CategoryAccordion";
import { CustomHoverCard } from "./CustomHoverCard";
import { EditProjectForm } from "./edit-project-form";
import { ProjectMakesTab } from "./ProjectMakesTab";
import { ServiceRequestsAccordion } from "./ServiceRequestsAccordion";

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

interface po_item_data_item {
  po_number: string
  vendor_id: string
  vendor_name: string
  creation: string
  item_id : string
  quote : number
  quantity : number
  category: string
  tax: number
  unit: string
  item_name: string
  work_package: string
}

const Project : React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();

  const {
    data,
    isLoading,
    mutate: project_mutate,
  } = useFrappeGetDoc("Projects", projectId);

  const { data: projectCustomer, isLoading: projectCustomerLoading } =
    useFrappeGetDoc("Customers", data?.customer, `Customers ${data?.customer}`);

  const { data: po_item_data, isLoading: po_item_loading } = useFrappeGetCall<{ message : { po_items : po_item_data_item[] }}>(
    "nirmaan_stack.api.procurement_orders.generate_po_summary",
    { project_id: projectId }
  );

  if(isLoading || projectCustomerLoading || po_item_loading) {
    return <div className="flex items-center h-[90vh] w-full justify-center">
            <TailSpin color={"red"} />{" "}
          </div>
  }

  return (
        data && (
        <ProjectView
          projectId={projectId}
          data={data}
          project_mutate={project_mutate}
          projectCustomer={projectCustomer}
          po_item_data={po_item_data?.message?.po_items}
        />
      )
  );
};

interface ProjectViewProps {
  projectId: string | undefined;
  data: any;
  project_mutate: any;
  projectCustomer: any;
  po_item_data?: po_item_data_item[];
}

export const Component = Project;

const chartConfig = {
  visitors: {
    label: "Visitors",
  },
  category1: {
    label: "Category 1",
    color: "hsl(var(--chart-1))",
  },
  category2: {
    label: "Category 2",
    color: "hsl(var(--chart-2))",
  },
  category3: {
    label: "Category 3",
    color: "hsl(var(--chart-3))",
  },
} satisfies ChartConfig;

const ProjectView = ({
  projectId,
  data,
  project_mutate,
  projectCustomer,
  po_item_data,
}: ProjectViewProps) => {
  // const location = useLocation();
  // const searchParams = new URLSearchParams(location.search);
  // const page = searchParams.get("page");

  // const tab = searchParams.get("tab");
  const { role } = useUserData();
  const navigate = useNavigate();
  const [selectedUser, setSelectedUser] = useState(null);
  const [userOptions, setUserOptions] = useState<{ label: JSX.Element; value: string }[]>([]);

  const [newStatus, setNewStatus] = useState<string>("");
  const [showStatusChangeDialog, setShowStatusChangeDialog] = useState(false);

  const { createDoc, loading: createDocLoading } = useFrappeCreateDoc();
  const { updateDoc, loading: updateDocLoading } = useFrappeUpdateDoc();
  const [statusCounts, setStatusCounts] = useState<{ [key: string]: number }>({ "New PR": 0, "Open PR": 0, "Approved PO": 0 });
  const [editSheetOpen, setEditSheetOpen] = useState(false);

  const [options, setOptions] = useState<{ label: string; value: string }[]>([]);

  const [makeOptions, setMakeOptions] = useState<{ label: string; value: string }[]>([]);

  const toggleEditSheet = () => {
    setEditSheetOpen((prevState) => !prevState);
  };

  const [searchParams] = useSearchParams(); // Only for initialization
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "All");
  const [activePage, setActivePage] = useState(searchParams.get("page") || "overview");
  const [makesTab, setMakesTab] = useState(searchParams.get("makesTab") || makeOptions?.[0]?.value);

  const updateURL = (params: Record<string, string>, removeParams: string[] = []) => {
    const url = new URL(window.location.href);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    removeParams.forEach((key) => {
      url.searchParams.delete(key);
    });
    window.history.pushState({}, '', url);
  };

  const setProjectSpendsTab = (tab: string) => {
      if (activeTab !== tab) {
        setActiveTab(tab);
        updateURL({ tab });
      }
    }

  const setProjectMakesTab = (tab: string) => {
      if (makesTab !== tab) {
        setMakesTab(tab);
        updateURL({ makesTab: tab });
      }
    }

  const onClick: MenuProps['onClick'] = (e) => {
      if (activePage === e.key) return;

      const newPage = e.key;

      if (newPage === 'projectspends') {
        setActiveTab('All');
        updateURL({ page: newPage, tab: 'All' }, ['eTab', 'makesTab']);
      } else if (newPage === 'projectmakes') {
        setMakesTab(makeOptions?.[0]?.value || '');
        updateURL({ page: newPage, makesTab: makeOptions?.[0]?.value || '' }, ['eTab', 'tab']);
      } else if (newPage === 'projectestimates'){
        updateURL({page: newPage, eTab: 'All'}, ['tab', 'makesTab'])
      } else {
        setActiveTab('');
        setMakesTab('');
        updateURL({ page: newPage }, ['tab', 'eTab', 'makesTab']);
      }
      setActivePage(newPage);
    }


  const { data: mile_data, isLoading: mile_isloading } = useFrappeGetDocList(
    "Project Work Milestones",
    {
      fields: ["*"],
      filters: [["project", "=", projectId]],
      limit: 1000,
      orderBy: { field: "start_date", order: "asc" },
    },
    `Project Work MileStones ${projectId}`,
    {
      revalidateIfStale: false,
    }
  );

  const {data: projectType} = useFrappeGetDoc("Project Types", data?.project_type)

  const {
    data: project_estimates,
    isLoading: project_estimates_loading,
    error: project_estimates_error,
  } = useFrappeGetDocList("Project Estimates", {
    fields: ["*"],
    filters: [["project", "=", projectId]],
    limit: 10000,
  });

  const {
    data: projectAssignees,
    isLoading: projectAssigneesLoading,
    mutate: projectAssigneesMutate,
  } = useFrappeGetDocList(
    "Nirmaan User Permissions",
    {
      fields: ["*"],
      limit: 1000,
      filters: [
        ["for_value", "=", `${projectId}`],
        ["allow", "=", "Projects"],
      ],
    },
    `User Permission, filters(for_value),=,${projectId}`
  );

  const { data: projectPayments, isLoading: projectPaymentsLoading, error: projectPaymentsError } = useFrappeGetDocList<ProjectPayments>("Project Payments", {
    fields: ["*"],
    filters : [['project', '=', projectId], ['status', '=', 'Paid']],
    limit: 1000
  })

  const {
    data: usersList,
    isLoading: usersListLoading,
    mutate: usersListMutate,
  } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
    fields: ["*"],
    limit: 1000,
  });

  const { data: pr_data, isLoading: prData_loading } = useFrappeGetDocList<ProcurementRequest>(
    "Procurement Requests",
    {
      fields: ["*"],
      filters: [["project", "=", `${projectId}`]],
      limit: 1000,
    },
    `Procurement Requests ${projectId}`
  );

  const { data: po_data, isLoading: po_loading } = useFrappeGetDocList<ProcurementOrdersType>(
    "Procurement Orders",
    {
      fields: ["*"],
      filters: [
        ["project", "=", projectId],
        ["status", "!=", "Merged"],
      ], // removed ["status", "!=", "PO Approved"] for now
      limit: 1000,
      orderBy: { field: "creation", order: "desc" },
    }
  );

  const {
    data: po_data_for_posummary,
    isLoading: po_data_for_posummary_loading,
  } = useFrappeGetDocList<ProcurementOrdersType>("Procurement Orders", {
    fields: ["*"],
    filters: [
      ["project", "=", projectId],
      ["status", "!=", "Merged"],
    ], // removed ["status", "!=", "PO Approved"] for now
    limit: 1000,
    orderBy: { field: "creation", order: "desc" },
  });

  const {
    data: allServiceRequestsData,
    isLoading: allServiceRequestsDataLoading,
  } = useFrappeGetDocList<ServiceRequests>("Service Requests", {
    fields: ["*"],
    filters: [["project", "=", projectId]],
    limit: 1000,
  });

  const { data: approvedServiceRequestsData, isLoading: approvedServiceRequestsDataLoading } =
    useFrappeGetDocList<ServiceRequests>("Service Requests", {
      fields: ["*"],
      filters: [
        ["status", "=", "Approved"],
        ["project", "=", projectId],
      ],
      limit: 1000,
    });

  const {
    data: vendorsList,
    isLoading: vendorsListLoading,
    error: vendorsError,
  } = useFrappeGetDocList<Vendors>("Vendors", {
    fields: ["vendor_name", "vendor_type"],
    filters: [["vendor_type", "in", ["Material", "Material & Service"]]],
    limit: 10000,
  });

  const vendorOptions = useMemo(() => vendorsList?.map((ven) => ({
    label: ven.vendor_name,
    value: ven.vendor_name,
  })), [vendorsList]);

  const getTotalAmountPaid = useMemo(() => {
    if (!projectPayments) {
      return { poAmount: 0, srAmount: 0, totalAmount: 0 };
    }

    const poAmount = projectPayments
      .filter((i) => i?.document_type === "Procurement Orders")
      .reduce((acc, payment) => acc + parseNumber(payment.amount), 0);

    const srAmount = projectPayments
      .filter((i) => i?.document_type === "Service Requests")
      .reduce((acc, payment) => acc + parseNumber(payment.amount), 0);

    return { poAmount, srAmount, totalAmount: poAmount + srAmount };
  }, [projectPayments]);

  const getUserFullName = (id : string | undefined) => {
    return useMemo(() => {
      if (id === "Administrator") return id;
      return usersList?.find((user) => user?.name === id)?.full_name || "";
    }, [id, usersList]);
  }

  useEffect(() => {
    if (usersList && projectAssignees) {
      const options =
        usersList
          ?.filter(
            (user) =>
              !projectAssignees?.some((i) => i?.user === user?.name) &&
              !["Nirmaan Admin Profile", "Nirmaan Estimates Executive Profile"].includes(user?.role_profile)
          )
          ?.map((op) => ({
            label: (
              <div>
                {op?.full_name}
                <span className="text-red-700 font-light">
                  ({op?.role_profile?.split(" ").slice(1, 3).join(" ")})
                </span>
              </div>
            ),
            value: op?.name,
          })) || [];
      setUserOptions(options);
    }
  }, [usersList, projectAssignees]);

  // console.log("poData", po_data)

  const totalPosRaised = useMemo(() => {
    if (!po_data || po_data.length === 0) {
      return 0;
    }

    return po_data.reduce((acc, po) => {
      if (po.order_list && po.order_list.list && po.order_list.list.length > 0) {
        return acc + po.order_list.list.reduce((itemAcc, item) => itemAcc + parseNumber(item.quote * item.quantity), 0);
      }
      return acc;
    }, 0);
  }, [po_data]);

  // Accordion state
  const [expandedRoles, setExpandedRoles] = useState<{ [key: string]: boolean }>({});

  // Grouping functionality
  const groupedAssignees : {[key: string]: string[]} = useMemo(() => {
    if (!projectAssignees || !usersList) return {};

    const filteredAssignees = projectAssignees.filter((assignee) =>
      usersList.some((user) => user.name === assignee.user)
    );

    return filteredAssignees.reduce((acc, assignee) => {
      const user = usersList.find((user) => user.name === assignee.user);
      if (user) {
        const { role_profile, full_name } = user;

        const formattedRoleProfile = role_profile?.replace(/Nirmaan\s|\sProfile/g, "") || "";

        if (!acc[formattedRoleProfile]) acc[formattedRoleProfile] = [];
        acc[formattedRoleProfile].push(full_name);
      }

      return acc;
    }, {});
  }, [projectAssignees, usersList]);

  useEffect(() => {
    setExpandedRoles(Object.keys(groupedAssignees).reduce(
      (acc : Record<string, boolean>, roleProfile) => {
        acc[roleProfile] = true;
        return acc;
      },
      {}));
  }, [groupedAssignees]);

  const toggleExpand = useCallback((roleProfile: string) => {
    setExpandedRoles((prev) => ({ ...prev, [roleProfile]: !prev[roleProfile] }));
  }, []);


  // type ScopesMilestones = {
  //   work_package: string;
  //   scope_of_work: string;
  //   milestone: string;
  //   start_date: string;
  //   end_date: string;
  //   status_list: {
  //     list: {
  //       name: string;
  //       status: string;
  //     }[];
  //   };
  // };

  type MenuItem = Required<MenuProps>["items"][number];

  const items: MenuItem[] = [
    {
      label: "Overview",
      key: "overview",
    },
    // role === "Nirmaan Admin Profile"
    //   ? {
    //     label: "Project Tracking",
    //     key: "projectTracking",
    //   }
    //   : null,
    {
      label: "PR Summary",
      key: "prsummary",
    },
    {
      label: "SR Summary",
      key: "SRSummary",
    },
    {
      label: "PO Summary",
      key: "posummary",
    },
    ["Nirmaan Admin Profile", "Nirmaan Estimates Executive Profile"].includes(
      role
    )
      ? {
        label: "Project Spends",
        key: "projectspends",
      }
      : null,
    {
      label: "Project Estimates",
      key: "projectestimates"
    },
    {
      label: "Project Makes",
      key: "projectmakes"
    }
  ];

  const [areaNames, setAreaNames] = useState(null);

  // const getStatusListColumns = (mile_data: ScopesMilestones[]) => {
  //   const statusNames = Array.from(
  //     new Set(
  //       mile_data.flatMap((row) =>
  //         row.status_list.list.map((statusObj) => statusObj.name)
  //       )
  //     )
  //   );
  //   setAreaNames(statusNames);

  //   return statusNames.map((statusName) => ({
  //     accessorKey: `status_${statusName}`,
  //     header: ({ column }) => {
  //       return (
  //         <DataTableColumnHeader
  //           className="text-black font-bold"
  //           column={column}
  //           title={statusName}
  //         />
  //       );
  //     },
  //     cell: ({ row }) => {
  //       const statusObj = row.original.status_list.list.find(
  //         (statusObj) => statusObj.name === statusName
  //       );
  //       return (
  //         <div
  //           className={`text-[#11050599] ${statusObj?.status === "WIP" && "text-yellow-500"
  //             } ${statusObj?.status === "Halted" && "text-red-500"} ${statusObj?.status === "Completed" && "text-green-800"
  //             }`}
  //         >
  //           {statusObj?.status && statusObj.status !== "Pending"
  //             ? statusObj?.status
  //             : "--"}
  //         </div>
  //       );
  //     },
  //   }));
  // };

  // const columns: ColumnDef<ScopesMilestones>[] = useMemo(() => {
  //   const staticColumns: ColumnDef<ScopesMilestones>[] = [
  //     {
  //       accessorKey: "work_package",
  //       header: ({ column }) => {
  //         return (
  //           <DataTableColumnHeader
  //             className="text-black font-bold"
  //             column={column}
  //             title="Work Package"
  //           />
  //         );
  //       },
  //       cell: ({ row }) => {
  //         return (
  //           <div className="text-[#11050599]">
  //             {row.getValue("work_package")}
  //           </div>
  //         );
  //       },
  //     },
  //     {
  //       accessorKey: "scope_of_work",
  //       header: ({ column }) => {
  //         return (
  //           <DataTableColumnHeader
  //             className="text-black font-bold"
  //             column={column}
  //             title="Scope of Work"
  //           />
  //         );
  //       },
  //       cell: ({ row }) => {
  //         return (
  //           <div className="text-[#11050599]">
  //             {row.getValue("scope_of_work")}
  //           </div>
  //         );
  //       },
  //     },
  //     {
  //       accessorKey: "milestone",
  //       header: ({ column }) => {
  //         return (
  //           <DataTableColumnHeader
  //             className="text-black font-bold"
  //             column={column}
  //             title="Milestone"
  //           />
  //         );
  //       },
  //       cell: ({ row }) => {
  //         return (
  //           <div className="text-[#11050599]">{row.getValue("milestone")}</div>
  //         );
  //       },
  //     },
  //     {
  //       accessorKey: "start_date",
  //       header: ({ column }) => {
  //         return (
  //           <DataTableColumnHeader
  //             className="text-black font-bold"
  //             column={column}
  //             title="Start Date"
  //           />
  //         );
  //       },
  //       cell: ({ row }) => {
  //         return (
  //           <div className="text-[#11050599]">
  //             {formatDate(row.getValue("start_date"))}
  //           </div>
  //         );
  //       },
  //     },
  //     {
  //       accessorKey: "end_date",
  //       header: ({ column }) => {
  //         return (
  //           <DataTableColumnHeader
  //             className="text-black font-bold"
  //             column={column}
  //             title="End Date"
  //           />
  //         );
  //       },
  //       cell: ({ row }) => {
  //         return (
  //           <div className="text-[#11050599]">
  //             {formatDate(row.getValue("end_date"))}
  //           </div>
  //         );
  //       },
  //     },
  //   ];

  //   const dynamicColumns = mile_data ? getStatusListColumns(mile_data) : [];
  //   return [...staticColumns, ...dynamicColumns];
  // }, [mile_data]);

  const { data: quote_data } = useFrappeGetDocList<ApprovedQuotations>("Approved Quotations", {
    fields: ["item_id", "quote"],
    limit: 100000,
  });


  const getItemStatus = useMemo(
    () => (item: ProcurementItem, filteredPOs: ProcurementOrdersType[]) => {
      return filteredPOs.some((po) =>
        po?.order_list?.list.some((poItem) => poItem?.name === item.name)
      );
    },
    []
  );

  const statusRender = useMemo(
    () => (status: string, prId: string) => {
      const procurementRequest = pr_data?.find((pr) => pr?.name === prId);
      const itemList = procurementRequest?.procurement_list?.list || [];

      if (['Pending', 'Approved', 'Rejected', 'Draft'].includes(status)) {
        return 'New PR';
      }

      const filteredPOs = po_data?.filter((po) => po?.procurement_request === prId) || [];
      const allItemsApproved = itemList.every(
        (item) => item?.status === 'Deleted' || getItemStatus(item, filteredPOs)
      );

      return allItemsApproved ? 'Approved PO' : 'Open PR';
    },
    [pr_data, po_data, getItemStatus]
  );


  const getTotal = (order_id: string) => {
    return useMemo(() => {
    let total = 0;
    const procurementRequest = pr_data?.find((item) => item.name === order_id);
    const orderData = procurementRequest?.procurement_list;
    const status = statusRender(procurementRequest?.workflow_state || "", order_id);

    if (status === "Approved PO") {
      const filteredPOs = po_data?.filter((po) => po.procurement_request === order_id) || [];
      filteredPOs.forEach((po) => {
        po.order_list?.list.forEach((item) => {
          if (item.quote && item.quantity) {
            total += parseNumber(item.quote * item.quantity);
          }
        });
      });
    } else {
      orderData?.list.forEach((item) => {
        const minQuote = getThreeMonthsLowestFiltered(quote_data, item.name)
        total += parseNumber(minQuote * item.quantity);
      });
    }
    return total || "N/A";
    }, [pr_data, po_data, quote_data, statusRender, order_id]);
  };

  useEffect(() => {
    if (pr_data) {
      const statusCounts = { "New PR": 0, "Open PR": 0, "Approved PO": 0 };
      pr_data?.forEach((pr) => {
        const status = statusRender(pr?.workflow_state, pr?.name);
        statusCounts[status] += 1;
      });
      setStatusCounts(statusCounts);
    }
  }, [pr_data]);

  const statusOptions = useMemo(() => [
    { label: "New PR", value: "New PR" },
    { label: "Open PR", value: "Open PR" },
    { label: "Approved PO", value: "Approved PO" },
  ], []);


  const prSummaryColumns : ColumnDef<ProcurementRequest>[] = useMemo(() => [
    {
      accessorKey: "name",
      header: ({ column }) => {
        return (
          <DataTableColumnHeader
            className="text-black font-bold"
            column={column}
            title="PR Id"
          />
        );
      },
      cell: ({ row }) => {
        const data = row.original
        const name = data?.name
        return (
          <div className="flex items-center gap-1">
          <Link className="text-blue-500 underline" to={row.getValue("name")}>
            <div>{name?.split("-")[2]}</div>
          </Link>
          <ItemsHoverCard order_list={data?.procurement_list.list} />
          </div>
        );
      },
    },
    {
      accessorKey: "creation",
      header: ({ column }) => {
        return (
          <DataTableColumnHeader
            className="text-black font-bold"
            column={column}
            title="Creation"
          />
        );
      },
      cell: ({ row }) => {
        return (
          <div className="text-[#11050599]">
            {formatDate(row.getValue("creation"))}
          </div>
        );
      },
    },
    {
      accessorKey: "owner",
      header: ({ column }) => {
        return (
          <DataTableColumnHeader
            className="text-black font-bold"
            column={column}
            title="Created By"
          />
        );
      },
      cell: ({ row }) => {
        return (
          <div className="text-[#11050599]">
            {getUserFullName(row.getValue("owner"))}
          </div>
        );
      },
    },

    {
      accessorKey: "workflow_state",
      header: ({ column }) => {
        return (
          <DataTableColumnHeader
            className="text-black font-bold"
            column={column}
            title="Status"
          />
        );
      },
      cell: ({ row }) => {
        const data = row.original
        const status = data.workflow_state;
        const prId = data?.name;
        return <div className="font-medium">{statusRender(status, prId)}</div>;
      },
      filterFn: (row, id, value) => {
        const rowValue = row.getValue(id);
        const prId = row.getValue("name");
        const renderValue = statusRender(rowValue, prId);
        return value.includes(renderValue);
      },
    },
    {
      accessorKey: "work_package",
      header: ({ column }) => {
        return (
          <DataTableColumnHeader
            className="text-black font-bold"
            column={column}
            title="Package"
          />
        );
      },
      cell: ({ row }) => {
        return (
          <div className="text-[#11050599]">{row.getValue("work_package")}</div>
        );
      },
    },
    {
      accessorKey: "category_list",
      header: ({ column }) => {
        return (
          <DataTableColumnHeader
            className="text-black font-bold"
            column={column}
            title="Categories"
          />
        );
      },
      cell: ({ row }) => {
        const categories : Set<string> = new Set();
        const categoryList = row.getValue("category_list")?.list || [];
        categoryList?.forEach((i) => {
            categories.add(i?.name || "");
        });

        return (
          <div className="flex flex-col gap-1 items-start justify-center">
            {Array.from(categories)?.map((i) => (
              <Badge className="inline-block">{i}</Badge>
            ))}
          </div>
        );
      },
    },
    {
      id: "estimated_price",
      header: ({ column }) => {
        return (
          <DataTableColumnHeader
            className="text-black font-bold"
            column={column}
            title="Estimated Price"
          />
        );
      },
      cell: ({ row }) => {
        const total = getTotal(row.getValue("name"));
        return (
          <div className="text-[#11050599]">
            {total === "N/A" ? total : formatToIndianRupee(total)}
          </div>
        );
      },
    },
  ], [pr_data, statusOptions]);

  const getSRTotal = (order_id: string) => {
    return useMemo(() => {
    let total: number = 0;
    const orderData = allServiceRequestsData?.find((item) => item.name === order_id)?.service_order_list;
    orderData?.list.forEach((item) => {
      const price = parseNumber(item.rate) * parseNumber(item.quantity);
      total += price;
    });
    return total;
    }, [allServiceRequestsData, order_id]);
  };


  const srSummaryColumns : ColumnDef<ServiceRequests>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="SR Number" />;
        },
        cell: ({ row }) => {
          const data = row.original
          const srId = data?.name;
          return (
            <div className="flex items-center gap-1">
              <Link
              className="text-blue-500 underline"
              to={`/service-requests-list/${srId}`}
            >
              {srId?.slice(-5)}
            </Link>
            <ItemsHoverCard order_list={data?.service_order_list.list} isSR />
            </div>
          );
        },
      },
      {
        accessorKey: "creation",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="Date" />;
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              {formatDate(row.getValue("creation")?.split(" ")[0])}
            </div>
          );
        },
      },
      {
        accessorKey: "status",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="Status" />;
        },
        cell: ({ row }) => {
          return <div className="font-medium">{row.getValue("status")}</div>;
        },
      },
      {
        accessorKey: "service_category_list",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="Categories" />;
        },
        cell: ({ row }) => {
          return (
            <div className="flex flex-col gap-1 items-start justify-center">
              {row.getValue("service_category_list").list.map((obj) => (
                <Badge className="inline-block">{obj["name"]}</Badge>
              ))}
            </div>
          );
        },
      },
      {
        id: "total",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Estimated Price" />
          );
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              {formatToIndianRupee(getSRTotal(row.getValue("name")))}
            </div>
          );
        },
      },
      {
        id: "Amount_paid",
        header: "Amt Paid",
        cell: ({ row }) => {
            const data = row.original
            const amountPaid = getTotalAmountPaidPOWise(data?.name);
            return <div className="font-medium">
                {formatToIndianRupee(amountPaid)}
            </div>
        },
    },
    ],
    [projectId, allServiceRequestsData]
  );

  const getPOTotal = (order_id: string) => {
    return useMemo(() => {
    let total: number = 0;
    let totalWithGST: number = 0;
    const po = po_data_for_posummary?.find((item) => item.name === order_id);
    const loading_charges = parseNumber(po?.loading_charges);
    const freight_charges = parseNumber(po?.freight_charges);
    const orderData = po?.order_list;

    orderData?.list.forEach((item) => {
      const price = parseNumber(item.quote);
      const quantity = parseNumber(item?.quantity) || 1;
      const gst = parseNumber(item?.tax);
      total += price * quantity;
      const gstAmount = (price * gst) / 100;
      totalWithGST += (price + gstAmount) * quantity;
    });

    total += loading_charges + freight_charges;
    totalWithGST += loading_charges * 1.18 + freight_charges * 1.18;

    return { totalWithoutGST: total, totalWithGST: totalWithGST };
    }, [po_data_for_posummary, order_id]);
  }


  const getWorkPackageName = (poId: string) => {
    return useMemo(() => {
    const po = po_data_for_posummary?.find((j) => j?.name === poId);
    return pr_data?.find((i) => i?.name === po?.procurement_request)?.work_package;
    }, [po_data_for_posummary, pr_data, poId]);
  }


  const wpOptions = useMemo(() => {
    try {
      if (data && data.project_work_packages) {
        const workPackages = JSON.parse(data.project_work_packages)?.work_packages;
        return workPackages?.map((wp) => ({ label: wp?.work_package_name, value: wp?.work_package_name })) || [];
      }
      return [];
    } catch (error) {
      console.error("Error parsing project_work_packages:", error);
      return [];
    }
  }, [data]);


  const getTotalAmountPaidPOWise =(id: string) => {
    return useMemo(() => {
    const payments = projectPayments?.filter((payment) => payment.document_name === id);
    return payments?.reduce((acc, payment) => acc + parseNumber(payment.amount), 0);
    }, [projectPayments, id]);
  }


  // console.log("wpOtions", wpOptions)

  const poColumns: ColumnDef<ProcurementOrdersType>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="ID" />;
        },
        cell: ({ row }) => {
          const data = row.original
          const id = data?.name;
          return (
            <div className="font-medium flex items-center gap-2 relative">
              <Link
                className="underline hover:underline-offset-2"
                to={`po/${id.replaceAll("/", "&=")}`}
              >
                {id}
              </Link>
              <ItemsHoverCard order_list={data?.order_list.list} />
            </div>
          );
        },
      },
      {
        accessorKey: "creation",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="Date" />;
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              {formatDate(row.getValue("creation")?.split(" ")[0])}
            </div>
          );
        },
      },
      {
        accessorKey: "name",
        id: "wp",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="Work Package" />;
        },
        cell: ({ row }) => {
          const po = row.getValue("name");
          return <div className="font-medium">{getWorkPackageName(po)}</div>;
        },
        filterFn: (row, id, value) => {
          const rowValue = row.getValue(id);
          // console.log("rowvalue", rowValue)
          // console.log("value", value)
          const renderValue = getWorkPackageName(rowValue);
          // console.log("renderValue", renderValue)
          return value.includes(renderValue);
        },
      },
      {
        accessorKey: "vendor_name",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="Vendor" />;
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">{row.getValue("vendor_name")}</div>
          );
        },
        filterFn: (row, id, value) => {
          return value.includes(row.getValue(id));
        },
      },
      {
        accessorKey: "status",
        header: ({ column }) => {
          return <DataTableColumnHeader column={column} title="Status" />;
        },
        cell: ({ row }) => {
          return (
            <Badge
              variant={
                row.getValue("status") === "PO Approved"
                  ? "default"
                  : row.getValue("status") === "PO Sent"
                    ? "yellow"
                    : row.getValue("status") === "Dispatched"
                      ? "orange"
                      : "green"
              }
            >
              {row.getValue("status") === "Partially Delivered"
                ? "Delivered"
                : row.getValue("status")}
            </Badge>
          );
        },
      },
      {
        id: "totalWithoutGST",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Amt (exc. GST)" />
          );
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              {formatToIndianRupee(
                getPOTotal(row.getValue("name")).totalWithoutGST
              )}
            </div>
          );
        },
      },
      {
        id: "totalWithGST",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Amt (inc. GST)" />
          );
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              {formatToIndianRupee(
                getPOTotal(row.getValue("name")).totalWithGST
              )}
            </div>
          );
        },
      },
      {
        id: "Amount_paid",
        header: "Amt Paid",
        cell: ({ row }) => {
            const data = row.original
            const amountPaid = getTotalAmountPaidPOWise(data?.name);
            return <div className="font-medium">
                {formatToIndianRupee(amountPaid)}
            </div>
        },
      },
      {
        accessorKey: 'order_list',
        header: ({ column }) => {
            return <h1 className="hidden">:</h1>
        },
        cell: ({ row }) => <span className="hidden">hh</span>
      }
    ],
    [projectId, po_data_for_posummary, data, projectPayments]
  );

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

  const handleAssignUserSubmit = async () => {
    try {
      await createDoc("User Permission", {
        user: selectedUser,
        allow: "Projects",
        for_value: projectId,
      });
      await projectAssigneesMutate();
      await usersListMutate();
      document.getElementById("assignUserDialogClose")?.click();
      toast({
        title: "Success!",
        description: `Successfully assigned ${getUserFullName(selectedUser)}.`,
        variant: "success",
      });
    } catch (error) {
      console.log("error", error);
      toast({
        title: "Failed!",
        description: `Failed to assign ${getUserFullName(selectedUser)}.`,
        variant: "destructive",
      });
    } finally {
      setSelectedUser(null);
    }
  };

  const groupItemsByWorkPackageAndCategory = useMemo(() => (items : po_item_data_item[] | undefined) => {
    const totals: { [key: string]: { amountWithTax: number; amountWithoutTax: number } } = {};

    const allItemIds : string[] = [];

    const groupedData = items?.reduce((acc : { [workPackage: string]: { [category: string]: any[] } }, item : po_item_data_item) => {
      const baseAmount = parseNumber(item.quote * item.quantity);
      const taxAmount = baseAmount * (parseNumber(item.tax) / 100);
      const amountPlusTax = baseAmount + taxAmount;

      if (totals[item.work_package]) {
        const { amountWithTax, amountWithoutTax } = totals[item.work_package];
        totals[item.work_package] = {
          amountWithTax: amountPlusTax + amountWithTax,
          amountWithoutTax: amountWithoutTax + baseAmount,
        };
      } else {
        totals[item.work_package] = {
          amountWithTax: amountPlusTax,
          amountWithoutTax: baseAmount,
        };
        // totals[item.work_package] = amountWithTax;
      }

      if (!acc[item.work_package]) acc[item.work_package] = {};
      if (!acc[item.work_package][item.category]) {
        acc[item.work_package][item.category] = [];
      }

      const existingItem = acc[item.work_package][item.category].find(
        (i) => i.item_id === item.item_id
      );

      if (existingItem) {
        existingItem.quantity =
          existingItem.quantity + item.quantity;
        existingItem.amount += baseAmount;
        existingItem.amountWithTax += amountPlusTax;
        existingItem.averageRate = Math.floor(
          (existingItem.averageRate + item.quote) / 2
        );
        existingItem.po_number = `${existingItem.po_number},${item.po_number}`;
      } else {
        allItemIds.push(item.item_id)
        acc[item.work_package][item.category].push({
          ...item,
          amount: baseAmount,
          amountWithTax: amountPlusTax,
          averageRate: item.quote,
        });
      }
      return acc;
    }, {}) || {};

    const filteredProjectEstimates = project_estimates?.filter((i) => i?.work_package !== "Services" && !allItemIds.includes(i?.item))

    filteredProjectEstimates?.forEach((item) => {
      if (!groupedData[item?.work_package]) {
        groupedData[item?.work_package] = {};
      }
      if (!groupedData[item?.work_package][item?.category]) {
        groupedData[item?.work_package][item?.category] = [];
      }

      groupedData[item.work_package][item.category].push({
        item_id: item.item,
        item_name: item.item_name,
        unit: item?.uom,
        amount: undefined,
        amountWithTax: undefined,
        averageRate: undefined,
        category: item.category,
        creation: item.creation,
        po_number: undefined,
        quantity: undefined,
        quote: undefined,
        tax: parseNumber(item?.item_tax),
        vendor_id: undefined,
        vendor_name: undefined,
        work_package: item.work_package,
      });
    })

    return { groupedData, totals };
    }, [project_estimates, items]);

  useEffect(() => {
    if (!po_item_data || !project_estimates) return;

    const { totals } = groupItemsByWorkPackageAndCategory(po_item_data);

    const totalAmountPaidWPWise : { [key: string]: number } = {}

    const filteredPOPayments = projectPayments?.filter(i => i.document_type === "Procurement Orders")

    filteredPOPayments?.forEach(i => {
      const po = po_data?.find(j => j?.name === i?.document_name)
      const workPackage = pr_data?.find(j => j?.name === po?.procurement_request)?.work_package || ""
      if (!totalAmountPaidWPWise[workPackage]) totalAmountPaidWPWise[workPackage] = 0
      totalAmountPaidWPWise[workPackage] += parseNumber(i?.amount)
    })

    Object.keys(totals)?.forEach((key) => {
      const estimates =
        project_estimates?.filter((i) => i?.work_package === key) || [];
      const totalEstimatedAmount = estimates?.reduce(
        (acc, i) =>
          acc +
          parseNumber(i?.quantity_estimate) *
          parseNumber(i?.rate_estimate),
        0
      );
      totals[key].total_estimated_amount = totalEstimatedAmount || 0;
      totals[key].total_amount_paid = totalAmountPaidWPWise[key] || 0
    });
    setWorkPackageTotalAmounts(totals);
  }, [po_item_data, project_estimates, po_data, projectPayments, pr_data]);

  const { groupedData: categorizedData } =
    groupItemsByWorkPackageAndCategory(po_item_data);

  // console.log("categorizedData", categorizedData)

  // console.log("workPackageTotals", workPackageTotalAmounts)

  // console.log("groupeddata", categorizedData)

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

  const setPopOverStatus = () => {
    setPopOverOpen((prevState) => !prevState);
  };

  // const workPackages = JSON.parse(data?.project_work_packages)?.work_packages || [];

  // workPackages.push({work_package_name : "Tool & Equipments"})

  useEffect(() => {
    if (data) {
      const workPackages =
        JSON.parse(data?.project_work_packages)?.work_packages || [];
        const options = [
          { label: "All", value: "All" },
          ...workPackages.map((wp) => ({ label: wp?.work_package_name, value: wp?.work_package_name })),
          { label: "Tool & Equipments", value: "Tool & Equipments" },
          { label: "Services", value: "Services" },
        ].sort((a, b) => {
          if (a.label === "All") return -1;
          if (b.label === "All") return 1;
          return a.label.localeCompare(b.label);
        });
  

      setMakeOptions(options?.filter(i => !["All", "Tool & Equipments", "Services"].includes(i.label)));

      setOptions(options);
      // setSelectedPackage("All");
    }
  }, [data]);

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

  const segregateServiceOrderData = (serviceRequestsData : ServiceRequests[] | undefined) => {
    return useMemo(() => {
    const result : { [category: string]: { key: string; unit: string; quantity: number; amount: number; children: any[]; estimate_total: number } }[] = [];
    const servicesEstimates = project_estimates?.filter(
      (p) => p?.work_package === "Services"
    );

    serviceRequestsData?.forEach((serviceRequest) => {
      serviceRequest.service_order_list.list?.forEach((item) => {
        const { category, uom, quantity, rate } = item;
        const amount = (parseNumber(quantity) || 1) * parseNumber(rate);

        const existingCategory = result.find((entry) => entry[category]);

        const estimateItem = servicesEstimates?.filter(
          (i) => i?.category === category
        );

        const estimate_total = estimateItem?.reduce(
          (acc, i) => acc + parseNumber(i?.quantity_estimate * i?.rate_estimate),
          0
        );

        if (existingCategory) {
          existingCategory[category].quantity += parseNumber(quantity);
          existingCategory[category].amount += amount;
          existingCategory[category].children.push({ ...item, amount: amount });
        } else {
          result.push({
            [category]: {
              key: uuidv4(),
              unit: uom,
              quantity: parseNumber(quantity),
              amount: amount,
              children: [{ ...item, amount: amount }],
              estimate_total: estimate_total,
            },
          });
        }
      });
    });

    return result;
    }, [project_estimates, serviceRequestsData]);
  }

  const segregatedServiceOrderData = segregateServiceOrderData(approvedServiceRequestsData)

  const totalServiceOrdersAmt = useMemo(
    () =>
      segregatedServiceOrderData?.reduce((acc, item) => {
        const category = Object.keys(item)[0];
        const { amount } = item[category];
        return acc + parseNumber(amount);
      }, 0),
    [segregatedServiceOrderData, approvedServiceRequestsData]
  );

  const getAllSRsTotal = useMemo(() => {
    const totalAmount = approvedServiceRequestsData?.reduce((total, item) => {
      const gst = item?.gst === "true" ? 1.18 : 1;
      const amount = item?.service_order_list?.list?.reduce((srTotal, i) => {
        const srAmount = parseNumber(i.rate) * parseNumber(i.quantity) * gst;
        return srTotal + srAmount;
      }, 0)
      return total + amount;
    }, 0);

    return totalAmount;

  }, [approvedServiceRequestsData])

  // console.log("seggregatedService", segregatedServiceOrderData);

  // console.log("totalServiceOrdersAmt", totalServiceOrdersAmt)

  // console.log("service requests", serviceRequestsData)

  // console.log("segregatedServicedata", segregatedServiceOrderData);

  // console.log("new status", newStatus)

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

  // console.log("options", options)

  // console.log("selectedPackage", selectedPackage)

  // console.log("categorizedData", categorizedData);

  // console.log("projectEstimates", project_estimates);

  // console.log("workPackageTotalAmounts", workPackageTotalAmounts);

  // console.log("totalServiceOrdersAmt", totalServiceOrdersAmt);

  // console.log("activePage", activePage)

  // console.log("activeTab", activeTab)

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
                    <AlertDialogCancel onClick={handleCancelStatus}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction onClick={handleConfirmStatus}>
                      Continue
                    </AlertDialogAction>
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
                {formatToIndianRupee(project_estimates?.reduce((acc, i) => {
                  const amount = parseNumber(i?.quantity_estimate * i?.rate_estimate);
                  return acc + amount;
                }, 0))}
              </span>
            </div>
            <div>
              <span className="whitespace-nowrap">Total Amt Paid: </span>
              <span className="max-sm:text-end max-sm:w-full text-primary">
                {formatToIndianRupee(getTotalAmountPaid.totalAmount)}
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="flex justify-between items-center">
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
              onClick={onClick}
              mode="horizontal"
              items={items}
            />
          </ConfigProvider>
        </div>
      </div>

      {/* Overview Section */}

      {usersListLoading || projectAssigneesLoading ? (
        <OverviewSkeleton2 />
      ) : (
        activePage === "overview" && (
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>
                  <div className="flex justify-between items-center">
                    {/* {data?.project_name} */}
                    <div />
                    <Button onClick={() => navigate("add-estimates")}>
                      <CirclePlus className="h-4 w-4 mr-2" /> Add Project
                      Estimates
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-10 w-full">
                <div className="flex max-lg:flex-col max-lg:gap-10">
                  <div className="space-y-4 lg:w-[50%]">
                    <CardDescription className="space-y-2">
                      <span>Start Date</span>
                      <p className="font-bold text-black">
                        {formatDate(data?.project_start_date)}
                      </p>
                    </CardDescription>

                    <CardDescription className="space-y-2">
                      <span>End Date</span>
                      <p className="font-bold text-black">
                        {formatDate(data?.project_end_date)}
                      </p>
                    </CardDescription>

                    <CardDescription className="space-y-2">
                      <span>Estimated Completion Date</span>
                      <p className="font-bold text-black">
                        {formatDate(data?.project_end_date)}
                      </p>
                    </CardDescription>
                    <CardDescription className="space-y-2">
                      <span>Project Type</span>
                      <p className="font-bold text-black">
                        {data?.project_type ? (
                          `${data?.project_type} - ${projectType?.standard_project_duration} days`
                        ) : "--"}
                      </p>
                    </CardDescription>
                  </div>

                  <div className="space-y-4">
                    <CardDescription className="space-y-2">
                      <span>Customer</span>
                      <p className="font-bold text-black">
                        {projectCustomer?.company_name || "--"}
                      </p>
                    </CardDescription>
                    <CardDescription className="space-y-2">
                      <span>Location</span>
                      <p className="font-bold text-black">
                        {data?.project_city}, {data?.project_state}
                      </p>
                    </CardDescription>

                    <CardDescription className="space-y-2">
                      <span>Area (Sqft)</span>
                      <p className="font-bold text-black">placeholder</p>
                    </CardDescription>

                    <CardDescription className="space-y-2">
                      <span>No. of sections in layout</span>
                      <p className="font-bold text-black">
                        {data?.subdivisions}
                      </p>
                    </CardDescription>
                  </div>
                </div>
                  <div className="flex max-lg:flex-col max-lg:gap-4 w-full">
                    <CardDescription className="space-y-2 lg:w-[50%]">
                      <span>Work Package</span>
                      <div className="flex gap-1 flex-wrap">
                        {JSON.parse(
                          data?.project_work_packages
                        ).work_packages?.map((item: any) => (
                          <div className="flex items-center justify-center rounded-3xl p-1 bg-[#ECFDF3] text-[#067647] border-[1px] border-[#ABEFC6]">
                            {item.work_package_name}
                          </div>
                        ))}
                      </div>
                    </CardDescription>
                    <div className="space-y-4">
                    <CardDescription className="space-y-2">
                      <span>PO Amount (ex. GST)</span>
                      <p className="font-bold text-black">{formatToIndianRupee(totalPosRaised + totalServiceOrdersAmt)}</p>
                    </CardDescription>

                    <CardDescription className="space-y-2">
                      <span>Totals Estimates</span>
                      <p className="font-bold text-black">
                        {formatToIndianRupee(project_estimates?.reduce((acc, i) => {
                          const amount = parseNumber(i?.quantity_estimate * i?.rate_estimate);
                          return acc + amount;
                        }, 0))}
                      </p>
                    </CardDescription>
                  </div>
                </div>
                <div className="flex max-lg:flex-col max-lg:gap-4 w-full">
                    <CardDescription className="space-y-2 lg:w-[50%]">
                      <span>Health Score</span>
                      <StatusBar currentValue={6} totalValue={10} />
                    </CardDescription>
                    <CardDescription className="space-y-2 lg:w-[50%]">
                      <span>Project GST(s)</span>
                      <ul className="list-disc list-inside space-y-1">
                        {JSON.parse(data?.project_gst_number || "{}")?.list?.map((item) => (
                          <li key={item?.location}>
                            <span className="font-bold">{item?.location}</span>
                          </li>
                        ))}
                      </ul>
                    </CardDescription>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  Assignees
                  {role === "Nirmaan Admin Profile" && (
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button asChild>
                          <div className="cursor-pointer">
                            <CirclePlus className="w-5 h-5 mt- pr-1 " />
                            Assign User
                          </div>
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                          <DialogTitle className="text-xl font-semibold mb-4">
                            Assign User:
                          </DialogTitle>
                        </DialogHeader>
                        <div className="grid gap-4">
                          <div className="grid grid-cols-4 items-center gap-4">
                            <label
                              htmlFor="project"
                              className="text-right font-light"
                            >
                              Assign:
                            </label>
                            <Select
                              defaultValue={
                                selectedUser ? selectedUser : undefined
                              }
                              onValueChange={(item) => setSelectedUser(item)}
                            >
                              <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="Select User" />
                              </SelectTrigger>
                              <SelectContent>
                                {userOptions.length > 0
                                  ? userOptions?.map((option) => (
                                    <SelectItem value={option?.value}>
                                      {option?.label}
                                    </SelectItem>
                                  ))
                                  : "No more users available for assigning!"}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid grid-cols-4 items-center gap-4">
                            <span className="text-right font-light">To:</span>
                            <span className="col-span-3 font-semibold">
                              {data?.project_name}
                            </span>
                          </div>
                        </div>
                        <Button
                          disabled={!selectedUser}
                          onClick={handleAssignUserSubmit}
                          className="w-full"
                        >
                          <ListChecks className="mr-2 h-4 w-4" />
                          {createDocLoading ? "Submitting..." : "Submit"}
                        </Button>
                        <DialogClose
                          className="hidden"
                          id="assignUserDialogClose"
                        >
                          close
                        </DialogClose>
                      </DialogContent>
                    </Dialog>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="space-y-2">
                  {Object.entries(groupedAssignees).length === 0 ? (
                    <p>No one is assigned to this project</p>
                  ) : (
                    <ul className="flex gap-2 flex-wrap">
                      {Object.entries(groupedAssignees).map(
                        ([roleProfile, assigneeList], index) => (
                          <li
                            key={index}
                            className="border p-1 bg-white rounded-lg max-sm:w-full"
                          >
                            <div
                              className="flex items-center justify-between gap-4 cursor-pointer hover:bg-gray-100 p-2 rounded-md transition-all duration-200"
                              onClick={() => toggleExpand(roleProfile)}
                            >
                              <div className="flex items-center gap-2">
                                {expandedRoles[roleProfile] ? (
                                  <ChevronDownIcon className="w-5 h-5 text-gray-500" />
                                ) : (
                                  <ChevronRightIcon className="w-5 h-5 text-gray-500" />
                                )}
                                <span className="text-md font-medium text-gray-800">
                                  {roleProfile}
                                </span>
                              </div>
                              <span className="text-sm text-gray-500">
                                {assigneeList.length} users
                              </span>
                            </div>
                            {expandedRoles[roleProfile] && (
                              <ul className="pl-8 mt-2 space-y-2">
                                {assigneeList.map((fullName, index) => (
                                  <li
                                    key={index}
                                    className="flex items-center gap-2 p-2 bg-gray-50 hover:bg-gray-100 rounded-md transition-all duration-200"
                                  >
                                    <CheckCircleIcon className="w-5 h-5 text-green-500" />
                                    <span className="text-sm font-medium text-gray-600">
                                      {fullName}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        )
                      )}
                    </ul>
                  )}
                </CardDescription>
              </CardContent>
            </Card>
          </div>
        )
      )}

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

      {activePage === "prsummary" && (
        <div>
          <Card className="py-4 max-sm:py-2">
            <CardContent className="w-full flex flex-row items-center justify-around max-sm:justify-between py-2">
              {Object.entries(statusCounts)?.map(([status, count]) => (
                <div>
                  <span className="font-semibold">{status}: </span>
                  <p className="italic inline-block">{count}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          {prData_loading ? (
            <TableSkeleton />
          ) : (
            <DataTable
              columns={prSummaryColumns}
              data={pr_data?.filter(i => !i?.procurement_list?.list?.every(j => j?.status === "Deleted")) || []}
              statusOptions={statusOptions}
            />
          )}
        </div>
      )}
      {activePage === "posummary" && (
        <>
          {/* Card for Totals */}
          <Card>
            <CardContent className="flex flex-row items-center justify-between p-4">
              <CardDescription>
                <p className="text-lg font-semibold text-gray-700">Summary</p>
                <p className="text-sm text-gray-500">
                  Overview of totals across all work packages
                </p>
              </CardDescription>
              <CardDescription className="text-right">
                {/* Calculating Totals */}
                {(() => {
                  let totalAmountWithTax = 0;
                  let totalAmountWithoutTax = 0;

                  Object.keys(workPackageTotalAmounts || {}).forEach((key) => {
                    const wpTotal = workPackageTotalAmounts[key];
                    totalAmountWithTax += wpTotal.amountWithTax || 0;
                    totalAmountWithoutTax += wpTotal.amountWithoutTax || 0;
                  });

                  return (
                    <div className="flex flex-col items-start">
                      <p className="text-gray-700">
                        <span className="font-bold">Total inc. GST:</span>{" "}
                        <span className="text-blue-600">
                          ₹{totalAmountWithTax.toLocaleString()}
                        </span>
                      </p>
                      <p className="text-gray-700">
                        <span className="font-bold">Total exc. GST:</span>{" "}
                        <span className="text-blue-600">
                          ₹{totalAmountWithoutTax.toLocaleString()}
                        </span>
                      </p>
                      <p className="text-gray-700">
                        <span className="font-bold">Total Amt Paid:</span>{" "}
                        <span className="text-blue-600">
                          ₹{getTotalAmountPaid.poAmount?.toLocaleString()}
                        </span>
                      </p>
                    </div>
                  );
                })()}
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
                    [
                      ...wpOptions,
                      {
                        label: "Tool & Equipments",
                        value: "Tool & Equipments",
                      },
                    ]
                  }
                />
              )
              // <p>RESOLVE PO TABLE</p>
            }
          </div>
        </>
      )}

      {activePage === "projectspends" && (
        <>
          {options && (
            <Radio.Group
              block
              options={options}
              defaultValue="All"
              optionType="button"
              buttonStyle="solid"
              value={activeTab}
              onChange={(e) => setProjectSpendsTab(e.target.value)}
            />
          )}

          {activeTab &&
            !["All", "Services"].includes(activeTab) && (
              <CategoryAccordion
                categorizedData={categorizedData}
                selectedPackage={activeTab}
                projectEstimates={
                  project_estimates?.filter(
                    (i) => i?.work_package === activeTab
                  ) || []
                }
                po_data={po_data}
              />
            )}

          {activeTab === "All" && (
            <AllTab workPackageTotalAmounts={workPackageTotalAmounts} setProjectSpendsTab={setProjectSpendsTab} segregatedServiceOrderData={segregatedServiceOrderData} totalServiceOrdersAmt={totalServiceOrdersAmt} getTotalAmountPaid={getTotalAmountPaid} />
          )}

          {["Services"].includes(activeTab) && (
            <div>
              {activeTab === "All" && (
                <div className="flex gap-2 items-center mb-4">
                  <h2 className="font-semibold text-gray-500">
                    Service Requests
                  </h2>
                  <ArrowDown className="w-4 h-4" />
                </div>
              )}
              <div>
                <ServiceRequestsAccordion
                  segregatedData={segregatedServiceOrderData}
                />
              </div>
            </div>
          )}
        </>
      )}

      {activePage === "projectestimates" && (
        <ProjectEstimates projectTab />
      )}

      {activePage === "projectmakes" && (
        <ProjectMakesTab projectData={data} project_mutate={project_mutate} options={makeOptions} setProjectMakesTab={setProjectMakesTab} makesTab={makesTab} />
      )}

      {activePage === "SRSummary" && (
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
                          {formatToIndianRupee(getAllSRsTotal)}
                        </span>
                      </p>
                      {/* <p className="text-gray-700">
                        <span className="font-bold">Total exc. GST:</span>{" "}
                        <span className="text-blue-600">
                          {formatToIndianRupee(totalServiceOrdersAmt)}
                        </span>
                      </p> */}
                      <p className="text-gray-700">
                        <span className="font-bold">Total Amt Paid:</span>{" "}
                        <span className="text-blue-600">
                          ₹{getTotalAmountPaid?.srAmount?.toLocaleString()}
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
      )}

      <div className="hidden">
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
                  {/* <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Status - Common Area</th> */}
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
                  {/* <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Status - Common Area</th> */}
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
      </div>
    </div>
  );
};