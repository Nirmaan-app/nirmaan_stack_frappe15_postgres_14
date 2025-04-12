import { Button } from "@/components/ui/button";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { UserProfileSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { useUserSubmitHandlers } from "@/hooks/useUserSubmitHandlers";
import { NirmaanUserPermissions } from "@/types/NirmaanStack/NirmaanUserPermissions";
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers";
import { Projects } from "@/types/NirmaanStack/Projects";
import { formatDate } from "@/utils/FormatDate";
import { Pencil2Icon } from "@radix-ui/react-icons";
import {
  useFrappeGetDoc,
  useFrappeGetDocList
} from "frappe-react-sdk";
import memoize from "lodash/memoize";
import {
  Calendar,
  CirclePlus,
  KeyRound,
  ListChecks,
  Mail,
  MapPin,
  Phone,
  Trash2,
  Undo2
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { TailSpin } from "react-loader-spinner";
import { useParams } from "react-router-dom";
import EditUserForm from "./EditUserForm";

interface SelectOption {
  label: string;
  value: string;
}

export default function Profile() {
  const [curProj, setCurProj] = useState("");

  const { userId: id } = useParams<{ userId: string }>();
  const { toast } = useToast();
  const userData = useUserData();

  const [deleteUserDialog, setDeleteUserDialog] = useState(false);
  const toggleDeleteUserDialog = useCallback(() => {
    setDeleteUserDialog((prevState) => !prevState);
  }, []);

  const [unlinkProjectDialog, setUnlinkProjectDialog] = useState(false);
  const toggleUnlinkProjectDialog = useCallback(() => {
    setUnlinkProjectDialog((prevState) => !prevState);
  }, []);
  const [assignProjectDialog, setAssignProjectDialog] = useState(false);
  const toggleAssignProjectDialog = useCallback(() => {
    setAssignProjectDialog((prevState) => !prevState);
  }, []);


  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const toggleEditSheet = useCallback(() => {
    setEditSheetOpen((prevState) => !prevState);
  }, []);

  const [resetPasswordDialog, setResetPasswordDialog] = useState(false);
  const toggleResetPasswordDialog = useCallback(() => {
    setResetPasswordDialog((prevState) => !prevState);
  }, []);

  const { data, isLoading, error } = useFrappeGetDoc<NirmaanUsersType>("Nirmaan Users",id, id ? `Nirmaan Users ${id}` : null);

  const { data: permission_list, isLoading: permission_list_loading, mutate: permission_list_mutate } = useFrappeGetDocList<NirmaanUserPermissions>("User Permission",
    {
      fields: ["name", "for_value", "creation"],
      filters: [
        ["user", "=", id],
        ["allow", "=", "Projects"],
      ],
      limit: 1000,
      orderBy: { field: "creation", order: "desc" },
    },
    userData.role === "Nirmaan Admin Profile" ? undefined : null
  );

  const {handleSubmit, handleDeleteUser, handleDeleteProject, handlePasswordReset, create_loading, delete_loading} = useUserSubmitHandlers(data, permission_list_mutate);

  const { data: project_list, isLoading: project_list_loading } = useFrappeGetDocList<Projects>("Projects", {
    fields: ["*"],
    limit: 1000,
    orderBy: { field: "creation", order: "desc" },
  }, "Projects");

  const { data: addressData, isLoading: addressDataLoading } = useFrappeGetDocList("Address",
      {
        fields: ["*"],
        limit: 10000,
        orderBy: { field: "creation", order: "desc" },
      },
      "Address"
    );

  const options: SelectOption[] = useMemo(() => {
    const filteredProjects = project_list?.filter(p => !permission_list?.find(pl => pl.for_value === p.name));
    return filteredProjects?.map((item) => ({
      label: item.project_name,
      value: item.name,
    })) || [];
  }, [project_list, permission_list]);

  const getProjectAttributes = useMemo(() => memoize((id: string) => {
    const projectName = project_list?.find((proj) => proj.name === id)?.project_name;

    const address = addressData?.find(
      (add) => add.address_title === projectName
    );
    const formatAddress = `${address?.city || "--"}, ${address?.state || "--"}`;
    return { projectName, formatAddress };
  }, (id: string) => id), [project_list, addressData]);

  if (
    isLoading ||
    permission_list_loading ||
    project_list_loading ||
    addressDataLoading
  ) {
    return <UserProfileSkeleton />;
  }

  if (error) {
    toast({
      title: "Error!",
      description: `Error ${error?.message}`,
      variant: "destructive",
    });
  }
  return (
    <div className="flex-1 space-y-4">
      <div className="flex items-center gap-1">
        <h2 className="text-2xl max-md:text-xl font-semibold pl-2">
          User Details
        </h2>
        <Sheet open={editSheetOpen} onOpenChange={toggleEditSheet}>
          <SheetTrigger>
            <Pencil2Icon className="w-6 h-6 text-blue-600" />
          </SheetTrigger>
          <SheetContent className="overflow-y-auto">
            <EditUserForm toggleEditSheet={toggleEditSheet} />
          </SheetContent>
        </Sheet>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
            <Avatar className="h-20 w-20 text-3xl">
              <AvatarImage src="/placeholder.svg" alt={data?.full_name} />
              <AvatarFallback>
                {data?.full_name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <CardTitle className="text-2xl">{data?.full_name}</CardTitle>
              <CardDescription>{data?.role_profile}</CardDescription>
            </div>
          </div>
          {userData.role === "Nirmaan Admin Profile" && (
            <div className="flex flex-wrap max-sm:flex-col gap-2">
                <Button
                    className="flex gap-1 items-center"
                    onClick={toggleResetPasswordDialog}
                  >
                    <KeyRound className="w-5 h-5" />
                    <span className="max-md:hidden">Reset Password</span>
                </Button>
              <Dialog open={resetPasswordDialog} onOpenChange={toggleResetPasswordDialog}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      Reset password for {data?.full_name}
                    </DialogTitle>
                  </DialogHeader>
                  <DialogDescription>
                    This action will send a reset password email to this user.
                    Are you sure you want to continue?
                  </DialogDescription>
                  <div className="flex justify-end">
                    <DialogClose asChild>
                      <Button
                        variant="secondary"
                        className="flex items-center gap-1"
                      >
                        <Undo2 className="h-4 w-4" />
                        Cancel
                      </Button>
                    </DialogClose>
                      <Button
                        onClick={() => handlePasswordReset(toggleResetPasswordDialog)}
                        className="flex items-center gap-1"
                      >
                            <KeyRound className="w-5 h-5" />
                            <span className="max-md:hidden">Reset</span>
                      </Button>
                  </div>
                </DialogContent>
              </Dialog>


                  <Button disabled={data?.role_profile === "Nirmaan Admin Profile"} className="flex gap-1 items-center" onClick={toggleDeleteUserDialog}>
                      <Trash2 className="w-5 h-5" />
                      <span className="max-md:hidden">Delete User</span>
                  </Button>
                <Dialog open={deleteUserDialog} onOpenChange={toggleDeleteUserDialog}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Delete User: <span className="text-primary">{data?.full_name}</span></DialogTitle>
                    </DialogHeader>
                    <DialogDescription>This action will delete user from the system</DialogDescription>
                    <div className="flex justify-end gap-2 items-end">
                      {delete_loading ? <TailSpin color="red" height={40} width={40} /> : (
                        <>
                        <DialogClose asChild>
                        <Button
                          variant="secondary"
                          className="flex items-center gap-1"
                        >
                          <Undo2 className="h-4 w-4" />
                          Cancel
                        </Button>
                      </DialogClose>
                        <Button
                          onClick={() => handleDeleteUser(toggleDeleteUserDialog)}
                          className="flex items-center gap-1"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </Button>
                        </>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
            </div>
          )}
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground text-red-700" />
              <span className="text-sm">{data?.email}</span>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground text-red-700" />
              <span className="text-sm">{data?.mobile_no}</span>
            </div>
          </div>
        </CardContent>
      </Card>
      <div>
        <div className="flex justify-between items-center mb-2 mt-4">
          <h2 className="text-2xl max-md:text-xl font-semibold pl-2">
            Assigned Projects
          </h2>
          {userData.role === "Nirmaan Admin Profile" &&
            (["Nirmaan Admin Profile", "Nirmaan Estimates Executive Profile"].includes(data?.role_profile) ? (
              <Button disabled={true}>
                <div className="flex items-center">
                  <CirclePlus className="w-5 h-5 mt- pr-1 " />
                  <span className="max-md:hidden">Assign New Project</span>
                </div>
              </Button>
            ) : (
              <>
                  <Button className="flex items-center gap-1" onClick={toggleAssignProjectDialog}>
                      <CirclePlus className="w-5 h-5 " />
                      Assign New Project
                  </Button>
              <Dialog open={assignProjectDialog} onOpenChange={toggleAssignProjectDialog}>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle className="text-xl font-semibold mb-4">
                      Assign New Project:
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
                      <Select value={curProj} onValueChange={(item) => setCurProj(item)}>
                        <SelectTrigger className="col-span-3">
                          <SelectValue placeholder="Select Project" />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((option) => <SelectItem value={option.value}>
                                  {option.label}
                                </SelectItem>
                            )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                      <span className="text-right font-light">To:</span>
                      <span className="col-span-3 font-semibold">
                        {data?.full_name}
                      </span>
                    </div>
                  </div>

                  {create_loading ? <TailSpin color="red" height={40} width={40} /> : (
                    <Button disabled={!curProj} onClick={() => {
                      const selectedOption = options.find(o => o.value === curProj);
                      handleSubmit(curProj, selectedOption?.label || "", toggleAssignProjectDialog);
                    }} className="w-full">
                      <ListChecks className="mr-2 h-4 w-4" />
                      Submit
                    </Button>
                  )}
                </DialogContent>
              </Dialog>
            </>
            ))}
        </div>
        {userData.role === "Nirmaan Admin Profile" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {permission_list?.length === 0 ? (
              <h1> No projects assigned</h1>
            ) : (
              permission_list?.map((project, index) => (
                <Card key={`project-${index}`} className="flex flex-col">
                  <CardHeader>
                    <CardTitle className="flex justify-between items-start">
                      <span className="text-lg">
                        {getProjectAttributes(project.for_value).projectName}
                      </span>
                        <Button variant="ghost" size="icon" onClick={toggleUnlinkProjectDialog}>
                            <Trash2 className="h-4 w-4" />
                        </Button>
                      <Dialog open={unlinkProjectDialog} onOpenChange={toggleUnlinkProjectDialog}>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>
                              Delete access to{" "}
                              {getProjectAttributes(project.for_value).projectName}?
                            </DialogTitle>
                          </DialogHeader>
                          <DialogDescription>
                            This action will delete access for this project to
                            this user. Are you sure you want to continue?
                          </DialogDescription>
                          <div className="flex justify-end items-end gap-2">
                            {delete_loading ? <TailSpin color="red" height={40} width={40} /> : (
                              <>
                              <DialogClose asChild>
                              <Button
                                variant="secondary"
                                className="flex items-center gap-1"
                              >
                                <Undo2 className="h-4 w-4" />
                                Cancel
                              </Button>
                            </DialogClose>
                              <Button
                                onClick={() => {
                                  handleDeleteProject(project.for_value, permission_list, toggleUnlinkProjectDialog)
                                }
                                }
                                className="flex items-center gap-1"
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete
                              </Button>
                              </>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {project.for_value}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-grow">
                    <div className="flex items-center gap-2 mb-2">
                      <MapPin className="h-4 w-4 text-muted-foreground text-red-700" />
                      <span className="text-sm">
                        {getProjectAttributes(project.for_value).formatAddress}
                      </span>
                    </div>
                    {/* <div className="flex items-start gap-2">
                    <Briefcase className="h-4 w-4 text-muted-foreground mt-1" />
                    <span className="text-sm">{project.workPackages.join(', ')}</span>
                  </div> */}
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground text-red-700" />
                      <span className="text-sm">
                        User Added :{" "}
                        <span className="text-red-700">
                          {formatDate(project.creation)}
                        </span>
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {userData.has_project === "true" ? (
              project_list?.map((project, index) => (
                <Card key={index} className="flex flex-col">
                  <CardHeader>
                    <CardTitle className="flex justify-between items-start">
                      <span className="text-lg">{project.project_name}</span>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {project.name}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-grow">
                    <div className="flex items-center gap-2 mb-2">
                      <MapPin className="h-4 w-4 text-muted-foreground text-red-700" />
                      <span className="text-sm">
                        {project.project_city + ", " + project.project_state}
                      </span>
                    </div>
                    {/* <div className="flex items-start gap-2">
                    <Briefcase className="h-4 w-4 text-muted-foreground mt-1" />
                    <span className="text-sm">{project.workPackages.join(', ')}</span>
                            </div> */}
                  </CardContent>
                </Card>
              ))
            ) : (
              <h1>You Are Not Assigned any project</h1>
            )}
          </div>
        )}
      </div>
    </div>
  );
}