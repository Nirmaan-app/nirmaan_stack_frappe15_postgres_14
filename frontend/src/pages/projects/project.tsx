// import { DataTable } from "@/components/data-table/data-table"
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
// import { Badge } from "@/components/ui/badge"
// import { Button } from "@/components/ui/button"
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
// import { Projects } from "@/types/NirmaanStack/Projects"
// import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk"
// import { ArrowLeft, HardHat } from "lucide-react"
// import { useMemo } from "react"
// import { Link, useNavigate, useParams } from "react-router-dom"
// import { useReactToPrint } from 'react-to-print';
import redlogo from "@/assets/red-logo.png"
// import React from 'react';
// import { ProjectSkeleton, TableSkeleton } from "@/components/ui/skeleton"
// import { useToast } from "@/components/ui/use-toast"

import { ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { OverviewSkeleton, OverviewSkeleton2, Skeleton, TableSkeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/use-toast"
import { ConfigProvider, Menu, MenuProps } from "antd"
import { useFrappeCreateDoc, useFrappeGetDoc, useFrappeGetDocList, useFrappeGetCall, useFrappeUpdateDoc } from "frappe-react-sdk"
import { ArrowLeft, Check, CheckCircleIcon, ChevronDownIcon, ChevronRightIcon, ChevronsUpDown, CirclePlus, Download, FilePenLine, ListChecks, UserCheckIcon } from "lucide-react"
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

const statuses = [
  { value: 'WIP', label: 'WIP' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Halted', label: 'Halted' }
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

  const { data: mile_data, isLoading: mile_isloading } = useFrappeGetDocList("Project Work Milestones", {
    fields: ["*"],
    filters: [["project", "=", `${projectId}`]],
    limit: 1000,
    orderBy: { field: "start_date", order: "asc" }
  },
    `Project Work MileStones ${projectId}`,
    {
      revalidateIfStale: false
    }
  )

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
  },
    "Nirmaan Users"
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
    filters: [["project", "=", projectId], ["status", "!=", "PO Approved"]],
    limit: 1000,
    orderBy: { field: "creation", order: "desc" }
  },
    `Procurement Orders ${projectId}`
  )


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
            return itemAcc + (baseAmount + taxAmount);
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
      label: 'Procurement Summary',
      key: 'procurementSummary',
    },
    role === "Nirmaan Admin Profile" ? {
      label: 'PO Summary',
      key: 'POSummary',
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

  const { data: quote_data } = useFrappeGetDocList("Approved Quotations",
    {
      fields: ['item_id', 'quote'],
      limit: 10000
    });

  const getTotal = (order_id) => {
    let total: number = 0;
    const orderData = pr_data?.find(item => item.name === order_id)?.procurement_list;
    // console.log("orderData", orderData)
    orderData?.list.map((item: any) => {
      const quotesForItem = quote_data
        ?.filter(value => value.item_id === item.name && value.quote != null)
        ?.map(value => value.quote);
      let minQuote;
      if (quotesForItem && quotesForItem.length) minQuote = Math.min(...quotesForItem);
      total += (minQuote ? parseFloat(minQuote) : 0) * item.quantity;
    })
    return total || "N/A";
  }

  const getItemStatus = (item: any, filteredPOs: any[]) => {
    return filteredPOs.some(po =>
      po.order_list?.list.some(poItem => poItem.name === item.name)
    );
  };

  const statusRender = (status: string, prId: string) => {
    const procurementRequest = pr_data?.find((pr) => pr?.name === prId);

    const itemList = procurementRequest?.procurement_list?.list || [];

    if (["Pending", "Approved", "Rejected"].includes(status)) {
      return "New PR";
    }

    const filteredPOs = po_data?.filter(po => po.procurement_request === prId) || [];
    const allItemsApproved = itemList.every(item => { return getItemStatus(item, filteredPOs); });

    return allItemsApproved ? "Approved PO" : "Open PR";
  };

  const statusOptions = [
    { label: "New PR", value: "New PR" },
    { label: "Open PR", value: "Open PR" },
    { label: "Approved PO", value: "Approved PO" },
  ]

  const procurementSummaryColumns = [
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
        return (
          <div className="flex flex-col gap-1 items-start justify-center">
            {row.getValue("category_list").list.map((obj) => <Badge className="inline-block">{obj["name"]}</Badge>)}
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

  const [current, setCurrent] = useState('overview')

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
        description: `Successfully assigned ${getUserFullName(selectedUser)}`,
        variant: "success"
      })
    } catch (error) {
      console.log("error", error)
      toast({
        title: "Failed!",
        description: `Failed to assign ${getUserFullName(selectedUser)}`,
        variant: "destructive"
      })
    } finally {
      setSelectedUser(null)
    }
  }

  const groupItemsByWorkPackageAndCategory = (items) => {
    return items?.reduce((acc, item) => {
      const baseAmount = parseFloat(item.quote) * parseFloat(item.quantity);
      const taxAmount = baseAmount * (parseFloat(item.tax) / 100);
      const amountWithTax = baseAmount + taxAmount;

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
        existingItem.amount += amountWithTax;
      } else {
        acc[item.work_package][item.category].push({
          ...item,
          amount: amountWithTax
        });
      }

      return acc;
    }, {});
  };

  // Usage
  const categorizedData = groupItemsByWorkPackageAndCategory(po_item_data);

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

  const workPackages = JSON.parse(data?.project_work_packages)?.work_packages || [];

  const handleStatusChange = (value: string) => {
    if (value === data?.status) {
      setPopOverStatus()
      return
    }
    if (statuses.some(s => s.value === value)) {
      setNewStatus(value)
      setShowStatusChangeDialog(true)
    }
  }

  const handleConfirmStatus = async () => {
    // console.log("YAY")
    try {
      await updateDoc("Projects", data?.name, { status: newStatus })
      await project_mutate()
      toast({
        title: "Success!",
        description: `Successfully changed status to ${newStatus}`,
        variant: "success"
      })
    } catch (error) {
      console.log("error", error)
      toast({
        title: "Failed!",
        description: `Failed to changed status to ${newStatus}`,
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

  return (
    <div className="flex-1 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <ArrowLeft className="mt-1.5 cursor-pointer" onClick={() => navigate("/projects")} />
          <h2 className="pl-2 text-xl md:text-3xl font-bold tracking-tight">{data?.project_name.toUpperCase()}</h2>
          {role === "Nirmaan Admin Profile" && <FilePenLine onClick={() => navigate('edit')} className="w-10 text-blue-300 hover:-translate-y-1 transition hover:text-blue-600 cursor-pointer" />}
        </div>
        {role === "Nirmaan Admin Profile" && <div className="flex max-sm:text-xs max-md:text-sm text-right items-center">
          <Popover open={popOverOpen} onOpenChange={setPopOverStatus}>
            <PopoverTrigger asChild>
              <Button variant='outline' role="combobox" aria-expanded={open} className="w-40">
                {statuses.find((s) => s.value === data?.status)?.label || "N/A"}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-0">
              <Command>
                <CommandList>
                  <CommandGroup>
                    {statuses.map((s) => (
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
                  {statuses.find((s) => s.value === data?.status)?.label || "Unknown"} "
                  to "{statuses.find((s) => s.value === newStatus)?.label || "Unknown"}".
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={handleCancelStatus}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleConfirmStatus}>Continue</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <div className="ml-2">
            <span className=" whitespace-nowrap">Total PO's raised: </span>
            <span className="max-sm:text-end max-sm:w-full text-primary">{formatToIndianRupee(totalPosRaised())}</span>
          </div>
        </div>}
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
                {data?.project_name}
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
        current === "procurementSummary" && (
          prData_loading ? (<TableSkeleton />) :
            <DataTable columns={procurementSummaryColumns} data={pr_data || []} statusOptions={statusOptions} />
        )
      }

      {current === "POSummary" && (
        <>
          <div className="w-full">
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
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedPackage ? (
            <CategoryAccordion categorizedData={categorizedData} selectedPackage={selectedPackage} />
          ) : <div className="h-[40vh] flex items-center justify-center"> Please select a Work Package</div>}
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
                        <img className="w-44" src={redlogo} alt="Nirmaan" />
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
                        <img className="w-44" src={redlogo} alt="Nirmaan" />
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
                        <img className="w-44" src={redlogo} alt="Nirmaan" />
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


const CategoryAccordion = ({ categorizedData, selectedPackage }) => {

  const selectedData = categorizedData[selectedPackage] || null;

  return (
    <div className="w-full">
      {selectedData ? (
        <div className="flex flex-col gap-4">
          <Accordion type="multiple" className="space-y-4">
            {Object.entries(selectedData).map(([category, items]) => {
              const totalAmount = items.reduce((sum, item) =>
                sum + parseFloat(item.quote) * parseFloat(item.quantity) * (1 + parseFloat(item.tax) / 100),
                0
              );
              return (
                <AccordionItem key={category} value={category} className="border-b rounded-lg shadow">
                  <AccordionTrigger className="bg-[#FFD3CC] px-4 py-2 rounded-lg text-blue-900 flex justify-between items-center">
                    <div className="flex space-x-4 text-sm text-gray-600">
                      <span className="font-semibold">{category}:</span>
                      <span>Total Amount: ₹{totalAmount.toLocaleString()}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <Table className="min-w-full text-left text-sm">
                      <TableHeader>
                        <TableRow className="bg-gray-100 text-gray-700">
                          <TableHead className="px-4 py-2 font-semibold">Item ID</TableHead>
                          <TableHead className="px-4 py-2 font-semibold w-[40%]">Item Name</TableHead>
                          <TableHead className="px-4 py-2 font-semibold">Qty</TableHead>
                          <TableHead className="px-4 py-2 font-semibold">Unit</TableHead>
                          <TableHead className="px-4 py-2 font-semibold">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items?.map((item) => (
                          <TableRow key={item.item_id}>
                            <TableCell className="px-4 py-2">{item.item_id.slice(5)}</TableCell>
                            <TableCell className="px-4 py-2">{item.item_name}</TableCell>
                            <TableCell className="px-4 py-2">{item.quantity}</TableCell>
                            <TableCell className="px-4 py-2">{item.unit}</TableCell>
                            <TableCell className="px-4 py-2">₹{parseFloat(item.amount).toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>
      ) : (
        <div className="h-[60vh] flex items-center justify-center">No Results.</div>
      )}
    </div>
  );
};



