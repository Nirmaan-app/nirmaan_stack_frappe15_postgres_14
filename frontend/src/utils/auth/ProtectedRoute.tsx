import { useContext } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { UserContext } from './UserProvider'
import { TailSpin } from 'react-loader-spinner'
import { useUserData } from '@/hooks/useUserData'

export const ProtectedRoute = () => {

    const { currentUser, isLoading } = useContext(UserContext)

    const {role} = useUserData()

    if (isLoading) {
        return (<div className='w-full h-screen flex items-center justify-center'>
                    <TailSpin visible={true} height="100" width="100" color="#D03B45" ariaLabel="tail-spin-loading" />
                </div>)
    }
    else if (!currentUser || currentUser === 'Guest') {
        return <Navigate to="/login" />
    }
    return (
        <Outlet />
    )
}

export const AdminRoute = () => {
    const {role} = useUserData()

    if(role === "Nirmaan Admin Profile") {
        return <Outlet />
    }
}

export const LeadRoute = () => {
    const {role} = useUserData()

    if(role === "Nirmaan Project Lead Profile") {
        return <Outlet />
    }
}