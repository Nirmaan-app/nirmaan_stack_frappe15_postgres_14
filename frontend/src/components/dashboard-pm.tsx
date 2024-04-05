import { Breadcrumb, BreadcrumbItem, BreadcrumbLink } from "./breadcrumb";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { useFrappeGetDocCount,useFrappeGetDocList,useFrappeGetDoc } from "frappe-react-sdk";
import { HardHat, UserRound, PersonStanding } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { Link } from "react-router-dom";
import { useContext, useState, useEffect } from "react"
import { OrderContextProvider } from "./order-context"

export const ProjectManager = () => {

    const { data: project_count, isLoading: project_count_loading, error: project_count_error } = useFrappeGetDocCount("Projects");
    const { data: category_list, isLoading: category_list_loading, error: category_list_error } = useFrappeGetDocList("Category",
    {
        fields:['category_name']
    });
    const { data: item_list, isLoading: item_list_loading, error: item_list_error } = useFrappeGetDocList("Itemlist",
    {
        fields:['item_name']
    });
    const { data: project_list, isLoading: project_list_loading, error: project_list_error } = useFrappeGetDocList("Projects",
    {
        fields:['project_name']
    });

    console.log(category_list);
    console.log(item_list);

    const [page,setPage] = useState<string>('default')

    const addProject = (projectName: string) => {
        setOrderData(prevData => ({
            ...prevData,
            projects: projectName
        }));
    };
    const addCategory = (categoryName: string) => {
        setOrderData(prevData => ({
            ...prevData,
            category: categoryName
        }));
    };
    const addSubcategory = (subcategoryName: string) => {
        setOrderData(prevData => ({
            ...prevData,
            subcategory: subcategoryName
        }));
    };

    const [orderData,setOrderData] = useState({
        username:'',
        itemslist:[],
        projects: '',
        category: '',
        subcategory: '',
        createdAt: ''
    })
    const handleProjectClick = (project:string , value: string) => {
        addProject(project);
        setPage(value);
        console.log(page);
        console.log(orderData);
    };
    const handleCategoryClick = (category:string , value: string) => {
        addCategory(category);
        setPage(value);
        console.log(page);
        console.log(orderData);
    };
    const handleSubCategoryClick = (subcategory:string , value: string) => {
        addSubcategory(subcategory);
        setPage(value);
        console.log(page);
        console.log(orderData);
    };

    const handleClick = (value: string) => {
        setPage(value);
        console.log(page);
        console.log(orderData);
    };

    interface Project {
        title: string;
        description: string;
    }
      
    const projects: Project[] = Array.from({ length: 10 }, (_, index) => ({
      title: `Project ${index + 1}`,
      description: `Description for Project ${index + 1}`,
    })); 
    const category: Project[] = Array.from({ length: 10 }, (_, index) => ({
        title: `Category ${index + 1}`,
        description: `Description for Category ${index + 1}`,
    }));
    const subcategory: Project[] = Array.from({ length: 10 }, (_, index) => ({
        title: `SubCategory ${index + 1}`,
        description: `Description for Subcategory ${index + 1}`,
    }));  

    return (
        <OrderContextProvider value = {{orderData,addProject,addCategory,addSubcategory}}>
            {page=='default' && <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center justify-between space-y-2">
                    <Breadcrumb>
                        <BreadcrumbItem isCurrentPage>
                            <BreadcrumbLink href="/wp">
                                Dashboard
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                    </Breadcrumb>
                </div>
                <div className="flex items-center justify-between space-y-2">
                    <h2 className="text-3xl font-bold tracking-tight">Modules List</h2>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                    <Card className="hover:animate-shadow-drop-center" onClick={()=>handleClick('projectlist')}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Create order
                                </CardTitle>
                                <HardHat className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">
                                    {(project_count_loading) ? (<TailSpin visible={true} height="30" width="30" color="#9C33FF" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                        : (project_count)}
                                    {project_count_error && <p>Error</p>}
                                </div>
                                <p className="text-xs text-muted-foreground">COUNT</p>
                            </CardContent>
                    </Card>
                    <Card className="hover:animate-shadow-drop-center" >
                        <Link to="/projects">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Add Projects
                                </CardTitle>
                                <HardHat className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">
                                    
                                </div>
                                <p className="text-xs text-muted-foreground">Add new projects</p>
                            </CardContent>
                        </Link>
                    </Card>
                </div>
            </div>}
            {page=='projectlist' && <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center justify-between space-y-2">
                    <Breadcrumb>
                        <BreadcrumbItem isCurrentPage>
                            <BreadcrumbLink href="/wp">
                                Dashboard
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                    </Breadcrumb>
                </div>
                <div className="flex items-center justify-between space-y-2">
                    <h2 className="text-3xl font-bold tracking-tight">Projects List</h2>
                </div>
                <div className="grid gap-4">
                    {project_list.map((project) => (
                        <Card className="hover:animate-shadow-drop-center" onClick={()=>handleProjectClick(project.project_name,'categorylist')}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    {project.project_name}
                                </CardTitle>
                                <HardHat className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">
                                    
                                </div>
                                <p className="text-xs text-muted-foreground">Lorem ipsum dolor sit amet consectetur, adipisicing elit. Nobis, qui?</p>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>}
            {page=='categorylist' && <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center justify-between space-y-2">
                    <Breadcrumb>
                        <BreadcrumbItem isCurrentPage>
                            <BreadcrumbLink href="/wp">
                                Dashboard
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                    </Breadcrumb>
                </div>
                <div className="flex items-center justify-between space-y-2">
                    <h2 className="text-3xl font-bold tracking-tight">Category List</h2>
                </div>
                <div className="grid gap-4">
                    {category_list.map((item) => (
                        <Card className="hover:animate-shadow-drop-center" onClick={()=>handleCategoryClick(item.category_name,'subcategorylist')}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    {item.name}
                                </CardTitle>
                                <HardHat className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">
                                    
                                </div>
                                <p className="text-xs text-muted-foreground">Lorem ipsum dolor sit amet consectetur, adipisicing elit. Nobis, qui?</p>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>}
            {page=='subcategorylist' && <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center justify-between space-y-2">
                    <Breadcrumb>
                        <BreadcrumbItem isCurrentPage>
                            <BreadcrumbLink href="/wp">
                                Dashboard
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                    </Breadcrumb>
                </div>
                <div className="flex items-center justify-between space-y-2">
                    <h2 className="text-3xl font-bold tracking-tight">Items List</h2>
                </div>
                <div className="grid gap-4">
                    {item_list.map((item) => (
                        <Card className="hover:animate-shadow-drop-center" onClick={()=>handleSubCategoryClick(item.item_name,'subcategorylist')}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    {item.item_name}
                                </CardTitle>
                                <HardHat className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">
                                    
                                </div>
                                <p className="text-xs text-muted-foreground">Lorem ipsum dolor sit amet consectetur, adipisicing elit. Nobis, qui?</p>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>}
        </OrderContextProvider>
    )
}