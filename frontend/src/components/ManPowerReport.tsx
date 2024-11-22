import { useEffect, useState } from "react";
import ProjectSelect from "./custom-select/project-select";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { useFrappeCreateDoc, useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { Button } from "./ui/button";
import { toast } from "./ui/use-toast";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Badge } from "./ui/badge";
import { formatDate } from "@/utils/FormatDate";

export const ManPowerReport = () => {
    const [project, setProject] = useState(null);
    const { data: projectData, isLoading: projectLoading, error: projectError } = useFrappeGetDoc("Projects", project, project ? undefined : null);
    const { createDoc } = useFrappeCreateDoc()

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
        manpowerMutate()
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

    const handleChange = (selectedItem: any) => {
        setProject(selectedItem ? selectedItem.value : null);
        sessionStorage.setItem('selectedProject', JSON.stringify(selectedItem.value));
    };

    const handleInputChange = (index: number, value: string) => {
        const updatedDetails = [...manpowerDetails];
        updatedDetails[index].count = Number(value) || 0;
        setManpowerDetails(updatedDetails);
    };

    const handleCopy = async () => {
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

            console.log("Manpower Details JSON:", manpowerJSON);

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

            await createDoc("Manpower Reports", {
                project: project,
                project_name: projectData.project_name,
                report: { data: manpowerJSON?.manpower }
            })

            toast({
                title: "Success!",
                description: "Message saved and copied to clipboard!",
                variant: "success"
            })

        } catch (error) {
            console.log(error)
        } finally {
            setPage('list')
        }
    };
    if (projectLoading || manpowerLoading) return <h1>Loading</h1>
    if (projectError || manpowerError) return <h1>Error</h1>
    return (
        <>
            {page === "list" &&
                <div className="flex-1 space-y-2 md:space-y-4">
                    <div className="flex items-center ">
                        <Link to="/prs&milestones"><ArrowLeft className="" /></Link>
                        <h2 className="pl-2 text-xl md:text-2xl font-bold tracking-tight">MANPOWER REPORT</h2>
                    </div>
                    <div className="font-bold text-xl">FOR PROJECT:</div>
                    <ProjectSelect onChange={handleChange} />
                    {project && (
                        <div className="mx-0 px-0 pt-4">


                            {/* <h2 className="text-lg pl-2 font-semibold tracking-normal py-2">Created By {userData?.full_name}</h2> */}
                            <Table>
                                <TableHeader className="bg-red-100">
                                    <TableRow>
                                        <TableHead className="w-[5%] text-center font-extrabold">ID</TableHead>
                                        <TableHead className="w-[35%] text-center font-extrabold">Project name</TableHead>
                                        <TableHead className="w-[35%] text-center font-extrabold">Report</TableHead>
                                        <TableHead className="w-[20%] text-center font-extrabold">Date Created</TableHead>
                                        <TableHead className="w-[5%] text-center font-extrabold">Options</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {manpowerData?.map((item) => {
                                        return <TableRow key={item.name}>
                                            <TableCell className="text-xs text-center">
                                                {/* <Link to={`${item.name}`} className="text-blue-500 underline-offset-1 relative">
                                                {item.workflow_state === "Rejected" && isNew && (
                                                    <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-4 sm:-left-10  animate-pulse" />
                                                )}
                                                <span onClick={() => handleRejectPRSeen(isNew)}>{item.name.slice(-4)}</span>
                                            </Link> */}
                                                {item.name.slice(-4)}
                                            </TableCell>
                                            <TableCell className="text-xs text-center">{item.project_name}</TableCell>
                                            <TableCell className="text-xs text-center">
                                                <div className="flex flex-col gap-1 items-center justify-center">
                                                    {item.report.data.map((r) => {
                                                        return (<Badge>{r.role}: {r.count}</Badge>)
                                                    })}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs text-center">{formatDate(item.creation)}</TableCell>
                                            <TableCell className="text-xs text-center">P/H</TableCell>
                                        </TableRow>
                                    }
                                    )}
                                </TableBody>
                            </Table>
                            <Button onClick={() => setPage('create')}>Create New Manpower Report</Button>
                        </div>

                        //    <Card>
                        //        <CardHeader>
                        //            <CardTitle className="text-primary">Fill this form to best reflect the manpower details:</CardTitle>
                        //        </CardHeader>
                        //        <CardContent>
                        //            <div className="flex flex-col gap-4">
                        //                <div>
                        //                    <strong>Project:</strong> {projectData?.project_name}
                        //                </div>
                        //                <div>
                        //                    <strong>Work Packages:</strong>
                        //                    <div className="flex gap-1 flex-wrap">
                        //                        {JSON.parse(projectData?.project_work_packages).work_packages?.map((item: any) => (
                        //                            <div className="flex items-center justify-center rounded-3xl p-1 bg-[#ECFDF3] text-[#067647] border-[1px] border-[#ABEFC6]">{item.work_package_name}</div>
                        //                        ))}
                        //                    </div>
                        //                </div>
                        //                <div>
                        //                    <strong>Date:</strong> {new Date().toLocaleDateString()}
                        //                </div>
                        //                {manpowerDetails.map((item, index) => (
                        //                    <div key={index} className="flex items-center gap-4">
                        //                        <label className="w-40">{item.role}:</label>
                        //                        <input
                        //                            type="number"
                        //                            value={item.count}
                        //                            onChange={(e) =>
                        //                                handleInputChange(index, e.target.value)
                        //                            }
                        //                            className="border border-gray-300 rounded-md px-2 py-1"
                        //                        />
                        //                    </div>
                        //                ))}
                        //                <Button
                        //                    onClick={handleCopy}
                        //                >
                        //                    Copy Message
                        //                </Button>
                        //            </div>
                        //        </CardContent>
                        //    </Card>
                    )}
                </div>
            }
            {page === "create" &&
                <div className="flex-1 space-y-2 md:space-y-4">
                    <div className="flex items-center ">
                        <div onClick={() => setPage('list')} className="cusror-pointer"><ArrowLeft className="" /></div>
                        <h2 className="pl-2 text-xl md:text-2xl font-bold tracking-tight">CREATE NEW MANPOWER REPORT</h2>
                    </div>
                    {project && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-primary">Fill this form to best reflect the manpower details:</CardTitle>
                            </CardHeader>
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
                                        onClick={handleCopy}
                                    >
                                        Save & Copy Message
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
