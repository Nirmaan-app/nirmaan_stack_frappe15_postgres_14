import { Breadcrumb, BreadcrumbItem, BreadcrumbLink } from "@/components/breadcrumb"
import { NavBar } from "@/components/nav/nav-bar"
import { ProjectForm } from "@/components/project-form"
import { Separator } from "@/components/ui/separator"
import { Link } from "react-router-dom"

export default function EditProject() {
    return (
        <>
            <NavBar />
            <div className="flex-1 space-y-4 p-8 pt-6">
                <div className="flex items-center justify-between space-y-2">
                    <Breadcrumb>
                        <BreadcrumbItem>
                            <Link to="/">Dashboard</Link>
                        </BreadcrumbItem>
                        <BreadcrumbItem>
                            <Link to="/projects">Projects</Link>
                        </BreadcrumbItem>
                        <BreadcrumbItem isCurrentPage>
                            <Link to="/projects/edit">
                                Edit Project
                            </Link>
                        </BreadcrumbItem>
                    </Breadcrumb>
                </div>
                <div className="space-y-0.5">
                    <h2 className="text-2xl font-bold tracking-tight">Add Project</h2>
                    <p className="text-muted-foreground">
                        Fill out this to save a new project
                    </p>
                </div>
                <Separator className="my-6" />
                <div className="space-y-6">
                    <ProjectForm />
                </div>
            </div>



        </>
    )
}