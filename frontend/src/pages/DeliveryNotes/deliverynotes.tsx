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

    const { data: procurementOrdersList, isLoading: procurementRequestsListLoading } = useFrappeGetDocList("Procurement Orders", {
        fields: ["*"],
        filters: [["status", "not in", ["PO Sent", "PO Approved", "PO Amendment", "Cancelled", "Merged"]]],
        limit: 100000,
    })

    const { setSelectedProject, selectedProject } = useContext(UserContext)

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
    //                 const associatedPOs = getPOsAssociated(id); // Assuming this returns an array of PO objects with a 'name' property.

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
    //                 const associatedPOs = getPOsAssociated(id); // Assuming this returns an array of PO objects with a 'name' property.

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
        <div className="flex-1 space-y-4 min-h-[50vh]">
            {/* <div className="">
                <div className="flex items-center ">
                    <Link to="/prs&milestones"><ArrowLeft className="" /></Link>
                    <h2 className="pl-2 text-xl md:text-2xl font-bold tracking-tight">Update Delivery Notes</h2>
                </div>
            </div> */}
            {/* {(!procurementRequestsLoading && !procurementRequestsListLoading) && <DataTable columns={columns} data={procurementRequestsList} />} */}

            <div className="border border-gray-200 rounded-lg p-0.5 w-full overflow-auto">
                <ProjectSelect onChange={handleChange} />
                {selectedProject && <div className="pt-4">
                    <Table className="min-w-[400px] min-h-[30vh] overflow-auto">
                        <TableHeader className="bg-red-100">
                            <TableRow>
                                <TableHead className=" font-extrabold">Delivery Note</TableHead>
                                <TableHead className="w-[30%] font-extrabold">PR No.</TableHead>
                                <TableHead className="w-[20%] font-extrabold">Creation</TableHead>
                                <TableHead className="w-[20%] font-extrabold">Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {procurementOrdersList?.filter(i => i?.project === selectedProject)?.length > 0 ? (
                                procurementOrdersList?.filter(i => i?.project === selectedProject)?.map(item => (
                                    <TableRow key={item.name}>
                                        <TableCell>
                                            <Link className="underline text-blue-300 hover:text-blue-500" to={`${item.name.replaceAll("/", "&=")}`}>DN-{item.name.split('/')[1]}</Link>
                                        </TableCell>
                                        <TableCell>{item?.procurement_request}</TableCell>
                                        <TableCell>{formatDate(item.creation)}</TableCell>
                                        <TableCell>
                                            <Badge variant={`${item?.status === "Dispatched" ? "orange" : "green"}`}>
                                                {item?.status}
                                            </Badge>
                                        </TableCell>
                                        {/* <TableCell className="text-sm">{getPOsAssociated(item.name)?.map((po) => (
                                                        <TableRow>
                                                            <TableCell>
                                                                <Link className="underline text-blue-300 hover:text-blue-500" to={`${po.name.replaceAll("/", "&=")}`}>DN-{po.name.split('/')[1]}</Link>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}</TableCell>
                                                    <TableCell className="text-sm">
                                                        {getPOsAssociated(item.name)?.map((po) => (
                                                            <TableRow>
                                                                <TableCell>
                                                                    {formatDate(po.creation)}
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableCell>
                                                    <TableCell className="text-sm">
                                                        {getPOsAssociated(item.name)?.map((po) => (
                                                            <TableRow>
                                                                <TableCell>
                                                                    <Badge variant={`${po?.status === "Dispatched" ? "orange" : "green"}`} className="">
                                                                        {po?.status}
                                                                    </Badge>
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableCell> */}
                                    </TableRow>
                                ))
                            ) : (
                                <>
                                    <TableCell></TableCell>
                                    <TableCell className="text-red-300 text-end">**Not Found**</TableCell>
                                </>
                            )}
                            {/* {procurementRequestsList?.map((item) => {
                                if (item.project === project) {
                                    return (
                                        <TableRow key={item.name}>
                                            <TableCell className="text-sm">{item.name.split("-")[2]}</TableCell>
                                            {getPOsAssociated(item.name).length > 0 ? (
                                                <>
                                                    <TableCell className="text-sm">{getPOsAssociated(item.name)?.map((po) => (
                                                        <TableRow>
                                                            <TableCell>
                                                                <Link className="underline text-blue-300 hover:text-blue-500" to={`${po.name.replaceAll("/", "&=")}`}>DN-{po.name.split('/')[1]}</Link>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}</TableCell>
                                                    <TableCell className="text-sm">
                                                        {getPOsAssociated(item.name)?.map((po) => (
                                                            <TableRow>
                                                                <TableCell>
                                                                    {formatDate(po.creation)}
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableCell>
                                                    <TableCell className="text-sm">
                                                        {getPOsAssociated(item.name)?.map((po) => (
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
                            })} */}
                        </TableBody>
                    </Table>
                </div>}
            </div>
        </div>
    )
}

export default DeliveryNotes