import { Button } from "@/components/ui/button";

import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardDescription, CardTitle } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useFrappeCreateDoc, useFrappeDeleteDoc, useFrappeGetDoc, useFrappeGetDocList, useSWRConfig } from "frappe-react-sdk";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { useState } from "react";
import { DialogClose } from "@radix-ui/react-dialog";
import { ArrowLeft, CirclePlus, Mail, MapPin, Phone, Plus, Trash2 } from "lucide-react";
import { UserProfileSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import { NirmaanUsers as NirmaanUsersType } from "@/types/NirmaanStack/NirmaanUsers";

interface SelectOption {
    label: string;
    value: string;
}

export default function Profile() {
    const [curProj, setCurProj] = useState('')

    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const { toast } = useToast()
    const userData = useUserData()

    const { data, isLoading, error } = useFrappeGetDoc<NirmaanUsersType>(
        'Nirmaan Users',
        `${id}`
    );
    const { data: permission_list, isLoading: permission_list_loading, error: permission_list_error, mutate: permission_list_mutate } = useFrappeGetDocList("User Permission",
        {
            fields: ['name', 'for_value'],
            filters: [["user", "=", id], ["allow", "=", "Projects"]]
        });
    const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
        {
            fields: ["*"]
        });

    const { data: addressData, isLoading: addressDataLoading } = useFrappeGetDocList("Address", {
        fields: ["*"],
        limit: 1000
    },
        "Address"
    )

    const options: SelectOption[] = project_list?.map(item => ({
        label: item.project_name, // Adjust based on your data structure
        value: item.name
    })) || [];

    const getProjectName = (item: string) => {
        const projectName = project_list?.find(proj => proj.name === item)?.project_name
        const address = addressData?.find(add => add.address_title === projectName)
        const formatAddress = `${address?.city}, ${address?.state}`
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
        }).then(() => {
            console.log(id)
            toast({
                title: "Success!",
                description: `Successfully assigned ${getProjectName(curProj).projectName}`,
                variant: "success"
            })
            permission_list_mutate()
        }).catch(() => {
            console.log(submit_error)
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
                console.log(submit_error)
                toast({
                    title: "Failed!",
                    description: `Failed to delete User: ${data?.full_name}`,
                    variant: "destructive"
                })
            })

    }

    const handleDeleteProject = (project: string) => {
        let permission_id = permission_list?.filter((permissions) => permissions.for_value === project)[0]
        console.log("permisison filtered", permission_id)
        if (permission_id) {
            deleteDoc("User Permission", permission_id.name)
                .then((doc) => {
                    console.log(doc)
                    toast({
                        title: "Success!",
                        description: `${project} unlinked for ${id}`,
                        variant: "success"
                    })
                    permission_list_mutate()
                }).catch((doc) => {
                    console.log(submit_error)
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

    if (isLoading || permission_list_loading || project_list_loading || addressDataLoading) return <UserProfileSkeleton />;
    if (error) {
        console.log("Error in user-profile.tsx", error?.message)
        toast({
            title: "Error!",
            description: `Error ${error?.message}`,
            variant: "destructive"
        })
    }
    return (
        <div className="min-h-screen p-12 pt-8 max-md:p-8 max-sm:p-4">
            <div className="mx-auto space-y-6 sm:space-y-8">
                <div className="flex items-center justify-between ">
                    <Button variant="ghost" className="flex items-center gap-2">
                        <ArrowLeft onClick={() => userData?.role === "Nirmaan Admin Profile" ? navigate("/users") : navigate("/")} className="h-6 w-6" />
                        <span className='text-xl font-semibold'>User Details</span>
                    </Button>
                </div>
                <Card>
                    <CardHeader className="flex flex-row items-start justify-between">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
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
                            (data?.role_profile === "Nirmaan Admin Profile" ?

                                <Button disabled={true}><Trash2 className="w-5 h-5 pr-1" />Delete User</Button>
                                :

                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button asChild>
                                            <div className="cursor-pointer"><Trash2 className="w-5 h-5  pr-1 " />Delete User</div>
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Delete user {data?.full_name}</DialogTitle>
                                        </DialogHeader>
                                        <span>This action will delete user from the system</span>
                                        <div className="flex justify-end">
                                            <DialogClose >
                                                <Button onClick={() => handleDeleteUser()}>Delete</Button>
                                                <Button variant="secondary" className="ml-2">Cancel</Button>
                                            </DialogClose>
                                        </div>
                                    </DialogContent>
                                </Dialog>

                            )}
                    </CardHeader>
                    <CardContent className="grid gap-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="flex items-center gap-2">
                                <Mail className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm">{data?.email}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Phone className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm">{data?.mobile_no}</span>
                            </div>
                            <div className="flex items-center gap-2 sm:col-span-2">
                                <MapPin className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm">N/A</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-2xl font-bold">Assigned Projects</h2>
                        {userData.role === "Nirmaan Admin Profile" &&
                            (data?.role_profile === "Nirmaan Admin Profile" ?
                                <Button disabled={true}>
                                    <div className="flex items-center"><CirclePlus className="w-5 h-5 mt- pr-1 " />Assign New Project</div>
                                </Button>
                                :
                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button asChild>
                                            <div className="cursor-pointer"><CirclePlus className="w-5 h-5 mt- pr-1 " />Assign New Project</div>
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Assign New Projects</DialogTitle>
                                            <div className="flex py-2 pt-4">
                                                <span className="px-2 text-base font-medium pt-1">Assign</span>
                                                <Select onValueChange={(item) => setCurProj(item)}>
                                                    <SelectTrigger className="w-[220px]">
                                                        <SelectValue placeholder="Select Project" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {options.map(option => {
                                                            const isPresent = permission_list?.find((item => item.for_value === option.value))
                                                            if (!isPresent) {
                                                                return <SelectItem value={option.value}>{option.label}</SelectItem>
                                                            }
                                                        })}
                                                    </SelectContent>
                                                </Select>
                                                <span className="px-4 text-base font-normal pt-1">to: {`${data?.first_name}`}</span>
                                            </div>
                                        </DialogHeader>
                                        <div className="flex justify-end">
                                            <DialogClose>
                                                <Button onClick={() => handleSubmit()}>Submit</Button>
                                            </DialogClose>
                                        </div>
                                    </DialogContent>
                                </Dialog>
                            )}
                    </div>
                    {userData.role === "Nirmaan Admin Profile" ?
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {permission_list?.map((project, index) => (
                                <Card key={index} className="flex flex-col">
                                    <CardHeader>
                                        <CardTitle className="flex justify-between items-start">
                                            <span className="text-lg">{getProjectName(project.for_value).projectName}</span>
                                            <Button variant="ghost" size="icon" onClick={() => handleDeleteProject(project.for_value)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </CardTitle>
                                        <CardDescription className="text-xs">{project.for_value}</CardDescription>
                                    </CardHeader>
                                    <CardContent className="flex-grow">
                                        <div className="flex items-center gap-2 mb-2">
                                            <MapPin className="h-4 w-4 text-muted-foreground" />
                                            <span className="text-sm">{getProjectName(project.for_value).formatAddress}</span>
                                        </div>
                                        {/* <div className="flex items-start gap-2">
                    <Briefcase className="h-4 w-4 text-muted-foreground mt-1" />
                    <span className="text-sm">{project.workPackages.join(', ')}</span>
                  </div> */}
                                    </CardContent>
                                </Card>
                            ))}
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
                                                <MapPin className="h-4 w-4 text-muted-foreground" />
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
        </div>
    )
}