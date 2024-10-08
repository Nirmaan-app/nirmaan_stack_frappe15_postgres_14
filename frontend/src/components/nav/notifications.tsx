import { Button } from "../ui/button";
import { BellDot } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger, } from "../ui/dropdown-menu";
import { useFrappeGetDocList, useFrappeUpdateDoc, useFrappeDocTypeEventListener } from "frappe-react-sdk";
import { error } from "console";
import { NotificationType, useNotificationStore } from "@/hooks/useNotificationStore";

export function Notifications() {

    // const { data: notification_list, isLoading: notification_list_loading, error: notification_list_error } = useFrappeGetDocList("Notification Log",
    //     {
    //         fields: ['name', 'subject'],
    //         filters: [["read", "=", 0]],
    //         limit: 5,
    //         orderBy: { field: "creation", order: "desc" }
    //     });
    // const { updateDoc: updateDoc, loading: update_loading, isCompleted: update_submit_complete, error: update_submit_error } = useFrappeUpdateDoc()


    // const handleClick = () => {
    //     console.log("clicked")
    //     // notification_list?.forEach((item)=>{
    //     //     updateDoc('Notification Log', item.name, {
    //     //         read: 1,
    //     //     })
    //     //         .then(() => {
    //     //             console.log(item.name)
    //     //         }).catch(() => {
    //     //             console.log(update_submit_error)
    //     //         })
    //     // })
    // }

    const notification_list: NotificationType[] = useNotificationStore((state) => state.notifications);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger>
                {/* <Button className="bg-white shadow-none border-hidden" onClick={()=>handleClick()}> */}
                <BellDot className="h-6 w-6 " />
                {/* </Button> */}
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                    {notification_list.length > 0 ?
                        <div className="">
                            {notification_list.map((item) => {
                                return <div className="p-2 rounded-lg border border-gray-300 my-1">
                                    <h2>{item.type}</h2>
                                    <h4>{item.message.name}</h4>
                                </div>
                            })}
                        </div>

                        : <h1>NO NEW NOTIFICATIONS</h1>}
                </DropdownMenuLabel>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}