import ProjectSelect from "@/components/custom-select/project-select";
import { ProcurementRequestsSkeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUserData } from "@/hooks/useUserData";
import { ServiceRequests as ServiceRequestsType } from "@/types/NirmaanStack/ServiceRequests";
import { UserContext } from "@/utils/auth/UserProvider";
import {
  FrappeConfig,
  FrappeContext,
  useFrappeDocTypeEventListener,
  useFrappeGetDocList,
} from "frappe-react-sdk";
import { useContext } from "react";
import { Link, useNavigate } from "react-router-dom";
import { formatDate } from "@/utils/FormatDate";


export default function ListSR() {
  const navigate = useNavigate();
  const userData = useUserData();

  const { setSelectedProject, selectedProject } = useContext(UserContext);

  // const {notifications, mark_seen_notification} = useNotificationStore()

  const {
    data: service_request_list,
    isLoading: service_request_list_loading,
    error: service_request_list_error,
    mutate: srListMutate,
  } = useFrappeGetDocList<ServiceRequestsType>(
    "Service Requests",
    {
      fields: [
        "name",
        "project",
        "vendor", // The ID of the vendor
        "status",
        "owner",
        "creation",
        "project.project_name", // Fetches 'project_name' from the linked 'Project' doc
        "vendor.vendor_name",   // Fetches 'vendor_name' from the linked 'Vendor' doc
      ],

      orderBy: { field: "creation", order: "asc" },
      limit: 10000,
    }
  );

  useFrappeDocTypeEventListener("Service Requests", async (event) => {
    await srListMutate();
  });

  
  // const {data : procurementOrdersList} = useFrappeGetDocList("Procurement Orders", {
  //     fields: ["*"],
  //     limit: 1000
  // },
  // "Procurement Orders"
  // )

  // const checkPoToPr = (prId) => {
  //     return procurementOrdersList?.some((po) => po.procurement_request === prId)
  // }

  const handleChange = (selectedItem: any) => {
    setSelectedProject(selectedItem ? selectedItem.value : null);
    if(selectedItem) {
      sessionStorage.setItem(
        "selectedProject",
        JSON.stringify(selectedItem.value)
      );
    } else {
      sessionStorage.removeItem("selectedProject");
    }
};

  const { db } = useContext(FrappeContext) as FrappeConfig;
  // const handleRejectPRSeen = (notification) => {
  //     console.log("running", notification)
  //     if(notification) {
  //         mark_seen_notification(db, notification)
  //     }
  // }

  if (service_request_list_loading) return <ProcurementRequestsSkeleton />;
  if (service_request_list_error) return <h1>ERROR</h1>;

  return (
    <div className="flex-1 space-y-4 min-h-[50vh]">
      
      <div className="gap-4 border border-gray-200 rounded-lg p-0.5">
        <ProjectSelect onChange={handleChange} />
       

        {selectedProject && (
          <div className="mx-0 px-0 pt-4">
            
            <Table>
              <TableHeader className="bg-red-100">
                <TableRow>
                  <TableHead className="w-[30%] text-center font-extrabold">
                    SR no.
                  </TableHead>
                  
                 
                  <TableHead className="w-[30%] text-center font-extrabold">
                    Vendor Name
                  </TableHead>
                  {/* <TableHead className="w-[35%] text-center font-extrabold">
                    Status
                  </TableHead> */}
                   <TableHead className="w-[30%] text-center font-extrabold">
                    Creation Date
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {service_request_list?.map((item) => {
                  if (
                    item.project === selectedProject &&
                    item.owner !== userData.user_id
                  ) {
                    // const isNew = notifications.find(
                    //     (i) =>  i.docname === item?.name && i.seen === "false" && i.event_id === "pr:rejected"
                    // )
                    return (
                      <TableRow key={item.name}>
                        <TableCell className="text-sm text-center">
                          <Link
                            to={`${item.name}`}
                            className="text-blue-500 underline-offset-1"
                          >

                            <span>{item.name.slice(-4)}</span>

                          </Link>
                        </TableCell>
                   
                        <TableCell className="text-sm text-center">
                          {/* The vendor name is also available */}
                          {item.vendor_name || "N/A"} {/* Fallback for no vendor */}
                        </TableCell>
                        {/* <TableCell className="text-sm text-center">
                          
                          <span>{item.status}</span>
                        </TableCell> */}
                        <TableCell className="text-sm text-center">
                          {/* The vendor name is also available */}
                          {formatDate(item.creation) || "--"} {/* Fallback for no vendor */}
                        </TableCell>
                      </TableRow>
                    );
                  }
                })}
              </TableBody>
            </Table>
          </div>
        )}
      
      </div>
    </div>
  );
}


//AUG-BEFORE
// import ProjectSelect from "@/components/custom-select/project-select";
// import { ProcurementRequestsSkeleton } from "@/components/ui/skeleton";
// import {
//   Table,
//   TableBody,
//   TableCell,
//   TableHead,
//   TableHeader,
//   TableRow,
// } from "@/components/ui/table";
// import { useUserData } from "@/hooks/useUserData";
// import { ServiceRequests as ServiceRequestsType } from "@/types/NirmaanStack/ServiceRequests";
// import { UserContext } from "@/utils/auth/UserProvider";
// import {
//   FrappeConfig,
//   FrappeContext,
//   useFrappeDocTypeEventListener,
//   useFrappeGetDocList,
// } from "frappe-react-sdk";
// import { useContext } from "react";
// import { Link, useNavigate } from "react-router-dom";

// export default function ListSR() {
//   const navigate = useNavigate();
//   const userData = useUserData();

//   const { setSelectedProject, selectedProject } = useContext(UserContext);

//   // const {notifications, mark_seen_notification} = useNotificationStore()

//   const {
//     data: service_request_list,
//     isLoading: service_request_list_loading,
//     error: service_request_list_error,
//     mutate: srListMutate,
//   } = useFrappeGetDocList<ServiceRequestsType>(
//     "Service Requests",
//     {
//       fields: ["*"],
//       orderBy: { field: "creation", order: "desc" },
//       limit: 10000,
//     }
//   );

//   useFrappeDocTypeEventListener("Service Requests", async (event) => {
//     await srListMutate();
//   });

  
//   // const {data : procurementOrdersList} = useFrappeGetDocList("Procurement Orders", {
//   //     fields: ["*"],
//   //     limit: 1000
//   // },
//   // "Procurement Orders"
//   // )

//   // const checkPoToPr = (prId) => {
//   //     return procurementOrdersList?.some((po) => po.procurement_request === prId)
//   // }

//   const handleChange = (selectedItem: any) => {
//     setSelectedProject(selectedItem ? selectedItem.value : null);
//     if(selectedItem) {
//       sessionStorage.setItem(
//         "selectedProject",
//         JSON.stringify(selectedItem.value)
//       );
//     } else {
//       sessionStorage.removeItem("selectedProject");
//     }
// };

//   const { db } = useContext(FrappeContext) as FrappeConfig;
//   // const handleRejectPRSeen = (notification) => {
//   //     console.log("running", notification)
//   //     if(notification) {
//   //         mark_seen_notification(db, notification)
//   //     }
//   // }

//   if (service_request_list_loading) return <ProcurementRequestsSkeleton />;
//   if (service_request_list_error) return <h1>ERROR</h1>;

//   return (
//     <div className="flex-1 space-y-4 min-h-[50vh]">
//       {/* <div className="flex items-center gap-1">
//                 <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} />
//             <div className="flex items-center gap-1">
//                 {/* <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} /> */}
//       {/* <div className="flex items-center gap-1">
//                 <ArrowLeft className="cursor-pointer" onClick={() => navigate(-1)} />
//                 <h2 className="text-xl  font-bold tracking-tight">Service Requests</h2>
//             </div> */}

//       <div className="gap-4 border border-gray-200 rounded-lg p-0.5">
//         <ProjectSelect onChange={handleChange} />
//         {selectedProject && (
//           <div className="mx-0 px-0 pt-4">
//             <h2 className="text-lg pl-2 font-semibold tracking-normal py-2">
//               Created By {userData?.full_name}
//             </h2>
//             <Table>
//               <TableHeader className="bg-red-100">
//                 <TableRow>
//                   <TableHead className="w-[30%] text-center font-extrabold">
//                     SR no.
//                   </TableHead>
//                   {/* <TableHead className="w-[35%] text-center font-extrabold">Package</TableHead> */}
//                   <TableHead className="w-[35%] text-center font-extrabold">
//                     Status
//                   </TableHead>
//                 </TableRow>
//               </TableHeader>
//               <TableBody>
//                 {service_request_list?.map((item) => {
//                   if (
//                     item.project === selectedProject &&
//                     item.owner === userData.user_id
//                   ) {
//                     // const isNew = notifications.find(
//                     //     (i) =>  i.docname === item?.name && i.seen === "false" && i.event_id === "pr:rejected"
//                     // )
//                     return (
//                       <TableRow key={item.name}>
//                         <TableCell className="text-sm text-center">
//                           <Link
//                             to={`${item.name}`}
//                             className="text-blue-500 underline-offset-1 relative"
//                           >
//                             {/* {item.workflow_state === "Rejected" && isNew && (
//                                                         <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 sm:-left-10  animate-pulse" />
//                                                     )} */}
//                             <span>{item.name.slice(-4)}</span>
//                             {/* <span onClick={() => handleRejectPRSeen(isNew)}>{item.name.slice(-4)}</span> */}
//                           </Link>
//                         </TableCell>
//                         {/* <TableCell className="text-sm text-center">{item.work_package}</TableCell> */}
//                         <TableCell className="text-sm text-center">
//                           {/* <Badge variant={`${["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(item.workflow_state) ? "orange" : ["Partially Approved", "Vendor Approved"].includes(item.workflow_state) ? "green" : (["Delayed", "Sent Back"].includes(item.workflow_state) && checkPoToPr(item.name)) ? "green" : (["Delayed", "Sent Back"].includes(item.workflow_state) && !checkPoToPr(item.name)) ? "orange" : item.workflow_state === "Rejected" ? "red" : "yellow"}`}>
//                                                     {["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(item.workflow_state) ? "In Progress" : ["Partially Approved", "Vendor Approved"].includes(item.workflow_state) ? "Ordered" : (["Delayed", "Sent Back"].includes(item.workflow_state) && checkPoToPr(item.name)) ? "Ordered" : (["Delayed", "Sent Back"].includes(item.workflow_state) && !checkPoToPr(item.name)) ? "In Progress" : item.workflow_state === "Pending" ? "Approval Pending" : item.workflow_state}
//                                                 </Badge> */}
//                           <span>{item.status}</span>
//                         </TableCell>
//                       </TableRow>
//                     );
//                   }
//                 })}
//               </TableBody>
//             </Table>
//           </div>
//         )}

//         {selectedProject && (
//           <div className="mx-0 px-0 pt-4">
//             <h2 className="text-lg pl-2 font-semibold tracking-normal py-2">
//               Created By Others
//             </h2>
//             <Table>
//               <TableHeader className="bg-red-100">
//                 <TableRow>
//                   <TableHead className="w-[30%] text-center font-extrabold">
//                     SR no.
//                   </TableHead>
//                   {/* <TableHead className="w-[35%] text-center font-extrabold">Package</TableHead> */}
//                   <TableHead className="w-[35%] text-center font-extrabold">
//                     Status
//                   </TableHead>
//                 </TableRow>
//               </TableHeader>
//               <TableBody>
//                 {service_request_list?.map((item) => {
//                   if (
//                     item.project === selectedProject &&
//                     item.owner !== userData.user_id
//                   ) {
//                     // const isNew = notifications.find(
//                     //     (i) =>  i.docname === item?.name && i.seen === "false" && i.event_id === "pr:rejected"
//                     // )
//                     return (
//                       <TableRow key={item.name}>
//                         <TableCell className="text-sm text-center">
//                           <Link
//                             to={`${item.name}`}
//                             className="text-blue-500 underline-offset-1"
//                           >
//                             {/* {item.workflow_state === "Rejected" && isNew && (
//                                                         <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 sm:-left-10  animate-pulse" />
//                                                 )} */}
//                             <span>{item.name.slice(-4)}</span>
//                             {/* <span onClick={() => handleRejectPRSeen(isNew)}>{item.name.slice(-4)}</span> */}
//                           </Link>
//                         </TableCell>
//                         {/* <TableCell className="text-sm text-center">{item.work_package}</TableCell> */}
//                         <TableCell className="text-sm text-center">
//                           {/* <Badge variant={`${["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(item.workflow_state) ? "orange" : ["Partially Approved", "Vendor Approved"].includes(item.workflow_state) ? "green" : (["Delayed", "Sent Back"].includes(item.workflow_state) && checkPoToPr(item.name)) ? "green" : (["Delayed", "Sent Back"].includes(item.workflow_state) && !checkPoToPr(item.name)) ? "orange" : item.workflow_state === "Rejected" ? "red" : "yellow"}`}>
//                                                     {["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(item.workflow_state) ? "In Progress" : ["Partially Approved", "Vendor Approved"].includes(item.workflow_state) ? "Ordered" : (["Delayed", "Sent Back"].includes(item.workflow_state) && checkPoToPr(item.name)) ? "Ordered" : (["Delayed", "Sent Back"].includes(item.workflow_state) && !checkPoToPr(item.name)) ? "In Progress" : item.workflow_state === "Pending" ? "Approval Pending" : item.workflow_state}
//                                                 </Badge> */}
//                           <span>{item.status}</span>
//                         </TableCell>
//                       </TableRow>
//                     );
//                   }
//                 })}
//               </TableBody>
//             </Table>
//           </div>
//         )}

//         {/* <div className="flex flex-col justify-end items-end fixed bottom-10 right-4">
//                     {selectedProject && <Button className="font-normal py-2 px-6 shadow-red-950">
//                         <Link to={`${selectedProject}/new`}>
//                             <div className="flex">
//                                 <CirclePlus className="w-5 h-5 mt- pr-1" />
//                                 Create SR
//                             </div>

//                         </Link>
//                     </Button>}
//                 </div> */}
//       </div>
//       {/* <div className="pt-10"></div> */}
//     </div>
//   );
// }
