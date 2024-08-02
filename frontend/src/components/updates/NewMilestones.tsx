import  {  useState } from "react";
import Select from "react-select";
import { Button } from "../ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Paperclip } from "lucide-react";
import { useFrappeGetDocList } from "frappe-react-sdk";

export default function NewMilestones() {
    const [isEditing, setIsEditing] = useState(false);
    const [selectedProject, setSelectedProject] = useState(null);

    // console.log("selected Project", selectedProject?.label)




    const { data: project_work_milestones_list, isLoading: project_work_milestones_list_loading, error: project_work_milestones_list_error, mutate: project_work_milestones_list_mutate } = useFrappeGetDocList("Project Work Milestones", {
        fields: ['name', 'project', 'work_package', 'scope_of_work', 'milestone', 'start_date', 'end_date', 'status', "status_list"],
        limit: 1000,
        filters: [['project', 'like', `%${selectedProject?.value}`]]
    });

    const { data: project_list, isLoading: project_list_loading, error: project_list_error, mutate: project_list_mutate } = useFrappeGetDocList("Projects", {
        fields: ['name', 'project_name', "project_start_date", "project_end_date"],
    });

    console.log("project list", project_list);
    console.log("project_milestones", project_work_milestones_list);

    const handleEditClick = () => setIsEditing(true);
    const handleSaveClick = () => setIsEditing(false);

    const projectOptions = project_list?.map(project => ({
        label: project.project_name,
        value: project.name
    }));


    return (
        <div className="w-full h-auto p-4 flex flex-col space-y-4">
            <div className="flex flex-col space-y-4 mb-6">
                <h1 className="text-lg font-bold">Project Status Details</h1>
                <Select
                    options={projectOptions}
                    value={selectedProject}
                    onChange={setSelectedProject}
                    placeholder="Select a project..."
                />
            </div>

            <div className="flex justify-between w-[95%] items-center border-b mx-auto pb-4">
                <p className="text-gray-500 font-semibold">Milestone</p>
                <p className="text-gray-500 font-semibold">Package</p>
                <p className="text-gray-500 font-semibold">Status</p>
            </div>

            <div className="flex flex-col gap-2 w-full">

                {project_work_milestones_list ? 

                project_work_milestones_list.map((milestone) => (

                    <Card className="w-full">
                    <CardHeader className="p-4 flex flex-col gap-2 w-full">
                        <div className="flex justify-between items-center">
                            <CardDescription>
                                {milestone.start_date} to {milestone.end_date}
                            </CardDescription>
                            {isEditing ? (
                                <button
                                    className="text-blue-500 text-lg underline font-semibold"
                                    onClick={handleSaveClick}
                                >
                                    Save
                                </button>
                            ) : (
                                <button
                                    className="text-blue-500 text-lg underline font-semibold"
                                    onClick={handleEditClick}
                                >
                                    Update
                                </button>
                            )}
                        </div>
                        <div className={` ${isEditing ? "flex-col" : "flex justify-between"}  w-full relative`}>
                            <CardTitle className="text-lg">{milestone.milestone}</CardTitle>
                            <CardTitle className={`transition-all duration-500 ${isEditing ? 'relative pt-[10px] text-base font-normal' : 'absolute top-0 left-[45%] text-lg'}`}>
                                {milestone.work_package}
                            </CardTitle>
                            <CardTitle className={`text-lg ${isEditing ? "opacity-0" : "opacity-100"}`}>
                                {milestone.status}
                            </CardTitle>
                        </div>

                        {isEditing ? (
                            <div className="flex flex-col gap-4 transition-opacity duration-500 opacity-100">
                                {/* Map the areas */}

                                {milestone.status_list.list?.map((item) => (

                                    <div>
                                    <CardDescription className="font-semibold text-md text-[#1D2939]">
                                        {item.name}
                                    </CardDescription>
                                    <div className="flex justify-between mt-2 items-center">
                                        <div className="flex gap-2 items-center">
                                            <Button variant="default">WIP</Button>
                                            <Button variant="outline">Completed</Button>
                                            <Button variant="outline">Halted</Button>
                                        </div>
                                        <div className="text-blue-500 cursor-pointer flex gap-2 items-center justify-center border border-blue-500 rounded-md py-1 px-2">
                                            <Paperclip size="15px" />
                                            <span>Attach</span>
                                        </div>
                                    </div>
                                    </div>

                                ))}
                                

                                {/* Additional area cards */}
                                {/* <div>
                                    <CardDescription className="font-semibold text-md text-[#1D2939]">
                                        Area 1
                                    </CardDescription>
                                    <div className="flex justify-between mt-2 items-center">
                                        <div className="flex gap-2 items-center">
                                            <Button variant="outline">WIP</Button>
                                            <Button variant="outline">Completed</Button>
                                            <Button variant="default">Halted</Button>
                                        </div>
                                        <div className="text-blue-500 cursor-pointer flex gap-2 items-center justify-center border border-blue-500 rounded-md py-1 px-2">
                                            <Paperclip size="15px" />
                                            <span>Attach</span>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <CardDescription className="font-semibold text-md text-[#1D2939]">
                                        Area 2
                                    </CardDescription>
                                    <div className="flex justify-between mt-2 items-center">
                                        <div className="flex gap-2 items-center">
                                            <Button variant="default">WIP</Button>
                                            <Button variant="outline">Completed</Button>
                                            <Button variant="outline">Halted</Button>
                                        </div>
                                        <div className="text-blue-500 cursor-pointer flex gap-2 items-center justify-center border border-blue-500 rounded-md py-1 px-2">
                                            <Paperclip size="15px" />
                                            <span>Attach</span>
                                        </div>
                                    </div>
                                </div> */}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-4">
                                {/* Map all the areas */}

                                {milestone.status_list.list?.map((item) => (
                                <div className="flex justify-between items-center">
                                    <CardDescription className="font-semibold text-md text-[#1D2939]">
                                        {item.name}
                                    </CardDescription>
                                    <CardDescription className="font-semibold text-md text-[#1D2939]">
                                        {item.status === "Pending" && "WIP"}
                                    </CardDescription>
                                </div>

                                ))}
                                
                                {/* <div className="flex justify-between items-center">
                                    <CardDescription className="font-semibold text-md text-[#1D2939]">
                                        Area 1
                                    </CardDescription>
                                    <CardDescription className="font-semibold text-md text-red-500">
                                        Halted
                                    </CardDescription>
                                </div>
                                <div className="flex justify-between items-center">
                                    <CardDescription className="font-semibold text-md text-[#1D2939]">
                                        Area 2
                                    </CardDescription>
                                    <CardDescription className="font-semibold text-md text-green-500">
                                        Completed
                                    </CardDescription>
                                </div> */}
                            </div>
                        )}
                    </CardHeader>
                </Card> 

                )

                    
                    

                ) : (
                    <div className="text-center text-gray-500 pt-[100px]">Plese Select a Project</div>
                )}
                
            </div>
        </div>
    );
}
