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
import { TableSkeleton } from "@/components/ui/skeleton"
import { useToast } from "@/components/ui/use-toast"
import { Menu, MenuProps, TableProps } from "antd"
import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk"
import { ArrowLeft, Download, FilePenLine } from "lucide-react"
import React, { useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import StatusBar from "@/components/ui/status-bar"
import { Button } from "@/components/ui/button"
import { useReactToPrint } from "react-to-print"

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

    return (
        <div>
            {projectId && <ProjectView projectId={projectId} />}
        </div>
    )
}

export const Component = Project

const ProjectView = ({ projectId }: { projectId: string }) => {

    const {data, isLoading} = useFrappeGetDoc("Projects", projectId, `Projects ${projectId}`, {
        revalidateIfStale: false
    })

    const { data: mile_data, isLoading: mile_isloading } = useFrappeGetDocList("Project Work Milestones", {
                fields: ["*"],
                filters: [["project", "=", `${projectId}`]],
                limit: 1000
        },
        `Project Work MileStones ${projectId}`,
        {
            revalidateIfStale: false
        }
    )

        console.log("mile_data", mile_data)

        console.log("data", data)

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
    label: 'Status',
    key: 'status',
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
        return <div className={`text-[#11050599] ${statusObj?.status === "Halted" && "text-[#FF4433]"} ${statusObj?.status === "Completed" && "text-[#17B26A]"}`}>{statusObj?.status || "-"}</div>;
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
          return <div className="text-[#11050599]">{row.getValue("start_date")}</div>;
        },
      },
      {
        accessorKey: "end_date",
        header: ({ column }) => {
          return <DataTableColumnHeader className="text-black font-bold" column={column} title="End Date" />;
        },
        cell: ({ row }) => {
          return <div className="text-[#11050599]">{row.getValue("end_date")}</div>;
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
    // const componentRef2 = React.useRef<HTMLDivElement>(null);
    const handlePrint2 = useReactToPrint({
        content: () => {
            // console.log("Print Schedule button Clicked");
            return componentRef.current || null
        },
        documentTitle: `${data?.project_name}_${data?.project_city}_${data?.project_state}_${data?.owner}_${data?.creation}`
    });

   
   if(isLoading) return <div>Loading...</div>

return (
        <div className="flex-1 space-y-4 p-12 pt-8">
            <div className="flex items-center">
                <ArrowLeft className="mt-1.5 cursor-pointer" onClick={() => navigate("/projects")} />
                <h2 className="pl-2 text-xl md:text-3xl font-bold tracking-tight">{data?.name}</h2>
                <FilePenLine onClick={() => navigate('edit')} className="w-10 text-blue-300 hover:-translate-y-1 transition hover:text-blue-600 cursor-pointer" />
            </div>
            <Menu selectedKeys={[current]} onClick={onClick} mode="horizontal" items={items}/>

            {/* Overview Section */}
        {current === "overview" && (
        <div>
            <Card>
                <CardHeader>
                  <CardTitle>
                      {data?.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                    <Card className="bg-[#F9FAFB]">
                      <CardHeader>
                        <CardContent className="flex max-lg:flex-col max-lg:gap-10">
                            <div className="space-y-4 lg:w-[50%]">
                              <CardDescription className="space-y-2">
                                  <span>Name</span>
                                  <p className="font-bold text-black">{data?.name}</p>
                              </CardDescription>

                              <CardDescription className="space-y-2">
                                  <span>Start Date & End Date</span>
                                  <p className="font-bold text-black">{data?.project_start_date} to {data?.project_end_date}</p>
                              </CardDescription>

                              <CardDescription className="space-y-2">
                                  <span>Estimated Completion Date</span>
                                  <p className="font-bold text-black">{data?.project_end_date}</p>
                              </CardDescription>
                              <CardDescription className="space-y-2">
                                  <span>Work Package</span>
                                  {JSON.parse(data?.project_work_milestones).work_packages?.map((item : any) => (
                                        <div className=" max-w-[70%] flex items-center justify-center rounded-3xl p-1 bg-[#ECFDF3] text-[#067647] border-[1px] border-[#ABEFC6]">{item.work_package_name}</div>
                                  ))}
                                  
                              </CardDescription>
                              
                            </div>

                            <div className="space-y-4">
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

                              <CardDescription className="space-y-2">
                                  <span>Health Score</span>
                                    <StatusBar currentValue={6} totalValue={10} />
                              </CardDescription>
                              
                            </div>
                        </CardContent>
                      </CardHeader>
                    </Card>
                </CardContent>
                
            </Card>
        </div>
        )}

        {current === "projectTracking" && (
            <div className="pr-2 py-4">
                <div className="flex gap-4 items-center">
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
                </div>
                {mile_isloading ? (
                    <TableSkeleton />
                ) : (
                    <DataTable columns={columns} data={mile_data || []} />
                )}
            </div>
        )}

        {
            current === "status" && (
                <div>Pending....</div>
            )
        }

<div className="hidden">
      <div ref={componentRef} className="px-4 pb-1">
          <div className="overflow-x-auto">
              <table className="w-full my-4">
                  <thead className="w-full">
                      <tr>
                          <th colSpan={6} className="p-0">
                              <div className="mt-1 flex justify-between">
                                  <div>
                                      <img className="w-44" src={redlogo} alt="Nirmaan" />
                                      <div className="pt-1 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                                  </div>
                              </div>
                          </th>
                      </tr>
                      <tr>
                          <th colSpan={6} className="p-0">
                              <div className="py-1 border-b-2 border-gray-600 pb-2 mb-1">
                                  <div className="flex justify-between">
                                      <div className="text-xs text-gray-500 font-normal">Obeya Verve, 5th Main, Sector 6, HSR Layout, Bangalore, India - 560102</div>
                                      <div className="text-xs text-gray-500 font-normal">GST: 29ABFCS9095N1Z9</div>
                                  </div>
                              </div>
                          </th>
                      </tr>
                      <tr>
                          <th colSpan={6} className="p-0">
                              <div className="grid grid-cols-6 gap-4 justify-between border border-gray-100 rounded-lg px-3 py-1 mb-1">
                                  <div className="border-0 flex flex-col col-span-2">
                                      <p className="text-left py-1 font-medium text-xs text-gray-500">Name and address</p>
                                      <p className="text-left font-bold font-semibold text-sm text-black">{data?.project_name}</p>
                                      <p className="text-left py-1 font-medium text-xs text-gray-500">Date : {formattedDate}</p>
                                  </div>
                                  <div className="border-0 flex flex-col col-span-2">
                                      <p className="text-left py-1 font-medium text-xs text-gray-500">Start Date & End Date</p>
                                      <p className="text-left font-bold font-semibold text-sm text-black">{data?.project_start_date} to {data?.project_end_date}</p>
                                  </div>
                                  <div className="border-0 flex flex-col col-span-2">
                                      <p className="text-left py-1 font-medium text-xs text-gray-500">Work Package</p>
                                      <p className="text-left font-bold font-semibold text-sm text-black">{JSON.parse(data?.project_work_milestones!).work_packages.map((item) => item.work_package_name).join(", ")}</p>
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
                              <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">{item.start_date}</td>
                              <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">{item.end_date}</td>
                              {
                                item.status_list?.list.map((area) => (
                              <td className="px-2 py-2 text-sm whitespace-normal border border-gray-100">{area.status}</td>
                                ))
                              }
                          </tr>
                      })}
                  </tbody>
              </table>
          </div>
      </div>
      {/* <div ref={componentRef2} className="px-4 pb-1">
          <div className="overflow-x-auto">
              <table className="w-full">
                  <thead className="w-full">
                      <tr>
                          <th colSpan="5" className="p-0">
                              <div className="mt-1 flex justify-between">
                                  <div>
                                      <img className="w-44" src={redlogo} alt="Nirmaan" />
                                      <div className="pt-1 text-lg text-gray-500 font-semibold">Nirmaan(Stratos Infra Technologies Pvt. Ltd.)</div>
                                  </div>
                              </div>
                          </th>
                      </tr>
                      <tr>
                          <th colSpan="5" className="p-0">
                              <div className="py-1 border-b-2 border-gray-600 pb-2 mb-1">
                                  <div className="flex justify-between">
                                      <div className="text-xs text-gray-500 font-normal">Obeya Verve, 5th Main, Sector 6, HSR Layout, Bangalore, India - 560102</div>
                                      <div className="text-xs text-gray-500 font-normal">GST: 29ABFCS9095N1Z9</div>
                                  </div>
                              </div>
                          </th>
                      </tr>
                      <tr>
                          <th colSpan="5" className="p-0">
                              <div className="grid grid-cols-6 gap-4 justify-between border border-gray-100 rounded-lg px-3 py-1 mb-1">
                                  <div className="border-0 flex flex-col col-span-2">
                                      <p className="text-left py-1 font-medium text-xs text-gray-500">Name and address</p>
                                      <p className="text-left font-bold font-semibold text-sm text-black">{data?.project_name}</p>
                                  </div>
                                  <div className="border-0 flex flex-col col-span-2">
                                      <p className="text-left py-1 font-medium text-xs text-gray-500">Start Date & End Date</p>
                                      <p className="text-left font-bold font-semibold text-sm text-black">{data?.project_start_date} to {data?.project_end_date}</p>
                                  </div>
                                  <div className="border-0 flex flex-col col-span-2">
                                      <p className="text-left py-1 font-medium text-xs text-gray-500">Work Package</p>
                                      <p className="text-left font-bold font-semibold text-sm text-black">{JSON.parse(data?.project_work_milestones!).work_packages.map((item) => item.work_package_name).join(", ")}</p>
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
                              <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">{item.start_date}</td>
                              <td className="px-2 py-2 text-sm whitespace-nowrap border border-gray-100">{item.end_date}</td>
                          </tr>
                      })}
                  </tbody>
              </table>
          </div>
      </div> */}
        </div>
            
        </div>
    )

}
