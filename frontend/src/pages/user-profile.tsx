import { Button } from "@/components/ui/button";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink } from "@/components/breadcrumb";
import { NavBar } from "@/components/nav/nav-bar";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import imageUrl from "@/assets/user-icon.jpeg"


export default function Profile() {

    return (
        <>
            <NavBar />
            <div className="flex-1 space-y-4 p-8 pt-6">
                <div className="flex items-center justify-between space-y-2">
                    <Breadcrumb>
                        <BreadcrumbItem>
                            <Link to="/" className="md:text-base text-sm">Dashboard</Link>
                        </BreadcrumbItem>
                        <BreadcrumbItem isCurrentPage>
                            <Link to="/user-profile" className="text-gray-400 md:text-base text-sm">
                                User Profile
                            </Link>
                        </BreadcrumbItem>
                    </Breadcrumb>
                </div>
                <div className="grid gap-4 md:grid-cols-5 lg:grid-cols-5">
                    <Card className="md:col-span-2 hover:animate-shadow-drop-center" >
                        <CardContent className="p-6">
                            <div className="max-w-md mx-auto bg-white rounded-xl shadow-md overflow-hidden">
                                <div className="flex items-center justify-center mt-6">
                                    <img className="h-24 w-30 rounded-full" src={imageUrl} alt="User Avatar" />
                                </div>
                                <div className="text-center px-4 py-6">
                                    <h2 className="text-xl font-bold text-gray-800">Ashutosh Chaubey</h2>
                                    <p className="text-sm text-gray-600">Nirmaan Admin</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="md:col-span-3 hover:animate-shadow-drop-center" >
                    <CardContent className="p-6">
                            <div className="border-b border-gray-300 mb-4 pb-2">
                                <CardHeader className="text-lg font-semibold mb-2">User Details</CardHeader>
                                <div className="grid grid-cols-2 gap-x-4">
                                    <div>
                                        <p className="text-md font-medium text-gray-700">Full Name:</p>
                                    </div>
                                    <div>
                                        <p className="text-md text-gray-600">Ashutosh Chaubey</p>
                                    </div>
                                </div>
                            </div>
                            <div className="border-b border-gray-300 mb-4 pb-2">
                                <div className="grid grid-cols-2 gap-x-4">
                                    <div>
                                        <p className="text-md font-medium text-gray-700">Email:</p>
                                    </div>
                                    <div>
                                        <p className="text-md text-gray-600">ashutosh@example.com</p>
                                    </div>
                                </div>
                            </div>
                            <div className="border-b border-gray-300 mb-4 pb-2">
                                <div className="grid grid-cols-2 gap-x-4">
                                    <div>
                                        <p className="text-md font-medium text-gray-700">Role:</p>
                                    </div>
                                    <div>
                                        <p className="text-md text-gray-600">Administrator</p>
                                    </div>
                                </div>
                            </div>
                            <div className="border-b border-gray-300 mb-4 pb-2">
                                <div className="grid grid-cols-2 gap-x-4">
                                    <div>
                                        <p className="text-md font-medium text-gray-700">Mobile:</p>
                                    </div>
                                    <div>
                                        <p className="text-md text-gray-600">9988776554</p>
                                    </div>
                                </div>
                            </div>
                            <div className="border-b border-gray-300 mb-4 pb-2">
                                <div className="grid grid-cols-2 gap-x-4">
                                    <div>
                                        <p className="text-md font-medium text-gray-700">Address:</p>
                                    </div>
                                    <div>
                                        <p className="text-md text-gray-600">Aquamarine Hostel IIT Dhanbad 826004</p>
                                    </div>
                                </div>
                            </div>
                    </CardContent>
                    </Card>
                </div>
            </div>
        </>
    )
}