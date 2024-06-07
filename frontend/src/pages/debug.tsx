import { Button } from "@/components/ui/button";
import { useFrappeFileUpload, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk"
import { useState } from "react";
import { Link } from "react-router-dom"

export default function Debug() {
    const { upload: upload_img, loading: upload_loading, error: upload_error, reset: upload_reset } = useFrappeFileUpload()
    const { updateDoc: update, loading: update_loading, error: update_error } = useFrappeUpdateDoc()
    const [file, setFile] = useState(); //Your File object
    const [preview, setPreview] = useState(); //Your File object

    const fileArgs = {
        /** If the file access is private then set to TRUE (optional) */
        "isPrivate": true,
        /** Folder the file exists in (optional) */
        "folder": "Home",
        /** Doctype associated with the file (optional) */
        "doctype": "Items",
        /** Docname associated with the file (mandatory if doctype is present) */
        "docname": "ITEM-000006",
        /** Field to be linked in the Document **/
        "fieldname": "image_url"
    }
    function handleChange(e) {
        console.log(e.target.files);
        setPreview(URL.createObjectURL(e.target.files[0]));
        setFile(e.target.files[0]);
    }

    function saveImage() {
        upload_img(
            file,
            fileArgs,
            'frappe.handler.upload_file'
        )
            .then((doc) => update('Items', "ITEM-000006", {
                image_url: doc.file_url,
            }))
            .catch(e => console.error(e))

    }


    return (
        <>
            <h2>Add Image:</h2>
            <input type="file" onChange={handleChange} />
            <img src={preview} />
            <button onClick={saveImage}>Save</button>
            {/* {user_error && <h1>ERROR</h1>}
            {user_loading ? <p>Loading</p> : user_data?.map(item => <><Link key={item.name + "_l"} to="/debug">{item.name}</Link><br /><DebugRoles key={item.name} user={item.name} /></>)} */}
        </>
    )
}

// function DebugRoles(props: { user: string }) {
//     const { data: role_data, isLoading: role_loading, error: role_error } = useFrappeGetDocList("Has Role", {
//         filters: [["parent", "=", props.user]]
//     })

//     return (
//         <>
//             {role_error && <h1>ERROR</h1>}
//             {role_loading ? <p>Loading</p> : role_data?.map(item => <p>{item.name}</p>)}
//         </>
//     )
// }