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
import { useToast } from "@/components/ui/use-toast"
import { Menu, MenuProps, TableProps } from "antd"
import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk"
import { ArrowLeft, CheckCircleIcon, ChevronDownIcon, ChevronRightIcon, Download, FilePenLine } from "lucide-react"
import React, { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import StatusBar from "@/components/ui/status-bar"
import { Button } from "@/components/ui/button"
import { useReactToPrint } from "react-to-print"
import { formatDate } from "@/utils/FormatDate"

// interface WPN {
//     name: string
// }

// type ScopesMilestones = {
//     work_package: string
//     scope_of_work: string
//     milestone: string
// }

// const Project = () => {
//     const { projectId } = useParams<{ projectId: string }>()

//     return (
//         <div>
//             {projectId && <ProjectView projectId={projectId} />}
//         </div>
//     )
// }

// export const Component = Project

// const ProjectView = ({ projectId }: { projectId: string }) => {

//     const navigate = useNavigate();

//     const { toast } = useToast()

//     const columns: ColumnDef<ScopesMilestones>[] = useMemo(
//         () => [
//             {
//                 accessorKey: "work_package",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="Work Package" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     return (
//                         <div className="font-medium">
//                             {row.getValue("work_package")}
//                         </div>
//                     )
//                 }
//             },
//             {
//                 accessorKey: "scope_of_work",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="Scope of work" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     return (
//                         <div className="font-medium">
//                             {row.getValue("scope_of_work")}
//                         </div>
//                     )
//                 }
//             },
//             {
//                 accessorKey: "milestone",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="Milestone" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     return (
//                         <div className="font-medium">
//                             {row.getValue("milestone")}
//                         </div>
//                     )
//                 }
//             },
//             {
//                 accessorKey: "start_date",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="Start Date" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     return (
//                         <div className="font-medium">
//                             {row.getValue("start_date")}
//                         </div>
//                     )
//                 }
//             },
//             {
//                 accessorKey: "end_date",
//                 header: ({ column }) => {
//                     return (
//                         <DataTableColumnHeader column={column} title="End Date" />
//                     )
//                 },
//                 cell: ({ row }) => {
//                     return (
//                         <div className="font-medium">
//                             {row.getValue("end_date")}
//                         </div>
//                     )
//                 }
//             }

//         ],
//         []
//     )

//     const { data, error, isValidating } = useFrappeGetDoc<Projects>(
//         'Projects',
//         `${projectId}`
//     );

//     const today = new Date();
//     const formattedDate = today.toLocaleDateString('en-US', {
//         year: 'numeric',
//         month: 'long',
//         day: 'numeric'
//     });
//     const componentRef = React.useRef<HTMLDivElement>(null);
//     const handlePrint = useReactToPrint({
//         content: () => {
//             // console.log("Print Report button Clicked");
//             return componentRef.current || null
//         },
//         documentTitle: `${formattedDate}_${data?.project_name}_${data?.project_city}_${data?.project_state}_${data?.owner}_${data?.creation}`
//     });
//     const componentRef2 = React.useRef<HTMLDivElement>(null);
//     const handlePrint2 = useReactToPrint({
//         content: () => {
//             // console.log("Print Schedule button Clicked");
//             return componentRef.current || null
//         },
//         documentTitle: `${data?.project_name}_${data?.project_city}_${data?.project_state}_${data?.owner}_${data?.creation}`
//     });


//     const { data: mile_data, isLoading: mile_isloading, error: mile_error } = useFrappeGetDocList("Project Work Milestones", {
//         fields: ["work_package", "scope_of_work", "milestone", "start_date", "end_date"],
//         filters: [["project", "=", `${data?.name}`]],
//         limit: 1000
//     })


//     if (isValidating) return <ProjectSkeleton />
//     if (error || mile_error) {
//         console.log("Error in project.tsx", error?.message, mile_error?.message)
//         toast({
//             title: "Error!",
//             description: `Error ${error?.message || mile_error?.message}`,
//             variant: "destructive"
//         })
//     }

//     // console.log("data", data)
//     return (
//         <div className="flex-1 space-y-4 p-8 pt-4">
//             {/* <div className="flex items-center justify-between space-y-2">
//                     <Breadcrumb>
//                         <BreadcrumbItem>
//                             <Link to="/" className="md:text-base text-sm">Dashboard</Link>
//                         </BreadcrumbItem>
//                         <BreadcrumbItem>
//                             <Link to="/projects" className="md:text-base text-sm">Projects</Link>
//                         </BreadcrumbItem>
//                         <BreadcrumbItem isCurrentPage>
//                             <Link to="/projects/edit" className="text-gray-400 md:text-base text-sm">
//                                 {projectId}
//                             </Link>
//                         </BreadcrumbItem>
//                     </Breadcrumb>
//                 </div> */}
//             {data ? (
//                 <>
//                     <div className="flex items-center justify-between space-y-2">
//                         <div className="flex">
//                             <ArrowLeft className="mt-1.5 cursor-pointer" onClick={() => navigate("/projects")} />
//                             <h2 className="pl-1 text-2xl font-bold tracking-tight">{data.project_name}</h2>
//                         </div>
//                         <div className="flex space-x-2">
//                             <Button className="cursor-pointer" onClick={() => handlePrint()}>
//                                 Report
//                             </Button>
//                             <Button className="cursor-pointer" onClick={() => handlePrint2()}>
//                                 Schedule
//                             </Button>
//                             <Button asChild>
//                                 <Link to={`/projects/${projectId}/edit`}> Edit Project</Link>
//                             </Button>
//                         </div>
//                     </div>
//                     <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
//                         <Card>
//                             <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
//                                 <CardTitle className="text-2xl font-bold">
//                                     Project Details
//                                 </CardTitle>
//                                 <HardHat className="h-4 w-4 text-muted-foreground" />
//                             </CardHeader>
//                             <CardContent>
//                                 <Card>
//                                     <CardContent>
//                                         <br />
//                                         <div className="flex flex-row">
//                                             <div className="basis-1/2 flex flex-col">
//                                                 <div className="pt-2 pb-2">
//                                                     <div className="text-l text-muted-foreground">
//                                                         <p>Name</p>
//                                                     </div>
//                                                     <p className="text-xl font-medium">{data.project_name}</p>
//                                                 </div>
//                                                 <div className="pt-2 pb-2">
//                                                     <div className="text-l text-muted-foreground">
//                                                         <p>Start Date & End Date</p>
//                                                     </div>
//                                                     <p className="text-xl font-medium">{data.project_start_date + " to " + data.project_end_date}</p>
//                                                 </div>
//                                                 <div className="pt-2 pb-2">
//                                                     <div className="text-l text-muted-foreground">
//                                                         <p>Estimated Completion Date</p>
//                                                     </div>
//                                                     <p className="text-xl font-medium">{data.project_end_date}</p>
//                                                 </div>
//                                             </div>
//                                             <div className="basis-1/2 flex flex-col">
//                                                 <div className="pt-2 pb-2">
//                                                     <div className="text-l text-muted-foreground">
//                                                         <p>Location</p>
//                                                     </div>
//                                                     <p className="text-xl font-medium">{data.project_city + ", " + data.project_state}</p>
//                                                 </div>
//                                                 <div className="pt-2 pb-2">
//                                                     <div className="text-l text-muted-foreground">
//                                                         <p>Area</p>
//                                                     </div>
//                                                     <p className="text-xl font-medium">PLACEHOLDER</p>
//                                                 </div>
//                                                 <div className="pt-2 pb-2">
//                                                     <div className="text-l text-muted-foreground">
//                                                         <p>No. of Sections in Layout</p>
//                                                     </div>
//                                                     <p className="text-xl font-medium">{data.subdivisions}</p>
//                                                 </div>
//                                             </div>


//                                         </div>
//                                     </CardContent>
//                                 </Card>

//                             </CardContent>
//                         </Card>
//                         <div className="grid gap-4 md:grid-rows-3 lg:grid-rows-3">
//                             <Card>
//                                 <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
//                                     <CardTitle className="text-2xl font-bold">
//                                         Work Package
//                                     </CardTitle>
//                                     <HardHat className="h-4 w-4 text-muted-foreground" />
//                                 </CardHeader>
//                                 <CardContent>
//                                     {JSON.parse(data.project_work_milestones).work_packages.map((wp: WPN) => (
//                                         <Badge variant="outline">{wp.work_package_name}</Badge>
//                                     )) || ""}
//                                 </CardContent>
//                             </Card>
//                             <Card>
//                                 <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
//                                     <CardTitle className="text-2xl font-bold">
//                                         Status
//                                     </CardTitle>
//                                     <HardHat className="h-4 w-4 text-muted-foreground" />
//                                 </CardHeader>
//                                 <CardContent>
//                                     <div className="text-sm font-medium">
//                                         <p>PLACEHOLDER</p>
//                                     </div>
//                                     <p className="text-xs text-muted-foreground">METRIC</p>
//                                 </CardContent>
//                             </Card>
//                             <Card>
//                                 <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
//                                     <CardTitle className="text-2xl font-bold">
//                                         Health Score
//                                     </CardTitle>
//                                     <HardHat className="h-4 w-4 text-muted-foreground" />
//                                 </CardHeader>
//                                 <CardContent>
//                                     <div className="text-sm font-medium">
//                                         <p>PLACEHOLDER</p>
//                                     </div>
//                                     <p className="text-xs text-muted-foreground">METRIC</p>
//                                 </CardContent>
//                             </Card>
//                         </div>
//                     </div>
//                 </>
//             ) : <div>No data</div>
//             }
//             <div className="hidden">
//                 <div ref={componentRef} className="px-4 pb-1">
//                     <div className="overflow-x-auto">
//                         <table className="w-full my-4">
//                             <thead className="w-full">
//                                 <tr>
//                                     <th colSpan="6" className="p-0">
//                                         <div className="mt-1 flex justify-between">
//                                             <div>
//                                                 <img className="w-44" src={redlogo} alt="Nirmaan" />
//                                                 <div className="pt-1 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
//                                             </div>
//                                         </div>
//                                     </th>
//                                 </tr>
//                                 <tr>
//                                     <th colSpan="6" className="p-0">
//                                         <div className="py-1 border-b-2 border-gray-600 pb-2 mb-1">
//                                             <div className="flex justify-between">
//                                                 <div className="text-xs text-gray-500 font-normal">Obeya Verve, 5th Main, Sector 6, HSR Layout, Bangalore, India - 560102</div>
//                                                 <div className="text-xs text-gray-500 font-normal">GST: 29ABFCS9095N1Z9</div>
//                                             </div>
//                                         </div>
//                                     </th>
//                                 </tr>
//                                 <tr>
//                                     <th colSpan="6" className="p-0">
//                                         <div className="grid grid-cols-6 gap-4 justify-between border border-gray-100 rounded-lg px-3 py-1 mb-1">
//                                             <div className="border-0 flex flex-col col-span-2">
//                                                 <p className="text-left py-1 font-medium text-xs text-gray-500">Name and address</p>
//                                                 <p className="text-left font-bold font-semibold text-sm text-black">{data?.project_name}</p>
//                                                 <p className="text-left py-1 font-medium text-xs text-gray-500">Date : {formattedDate}</p>
//                                             </div>
//                                             <div className="border-0 flex flex-col col-span-2">
//                                                 <p className="text-left py-1 font-medium text-xs text-gray-500">Start Date & End Date</p>
//                                                 <p className="text-left font-bold font-semibold text-sm text-black">{data?.project_start_date} to {data?.project_end_date}</p>
//                                             </div>
//                                             <div className="border-0 flex flex-col col-span-2">
//                                                 <p className="text-left py-1 font-medium text-xs text-gray-500">Work Package</p>
//                                                 <p className="text-left font-bold font-semibold text-sm text-black">{JSON.parse(data?.project_work_milestones!).work_packages.map((item) => item.work_package_name).join(", ")}</p>
//                                             </div>
//                                         </div>
//                                     </th>
//                                 </tr>
//                                 <tr>
//                                     <th scope="col" className="px-6 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Work Package</th>
//                                     <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Scope of Work</th>
//                                     <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Milestone</th>
//                                     <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Start Date</th>
//                                     <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">End Date</th>
//                                     <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Status - Common Area</th>
//                                 </tr>
//                             </thead>
//                             <tbody className="bg-white divide-y divide-gray-200">
//                                 {mile_data?.map((item) => {
//                                     return <tr className="">
//                                         <td className="px-6 py-2 text-sm whitespace-normal border border-gray-100">{item.work_package}</td>
//                                         <td className="px-2 py-2 text-sm whitespace-normal border border-gray-100">
//                                             {item.scope_of_work}
//                                         </td>
//                                         <td className="px-2 py-2 text-sm whitespace-normal border border-gray-100">{item.milestone}</td>
//                                         <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">{item.start_date}</td>
//                                         <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">{item.end_date}</td>
//                                         <td className="px-2 py-2 text-sm whitespace-normal border border-gray-100">Pending</td>
//                                     </tr>
//                                 })}
//                             </tbody>
//                         </table>
//                     </div>
//                 </div>
//                 <div ref={componentRef2} className="px-4 pb-1">
//                     <div className="overflow-x-auto">
//                         <table className="w-full">
//                             <thead className="w-full">
//                                 <tr>
//                                     <th colSpan="5" className="p-0">
//                                         <div className="mt-1 flex justify-between">
//                                             <div>
//                                                 <img className="w-44" src={redlogo} alt="Nirmaan" />
//                                                 <div className="pt-1 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
//                                             </div>
//                                         </div>
//                                     </th>
//                                 </tr>
//                                 <tr>
//                                     <th colSpan="5" className="p-0">
//                                         <div className="py-1 border-b-2 border-gray-600 pb-2 mb-1">
//                                             <div className="flex justify-between">
//                                                 <div className="text-xs text-gray-500 font-normal">Obeya Verve, 5th Main, Sector 6, HSR Layout, Bangalore, India - 560102</div>
//                                                 <div className="text-xs text-gray-500 font-normal">GST: 29ABFCS9095N1Z9</div>
//                                             </div>
//                                         </div>
//                                     </th>
//                                 </tr>
//                                 <tr>
//                                     <th colSpan="5" className="p-0">
//                                         <div className="grid grid-cols-6 gap-4 justify-between border border-gray-100 rounded-lg px-3 py-1 mb-1">
//                                             <div className="border-0 flex flex-col col-span-2">
//                                                 <p className="text-left py-1 font-medium text-xs text-gray-500">Name and address</p>
//                                                 <p className="text-left font-bold font-semibold text-sm text-black">{data?.project_name}</p>
//                                             </div>
//                                             <div className="border-0 flex flex-col col-span-2">
//                                                 <p className="text-left py-1 font-medium text-xs text-gray-500">Start Date & End Date</p>
//                                                 <p className="text-left font-bold font-semibold text-sm text-black">{data?.project_start_date} to {data?.project_end_date}</p>
//                                             </div>
//                                             <div className="border-0 flex flex-col col-span-2">
//                                                 <p className="text-left py-1 font-medium text-xs text-gray-500">Work Package</p>
//                                                 <p className="text-left font-bold font-semibold text-sm text-black">{JSON.parse(data?.project_work_milestones!).work_packages.map((item) => item.work_package_name).join(", ")}</p>
//                                             </div>
//                                         </div>
//                                     </th>
//                                 </tr>
//                                 <tr>
//                                     <th scope="col" className="px-6 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Work Package</th>
//                                     <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Scope of Work</th>
//                                     <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Milestone</th>
//                                     <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">Start Date</th>
//                                     <th scope="col" className="px-2 py-1 text-left text-[0.7rem] font-bold text-gray-800 tracking-wider border border-gray-100 bg-slate-50">End Date</th>
//                                 </tr>
//                             </thead>
//                             <tbody className="bg-white divide-y divide-gray-200">
//                                 {mile_data?.map((item) => {
//                                     return <tr className="">
//                                         <td className="px-6 py-2 text-sm whitespace-normal border border-gray-100">{item.work_package}</td>
//                                         <td className="px-2 py-2 text-sm whitespace-normal border border-gray-100">
//                                             {item.scope_of_work}
//                                         </td>
//                                         <td className="px-2 py-2 text-sm whitespace-normal border border-gray-100">{item.milestone}</td>
//                                         <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">{item.start_date}</td>
//                                         <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">{item.end_date}</td>
//                                     </tr>
//                                 })}
//                             </tbody>
//                         </table>
//                     </div>
//                 </div>
//             </div>
//             <div className="pl-0 pr-2">
//                 {mile_isloading ? (
//                     <TableSkeleton />
//                 ) : (
//                     <DataTable columns={columns} data={mile_data || []} />
//                 )}
//             </div>
//         </div >
//     )
// }



const Project = () => {
  const { projectId } = useParams<{ projectId: string }>()

  const { data, isLoading } = useFrappeGetDoc("Projects", projectId, `Projects ${projectId}`, {
    revalidateIfStale: false
  })

  const { data: projectCustomer, isLoading: projectCustomerLoading } = useFrappeGetDoc("Customers", data?.customer, `Customers ${data?.customer}`)

  return (
    <div>
      {(isLoading || projectCustomerLoading) && <Skeleton className="w-[30%] h-10" />}
      {data && <ProjectView projectId={projectId} data={data} projectCustomer={projectCustomer} />}
    </div>
  )
}

// Cannot add rest of hook calls to lazy component since skeleton loading is dependent upon them
interface ProjectViewProps {
  projectId: string | undefined
  data: any
  //mile_data?: any
  projectCustomer: any
  //projectAssignees?: any
  //usersList?: any
  //pr_data?: any
  //po_data?: any
}

export const Component = Project

const ProjectView = ({ projectId, data, projectCustomer }: ProjectViewProps) => {

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

  const { data: projectAssignees, isLoading: projectAssigneesLoading } = useFrappeGetDocList("Nirmaan User Permissions", {
    fields: ["*"],
    limit: 1000,
    filters: [["for_value", "=", `${projectId}`], ["allow", "=", "Projects"]]
  },
    `User Permission, filters(for_value),=,${projectId}`
  )

  const { data: usersList, isLoading: usersListLoading } = useFrappeGetDocList("Nirmaan Users", {
    fields: ["*"],
    limit: 1000
  },
    "Nirmaan Users"
  )

  const { data: pr_data, isLoading: pr_loading } = useFrappeGetDocList("Procurement Requests", {
    fields: ["*"],
    limit: 1000
  })

  const { data: sent_back_data, isLoading: sent_back_loading } = useFrappeGetDocList("Sent Back Category", {
    fields: ["*"],
    limit: 1000
  })

  const { data: po_data, isLoading: po_loading } = useFrappeGetDocList("Procurement Orders", {
    fields: ["*"],
    limit: 1000
  })

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

  // console.log("users", usersList)

  // console.log("project assignees", projectAssignees)

  //   console.log("customerData", projectCustomer)
  // console.log("mile_data", mile_data)

  // console.log("data", data)

  const navigate = useNavigate();

  // const { toast } = useToast()

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
    {
      label: 'Project Tracking',
      key: 'projectTracking',
    },
    {
      label: 'Procurement Summary',
      key: 'procurementSummary',
    },
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

  const [current, setCurrent] = useState('overview')

  const onClick: MenuProps['onClick'] = (e) => {
    //  console.log('click ', e);
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
      // console.log("Print Schedule button Clicked");
      return componentRef3.current || null
    },
    documentTitle: `${data?.project_name}_${data?.project_city}_${data?.project_state}_${data?.owner}_${formatDate(new Date())}`
  });

  // if (isLoading) return <OverviewSkeleton />

  return (
    <div className="flex-1 md:space-y-4">
      <div className="flex items-center">
        <ArrowLeft className="mt-1.5 cursor-pointer" onClick={() => navigate("/projects")} />
        <h2 className="pl-2 text-xl md:text-3xl font-bold tracking-tight">{data?.project_name.toUpperCase()}</h2>
        <FilePenLine onClick={() => navigate('edit')} className="w-10 text-blue-300 hover:-translate-y-1 transition hover:text-blue-600 cursor-pointer" />
      </div>
      <Menu selectedKeys={[current]} onClick={onClick} mode="horizontal" items={items} />

      {/* Overview Section */}

      {(usersListLoading || projectAssigneesLoading) ? (<OverviewSkeleton2 />) : current === "overview" && (
        <div className="flex flex-col gap-4 max-md:pt-4">
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
                    <p className="font-bold text-black">{projectCustomer?.company_name}</p>
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
              <CardTitle>Assignees</CardTitle>
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
        <div className="pr-2 py-4">
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
          <div>Pending....</div>
        )
      }

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

