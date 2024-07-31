import { useContext } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
//import { FullPageLoader } from '../../components/layout/Loaders'
import { UserContext } from './UserProvider'
import { TailSpin } from 'react-loader-spinner'

export const ProtectedRoute = () => {

    const { currentUser, isLoading } = useContext(UserContext)

    if (isLoading) {
        // return <h1>Loading Protected Routeeeee...
// return <TailSpin visible={true} height="30" width="30" color="#9C33FF" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />
return <div className='w-full h-screen flex items-center justify-center'><div className='w-10 h-10  border-2 border-black rounded-full animate-spin border-l-slate-500 '></div></div>

        {/* </h1> */}
    }
    else if (!currentUser || currentUser === 'Guest') {
        return <Navigate to="/login" />
    }
    return (
        <Outlet />
    )
}