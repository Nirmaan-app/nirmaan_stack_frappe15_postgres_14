import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ReactSelect from 'react-select';

import { toast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { Customers } from "@/types/NirmaanStack/Customers";
import { ProjectInflows } from "@/types/NirmaanStack/ProjectInflows";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { getTotalInflowAmount } from "@/utils/getAmounts";
import { useFrappeCreateDoc, useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { AlertCircle, CheckCircleIcon, ChevronDownIcon, ChevronRightIcon, CirclePlus, ListChecks, LinkIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { Link, useNavigate } from "react-router-dom";
import { useUsersList } from "../ProcurementRequests/ApproveNewPR/hooks/useUsersList";
import { Projects } from "@/types/NirmaanStack/Projects";
// IMPORT THE NEW COMPONENT AND ITS INTERFACE
import { AddCustomerPODialog, CustomerPODetail } from "./components/AddCustomerPODialog";
import { CustomerPODetailsCard } from "./components/CustomerPODeatilsCard";
import { ProjectDriveLink } from "./components/ProjectDriveLink";
import { SevenDayPlanningTab } from "./SevenDayPlanningTab";


interface ProjectOverviewTabProps {
  projectData: Projects;
  projectCustomer?: Customers;
  estimatesTotal: number
  totalPOAmountWithGST: number
  getAllSRsTotalWithGST: number
  getTotalAmountPaid: {
    poAmount: number;
    srAmount: number;
    totalAmount: number;
  };
}

{/* <OverviewSkeleton2 /> */ }

export const ProjectOverviewTab: React.FC<ProjectOverviewTabProps> = ({ projectData, projectCustomer, getAllSRsTotalWithGST, totalPOAmountWithGST, getTotalAmountPaid }) => {

  const { role } = useUserData();
  const navigate = useNavigate();
  const { createDoc, loading: createDocLoading } = useFrappeCreateDoc();

  const [selectedUser, setSelectedUser] = useState<string | undefined>();
  const [userOptions, setUserOptions] = useState<{ label: JSX.Element; value: string }[]>([]);

  // console.log("projectData.customer_po_details", projectData.customer_po_details);

  const [assignUserDialog, setAssignUserDialog] = useState(false);
  const toggleAssignUserDialog = useCallback(() => {
    setAssignUserDialog((prevState) => !prevState);
  }, [assignUserDialog]);

  // Accordion state
  const [expandedRoles, setExpandedRoles] = useState<{ [key: string]: boolean }>({});

  const { data: projectInflows, isLoading: projectInflowsLoading } = useFrappeGetDocList<ProjectInflows>("Project Inflows", {
    fields: ["amount", "name"],
    filters: [['project', '=', projectData?.name]],
    limit: 0
  })

  const totalAmountReceived = getTotalInflowAmount(projectInflows || [])

  const { data: projectType, isLoading: projectTypeLoading } = useFrappeGetDoc("Project Types", projectData?.project_type, projectData?.project_type ? undefined : null)

  const { data: projectAssignees, isLoading: projectAssigneesLoading, mutate: projectAssigneesMutate } = useFrappeGetDocList("Nirmaan User Permissions",
    {
      fields: ["user"],
      limit: 0,
      filters: [
        ["for_value", "=", `${projectData?.name}`],
        ["allow", "=", "Projects"],
      ],
    },
    projectData?.name ? `User Permission, filters(for_value),=,${projectData?.name}` : null
  );

  const { data: usersList, isLoading: usersListLoading, mutate: usersListMutate, } = useUsersList()

  // Grouping functionality
  const groupedAssignees: { [key: string]: string[] } = useMemo(() => {
    if (!projectAssignees || !usersList) return {};

    const filteredAssignees = projectAssignees.filter((assignee) =>
      usersList.some((user) => user.name === assignee.user)
    );

    return filteredAssignees.reduce((acc, assignee) => {
      const user = usersList.find((user) => user.name === assignee.user);
      if (user) {
        const { role_profile, full_name } = user;

        const formattedRoleProfile = role_profile?.replace(/Nirmaan\s|\sProfile/g, "") || "";

        if (!acc[formattedRoleProfile]) acc[formattedRoleProfile] = [];
        acc[formattedRoleProfile].push(full_name);
      }

      return acc;
    }, {});
  }, [projectAssignees, usersList]);

  const getUserFullName = (id: string | undefined) => {
    return useMemo(() => {
      if (id === "Administrator") return id;
      return usersList?.find((user) => user?.name === id)?.full_name || "";
    }, [id, usersList]);
  }

  useEffect(() => {
    setExpandedRoles(Object.keys(groupedAssignees).reduce(
      (acc: Record<string, boolean>, roleProfile) => {
        acc[roleProfile] = true;
        return acc;
      },
      {}));
  }, [groupedAssignees]);

  // useEffect(() => {
  //   if (usersList && projectAssignees) {
  //     const options =
  //       usersList
  //         ?.filter(
  //           (user) =>
  //             !projectAssignees?.some((i) => i?.user === user?.name) &&
  //             !["Nirmaan Admin Profile", "Nirmaan Estimates Executive Profile"].includes(user?.role_profile) &&
  //             user?.full_name !== "Administrator"
  //         )
  //         ?.map((op) => ({
  //           label: (
  //             <div>
  //               {op?.full_name}
  //               <span className="text-red-700 font-light">
  //                 ({op?.role_profile?.split(" ").slice(1, 3).join(" ")})
  //               </span>
  //             </div>
  //           ),
  //           value: op?.name,
  //         })) || [];
  //     setUserOptions(options);
  //   }
  // }, [usersList, projectAssignees]);

  useEffect(() => {
    if (usersList && projectAssignees) {
      const options =
        usersList
          ?.filter(
            (user) =>
              !projectAssignees?.some((i) => i?.user === user?.name) &&
              !["Nirmaan Admin Profile", "Nirmaan Estimates Executive Profile"].includes(user?.role_profile) &&
              user?.full_name !== "Administrator"
          )
          ?.map((op) => ({
            // This is the structure react-select expects.
            // We'll keep the JSX here and use `formatOptionLabel` for rendering.
            label: (
              <div key={op.name}> {/* Add a key to the root of the JSX label */}
                {op?.full_name}
                <span className="text-red-700 font-light">
                  ({op?.role_profile?.split(" ").slice(1, 3).join(" ")})
                </span>
              </div>
            ),
            value: op?.name,
            // You can also add a string version for searching if formatOptionLabel is complex
            searchableLabel: `${op?.full_name} (${op?.role_profile?.split(" ").slice(1, 3).join(" ")})`
          })) || [];
      setUserOptions(options);
    }
  }, [usersList, projectAssignees]);

  const toggleExpand = useCallback((roleProfile: string) => {
    setExpandedRoles((prev) => ({ ...prev, [roleProfile]: !prev[roleProfile] }));
  }, [expandedRoles, setExpandedRoles]);

  const handleAssignUserSubmit = async () => {
    try {
      await createDoc("User Permission", {
        user: selectedUser,
        allow: "Projects",
        for_value: projectData?.name,
      });
      await projectAssigneesMutate();
      await usersListMutate();
      toggleAssignUserDialog();
      toast({
        title: "Success!",
        description: `Successfully assigned ${getUserFullName(selectedUser)}.`,
        variant: "success",
      });
    } catch (error) {
      console.log("error", error);
      toast({
        title: "Failed!",
        description: `Failed to assign ${getUserFullName(selectedUser)}.`,
        variant: "destructive",
      });
    } finally {
      setSelectedUser(undefined);
    }
  };

  // --- You can compute this within your component or use a useMemo hook for performance ---
  const uniqueProcurementPackageDisplayNames = useMemo(() => {
    if (!projectData?.project_wp_category_makes) {
      return [];
    }

    // Create a map of Procurement Package DocName -> Display Name
    const wpNameMap = new Map<string, string>();

    const uniqueWPDocNames = new Set<string>();
    projectData.project_wp_category_makes.forEach(item => {
      if (item.procurement_package) {
        uniqueWPDocNames.add(item.procurement_package);
      }
    });

    return Array.from(uniqueWPDocNames)
      .map(docName => wpNameMap.get(docName) || docName) // Get display name, fallback to DocName
      .sort((a, b) => a.localeCompare(b)); // Optional: sort them alphabetically

  }, [projectData]);

  if (usersListLoading || projectAssigneesLoading || projectTypeLoading || projectInflowsLoading) {
    return <div className="flex items-center h-[40vh] w-full justify-center">
      <TailSpin color={"red"} />{" "}
    </div>
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Warning alert when customer is not selected */}
      {!projectData?.customer && (
        <Alert variant="warning" className="bg-amber-50 border-amber-200">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-700">
            No customer is assigned to this project. Project Invoice and Inflow Upload will not work until a customer is selected.
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex justify-between items-center">
              <p className="text-2xl">Project Details</p>
              {role !== "Nirmaan Accountant Profile" && (
                <Button onClick={() => navigate("add-estimates")}>
                  <CirclePlus className="h-4 w-4 mr-2" /> Add Project
                  Estimates
                </Button>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3  max-md:grid-cols-2 gap-10 w-full">
          <CardDescription className="space-y-2">
            <span>Start Date</span>
            <p className="font-bold text-black">
              {formatDate(projectData?.project_start_date)}
            </p>
          </CardDescription>

          <CardDescription className="space-y-2 max-md:text-end text-center">
            <span>End Date</span>
            <p className="font-bold text-black">
              {formatDate(projectData?.project_end_date)}
            </p>
          </CardDescription>

          <CardDescription className="space-y-2 md:text-end">
            <span>Estimated Completion Date</span>
            <p className="font-bold text-black">
              {formatDate(projectData?.project_end_date)}
            </p>
          </CardDescription>

          <CardDescription className="space-y-2 max-md:text-end">
            <span>Customer</span>
            <p className="font-bold text-black">
              {projectCustomer?.company_name ? (
                <Link className="text-blue-500 underline" to={`/customers/${projectCustomer?.name}`}>{projectCustomer?.company_name}</Link>
              ) : "--"}

            </p>
          </CardDescription>
          <CardDescription className="space-y-2 text-center">
            <span>Project Value (incl. GST)</span>
            <p className="font-bold text-black">{formatToRoundedIndianRupee(projectData?.project_value_gst)}</p>
          </CardDescription>

          <CardDescription className="space-y-2 text-end">
            <span>Project Type</span>
            <p className="font-bold text-black">
              {projectData?.project_type ? (
                `${projectData?.project_type} - ${projectType?.standard_project_duration} days`
              ) : "--"}
            </p>
          </CardDescription>

          <CardDescription className="space-y-2">
            <span>Carpet Area</span>
            <p className="font-bold text-black">{projectData?.carpet_area || 0} SQFT</p>
          </CardDescription>

          <CardDescription className="space-y-2 text-end md:text-center">
            <span>Project Value (excl. GST)</span>
            <p className="font-bold text-black">{formatToRoundedIndianRupee(projectData?.project_value)}</p>
          </CardDescription>

          <CardDescription className="space-y-2 text-end">
            <span>Location</span>
            <p className="font-bold text-black">
              {projectData?.project_city}, {projectData?.project_state}
            </p>
          </CardDescription>



          {/* <CardDescription className="space-y-2 max-md:text-end">
            <span>Total Amount Received</span>
            <p className="font-bold text-black">{formatToRoundedIndianRupee(totalAmountReceived)}</p>
          </CardDescription> */}

          {/* <CardDescription className="space-y-2 md:text-center">
            <span>Total Amount Paid</span>
            <p className="font-bold text-black">{formatToRoundedIndianRupee(getTotalAmountPaid.totalAmount)}</p>
          </CardDescription> */}
          {/* 
          <CardDescription className="space-y-2 text-end">
            <span>Total Amount Due</span>
            <p className="font-bold text-black">{formatToRoundedIndianRupee((totalPOAmountWithGST + getAllSRsTotalWithGST) - getTotalAmountPaid.totalAmount)}</p>
          </CardDescription> */}

          <div className="col-span-3 max-md:col-span-2 flex justify-between">
            <CardDescription className="space-y-2">
              <span>Work Package</span>
              <div className="flex gap-1 flex-wrap">
                {uniqueProcurementPackageDisplayNames.length > 0 ? (
                  uniqueProcurementPackageDisplayNames.map((displayName, index) => (
                    <div
                      key={`${displayName}-${index}`} // Using index if displayNames could somehow not be unique, otherwise displayName is fine
                      className="flex items-center justify-center rounded-3xl p-1 px-3 text-xs bg-[#ECFDF3] text-[#067647] border-[1px] border-[#ABEFC6]"
                    >
                      {displayName}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500">No work packages assigned.</p> // Or some other placeholder
                )}
              </div>
            </CardDescription>

            {/* <CardDescription className="space-y-2">
              <span>No. of sections in layout</span>
              <p className="font-bold text-black text-end">
                {projectData?.subdivisions || 1}
              </p>
            </CardDescription> */}
            <CardDescription className="space-y-2 md:text-end">
              <span>Nirmaan GST(s) for billing</span>
              <ul className="list-disc list-inside space-y-1">
                {(typeof projectData?.project_gst_number === "string" ? JSON.parse(projectData?.project_gst_number) : projectData?.project_gst_number)?.list?.map((item) => (
                  <li key={item?.location}>
                    <span className="font-bold">{item?.location}</span>
                  </li>
                ))}
              </ul>
            </CardDescription>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Assignees
            {["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile", "Nirmaan Project Lead Profile"].includes(role) && (
              <Dialog open={assignUserDialog} onOpenChange={toggleAssignUserDialog}>
                <DialogTrigger asChild>
                  <Button asChild>
                    <div className="cursor-pointer">
                      <CirclePlus className="w-5 h-5 mt- pr-1 " />
                      Assign User
                    </div>
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle className="text-xl font-semibold mb-4">
                      Assign User:
                    </DialogTitle>
                  </DialogHeader>
                  <div className="grid gap-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                      <label
                        htmlFor="project"
                        className="text-right font-light"
                      >
                        Assign:
                      </label>
                      {/* <Select
                        defaultValue={
                          selectedUser ? selectedUser : undefined
                        }
                        onValueChange={(item) => setSelectedUser(item)}
                      >
                        <SelectTrigger className="col-span-3">
                          <SelectValue placeholder="Select User" />
                        </SelectTrigger>
                        <SelectContent>
                          {userOptions.length > 0
                            ? userOptions?.map((option) => (
                              <SelectItem value={option?.value}>
                                {option?.label}
                              </SelectItem>
                            ))
                            : "No more users available for assigning!"}
                        </SelectContent>x
                      </Select> */}
                      <div className="col-span-3"> {/* Wrap ReactSelect to fit grid */}
                        <ReactSelect
                          options={userOptions}
                          // Value needs to be the full option object for react-select
                          value={userOptions.find(option => option.value === selectedUser) || null}
                          onChange={val => setSelectedUser(val ? val.value as string : undefined)}
                          menuPosition="auto"
                          isClearable={true} // Allows clearing the selection
                          placeholder="Select User"
                          // If you want to render the JSX label
                          formatOptionLabel={(option) => option.label}
                          // If you added a searchableLabel to your options, you can use getOptionLabel for search
                          getOptionLabel={(option) => (option as any).searchableLabel || option.value}
                        // classNamePrefix="react-select" 
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                      <span className="text-right font-light">To:</span>
                      <span className="col-span-3 font-semibold">
                        {projectData?.project_name}
                      </span>
                    </div>
                  </div>
                  <Button
                    disabled={!selectedUser}
                    onClick={handleAssignUserSubmit}
                    className="w-full"
                  >
                    <ListChecks className="mr-2 h-4 w-4" />
                    {createDocLoading ? "Submitting..." : "Submit"}
                  </Button>
                </DialogContent>
              </Dialog>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CardDescription className="space-y-2">
            {Object.entries(groupedAssignees).length === 0 ? (
              <p>No one is assigned to this project</p>
            ) : (
              <ul className="flex gap-2 flex-wrap">
                {Object.entries(groupedAssignees).map(
                  ([roleProfile, assigneeList], index) => (
                    <li
                      key={index}
                      className="border p-1 bg-white rounded-lg max-sm:w-full"
                    >
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
                          <span className="text-md font-medium text-gray-800">
                            {roleProfile}
                          </span>
                        </div>
                        <span className="text-sm text-gray-500">
                          {assigneeList.length} users
                        </span>
                      </div>
                      {expandedRoles[roleProfile] && (
                        <ul className="pl-8 mt-2 space-y-2">
                          {assigneeList.map((fullName, index) => (
                            <li
                              key={index}
                              className="flex items-center gap-2 p-2 bg-gray-50 hover:bg-gray-100 rounded-md transition-all duration-200"
                            >
                              <CheckCircleIcon className="w-5 h-5 text-green-500" />
                              <span className="text-sm font-medium text-gray-600">
                                {fullName}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                )}
              </ul>
            )}
          </CardDescription>
        </CardContent>
      </Card>
      <Card>
        <CustomerPODetailsCard projectId={projectData.name} />
      </Card>
      <Card>
        <ProjectDriveLink projectId={projectData.name} role={role} />
      </Card>
      <SevenDayPlanningTab isOverview={true} projectName={projectData?.project_name}/>
    </div>
  )
}


export default ProjectOverviewTab;