// import { useState } from 'react'
import { FrappeProvider } from 'frappe-react-sdk'
// import { Button } from './components/ui/button'
import { Route, RouterProvider, createBrowserRouter, createHashRouter, createRoutesFromElements } from 'react-router-dom'
import Dashboard from './pages/dashboard'
import Login from './pages/auth/old-login'
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
import { UpdateQuote } from './components/procurement/update-quote'
import { SentBackRequest } from './components/procurement/sent-back-request'
import { SentBackUpdateQuote } from './components/procurement/sent-back-update-quote'
import { SentBackSelectVendor } from './components/procurement/sent-back-select-vendor'
import { ReleasePOSelect } from './components/procurement/release-po-select'
import { ReleasePO } from './components/procurement/release-po'
import { QuoteUpdateSelect } from './components/procurement/quote-update-select'
import { SelectVendorList } from './components/procurement/select-vendor-list'
import { ProjectLeadComponent } from './pages/approve-order'
import { ApproveSelectSentBack } from './pages/approve-select-sent-back'
import { ApproveSentBack } from './pages/approve-sent-back'
import { PDF } from './pages/pdf'
//import { useStickyState } from './hooks/useStickyState'
import { ThemeProvider } from './components/theme-provider'
import { ProtectedRoute } from './utils/auth/ProtectedRoute'
import { UserProvider } from './utils/auth/UserProvider'

//import AuthenticationPage from './pages/auth/login-shadcn'
import Users from './pages/users'
import Roles from './pages/roles'
import Debug from './pages/debug'
import { ApproveSelectVendor } from './pages/approve-select-vendor'
import { ApproveVendor } from './pages/approve-vendor'
import { NewPR } from './components/procurement-request/new-pr'
import { PRSummary } from './components/pr-summary'
import { UserForm } from './pages/user-form'
import Items from './pages/items'

import Vendors from './pages/vendors'

import { NewVendor } from './pages/new-vendor'
import ListPR from './components/procurement-request/list-pr'
import { EditVendor } from './pages/edit-vendor'
import EditItems from './pages/items-edit'
// import { NewMilestone } from './components/new-milestone'


const router = createBrowserRouter(
	createRoutesFromElements(
		<>
			{/* <Route path='/login' lazy={() => import('@/pages/auth/Login')} /> */}
			<Route path='/login' element={<Login />} />
			<Route path='/forgot-password' lazy={() => import('@/pages/auth/forgot-password')} />
			<Route path='/' element={<ProtectedRoute />}>
				<Route index element={<Dashboard />} />

				<Route path="pdf" element={<PDF />} />
				{/* <Route path="/new-pr/:id" element={<NewPR />} /> */}
				{/* <Route path="/pr-summary/:id" element={<PRSummary />} /> */}
				{/* <Route path="/milestone/:id" element={<NewMilestone/>} /> */}
				<Route path="approve-order" element={<ApprovePR />} />
				<Route path="/approve-order/:id" element={<ProjectLeadComponent />} />
				<Route path="approve-vendor" element={<ApproveSelectVendor />} />
				<Route path="approve-vendor/:orderId" element={<ApproveVendor />} />
				<Route path="approve-sent-back" element={<ApproveSelectSentBack />} />
				<Route path="approve-sent-back/:id" element={<ApproveSentBack />} />
				<Route path="procure-request" element={<PRList />} />
				<Route path="update-quote" element={<QuoteUpdateSelect />} />
				<Route path="select-vendor-list" element={<SelectVendorList />} />
				<Route path="sent-back-request" element={<SentBackRequest />} />
				<Route path="sent-back-request/:id" element={<SentBackUpdateQuote />} />
				<Route path="sent-back-request/select-vendor/:id" element={<SentBackSelectVendor />} />
				<Route path="/procure-request/:orderId" element={<ProcurementOrder />} />
				<Route path="/procure-request/quote-update/:orderId" element={<UpdateQuote />} />
				<Route path="/procure-request/quote-update/select-vendors/:orderId" element={<SelectVendors />} />
				<Route path="release-po" element={<ReleasePOSelect />} />
				<Route path="/release-po/:id" element={<ReleasePO />} />


				<Route path="projects">
					<Route index element={<Projects />} />
					<Route path="new" element={<EditProject />} />
					<Route
						path=":projectId"
						// loader={(({ params }) => {
						// 	console.log(params.projectId)
						// })}
						// action={(({ params }) => {})}
						lazy={() => import('@/pages/project')}
					/>
					<Route path=":projectId/edit" element={<EditProjectForm />} />
				</Route>

				<Route path="users">
					<Route index element={<Users />} />
					<Route path="new" element={<UserForm />} />
					<Route path=":id" element={<Profile />} />
				</Route>

				<Route path="wp" element={<WorkPackages />} />

				<Route path="items" >
					<Route index element={<Items />} />
					<Route path=":id" element={<EditItems />} />
				</Route>

				<Route path="vendors">
					<Route index element={<Vendors />} />
					<Route path="new" element={<NewVendor />} />
					<Route path=":id" element={<EditVendor />} />
				</Route>

				<Route path="roles">
					<Route index element={<Roles />} />
				</Route>
				<Route path="customers" >
					<Route index element={<Customers />} />
					{/* <Route path="edit" element={<EditCustomer />} /> */}
				</Route>

				{/* Procurement Request Paths */}
				<Route path="procurement-request">
					<Route index element={<ListPR />} />
					<Route path=":id/new" element={<NewPR />} />
					<Route path=":id" lazy={() => import('@/components/pr-summary')} />
				</Route>

				<Route path="debug">
					<Route index element={<Debug />} />
				</Route>

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