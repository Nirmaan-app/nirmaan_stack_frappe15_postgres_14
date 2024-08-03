import { useEffect, useState, useCallback } from "react";
import Select from "react-select";
import { Button } from "../ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { ArrowLeft, Paperclip } from "lucide-react";
import { useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { useNavigate } from "react-router-dom";

interface UpdatedField {
    name: string;
    status: string;
}

export default function NewMilestones() {
    const [editingMilestone, setEditingMilestone] = useState<string | null>(null);
    const [selectedProject, setSelectedProject] = useState<{ label: string; value: string } | null>(null);
    const [updatedFields, setUpdatedFields] = useState<UpdatedField[]>([]);

    const navigate = useNavigate()

    const { data: project_work_milestones_list, isLoading: project_work_milestones_list_loading, error: project_work_milestones_list_error, mutate: project_work_milestones_list_mutate } = useFrappeGetDocList("Project Work Milestones", {
        fields: ['name', 'project', 'work_package', 'scope_of_work', 'milestone', 'start_date', 'end_date', 'status', "status_list"],
        limit: 1000,
        filters: [['project', 'like', `%${selectedProject?.value}`]]
    });

    const { data: project_list, isLoading: project_list_loading, error: project_list_error, mutate: project_list_mutate } = useFrappeGetDocList("Projects", {
        fields: ['name', 'project_name', "project_start_date", "project_end_date"],
    });

    const { updateDoc } = useFrappeUpdateDoc();

    // Handle project selection
    const projectOptions = project_list?.map(project => ({
        label: project.project_name,
        value: project.name
    }));

    useEffect(() => {
        if (editingMilestone) {
            const milestone = project_work_milestones_list?.find((milestone) => milestone.name === editingMilestone);
            if (milestone) {
                setUpdatedFields(milestone.status_list.list || []);
            }
        }
    }, [editingMilestone, project_work_milestones_list]);

    const handleStatusChange = useCallback((name: string, status: string) => {
        setUpdatedFields(prev =>
            prev.map(field => 
                field.name === name ? { ...field, status } : field
            )
        );
    }, []);

    const handleUpdateMilestone = async () => {
        if (!updatedFields.length) return; // No changes to update

        try {
            await updateDoc("Project Work Milestones", editingMilestone, {
                status_list: { list: updatedFields }
            });
            alert("Milestone updated successfully");
        } catch (error) {
            console.error("Error updating milestone", error);
        } finally {
            setEditingMilestone(null); // Reset editing state
        }
    };

    console.log("projectWorkMilestonesList", project_work_milestones_list)

    console.log("updatedFields", updatedFields)

    return (
        <div className="w-full h-auto p-4 flex flex-col space-y-4">
            <div className="flex flex-col space-y-4 mb-6">
                <div className="flex items-center gap-2">
                   <ArrowLeft className="cursor-pointer" onClick={() => navigate("/procurement-request")} />
                   <h1 className="text-lg font-bold">Project Status Details</h1>
                </div>
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
                {project_work_milestones_list?.length ? (
                    project_work_milestones_list.map((milestone) => (
                        <Card className="w-full" key={milestone.name}>
                            <CardHeader className="p-4 flex flex-col gap-2 w-full">
                                <div className="flex justify-between items-center">
                                    <CardDescription>
                                        {milestone.start_date} to {milestone.end_date}
                                    </CardDescription>
                                    {editingMilestone === milestone.name ? (
                                        <button
                                            className="text-blue-500 text-lg underline font-semibold"
                                            onClick={handleUpdateMilestone}
                                        >
                                            Save
                                        </button>
                                    ) : (
                                        
                                        <button
                                            className="text-blue-500 text-lg underline font-semibold"
                                            onClick={() => setEditingMilestone(milestone.name)}
                                        >
                                            Update
                                        </button>
                                    )}
                                </div>

                                <div className={` ${editingMilestone === milestone.name ? "flex-col" : "flex justify-between"} w-full relative`}>
                                    <CardTitle className="text-lg break-words max-w-[40%]">{milestone.milestone}</CardTitle>
                                    <CardTitle className={`transition-all max-w-[40%] duration-300 ${editingMilestone === milestone.name ? 'relative pt-[10px] text-base font-normal break-words' : 'absolute top-0 left-[45%] text-lg break-words'}`}>
                                        {milestone.work_package}
                                    </CardTitle>
                                    <CardTitle className={`text-lg ${editingMilestone === milestone.name ? "opacity-0" : "opacity-100"} break-words`}>
                                        {milestone.status}
                                    </CardTitle>
                                </div>


                                {editingMilestone === milestone.name ? (
                                    <div className="flex flex-col gap-4 transition-opacity duration-500 opacity-100">
                                        {milestone.status_list.list?.map((item) => (
                                            <div key={item.name}>
                                                <CardDescription className="font-semibold text-md text-[#1D2939]">
                                                    {item.name}
                                                </CardDescription>
                                                <div className="flex justify-between mt-2 items-center">
                                                    <div className="flex gap-2 items-center flex-wrap">
                                                    <Button
                                                            onClick={() => handleStatusChange(item.name, "Pending")}
                                                            variant={updatedFields.some(field => field.name === item.name && field.status === "Pending") ? "default" : "outline"}
                                                        >
                                                            Pending
                                                        </Button>
                                                        <Button
                                                            onClick={() => handleStatusChange(item.name, "WIP")}
                                                            variant={updatedFields.some(field => field.name === item.name && field.status ==="WIP" ) ? "default" : "outline"}
                                                        >
                                                            WIP
                                                        </Button>
                                                        <Button
                                                            onClick={() => handleStatusChange(item.name, "Completed")}
                                                            variant={updatedFields.some(field => field.name === item.name && field.status === "Completed") ? "default" : "outline"}
                                                        >
                                                            Completed
                                                        </Button>
                                                        <Button
                                                            onClick={() => handleStatusChange(item.name, "Halted")}
                                                            variant={updatedFields.some(field => field.name === item.name && field.status === "Halted") ? "default" : "outline"}
                                                        >
                                                            Halted
                                                        </Button>
                                                    </div>
                                                    <div className="text-blue-500 cursor-pointer flex gap-2 items-center justify-center border border-blue-500 rounded-md py-1 px-2">
                                                        <Paperclip size="15px" />
                                                        <span>Attach</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-4">
                                        {milestone.status_list.list?.map((item) => (
                                            <div key={item.name} className="flex justify-between items-center">
                                                <CardDescription className="font-semibold text-md text-[#1D2939]">
                                                    {item.name}
                                                </CardDescription>
                                                <CardDescription className="font-semibold text-md text-[#1D2939]">
                                                    {item.status === "Pending" ? "WIP" : item.status}
                                                </CardDescription>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardHeader>
                        </Card>
                    ))
                ) : (
                    <div className="text-center text-gray-500 pt-[100px]">Please select a project</div>
                )}
            </div>
        </div>
    );
}
