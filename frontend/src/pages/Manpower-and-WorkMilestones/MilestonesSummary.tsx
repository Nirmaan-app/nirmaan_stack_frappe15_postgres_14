// import { UserContext } from "@/utils/auth/UserProvider";
// import { formatDate } from "@/utils/FormatDate";
// import { Pencil2Icon } from "@radix-ui/react-icons";
// import {
//   useFrappeCreateDoc,
//   useFrappeGetDoc,
//   useFrappeGetDocList,
//   useFrappeUpdateDoc
// } from "frappe-react-sdk";
// import { Copy ,MapPin} from "lucide-react";
// import { useContext, useEffect, useState } from "react";
// import { TailSpin } from "react-loader-spinner";
// import { useNavigate } from "react-router-dom";
// import ProjectSelect from "@/components/custom-select/project-select";
// import { Badge } from "@/components/ui/badge";
// import { Button } from "@/components/ui/button";
// import { Card, CardContent } from "@/components/ui/card";
// import {
//   Dialog,
//   DialogClose,
//   DialogContent,
//   DialogDescription,
//   DialogHeader,
//   DialogTitle,
//   DialogTrigger,
// } from "@/components/ui/dialog";
// import { Sheet, SheetContent } from "@/components/ui/sheet";
// import {
//   Table,
//   TableBody,
//   TableCell,
//   TableHead,
//   TableHeader,
//   TableRow,
// } from "@/components/ui/table";
// import { toast } from "@/components/ui/use-toast";

// export const MilestonesSummary = () => {

//   const {selectedProject, setSelectedProject} = useContext(UserContext)
//   const navigate = useNavigate();
//   const {
//     data: projectData,
//     isLoading: projectLoading,
//     error: projectError,
//   } = useFrappeGetDoc("Projects", selectedProject, selectedProject ? undefined : null);
//   const { createDoc, loading: createLoading } = useFrappeCreateDoc();
//   const [editReport, setEditReport] = useState(null);

//   const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();

//   const fullManpowerDetails = [
//     { role: "MEP Engineer", count: 0, key: "always" },
//     { role: "Safety Engineer", count: 0, key: "always" },
//     { role: "Electrical Team", count: 0, key: "Electrical Work" },
//     { role: "Fire Fighting Team", count: 0, key: "Fire Fighting System" },
//     { role: "Data & Networking Team", count: 0, key: "Data & Networking" },
//     { role: "HVAC Team", count: 0, key: "HVAC System" },
//     { role: "ELV Team", count: 0, key: "default" }, // For all other work packages
//   ];

//   const [manpowerDetails, setManpowerDetails] = useState(fullManpowerDetails);
//   const [page, setPage] = useState("list");
//   const [todayReportAvailable, setTodayReportAvailable] = useState(false);
//   // Renamed for clarity, as it will now hold today's report name
//   const [reportNameForToday, setReportNameForToday] = useState(null);

//   const {
//     data: manpowerData,
//     isLoading: manpowerLoading,
//     error: manpowerError,
//     mutate: manpowerMutate,
//   } = useFrappeGetDocList(
//     "Manpower Reports",
//     {
//       fields: ["*"],
//       filters: [["project", "=", selectedProject]],
//       orderBy: { field: "creation", order: "desc" },
//     },
//     selectedProject ? undefined : null
//   );

//   const {
//     data: projectProgressReports,
//     isLoading: projectProgressLoading,
//     error: projectProgressError,
//   } = useFrappeGetDocList(
//     "Project Progress Reports",
//     {
//       fields: ["name", "report_date", "project"],
//       filters: [
//         ["project", "=", selectedProject],
//       ],
//     },
//     selectedProject ? undefined : null
//   );

//   const {
//     data: todayReportDetails, // Renamed for clarity
//     isLoading: todayReportLoading, // Renamed for clarity
//     error: todayReportError, // Renamed for clarity
//   } = useFrappeGetDoc(
//     "Project Progress Reports",
//     reportNameForToday, // Use the state that holds today's report name
//     reportNameForToday ? undefined : null
//   );

//   console.log("todayReportDetailsH##",todayReportDetails?.manpoer)


//   useEffect(() => {
//     if (projectData?.project_work_packages && typeof projectData.project_work_packages === 'string') {
//       try {
//         const parsedData = JSON.parse(projectData.project_work_packages);
//         const selectedWorkPackages = parsedData.work_packages?.map((wp) => wp.work_package_name) || [];

//         const filteredDetails = fullManpowerDetails.filter((item) => {
//           if (item.key === "always") {
//             return true;
//           }
//           if (item.key === "default") {
//             return ![
//               "Electrical Work",
//               "Fire Fighting System",
//               "Data & Networking",
//               "HVAC System",
//             ].some((key) => selectedWorkPackages.includes(key));
//           }
//           return selectedWorkPackages.includes(item.key);
//         });

//         setManpowerDetails(filteredDetails);
//       } catch (error) {
//         console.error("Failed to parse project_work_packages JSON:", error);
//         setManpowerDetails(fullManpowerDetails);
//       }
//     } else {
//       setManpowerDetails(fullManpowerDetails);
//     }
//   }, [projectData]);

//   useEffect(() => {
//     if (projectProgressReports && selectedProject) {
//       const today = new Date(); // <--- CHANGE 1: Get today's date
//       const todayFormatted = formatDate(today); // <--- CHANGE 2: Format today's date

//       const foundReport = projectProgressReports.find(
//         (report) => formatDate(report.report_date) === todayFormatted // <--- CHANGE 3: Compare with today's formatted date
//       );

//       if (foundReport) {
//         setTodayReportAvailable(true);
//         setReportNameForToday(foundReport.name); // <--- CHANGE 4: Store today's report name
//       } else {
//         setTodayReportAvailable(false);
//         setReportNameForToday(null); // <--- CHANGE 5: Reset if no report for today
//       }
//     }
//   }, [projectProgressReports, selectedProject]);

//   console.log("Today Report Available:", todayReportAvailable); // Console log name updated for clarity
//   console.log("Today Report Details:", todayReportDetails); // Console log name updated for clarity

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

//   const handleInputChange = (index: number, value: string) => {
//     const updatedDetails = [...manpowerDetails];
//     updatedDetails[index].count = Number(value) || 0;
//     setManpowerDetails(updatedDetails);
//   };

//   const handleCopy = (id) => {
//     let filteredDetails;
//     if (id) {
//       filteredDetails = manpowerData?.find((i) => i?.name === id)?.report?.data;
//     } else {
//       filteredDetails = manpowerDetails.filter((item) => item.count > 0);
//     }

//     const total = filteredDetails.reduce((sum, item) => sum + item.count, 0);
//     const message = `
// *Manpower Report*

// Project - ${projectData?.project_name}
// Date - ${new Date().toLocaleDateString()}

// ${filteredDetails
//         .map(
//           (item, index) =>
//             `${index + 1}. ${item.role} - ${item.count
//               .toString()
//               .padStart(2, "0")} Nos.`
//         )
//         .join("\n")}

// Total - ${total.toString().padStart(2, "0")} Nos.
//     `.trim();
//     navigator.clipboard.writeText(message);
//     if (id) {
//       toast({
//         title: "Success!",
//         description: "Report copied to clipboard!",
//         variant: "success",
//       });
//     }
//   };

//   const [sheetOpen, setSheetOpen] = useState(false);

//   const toggleSheet = () => {
//     setSheetOpen((prevState) => !prevState);
//   };

//   const handleSave = async () => {
//     try {
//       const filteredDetails = manpowerDetails.filter((item) => item.count > 0);

//       const manpowerJSON = {
//         project: projectData?.project_name,
//         date: new Date().toLocaleDateString(),
//         manpower: filteredDetails.map((item) => ({
//           role: item.role,
//           count: item.count,
//         })),
//       };

//       handleCopy(undefined);

//       await createDoc("Manpower Reports", {
//         project: selectedProject,
//         project_name: projectData.project_name,
//         report: { data: manpowerJSON?.manpower },
//       });

//       await manpowerMutate();

//       toggleSheet();

//       toast({
//         title: "Success!",
//         description: "Report saved and copied to clipboard!",
//         variant: "success",
//       });
//     } catch (error) {
//       console.log(error);
//       toast({
//         title: "Failed!",
//         description: "Error while saving or copying the report!",
//         variant: "destructive",
//       });
//     } finally {
//       setPage("list");
//     }
//   };

//   const handleEditReport = async () => {
//     const filteredDetails = editReport?.report?.data?.filter(
//       (item) => item.count > 0
//     );

//     try {
//       await updateDoc("Manpower Reports", editReport?.name, {
//         report: { data: filteredDetails },
//       });

//       await manpowerMutate();

//       toast({
//         title: "Success!",
//         description: "Report updated successfully!",
//         variant: "success",
//       });

//       document.getElementById("updateReportClose")?.click();
//     } catch (error) {
//       console.log("error while updating manpower report", error);
//       toast({
//         title: "Failed!",
//         description: "Error while udpating the report!",
//         variant: "destructive",
//       });
//     }
//   };

// let workPackages = [];

// if (projectData?.project_work_packages) {
//   try {
//     const parsed = JSON.parse(projectData.project_work_packages);
//     if (Array.isArray(parsed.work_packages)) {
//       workPackages = parsed.work_packages;
//     }
//   } catch (e) {
//     console.error("Error parsing work packages for display:", e);
//   }
// }

//   if (projectLoading || manpowerLoading || projectProgressLoading || todayReportLoading) return <h1>Loading</h1>; // <--- CHANGE 6: Updated loading state
//   if (projectError || manpowerError || projectProgressError || todayReportError) return <h1>Error</h1>; // <--- CHANGE 7: Updated error state
//   return (
//     <>
//       {page === "list" && (
//         <div className="flex-1 space-y-4 min-h-[50vh]">
//           <div className="flex items-center gap-2">
//             <div className="flex-1">
//               <ProjectSelect onChange={handleChange} />
//             </div>
//             {/* Removed "Overall Summary" button */}
//             {selectedProject && (
//                 <Button
//                     onClick={() => navigate(`${selectedProject}`)}
//                     className="text-xs"
//                     disabled={todayReportAvailable}
//                 >
//                     {todayReportAvailable ? "Today's Milestone Updated" : "Update Milestone"}
//                 </Button>
//             )}
//           </div>
//           {selectedProject && (
//             <div className="mx-0 px-0 pt-4">
//               <Table>
//                 <TableHeader className="bg-red-100">
//                   <TableRow>
//                     <TableHead className="w-[40%] text-center font-extrabold">
//                       Report
//                     </TableHead>
//                     <TableHead className="w-[20%] text-center font-extrabold">
//                       Date Created
//                     </TableHead>
//                     <TableHead className="w-[5%] text-center font-extrabold">
//                       Options
//                     </TableHead>
//                   </TableRow>
//                 </TableHeader>
//                 <TableBody>
//                   {manpowerData?.map((item) => {
//                     return (
//                       <TableRow key={item.name}>
//                         <TableCell className="text-xs text-center">
//                           <div className="flex flex-col gap-1 items-center justify-center">
//                             {item.report.data.map((r) => {
//                               return (
//                                 <Badge key={r.role}>
//                                   {r.role}: {r.count}
//                                 </Badge>
//                               );
//                             })}
//                           </div>
//                         </TableCell>
//                         <TableCell className="text-xs text-center">
//                           {formatDate(item.creation)}
//                         </TableCell>
//                         <TableCell className="text-center">
//                           <div className="flex items-center gap-2">
//                             <Dialog>
//                               <DialogTrigger>
//                                 <Pencil2Icon
//                                   onClick={() => setEditReport(item)}
//                                   className="max-sm:w-4 max-sm:h-4 w-6 h-6 hover:text-blue-500"
//                                 />
//                               </DialogTrigger>
//                               <DialogContent>
//                                 <DialogHeader>
//                                   <DialogTitle>
//                                     Edit{" "}
//                                     <span className="text-primary">
//                                       {item.project_name}
//                                     </span>{" "}
//                                     {formatDate(item?.creation)}'s Report
//                                   </DialogTitle>
//                                 </DialogHeader>
//                                 <DialogDescription className="flex flex-col gap-4 w-full">
//                                   {manpowerDetails?.map((detailItem, index) => {
//                                     const addedItem =
//                                       editReport?.report?.data?.find(
//                                         (i) => i?.role === detailItem?.role
//                                       );
//                                     return (
//                                       <div
//                                         key={index}
//                                         className="flex items-center gap-4"
//                                       >
//                                         <label className="w-40">
//                                           {detailItem.role}:
//                                         </label>
//                                         <input
//                                           type="number"
//                                           value={addedItem?.count || 0}
//                                           onChange={(e) => {
//                                             const newValue = parseFloat(
//                                               e.target.value
//                                             );
//                                             setEditReport((prevState) => {
//                                               const currentReportData = prevState?.report?.data || [];
//                                               const existingItemIndex =
//                                                 currentReportData.findIndex(
//                                                   (dataItem) =>
//                                                     dataItem.role === detailItem.role
//                                                 );

//                                               if (existingItemIndex !== -1) {
//                                                 const updatedData = [
//                                                   ...currentReportData,
//                                                 ];
//                                                 updatedData[existingItemIndex] =
//                                                 {
//                                                   ...updatedData[
//                                                   existingItemIndex
//                                                   ],
//                                                   count: newValue,
//                                                 };
//                                                 return {
//                                                   ...prevState,
//                                                   report: {
//                                                     ...prevState?.report,
//                                                     data: updatedData,
//                                                   },
//                                                 };
//                                               }

//                                               return {
//                                                 ...prevState,
//                                                 report: {
//                                                   ...prevState?.report,
//                                                   data: [
//                                                     ...currentReportData,
//                                                     {
//                                                       role: detailItem.role,
//                                                       count: newValue,
//                                                     },
//                                                   ],
//                                                 },
//                                               };
//                                             });
//                                           }}
//                                           className="border border-gray-300 rounded-md px-2 py-1"
//                                         />
//                                       </div>
//                                     );
//                                   })}
//                                   <Button
//                                     onClick={() => handleEditReport()}
//                                     disabled={
//                                       !editReport ||
//                                       editReport.report?.data?.every(
//                                         (i) =>
//                                           i?.count ===
//                                           manpowerData?.find(
//                                             (j) => j?.name === editReport?.name
//                                           )?.report?.data?.find(
//                                             (k) => k?.role === i?.role
//                                           )?.count
//                                       )
//                                     }
//                                   >
//                                     {updateLoading ? (
//                                       <TailSpin
//                                         color={"white"}
//                                         width={20}
//                                         height={20}
//                                       />
//                                     ) : (
//                                       "Update"
//                                     )}
//                                   </Button>
//                                   <DialogClose
//                                     id="updateReportClose"
//                                     className="hidden"
//                                   >
//                                     Close
//                                   </DialogClose>
//                                 </DialogDescription>
//                               </DialogContent>
//                             </Dialog>
//                             <span>|</span>
//                             <Copy
//                               className="cursor-pointer hover:text-blue-500 max-sm:w-4 max-sm:h-4"
//                               onClick={() => handleCopy(item?.name)}
//                             />
//                           </div>
//                         </TableCell>
//                       </TableRow>
//                     );
//                   })}
//                 </TableBody>
//               </Table>
//               <div className="flex items-center justify-end py-6">
//                 <Button
//                     disabled={todayReportAvailable} // Remains disabled if a report for today is found
//                     onClick={() => toggleSheet()}
//                     className="max-sm:text-xs"
//                 >
//                     {todayReportAvailable ? "Today's Manpower Report Submitted" : "Create New Manpower Report"} {/* <--- CHANGE 8: Updated button text */}
//                 </Button>
//               </div>

//               {/* Display Today's Report Details Here, outside the Sheet and in its own Card, mimicking the provided image layout */}
//               {todayReportDetails && ( // <--- CHANGE 9: Use todayReportDetails
//                 <Card className="mt-4 w-full p-4">
//                   <CardContent className="flex flex-col gap-4">
//                     {/* Project Name and Location */}
//                     <div className="pb-2 border-b">
//                       <h3 className="text-xl font-bold">{projectData?.project_name || "Project Name"}</h3>
//                       <p className="text-sm text-gray-500">{projectData?.project_city || "--"}</p>
//                     </div>

//                     {/* Key Metrics */}
//                     <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-b pb-4">
//                       <div>
//                         <p className="text-sm font-semibold">Number of packages</p>
//                         <p className="text-lg font-bold">{todayReportDetails.milestones?.length || '00'}</p> {/* <--- CHANGE 10: Use todayReportDetails */}
//                       </div>
//                       <div>
//                         <p className="text-sm font-semibold">Work done</p>
//                         <p className="text-lg font-bold">
//                           {todayReportDetails.milestones ? // <--- CHANGE 11: Use todayReportDetails
//                             todayReportDetails.milestones.filter(m => m.status === "Completed").length : '00'}
//                         </p>
//                       </div>
//                       <div>
//                         <p className="text-sm font-semibold">Man power used</p>
//                         <p className="text-lg font-bold">
//                           {todayReportDetails.manpower ? // <--- CHANGE 12: Use todayReportDetails
//                             todayReportDetails.manpower.reduce((sum, mp) => sum + parseInt(mp.count || 0), 0).toString().padStart(2, '0') : '00'}
//                         </p>
//                       </div>
//                     </div>

//                     {/* Report Date and Manpower Remarks */}
//                     {todayReportDetails.report_date && ( // <--- CHANGE 13: Use todayReportDetails
//                         <div className="flex flex-col gap-2">
//                           <strong className="text-lg font-semibold">Report Date:</strong>
//                           <p className="text-gray-700">{formatDate(todayReportDetails.report_date)}</p> {/* <--- CHANGE 14: Use todayReportDetails */}
//                         </div>
//                     )}
//                     {todayReportDetails.manpower_remarks && ( // <--- CHANGE 15: Use todayReportDetails
//                         <div className="flex flex-col gap-2">
//                           <strong className="text-lg font-semibold">Manpower Remarks:</strong>
//                           <p className="text-gray-700">{todayReportDetails.manpower_remarks}</p> {/* <--- CHANGE 16: Use todayReportDetails */}
//                         </div>
//                     )}

//                     {/* Work Progress Sections (mimicking Data cables and Fire Fighting System) */}
//                     {todayReportDetails.milestones && todayReportDetails.milestones.length > 0 && ( // <--- CHANGE 17: Use todayReportDetails
//                       <>
//                         <h4 className="font-bold text-lg mt-4">Work Milestones Progress</h4>
//                         {/* Group milestones by work_header */}
//                         {Object.entries(
//                           todayReportDetails.milestones.reduce((acc, milestone) => { // <--- CHANGE 18: Use todayReportDetails
//                             (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
//                             return acc;
//                           }, {})
//                         ).map(([header, milestones], groupIdx) => (
//                           <div key={groupIdx} className="mb-4">
//                             <h5 className="font-semibold text-md mb-2">{header}</h5>
//                             <Table className="border rounded-md overflow-hidden">
//                               <TableHeader>
//                                 <TableRow className="bg-gray-50">
//                                   <TableHead className="w-[40%]">Work</TableHead>
//                                   <TableHead className="w-[20%] text-center">Work Completed</TableHead>
//                                   <TableHead className="w-[20%] text-center">Status</TableHead>
//                                   <TableHead className="w-[20%] text-center">Expected Date</TableHead>
//                                 </TableRow>
//                               </TableHeader>
//                               <TableBody>
//                                 {milestones.map((milestone, idx) => (
//                                   <TableRow key={idx}>
//                                     <TableCell>{milestone.work_milestone_name}</TableCell>
//                                     <TableCell className="text-center">{milestone.progress}%</TableCell>
//                                     <TableCell className="text-center">
//                                       <Badge variant={milestone.status === "Completed" ? "default" : "secondary"}>
//                                         {milestone.status}
//                                       </Badge>
//                                     </TableCell>
//                                     <TableCell className="text-center">
//                                       {milestone.expected_completion_date ? formatDate(milestone.expected_completion_date) : 'N/A'}
//                                     </TableCell>
//                                   </TableRow>
//                                 ))}
//                               </TableBody>
//                             </Table>
//                           </div>
//                         ))}
//                       </>
//                     )}

//                     {/* Workers Section */}
//                     {todayReportDetails.manpower && todayReportDetails.manpower.length > 0 && ( // <--- CHANGE 19: Use todayReportDetails
//                       <div className="mt-4">
//                         <h4 className="font-bold text-lg mb-2">Workers</h4>
//                         <Table className="border rounded-md overflow-hidden">
//                           <TableHeader>
//                             <TableRow className="bg-gray-50">
//                               <TableHead className="w-[70%]">Team / Roles</TableHead>
//                               <TableHead className="w-[30%] text-center">Count</TableHead>
//                             </TableRow>
//                           </TableHeader>
//                           <TableBody>
//                             {todayReportDetails.manpower.map((mp_detail, idx) => ( // <--- CHANGE 20: Use todayReportDetails
//                               <TableRow key={idx}>
//                                 <TableCell>{mp_detail.label}</TableCell>
//                                 <TableCell className="text-center">{mp_detail.count.toString().padStart(2, '0')}</TableCell>
//                               </TableRow>
//                             ))}
//                           </TableBody>
//                         </Table>
//                       </div>
//                     )}

//                     {/* Photos Section (Placeholder - as no image data is available in the current JSON) */}


// <div className="mt-4">
//     <h4 className="font-bold text-lg mb-2">Photos ({todayReportDetails.attachments?.length || 0})</h4>

//     {todayReportDetails.attachments && todayReportDetails.attachments.length > 0 ? (
//         <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-4 gap-4">
//             {todayReportDetails.attachments.map((attachment, idx) => (
//                 <div 
//                     key={idx} 
//                     className="relative rounded-lg overflow-hidden shadow-md group cursor-pointer"
//                     style={{ width: '200px', height: '200px' }} // Fixed 200x200 size
//                 >
//                     {/* Image */}
//                     <img 
//                         src={attachment.image_link} // Use image_link from your array
//                         alt={`Photo ${idx + 1}`} 
//                         className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
//                     />

//                     {/* Hover Overlay (Tooltip) */}
//                     <div className="absolute inset-0 bg-black bg-opacity-70 opacity-0 group-hover:opacity-100 transition-opacity duration-300 p-2 flex flex-col justify-end text-white text-xs">

//                         {/* Location */}
//                         <div className="flex items-center mb-1">
//                             <MapPin className="h-4 w-4 mr-1 text-red-400 flex-shrink-0" />
//                             <span className="font-semibold truncate">
//                                 {attachment.location || `Lat: ${attachment.latitude?.toFixed(2)}, Lon: ${attachment.longitude?.toFixed(2)}`}
//                             </span>
//                         </div>

//                         {/* Remarks */}
//                         <p className="line-clamp-3 text-gray-300">
//                             {attachment.remarks || "No remarks provided."}
//                         </p>
//                     </div>
//                 </div>
//             ))}
//         </div>
//     ) : (
//         // No Photos Placeholder
//         <div className="w-full h-32 bg-gray-100 flex items-center justify-center text-gray-500 rounded-lg border-2 border-dashed border-gray-300">
//             <p className="text-base font-medium">No Photos Attached to This Report</p>
//         </div>
//     )}
// </div>
//                   </CardContent>
//                 </Card>
//               )}

//               <Sheet open={sheetOpen} onOpenChange={toggleSheet}>
//                 <SheetContent>
//                 <div className="flex-1 space-y-2 md:space-y-4">
//         <div className="flex items-center ">
//           <h2 className="pl-2 text-lg md:text-xl font-bold tracking-tight">
//             NEW MANPOWER REPORT
//           </h2>
//         </div>
//         {selectedProject && (
//           <Card>
//             <CardContent>
//               <div className="flex flex-col gap-4 py-2 max-md:text-sm">
//                 <div className="flex flex-col gap-2">
//                   <strong>Work Packages:</strong>
//                   <div className="flex gap-1 flex-wrap">
//                     {workPackages.length > 0 ? (
//     workPackages.map((item:any, idx:number) => (
//       <div
//         key={idx}
//         className="flex items-center justify-center rounded-3xl p-1 bg-[#ECFDF3] text-[#067647] border-[1px] border-[#ABEFC6]"
//       >
//         {item.work_package_name}
//       </div>
//     ))
//   ) : (
//     <span className="text-sm text-gray-500">No work packages specified.</span>
//   )}
//                   </div>
//                 </div>

//                 <div>
//                   <strong>Date:</strong> {new Date().toLocaleDateString()}
//                 </div>
//                 {manpowerDetails.map((item, index) => (
//                   <div key={index} className="flex items-center gap-4">
//                     <label className="w-40">{item.role}:</label>
//                     <input
//                       type="number"
//                       value={item.count}
//                       onChange={(e) =>
//                         handleInputChange(index, e.target.value)
//                       }
//                       className="border border-gray-300 w-full rounded-md px-2 py-1"
//                     />
//                   </div>
//                 ))}
//                 <Button
//                   onClick={handleSave}
//                   disabled={createLoading}
//                   className="flex items-center justify-center"
//                 >
//                   {createLoading ? (
//                     <TailSpin width={20} height={20} color="white" />
//                   ) : (
//                     "Save & Copy Message"
//                   )}
//                 </Button>
//               </div>
//             </CardContent>
//           </Card>
//         )}
//                 </div>
//                 </SheetContent>
//               </Sheet>
//             </div>
//           )}
//         </div>
//       )}
//     </>
//   );
// };


import { UserContext } from "@/utils/auth/UserProvider";
import { formatDate } from "@/utils/FormatDate";
// import { Pencil2Icon } from "@radix-ui/react-icons"; // Removed as old manpower editing is gone
import {
  useFrappeCreateDoc, // Retained for potentially creating new Daily Reports if navigate target is a form
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappeUpdateDoc // Retained for potential editing of Daily Reports if navigate target is a form
} from "frappe-react-sdk";
import { MapPin } from "lucide-react"; // MapPin is used for image location
import { useContext, useEffect, useState } from "react";
import { TailSpin } from "react-loader-spinner"; // Retained for loading states on forms
import { useNavigate } from "react-router-dom";
import ProjectSelect from "@/components/custom-select/project-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
// Removed Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger as old manpower editing is gone
// Removed Sheet, SheetContent as old manpower report creation is gone
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/use-toast";
// Assuming CalendarIcon if needed for the date picker placeholder, otherwise it's not strictly necessary.
// import { CalendarIcon } from "@radix-ui/react-icons";


// Helper function to format date for input type="date" (YYYY-MM-DD)
const formatDateForInput = (date: Date): string => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const MilestonesSummary = () => {
  const { selectedProject, setSelectedProject } = useContext(UserContext);
  const navigate = useNavigate();

  // State for Report Type toggle ('Daily' or 'Overall')
  const [reportType, setReportType] = useState<'Daily' | 'Overall'>('Daily');
  // State for the date selected by the user for displaying reports
  const [displayDate, setDisplayDate] = useState<Date>(new Date()); // Initialize with today's date

  // State to hold the Frappe document name of the Project Progress Report for the selected displayDate
  const [reportForDisplayDateName, setReportForDisplayDateName] = useState<string | null>(null);

  // Fetch project data (e.g., project name, work packages)
  const {
    data: projectData,
    isLoading: projectLoading,
    error: projectError,
  } = useFrappeGetDoc("Projects", selectedProject, selectedProject ? undefined : null);

  // Fetch list of Project Progress Reports (to find report names by date)
  const {
    data: projectProgressReports,
    isLoading: projectProgressLoading,
    error: projectProgressError,
  } = useFrappeGetDocList(
    "Project Progress Reports",
    {
      fields: ["name", "report_date", "project"],
      filters: [
        ["project", "=", selectedProject],
      ],
    },
    selectedProject ? undefined : null
  );

  // Fetch the detailed Project Progress Report for the determined reportForDisplayDateName
  const {
    data: dailyReportDetails,
    isLoading: dailyReportLoading,
    error: dailyReportError,
  } = useFrappeGetDoc(
    "Project Progress Reports",
    reportForDisplayDateName, // Fetch using the determined report name
    reportForDisplayDateName && reportType === 'Daily' ? undefined : null // Only fetch if a name exists and reportType is Daily
  );

  // Effect to determine reportForDisplayDateName based on selectedProject and displayDate
  useEffect(() => {
    if (projectProgressReports && selectedProject && displayDate) {
      const selectedDateFormatted = formatDate(displayDate); // Assuming formatDate handles Date objects

      const foundReport = projectProgressReports.find(
        (report) => formatDate(report.report_date) === selectedDateFormatted
      );

      if (foundReport) {
        setReportForDisplayDateName(foundReport.name);
      } else {
        setReportForDisplayDateName(null);
      }
    }
  }, [projectProgressReports, selectedProject, displayDate]);

  // Handle project selection change
  const handleChange = (selectedItem: any) => {
    setSelectedProject(selectedItem ? selectedItem.value : null);
    if (selectedItem) {
      sessionStorage.setItem(
        "selectedProject",
        JSON.stringify(selectedItem.value)
      );
    } else {
      sessionStorage.removeItem("selectedProject");
    }
  };

  // Calculate metrics for the Daily Work Report Summary Section
  const totalWorkHeaders = dailyReportDetails?.milestones?.length || 0;
  const completedWorksOnReport = dailyReportDetails?.milestones?.filter(m => m.status === "Completed").length || 0;
  const totalManpowerInReport = dailyReportDetails?.manpower?.reduce((sum, mp) => sum + Number(mp.count || 0), 0) || 0;

  // Loading and Error States
  if (projectLoading || projectProgressLoading || dailyReportLoading) return <h1>Loading</h1>;
  if (projectError || projectProgressError || dailyReportError) return <h1>Error</h1>;

  return (
    <>
      <div className="flex-1 space-y-4 min-h-[50vh]">
        {/* Project Selector and "Update Milestone" button at the top */}
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <ProjectSelect onChange={handleChange} />
          </div>
          {selectedProject && (
            <Button
              onClick={() => navigate(`${selectedProject}`)}
              className="text-xs"
              disabled={dailyReportDetails}
            >
              {dailyReportDetails ? "Today's Milestone Updated" : "Update Milestone"}
            </Button>
          )}
        </div>

        {selectedProject && (
          <div className="mx-0 px-0 pt-4 ">
            {/* Report Type and Show By Date section - as per image */}
            <div className="flex items-center justify-between mb-4 p-4 shadow-sm border border-gray-300 rounded-md">
              <div className="flex flex-col md:flex-row md:items-center gap-2"> {/* Fix applied here */}
                {/* 1. Report Type Label */}
                <span className="font-semibold text-gray-700">Report Type</span>

                {/* 2. Daily/Overall Buttons */}
                <div className="flex rounded-md border border-gray-300 overflow-hidden">
                  <button
                    className={`px-4 py-2 text-sm font-medium ${reportType === 'Daily' ? 'bg-blue-600 text-white' : 'bg-white text-blue-600'}`}
                    onClick={() => setReportType('Daily')}
                  >
                    Daily
                  </button>
                  <button
                    className={`px-4 py-2 text-sm font-medium ${reportType === 'Overall' ? 'bg-blue-600 text-white' : 'bg-white text-blue-600'}`}
                    onClick={() => setReportType('Overall')}
                  >
                    Overall
                  </button>
                </div>
              </div>

              {reportType === 'Daily' && ( // Only show date picker for Daily report type
                <div className="flex flex-col md:flex-row md:items-center gap-2"> {/* Fix applied here */}
                  <span className="font-semibold text-gray-700">Show by Date</span>
                  <div className="relative">
                    <input
                      type="date"
                      value={displayDate ? formatDateForInput(displayDate) : ''}
                      onChange={(e) => setDisplayDate(new Date(e.target.value))}
                      className="pl-3 pr-10 py-2 border border-gray-300 rounded-md text-sm cursor-pointer"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Conditional rendering for Daily Work Report Card or placeholder */}
            {reportType === 'Daily' ? (
              dailyReportDetails ? (
                <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-300">
                  {/* Daily Work Report content - Matching the image */}
                  <div className="flex justify-between items-center mb-4 border-b pb-2">
                    <h2 className="text-xl font-bold">Daily Work Report</h2>
                    {/* Display report date from the fetched dailyReportDetails, fallback to displayDate */}
                    <span className="text-gray-600">
                      {dailyReportDetails.report_date ? formatDate(dailyReportDetails.report_date) : formatDate(displayDate)}
                    </span>
                  </div>

                  {/* Summary Metrics */}
                  <div className="mb-6 space-y-2 text-gray-700">
                    <div className="flex justify-between">
                      <span>Total number of works done:</span>
                      <span className="font-semibold">{completedWorksOnReport.toString().padStart(2, '0')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Total of Work Headers:</span>
                      <span className="font-semibold">{totalWorkHeaders.toString().padStart(2, '0')}</span> {/* Assuming each milestone is a 'package' */}
                    </div>
                    <div className="flex justify-between">
                      <span>Manpower Used:</span>
                      <span className="font-semibold">{totalManpowerInReport.toString().padStart(2, '0')}</span>
                    </div>
                  </div>

                  {/* Manpower Section */}
                  {dailyReportDetails.manpower && dailyReportDetails.manpower.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-lg font-bold mb-3">Manpower - {totalManpowerInReport.toString().padStart(2, '0')}</h3>
                      <div className="space-y-2">
                        {dailyReportDetails.manpower.map((mp_detail, idx) => (
                          <div key={idx} className="flex justify-between items-center text-gray-700">
                            <span className="font-medium">{mp_detail.label}</span>
                            <span className="font-semibold">{mp_detail.count.toString().padStart(2, '0')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Work Progress Sections (Ducting, FA PA & ACS etc.) */}
                  {dailyReportDetails.milestones && dailyReportDetails.milestones.length > 0 && (
                    <div className="mb-6">
                      {Object.entries(
                        dailyReportDetails.milestones.reduce((acc, milestone) => {
                          (acc[milestone.work_header] = acc[milestone.work_header] || []).push(milestone);
                          return acc;
                        }, {})
                      ).map(([header, milestones], groupIdx) => (
                        <div key={groupIdx} className="mb-4 last:mb-0">
                          <h3 className="text-lg font-bold mb-2">{header} - {milestones.length.toString().padStart(2, '0')}</h3>
                          <Table className="border rounded-md overflow-hidden">
                            <TableHeader>
                              <TableRow className="bg-gray-100">
                                <TableHead className="w-[40%] font-semibold text-gray-700">Work</TableHead>
                                <TableHead className="w-[20%] text-center font-semibold text-gray-700">Status</TableHead>
                                <TableHead className="w-[20%] text-center font-semibold text-gray-700">Work Completed</TableHead>
                                <TableHead className="w-[20%] text-center font-semibold text-gray-700">Expected Comp. Date</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {milestones.map((milestone, idx) => (
                                <TableRow key={idx}>
                                  <TableCell className="py-2">{milestone.work_milestone_name}</TableCell>
                                  <TableCell className="text-center py-2">
                                    <Badge variant={milestone.status === "Completed" ? "default" : "secondary"}>
                                      {milestone.status}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-center py-2">{milestone.progress}%</TableCell>
                                  <TableCell className="text-center py-2">
                                    {milestone.expected_completion_date ? formatDate(milestone.expected_completion_date) : 'N/A'}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Work Images Section */}
                  <div className="mt-6">
                    <h3 className="text-lg font-bold mb-3">Work Images</h3>
                    {dailyReportDetails.attachments && dailyReportDetails.attachments.length > 0 ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {dailyReportDetails.attachments.map((attachment, idx) => (
                          <div
                            key={idx}
                            className="relative rounded-lg overflow-hidden shadow-md group cursor-pointer aspect-square" // Ensures square images
                          >
                            <img
                              src={attachment.image_link}
                              alt={`Work Image ${idx + 1}`}
                              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                            {/* Hover Overlay for image details */}
                            <div className="absolute inset-0 bg-black bg-opacity-70 opacity-0 group-hover:opacity-100 transition-opacity duration-300 p-2 flex flex-col justify-end text-white text-xs">
                              <div className="flex items-center mb-1">
                                <MapPin className="h-3 w-3 mr-1 text-red-400 flex-shrink-0" />
                                <span className="font-semibold truncate">
                                  {attachment.location || `Lat: ${attachment.latitude?.toFixed(2)}, Lon: ${attachment.longitude?.toFixed(2)}`}
                                </span>
                              </div>
                              <p className="line-clamp-2 text-gray-300">
                                {attachment.remarks || "No remarks provided."}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="w-full h-32 bg-gray-100 flex items-center justify-center text-gray-500 rounded-lg border-2 border-dashed border-gray-300">
                        <p className="text-base font-medium">No Work Images Available</p>
                      </div>
                    )}
                  </div>

                  {/* Download PDF Button */}
                  <div className="mt-8 flex justify-center">
                    <Button className="bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-lg text-lg flex items-center gap-2">
                      {/* SVG for PDF icon */}
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375H12a1.125 1.125 0 0 1-1.125-1.125V1.5M19.5 14.25a2.25 2.25 0 0 0 .984-1.952V6.75A2.25 2.25 0 0 0 17.25 4.5H15M19.5 14.25h-4.75a1.125 1.125 0 0 1-1.125-1.125V9.75M19.5 14.25v2.25m0-2.25a1.125 1.125 0 0 1-1.125 1.125H4.5A2.25 2.25 0 0 0 2.25 18V6.75A2.25 0 0 0 4.5 4.5h7.5A2.25 0 0 1 14.25 6.75v2.25" />
                      </svg>
                      Download PDF
                    </Button>
                  </div>
                </div>
              ) : (
                // Display when Daily is selected but no report found for the date
                <Card className="mt-4 p-4">
                  <CardContent className="text-center flex flex-col items-center gap-4">
                    <p className="text-gray-500">No daily report found for {formatDate(displayDate)}.</p>

                  </CardContent>
                </Card>
              )
            ) : (
              // Display when Overall is selected (placeholder)
              <Card className="mt-4 p-4">
                <CardContent>
                  <p className="text-center text-gray-500">Overall report summary would be displayed here.</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  );
};