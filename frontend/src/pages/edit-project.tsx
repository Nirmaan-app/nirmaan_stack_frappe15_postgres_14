import { Breadcrumb, BreadcrumbItem, BreadcrumbLink } from "@/components/breadcrumb"
import { MainLayout } from "@/components/layout/main-layout"
import { ProjectForm } from "@/components/project-form"
import { Separator } from "@/components/ui/separator"
import { ArrowLeft } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"

export default function EditProject() {
    const navigate = useNavigate();

    return (
        <MainLayout>
            {/* <div className="flex-1 space-y-4 p-8 pt-6">
                <div className="flex items-center justify-between space-y-2">
                    <Breadcrumb>
                        <BreadcrumbItem>
                            <Link to="/" className="md:text-base text-sm">Dashboard</Link>
                        </BreadcrumbItem>
                        <BreadcrumbItem>
                            <Link to="/projects" className="md:text-base text-sm">Projects</Link>
                        </BreadcrumbItem>
                        <BreadcrumbItem isCurrentPage>
                            <Link to="/projects/edit" className="text-gray-400 md:text-base text-sm">
                                Edit Project
                            </Link>
                        </BreadcrumbItem>
                    </Breadcrumb>
                </div> */}
            <div className="p-4">
                <div className="space-y-0.5">
                    <div className="flex">
                        <ArrowLeft className="mt-1" onClick={() => navigate("/projects")} />
                        <h2 className="pl-2 text-2xl font-bold tracking-tight">Add New Project</h2>
                    </div>
                    <p className="pl-8 text-muted-foreground">
                        Fill out this to save a new project
                    </p>
                </div>

                <Separator className="my-6" />
                <div className="space-y-6">
                    <ProjectForm />
                </div>
            </div>


        </MainLayout>
    )
}