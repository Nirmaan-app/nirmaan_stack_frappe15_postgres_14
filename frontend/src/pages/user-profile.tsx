import { Button } from "@/components/ui/button";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink } from "@/components/breadcrumb";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

import imageUrl from "@/assets/user-icon.jpeg"
import { useFrappeCreateDoc, useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useState } from "react";
import { DialogClose } from "@radix-ui/react-dialog";
import { ArrowLeft, CirclePlus } from "lucide-react";
import { UserProfileSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";

interface SelectOption {
    label: string;
    value: string;
}

export default function Profile() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const { toast } = useToast()

    const { data, isLoading, error } = useFrappeGetDoc(
        'Nirmaan Users',
        `${id}`
    );
    const { data: permission_list, isLoading: permission_list_loading, error: permission_list_error, mutate: permission_list_mutate } = useFrappeGetDocList("User Permission",
        {
            fields: ['for_value'],
            filters: [["user", "=", id], ["allow", "=", "Projects"]]
        });
    const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
        {
            fields: ['name', 'project_name']
        });

    const options: SelectOption[] = project_list?.map(item => ({
        label: item.project_name, // Adjust based on your data structure
        value: item.name
    })) || [];
    const getProjectName = (item: string) => {
        return project_list?.find(proj => proj.name === item)?.project_name
    }

    const [curProj, setCurProj] = useState('')
    const { createDoc: createDoc, loading: loading, isCompleted: submit_complete, error: submit_error } = useFrappeCreateDoc()
    const handleSubmit = () => {
        createDoc('User Permission', {
            user: id,
            allow: "Projects",
            for_value: curProj
        }).then(() => {
            console.log(id)
            permission_list_mutate()
        }).catch(() => {
            console.log(submit_error)
        })
    }

    if (isLoading) return <UserProfileSkeleton />;
    if (error) {
        console.log("Error in user-profile.tsx", error?.message)
        toast({
            title: "Error!",
            description: `Error ${error?.message}`,
            variant: "destructive"
        })
    }
    return (
        <div className="flex-1 space-y-4 p-8 pt-6">
            <div className="flex items-center justify-between mb-2 space-y-2">
                <div className="flex">
                    <ArrowLeft className="mt-1.5 cursor-pointer" onClick={() => navigate("/users")} />
                    <h2 className="pl-2 text-xl md:text-3xl font-bold tracking-tight">User : {data?.full_name}</h2>
                </div>

                <div className="flex items-center space-x-2">
                    {data.role_profile === "Nirmaan Admin Profile" ?
                        <Button disabled={true}>
                            <div className="flex"><CirclePlus className="w-5 h-5 pr-1 " />Assign new Project</div>
                        </Button>
                        :
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button asChild>
                                    <div><CirclePlus className="w-5 h-5 mt- pr-1 " />Assign new Project</div>
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Assign New Projects</DialogTitle>
                                    {/* <DialogDescription>
                                        Add Projects here.
                                    </DialogDescription> */}
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
                                    <DialogClose >
                                        <Button onClick={() => handleSubmit()}>Submit</Button>
                                    </DialogClose>
                                </div>
                            </DialogContent>
                        </Dialog>
                    }
                </div>

                {/* <Breadcrumb>
                        <BreadcrumbItem>
                            <Link to="/" className="md:text-base text-sm">Dashboard</Link>
                        </BreadcrumbItem>
                        <BreadcrumbItem isCurrentPage>
                            <Link to="/user-profile" className="text-gray-400 md:text-base text-sm">
                                User Profile
                            </Link>
                        </BreadcrumbItem>
                    </Breadcrumb> */}

            </div>
            <div className="grid gap-4 md:grid-cols-5 lg:grid-cols-5">
                <Card className="md:col-span-2 hover:animate-shadow-drop-center" >
                    <CardContent className="p-6">
                        <div className="max-w-md mx-auto bg-white rounded-xl shadow-md overflow-hidden">
                            <div className="flex items-center justify-center mt-6">
                                <img className="h-24 w-30 rounded-full" src={imageUrl} alt="User Avatar" />
                            </div>
                            <div className="text-center px-4 py-6">
                                <h2 className="text-xl font-bold text-gray-800">{`${data?.first_name} ${data?.last_name ? data?.last_name : ""}`}</h2>
                                <p className="text-sm text-gray-600">{`${data?.role_profile}`}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="md:col-span-3 hover:animate-shadow-drop-center" >
                    <CardContent className="p-6">
                        <div className="border-b border-gray-300 mb-4 pb-2">
                            <div className="text-lg font-bold mb-8">User Details</div>
                            <div className="grid grid-cols-2 gap-x-4">
                                <div>
                                    <p className="text-md font-medium text-gray-700">Full Name:</p>
                                </div>
                                <div>
                                    <p className="text-md text-gray-600">{`${data?.first_name} ${data?.last_name ? data?.last_name : ""}`}</p>
                                </div>
                            </div>
                        </div>
                        <div className="border-b border-gray-300 mb-4 pb-2">
                            <div className="grid grid-cols-2 gap-x-4">
                                <div>
                                    <p className="text-md font-medium text-gray-700">Email:</p>
                                </div>
                                <div>
                                    <p className="text-md text-gray-600">{`${data?.email}`}</p>
                                </div>
                            </div>
                        </div>
                        <div className="border-b border-gray-300 mb-4 pb-2">
                            <div className="grid grid-cols-2 gap-x-4">
                                <div>
                                    <p className="text-md font-medium text-gray-700">Role:</p>
                                </div>
                                <div>
                                    <p className="text-md text-gray-600">{`${data?.role_profile}`}</p>
                                </div>
                            </div>
                        </div>
                        <div className="border-b border-gray-300 mb-4 pb-2">
                            <div className="grid grid-cols-2 gap-x-4">
                                <div>
                                    <p className="text-md font-medium text-gray-700">Mobile:</p>
                                </div>
                                <div>
                                    <p className="text-md text-gray-600">{`${data?.mobile_no ? data?.mobile_no : "N/A"}`}</p>
                                </div>
                            </div>
                        </div>
                        <div className="border-b border-gray-300 mb-4 pb-2">
                            <div className="grid grid-cols-2 gap-x-4">
                                <div>
                                    <p className="text-md font-medium text-gray-700">Address:</p>
                                </div>
                                <div>
                                    <p className="text-md text-gray-600">{"N/A"}</p>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="md:col-span-2 hover:animate-shadow-drop-center" >
                    <CardContent className="p-6">
                        <CardTitle className="text-lg font-bold pl-2">
                            Assigned Projects
                        </CardTitle>
                        <table className="min-w-full divide-y divide-gray-200 mt-6">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project ID</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project Name</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {permission_list?.map((item) => {
                                    return <tr>
                                        <td className="px-6 py-4">{item.for_value}</td>
                                        <td className="px-6 py-4">{getProjectName(item.for_value)}</td>
                                    </tr>
                                })}
                            </tbody>
                        </table>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}