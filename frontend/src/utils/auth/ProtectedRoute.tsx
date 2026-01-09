import { useContext } from 'react'
import { Navigate, Outlet, useParams } from 'react-router-dom'
import { UserContext } from './UserProvider'
import { TailSpin } from 'react-loader-spinner'
import { useUserData } from '@/hooks/useUserData'

export const ProtectedRoute = () => {

    const { currentUser, isLoading } = useContext(UserContext)

    if (isLoading) {
        return (<div className='w-full h-screen flex items-center justify-center'>
                    <TailSpin visible={true} height="100" width="100" color="#D03B45" ariaLabel="tail-spin-loading" />
                </div>)
    }
    if (!currentUser || currentUser === 'Guest') {
        return <Navigate to="/login" />
    }
    return <Outlet />
}

export const AdminRoute = () => {
    const {role, user_id} = useUserData()

    if(role === "Nirmaan Admin Profile" || role === "Nirmaan PMO Executive Profile" || user_id === "Administrator") {
        return <Outlet />
    }
}

export const LeadRoute = () => {
    const {role, has_project} = useUserData()

    if(role === "Nirmaan Project Lead Profile" && has_project === "true") {
        return <Outlet />
    } else if(role !== "Nirmaan Project Lead Profile") {
        return <div>You do not access to this page</div>
    } else if(has_project === "false") {
        return <div>You have not assigned any project!</div>
    }
}

export const ManagerRoute = () => {
    const {role, has_project} = useUserData()

    if(role === "Nirmaan Project Manager Profile" && has_project === "true") {
        return <Outlet />
    } else if(role !== "Nirmaan Project Manager Profile") {
        return <div>You do not access to this page</div>
    } else if(has_project === "false") {
        return <div>You have not assigned any project!</div>
    }
}

export const ProcuementExecutiveRoute = () => {
    const {role, has_project} = useUserData()

    if(role === "Nirmaan Procurement Executive Profile" && has_project === "true") {
        return <Outlet />
    } else if(role !== "Nirmaan Procurement Executive Profile") {
        return <div>You do not access to this page</div>
    } else if(has_project === "false") {
        return <div>You have not assigned any project!</div>
    }
}

export const UsersRoute = () => {
    const { role, user_id } = useUserData()

    const canAccessUsers =
        role === "Nirmaan Admin Profile" ||
        role === "Nirmaan PMO Executive Profile" ||
        role === "Nirmaan HR Executive Profile" ||
        user_id === "Administrator"

    if (canAccessUsers) {
        return <Outlet />
    }

    return (
        <div className="flex items-center justify-center h-[50vh]">
            <div className="text-center">
                <h2 className="text-xl font-semibold text-gray-800">Access Denied</h2>
                <p className="text-gray-600 mt-2">You do not have access to this page.</p>
            </div>
        </div>
    )
}

export const UserProfileRoute = () => {
    const { role, user_id } = useUserData()
    const { userId } = useParams<{ userId: string }>()

    const isAuthorizedRole =
        role === "Nirmaan Admin Profile" ||
        role === "Nirmaan PMO Executive Profile" ||
        role === "Nirmaan HR Executive Profile" ||
        user_id === "Administrator"

    // Allow if authorized role OR viewing own profile
    const isOwnProfile = user_id === userId

    if (isAuthorizedRole || isOwnProfile) {
        return <Outlet />
    }

    return (
        <div className="flex items-center justify-center h-[50vh]">
            <div className="text-center">
                <h2 className="text-xl font-semibold text-gray-800">Access Denied</h2>
                <p className="text-gray-600 mt-2">You do not have access to view this user's profile.</p>
            </div>
        </div>
    )
}