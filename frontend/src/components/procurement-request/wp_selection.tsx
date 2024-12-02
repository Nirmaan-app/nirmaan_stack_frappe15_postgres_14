import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { useNavigate, useParams } from "react-router-dom";
import { Card, CardHeader, CardTitle } from "../ui/card";
import imageUrl from "@/assets/user-icon.jpeg"

export const WPSelection = () => {

    const {projectId} = useParams()

    console.log("Id", projectId)

    const navigate = useNavigate()

    const { data: wp_list, isLoading: wp_list_loading, error: wp_list_error } = useFrappeGetDocList("Procurement Packages",
        {
            fields: ['work_package_name', "work_package_image"],
            orderBy: { field: 'work_package_name', order: 'asc' },
            limit: 100
        }
    );

    const { data: project, isLoading: project_loading, error: project_error } = useFrappeGetDoc("Projects", projectId);

    return (
            <div className="flex-1 md:space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {wp_list?.filter((item) => {
                        let wp_arr = JSON.parse(project?.project_work_packages || "[]")?.work_packages?.map((item) => item.work_package_name)
                        if (item.work_package_name === "Tool & Equipments" || wp_arr.includes(item.work_package_name)) return true
                    }).map((item) => (
                        <Card className="flex flex-col items-center shadow-none text-center border border-grey-500 hover:animate-shadow-drop-center" onClick={() => navigate(`${item?.work_package_name}`)}>
                            <CardHeader className="flex flex-col items-center justify-center space-y-0 p-2">
                                <CardTitle className="flex flex-col items-center text-sm font-medium text-center">
                                    <img className="h-32 md:h-36 w-32 md:w-36 rounded-lg p-0" src={item.work_package_image === null ? imageUrl : item.work_package_image} alt="Project" />
                                    <span>{item.work_package_name}</span>
                                </CardTitle>
                            </CardHeader>
                        </Card>
                    ))}
                </div>
            </div>
    )
}