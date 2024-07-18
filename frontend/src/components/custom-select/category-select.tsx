import { Category } from "@/types/NirmaanStack/Category";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Card, CardHeader, CardTitle } from "../ui/card";
import imageUrl from "@/assets/user-icon.jpeg"
// import useProcurementRequest from "@/states/procurement-request-state";

interface CategorySelectProps {
    // TS-RESOLVE
    data: any
    handleCategoryClick: any
}

export default function CategorySelect({ data, handleCategoryClick }: CategorySelectProps) {
    const { data: category_list, isLoading: category_list_loading, error: category_list_error } = useFrappeGetDocList<Category>("Category", {
        fields: ['category_name', 'work_package'],
        filters: [['work_package', '=', data.work_package]],
        orderBy: { field: 'category_name', order: 'asc' }
    });

    // const orderDataZ = useProcurementRequest(store => store);

    if (category_list_loading) return <h1>Loading</h1>;
    if (category_list_error) return <h1>{category_list_error.message}</h1>;
    return (
        <>
            {category_list?.map((item) => (
                <Card key={item.name} className="flex flex-col items-center shadow-none border border-grey-500 hover:animate-shadow-drop-center" onClick={() => handleCategoryClick(item.category_name, 'itemlist')}>
                    <CardHeader className="flex flex-col items-center justify-center space-y-0 p-2">
                        <CardTitle className="flex flex-col items-center text-sm font-medium text-center">
                            <img className="h-32 md:h-36 w-32 md:w-36 rounded-lg p-0" src={imageUrl} alt="Project" />
                            <span>{item.category_name}</span>
                        </CardTitle>
                        {/* <HardHat className="h-4 w-4 text-muted-foreground" /> */}
                    </CardHeader>
                </Card>
            ))}
            {/* {console.log("After WP Click ZUSTAND:", { workpackage: orderDataZ.work_package, project: orderDataZ.project })} */}
        </>
    )
}