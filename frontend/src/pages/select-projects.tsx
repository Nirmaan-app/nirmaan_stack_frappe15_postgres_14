import { Link } from "react-router-dom"

import {
    Avatar,
    AvatarFallback,
    AvatarImage,
} from "@/components/ui/avatar";
import { NavBar } from "@/components/nav/nav-bar";

interface Project {
    title: string;
    description: string;
}

const projects: Project[] = Array.from({ length: 10 }, (_, index) => ({
    title: `Project ${index + 1}`,
    description: `Description for Project ${index + 1}`,
}));

const SelectProject = () => {

    return (
        <>
            <NavBar />
            <div className="container bg-gray-100 py-1 px-1 md:px-auto md:py-4">
                <nav className="pb-4 flex justify-between items-center">
                    <div className="flex items-center">
                        <h1 className="text-blue-800 text-2xl font-bold">NIRMAAN</h1>
                    </div>
                    <div className="flex items-center">
                        <span className="text-black mr-2">John Doe</span>
                        <Avatar className="w-6 md:w-10 h-6 md:h-10">
                            <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
                            <AvatarFallback>CN</AvatarFallback>
                        </Avatar>
                    </div>
                </nav>
                <div className="border-b border-gray-200 w-15/16 mx-auto mb-2"></div>

                <h2 className="md:text-lg font-semibold mb-2">Select from the following Projects</h2>

                <div className="border-b border-gray-200 w-15/16 mx-auto mb-4"></div>
                {/* <button className="bg-white text-gray-600 text-sm shadow-inner border hover:bg-gray-100 px-4 py-2 rounded-lg mb-4"><Link to="/confirmation3">Pending Orders</Link></button> */}
                <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-4">
                    {projects.map((project, index) => (
                        <Link to="/projects/category">
                            {
                                <div key={index} className="bg-white shadow-md hover:bg-gray-100 rounded-lg overflow-hidden">
                                    <div className="relative w-full h-1/2 md:h-40">
                                        <img
                                            src={image}
                                            alt={project.title}
                                            className="object-cover w-full h-full"
                                        />
                                    </div>
                                    <div className="p-4">
                                        <h2 className="text-sm md:text-md font-semibold">{project.title}</h2>
                                        <p className="mt-2 text-[0.6rem] md:text-xs text-gray-600">Lorem ipsum dolor sit, amet consectetur adipisicing elit.</p>
                                        <p className="text-[0.6rem] md:text-xs mt-2 text-gray-400">created by <span className="text-xs font-medium text-black">John Doe</span></p>
                                    </div>
                                </div>
                            }
                        </Link>
                    ))}
                </div>
            </div>
        </>
    )
}

export default SelectProject;