import { useState } from 'react'
import { FrappeProvider } from 'frappe-react-sdk'
import { Button } from './components/ui/button'
import { Route, RouterProvider, createBrowserRouter, createRoutesFromElements } from 'react-router-dom'
import Dashboard from './pages/dashboard'
import Projects from './pages/projects'
import Customers from './pages/customers'
import WorkPackages from './pages/work-packages'
//import { useStickyState } from './hooks/useStickyState'
import { ThemeProvider } from './components/theme-provider'
import { ProtectedRoute } from './utils/auth/ProtectedRoute'
import { UserProvider } from './utils/auth/UserProvider'
import AuthenticationPage from './pages/auth/login-shadcn'


const router = createBrowserRouter(
	createRoutesFromElements(
		<>
			<Route path='/login' lazy={() => import('@/pages/auth/Login')} />
			<Route path='/' element={<ProtectedRoute />}>
				<Route index element={<Dashboard />} />
				<Route path="projects" >
					<Route index element={<Projects />} />
					{/* <Route path="edit" element={<EditProject />} /> */}
					{/* <Route
						path=":projectId"
						// loader={(({ params }) => {
						// 	console.log(params.projectId)
						// })}
						// action={(({ params }) => {})}
						lazy={() => import('@/pages/project')}
					/> */}
				</Route>
				<Route path="customers" >
					<Route index element={<Customers />} />
					{/* <Route path="edit" element={<EditCustomer />} /> */}
				</Route>
				{/* <Route index element={<ChannelRedirect />} />
					<Route path="saved-messages" lazy={() => import('./components/feature/saved-messages/SavedMessages')} />
					<Route path=":channelID" lazy={() => import('@/pages/ChatSpace')} />
				</Route> */}
				<Route path="wp" element={<WorkPackages />} />
				<Route path="testlogin" element={<AuthenticationPage />} />
			</Route >
		</>
	), {
	basename: `/${import.meta.env.VITE_BASE_NAME}` ?? "",
}
)

function App() {
	// const [appearance, setAppearance] = useStickyState<'light' | 'dark'>('light', 'appearence');

	// const toggleTheme = () => {
	// 	setAppearance(appearance === 'dark' ? 'light' : 'dark');
	// };


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
