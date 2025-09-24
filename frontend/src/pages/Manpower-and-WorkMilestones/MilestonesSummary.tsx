import { UserContext } from "@/utils/auth/UserProvider";
import { formatDate } from "@/utils/FormatDate";
import { Pencil2Icon } from "@radix-ui/react-icons";
import {
  useFrappeCreateDoc,
  useFrappeGetDoc,
  useFrappeGetDocList,
  useFrappeUpdateDoc
} from "frappe-react-sdk";
import { Copy } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useNavigate } from "react-router-dom";
import ProjectSelect from "@/components/custom-select/project-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/use-toast";

export const MilestonesSummary = () => {

  const {selectedProject, setSelectedProject} = useContext(UserContext)
  const navigate = useNavigate();
  const {
    data: projectData,
    isLoading: projectLoading,
    error: projectError,
  } = useFrappeGetDoc("Projects", selectedProject, selectedProject ? undefined : null);
  const { createDoc, loading: createLoading } = useFrappeCreateDoc();
  const [editReport, setEditReport] = useState(null);

  const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();

  const fullManpowerDetails = [
    { role: "MEP Engineer", count: 0, key: "always" },
    { role: "Safety Engineer", count: 0, key: "always" },
    { role: "Electrical Team", count: 0, key: "Electrical Work" },
    { role: "Fire Fighting Team", count: 0, key: "Fire Fighting System" },
    { role: "Data & Networking Team", count: 0, key: "Data & Networking" },
    { role: "HVAC Team", count: 0, key: "HVAC System" },
    { role: "ELV Team", count: 0, key: "default" }, // For all other work packages
  ];

  const [manpowerDetails, setManpowerDetails] = useState(fullManpowerDetails);
  const [page, setPage] = useState("list");

  const {
    data: manpowerData,
    isLoading: manpowerLoading,
    error: manpowerError,
    mutate: manpowerMutate,
  } = useFrappeGetDocList(
    "Manpower Reports",
    {
      fields: ["*"],
      filters: [["project", "=", selectedProject]],
      orderBy: { field: "creation", order: "desc" },
    },
    selectedProject ? undefined : null
  );

useEffect(() => {
  if (projectData?.project_work_packages && typeof projectData.project_work_packages === 'string') {
    try {
      const parsedData = JSON.parse(projectData.project_work_packages);
      const selectedWorkPackages = parsedData.work_packages?.map((wp) => wp.work_package_name) || [];

      const filteredDetails = fullManpowerDetails.filter((item) => {
        if (item.key === "always") {
          return true;
        }
        if (item.key === "default") {
          return ![
            "Electrical Work",
            "Fire Fighting System",
            "Data & Networking",
            "HVAC System",
          ].some((key) => selectedWorkPackages.includes(key));
        }
        return selectedWorkPackages.includes(item.key);
      });

      setManpowerDetails(filteredDetails);
    } catch (error) {
      console.error("Failed to parse project_work_packages JSON:", error);
      setManpowerDetails(fullManpowerDetails);
    }
  } else {
    setManpowerDetails(fullManpowerDetails);
  }
}, [projectData]);
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

  const handleInputChange = (index: number, value: string) => {
    const updatedDetails = [...manpowerDetails];
    updatedDetails[index].count = Number(value) || 0;
    setManpowerDetails(updatedDetails);
  };

  const handleCopy = (id) => {
    let filteredDetails;
    if (id) {
      filteredDetails = manpowerData?.find((i) => i?.name === id)?.report?.data;
    } else {
      filteredDetails = manpowerDetails.filter((item) => item.count > 0);
    }

    const total = filteredDetails.reduce((sum, item) => sum + item.count, 0);
    const message = `
*Manpower Report*

Project - ${projectData?.project_name}
Date - ${new Date().toLocaleDateString()}

${filteredDetails
        .map(
          (item, index) =>
            `${index + 1}. ${item.role} - ${item.count
              .toString()
              .padStart(2, "0")} Nos.`
        )
        .join("\n")}

Total - ${total.toString().padStart(2, "0")} Nos.
    `.trim();
    navigator.clipboard.writeText(message);
    if (id) {
      toast({
        title: "Success!",
        description: "Report copied to clipboard!",
        variant: "success",
      });
    }
  };

  const [sheetOpen, setSheetOpen] = useState(false);

  const toggleSheet = () => {
    setSheetOpen((prevState) => !prevState);
  };

  const handleSave = async () => {
    try {
      const filteredDetails = manpowerDetails.filter((item) => item.count > 0);

      const manpowerJSON = {
        project: projectData?.project_name,
        date: new Date().toLocaleDateString(),
        manpower: filteredDetails.map((item) => ({
          role: item.role,
          count: item.count,
        })),
      };

      handleCopy(undefined);

      await createDoc("Manpower Reports", {
        project: selectedProject,
        project_name: projectData.project_name,
        report: { data: manpowerJSON?.manpower },
      });

      await manpowerMutate();

      toggleSheet();

      toast({
        title: "Success!",
        description: "Report saved and copied to clipboard!",
        variant: "success",
      });
    } catch (error) {
      console.log(error);
      toast({
        title: "Failed!",
        description: "Error while saving or copying the report!",
        variant: "destructive",
      });
    } finally {
      setPage("list");
    }
  };

  const handleEditReport = async () => {
    const filteredDetails = editReport?.report?.data?.filter(
      (item) => item.count > 0
    );

    try {
      await updateDoc("Manpower Reports", editReport?.name, {
        report: { data: filteredDetails },
      });

      await manpowerMutate();

      toast({
        title: "Success!",
        description: "Report updated successfully!",
        variant: "success",
      });

      document.getElementById("updateReportClose")?.click();
    } catch (error) {
      console.log("error while updating manpower report", error);
      toast({
        title: "Failed!",
        description: "Error while udpating the report!",
        variant: "destructive",
      });
    }
  };

let workPackages = [];

if (projectData?.project_work_packages) {
  try {
    const parsed = JSON.parse(projectData.project_work_packages);
    if (Array.isArray(parsed.work_packages)) {
      workPackages = parsed.work_packages;
    }
  } catch (e) {
    console.error("Error parsing work packages for display:", e);
  }
}

  if (projectLoading || manpowerLoading) return <h1>Loading</h1>;
  if (projectError || manpowerError) return <h1>Error</h1>;
  return (
    <>
      {page === "list" && (
        <div className="flex-1 space-y-4 min-h-[50vh]">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <ProjectSelect onChange={handleChange} />
            </div>
            {/* Removed "Overall Summary" button */}
            {selectedProject && ( // Only show "Update Milestone" if a project is selected
                <Button 
                    onClick={() => navigate(`${selectedProject}`)} 
                    className="text-xs"
                >
                    Update Milestone
                </Button>
            )}
          </div>
          {selectedProject && (
            <div className="mx-0 px-0 pt-4">
              <Table>
                <TableHeader className="bg-red-100">
                  <TableRow>
                    <TableHead className="w-[40%] text-center font-extrabold">
                      Report
                    </TableHead>
                    <TableHead className="w-[20%] text-center font-extrabold">
                      Date Created
                    </TableHead>
                    <TableHead className="w-[5%] text-center font-extrabold">
                      Options
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {manpowerData?.map((item) => {
                    return (
                      <TableRow key={item.name}>
                        <TableCell className="text-xs text-center">
                          <div className="flex flex-col gap-1 items-center justify-center">
                            {item.report.data.map((r) => {
                              return (
                                <Badge key={r.role}> {/* Added key for list item */}
                                  {r.role}: {r.count}
                                </Badge>
                              );
                            })}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-center">
                          {formatDate(item.creation)}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center gap-2">
                            <Dialog>
                              <DialogTrigger>
                                <Pencil2Icon
                                  onClick={() => setEditReport(item)}
                                  className="max-sm:w-4 max-sm:h-4 w-6 h-6 hover:text-blue-500"
                                />
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>
                                    Edit{" "}
                                    <span className="text-primary">
                                      {item.project_name}
                                    </span>{" "}
                                    {formatDate(item?.creation)}'s Report
                                  </DialogTitle>
                                </DialogHeader>
                                <DialogDescription className="flex flex-col gap-4 w-full">
                                  {manpowerDetails?.map((detailItem, index) => { // Renamed 'item' to 'detailItem' to avoid conflict
                                    const addedItem =
                                      editReport?.report?.data?.find(
                                        (i) => i?.role === detailItem?.role
                                      );
                                    return (
                                      <div
                                        key={index}
                                        className="flex items-center gap-4"
                                      >
                                        <label className="w-40">
                                          {detailItem.role}:
                                        </label>
                                        <input
                                          type="number"
                                          value={addedItem?.count || 0}
                                          onChange={(e) => {
                                            const newValue = parseFloat(
                                              e.target.value
                                            );
                                            setEditReport((prevState) => {
                                              // Handle cases where prevState or prevState.report.data might be null/undefined
                                              const currentReportData = prevState?.report?.data || [];
                                              const existingItemIndex =
                                                currentReportData.findIndex(
                                                  (dataItem) =>
                                                    dataItem.role === detailItem.role
                                                );

                                              if (existingItemIndex !== -1) {
                                                const updatedData = [
                                                  ...currentReportData,
                                                ];
                                                updatedData[existingItemIndex] =
                                                {
                                                  ...updatedData[
                                                  existingItemIndex
                                                  ],
                                                  count: newValue,
                                                };
                                                return {
                                                  ...prevState,
                                                  report: {
                                                    ...prevState?.report,
                                                    data: updatedData,
                                                  },
                                                };
                                              }

                                              return {
                                                ...prevState,
                                                report: {
                                                  ...prevState?.report,
                                                  data: [
                                                    ...currentReportData,
                                                    {
                                                      role: detailItem.role,
                                                      count: newValue,
                                                    },
                                                  ],
                                                },
                                              };
                                            });
                                          }}
                                          className="border border-gray-300 rounded-md px-2 py-1"
                                        />
                                      </div>
                                    );
                                  })}
                                  <Button
                                    onClick={() => handleEditReport()}
                                    disabled={
                                      // Disable if no report is being edited, or if data hasn't changed
                                      !editReport ||
                                      editReport.report?.data?.every(
                                        (i) =>
                                          i?.count ===
                                          manpowerData?.find(
                                            (j) => j?.name === editReport?.name
                                          )?.report?.data?.find(
                                            (k) => k?.role === i?.role
                                          )?.count
                                      )
                                    }
                                  >
                                    {updateLoading ? (
                                      <TailSpin
                                        color={"white"}
                                        width={20}
                                        height={20}
                                      />
                                    ) : (
                                      "Update"
                                    )}
                                  </Button>
                                  <DialogClose
                                    id="updateReportClose"
                                    className="hidden"
                                  >
                                    Close
                                  </DialogClose>
                                </DialogDescription>
                              </DialogContent>
                            </Dialog>
                            <span>|</span>
                            <Copy
                              className="cursor-pointer hover:text-blue-500 max-sm:w-4 max-sm:h-4"
                              onClick={() => handleCopy(item?.name)}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="flex items-center justify-end py-6">
              <Button
                  disabled={manpowerData?.some(
                    (i) => formatDate(i?.creation) === formatDate(new Date())
                  )}
                  onClick={() => toggleSheet()}
                  className="max-sm:text-xs"
                >
                  Create New Manpower Report
                </Button>
                <Sheet open={sheetOpen} onOpenChange={toggleSheet}>
                  <SheetContent>
                  <div className="flex-1 space-y-2 md:space-y-4">
          <div className="flex items-center ">
            <h2 className="pl-2 text-lg md:text-xl font-bold tracking-tight">
              NEW MANPOWER REPORT
            </h2>
          </div>
          {selectedProject && (
            <Card>
              <CardContent>
                <div className="flex flex-col gap-4 py-2 max-md:text-sm">
                  <div className="flex flex-col gap-2">
                    <strong>Work Packages:</strong>
                    <div className="flex gap-1 flex-wrap">
                      {workPackages.length > 0 ? (
      workPackages.map((item:any, idx:number) => (
        <div
          key={idx}
          className="flex items-center justify-center rounded-3xl p-1 bg-[#ECFDF3] text-[#067647] border-[1px] border-[#ABEFC6]"
        >
          {item.work_package_name}
        </div>
      ))
    ) : (
      <span className="text-sm text-gray-500">No work packages specified.</span>
    )}
                    </div>
                  </div>
                  <div>
                    <strong>Date:</strong> {new Date().toLocaleDateString()}
                  </div>
                  {manpowerDetails.map((item, index) => (
                    <div key={index} className="flex items-center gap-4">
                      <label className="w-40">{item.role}:</label>
                      <input
                        type="number"
                        value={item.count}
                        onChange={(e) =>
                          handleInputChange(index, e.target.value)
                        }
                        className="border border-gray-300 w-full rounded-md px-2 py-1"
                      />
                    </div>
                  ))}
                  <Button
                    onClick={handleSave}
                    disabled={createLoading}
                    className="flex items-center justify-center"
                  >
                    {createLoading ? (
                      <TailSpin width={20} height={20} color="white" />
                    ) : (
                      "Save & Copy Message"
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
                  </div>
                  </SheetContent>
                </Sheet>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};