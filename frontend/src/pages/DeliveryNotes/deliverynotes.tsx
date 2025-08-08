import { useContext, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useFrappeGetDocList } from "frappe-react-sdk"
import { UserContext } from "@/utils/auth/UserProvider"
import { formatDate } from "@/utils/FormatDate"

// UI Components
import ProjectSelect from "@/components/custom-select/project-select"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, FilePlus2, ListVideo, ClipboardList } from "lucide-react"
import { deriveDnIdFromPoId } from "./constants"

interface ProcurementOrder {
    name: string;
    project: string;
    dispatch_date: string;
    status: string;
    delivery_data?: unknown;
}

function DashboardCard({ title, icon, onClick, className }: { title: string, icon: React.ReactNode, onClick: () => void, className?: string }) {
    return (
        <Button
            variant="ghost"
            className={`h-[150px] w-full min-w-[250px] p-0 rounded-lg shadow-md hover:shadow-lg transition-shadow ${className}`}
            onClick={onClick}
        >
            <div className="flex h-full w-full flex-col justify-between p-6 text-white">
                <p className="text-xl font-semibold text-left">{title}</p>
                <div className="self-end">{icon}</div>
            </div>
        </Button>
    );
}

function processDeliveryData(deliveryData: unknown): { latestUpdateDate: string | null; totalNoteCount: number } {
    const defaults = { latestUpdateDate: null, totalNoteCount: 0 };
    if (!deliveryData) return defaults;
    let parsedData: any;
    if (typeof deliveryData === 'string') {
        try { parsedData = JSON.parse(deliveryData); } catch (error) { return defaults; }
    } else if (typeof deliveryData === 'object' && deliveryData !== null) {
        parsedData = deliveryData;
    } else { return defaults; }
    const deliveryDataObject = parsedData?.data;
    if (!deliveryDataObject || Object.keys(deliveryDataObject).length === 0) return defaults;
    const timestamps = Object.keys(deliveryDataObject);
    timestamps.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

    // console.log("timestamps", timestamps);
    return { latestUpdateDate: timestamps[0] || null, totalNoteCount: timestamps.length };
}

// --- Main DeliveryNotes Component ---
const DeliveryNotes: React.FC = () => {
    const navigate = useNavigate();
    const { setSelectedProject, selectedProject } = useContext(UserContext);
    const [activeView, setActiveView] = useState<'DASHBOARD' | 'CREATE' | 'VIEW_EXISTING'>('DASHBOARD');

    // --- DYNAMIC FILTERS BASED ON VIEW ---
    const filters = useMemo(() => {
        if (activeView === 'CREATE') {
            return [["status", "in", ["Dispatched", "Partially Delivered"]]];
        }
        if (activeView === 'VIEW_EXISTING') {
            return [["status", "in", ["Delivered", "Partially Delivered"]]];
        }
        // Return a filter that will likely find nothing for the default dashboard view
        return [["status", "in", [""]]];
    }, [activeView]);

    // --- DATA FETCHING HOOK WITH DYNAMIC FILTERS AND ENABLED STATUS ---
    const { data: procurementOrdersList, isLoading } = useFrappeGetDocList<ProcurementOrder>("Procurement Orders", {
        fields: ["name", "project", "dispatch_date", "status", "delivery_data"],
        filters: filters,
        orderBy: { field: "creation", order: "desc" },
        limit: 1000,
        // Only enable the API call when not on the dashboard
        enabled: activeView !== 'DASHBOARD'
    });

    const handleProjectChange = (selectedItem: any) => {
        const projectValue = selectedItem ? selectedItem.value : null;
        setSelectedProject(projectValue);
        if (projectValue) {
            sessionStorage.setItem("selectedProject", JSON.stringify(projectValue));
        } else {
            sessionStorage.removeItem("selectedProject");
        }
    };

    const selectedProjectPOs = useMemo(() => {
        if (!selectedProject || !procurementOrdersList) return [];
        return procurementOrdersList.filter(po => po.project === selectedProject);
    }, [procurementOrdersList, selectedProject]);

    const handleReset = () => {
        setActiveView('DASHBOARD');
        setSelectedProject(null);
        sessionStorage.removeItem("selectedProject");
    };

    return (
        <div className="flex-1 space-y-4">
            {activeView === 'DASHBOARD' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <DashboardCard title="Create New DN" icon={<FilePlus2 className="h-10 w-10" />} onClick={() => setActiveView('CREATE')} className="bg-blue-500 hover:bg-blue-600" />
                    <DashboardCard title="View Existing DN" icon={<ListVideo className="h-10 w-10" />} onClick={() => setActiveView('VIEW_EXISTING')} className="bg-green-500 hover:bg-green-600" />
                    <DashboardCard title="Pending DN" icon={<ClipboardList className="h-10 w-10" />} onClick={() => navigate('/reports')} className="bg-orange-500 hover:bg-orange-600" />
                </div>
            )}

            {activeView === 'CREATE' && (
                <Card>
                    <CardHeader className="flex flex-row items-start justify-between">
                        <div>
                            <CardTitle>Create New Delivery Note</CardTitle>
                            <p className="text-sm text-muted-foreground pt-1">Select a project to see POs ready for new delivery update.</p>
                        </div>
                        <Button variant="outline" onClick={handleReset}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
                    </CardHeader>
                    <CardContent>
                        <div className="mb-4"><ProjectSelect onChange={handleProjectChange} /></div>
                        {selectedProject && (
                            <Table>
                                <TableHeader><TableRow><TableHead>PO No.</TableHead><TableHead>Dispatch Date</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {isLoading && <TableRow><TableCell colSpan={3} className="text-center">Loading...</TableCell></TableRow>}
                                    {selectedProjectPOs.length > 0 ? (
                                        selectedProjectPOs.map(po => (
                                            <TableRow key={po.name}>
                                                <TableCell><Link className="underline text-blue-600 hover:text-blue-800" to={`/prs&milestones/delivery-notes/${po.name.replaceAll("/", "&=")}`}>{`PO-${po.name.split("/")[1]}`}</Link></TableCell>
                                                <TableCell>{formatDate(po.dispatch_date)}</TableCell>
                                                <TableCell><Badge variant={po.status === "Dispatched" ? "orange" : "green"}>{po.status}</Badge></TableCell>
                                            </TableRow>
                                        ))
                                    ) : (<TableRow><TableCell colSpan={3} className="text-center text-red-500">No eligible Purchase Orders found for this project.</TableCell></TableRow>)}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            )}

            {activeView === 'VIEW_EXISTING' && (
                <Card>
                    <CardHeader className="flex flex-row items-start justify-between">
                        <div>
                            <CardTitle>View Existing Delivery Notes</CardTitle>
                            <p className="text-sm text-muted-foreground pt-1">Select a project to see its delivery history.</p>
                        </div>
                        <Button variant="outline" onClick={handleReset}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
                    </CardHeader>
                    <CardContent>
                        <div className="mb-4"><ProjectSelect onChange={handleProjectChange} /></div>
                        {selectedProject && (
                            <Table>
                                <TableHeader><TableRow><TableHead>DN NO.</TableHead><TableHead>Latest Delivery Update</TableHead><TableHead>Status</TableHead><TableHead>DN Count</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {isLoading && <TableRow><TableCell colSpan={4} className="text-center">Loading...</TableCell></TableRow>}
                                    {selectedProjectPOs.length > 0 ? (
                                        selectedProjectPOs.map(item => {
                                            const deliveryInfo = processDeliveryData(item.delivery_data);
                                            const DN_ID = deriveDnIdFromPoId(item.name)
                                            return (
                                                <TableRow key={item.name}>
                                                    <TableCell><Link className="underline text-blue-600 hover:text-blue-800" to={`/prs&milestones/delivery-notes/${item.name.replaceAll("/", "&=")}`}>{`DN/${item.name.split("/")[1]}/M`}</Link></TableCell>
                                                    <TableCell>{deliveryInfo.latestUpdateDate ? formatDate(deliveryInfo.latestUpdateDate) : 'N/A'}</TableCell>
                                                    <TableCell><Badge variant={item.status === "Delivered" ? "green" : "orange"}>{item.status}</Badge></TableCell>
                                                    <TableCell>{`${deliveryInfo.totalNoteCount}`}</TableCell>
                                                </TableRow>
                                            );
                                        })
                                    ) : (<TableRow><TableCell colSpan={4} className="text-center text-red-500">No eligible Purchase Orders found for this project.</TableCell></TableRow>)}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    )
}

export default DeliveryNotes;



// AUG-BEFORE
// import ProjectSelect from "@/components/custom-select/project-select"
// import { Badge } from "@/components/ui/badge"
// import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
// import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders"
// import { UserContext } from "@/utils/auth/UserProvider"
// import { formatDate } from "@/utils/FormatDate"
// import { useFrappeGetDocList } from "frappe-react-sdk"
// import { useContext, useMemo } from "react"
// import { Link } from "react-router-dom"

// const DeliveryNotes: React.FC = () => {

//     const { data: procurementOrdersList } = useFrappeGetDocList<ProcurementOrder>("Procurement Orders", {
//         fields: ["*"],
//         filters: [["status", "not in", ["PO Sent", "PO Approved", "PO Amendment", "Cancelled", "Merged"]]],
//         orderBy: { field: "dispatch_date", order: "desc" },
//         limit: 100000,
//     })

//     const { setSelectedProject, selectedProject } = useContext(UserContext)

//     // const columns = useMemo(
//     //     () => [
//     //         {
//     //             accessorKey: "name",
//     //             header: ({ column }) => {
//     //                 return (
//     //                     <DataTableColumnHeader column={column} title="PR No" />
//     //                 )
//     //             },
//     //             cell: ({ row }) => {
//     //                 return (
//     //                     <div className="font-medium">
//     //                         {row.getValue("name")}
//     //                     </div>
//     //                 )
//     //             }
//     //         },
//     //         {
//     //             id: "pos",
//     //             header: ({ column }) => {
//     //                 return (
//     //                     <DataTableColumnHeader column={column} title="Associated PO's" />
//     //                 )
//     //             },
//     //             cell: ({ row }) => {
//     //                 const id = row.getValue("name");
//     //                 const associatedPOs = getPOsAssociated(id); // Assuming this returns an array of PO objects with a 'name' property.

//     //                 return (
//     //                     <div className="font-medium">
//     //                         {associatedPOs.length === 0 ? (
//     //                             <p className="text-red-300 text-center">No PO's found</p>
//     //                         ) : (
//     //                             <table className="w-full text-left">
//     //                                 <tbody>
//     //                                     {associatedPOs.map((po) => (
//     //                                         <tr key={po.name}>
//     //                                             <Link to={`${row.getValue("name").replaceAll("/", "&=")}`}>
//     //                                                 <td className="border-b p-2 underline hover:text-blue-500">{po.name}</td>
//     //                                             </Link>
//     //                                         </tr>
//     //                                     ))}
//     //                                 </tbody>
//     //                             </table>
//     //                         )}
//     //                     </div>
//     //                 );
//     //             }
//     //         },
//     //         {
//     //             id: "creation",
//     //             header: ({ column }) => {
//     //                 return (
//     //                     <DataTableColumnHeader column={column} title="Creation" />
//     //                 )
//     //             },
//     //             cell: ({ row }) => {
//     //                 const id = row.getValue("name");
//     //                 const associatedPOs = getPOsAssociated(id); // Assuming this returns an array of PO objects with a 'name' property.

//     //                 return (
//     //                     <div className="font-medium">
//     //                         {associatedPOs.length === 0 ? (
//     //                             <span></span>
//     //                         ) : (
//     //                             <table className=" text-left">
//     //                                 <tbody>
//     //                                     {associatedPOs.map((po) => (
//     //                                         <tr key={po.creation}>
//     //                                             <td className="border-b p-2">{formatDate(po.creation)}</td>
//     //                                         </tr>
//     //                                     ))}
//     //                                 </tbody>
//     //                             </table>
//     //                         )}
//     //                     </div>
//     //                 );
//     //             }
//     //         },
//     //     ],
//     //     []
//     // )

//     const handleChange = (selectedItem: any) => {
//         setSelectedProject(selectedItem ? selectedItem.value : null);
//         if (selectedItem) {
//             sessionStorage.setItem(
//                 "selectedProject",
//                 JSON.stringify(selectedItem.value)
//             );
//         } else {
//             sessionStorage.removeItem("selectedProject");
//         }
//     };

//     const selectedProjectPOs = useMemo(() => procurementOrdersList?.filter(i => i?.project === selectedProject) || [], [procurementOrdersList, selectedProject])

//     return (
//         <div className="flex-1 space-y-4 min-h-[50vh]">
//             <div className="border border-gray-200 rounded-lg p-0.5 min-w-[400px]">
//                 <ProjectSelect onChange={handleChange} />
//                 {selectedProject && <div className="pt-4">
//                     <Table className="min-h-[30vh] overflow-auto">
//                         <TableHeader className="bg-red-100">
//                             <TableRow>
//                                 <TableHead className=" font-extrabold">Delivery Note</TableHead>
//                                 <TableHead className="w-[30%] font-extrabold">PR No.</TableHead>
//                                 <TableHead className="w-[20%] font-extrabold">Dispatch Date</TableHead>
//                                 <TableHead className="w-[20%] font-extrabold">Status</TableHead>
//                             </TableRow>
//                         </TableHeader>
//                         <TableBody>
//                             {selectedProjectPOs.length > 0 ? (
//                                 selectedProjectPOs?.map(item => (
//                                     <TableRow key={item.name}>
//                                         <TableCell>
//                                             <Link className="underline text-blue-300 hover:text-blue-500" to={`${item.name.replaceAll("/", "&=")}`}>DN-{item.name.split('/')[1]}</Link>
//                                         </TableCell>
//                                         <TableCell>{item?.procurement_request}</TableCell>
//                                         <TableCell>{formatDate(item?.dispatch_date)}</TableCell>
//                                         <TableCell>
//                                             <Badge variant={`${item?.status === "Dispatched" ? "orange" : "green"}`}>
//                                                 {item?.status}
//                                             </Badge>
//                                         </TableCell>
//                                         {/* <TableCell className="text-sm">{getPOsAssociated(item.name)?.map((po) => (
//                                                         <TableRow>
//                                                             <TableCell>
//                                                                 <Link className="underline text-blue-300 hover:text-blue-500" to={`${po.name.replaceAll("/", "&=")}`}>DN-{po.name.split('/')[1]}</Link>
//                                                             </TableCell>
//                                                         </TableRow>
//                                                     ))}</TableCell>
//                                                     <TableCell className="text-sm">
//                                                         {getPOsAssociated(item.name)?.map((po) => (
//                                                             <TableRow>
//                                                                 <TableCell>
//                                                                     {formatDate(po.creation)}
//                                                                 </TableCell>
//                                                             </TableRow>
//                                                         ))}
//                                                     </TableCell>
//                                                     <TableCell className="text-sm">
//                                                         {getPOsAssociated(item.name)?.map((po) => (
//                                                             <TableRow>
//                                                                 <TableCell>
//                                                                     <Badge variant={`${po?.status === "Dispatched" ? "orange" : "green"}`} className="">
//                                                                         {po?.status}
//                                                                     </Badge>
//                                                                 </TableCell>
//                                                             </TableRow>
//                                                         ))}
//                                                     </TableCell> */}
//                                     </TableRow>
//                                 ))
//                             ) : (
//                                 <>
//                                     <TableCell></TableCell>
//                                     <TableCell className="text-red-300 text-end">**Not Found**</TableCell>
//                                 </>
//                             )}
//                             {/* {procurementRequestsList?.map((item) => {
//                                 if (item.project === project) {
//                                     return (
//                                         <TableRow key={item.name}>
//                                             <TableCell className="text-sm">{item.name.split("-")[2]}</TableCell>
//                                             {getPOsAssociated(item.name).length > 0 ? (
//                                                 <>
//                                                     <TableCell className="text-sm">{getPOsAssociated(item.name)?.map((po) => (
//                                                         <TableRow>
//                                                             <TableCell>
//                                                                 <Link className="underline text-blue-300 hover:text-blue-500" to={`${po.name.replaceAll("/", "&=")}`}>DN-{po.name.split('/')[1]}</Link>
//                                                             </TableCell>
//                                                         </TableRow>
//                                                     ))}</TableCell>
//                                                     <TableCell className="text-sm">
//                                                         {getPOsAssociated(item.name)?.map((po) => (
//                                                             <TableRow>
//                                                                 <TableCell>
//                                                                     {formatDate(po.creation)}
//                                                                 </TableCell>
//                                                             </TableRow>
//                                                         ))}
//                                                     </TableCell>
//                                                     <TableCell className="text-sm">
//                                                         {getPOsAssociated(item.name)?.map((po) => (
//                                                             <TableRow>
//                                                                 <TableCell>
//                                                                     <Badge variant={`${po?.status === "Dispatched" ? "orange" : "green"}`} className="">
//                                                                         {po?.status}
//                                                                     </Badge>
//                                                                 </TableCell>
//                                                             </TableRow>
//                                                         ))}
//                                                     </TableCell>
//                                                 </>
//                                             ) : (
//                                                 <>
//                                                     <TableCell></TableCell>
//                                                     <TableCell className="text-red-300">**Not Found**</TableCell>
//                                                 </>
//                                             )}
//                                         </TableRow>
//                                     )
//                                 }
//                             })} */}
//                         </TableBody>
//                     </Table>
//                 </div>}
//             </div>
//         </div>
//     )
// }

// export default DeliveryNotes