import { WorkPackages } from "@/types/NirmaanStack/WorkPackages";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import imageUrl from "@/assets/user-icon.jpeg"
//import useProcurementRequest from "@/states/procurement-request-state";
// import { useEffect, useState } from "react";

interface WorkPackageSelectProps {
    // TS-RESOLVE
    handleWPClick: any
}

export default function WorkPackageSelect({ handleWPClick }: WorkPackageSelectProps) {

    const { data: wp_list, isLoading: wp_list_loading, error: wp_list_error } = useFrappeGetDocList<WorkPackages>("Work Packages", {
        fields: ['work_package_name', "work_package_image"],
        orderBy: { field: 'work_package_name', order: 'asc' },
        limit: 1000
    });

    // const orderDataZ = useProcurementRequest(store => store);

    // const [workPackage, setWorkPackage] = useState<string | undefined>();

    // useEffect(() => {
    //     if (workPackage) {
    //         // TS-RESOLVE

    //     }
    // }, [workPackage])

    if (wp_list_loading) return <h1>Loading</h1>;
    if (wp_list_error) return <h1>{wp_list_error.message}</h1>;
    return (
        <>
            {wp_list?.map((item) => (
                <Card key={item.name} className="flex flex-col items-center shadow-none text-center border border-grey-500 hover:animate-shadow-drop-center" onClick={() => { handleWPClick(item.work_package_name, 'categorylist') }}>
                    <CardHeader className="flex flex-col items-center justify-center space-y-0 p-2">
                        <CardTitle className="flex flex-col items-center text-sm font-medium text-center">
                            <img className="h-32 md:h-36 w-32 md:w-36 rounded-lg p-0" src={item.work_package_image === null ? imageUrl : item.work_package_image} alt="Project" />
                            <span>{item.work_package_name}</span>
                        </CardTitle>
                    </CardHeader>
                </Card>
            ))}
            {/* {console.log("ZUSTAND INITIAL:", orderDataZ.project)} */}
        </>
    )
}