import { ProjectEstimates as ProjectEstimatesType } from "@/types/NirmaanStack/ProjectEstimates";
import { Projects as ProjectsType } from "@/types/NirmaanStack/Projects";
import { useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { useParams } from "react-router-dom";
import { Skeleton } from "./ui/skeleton";

const AddProjectEstimates = () => {
    const { projectId } = useParams()
    // ADD keys and use GlobalMutate or pass mutate params (Necessary for individual estimate addition and updating view)
    const { data: project_data, isLoading: project_loading, error: project_error } = useFrappeGetDoc<ProjectsType>("Projects", projectId)
    const { data: estimates_data, isLoading: estimates_loading, error: estimates_error } = useFrappeGetDocList<ProjectEstimatesType>("Project Estimates", {
        fields: ['*'],
        filters: [["project", "=", projectId]],
        limit: 10000
    })
    return (
        <div>
            {(project_loading || estimates_loading) && <Skeleton className="w-[30%] h-10" />}
            {(project_error || estimates_error) && <h1>Error</h1>}
            {(project_data && estimates_data) && <AddProjectEstimatesPage project_data={project_data} estimates_data={estimates_data} />}
        </div>
    )
}

interface AddProjectEstimatesPageProps {
    project_data: ProjectsType | undefined
    estimates_data: ProjectEstimatesType[] | undefined
}

const AddProjectEstimatesPage = ({ project_data, estimates_data }: AddProjectEstimatesPageProps) => {
    return <h1>Hello Projects estimates from {project_data?.project_name}</h1>
}


export const Component = AddProjectEstimates;