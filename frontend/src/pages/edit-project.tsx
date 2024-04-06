import { Breadcrumb, BreadcrumbItem, BreadcrumbLink } from "@/components/breadcrumb"
import { NavBar } from "@/components/nav/nav-bar"
import { ProjectForm } from "@/components/project-form"
import { Separator } from "@/components/ui/separator"

export default function EditProject() {
    return (
        <>
            <NavBar />
            <div className="flex-1 space-y-4 p-8 pt-6">
                <div className="flex items-center justify-between space-y-2">
                    <Breadcrumb>
                        <BreadcrumbItem>
                            <BreadcrumbLink href="/">Dashboard</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbItem>
                            <BreadcrumbLink href="/projects">Projects</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbItem isCurrentPage>
                            <BreadcrumbLink href="/projects/edit">
                                Edit Project
                            </BreadcrumbLink>
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