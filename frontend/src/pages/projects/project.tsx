import redlogo from "@/assets/red-logo.png"
import { ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { OverviewSkeleton, OverviewSkeleton2, Skeleton, TableSkeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/use-toast"
import { ConfigProvider, Menu, MenuProps, Radio, Tree, Table as AntTable } from "antd"
import { useFrappeCreateDoc, useFrappeGetDoc, useFrappeGetDocList, useFrappeGetCall, useFrappeUpdateDoc } from "frappe-react-sdk"
import { ArrowDown, ArrowLeft, Check, CheckCircleIcon, ChevronDownIcon, ChevronRightIcon, ChevronsUpDown, CircleCheckBig, CirclePlus, CornerRightDown, Download, FilePenLine, HardHat, ListChecks, OctagonMinus, UserCheckIcon } from "lucide-react"
import React, { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import StatusBar from "@/components/ui/status-bar"
import { Button } from "@/components/ui/button"
import { useReactToPrint } from "react-to-print"
import { formatDate } from "@/utils/FormatDate"
import formatToIndianRupee from "@/utils/FormatPrice"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Pie, PieChart, Label, BarChart, CartesianGrid, XAxis, YAxis, Legend, Bar, Tooltip } from "recharts";
import { useUserData } from "@/hooks/useUserData"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CommandGroup, CommandItem, Command, CommandEmpty, CommandList } from "@/components/ui/command"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Separator } from "@/components/ui/separator"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { DownOutlined } from '@ant-design/icons';
import { v4 as uuidv4 } from 'uuid';
import logo from "@/assets/logo-svg.svg"
import { ProcurementOrders as ProcurementOrdersType } from "@/types/NirmaanStack/ProcurementOrders"

const projectStatuses = [
  { value: 'WIP', label: 'WIP', color: 'text-yellow-500', icon: HardHat },
  { value: 'Completed', label: 'Completed', color: 'text-green-500', icon: CircleCheckBig },
  { value: 'Halted', label: 'Halted', color: 'text-red-500', icon: OctagonMinus }
]

const Project = () => {

  const { projectId } = useParams<{ projectId: string }>()

  const { data, isLoading, mutate: project_mutate } = useFrappeGetDoc("Projects", projectId)

  const { data: projectCustomer, isLoading: projectCustomerLoading } = useFrappeGetDoc("Customers", data?.customer, `Customers ${data?.customer}`)

  const { data: po_item_data, isLoading: po_item_loading } = useFrappeGetCall('nirmaan_stack.api.procurement_orders.generate_po_summary', { project_id: projectId })

  return (
    <div>
      {(isLoading || projectCustomerLoading || po_item_loading) && <Skeleton className="w-[30%] h-10" />}
      {data && <ProjectView projectId={projectId} data={data} project_mutate={project_mutate} projectCustomer={projectCustomer} po_item_data={po_item_data?.message?.po_items} />}
    </div>
  )
}

// Cannot add rest of hook calls to lazy component since skeleton loading is dependent upon them
interface ProjectViewProps {
  projectId: string | undefined
  data: any
  project_mutate: any
  //mile_data?: any
  projectCustomer: any
  //projectAssignees?: any
  //usersList?: any
  //pr_data?: any
  //po_data?: any
  po_item_data: any
}

export const Component = Project

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

const ProjectView = ({ projectId, data, project_mutate, projectCustomer, po_item_data }: ProjectViewProps) => {

  const { role } = useUserData()
  const [selectedUser, setSelectedUser] = useState(null)
  const [userOptions, setUserOptions] = useState([])

  const [newStatus, setNewStatus] = useState<string>("")
  const [open, setOpen] = useState(false)
  const [showStatusChangeDialog, setShowStatusChangeDialog] = useState(false)

  const { createDoc, loading: createDocLoading } = useFrappeCreateDoc()
  const { updateDoc, loading: updateDocLoading } = useFrappeUpdateDoc()
  const [statusCounts, setStatusCounts] = useState({})

  const { data: mile_data, isLoading: mile_isloading } = useFrappeGetDocList("Project Work Milestones", {
    fields: ["*"],
    filters: [["project", "=", projectId]],
    limit: 1000,
    orderBy: { field: "start_date", order: "asc" }
  },
    `Project Work MileStones ${projectId}`,
    {
      revalidateIfStale: false
    }
  )

  const { data: project_estimates, isLoading: project_estimates_loading, error: project_estimates_error } = useFrappeGetDocList("Project Estimates", {
    fields: ["*"],
    filters: [["project", "=", projectId]],
    limit: 1000
  })

  const [selectedPackage, setSelectedPackage] = useState("");

  // console.log("po_item data", po_item_data)

  const { data: projectAssignees, isLoading: projectAssigneesLoading, mutate: projectAssigneesMutate } = useFrappeGetDocList("Nirmaan User Permissions", {
    fields: ["*"],
    limit: 1000,
    filters: [["for_value", "=", `${projectId}`], ["allow", "=", "Projects"]]
  },
    `User Permission, filters(for_value),=,${projectId}`
  )

  // console.log("projectAssignes", projectAssignees)

  const { data: usersList, isLoading: usersListLoading, mutate: usersListMutate } = useFrappeGetDocList("Nirmaan Users", {
    fields: ["*"],
    limit: 1000
  }
  )

  const { data: pr_data, isLoading: prData_loading } = useFrappeGetDocList("Procurement Requests", {
    fields: ["*"],
    filters: [["project", "=", `${projectId}`]],
    limit: 1000
  },
    `Procurement Requests ${projectId}`
  )

  const getUserFullName = (id) => {
    if (id === "Administrator") return id
    if (usersList) {
      return usersList.find((user) => user.name === id)?.full_name
    }
  }

  const { data: po_data, isLoading: po_loading } = useFrappeGetDocList("Procurement Orders", {
    fields: ["*"],
    filters: [["project", "=", projectId], ["merged", "!=", "true"]], // removed ["status", "!=", "PO Approved"] for now
    limit: 1000,
    orderBy: { field: "creation", order: "desc" }
  },
    `Procurement Orders ${projectId}`
  )

  const { data: po_data_for_posummary, isLoading: po_data_for_posummary_loading } = useFrappeGetDocList("Procurement Orders", {
    fields: ["*"],
    filters: [["project", "=", projectId], ["status", "!=", "Merged"]], // removed ["status", "!=", "PO Approved"] for now
    limit: 1000,
    orderBy: { field: "creation", order: "desc" }
  }
  )

  const { data: allServiceRequestsData, isLoading: allServiceRequestsDataLoading } = useFrappeGetDocList("Service Requests", {
    fields: ["*"],
    filters: [["project", "=", projectId]],
    limit: 1000
  })

  const { data: serviceRequestsData, isLoading: sRloading } = useFrappeGetDocList("Service Requests", {
    fields: ["*"],
    filters: [["status", "=", "Approved"], ["project", "=", projectId]],
    limit: 1000
  })

  const { data: vendorsList, isLoading: vendorsListLoading, error: vendorsError } = useFrappeGetDocList("Vendors", {
    fields: ["vendor_name", 'vendor_type'],
    filters: [["vendor_type", "=", "Material"]],
    limit: 1000
    }
  )

  const vendorOptions = vendorsList?.map((ven) => ({ label: ven.vendor_name, value: ven.vendor_name }))

  useEffect(() => {
    if (usersList && projectAssignees) {
      const options = usersList?.filter(user => !projectAssignees?.some((i) => i?.user === user?.name) && user?.role_profile !== "Nirmaan Admin Profile")?.map((op) => ({
        label: (<div>
          {op?.full_name}
          <span className="text-red-700 font-light">
            ({op?.role_profile?.split(" ").slice(1, 3).join(" ")})
          </span>
        </div>),
        value: op?.name
      })) || [];
      setUserOptions(options)
    }
  }, [usersList, projectAssignees])

  // console.log("poData", po_data)

  const totalPosRaised = () => {
    if (po_data && po_data.length > 0) {
      const total = po_data.reduce((acc, po) => {
        if (po.order_list && po.order_list.list && po.order_list.list.length > 0) {
          const poTotal = po.order_list.list.reduce((itemAcc, item) => {
            const baseAmount = item.quote * item.quantity
            const taxAmount = baseAmount * (item.tax / 100)
            // return itemAcc + (baseAmount + taxAmount);
            return itemAcc + baseAmount;
          }, 0);
          return acc + poTotal;
        }
        return acc;
      }, 0);

      return total;
    }

    return 0;
  };

  // Grouping functionality
  const groupedAssignees = useMemo(() => {
    if (!projectAssignees || !usersList) return {};

    const filteredAssignees = projectAssignees.filter(assignee =>
      usersList.some(user => user.name === assignee.user)
    );

    const grouped = filteredAssignees.reduce((acc, assignee) => {
      const user = usersList.find(user => user.name === assignee.user);
      if (user) {
        const { role_profile, full_name } = user;

        if (!acc[role_profile.split(" ").slice(1, 3).join(" ")]) {
          acc[role_profile.split(" ").slice(1, 3).join(" ")] = [];
        }

        acc[role_profile.split(" ").slice(1, 3).join(" ")].push(full_name);
      }

      return acc;
    }, {});

    return grouped;
  }, [projectAssignees, usersList]);

  // Accordion state
  const [expandedRoles, setExpandedRoles] = useState({});

  useEffect(() => {
    const initialExpandedState = Object.keys(groupedAssignees).reduce((acc, roleProfile) => {
      acc[roleProfile] = true;
      return acc;
    }, {});
    setExpandedRoles(initialExpandedState);
  }, [groupedAssignees]);

  const toggleExpand = (roleProfile) => {
    setExpandedRoles((prev) => ({
      ...prev,
      [roleProfile]: !prev[roleProfile],
    }));
  };


  const navigate = useNavigate();

  type ScopesMilestones = {
    work_package: string;
    scope_of_work: string;
    milestone: string;
    start_date: string;
    end_date: string;
    status_list: {
      list: {
        name: string;
        status: string;
      }[];
    };
  }

  type MenuItem = Required<MenuProps>['items'][number];

  const items: MenuItem[] = [
    {
      label: 'Overview',
      key: 'overview',
    },
    role === "Nirmaan Admin Profile" ? {
      label: 'Project Tracking',
      key: 'projectTracking',
    } : null,
    {
      label: 'PR Summary',
      key: 'prsummary',
    },
    {
      label: 'SR Summary',
      key: 'SRSummary',
    },
    {
      label: 'PO Summary',
      key: 'posummary',
    },
    ["Nirmaan Admin Profile", "Nirmaan Estimates Executive Profile"].includes(role) ? {
      label: 'Project Spends',
      key: 'projectspends',
    } : null,
  ];

  const [areaNames, setAreaNames] = useState(null)

  const getStatusListColumns = (mile_data: ScopesMilestones[]) => {
    const statusNames = Array.from(
      new Set(
        mile_data.flatMap((row) =>
          row.status_list.list.map((statusObj) => statusObj.name)
        )
      )
    );
    setAreaNames(statusNames)

    return statusNames.map((statusName) => ({
      accessorKey: `status_${statusName}`,
      header: ({ column }) => {
        return <DataTableColumnHeader className="text-black font-bold" column={column} title={statusName} />;
      },
      cell: ({ row }) => {
        const statusObj = row.original.status_list.list.find(
          (statusObj) => statusObj.name === statusName
        );
        return <div className={`text-[#11050599] ${statusObj?.status === "WIP" && "text-yellow-500"} ${statusObj?.status === "Halted" && "text-red-500"} ${statusObj?.status === "Completed" && "text-green-800"}`}>{(statusObj?.status && statusObj.status !== "Pending") ? statusObj?.status : "--"}</div>;
      },
    }));
  };

  const columns: ColumnDef<ScopesMilestones>[] = useMemo(() => {
    const staticColumns: ColumnDef<ScopesMilestones>[] = [
      {
        accessorKey: "work_package",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader className="text-black font-bold" column={column} title="Work Package" />
          );
        },
        cell: ({ row }) => {
          return <div className="text-[#11050599]">{row.getValue("work_package")}</div>;
        },
      },
      {
        accessorKey: "scope_of_work",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader className="text-black font-bold" column={column} title="Scope of Work" />
          );
        },
        cell: ({ row }) => {
          return <div className="text-[#11050599]">{row.getValue("scope_of_work")}</div>;
        },
      },
      {
        accessorKey: "milestone",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader className="text-black font-bold" column={column} title="Milestone" />
          );
        },
        cell: ({ row }) => {
          return <div className="text-[#11050599]">{row.getValue("milestone")}</div>;
        },
      },
      {
        accessorKey: "start_date",
        header: ({ column }) => {
          return <DataTableColumnHeader className="text-black font-bold" column={column} title="Start Date" />;
        },
        cell: ({ row }) => {
          return <div className="text-[#11050599]">{formatDate(row.getValue("start_date"))}</div>;
        },
      },
      {
        accessorKey: "end_date",
        header: ({ column }) => {
          return <DataTableColumnHeader className="text-black font-bold" column={column} title="End Date" />;
        },
        cell: ({ row }) => {
          return <div className="text-[#11050599]">{formatDate(row.getValue("end_date"))}</div>;
        },
      },
    ];

    const dynamicColumns = mile_data ? getStatusListColumns(mile_data) : [];
    return [...staticColumns, ...dynamicColumns];
  }, [mile_data]);

  const { data: quote_data } = useFrappeGetDocList("Quotation Requests",
    {
      fields: ['name', 'item', 'quote'],
      limit: 10000
    });

  const getTotal = (order_id) => {
    let total = 0;

    const procurementRequest = pr_data?.find(item => item.name === order_id);
    const orderData = procurementRequest?.procurement_list;

    const status = statusRender(procurementRequest?.status, order_id);

    if (status === "Approved PO") {
      const filteredPOs = po_data?.filter(po => po.procurement_request === order_id) || [];

      filteredPOs.forEach(po => {
        po.order_list?.list.forEach(item => {
          if (item.quote && item.quantity) {
            total += parseFloat(item.quote) * item.quantity;
          }
        });
      });
    } else {
      orderData?.list.forEach(item => {
        const quotesForItem = quote_data
          ?.filter(value => value.item === item.name && value.quote != null)
          ?.map(value => value.quote);

        let minQuote;
        if (quotesForItem && quotesForItem.length) minQuote = Math.min(...quotesForItem);
        total += (minQuote ? parseFloat(minQuote) : 0) * item.quantity;
      });
    }

    return total || "N/A";
  };


  const getItemStatus = (item: any, filteredPOs: any[]) => {
    return filteredPOs.some(po =>
      po?.order_list?.list.some(poItem => poItem?.name === item.name)
    );
  };

  const statusRender = (status: string, prId: string) => {
    const procurementRequest = pr_data?.find((pr) => pr?.name === prId);

    const itemList = procurementRequest?.procurement_list?.list || [];

    if (["Pending", "Approved", "Rejected"].includes(status)) {
      return "New PR";
    }

    if(itemList?.some((i) => i?.status === "Deleted")) {
      return "Open PR"
    }

    const filteredPOs = po_data?.filter(po => po?.procurement_request === prId) || [];
    const allItemsApproved = itemList.every(item => { return getItemStatus(item, filteredPOs); });

    return allItemsApproved ? "Approved PO" : "Open PR";
  };

  useEffect(() => {
    if (pr_data) {
      const statusCounts = { "New PR": 0, "Open PR": 0, "Approved PO": 0 };
      pr_data?.forEach((pr) => {
        const status = statusRender(pr?.workflow_state, pr?.name)
        statusCounts[status] += 1

      })
      setStatusCounts(statusCounts)
    }
  }, [pr_data])

  const statusOptions = [
    { label: "New PR", value: "New PR" },
    { label: "Open PR", value: "Open PR" },
    { label: "Approved PO", value: "Approved PO" },
  ]

  const prSummaryColumns = [
    {
      accessorKey: "name",
      header: ({ column }) => {
        return <DataTableColumnHeader className="text-black font-bold" column={column} title="PR Id" />
      },
      cell: ({ row }) => {
        return <Link className="text-blue-500 underline" to={row.getValue("name")}><div>{row.getValue("name").split("-")[2]}</div></Link>
      }
    },
    {
      accessorKey: "creation",
      header: ({ column }) => {
        return <DataTableColumnHeader className="text-black font-bold" column={column} title="Creation" />
      },
      cell: ({ row }) => {
        return <div className="text-[#11050599]">{formatDate(row.getValue("creation"))}</div>
      }
    },
    {
      accessorKey: "owner",
      header: ({ column }) => {
        return <DataTableColumnHeader className="text-black font-bold" column={column} title="Created By" />
      },
      cell: ({ row }) => {
        return <div className="text-[#11050599]">{getUserFullName(row.getValue("owner"))}</div>
      }
    },

    {
      accessorKey: "workflow_state",
      header: ({ column }) => {
        return <DataTableColumnHeader className="text-black font-bold" column={column} title="Status" />
      },
      cell: ({ row }) => {
        const status = row.getValue("workflow_state")
        const prId = row.getValue("name")
        return <div className="font-medium">{statusRender(status, prId)}</div>
      },
      filterFn: (row, id, value) => {
        const rowValue = row.getValue(id)
        const prId = row.getValue("name")
        const renderValue = statusRender(rowValue, prId)
        return value.includes(renderValue)
      }
    },
    {
      accessorKey: "work_package",
      header: ({ column }) => {
        return (
          <DataTableColumnHeader className="text-black font-bold" column={column} title="Package" />
        )
      },
      cell: ({ row }) => {
        return (
          <div className="text-[#11050599]">
            {row.getValue("work_package")}
          </div>
        )
      }
    },
    {
      accessorKey: "category_list",
      header: ({ column }) => {
        return (
          <DataTableColumnHeader className="text-black font-bold" column={column} title="Categories" />
        )
      },
      cell: ({ row }) => {
        const categories = []
        const categoryList = row.getValue("category_list")?.list || []
        categoryList?.forEach((i) => {
            if(categories.every((j) => j?.name !== i?.name)) {
                categories.push(i)
            }
        })

        return (
            <div className="flex flex-col gap-1 items-start justify-center">
                {categories?.map((obj) => <Badge className="inline-block">{obj["name"]}</Badge>)}
            </div>
        )
    }
    },
    {
      id: "estimated_price",
      header: ({ column }) => {
        return (
          <DataTableColumnHeader className="text-black font-bold" column={column} title="Estimated Price" />
        )
      },
      cell: ({ row }) => {
        const total = getTotal(row.getValue("name"))
        return (
          <div className="text-[#11050599]">
            {total === "N/A" ? total : formatToIndianRupee(total)}
          </div>
        )
      }
    }
  ]

  const getSRTotal = (order_id: string) => {
    let total: number = 0;
    const orderData = allServiceRequestsData?.find(item => item.name === order_id)?.service_order_list;
    orderData?.list.map((item) => {
      const price = item.rate * item.quantity;
      total += price ? parseFloat(price) : 0
    })
    return total;
  }

  const srSummaryColumns = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="SR Number" />
          )
        },
        cell: ({ row }) => {
          const srId = row.getValue("name")
          return (
            <Link className="text-blue-500 underline" to={`/service-request/${srId}`}>
              {srId?.slice(-5)}
            </Link>
          )
        }
      },
      {
        accessorKey: "creation",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Date" />
          )
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              {formatDate(row.getValue("creation")?.split(" ")[0])}
            </div>
          )
        }
      },
      {
        accessorKey: "status",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Status" />
          )
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              {row.getValue("status")}
            </div>
          )
        }
      },
      {
        accessorKey: "service_category_list",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Categories" />
          )
        },
        cell: ({ row }) => {
          return (
            <div className="flex flex-col gap-1 items-start justify-center">
              {row.getValue("service_category_list").list.map((obj) => <Badge className="inline-block">{obj["name"]}</Badge>)}
            </div>
          )
        }
      },
      {
        id: "total",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Estimated Price" />
          )
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              {formatToIndianRupee(getSRTotal(row.getValue("name")))}
            </div>
          )
        }
      }

    ],
    [projectId, allServiceRequestsData]
  )

  const getPOTotal = (order_id: string) => {
    let total: number = 0;
    let totalWithGST: number = 0;

    const orderData = po_data_for_posummary?.find(item => item.name === order_id)?.order_list;

    orderData?.list.map((item) => {
      const price = parseFloat(item?.quote) || 0;
      const quantity = parseFloat(item?.quantity) || 1;
      const gst = parseFloat(item?.tax) || 0;

      total += price * quantity;

      const gstAmount = (price * gst) / 100;
      totalWithGST += (price + gstAmount) * quantity;
    });

    return {
      totalWithoutGST: total,
      totalWithGST: totalWithGST
    };
  };

  const getWorkPackageName = (poId) => {
    const po = po_data_for_posummary?.find((j) => j?.name === poId)
    return pr_data?.find((i) => i?.name === po?.procurement_request)?.work_package
  }

  const wpOptions = data && JSON.parse(data?.project_work_packages)?.work_packages?.map((wp) => ({
    label : wp?.work_package_name,
    value: wp?.work_package_name
  }))

  // console.log("wpOtions", wpOptions)

  const poColumns: ColumnDef<ProcurementOrdersType>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="ID" />
          )
        },
        cell: ({ row }) => {
          const id = row.getValue("name")
          return (
            <div className="font-medium flex items-center gap-2 relative">
              <Link
                className="underline hover:underline-offset-2"
                to={`po/${id.replaceAll("/", "&=")}`}
              >
                {id}
              </Link>
            </div>
          )
        }
      },
      {
        accessorKey: "creation",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Date" />
          )
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              {formatDate(row.getValue("creation")?.split(" ")[0])}
            </div>
          )
        }
      },
      {
        accessorKey: "name",
        id: "wp",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Work Package" />
          )
        },
        cell: ({ row }) => {
          const po = row.getValue("name")
          return (
            <div className="font-medium">
              {getWorkPackageName(po)}
            </div>
          )
        },
        filterFn: (row, id, value) => {
          const rowValue = row.getValue(id)
          // console.log("rowvalue", rowValue)
          // console.log("value", value)
          const renderValue = getWorkPackageName(rowValue)
          // console.log("renderValue", renderValue)
          return value.includes(renderValue)
        }
      },
      {
        accessorKey: "vendor_name",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Vendor" />
          )
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              {row.getValue("vendor_name")}
            </div>
          )
        },
        filterFn: (row, id, value) => {
          return value.includes(row.getValue(id))
        }
      },
      {
        accessorKey: "status",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Status" />
          )
        },
        cell: ({ row }) => {
          return (
            <Badge variant={row.getValue("status") === "PO Approved" ? "default" : row.getValue("status") === "PO Sent" ? "yellow" : row.getValue("status") === "Dispatched" ? "orange" : "green"}>{row.getValue("status") === "Partially Delivered" ? "Delivered" : row.getValue("status")}</Badge>
          )
        }
      },
      {
        id: "totalWithoutGST",
        header: ({ column }) => {
          return (
            <DataTableColumnHeader column={column} title="Amt (exc. GST)" />
          )
        },
        cell: ({ row }) => {
          return (
            <div className="font-medium">
              {formatToIndianRupee(getPOTotal(row.getValue("name")).totalWithoutGST)}
            </div>
          )
        }
      },
      {
        id: "totalWithGST",
        header: ({ column }) => {
            return (
                <DataTableColumnHeader column={column} title="Amt (inc. GST)" />
            )
        },
        cell: ({ row }) => {
            return (
                <div className="font-medium">
                    {formatToIndianRupee(getPOTotal(row.getValue("name")).totalWithGST)}
                </div>
            )
        }
    }
    ],
    [projectId, po_data_for_posummary, data]
  )

  const [current, setCurrent] = useState('overview')
  const [workPackageTotalAmounts, setWorkPackageTotalAmounts] = useState({});

  const onClick: MenuProps['onClick'] = (e) => {
    setCurrent(e.key);
  };

  const today = new Date();

  const formattedDate = today.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const componentRef = React.useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({
    content: () => {
      // console.log("Print Report button Clicked");
      return componentRef.current || null
    },
    documentTitle: `${formattedDate}_${data?.project_name}_${data?.project_city}_${data?.project_state}_${data?.owner}_${data?.creation}`
  });
  const componentRef2 = React.useRef<HTMLDivElement>(null);
  const handlePrint2 = useReactToPrint({
    content: () => {
      // console.log("Print Schedule button Clicked");
      return componentRef2.current || null
    },
    documentTitle: `${data?.project_name}_${data?.project_city}_${data?.project_state}_${data?.owner}_${data?.creation}`
  });

  const componentRef3 = React.useRef<HTMLDivElement>(null);
  const handlePrint3 = useReactToPrint({
    content: () => {
      return componentRef3.current || null
    },
    documentTitle: `${data?.project_name}_${data?.project_city}_${data?.project_state}_${data?.owner}_${formatDate(new Date())}`
  });

  const handleAssignUserSubmit = async () => {
    try {
      await createDoc('User Permission', {
        user: selectedUser,
        allow: "Projects",
        for_value: projectId
      }
      )
      await projectAssigneesMutate()
      await usersListMutate()
      document.getElementById("assignUserDialogClose")?.click()
      toast({
        title: "Success!",
        description: `Successfully assigned ${getUserFullName(selectedUser)}.`,
        variant: "success"
      })
    } catch (error) {
      console.log("error", error)
      toast({
        title: "Failed!",
        description: `Failed to assign ${getUserFullName(selectedUser)}.`,
        variant: "destructive"
      })
    } finally {
      setSelectedUser(null)
    }
  }

  const groupItemsByWorkPackageAndCategory = (items) => {
    const totals = {};

    const groupedData = items?.reduce((acc, item) => {
      const baseAmount = parseFloat(item.quote) * parseFloat(item.quantity);
      const taxAmount = baseAmount * (parseFloat(item.tax) / 100);
      const amountPlusTax = baseAmount + taxAmount;

      if (totals[item.work_package]) {
        const { amountWithTax, amountWithoutTax } = totals[item.work_package]
        totals[item.work_package] = { amountWithTax: amountPlusTax + amountWithTax, amountWithoutTax: amountWithoutTax + baseAmount }
      } else {
        totals[item.work_package] = { amountWithTax: amountPlusTax, amountWithoutTax: baseAmount }
        // totals[item.work_package] = amountWithTax;
      }

      if (!acc[item.work_package]) {
        acc[item.work_package] = {};
      }
      if (!acc[item.work_package][item.category]) {
        acc[item.work_package][item.category] = [];
      }

      const existingItem = acc[item.work_package][item.category].find(
        (i) => i.item_id === item.item_id
      );

      if (existingItem) {
        existingItem.quantity = parseFloat(existingItem.quantity) + parseFloat(item.quantity);
        existingItem.amount += baseAmount;
        existingItem.amountWithTax += amountPlusTax
        existingItem.averageRate = Math.floor((parseFloat(existingItem.averageRate) + parseFloat(item.quote)) / 2)
      } else {
        acc[item.work_package][item.category].push({
          ...item,
          amount: baseAmount,
          amountWithTax: amountPlusTax,
          averageRate: item.quote
        });
      }
      return acc;
    }, {});

    return { groupedData, totals };
  };

  useEffect(() => {
    const { totals } = groupItemsByWorkPackageAndCategory(po_item_data);
    setWorkPackageTotalAmounts(totals);
  }, [po_item_data]);

  const { groupedData: categorizedData } = groupItemsByWorkPackageAndCategory(po_item_data);

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

  const [popOverOpen, setPopOverOpen] = useState(false)

  const setPopOverStatus = () => {
    setPopOverOpen(prevState => !prevState)
  }

  // const workPackages = JSON.parse(data?.project_work_packages)?.work_packages || [];

  // workPackages.push({work_package_name : "Tool & Equipments"})

  const [options, setOptions] = useState(null)

  useEffect(() => {
    if (data) {
      const workPackages = JSON.parse(data?.project_work_packages)?.work_packages || [];
      const options = []
      options.push({ label: "All", value: "All" })
      workPackages?.forEach((wp) => {
        const option = { label: wp?.work_package_name, value: wp?.work_package_name }
        options?.push(option)
      })

      options?.push({ label: "Tool & Equipments", value: "Tool & Equipments" })
      options?.push({ label: "Services", value: "Services" })

      options.sort((a, b) => {
        if (a.label === "All") return -1;
        if (b.label === "All") return 1;
        return a.label.localeCompare(b.label);
      });

      setOptions(options)
      setSelectedPackage("All")
    }
  }, [data])

  // useEffect(() => {
  //   if (workPackages) {
  //     setSelectedPackage(workPackages[0]?.work_package_name)
  //   }
  // }, [])


  const handleStatusChange = (value: string) => {
    if (value === data?.status) {
      setPopOverStatus()
      return
    }
    if (projectStatuses.some(s => s.value === value)) {
      setNewStatus(value)
      setShowStatusChangeDialog(true)
    }
  }

  const segregateServiceOrderData = (serviceRequestsData) => {
    const result = [];
    const servicesEstimates = project_estimates?.filter((p) => p?.work_package === "Services")

    serviceRequestsData?.forEach(serviceRequest => {
      serviceRequest.service_order_list.list?.forEach(item => {
        const { category, uom, quantity, rate } = item;
        const amount = parseFloat(quantity) * parseFloat(rate);

        const existingCategory = result.find((entry) => entry[category]);

        const estimateItem = servicesEstimates?.filter((i) => i?.category === category)

        const estimate_total = estimateItem?.reduce((acc, i) => acc + (i?.quantity_estimate * i?.rate_estimate), 0)

        if (existingCategory) {
          existingCategory[category].quantity += parseFloat(quantity);
          existingCategory[category].amount += amount;
          existingCategory[category].children.push({ ...item, amount: amount })
        } else {
          result.push({
            [category]: {
              key: uuidv4(),
              unit: uom,
              quantity: parseFloat(quantity),
              amount: amount,
              children: [{ ...item, amount: amount }],
              estimate_total: estimate_total
            }
          });
        }
      });
    });

    return result;
  };

  const segregatedServiceOrderData = useMemo(() => segregateServiceOrderData(serviceRequestsData), [serviceRequestsData]);

  const totalServiceOrdersAmt = segregatedServiceOrderData?.reduce((acc, item) => {
    const category = Object.keys(item)[0];
    const { amount } = item[category];
    return acc + parseFloat(amount)
  }, 0)

  // console.log("totalServiceOrdersAmt", totalServiceOrdersAmt)


  // console.log("service requests", serviceRequestsData)

  // console.log("segregatedServicedata", segregatedServiceOrderData)

  // console.log("new status", newStatus)

  const handleConfirmStatus = async () => {
    try {
      await updateDoc("Projects", data?.name, { status: newStatus })
      await project_mutate()
      toast({
        title: "Success!",
        description: `Successfully changed status to ${newStatus}.`,
        variant: "success"
      })
    } catch (error) {
      console.log("error", error)
      toast({
        title: "Failed!",
        description: `Failed to change status to ${newStatus}.`,
        variant: "destructive"
      })
    } finally {
      setShowStatusChangeDialog(false)
    }
  }

  const handleCancelStatus = () => {
    setNewStatus("")
    setShowStatusChangeDialog(false)
  }

  const statusIcon = projectStatuses.find((s) => s.value === data?.status)?.icon

  // console.log("options", options)

  // console.log("selectedPackage", selectedPackage)

  // console.log("projectEstimates", project_estimates)

  return (
    <div className="flex-1 space-y-4">
      <div className="flex items-center justify-between max-md:flex-col max-md:gap-4 max-md:items-start">
        <div className="">
          {/* <ArrowLeft className="mt-1.5 cursor-pointer" onClick={() => navigate("/projects")} /> */}
          <span className="pl-2 text-xl md:text-3xl font-bold tracking-tight">{data?.project_name.toUpperCase()}</span>
          {role === "Nirmaan Admin Profile" && <FilePenLine onClick={() => navigate('edit')} className="w-10 text-blue-300 hover:-translate-y-1 transition hover:text-blue-600 cursor-pointer inline-block -mt-3" />}
        </div>
        <div className="flex max-sm:text-xs max-md:text-sm items-center max-md:justify-between max-md:w-full">
          {role === "Nirmaan Admin Profile" &&
            (
              <>
                <Popover open={popOverOpen} onOpenChange={setPopOverStatus}>
                  <PopoverTrigger asChild>
                    <Button variant='outline' role="combobox" aria-expanded={open} className="w-48 flex justify-between">
                      <span className="font-bold text-md">Status: </span>
                      <div className={`flex items-center gap-2 ${projectStatuses.find((s) => s.value === data?.status)?.color || "text-gray-500"}`}>{statusIcon && React.createElement(statusIcon, { className: 'h-4 w-4' })}{projectStatuses.find((s) => s.value === data?.status)?.label || "Not Set"}</div>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-40 p-0">
                    <Command>
                      <CommandList>
                        <CommandGroup>
                          {projectStatuses.map((s) => (
                            <CommandItem key={s.value} value={s.value} onSelect={() => handleStatusChange(s.value)}>
                              {/* <Check className={cn("mr-2 h-4 w-4", status === s.value ? "opacity-100" : "opacity-0")} /> */}
                              {s.label}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <AlertDialog open={showStatusChangeDialog} onOpenChange={setShowStatusChangeDialog}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action will change the status from "
                        {data.status} "
                        to "{projectStatuses.find((s) => s.value === newStatus)?.label || "Unknown"}".
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel onClick={handleCancelStatus}>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleConfirmStatus}>Continue</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>)}
          <CustomHoverCard totalPosRaised={totalPosRaised} totalServiceOrdersAmt={totalServiceOrdersAmt} categorizedData={categorizedData} workPackageTotalAmounts={workPackageTotalAmounts} />
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
                  itemSelectedColor: "#D03B45"
                }
              }
            }}
          >
            <Menu selectedKeys={[current]} onClick={onClick} mode="horizontal" items={items} />
          </ConfigProvider>
        </div>

        {/* {totalPosRaised && ( */}

        {/* )} */}
      </div>

      {/* Overview Section */}

      {(usersListLoading || projectAssigneesLoading) ? (<OverviewSkeleton2 />) : current === "overview" && (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>
                <div className="flex justify-between items-center">
                  {data?.project_name}
                  <Button onClick={() => navigate('add-estimates')}><CirclePlus className="h-4 w-4 mr-2" /> Add Project Estimates</Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-10 w-full">
              <div className="flex max-lg:flex-col max-lg:gap-10">
                <div className="space-y-4 lg:w-[50%]">
                  <CardDescription className="space-y-2">
                    <span>Project Id</span>
                    <p className="font-bold text-black">{data?.name}</p>
                  </CardDescription>

                  <CardDescription className="space-y-2">
                    <span>Start Date</span>
                    <p className="font-bold text-black">{formatDate(data?.project_start_date)}</p>
                  </CardDescription>

                  <CardDescription className="space-y-2">
                    <span>End Date</span>
                    <p className="font-bold text-black">{formatDate(data?.project_end_date)}</p>
                  </CardDescription>

                  <CardDescription className="space-y-2">
                    <span>Estimated Completion Date</span>
                    <p className="font-bold text-black">{formatDate(data?.project_end_date)}</p>
                  </CardDescription>
                </div>

                <div className="space-y-4">
                  <CardDescription className="space-y-2">
                    <span>Customer</span>
                    <p className="font-bold text-black">{projectCustomer?.company_name || "--"}</p>
                  </CardDescription>
                  <CardDescription className="space-y-2">
                    <span>Location</span>
                    <p className="font-bold text-black">{data?.project_city}, {data?.project_state}</p>
                  </CardDescription>

                  <CardDescription className="space-y-2">
                    <span>Area (Sqft)</span>
                    <p className="font-bold text-black">placeholder</p>
                  </CardDescription>

                  <CardDescription className="space-y-2">
                    <span>No. of sections in layout</span>
                    <p className="font-bold text-black">{data?.subdivisions}</p>
                  </CardDescription>
                </div>
              </div>
              <div className="space-y-4 w-full">
                <CardDescription className="space-y-2">
                  <span>Work Package</span>
                  <div className="flex gap-1 flex-wrap">
                    {JSON.parse(data?.project_work_packages).work_packages?.map((item: any) => (
                      <div className="flex items-center justify-center rounded-3xl p-1 bg-[#ECFDF3] text-[#067647] border-[1px] border-[#ABEFC6]">{item.work_package_name}</div>
                    ))}
                  </div>

                </CardDescription>
                <CardDescription className="space-y-2">
                  <span>Health Score</span>
                  <StatusBar currentValue={6} totalValue={10} />
                </CardDescription>
              </div>
            </CardContent>
            {/* </CardHeader>
                    </Card>
                </CardContent> */}

          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">Assignees
                {role === "Nirmaan Admin Profile" && <Dialog>
                  <DialogTrigger asChild>
                    <Button asChild>
                      <div className="cursor-pointer"><CirclePlus className="w-5 h-5 mt- pr-1 " />Assign User</div>
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                      <DialogTitle className="text-xl font-semibold mb-4">Assign User:</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4">
                      <div className="grid grid-cols-4 items-center gap-4">
                        <label htmlFor="project" className="text-right font-light">
                          Assign:
                        </label>
                        <Select
                          defaultValue={selectedUser ? selectedUser : undefined}
                          onValueChange={(item) => setSelectedUser(item)}
                        >
                          <SelectTrigger className="col-span-3">
                            <SelectValue placeholder="Select User" />
                          </SelectTrigger>
                          <SelectContent>
                            {userOptions.length ? (
                              userOptions?.map(option => (
                                <SelectItem value={option?.value}>
                                  {option?.label}
                                </SelectItem>
                              ))
                            ) : (
                              "No more users available for assigning!"
                            )}
                          </SelectContent>
                        </Select>

                      </div>
                      <div className="grid grid-cols-4 items-center gap-4">
                        <span className="text-right font-light">To:</span>
                        <span className="col-span-3 font-semibold">{data?.project_name}</span>
                      </div>
                    </div>
                    <Button disabled={!selectedUser} onClick={handleAssignUserSubmit} className="w-full">
                      <ListChecks className="mr-2 h-4 w-4" />
                      {createDocLoading ? "Submitting..." : "Submit"}</Button>
                    <DialogClose className="hidden" id="assignUserDialogClose">
                      close
                    </DialogClose>
                  </DialogContent>
                </Dialog>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="space-y-2">
                {Object.entries(groupedAssignees).length === 0 ? <p>No one is assigned to this project</p> :
                  <ul className="flex gap-2 flex-wrap">
                    {Object.entries(groupedAssignees).map(([roleProfile, assigneeList], index) => (
                      <li key={index} className="border p-1 bg-white rounded-lg max-sm:w-full">
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
                            <span className="text-md font-medium text-gray-800">{roleProfile}</span>
                          </div>
                          <span className="text-sm text-gray-500">{assigneeList.length} users</span>
                        </div>
                        {expandedRoles[roleProfile] && (
                          <ul className="pl-8 mt-2 space-y-2">
                            {assigneeList.map((fullName, index) => (
                              <li
                                key={index}
                                className="flex items-center gap-2 p-2 bg-gray-50 hover:bg-gray-100 rounded-md transition-all duration-200"
                              >
                                <CheckCircleIcon className="w-5 h-5 text-green-500" />
                                <span className="text-sm font-medium text-gray-600">{fullName}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>}
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      )}

      {current === "projectTracking" && (
        <div className="pr-2">
          <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-2">
            <Button variant="outline" className=" cursor-pointer flex items-center gap-1"
              onClick={() => handlePrint()}
            >
              Download Report
              <Download className="w-4" />
            </Button>
            <Button variant="outline" className="cursor-pointer flex items-center gap-1"
              onClick={() => handlePrint2()}
            >
              Download Schedule
              <Download className="w-4" />
            </Button>
            <Button variant="outline" className="cursor-pointer flex items-center gap-1"
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
      )}

      {
        current === "prsummary" && (
          <div>
            <Card className="flex border border-gray-100 rounded-lg p-4">
              <CardContent className="w-full flex flex-row items-center justify-around">
                {/* <CardHeader className=" w-full"> */}
                {Object.entries(statusCounts)?.map(([status, count]) => (
                  <div className="flex items-center gap-1 pt-3">
                    <h3 className="font-semibold">{status}: </h3>
                    <p className="italic">{count}</p>
                  </div>
                ))}
                {/* </CardHeader> */}
              </CardContent>
            </Card>
            {prData_loading ? (<TableSkeleton />) :
              <DataTable columns={prSummaryColumns} data={pr_data || []} statusOptions={statusOptions} />
            }
          </div>
        )
      }
      {
        current === "posummary" && (
          <div>
            {/* <Card className="flex border border-gray-100 rounded-lg p-4">
              <CardContent className="w-full flex flex-row items-center justify-around">
                <CardHeader className=" w-full">
                {Object.entries(statusCounts)?.map(([status, count]) => (
                  <div className="flex items-center gap-1 pt-3">
                    <h3 className="font-semibold">{status}: </h3>
                    <p className="italic">{count}</p>
                  </div>
                ))}
                </CardHeader>
              </CardContent>
            </Card> */}
            {po_data_for_posummary_loading ? (<TableSkeleton />) :
              <DataTable columns={poColumns} data={po_data_for_posummary || []} vendorOptions={vendorOptions} itemSearch={true} wpOptions={[...wpOptions, {label : "Tool & Equipments", value : "Tool & Equipments"}] || []} />
              // <p>RESOLVE PO TABLE</p>
            }
          </div>
        )
      }

      {current === "projectspends" && (
        <>
          {
            options && (
              <Radio.Group
                block
                options={options}
                defaultValue="All"
                optionType="button"
                buttonStyle="solid"
                onChange={(e) => setSelectedPackage(e.target.value)}
              />
            )
          }
          {/* <div className="w-full flex flex-col gap-2">
            <div className="flex gap-2 items-center">
              <h2 className="font-semibold text-gray-500">Work Packages</h2>
              <ArrowDown className="w-4 h-4" />
            </div> */}
          {/* {selectedPackage && (
              <Select
                value={selectedPackage}
                onValueChange={(value) => setSelectedPackage(value)}
              >
                <SelectTrigger id="work-package-dropdown" className="w-full">
                  <SelectValue placeholder="Choose a work package" />
                </SelectTrigger>

                <SelectContent>
                  {workPackages.map((packageItem, index) => (
                    <SelectItem key={index} value={packageItem.work_package_name}>
                      {packageItem.work_package_name}
                      <div className="flex space-x-4 text-sm text-gray-600">
                        <span className="font-semibold">{packageItem.work_package_name}:</span>
                        <span>Total Amount: {formatToIndianRupee(workPackageTotalAmounts?.[packageItem.work_package_name]?.amountWithoutTax)}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )} */}
          {/* </div> */}
          {(selectedPackage && !["All", "Services"].includes(selectedPackage)) && (
            <CategoryAccordion categorizedData={categorizedData} selectedPackage={selectedPackage} projectEstimates={project_estimates?.filter((i) => i?.work_package === selectedPackage) || []} />
          )}

          {selectedPackage === "All" && (
            <>
              <div>
                <div className="flex gap-2 items-center">
                  <h2 className="font-semibold text-gray-500">Work Packages</h2>
                  <ArrowDown className="w-4 h-4" />
                </div>
                {JSON.parse(data?.project_work_packages)?.work_packages?.sort((a,b) => a?.work_package_name?.localeCompare(b?.work_package_name))?.map((wp) => (
                  <div key={wp?.work_package_name}>
                    <h3 className="text-sm font-semibold py-4">{wp?.work_package_name}</h3>
                    <CategoryAccordion categorizedData={categorizedData} selectedPackage={wp?.work_package_name} projectEstimates={project_estimates?.filter((i) => i?.work_package === wp?.work_package_name) || []} />
                  </div>
                ))}
              </div>
              <Separator />
              <div>
                <div className="flex gap-2 items-center mb-4">
                  <h2 className="font-semibold text-gray-500">Tools & Equipments</h2>
                  <ArrowDown className="w-4 h-4" />
                </div>
                <div>
                  <ToolandEquipementAccordion projectEstimates={project_estimates} categorizedData={categorizedData} />
                </div>
              </div>
              <Separator />
            </>
          )}

          {["All", "Services"].includes(selectedPackage) && (
            <div>
              {selectedPackage === "All" && (
                <div className="flex gap-2 items-center mb-4">
                  <h2 className="font-semibold text-gray-500">Service Requests</h2>
                  <ArrowDown className="w-4 h-4" />
                </div>
              )}
              <div>
                <ServiceRequestsAccordion projectEstimates={project_estimates} segregatedData={segregatedServiceOrderData} />
              </div>
            </div>
          )}
        </>
      )}

      {current === "SRSummary" && (
        <DataTable columns={srSummaryColumns} data={allServiceRequestsData || []} />
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
                        <div className="pt-1 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr>
                  <th colSpan={5 + areaNames?.length} className="p-0">
                    <div className="py-1 border-b-2 border-gray-600 pb-2 mb-1">
                      <div className="flex justify-between">
                        <div className="text-xs text-gray-500 font-normal">1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka</div>
                        <div className="text-xs text-gray-500 font-normal">GST: 29ABFCS9095N1Z9</div>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr>
                  <th colSpan={5 + areaNames?.length} className="p-0">
                    <div className="grid grid-cols-6 gap-4 justify-between border border-gray-100 rounded-lg px-3 py-1 mb-1">
                      <div className="border-0 flex flex-col col-span-2">
                        <p className="text-left py-1 font-medium text-xs text-gray-500">Name and address</p>
                        <p className="text-left font-bold font-semibold text-sm text-black">{data?.project_name}</p>
                        <p className="text-left py-1 font-medium text-xs text-gray-500">Date : {formattedDate}</p>
                      </div>
                      <div className="border-0 flex flex-col col-span-2">
                        <p className="text-left py-1 font-medium text-xs text-gray-500">Start Date & End Date</p>
                        <p className="text-left font-bold font-semibold text-sm text-black">{formatDate(data?.project_start_date)} to {formatDate(data?.project_end_date)}</p>
                      </div>
                      <div className="border-0 flex flex-col col-span-2">
                        <p className="text-left py-1 font-medium text-xs text-gray-500">Work Package</p>
                        <p className="text-left font-bold font-semibold text-sm text-black">{data && JSON.parse(data?.project_work_packages!).work_packages.map((item) => item.work_package_name).join(", ")}</p>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr>
                  <th scope="col" className="px-6 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Work Package</th>
                  <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Scope of Work</th>
                  <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Milestone</th>
                  <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Start Date</th>
                  <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">End Date</th>
                  {/* <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Status - Common Area</th> */}
                  {
                    areaNames?.map((area) => (
                      <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">{area}</th>
                    ))
                  }
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {mile_data?.map((item) => {
                  return <tr className="">
                    <td className="px-6 py-2 text-sm whitespace-normal border border-gray-100">{item.work_package}</td>
                    <td className="px-2 py-2 text-sm whitespace-normal border border-gray-100">
                      {item.scope_of_work}
                    </td>
                    <td className="px-2 py-2 text-sm whitespace-normal border border-gray-100">{item.milestone}</td>
                    <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">{formatDate(item.start_date)}</td>
                    <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">{formatDate(item.end_date)}</td>
                    {
                      item.status_list?.list.map((area) => (
                        <td className={`px-2 py-2 text-sm whitespace-normal border border-gray-100 ${(area.status === "WIP") ? "text-yellow-500" : area.status === "Completed" ? "text-green-800" : area.status === "Halted" ? "text-red-500" : ""}`}>{(area.status && area.status !== "Pending") ? area.status : "--"}</td>
                      ))
                    }
                  </tr>
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
                        <div className="pt-1 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr>
                  <th colSpan={5} className="p-0">
                    <div className="py-1 border-b-2 border-gray-600 pb-2 mb-1">
                      <div className="flex justify-between">
                        <div className="text-xs text-gray-500 font-normal">1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka</div>
                        <div className="text-xs text-gray-500 font-normal">GST: 29ABFCS9095N1Z9</div>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr>
                  <th colSpan={5} className="p-0">
                    <div className="grid grid-cols-6 gap-4 justify-between border border-gray-100 rounded-lg px-3 py-1 mb-1">
                      <div className="border-0 flex flex-col col-span-2">
                        <p className="text-left py-1 font-medium text-xs text-gray-500">Name and address</p>
                        <p className="text-left font-bold font-semibold text-sm text-black">{data?.project_name}</p>
                      </div>
                      <div className="border-0 flex flex-col col-span-2">
                        <p className="text-left py-1 font-medium text-xs text-gray-500">Start Date & End Date</p>
                        <p className="text-left font-bold font-semibold text-sm text-black">{formatDate(data?.project_start_date)} to {formatDate(data?.project_end_date)}</p>
                      </div>
                      <div className="border-0 flex flex-col col-span-2">
                        <p className="text-left py-1 font-medium text-xs text-gray-500">Work Package</p>
                        <p className="text-left font-bold font-semibold text-sm text-black">{data && JSON.parse(data?.project_work_packages!).work_packages.map((item) => item.work_package_name).join(", ")}</p>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr>
                  <th scope="col" className="px-6 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Work Package</th>
                  <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Scope of Work</th>
                  <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Milestone</th>
                  <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Start Date</th>
                  <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">End Date</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {mile_data?.map((item) => {
                  return <tr className="">
                    <td className="px-6 py-2 text-sm whitespace-normal border border-gray-100">{item.work_package}</td>
                    <td className="px-2 py-2 text-sm whitespace-normal border border-gray-100">
                      {item.scope_of_work}
                    </td>
                    <td className="px-2 py-2 text-sm whitespace-normal border border-gray-100">{item.milestone}</td>
                    <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">{formatDate(item.start_date)}</td>
                    <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">{formatDate(item.end_date)}</td>
                  </tr>
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
                        <div className="pt-1 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr>
                  <th colSpan={6 + areaNames?.length} className="p-0">
                    <div className="py-1 border-b-2 border-gray-600 pb-2 mb-1">
                      <div className="flex justify-between">
                        <div className="text-xs text-gray-500 font-normal">1st Floor, 234, 9th Main, 16th Cross, Sector 6, HSR Layout, Bengaluru - 560102, Karnataka</div>
                        <div className="text-xs text-gray-500 font-normal">GST: 29ABFCS9095N1Z9</div>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr>
                  <th colSpan={6 + areaNames?.length} className="p-0">
                    <div className="grid grid-cols-6 gap-4 justify-between border border-gray-100 rounded-lg px-3 py-1 mb-1">
                      <div className="border-0 flex flex-col col-span-2">
                        <p className="text-left py-1 font-medium text-xs text-gray-500">Name and address</p>
                        <p className="text-left font-bold font-semibold text-sm text-black">{data?.project_name}</p>
                        <p className="text-left py-1 font-medium text-xs text-gray-500">Date : {formattedDate}</p>
                      </div>
                      <div className="border-0 flex flex-col col-span-2">
                        <p className="text-left py-1 font-medium text-xs text-gray-500">Start Date & End Date</p>
                        <p className="text-left font-bold font-semibold text-sm text-black">{formatDate(data?.project_start_date)} to {formatDate(data?.project_end_date)}</p>
                      </div>
                      <div className="border-0 flex flex-col col-span-2">
                        <p className="text-left py-1 font-medium text-xs text-gray-500">Work Package</p>
                        <p className="text-left font-bold font-semibold text-sm text-black">{data && JSON.parse(data?.project_work_packages!).work_packages.map((item) => item.work_package_name).join(", ")}</p>
                      </div>
                    </div>
                  </th>
                </tr>
                <tr>
                  <th scope="col" className="px-6 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Work Package</th>
                  <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Scope of Work</th>
                  <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Milestone</th>
                  <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Start Date</th>
                  <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">End Date</th>
                  {/* <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Status - Common Area</th> */}
                  {
                    areaNames?.map((area) => (
                      <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">{area}</th>
                    ))
                  }
                </tr>
              </thead>
              {/* <tbody className="bg-white divide-y divide-gray-200">
                {mile_data?.map((item) => {
                  console.log("item", item)
                  const today = new Date().toISOString().split("T")[0];
                  const modifiedDate = new Date(item.modified).toISOString().split("T")[0];
                  if(modifiedDate === today) {
                  return <tr className="">
                    <td className="px-6 py-2 text-sm whitespace-normal border border-gray-100">{item.work_package}</td>
                    <td className="px-2 py-2 text-sm whitespace-normal border border-gray-100">
                      {item.scope_of_work}
                    </td>
                    <td className="px-2 py-2 text-sm whitespace-normal border border-gray-100">{item.milestone}</td>
                    <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">{formatDate(item.start_date)}</td>
                    <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">{formatDate(item.end_date)}</td>
                    {
                      item.status_list?.list.map((area) => (
                        <td className={`px-2 py-2 text-sm whitespace-normal border border-gray-100 ${(area.status === "WIP") ? "text-yellow-500" : area.status === "Completed" ? "text-green-800" : area.status === "Halted" ? "text-red-500" : ""}`}>{(area.status && area.status !== "Pending") ? area.status : "--"}</td>
                      ))
                    }
                  </tr>
                  } else {
                    return <div>No milestones updated for today yet</div>
                  }
                })}
              </tbody> */}
              <tbody className="bg-white divide-y divide-gray-200">
                {mile_data?.filter(item => {
                  const today = new Date().toISOString().split("T")[0];
                  const modifiedDate = new Date(item.modified).toISOString().split("T")[0];
                  const equal = item.modified !== item.creation
                  return modifiedDate === today && equal;
                }).length > 0 ? (
                  mile_data.map((item, index) => {
                    const today = new Date().toISOString().split("T")[0];
                    const modifiedDate = new Date(item.modified).toISOString().split("T")[0];
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
                              {area.status && area.status !== "Pending" ? area.status : "--"}
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
  )
}


export const CategoryAccordion = ({ categorizedData, selectedPackage, projectEstimates }) => {

  const selectedData = categorizedData?.[selectedPackage] || null;

  const defaultValues = selectedData && Object.keys(selectedData)

  // console.log("defaultValues", defaultValues)

  return (
    <div className="w-full">
      {selectedData ? (
        <div className="flex flex-col gap-4">
          {defaultValues?.length > 0 && (
            <Accordion type="multiple" className="space-y-4" defaultValue={defaultValues || []}>
              {Object.entries(selectedData)?.sort(([a], [b]) => a?.localeCompare(b))?.map(([category, items]) => {
                const totalAmount = items.reduce((sum, item) =>
                  sum + parseFloat(item?.amount),
                  0
                );

                const categoryEstimates = projectEstimates?.filter((i) => i?.category === category)
                const totalCategoryEstdAmt = categoryEstimates?.reduce((sum, item) =>
                  sum + parseFloat(item?.rate_estimate) * parseFloat(item?.quantity_estimate) * (1 + parseFloat(item?.item_tax) / 100),
                  0
                )
                return (
                  <AccordionItem key={category} value={category} defaultChecked className="border-b rounded-lg shadow">
                    <AccordionTrigger className="bg-[#FFD3CC] px-4 py-2 rounded-lg text-blue-900 flex justify-between items-center">
                      <div className="flex space-x-4 text-sm text-gray-600">
                        <span className="font-semibold">{category}:</span>
                        <span>Total Amount: ₹{totalAmount.toLocaleString()}</span>
                        <span>Total Estd Amount: {formatToIndianRupee(totalCategoryEstdAmt)}</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <Table className="min-w-full text-left text-sm">
                        <TableHeader>
                          <TableRow className="bg-gray-100 text-gray-700">
                            <TableHead className="px-4 py-2 font-semibold">Item ID</TableHead>
                            <TableHead className="px-4 py-2 font-semibold w-[40%]">Item Name</TableHead>
                            <TableHead className="px-4 py-2 font-semibold">Unit</TableHead>
                            <TableHead className="px-4 py-2 font-semibold">Qty Ordered</TableHead>
                            <TableHead className="px-4 py-2 font-semibold">Estd Qty</TableHead>
                            <TableHead className="px-4 py-2 font-semibold">Amt Spent</TableHead>
                            <TableHead className="px-4 py-2 font-semibold">Estd. Amt</TableHead>
                            <TableHead className="px-4 py-2 font-semibold">Updated Estd. Amt</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {items?.map((item) => {
                            const estimateItem = projectEstimates?.find((i) => i?.item === item?.item_id);
                            const quantityDif = item?.quantity - estimateItem?.quantity_estimate
                            let dynamicQtyClass = null;

                            if (estimateItem) {
                              if (quantityDif > 0) {
                                dynamicQtyClass = "text-primary"
                              } else if (quantityDif < 0 && Math.abs(quantityDif) < 5) {
                                dynamicQtyClass = "text-yellow-600"
                              } else if (quantityDif === 0) {
                                dynamicQtyClass = "text-green-500"
                              } else {
                                dynamicQtyClass = "text-blue-500"
                              }
                            }

                            const updated_estd_amt = estimateItem?.quantity_estimate > item?.quantity ? (estimateItem?.quantity_estimate * item?.averageRate) : item.amount

                            const percentage_change = Math.floor(((updated_estd_amt - (estimateItem?.rate_estimate * estimateItem?.quantity_estimate)) / (estimateItem?.rate_estimate * estimateItem?.quantity_estimate)) * 100)

                            return <TableRow key={item.item_id}>
                              <TableCell className="px-4 py-2">{item.item_id.slice(5)}</TableCell>
                              <TableCell className="px-4 py-2">{item.item_name}</TableCell>
                              <TableCell className="px-4 py-2">{item.unit}</TableCell>
                              <TableCell className={`px-4 py-2 ${dynamicQtyClass}`}>{item.quantity}</TableCell>
                              <TableCell className="px-4 py-2">{estimateItem?.quantity_estimate || "--"}</TableCell>
                              <TableCell className="px-4 py-2">₹{parseFloat(item.amount).toLocaleString()}</TableCell>
                              {/* <TableCell className="px-4 py-2">{formatToIndianRupee((estimateItem?.rate_estimate * (1 + parseFloat(estimateItem?.item_tax / 100))) * estimateItem?.quantity_estimate)}</TableCell> */}
                              <TableCell className="px-4 py-2">{formatToIndianRupee(estimateItem?.rate_estimate * estimateItem?.quantity_estimate)}</TableCell>
                              <TableCell className={`px-4 py-2 ${estimateItem?.quantity_estimate !== undefined ? (updated_estd_amt > (estimateItem?.rate_estimate * estimateItem?.quantity_estimate) ? "text-red-500" : "text-green-500") : ""}`}>{estimateItem?.quantity_estimate !== undefined ? formatToIndianRupee(updated_estd_amt) : "--"}{estimateItem?.quantity_estimate !== undefined && ` (${percentage_change}%)`}</TableCell>
                            </TableRow>
                          })}
                        </TableBody>
                      </Table>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </div>
      ) : (
        <div className="h-[10vh] flex items-center justify-center">No Results.</div>
      )}
    </div>
  );
};


export const ToolandEquipementAccordion = ({ projectEstimates, categorizedData }) => {

  const selectedData = categorizedData?.["Tool & Equipments"] || null;

  const toolandEquipEstimates = projectEstimates?.filter((p) => p?.work_package === "Tool & Equipments")

  return (
    <div className="w-full">
      {selectedData ? (
        <div className="flex flex-col gap-4">
          <Accordion type="multiple" className="space-y-4">
            {Object.entries(selectedData)?.sort(([a], [b]) => a?.localeCompare(b))?.map(([category, items]) => {
              const totalAmount = items.reduce((sum, item) =>
                sum + parseFloat(item?.amount),
                0
              );

              // const categoryEstimates = projectEstimates?.filter((i) => i?.category === category)
              // const totalCategoryEstdAmt = categoryEstimates?.reduce((sum, item) => 
              //   sum + parseFloat(item?.rate_estimate) * parseFloat(item?.quantity_estimate) * (1 + parseFloat(item?.item_tax) / 100),
              // 0
              // )
              return (
                <AccordionItem key={category} value={category} className="border-b rounded-lg shadow">
                  <AccordionTrigger className="bg-[#FFD3CC] px-4 py-2 rounded-lg text-blue-900 flex justify-between items-center">
                    <div className="flex space-x-4 text-sm text-gray-600">
                      <span className="font-semibold">{category}:</span>
                      <span>Total Amount: ₹{totalAmount.toLocaleString()}</span>
                      {/* <span>Total Estd Amount: {formatToIndianRupee(totalCategoryEstdAmt)}</span> */}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <Table className="min-w-full text-left text-sm">
                      <TableHeader>
                        <TableRow className="bg-gray-100 text-gray-700">
                          <TableHead className="px-4 py-2 font-semibold">Item ID</TableHead>
                          <TableHead className="px-4 py-2 font-semibold w-[40%]">Item Name</TableHead>
                          <TableHead className="px-4 py-2 font-semibold">Unit</TableHead>
                          <TableHead className="px-4 py-2 font-semibold">Qty Ordered</TableHead>
                          <TableHead className="px-4 py-2 font-semibold">Estd Qty</TableHead>
                          <TableHead className="px-4 py-2 font-semibold">Amt Spent</TableHead>
                          <TableHead className="px-4 py-2 font-semibold">Estd. Amt</TableHead>
                          <TableHead className="px-4 py-2 font-semibold">Updated Estd. Amt</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items?.map((item) => {
                          const estimateItem = toolandEquipEstimates?.find((i) => i?.item === item?.item_id);
                          // const quantityDif = item?.quantity - estimateItem?.quantity_estimate
                          // let dynamicQtyClass = null;

                          // if(estimateItem) {
                          //   if(quantityDif > 0) {
                          //     dynamicQtyClass = "text-primary"
                          //   } else if (quantityDif < 0 && Math.abs(quantityDif) < 5) {
                          //     dynamicQtyClass = "text-yellow-600"
                          //   } else if(quantityDif === 0) {
                          //     dynamicQtyClass = "text-green-500"
                          //   } else {
                          //     dynamicQtyClass = "text-blue-500"
                          //   }
                          // }

                          // console.log("estimateItme", estimateItem)

                          const updated_estd_amt = estimateItem?.quantity_estimate > item?.quantity ? (estimateItem?.quantity_estimate * item?.averageRate) : item.amount

                          const percentage_change = Math.floor(((updated_estd_amt - (estimateItem?.rate_estimate * estimateItem?.quantity_estimate)) / (estimateItem?.rate_estimate * estimateItem?.quantity_estimate)) * 100)

                          return <TableRow key={item.item_id}>
                            <TableCell className="px-4 py-2">{item.item_id.slice(5)}</TableCell>
                            <TableCell className="px-4 py-2">{item.item_name}</TableCell>
                            <TableCell className="px-4 py-2">{item.unit}</TableCell>
                            <TableCell className={`px-4 py-2`}>{item.quantity}</TableCell>
                            <TableCell className="px-4 py-2">{estimateItem?.quantity_estimate || "--"}</TableCell>
                            <TableCell className="px-4 py-2">₹{parseFloat(item.amount).toLocaleString()}</TableCell>
                            <TableCell className="px-4 py-2">{formatToIndianRupee(estimateItem?.rate_estimate * estimateItem?.quantity_estimate)}</TableCell>
                            <TableCell className={`px-4 py-2 ${estimateItem?.quantity_estimate !== undefined ? (updated_estd_amt > (estimateItem?.rate_estimate * estimateItem?.quantity_estimate) ? "text-red-500" : "text-green-500") : ""}`}>{estimateItem?.quantity_estimate !== undefined ? formatToIndianRupee(updated_estd_amt) : "--"}{estimateItem?.quantity_estimate !== undefined && ` (${percentage_change}%)`}</TableCell>
                          </TableRow>
                        })}
                      </TableBody>
                    </Table>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>
      ) : (
        <div className="h-[10vh] flex items-center justify-center">No Results.</div>
      )}
    </div>
  );
};


export const ServiceRequestsAccordion = ({ projectEstimates, segregatedData }) => {
  const [expandedRowKeys, setExpandedRowKeys] = useState([]);

  useEffect(() => {
    if (segregatedData) {
      setExpandedRowKeys(Object.keys(segregatedData));
    }
  }, [segregatedData]);

  console.log("segregatedData", segregatedData)

  // Main table columns
  const columns = [
    {
      title: "Category",
      dataIndex: "category",
      key: "category",
      width: "60%",
      render: (text) => <strong className="text-primary">{text}</strong>,
    },
    {
      title: "Amount",
      dataIndex: "amount",
      key: "amount",
      width: "20%",
      render: (text) => <span>{text ? formatToIndianRupee(text) : "--"}</span>
    },
    {
      title: "Estd. Amount",
      dataIndex: "estimate_total",
      key: "estimate_total",
      width: "30%",
      render: (text) => <span>{text ? formatToIndianRupee(text) : "--"}</span>
    },
  ];

  const innerColumns = [
    {
      title: "Description",
      dataIndex: "description",
      key: "description",
      width: "40%",
    },
    {
      title: "Unit",
      dataIndex: "uom",
      key: "unit",
      width: "20%",
    },
    {
      title: "Quantity",
      dataIndex: "quantity",
      key: "quantity",
      width: "20%",
    },
    {
      title: "Amount",
      dataIndex: "amount",
      key: "amount",
      width: "20%",
      render: (text) => <span className="italic">{text ? formatToIndianRupee(text) : "--"}</span>,
    },
  ];

  return (
    <div className="w-full">
      {segregatedData?.length > 0 ? (
        <div className="pt-6 overflow-x-auto">
          <ConfigProvider>
            <AntTable
              dataSource={segregatedData?.sort((a,b) => Object.keys(a)[0]?.localeCompare(Object.keys(b)[0]))?.map((key) => ({
                key: Object.values(key)[0]?.key,
                amount: Object.values(key)[0]?.amount,
                estimate_total: Object.values(key)[0]?.estimate_total,
                category: Object.keys(key)[0],
                items: Object.values(key)[0]?.children,
              }))}
              columns={columns}
              expandable={{
                expandedRowKeys,
                onExpandedRowsChange: setExpandedRowKeys,
                expandedRowRender: (record) => (
                  <AntTable
                    dataSource={record.items}
                    columns={innerColumns}
                    pagination={false}
                    rowKey={(item) => item.id || uuidv4()}
                  />
                ),
              }}
              rowKey="key"
            />
          </ConfigProvider>
        </div>
      ) : (<div className="h-[10vh] flex items-center justify-center">No Results.</div>)}
    </div>
  );
};



const CustomHoverCard = ({ totalPosRaised, totalServiceOrdersAmt, categorizedData, workPackageTotalAmounts }) => {
  // Generate tree data for the Tree component
  const generateTreeData = () => {
    const treeData = categorizedData && Object.entries(categorizedData)?.map(([workPackage, categories]) => {
      // Children for each category in the work package
      const categoryNodes = Object.entries(categories).map(([category, items]) => {
        const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
        const totalAmountWithTax = items.reduce((sum, item) => sum + item.amountWithTax, 0);

        return {
          title: `${category}: ₹${parseFloat(totalAmountWithTax).toLocaleString()} (Base: ₹${parseFloat(totalAmount).toLocaleString()})`,
          key: `${workPackage}-${category}`,
          children: items.map((item, index) => ({
            title: `${item.item_name} - Qty: ${item.quantity}`,
            key: `${workPackage}-${category}-${index}`,
          })),
        };
      });

      return {
        title: `${workPackage} - Total: ₹${parseFloat(workPackageTotalAmounts[workPackage]?.amountWithoutTax).toLocaleString()}`,
        key: workPackage,
        children: categoryNodes,
      };
    });

    // Add service requests total as a standalone item
    if(totalServiceOrdersAmt) {
      treeData?.push({
        title: `Service Requests Total: ₹${parseFloat(totalServiceOrdersAmt).toLocaleString()}`,
        key: 'service-requests-total',
      });
    }

    return treeData;
  };

  return (
    <HoverCard>
      <HoverCardTrigger>
        <div className="ml-2 underline">
          <span className="whitespace-nowrap">Total Spent: </span>
          <span className="max-sm:text-end max-sm:w-full text-primary">
            {formatToIndianRupee(totalPosRaised() + totalServiceOrdersAmt)}
          </span>
        </div>
      </HoverCardTrigger>
      <HoverCardContent className="overflow-y-auto max-h-[80vh]">
        {generateTreeData()?.length !== 0 ? (
            <div>
            <h3 className="font-semibold text-lg mb-2">Total Spent Breakdown</h3>
            <Tree
              showLine
              switcherIcon={<DownOutlined />}
              defaultExpandedKeys={['0-0']}
              treeData={generateTreeData()}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center font-semibold text-xs">Empty!</div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
};