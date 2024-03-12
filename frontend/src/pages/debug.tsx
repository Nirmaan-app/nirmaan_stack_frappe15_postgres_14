import { useFrappeAuth, useFrappeGetDocList } from "frappe-react-sdk"
import { Link } from "react-router-dom"

export default function Debug() {
    const { data: user_data, isLoading: user_loading, error: user_error } = useFrappeGetDocList("User")
    return (
        <>
            {user_error && <h1>ERROR</h1>}
            {user_loading ? <p>Loading</p> : user_data?.map(item => <><Link key={item.name + "_l"} to="/debug">{item.name}</Link><br /><DebugRoles key={item.name} user={item.name} /></>)}
        </>
    )
}

function DebugRoles(props: { user: string }) {
    const { data: role_data, isLoading: role_loading, error: role_error } = useFrappeGetDocList("Has Role", {
        filters: [["parent", "=", props.user]]
    })

    return (
        <>
            {role_error && <h1>ERROR</h1>}
            {role_loading ? <p>Loading</p> : role_data?.map(item => <p>{item.name}</p>)}
        </>
    )
}