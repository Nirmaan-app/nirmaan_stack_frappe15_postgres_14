import { useEffect, useState } from "react";
import ProjectSelect from "./custom-select/project-select";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { useFrappeCreateDoc, useFrappeDeleteDoc, useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { Button } from "./ui/button";
import { toast } from "./ui/use-toast";
import { Link } from "react-router-dom";
import { ArrowLeft, Copy, Trash } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Badge } from "./ui/badge";
import { formatDate } from "@/utils/FormatDate";
import { TailSpin } from "react-loader-spinner";
import { Pencil2Icon } from "@radix-ui/react-icons";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";

export const ManPowerReport = () => {
    const [project, setProject] = useState(null);
    const { data: projectData, isLoading: projectLoading, error: projectError } = useFrappeGetDoc("Projects", project, project ? undefined : null);
    const { createDoc, loading: createLoading } = useFrappeCreateDoc()
    const [editReport, setEditReport] = useState(null)

    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc()

    const { deleteDoc, loading: deleteLoading } = useFrappeDeleteDoc()

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
    const [page, setPage] = useState("list")

    const { data: manpowerData, isLoading: manpowerLoading, error: manpowerError, mutate: manpowerMutate } = useFrappeGetDocList("Manpower Reports", {
        fields: ["*"],
        filters: [['project', '=', project]],
        orderBy: { field: 'creation', order: 'desc' }
    }, project ? undefined : null)

    useEffect(() => {
        if (projectData?.project_work_packages) {
            const selectedWorkPackages = JSON.parse(projectData.project_work_packages).work_packages.map(
                (wp: any) => wp.work_package_name
            );

            const filteredDetails = fullManpowerDetails.filter((item) => {
                if (item.key === "always") {
                    return true; // Always include these roles
                }
                if (item.key === "default") {
                    // Include ELV Team for everything else
                    return !["Electrical Work", "Fire Fighting System", "Data & Networking", "HVAC System"].some((key) =>
                        selectedWorkPackages.includes(key)
                    );
                }
                return selectedWorkPackages.includes(item.key);
            });

            setManpowerDetails(filteredDetails);
        }
    }, [projectData]);

    // console.log("manpowerDetails", manpowerDetails)

    const handleChange = (selectedItem: any) => {
        setProject(selectedItem ? selectedItem.value : null);
        sessionStorage.setItem('selectedProject', JSON.stringify(selectedItem.value));
    };

    const handleInputChange = (index: number, value: string) => {
        const updatedDetails = [...manpowerDetails];
        updatedDetails[index].count = Number(value) || 0;
        setManpowerDetails(updatedDetails);
    };


    const handleCopy = (id) => {

        let filteredDetails;
        if (id) {
            filteredDetails = manpowerData?.find((i) => i?.name === id)?.report?.data
        } else {
            filteredDetails = manpowerDetails.filter(item => item.count > 0);
        }

        const total = filteredDetails.reduce((sum, item) => sum + item.count, 0);
        const message = `
*Manpower Report*

Project - ${projectData?.project_name}
Date - ${new Date().toLocaleDateString()}

${filteredDetails
                .map((item, index) => `${index + 1}. ${item.role} - ${item.count.toString().padStart(2, '0')} Nos.`)
                .join("\n")}

Total - ${total.toString().padStart(2, '0')} Nos.
    `.trim();
        navigator.clipboard.writeText(message);
        if (id) {
            toast({
                title: "Success!",
                description: "Report copied to clipboard!",
                variant: "success"
            })
        }
    }

    const handleSave = async () => {
        try {

            const filteredDetails = manpowerDetails.filter(item => item.count > 0);

            const manpowerJSON = {
                project: projectData?.project_name,
                date: new Date().toLocaleDateString(),
                manpower: filteredDetails.map(item => ({
                    role: item.role,
                    count: item.count
                }))
            };

            handleCopy(undefined)

            await createDoc("Manpower Reports", {
                project: project,
                project_name: projectData.project_name,
                report: { data: manpowerJSON?.manpower }
            })

            await manpowerMutate()

            toast({
                title: "Success!",
                description: "Report saved and copied to clipboard!",
                variant: "success"
            })

        } catch (error) {
            console.log(error)
            toast({
                title: "Failed!",
                description: "Error while saving or copying the report!",
                variant: "destructive"
            })
        } finally {
            setPage('list')
        }
    };

    const handleEditReport = async () => {
        const filteredDetails = editReport?.report?.data?.filter(item => item.count > 0);

        try {
            await updateDoc("Manpower Reports", editReport?.name, {
                report: { data: filteredDetails }
            })

            await manpowerMutate()

            toast({
                title: "Success!",
                description: "Report updated successfully!",
                variant: "success"
            })

            document.getElementById("updateReportClose")?.click()

        } catch (error) {
            console.log("error while updating manpower report", error)
            toast({
                title: "Failed!",
                description: "Error while udpating the report!",
                variant: "destructive"
            })
        }
    }

    const handleDeleteReport = async (id) => {
        try {
            await deleteDoc("Manpower Reports", id)

            await manpowerMutate()

            toast({
                title: "Success!",
                description: "Report deleted successfully!",
                variant: "success"
            })
        } catch (error) {
            console.log("error while deleting report", error)
            toast({
                title: "Failed!",
                description: "Error while deleting the report!",
                variant: "destructive"
            })
        }
    }

    // console.log("editReport", editReport)

    if (projectLoading || manpowerLoading) return <h1>Loading</h1>
    if (projectError || manpowerError) return <h1>Error</h1>
    return (
        <>
            {page === "list" &&
                <div className="flex-1 space-y-2 md:space-y-4">
                    {/* <div className="flex items-center ">
                        <Link to="/prs&milestones"><ArrowLeft className="" /></Link>
                        <h2 className="pl-2 text-xl md:text-2xl font-bold tracking-tight">MANPOWER REPORT</h2>
                    </div> */}
                    {/* <div className="font-bold text-xl">FOR PROJECT:</div> */}
                    <ProjectSelect onChange={handleChange} />
                    {project && (
                        <div className="mx-0 px-0 pt-4">


                            {/* <h2 className="text-lg pl-2 font-semibold tracking-normal py-2">Created By {userData?.full_name}</h2> */}
                            <Table>
                                <TableHeader className="bg-red-100">
                                    <TableRow>
                                        <TableHead className="w-[35%] text-center font-extrabold">Project name</TableHead>
                                        <TableHead className="w-[40%] text-center font-extrabold">Report</TableHead>
                                        <TableHead className="w-[20%] text-center font-extrabold">Date Created</TableHead>
                                        <TableHead className="w-[5%] text-center font-extrabold">Options</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {manpowerData?.map((item) => {
                                        return <TableRow key={item.name}>
                                            <TableCell className="text-xs text-center">{item.project_name}</TableCell>
                                            <TableCell className="text-xs text-center">
                                                <div className="flex flex-col gap-1 items-center justify-center">
                                                    {item.report.data.map((r) => {
                                                        return (<Badge>{r.role}: {r.count}</Badge>)
                                                    })}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs text-center">{formatDate(item.creation)}</TableCell>
                                            <TableCell className="text-xs text-center flex items-center gap-2">
                                                <Dialog>
                                                    <DialogTrigger>
                                                        <Pencil2Icon onClick={() => setEditReport(item)} className="w-6 h-6 hover:text-blue-500" />
                                                    </DialogTrigger>
                                                    <DialogContent>
                                                        <DialogHeader>
                                                            <DialogTitle>
                                                                Edit <span className="text-primary">{item.project_name}</span> {formatDate(item?.creation)}'s Report
                                                            </DialogTitle>
                                                        </DialogHeader>
                                                        <DialogDescription className="flex flex-col gap-4 w-full">
                                                            {manpowerDetails?.map((item, index) => {
                                                                const addedItem = editReport?.report?.data?.find((i) => i?.role === item?.role)
                                                                return (
                                                                    <div key={index} className="flex items-center gap-4">
                                                                        <label className="w-40">{item.role}:</label>
                                                                        <input
                                                                            type="number"
                                                                            value={addedItem?.count || 0}
                                                                            onChange={(e) => {
                                                                                const newValue = parseFloat(e.target.value);
                                                                                setEditReport((prevState) => {
                                                                                    const existingItemIndex = prevState.report.data.findIndex(
                                                                                        (dataItem) => dataItem.role === item.role
                                                                                    );

                                                                                    if (existingItemIndex !== -1) {
                                                                                        const updatedData = [...prevState.report.data];
                                                                                        updatedData[existingItemIndex] = {
                                                                                            ...updatedData[existingItemIndex],
                                                                                            count: newValue,
                                                                                        };
                                                                                        return {
                                                                                            ...prevState,
                                                                                            report: {
                                                                                                ...prevState.report,
                                                                                                data: updatedData,
                                                                                            },
                                                                                        };
                                                                                    }

                                                                                    return {
                                                                                        ...prevState,
                                                                                        report: {
                                                                                            ...prevState.report,
                                                                                            data: [
                                                                                                ...prevState.report.data,
                                                                                                { role: item.role, count: newValue },
                                                                                            ],
                                                                                        },
                                                                                    };
                                                                                });
                                                                            }}
                                                                            className="border border-gray-300 rounded-md px-2 py-1"
                                                                        />
                                                                    </div>
                                                                )
                                                            })}
                                                            <Button onClick={() => handleEditReport()}
                                                                disabled={editReport?.report?.data?.every((i) => i?.count === item?.report?.data?.find((j) => j?.role === i?.role)?.count)}>
                                                                {updateLoading ? <TailSpin color={"white"} width={20} height={20} /> : "Update"}
                                                            </Button>
                                                            <DialogClose id="updateReportClose" className="hidden">Close</DialogClose>
                                                        </DialogDescription>
                                                    </DialogContent>
                                                </Dialog>
                                                <span>|</span>

                                                {/* <Dialog>
                                                <DialogTrigger>
                                                    <Trash className="w-6 h-6 text-primary cursor-pointer" />
                                                </DialogTrigger>
                                                <DialogContent>
                                                <DialogHeader>
                                                    <DialogTitle>
                                                        Are you sure!
                                                    </DialogTitle>
                                                    <DialogDescription>Click on Confirm to proceed!</DialogDescription>
                                                    <DialogDescription className="flex items-center justify-end gap-2">
                                                        <DialogClose>
                                                            <Button variant={"outline"}>Cancel</Button>
                                                        </DialogClose>
                                                        {deleteLoading ? <TailSpin color={"red"} width={20} height={20} /> : 
                                                            <Button onClick={() => handleDeleteReport(item?.name)}>Confirm</Button>
                                                        }
                                                    </DialogDescription>
                                                </DialogHeader>
                                                </DialogContent>
                                            </Dialog> */}
                                                <Copy className="cursor-pointer hover:text-blue-500" onClick={() => handleCopy(item?.name)} />
                                            </TableCell>
                                        </TableRow>
                                    }
                                    )}
                                </TableBody>
                            </Table>
                            <div className="flex items-center justify-end py-6">
                                <Button disabled={manpowerData?.some((i) => formatDate(i?.creation) === formatDate(new Date()))} onClick={() => setPage('create')}>Create New Manpower Report</Button>
                            </div>
                        </div>
                    )}
                </div>
            }
            {page === "create" &&
                <div className="flex-1 space-y-2 md:space-y-4">
                    <div className="flex items-center ">
                        <div onClick={() => setPage('list')} className="cursor-pointer"><ArrowLeft className="" /></div>
                        <h2 className="pl-2 text-xl md:text-2xl font-bold tracking-tight">CREATE NEW MANPOWER REPORT</h2>
                    </div>
                    {project && (
                        <Card>
                            {/* <CardHeader>
                                <CardTitle className="text-primary">Fill this form to best reflect the manpower details:</CardTitle>
                            </CardHeader> */}
                            <CardContent>
                                <div className="flex flex-col gap-4">
                                    <div>
                                        <strong>Project:</strong> {projectData?.project_name}
                                    </div>
                                    <div>
                                        <strong>Work Packages:</strong>
                                        <div className="flex gap-1 flex-wrap">
                                            {JSON.parse(projectData?.project_work_packages).work_packages?.map((item: any) => (
                                                <div className="flex items-center justify-center rounded-3xl p-1 bg-[#ECFDF3] text-[#067647] border-[1px] border-[#ABEFC6]">{item.work_package_name}</div>
                                            ))}
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
                                                className="border border-gray-300 rounded-md px-2 py-1"
                                            />
                                        </div>
                                    ))}
                                    <Button
                                        onClick={handleSave}
                                        disabled={createLoading}
                                        className="flex items-center justify-center"
                                    >
                                        {createLoading ? <TailSpin width={20} height={20} color="white" /> : "Save & Copy Message"}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>
            }
        </>

    );
};
