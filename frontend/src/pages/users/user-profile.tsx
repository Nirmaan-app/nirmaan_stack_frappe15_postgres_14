import { Button } from "@/components/ui/button";

import { useParams, useNavigate, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardDescription, CardTitle, CardFooter } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { FrappeConfig, FrappeContext, useFrappeCreateDoc, useFrappeDeleteDoc, useFrappeGetDoc, useFrappeGetDocList, useSWRConfig } from "frappe-react-sdk";
import { Dialog, DialogContent, DialogDescription, DialogClose, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useContext, useState } from "react";
import { ArrowLeft, Calendar, CirclePlus, Edit2, Edit2Icon, Edit3Icon, FolderArchiveIcon, FoldHorizontalIcon, FoldVertical, KeyRound, ListChecks, LucidePencil, LucideSettings, LucideSettings2, Mail, MapPin, PencilIcon, PencilLineIcon, PercentCircleIcon, Phone, Plus, Settings, Settings2, Settings2Icon, SettingsIcon, Trash2, Undo2 } from "lucide-react";
import { UserProfileSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers";
import { Pencil1Icon, Pencil2Icon, ResumeIcon } from "@radix-ui/react-icons";
import { formatDate } from "@/utils/FormatDate";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import EditUserForm from "./EditUserForm";

interface SelectOption {
    label: string;
    value: string;
}

export default function Profile() {

    const [curProj, setCurProj] = useState('')
    const [loadingState, setLoadingState] = useState(false)

    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const { toast } = useToast()
    const userData = useUserData()

    const [editSheetOpen, setEditSheetOpen] = useState(false)

    const toggleEditSheet = () => {
        setEditSheetOpen((prevState) => !prevState);
    };

    const { data, isLoading, error } = useFrappeGetDoc<NirmaanUsersType>(
        'Nirmaan Users',
        `${id}`,
        id ? `Nirmaan Users ${id}` : null
    );
    const { data: permission_list, isLoading: permission_list_loading, error: permission_list_error, mutate: permission_list_mutate } = useFrappeGetDocList("User Permission",
        {
            fields: ['name', 'for_value', 'creation'],
            filters: [["user", "=", id], ["allow", "=", "Projects"]],
            limit: 1000,
            orderBy: { field: "creation", order: "desc" }
        },
        userData.role === "Nirmaan Admin Profile" ? undefined : null
    );
    const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
        {
            fields: ["*"],
            limit: 1000,
            orderBy: { field: "creation", order: "desc" }
        });

    const { data: addressData, isLoading: addressDataLoading } = useFrappeGetDocList("Address", {
        fields: ["*"],
        limit: 1000,
        orderBy: { field: "creation", order: "desc" }
    },
        "Address"
    )

    const { call } = useContext(FrappeContext) as FrappeConfig

    const options: SelectOption[] = project_list?.map(item => ({
        label: item.project_name, // Adjust based on your data structure
        value: item.name
    })) || [];

    const getProjectName = (item: string) => {
        const projectName = project_list?.find(proj => proj.name === item)?.project_name
        const address = addressData?.find(add => add.address_title === projectName)
        const formatAddress = `${address?.city || "--"}, ${address?.state || "--"}`
        return { projectName, formatAddress }
    }

    // const getProjectAddress = (item: string) => {
    //     const address = addressData?.find(add => add.address_title === item)
    //     return `${address.city}, ${address.state}`
    // }

    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const { deleteDoc: deleteDoc, loading: delete_loading, isCompleted: delete_complete, error: delete_error } = useFrappeDeleteDoc()
    const { mutate } = useSWRConfig()

    const handleSubmit = () => {
        createDoc('User Permission', {
            user: id,
            allow: "Projects",
            for_value: curProj
        }).then((doc) => {
            // console.log("after_create", doc.user)
            toast({
                title: "Success!",
                description: `Successfully assigned ${getProjectName(curProj).projectName}`,
                variant: "success"
            })
            permission_list_mutate()
        }).catch(() => {
            // console.log(submit_error)
            toast({
                title: "Failed!",
                description: `Failed to assign ${getProjectName(curProj).projectName}`,
                variant: "destructive"
            })
        })
    }

    const handleDeleteUser = () => {
        deleteDoc('Nirmaan Users', data.email)
            .then(() => {
                mutate("Nirmaan Users")
                toast({
                    title: "Success!",
                    description: `User: ${data?.full_name} deleted Successfully!`,
                    variant: "success"
                })
                navigate("/users")
            }).catch(() => {
                // console.log(submit_error)
                toast({
                    title: "Failed!",
                    description: `Failed to delete User: ${data?.full_name}`,
                    variant: "destructive"
                })
            })

    }

    const handleDeleteProject = (project: string) => {
        let permission_id = permission_list?.filter((permissions) => permissions.for_value === project)[0]
        // console.log("permisison filtered", permission_id)
        if (permission_id) {
            deleteDoc("User Permission", permission_id.name)
                .then((doc) => {
                    // console.log('after_delete', doc)
                    toast({
                        title: "Success!",
                        description: `${project} unlinked for ${id}`,
                        variant: "success"
                    })
                    permission_list_mutate()
                }).catch((doc) => {
                    // console.log(submit_error)
                    toast({
                        title: "Failed!",
                        description: `Failed to unlink ${project} for ${id}`,
                        variant: "destructive"
                    })
                })
        }
        else {
            toast({
                title: "Failed!",
                description: `Failed to delete ${project}`,
                variant: "destructive"
            })
        }
    }

    const handlePasswordReset = () => {
        setLoadingState(true);
        call.post('frappe.core.doctype.user.user.reset_password', {
            user: id
        }).then(() => {
            toast({
                title: "Success!",
                description: "Password Reset Email has been sent to the user",
                variant: "success"
            });
        }).catch(err => {
            toast({
                title: "Error!",
                description: err.exception,
                variant: "destructive"
            });
        }).finally(() => {
            setLoadingState(false);
        })
    }

    // console.log('user', data?.role_profile)

    // console.log("userData.role", userData.role)

    if (isLoading || permission_list_loading || project_list_loading || addressDataLoading) return <UserProfileSkeleton />;
    if (error) {
        // console.log("Error in user-profile.tsx", error?.message)
        toast({
            title: "Error!",
            description: `Error ${error?.message}`,
            variant: "destructive"
        })
    }
    return (
        <div className="flex-1 md:space-y-4 space-y-2">
            <div className="flex items-center gap-1">
                {/* <ArrowLeft onClick={() => userData?.role === "Nirmaan Admin Profile" ? navigate("/users") : navigate("/")} className="h-6 w-6 cursor-pointer" /> */}
                <span className='text-2xl max-md:text-xl font-semibold'>User Details</span>
                <Sheet open={editSheetOpen} onOpenChange={toggleEditSheet}>
                    <SheetTrigger>
                        <Pencil2Icon className="w-6 h-6 text-blue-600" />
                    </SheetTrigger>
                    <SheetContent className="overflow-auto">
                        <EditUserForm toggleEditSheet={toggleEditSheet} />
                    </SheetContent>
                </Sheet>
            </div>
            <Card>
                <CardHeader className="flex flex-row items-start justify-between">
                    <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
                        <Avatar className="h-20 w-20 text-3xl">
                            <AvatarImage src="/placeholder.svg" alt={data?.full_name} />
                            <AvatarFallback>{data?.full_name.split(' ').map(n => n[0]).join('').toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div>
                            <CardTitle className="text-2xl">{data?.full_name}</CardTitle>
                            <CardDescription>{data?.role_profile}</CardDescription>
                        </div>
                    </div>
                    {userData.role === "Nirmaan Admin Profile" &&
                        <div className="flex flex-wrap max-sm:flex-col gap-2">
                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button className="flex gap-1 items-center" disabled={loadingState}>
                                        <KeyRound className="w-5 h-5" />
                                        <span className="max-md:hidden">Reset Password</span>
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Reset password for {data?.full_name}</DialogTitle>
                                    </DialogHeader>
                                    <span>This action will send a reset password email to this user. Are you sure you want to continue?</span>
                                    <div className="flex justify-end">
                                        <DialogClose className="flex items-center gap-2">
                                            <Button variant="secondary" className="flex items-center gap-1">
                                                <Undo2 className="h-4 w-4" />
                                                Cancel</Button>

                                            <Button onClick={() => handlePasswordReset()} className="flex items-center gap-1" disabled={loadingState}>
                                                {loading ?
                                                    <span>Please Wait...</span>
                                                    :
                                                    <>
                                                        <KeyRound className="w-5 h-5" />
                                                        <span className="max-md:hidden">Reset</span>
                                                    </>
                                                }
                                            </Button>
                                        </DialogClose>

                                    </div>
                                </DialogContent>
                            </Dialog>
                            {data?.role_profile === "Nirmaan Admin Profile" ?

                                <Button className="flex gap-1 items-center" disabled={true}><Trash2 className="w-5 h-5" />Delete User</Button>
                                :

                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button className="flex gap-1 items-center">
                                            <Trash2 className="w-5 h-5" />
                                            <span className="max-md:hidden">Delete User</span>
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Delete user {data?.full_name}</DialogTitle>
                                        </DialogHeader>
                                        <span>This action will delete user from the system</span>
                                        <div className="flex justify-end">
                                            <DialogClose className="flex items-center gap-2">
                                                <Button variant="secondary" className="flex items-center gap-1">
                                                    <Undo2 className="h-4 w-4" />
                                                    Cancel</Button>
                                                <Button onClick={() => handleDeleteUser()} className="flex items-center gap-1">
                                                    <Trash2 className="h-4 w-4" />
                                                    Delete</Button>
                                            </DialogClose>
                                        </div>
                                    </DialogContent>
                                </Dialog>

                            }
                        </div>
                    }
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
                    <h2 className="text-2xl max-md:text-xl font-semibold font-bold pl-2">Assigned Projects</h2>
                    {userData.role === "Nirmaan Admin Profile" &&
                        (data?.role_profile === "Nirmaan Admin Profile" ?
                            <Button disabled={true}>
                                <div className="flex items-center">
                                    <CirclePlus className="w-5 h-5 mt- pr-1 " />
                                    <span className="max-md:hidden">Assign New Project</span>
                                </div>
                            </Button>
                            :
                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button asChild>
                                        <div className="cursor-pointer"><CirclePlus className="w-5 h-5 mt- pr-1 " />Assign New Project</div>
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-[425px]">
                                    <DialogHeader>
                                        <DialogTitle className="text-xl font-semibold mb-4">Assign New Project:</DialogTitle>
                                    </DialogHeader>
                                    <div className="grid gap-4">
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <label htmlFor="project" className="text-right font-light">
                                                Assign:
                                            </label>
                                            <Select onValueChange={(item) => setCurProj(item)}>
                                                <SelectTrigger className="col-span-3">
                                                    <SelectValue placeholder="Select Project" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {options.map(option => {
                                                        const isPresent = permission_list?.find((item => item.for_value === option.value))
                                                        if (!isPresent) {
                                                            return (
                                                                <SelectItem value={option.value}>
                                                                    {option.label}
                                                                </SelectItem>
                                                            )
                                                        }
                                                        return null
                                                    })}
                                                </SelectContent>
                                            </Select>

                                        </div>
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <span className="text-right font-light">To:</span>
                                            <span className="col-span-3 font-semibold">{data?.full_name}</span>
                                        </div>
                                    </div>

                                    <DialogClose asChild>
                                        <Button onClick={() => handleSubmit()} className="w-full">
                                            <ListChecks className="mr-2 h-4 w-4" />
                                            Submit</Button>
                                    </DialogClose>
                                </DialogContent>
                            </Dialog>
                        )}
                </div>
                {userData.role === "Nirmaan Admin Profile" ?
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {permission_list?.length === 0 ? <h1> No projects assigned</h1> :
                            (permission_list?.map((project, index) => (
                                <Card key={index} className="flex flex-col">
                                    <CardHeader>
                                        <CardTitle className="flex justify-between items-start">
                                            <span className="text-lg">{getProjectName(project.for_value).projectName}</span>
                                            <Dialog>
                                                <DialogTrigger asChild>
                                                    <Button variant="ghost" size="icon">
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </DialogTrigger>
                                                <DialogContent>
                                                    <DialogHeader>
                                                        <DialogTitle>Delete access to {getProjectName(project.for_value).projectName}?</DialogTitle>
                                                    </DialogHeader>
                                                    <span>This action will delete access for this project to this user. Are you sure you want to continue?</span>
                                                    <div className="flex justify-end">
                                                        <DialogClose className="flex items-center gap-2">
                                                            <Button variant="secondary" className="flex items-center gap-1">
                                                                <Undo2 className="h-4 w-4" />
                                                                Cancel</Button>
                                                            <Button onClick={() => handleDeleteProject(project.for_value)} className="flex items-center gap-1">
                                                                <Trash2 className="h-4 w-4" />
                                                                Delete</Button>
                                                        </DialogClose>
                                                    </div>
                                                </DialogContent>
                                            </Dialog>
                                        </CardTitle>
                                        <CardDescription className="text-xs">{project.for_value}</CardDescription>
                                    </CardHeader>
                                    <CardContent className="flex-grow">
                                        <div className="flex items-center gap-2 mb-2">
                                            <MapPin className="h-4 w-4 text-muted-foreground text-red-700" />
                                            <span className="text-sm">{getProjectName(project.for_value).formatAddress}</span>
                                        </div>
                                        {/* <div className="flex items-start gap-2">
                    <Briefcase className="h-4 w-4 text-muted-foreground mt-1" />
                    <span className="text-sm">{project.workPackages.join(', ')}</span>
                  </div> */}
                                        <div className="flex items-center gap-2">
                                            <Calendar className="h-4 w-4 text-muted-foreground text-red-700" />
                                            <span className="text-sm">User Added : <span className="text-red-700">{formatDate(project.creation)}</span></span>
                                        </div>
                                    </CardContent>
                                </Card>
                            )))}
                    </div>
                    :
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {userData.has_project === "true" ?
                            (project_list?.map((project, index) => (
                                <Card key={index} className="flex flex-col">
                                    <CardHeader>
                                        <CardTitle className="flex justify-between items-start">
                                            <span className="text-lg">{project.project_name}</span>
                                        </CardTitle>
                                        <CardDescription className="text-xs">{project.name}</CardDescription>
                                    </CardHeader>
                                    <CardContent className="flex-grow">
                                        <div className="flex items-center gap-2 mb-2">
                                            <MapPin className="h-4 w-4 text-muted-foreground text-red-700" />
                                            <span className="text-sm">{project.project_city + ", " + project.project_state}</span>
                                        </div>
                                        {/* <div className="flex items-start gap-2">
                    <Briefcase className="h-4 w-4 text-muted-foreground mt-1" />
                    <span className="text-sm">{project.workPackages.join(', ')}</span>
                            </div> */}
                                    </CardContent>
                                </Card>
                            )))
                            :
                            <h1>You Are Not Assigned any project</h1>
                        }

                    </div>
                }

            </div>
        </div>
    )
}