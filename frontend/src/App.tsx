// import { useState } from 'react'
import { FrappeProvider } from 'frappe-react-sdk'
// import { Button } from './components/ui/button'
import { Route, RouterProvider, createBrowserRouter, createRoutesFromElements } from 'react-router-dom'
import Dashboard from './pages/dashboard'
import Login from './pages/login'
import Projects from './pages/projects'
import Customers from './pages/customers'
import WorkPackages from './pages/work-packages'
import EditProject from './pages/edit-project'
import Profile from './pages/user-profile'
import { EditProjectForm } from './components/edit-project-form'
import { ApprovePR } from './pages/approve-pr'
import { PRList } from './components/procurement/procurement-approved'
import { ProcurementOrder } from './components/procurement/procurement-vendor'
import { SelectVendors } from './components/procurement/select-vendors'
import { ProjectLeadComponent } from './pages/approve-order'
//import { useStickyState } from './hooks/useStickyState'
import { ThemeProvider } from './components/theme-provider'
import { ProtectedRoute } from './utils/auth/ProtectedRoute'
import { UserProvider } from './utils/auth/UserProvider'

//import AuthenticationPage from './pages/auth/login-shadcn'
import Users from './pages/users'
import Roles from './pages/roles'
import Debug from './pages/debug'


const router = createBrowserRouter(
	createRoutesFromElements(
		<>
			<Route path='/login' lazy={() => import('@/pages/auth/Login')} />
			{/* <Route path='/login' element={<Login />} /> */}
			<Route path='/forgot-password' lazy={() => import('@/pages/auth/forgot-password')} />
			<Route path='/' element={<ProtectedRoute />}>
				<Route index element={<Dashboard />} />
				<Route path="user-profile" element={<Profile />} />
				<Route path="approve-order" element={<ApprovePR />} />
				<Route path="/approve-order/:id" element={<ProjectLeadComponent />} />
				<Route path="procure-request" element={<PRList />} />
				<Route path="/procure-request/:orderId" element={<ProcurementOrder />} />
				<Route path="/procure-request/select-vendors/:orderId" element={<SelectVendors />} />
				<Route path="projects">
					<Route index element={<Projects />} />
					<Route path="edit" element={<EditProject />} />
					<Route
						path=":projectId"
						// loader={(({ params }) => {
						// 	console.log(params.projectId)
						// })}
						// action={(({ params }) => {})}
						lazy={() => import('@/pages/project')}
					/>
					<Route path="edit-one/:projectId" element={<EditProjectForm />} />
				</Route>
				<Route path="users">
					<Route index element={<Users />} />
				</Route>
				<Route path="roles">
					<Route index element={<Roles />} />
				</Route>
				<Route path="customers" >
					<Route index element={<Customers />} />
					{/* <Route path="edit" element={<EditCustomer />} /> */}
				</Route>
				{/* <Route index element={<ChannelRedirect />} />
					<Route path="saved-messages" lazy={() => import('./components/feature/saved-messages/SavedMessages')} />
					<Route path=":channelID" lazy={() => import('@/pages/ChatSpace')} />
				</Route> */}
				<Route path="debug">
					<Route index element={<Debug />} />
				</Route>
				<Route path="wp" element={<WorkPackages />} />
				{/* <Route path="testlogin" element={<AuthenticationPage />} /> */}
			</Route >
		</>
	), {
	basename: `/${import.meta.env.VITE_BASE_NAME}` ?? "",
}
)




function App() {
	// Sitename support for frappe v15
	const getSiteName = () => {
		// @ts-ignore
		if (window.frappe?.boot?.versions?.frappe && (window.frappe.boot.versions.frappe.startsWith('15') || window.frappe.boot.versions.frappe.startsWith('16'))) {
			// @ts-ignore
			return window.frappe?.boot?.sitename ?? import.meta.env.VITE_SITE_NAME
		}
		return import.meta.env.VITE_SITE_NAME

	}

	return (
		<FrappeProvider
			url={import.meta.env.VITE_FRAPPE_PATH ?? ""}
			socketPort={import.meta.env.VITE_SOCKET_PORT ? import.meta.env.VITE_SOCKET_PORT : undefined}
			//@ts-ignore
			siteName={getSiteName()}>
			<UserProvider>
				<ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
					<RouterProvider router={router} />
				</ThemeProvider>
			</UserProvider>
		</FrappeProvider>
	)
}

export default App