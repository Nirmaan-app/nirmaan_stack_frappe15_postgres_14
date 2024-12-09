import ProjectSelect from "@/components/custom-select/project-select"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { UserContext } from "@/utils/auth/UserProvider"
import { formatDate } from "@/utils/FormatDate"
import { useFrappeGetDocList } from "frappe-react-sdk"
import { ArrowLeft } from "lucide-react"
import { useContext, useMemo, useState } from "react"
import { Link } from "react-router-dom"

const DeliveryNotes = () => {

    const { data: procurementRequestsList, isLoading: procurementRequestsLoading } = useFrappeGetDocList("Procurement Requests", {
        fields: ["*"],
        limit: 1000,
        orderBy: { field: "creation", order: "desc" }
    },
        "Procurement Requests"
    )

    const { data: procurementOrdersList, isLoading: procurementRequestsListLoading } = useFrappeGetDocList("Procurement Orders", {
        fields: ["*"],
        filters: [["status", "not in", ["PO Sent", "PO Approved", "PO Amendment"]]],
        limit: 1000,
    },
        "Procurement Orders"
    )

    // console.log("data", procurementOrdersList, procurementRequestsList)

    const getPrsAssociated = (prId) => {
        return procurementOrdersList?.filter((po) => po.procurement_request === prId && !["PO Approved"].includes(po.status)) || []
    }

    const {setSelectedProject, selectedProject} = useContext(UserContext)

    // const columns = useMemo(
    //     () => [
    //         {
    //             accessorKey: "name",
    //             header: ({ column }) => {
    //                 return (
    //                     <DataTableColumnHeader column={column} title="PR No" />
    //                 )
    //             },
    //             cell: ({ row }) => {
    //                 return (
    //                     <div className="font-medium">
    //                         {row.getValue("name")}
    //                     </div>
    //                 )
    //             }
    //         },
    //         {
    //             id: "pos",
    //             header: ({ column }) => {
    //                 return (
    //                     <DataTableColumnHeader column={column} title="Associated PO's" />
    //                 )
    //             },
    //             cell: ({ row }) => {
    //                 const id = row.getValue("name");
    //                 const associatedPOs = getPrsAssociated(id); // Assuming this returns an array of PO objects with a 'name' property.

    //                 return (
    //                     <div className="font-medium">
    //                         {associatedPOs.length === 0 ? (
    //                             <p className="text-red-300 text-center">No PO's found</p>
    //                         ) : (
    //                             <table className="w-full text-left">
    //                                 <tbody>
    //                                     {associatedPOs.map((po) => (
    //                                         <tr key={po.name}>
    //                                             <Link to={`${row.getValue("name").replaceAll("/", "&=")}`}>
    //                                                 <td className="border-b p-2 underline hover:text-blue-500">{po.name}</td>
    //                                             </Link>
    //                                         </tr>
    //                                     ))}
    //                                 </tbody>
    //                             </table>
    //                         )}
    //                     </div>
    //                 );
    //             }
    //         },
    //         {
    //             id: "creation",
    //             header: ({ column }) => {
    //                 return (
    //                     <DataTableColumnHeader column={column} title="Creation" />
    //                 )
    //             },
    //             cell: ({ row }) => {
    //                 const id = row.getValue("name");
    //                 const associatedPOs = getPrsAssociated(id); // Assuming this returns an array of PO objects with a 'name' property.

    //                 return (
    //                     <div className="font-medium">
    //                         {associatedPOs.length === 0 ? (
    //                             <span></span>
    //                         ) : (
    //                             <table className=" text-left">
    //                                 <tbody>
    //                                     {associatedPOs.map((po) => (
    //                                         <tr key={po.creation}>
    //                                             <td className="border-b p-2">{formatDate(po.creation)}</td>
    //                                         </tr>
    //                                     ))}
    //                                 </tbody>
    //                             </table>
    //                         )}
    //                     </div>
    //                 );
    //             }
    //         },
    //     ],
    //     []
    // )

    const handleChange = (selectedItem: any) => {
        // console.log(selectedItem)
        setSelectedProject(selectedItem ? selectedItem.value : null);
        sessionStorage.setItem('selectedProject', JSON.stringify(selectedItem.value));
    };

    // console.log("project", project)

    return (
        <div className="flex-1 space-y-2 md:space-y-4">
            {/* <div className="">
                <div className="flex items-center ">
                    <Link to="/prs&milestones"><ArrowLeft className="" /></Link>
                    <h2 className="pl-2 text-xl md:text-2xl font-bold tracking-tight">Update Delivery Notes</h2>
                </div>
            </div> */}
            {/* {(!procurementRequestsLoading && !procurementRequestsListLoading) && <DataTable columns={columns} data={procurementRequestsList} />} */}

            <div className="gap-4 border border-gray-200 rounded-lg p-0.5 ">

                <ProjectSelect onChange={handleChange} />
                {selectedProject && <div className="mx-0 px-0 pt-4">
                    {/* <h2 className="text-lg pl-2 font-semibold tracking-normal py-2">Created By {userData?.full_name}</h2> */}
                    <Table>
                        <TableHeader className="bg-red-100">
                            <TableRow>
                                <TableHead className=" font-extrabold">PR no.</TableHead>
                                <TableHead className=" font-extrabold">Delivery Note</TableHead>
                                <TableHead className=" font-extrabold">Creation</TableHead>
                                <TableHead className=" font-extrabold">Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {procurementRequestsList?.map((item) => {
                                if (item.project === selectedProject) {
                                    return (
                                        <TableRow key={item.name}>
                                            <TableCell className="text-sm">{item.name.split("-")[2]}</TableCell>
                                            {getPrsAssociated(item.name).length ? (
                                                <>
                                                    <TableCell className="text-sm">{getPrsAssociated(item.name)?.map((po) => (
                                                        <TableRow>
                                                            <TableCell>
                                                                <Link className="underline text-blue-300 hover:text-blue-500" to={`${po.name.replaceAll("/", "&=")}`}>DN-{po.name.split('/')[1]}</Link>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}</TableCell>
                                                    <TableCell className="text-sm">
                                                        {getPrsAssociated(item.name)?.map((po) => (
                                                            <TableRow>
                                                                <TableCell>
                                                                    {formatDate(po.creation)}
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableCell>
                                                    <TableCell className="text-sm">
                                                        {getPrsAssociated(item.name)?.map((po) => (
                                                            <TableRow>
                                                                <TableCell>
                                                                    <Badge variant={`${po?.status === "Dispatched" ? "orange" : "green"}`} className="">
                                                                        {po?.status}
                                                                    </Badge>
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableCell>
                                                </>
                                            ) : (
                                                <>
                                                    <TableCell></TableCell>
                                                    <TableCell className="text-red-300">**Not Found**</TableCell>
                                                </>
                                            )}
                                        </TableRow>
                                    )
                                }
                            })}
                        </TableBody>
                    </Table>
                </div>}
            </div>
        </div>
    )
}

export default DeliveryNotes