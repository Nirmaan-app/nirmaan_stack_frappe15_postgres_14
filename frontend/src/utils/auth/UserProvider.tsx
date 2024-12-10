import { useFrappeAuth, useSWRConfig } from 'frappe-react-sdk'
import React, { FC, PropsWithChildren, useEffect } from 'react'
import { createContext } from 'react'
import { useState } from 'react'
import { boolean } from 'zod'
// import { useNavigate } from 'react-router-dom'

interface UserContextProps {
    isLoading: boolean,
    currentUser: string,
    login: (username: string, password: string) => Promise<void>,
    logout: () => Promise<void>,
    updateCurrentUser: VoidFunction,
    selectedProject: string | undefined,
    setSelectedProject: any
    
}

export const UserContext = createContext<UserContextProps>({
    currentUser: '',
    isLoading: false,
    login: () => Promise.resolve(),
    logout: () => Promise.resolve(),
    updateCurrentUser: () => { },
    selectedProject: '',
    setSelectedProject: () => {}
})

export const UserProvider: FC<PropsWithChildren> = ({ children }) => {

    const { mutate } = useSWRConfig()
    const { login, logout, currentUser, updateCurrentUser, isLoading } = useFrappeAuth()
    const [authStatus, setAuthStatus] = useState<'idle' | 'loggedOut' | 'loggedIn'>('idle')

    const [selectedProject, setSelectedProject] = useState();

    useEffect(() => {
      const savedProject = sessionStorage.getItem('selectedProject');
       setSelectedProject(savedProject ? JSON.parse(savedProject) : null)
    }, [])

    // console.log("selectedProject", selectedProject)

    // const navigate  = useNavigate();


    // useEffect(() => {
    //     if (authStatus === "loggedOut") {
    //         localStorage.removeItem("app-cache")
    //         sessionStorage.clear()
    //         mutate(() => true, undefined, false);
    //         navigate("/login")
    //     } else if (authStatus === "loggedIn") {
    //         navigate('/');
    //     }
    // }, [authStatus, navigate, mutate])

    const handleLogout = async () => {
        localStorage.removeItem('app-cache')
        return logout()
            .then(() => {
                //Clear cache on logout
                sessionStorage.clear()
                return mutate(() => true, undefined, false)
            })
            // .then(() => {
            //     //Reload the page so that the boot info is fetched again
            //     const URL = import.meta.env.VITE_BASE_NAME ? `${import.meta.env.VITE_BASE_NAME}` : ``
            //     if (URL) {
            //         window.location.replace(`/${URL}/login`)
            //     } else {
            //         window.location.replace('/login')
            //     }

            //     // window.location.reload()
            // })

        // setAuthStatus("loggedOut")
        // await logout()
    }

    const handleLogin = async (username: string, password: string) => {
        return login({
            username,
            password
        })
            // .then(() => {
            //     // //Reload the page so that the boot info is fetched again
            //     // const URL = import.meta.env.VITE_BASE_NAME ? `/${import.meta.env.VITE_BASE_NAME}` : ``
            //     // window.location.replace(`${URL}/`)
            //     window.location.reload()
            // })

        // await login({username, password})
        // setAuthStatus('loggedIn')
    }
    return (
        <UserContext.Provider value={{ isLoading, updateCurrentUser, login: handleLogin, logout: handleLogout, currentUser: currentUser ?? "", selectedProject, setSelectedProject }}>
            {children}
        </UserContext.Provider>
    )
}